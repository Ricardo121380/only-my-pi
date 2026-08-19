import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createSchemaRegistry, validateRepositoryContracts } from "../scripts/lib/schema-registry.mjs";
import { validatePackageEntrySource } from "../scripts/lib/package-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "contracts", "schema-catalog.json"), "utf8"));

function read(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function fixture(kind, name) {
  const entry = catalog.schemas.find((candidate) => candidate.kind === kind);
  assert.ok(entry, `missing catalog entry for ${kind}`);
  const relativePath = path.posix.join(entry.fixtureDir, name);
  return { document: read(relativePath), sourcePath: relativePath };
}

function negativeFixtureNames(kind) {
  const entry = catalog.schemas.find((candidate) => candidate.kind === kind);
  return fs.readdirSync(path.join(root, entry.fixtureDir)).filter((name) => name.startsWith("negative-") && name.endsWith(".json")).sort();
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) for (const item of value) collectRefs(item, refs);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref") refs.push(item);
      else collectRefs(item, refs);
    }
  }
  return refs;
}

function assertFixtureKeyword(registry, kind, name, keyword) {
  const candidate = fixture(kind, name);
  const result = registry.validate(kind, candidate.document, { sourcePath: candidate.sourcePath });
  assert.equal(result.valid, false, `${kind}/${name} unexpectedly passed`);
  assert.ok(result.errors.some((entry) => entry.keyword === keyword), `${kind}/${name} missing ${keyword}: ${JSON.stringify(result.errors)}`);
}

test("catalog exposes every M1 contract kind exactly once", () => {
  const kinds = catalog.schemas.map((entry) => entry.kind);
  assert.equal(new Set(kinds).size, kinds.length);
  for (const required of ["inventory", "profile", "capability", "owner", "mode", "agent", "workflow", "swarmRecipe", "theme"]) {
    assert.ok(kinds.includes(required), `missing core kind ${required}`);
  }
  for (const governance of ["resourceInventory", "commandOwner", "enforcementSurface"]) {
    assert.ok(kinds.includes(governance), `missing governance kind ${governance}`);
  }
});

test("all schemas are Draft 2020-12, strict objects, and use local fragments only", () => {
  for (const entry of catalog.schemas) {
    const schema = read(entry.schemaPath);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", entry.kind);
    assert.match(schema.$id, /^https:\/\/github\.com\/Ricardo121380\/only-my-pi\/schemas\//, entry.kind);
    assert.equal(schema.type, "object", entry.kind);
    assert.equal(schema.additionalProperties, false, entry.kind);
    for (const ref of collectRefs(schema)) assert.match(ref, /^#\//, `${entry.kind} has non-local $ref ${ref}`);
  }
});

test("production contracts validate non-vacuously", () => {
  const result = validateRepositoryContracts({ rootDir: root });
  const failures = result.results.filter((entry) => !entry.valid);
  assert.equal(result.kinds, catalog.schemas.length);
  assert.ok(result.documents >= catalog.schemas.length, "each kind must have at least one production document");
  assert.deepEqual(failures, []);
  assert.equal(result.valid, true);
});

test("every kind has a valid positive fixture and at least two failing negatives", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const kind of registry.kinds) {
    const positive = fixture(kind, "positive.json");
    const positiveResult = registry.validate(kind, positive.document, { sourcePath: positive.sourcePath });
    assert.equal(positiveResult.valid, true, `${kind} positive failed: ${JSON.stringify(positiveResult.errors)}`);

    const negatives = negativeFixtureNames(kind);
    assert.ok(negatives.length >= 2, `${kind} needs at least two negative fixtures`);
    for (const name of negatives) {
      const candidate = fixture(kind, name);
      const result = registry.validate(kind, candidate.document, { sourcePath: candidate.sourcePath });
      assert.equal(result.valid, false, `${kind}/${name} unexpectedly passed`);
      assert.ok(result.errors.length > 0, `${kind}/${name} returned no errors`);
      for (const error of result.errors) {
        assert.equal(typeof error.instancePath, "string");
        assert.equal(typeof error.schemaPath, "string");
        assert.equal(typeof error.keyword, "string");
        assert.equal(typeof error.message, "string");
        assert.equal(typeof error.params, "object");
      }
    }
  }
});

test("inventory accepts exact npm and full Git SHA but rejects floating sources", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  const positive = fixture("inventory", "positive.json");
  assert.equal(registry.validate("inventory", positive.document, { sourcePath: positive.sourcePath }).valid, true);
  for (const name of ["negative-dist-tag.json", "negative-semver-range.json", "negative-git-branch.json", "negative-git-tag.json", "negative-git-short-sha.json"]) {
    const candidate = fixture("inventory", name);
    assert.equal(registry.validate("inventory", candidate.document, { sourcePath: candidate.sourcePath }).valid, false, name);
  }
});

