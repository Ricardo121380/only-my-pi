import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowError, createSingleAgentWorkflowRunner, createWorkflowRegistry } from "../packages/workflow-core/index.mjs";

const root = process.cwd();

function fakeGateRunner() {
  const calls = [];
  return {
    calls,
    plan(id) { return { gateId: id, command: "fixture", args: [], cwd: root, shell: false }; },
    async run(id) { calls.push(id); return { status: "PASS", gateId: id, exitCode: 0, outputBytes: 0, outputDigest: "sha256:" + "0".repeat(64) }; },
  };
}

function fakeAgentExecutor(calls) {
  return async ({ agent, step }) => {
    calls.push({ agent: agent.rawId ?? agent.id, step: step.id });
    return { verdict: "pass", status: "complete", summary: `${agent.rawId ?? agent.id} complete`, changedPaths: [] };
  };
}

test("workflow registry discovers all five runtime workflows and validates references", async () => {
  const gates = fakeGateRunner();
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const result = await registry.discover();
  assert.deepEqual(result.workflows.map((entry) => entry.id), ["debug-fix-verify", "plan-build-review", "research-report", "review-findings", "single-agent-safe"]);
  assert.equal((await registry.doctor()).ok, true);
});

test("single-agent runner executes plan/build/review gates in deterministic order", async () => {
  const gates = fakeGateRunner();
  const agentCalls = [];
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const runner = createSingleAgentWorkflowRunner({ registry, gateRunner: gates, agentExecutor: fakeAgentExecutor(agentCalls) });
  const state = await runner.run("plan-build-review", { runId: "m4-plan-run", input: { goal: "ship" }, conditions: ["profile-resolved", "mode-resolved", "session-idle", "explicit-approval"] });
  assert.equal(state.status, "completed");
  assert.equal(state.verdict, "pass");
  assert.deepEqual(agentCalls.map((entry) => entry.agent), ["planner", "implementer", "reviewer"]);
  assert.deepEqual(gates.calls, ["schema-check", "full-tests"]);
  assert.ok(state.transitions.some((entry) => entry.to === "completed"));
});

test("review workflow cannot acquire a writer agent and gate receipts drive completion", async () => {
  const gates = fakeGateRunner();
  const agentCalls = [];
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const runner = createSingleAgentWorkflowRunner({ registry, gateRunner: gates, agentExecutor: fakeAgentExecutor(agentCalls) });
  const state = await runner.run("review-findings", { runId: "m4-review-run", conditions: ["profile-resolved", "mode-resolved", "session-idle"] });
  assert.equal(state.verdict, "pass");
  assert.deepEqual(agentCalls.map((entry) => entry.agent), ["reviewer"]);
  const reviewer = await runner.agentRegistry?.resolve?.("reviewer");
  assert.equal(reviewer, undefined);
  assert.equal(state.steps.review.result.changedPaths.length, 0);
});

test("runner resumes settled steps and refuses source drift", async () => {
  const gates = fakeGateRunner();
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const calls = [];
  const runner = createSingleAgentWorkflowRunner({ registry, gateRunner: gates, agentExecutor: fakeAgentExecutor(calls) });
  const first = await runner.run("single-agent-safe", { runId: "m4-resume-run", conditions: ["profile-resolved", "mode-resolved", "session-idle"] });
  assert.equal(first.verdict, "pass");
  await assert.rejects(() => runner.resume(first.runId, { sourceHash: "sha256:" + "f".repeat(64) }), (error) => error instanceof WorkflowError && error.code === "WORKFLOW_SOURCE_STALE");
  const resumed = await runner.resume(first.runId, { conditions: ["profile-resolved", "mode-resolved", "session-idle"] });
  assert.equal(resumed.verdict, "pass");
  assert.equal(calls.length, 1);
});

test("runner reports unavailable child execution as blocked without inventing a live agent", async () => {
  const gates = fakeGateRunner();
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const runner = createSingleAgentWorkflowRunner({ registry, gateRunner: gates });
  const state = await runner.run("single-agent-safe", { runId: "m4-unavailable-run", conditions: ["profile-resolved", "mode-resolved", "session-idle"] });
  assert.equal(state.verdict, "blocked");
  assert.equal(state.status, "failed");
  assert.equal(state.steps.inspect.result.code, "AGENT_EXECUTOR_UNAVAILABLE");
});

test("cancel aborts the active parent stage and settles a durable cancelled state", async () => {
  const gates = fakeGateRunner();
  const registry = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  let started;
  const agentExecutor = ({ signal }) => new Promise((resolve, reject) => {
    started = true;
    const abort = () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
  });
  const runner = createSingleAgentWorkflowRunner({ registry, gateRunner: gates, agentExecutor });
  const pending = runner.run("plan-build-review", { runId: "m4-cancel-run", input: { goal: "stop" }, conditions: ["profile-resolved", "mode-resolved", "session-idle", "explicit-approval"] });
  while (!started) await new Promise((resolve) => setImmediate(resolve));
  const request = await runner.cancel("m4-cancel-run");
  assert.equal(request.status, "CANCEL_REQUESTED");
  const state = await pending;
  assert.equal(state.status, "cancelled");
  assert.equal(state.verdict, "cancelled");
  assert.equal(state.steps.plan.status, "cancelled");
  assert.deepEqual(gates.calls, []);
});
