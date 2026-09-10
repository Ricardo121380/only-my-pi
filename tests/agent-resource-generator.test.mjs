import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentResources, compileAgentResource } from "../scripts/generate-subagent-resources.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function manifest(overrides = {}) {
  return {
    formatVersion: 1,
    contractStatus: "contract-only",
    id: "scout",
    description: "Read-only codebase evidence mapping.",
    modelRole: "fast",
    tools: { allow: ["read", "grep", "find", "ls"], deny: ["bash", "edit", "write", "web"] },
    writer: false,
    gateIds: [],
    ...overrides,
  };
}

test("agent compiler creates a deterministic namespaced pi-subagents resource", () => {
  const left = compileAgentResource(manifest(), "Return a bounded evidence map.\n");
  const right = compileAgentResource(manifest(), "Return a bounded evidence map.\n");
  assert.deepEqual(left, right);
  assert.equal(left.name, "omp-scout");
  assert.match(left.content, /tools: read, grep, find, ls/);
  assert.doesNotMatch(left.content, /tools:.*bash/);
});

test("non-writer compiler rejects bash, edit, or write regardless of prompt", () => {
  for (const tool of ["bash", "edit", "write"]) {
    assert.throws(
      () => compileAgentResource(manifest({ tools: { allow: ["read", tool], deny: [] } }), "Do not mutate anything."),
      /non-writer agent cannot receive/,
    );
  }
});

test("tester and verifier require fixed gate IDs and never arbitrary bash", () => {
  assert.throws(
    () => compileAgentResource(manifest({ id: "tester", tools: { allow: ["read", "bash"], deny: [] }, gateIds: [] }), "Run tests."),
    /(non-writer|fixed gate IDs)/,
  );
  assert.doesNotThrow(() => compileAgentResource(manifest({ id: "verifier", gateIds: ["full-tests"] }), "Verify receipts."));
});

test("direct-coding bundle publishes read-only roles and exactly one guarded implementer", () => {
  const resources = buildAgentResources({ rootDir: root });
  const bundled = resources.filter((resource) => resource.bundleEligible);
  const writers = bundled.filter((resource) => !resource.readOnly);
  assert.ok(bundled.some((resource) => resource.name === "omp-researcher"));
  assert.deepEqual(writers.map((resource) => resource.name), ["omp-implementer"]);
  assert.match(writers[0].content, /^tools:.*edit, write, bash/mu);
  assert.match(writers[0].content, /managed\s+ordinary Git clone/u);
  for (const resource of bundled) {
    assert.match(resource.bundleOutputPath, /bundles\/only-my-pi-agent-bundle\/agents/u);
    if (resource.readOnly) assert.doesNotMatch(resource.content, /^tools:.*(?:bash|edit|write)/mu);
  }
});