test("promoted npm and Git sources require package-doctor-compatible audit integrity", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  const positive = fixture("inventory", "positive.json");
  for (const entry of positive.document.packages) assert.doesNotThrow(() => validatePackageEntrySource(entry, { promoted: true }), entry.id);
  for (const name of ["negative-promoted-npm-missing-integrity.json", "negative-promoted-git-missing-integrity.json"]) {
    assertFixtureKeyword(registry, "inventory", name, "required");
  }
  assertFixtureKeyword(registry, "inventory", "negative-promoted-invalid-integrity.json", "pattern");
});

test("promoted lifecycle audits fail closed on missing, malformed, and legacy declarations", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  assertFixtureKeyword(registry, "inventory", "negative-promoted-missing-lifecycle.json", "required");
  assertFixtureKeyword(registry, "inventory", "negative-promoted-invalid-lifecycle-digest.json", "pattern");
  assertFixtureKeyword(registry, "inventory", "negative-promoted-legacy-lifecycle-scripts.json", "false schema");

  const required = fixture("inventory", "runtime-negative-required-lifecycle.json");
  const result = registry.validate("inventory", required.document, { sourcePath: required.sourcePath });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(required.document.packages[0].audit.lifecycle.scripts[0].necessity, "required");
});

test("Mode and Agent policy ceilings reject mutation and denied egress escalation", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const [kind, name, keyword] of [
    ["mode", "negative-readonly-edit.json", "capability-escalation"],
    ["mode", "negative-none-bash.json", "capability-escalation"],
    ["mode", "negative-web-tool-egress.json", "egress-escalation"],
    ["mode", "negative-mcp-capability-egress.json", "egress-escalation"],
    ["agent", "negative-readonly-writer.json", "capability-escalation"],
    ["agent", "negative-network-capability-egress.json", "egress-escalation"],
    ["agent", "negative-provider-capability-egress.json", "egress-escalation"],
    ["agent", "negative-io-required-reference.json", "unknown-reference"],
  ]) assertFixtureKeyword(registry, kind, name, keyword);
});

test("Capability requires graph detects deep cycles, unknown conflicts, and conflict escalation", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  assertFixtureKeyword(registry, "capability", "negative-three-node-cycle.json", "cycle");
  assertFixtureKeyword(registry, "capability", "negative-requires-conflict.json", "capability-escalation");
  assertFixtureKeyword(registry, "capability", "negative-unknown-conflict.json", "unknown-reference");
});

test("Workflow verifier, references, full DAG, and every budget envelope fail closed", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const [name, keyword] of [
    ["negative-missing-verifier-gate.json", "verifier-gate"],
    ["negative-disconnected-verifier-gate.json", "verifier-gate"],
    ["negative-max-steps-envelope.json", "budget-envelope"],
    ["negative-max-parallel-envelope.json", "budget-envelope"],
    ["negative-timeout-envelope.json", "budget-envelope"],
    ["negative-retry-envelope.json", "budget-envelope"],
    ["negative-unknown-policy-ref.json", "unknown-reference"],
    ["negative-unknown-gate.json", "unknown-reference"],
    ["negative-three-node-cycle.json", "cycle"],
  ]) assertFixtureKeyword(registry, "workflow", name, keyword);
});

test("Swarm DAG, agent and writer policies, and every budget envelope fail closed", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const [name, keyword] of [
    ["negative-max-children-envelope.json", "budget-envelope"],
    ["negative-max-concurrency-envelope.json", "budget-envelope"],
    ["negative-depth-envelope.json", "budget-envelope"],
    ["negative-child-timeout-envelope.json", "budget-envelope"],
    ["negative-run-timeout-envelope.json", "budget-envelope"],
    ["negative-retry-envelope.json", "budget-envelope"],
    ["negative-shared-writer-envelope.json", "writer-policy"],
    ["negative-parallel-writer-worktree.json", "writer-policy"],
    ["negative-nested-swarm-unmodeled.json", "unsupported-nesting"],
    ["negative-three-node-cycle.json", "cycle"],
    ["negative-unknown-agent.json", "unknown-reference"],
  ]) assertFixtureKeyword(registry, "swarmRecipe", name, keyword);
});

