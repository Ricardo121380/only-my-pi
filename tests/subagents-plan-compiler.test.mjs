import assert from "node:assert/strict";
import test from "node:test";

import {
  compileWorkflowDefinition,
  diffWorkflowPlans,
  validateWorkflowPlan,
  WORKFLOW_PLAN_PRIMITIVES,
} from "../packages/subagents/workflow/plan-compiler/index.mjs";

function agent(id, needs = []) {
  return {
    kind: "agent",
    id,
    agentTemplateRef: "scout",
    needs,
    assignment: { taskTemplateRef: "inspect-source" },
    policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"] } },
    budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 },
    cache: { mode: "content-addressed", keyInputs: ["input"] },
    idempotency: "content-addressed",
  };
}

function definition(flow, overrides = {}) {
  return {
    $schema: "../../schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: "fixture-workflow",
    version: "2.0.0",
    description: "Fixture workflow",
    policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"] } },
    budget: {
      maxNodes: 16,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 2,
      maxWallTimeMs: 10_000,
      maxOutputBytes: 100_000,
      maxAssignments: 16,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow,
    ...overrides,
  };
}

test("WorkflowDefinition compiles deterministically into immutable primitive-only plans", () => {
  const source = definition({
    kind: "sequence",
    steps: [
      { kind: "parallel", branches: [agent("inspect-a"), agent("inspect-b")] },
      { kind: "gate", id: "verify", gateId: "test-contract", policy: { workspace: "shared-read-only", mutation: "none" }, budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 } },
    ],
  });
  const left = compileWorkflowDefinition(source);
  const right = compileWorkflowDefinition(structuredClone(source));
  assert.deepEqual(left, right);
  assert.equal(left.nodes.length, 3);
  assert.deepEqual(left.nodes.find((node) => node.id === "verify").needs, ["inspect-a", "inspect-b"]);
  assert.ok(left.nodes.every((node) => WORKFLOW_PLAN_PRIMITIVES.includes(node.kind)));
  assert.equal(validateWorkflowPlan(left).valid, true);
  assert.equal(Object.isFrozen(left), true);
  assert.throws(() => { left.nodes[0].id = "changed"; }, TypeError);
});

test("nested workflows are flattened with namespaced nodes and no nested controller", () => {
  const nested = definition({ kind: "sequence", steps: [agent("read"), agent("review")] }, { id: "child-flow" });
  const source = definition({
    kind: "sequence",
    steps: [
      { kind: "workflow", id: "child", workflowRef: "child-flow" },
      { kind: "checkpoint", id: "checkpoint", checkpoint: { scope: "workspace", restore: "review-plan-only" }, policy: { workspace: "shared-read-only", mutation: "none" }, budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 } },
    ],
  });
  const plan = compileWorkflowDefinition(source, { resolveWorkflow: (id) => id === "child-flow" ? nested : null });
  assert.deepEqual(plan.nodes.map((node) => node.id), ["checkpoint", "child--read", "child--review"]);
  assert.deepEqual(plan.nodes.find((node) => node.id === "checkpoint").needs, ["child--review"]);
  assert.equal(plan.nodes.some((node) => node.kind === "workflow"), false);
});

test("cycles, unknown nodes, escalation, unsafe replay, and graph budget widening fail closed", () => {
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "sequence", steps: [{ ...agent("a"), needs: ["missing"] }] })),
    /unknown node dependency/,
  );
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "parallel", branches: [{ ...agent("a"), needs: ["b"] }, { ...agent("b"), needs: ["a"] }] })),
    /cycle/,
  );
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "sequence", steps: [{ ...agent("a"), policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["write"] } } }] })),
    /read-only policy allows mutating tool/,
  );
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "sequence", steps: [{ ...agent("a"), policy: { workspace: "shared-guarded", mutation: "guarded", tools: { allow: ["write"] } }, cache: { mode: "content-addressed" }, idempotency: "none" }] })),
    /cannot use cache/,
  );
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "parallel", branches: [agent("a"), agent("b")] }, { budget: { ...definition({}).budget, maxParallel: 1 } })),
    /maxParallel/,
  );
});

test("bounded loop-controller is accepted and unbounded loop is rejected", () => {
  const good = definition({
    kind: "loop-controller",
    id: "quality-loop",
    loop: {
      maxIterations: 3,
      conditionRef: "verdict-failed",
      bodyDefinitionDigest: `sha256:${"a".repeat(64)}`,
    },
    policy: { workspace: "shared-read-only", mutation: "none" },
    budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 },
  });
  assert.equal(compileWorkflowDefinition(good).nodes[0].loop.maxIterations, 3);
  assert.throws(() => compileWorkflowDefinition(definition({ ...good.flow, loop: { ...good.flow.loop, maxIterations: 0 } })), /bounded/);
});

test("plan revision ancestry is exact and every changed revision requires approval", () => {
  const firstDefinition = definition({ kind: "sequence", steps: [agent("inspect")] });
  const first = compileWorkflowDefinition(firstDefinition);
  const secondDefinition = definition({ kind: "sequence", steps: [agent("inspect"), agent("review")] });
  const second = compileWorkflowDefinition(secondDefinition, {
    revision: { number: 1, parentPlanDigest: first.planDigest, reason: "add independent review", activationPolicy: "drain" },
  });
  const diff = diffWorkflowPlans(first, second);
  assert.deepEqual(diff.added, ["review"]);
  assert.equal(diff.approvalRequired, true);
  assert.throws(
    () => diffWorkflowPlans(first, compileWorkflowDefinition(secondDefinition, { revision: { number: 1, parentPlanDigest: `sha256:${"b".repeat(64)}`, reason: "wrong parent" } })),
    /ancestry mismatch/,
  );
});

test("plan digest detects mutation and terminal references must exist", () => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const tampered = structuredClone(plan);
  tampered.nodes[0].assignment.taskTemplateRef = "different";
  assert.deepEqual(validateWorkflowPlan(tampered).errors.map((entry) => entry.code), ["PLAN_DIGEST_MISMATCH"]);
  assert.throws(
    () => compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }, { terminalNodeId: "missing" })),
    /unknown terminal node/,
  );
});
