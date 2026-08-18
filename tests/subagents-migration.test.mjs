import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  migrateLegacyCatalog,
  translateLegacySwarmRecipe,
  translateLegacyWorkflow,
} from "../packages/subagents/workflow/migration/index.mjs";
import { validateWorkflowPlan } from "../packages/subagents/workflow/plan-compiler/index.mjs";

const root = process.cwd();
const read = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));

test("all four legacy swarm recipes migrate to heterogeneous WorkflowPlans, never BatchSwarm", () => {
  const files = fs.readdirSync(path.join(root, "swarm", "recipes")).filter((file) => file.endsWith(".json")).sort();
  assert.equal(files.length, 4);
  for (const file of files) {
    const recipe = read(path.join("swarm", "recipes", file));
    const migrated = translateLegacySwarmRecipe(recipe);
    assert.equal(migrated.migration.taxonomy, "heterogeneous-workflow");
    assert.equal(migrated.definition.description.includes("not a BatchSwarm"), true);
    assert.equal(migrated.plan.nodes.some((node) => node.kind === "batch-swarm"), false);
    assert.equal(migrated.plan.nodes.length, recipe.nodes.length);
    assert.equal(validateWorkflowPlan(migrated.plan).valid, true);
    for (const legacy of recipe.nodes) {
      const node = migrated.plan.nodes.find((candidate) => candidate.id === legacy.id);
      assert.ok(node, `${recipe.id}/${legacy.id}`);
      assert.deepEqual(node.needs, [...legacy.needs].sort());
      assert.equal(node.policy.workspace, legacy.writer ? "managed-worktree" : "shared-read-only");
    }
  }
});

test("legacy workflow approval becomes an explicit approval node", () => {
  const workflow = read("workflows/plan-build-review.json");
  const migrated = translateLegacyWorkflow(workflow);
  const approval = migrated.plan.nodes.find((node) => node.id === "implement-approval");
  const implement = migrated.plan.nodes.find((node) => node.id === "implement");
  assert.equal(approval.kind, "approval");
  assert.deepEqual(implement.needs, ["implement-approval"]);
  assert.equal(implement.policy.workspace, "managed-worktree");
  assert.equal(implement.idempotency, "receipt");
  assert.equal(validateWorkflowPlan(migrated.plan).valid, true);
});

test("legacy swarm action flattens into namespaced Agent nodes plus a barrier", () => {
  const recipe = read("swarm/recipes/debug-hypotheses.json");
  const workflow = {
    ...read("workflows/single-agent-safe.json"),
    id: "legacy-with-swarm",
    version: "1.0.0",
    budget: { maxSteps: 2, maxParallel: 2, timeoutSeconds: 3600, retry: 0, maxOutputBytes: 65536 },
    steps: [
      { id: "investigate", action: "swarm", recipe: recipe.id, needs: [], policyRef: "debug", approval: "none", timeoutSeconds: 1800 },
      { id: "verify", action: "gate", gate: "test-contract", needs: ["investigate"], policyRef: "verify", approval: "none", timeoutSeconds: 300 },
    ],
    terminal: { step: "verify", acceptedVerdicts: ["pass"], rejectedVerdicts: ["fail"], requiresVerifierGate: true },
  };
  const migrated = translateLegacyWorkflow(workflow, { resolveRecipe: (id) => id === recipe.id ? recipe : null });
  assert.ok(migrated.plan.nodes.some((node) => node.id === "investigate--hypothesis-a"));
  assert.deepEqual(migrated.plan.nodes.find((node) => node.id === "investigate").needs, ["investigate--verify"]);
  assert.deepEqual(migrated.plan.nodes.find((node) => node.id === "verify").needs, ["investigate"]);
  assert.equal(migrated.plan.nodes.filter((node) => node.kind === "batch-swarm").length, 0);
});

test("catalog migration is deterministic and rejects dangling legacy references", () => {
  const workflows = fs.readdirSync(path.join(root, "workflows")).filter((file) => file.endsWith(".json")).sort().map((file) => read(path.join("workflows", file)));
  const recipes = fs.readdirSync(path.join(root, "swarm", "recipes")).filter((file) => file.endsWith(".json")).sort().map((file) => read(path.join("swarm", "recipes", file)));
  const left = migrateLegacyCatalog({ workflows, recipes });
  const right = migrateLegacyCatalog({ workflows: structuredClone(workflows), recipes: structuredClone(recipes) });
  assert.deepEqual(left, right);
  const invalid = structuredClone(recipes[0]);
  invalid.nodes[0].needs = ["missing"];
  assert.throws(() => translateLegacySwarmRecipe(invalid), /unknown legacy dependency/);
});