test("subagents v2 contracts reject authority, budget, reference, and terminal-proof drift", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const [kind, name, keyword] of [
    ["agentTemplate", "negative-readonly-write.json", "capability-escalation"],
    ["batchSwarm", "negative-concurrency-envelope.json", "budget-envelope"],
    ["batchSwarm", "negative-agent-binding.json", "correlation-digest"],
    ["batchSwarm", "negative-max-items.json", "maximum"],
    ["batchSwarm", "negative-assignment-envelope.json", "budget-envelope"],
    ["ultraRun", "negative-unknown-workflow.json", "unknown-reference"],
    ["terminalReceipt", "negative-authoritative-without-proof.json", "terminal-proof"],
  ]) assertFixtureKeyword(registry, kind, name, keyword);
});

test("TaskAssignment ownership fixtures reject unbound claims and incomplete writer evidence", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  assertFixtureKeyword(registry, "taskAssignment", "negative-file-claim-outside-paths.json", "path-claim");
  assertFixtureKeyword(registry, "taskAssignment", "negative-writer-empty-claims.json", "minItems");
  assertFixtureKeyword(registry, "taskAssignment", "negative-writer-missing-base-commit.json", "required");
});

test("S4 dynamic goal and UltraRun references fail closed at the contract catalog", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  for (const [kind, name, keyword] of [
    ["swarmGoal", "negative-role-conflict.json", "role-conflict"],
    ["swarmGoal", "negative-agent-envelope.json", "budget-envelope"],
    ["ultraRun", "negative-unknown-workflow.json", "unknown-reference"],
    ["ultraRun", "negative-unknown-batch.json", "unknown-reference"],
    ["ultraRun", "negative-unknown-goal.json", "unknown-reference"],
  ]) {
    assertFixtureKeyword(registry, kind, name, keyword);
  }
});

test("semantic graph rejects unknown references, cycles, duplicate owners, and escalation", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  const cases = [
    ["profile", "negative-unknown-capability.json", "unknown-reference"],
    ["owner", "negative-duplicate-id.json", "duplicate-id"],
    ["commandOwner", "negative-duplicate-id.json", "duplicate"],
    ["mode", "negative-self-cycle.json", "cycle"],
    ["mode", "negative-escalation.json", "capability-escalation"],
    ["agent", "negative-read-role-bash.json", "capability-escalation"],
    ["workflow", "negative-cycle.json", "cycle"],
    ["swarmRecipe", "negative-cycle.json", "cycle"],
    ["swarmRecipe", "negative-read-only-writer.json", "capability-escalation"]
  ];
  for (const [kind, name, keywordFragment] of cases) {
    const candidate = fixture(kind, name);
    const result = registry.validate(kind, candidate.document, { sourcePath: candidate.sourcePath });
    assert.equal(result.valid, false, `${kind}/${name}`);
    assert.ok(result.errors.some((error) => error.keyword.includes(keywordFragment)), `${kind}/${name}: ${JSON.stringify(result.errors)}`);
  }
});

test("M5 promotes the inspect mode and research synthesis recipe; remaining seeds stay contracts", () => {
  assert.equal(read("modes/inspect.json").contractStatus, "runtime-ready");
  assert.equal(read("swarm/recipes/research-synthesis.json").contractStatus, "runtime-ready");
  for (const relativePath of ["agents/scout.json", "workflows/single-agent-safe.json"]) {
    assert.equal(read(relativePath).contractStatus, "contract-only", relativePath);
  }
});

test("durable run-plan and cancel contracts share runtime digest bindings", () => {
  const registry = createSchemaRegistry({ rootDir: root });
  const planFixture = fixture("workflowRunPlan", "positive.json");
  const tamperedPlan = structuredClone(planFixture.document);
  tamperedPlan.executionEnvelope.sourceHash = `sha256:${"a".repeat(64)}`;
  const planResult = registry.validate("workflowRunPlan", tamperedPlan, { sourcePath: planFixture.sourcePath });
  assert.equal(planResult.valid, false);
  assert.ok(planResult.errors.some((entry) => ["digest-binding", "digest-authenticity"].includes(entry.keyword)), JSON.stringify(planResult.errors));

  const cancelFixture = fixture("workflowCancelRequest", "positive.json");
  const tamperedCancel = structuredClone(cancelFixture.document);
  tamperedCancel.reason = "different operator intent";
  const cancelResult = registry.validate("workflowCancelRequest", tamperedCancel, { sourcePath: cancelFixture.sourcePath });
  assert.equal(cancelResult.valid, false);
  assert.ok(cancelResult.errors.some((entry) => entry.keyword === "digest-authenticity"), JSON.stringify(cancelResult.errors));
});
