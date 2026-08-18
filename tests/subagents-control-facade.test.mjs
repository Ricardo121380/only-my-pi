import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSwarmControlService } from "../packages/control-service/swarm-service.mjs";
import { createWorkflowControlService } from "../packages/control-service/workflow-service.mjs";
import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";
import { createRunCoordinator } from "../packages/subagents/workflow/run-coordinator/index.mjs";

const root = process.cwd();

function fakeOrchestration() {
  const calls = [];
  return {
    calls,
    async execute(plan, options) {
      calls.push({ method: "execute", plan, options });
      return { runId: options.runId ?? "generated-run", status: "completed", terminal: { status: "completed" } };
    },
    async inspect(runId, plan) {
      calls.push({ method: "inspect", runId, plan });
      return { projection: { runId, status: "completed" } };
    },
    async cancel(runId) {
      calls.push({ method: "cancel", runId });
      return { status: "RUN_NOT_ACTIVE", runId };
    },
  };
}

test("default Workflow and Swarm control services compile legacy resources to v2 without constructing legacy controllers", async () => {
  const workflow = createWorkflowControlService({ rootDir: root });
  const swarm = createSwarmControlService({ rootDir: root });
  assert.equal(workflow.orchestration, null);
  assert.equal(swarm.orchestration, null);
  assert.equal(Object.hasOwn(workflow, "runner"), false);
  assert.equal(Object.hasOwn(swarm, "controller"), false);

  const workflowPlan = await workflow.dispatch({ subcommand: "run", workflowId: "single-agent-safe" });
  assert.equal(workflowPlan.status, "WORKFLOW_PLAN");
  assert.equal(workflowPlan.kind, "legacy-workflow");
  assert.equal(workflowPlan.plan.formatVersion, 1);
  assert.match(workflowPlan.plan.$schema, /workflow-plan-v1\.schema\.json$/);
  assert.equal(workflowPlan.plan.migration, undefined);
  assert.equal(workflowPlan.migration.sourceKind, "workflow-v1");

  const swarmPlan = await swarm.dispatch({ subcommand: "plan", recipeId: "research-synthesis" });
  assert.equal(swarmPlan.status, "SWARM_PLAN");
  assert.equal(swarmPlan.kind, "legacy-workflow");
  assert.equal(swarmPlan.plan.formatVersion, 1);
  assert.match(swarmPlan.plan.$schema, /workflow-plan-v1\.schema\.json$/);
  assert.equal(swarmPlan.migration.sourceKind, "swarm-recipe-v1");

  assert.equal((await workflow.dispatch({ subcommand: "run", workflowId: "single-agent-safe", apply: true })).code, "EXACT_PLAN_CONFIRMATION_REQUIRED");
  assert.equal((await workflow.dispatch({ subcommand: "run", workflowId: "single-agent-safe", apply: true, yes: true })).code, "EXACT_PLAN_DIGEST_REQUIRED");
  assert.equal((await swarm.dispatch({ subcommand: "run", recipeId: "research-synthesis" })).code, "EXACT_PLAN_CONFIRMATION_REQUIRED");
  assert.equal((await swarm.dispatch({ subcommand: "run", recipeId: "research-synthesis", yes: true })).code, "EXACT_PLAN_DIGEST_REQUIRED");
});

test("injected unified orchestration receives immutable WorkflowPlans and owns lifecycle operations", async () => {
  const workflowRuntime = fakeOrchestration();
  const workflow = createWorkflowControlService({ rootDir: root, orchestration: workflowRuntime });
  const workflowPreview = await workflow.dispatch({ subcommand: "run", workflowId: "single-agent-safe" });
  const executed = await workflow.dispatch({
    subcommand: "run",
    workflowId: "single-agent-safe",
    apply: true,
    yes: true,
    expectedPlanDigest: workflowPreview.plan.planDigest,
    expectedExecutionDigest: workflowPreview.executionEnvelope.executionEnvelopeDigest,
    input: workflowPreview.input,
    runId: workflowPreview.runId,
    conditions: ["profile-resolved", "mode-resolved", "session-idle"],
  });
  assert.equal(executed.status, "WORKFLOW_COMPLETED");
  assert.match(workflowRuntime.calls[0].plan.$schema, /workflow-plan-v1\.schema\.json$/);
  assert.equal(Object.isFrozen(workflowRuntime.calls[0].plan), true);
  assert.equal(workflowRuntime.calls[0].options.input, workflowPreview.input);
  assert.equal(Object.isFrozen(workflowRuntime.calls[0].options.input), true);
  assert.equal(workflowRuntime.calls[0].options.executionEnvelope.executionEnvelopeDigest, workflowPreview.executionEnvelope.executionEnvelopeDigest);
  assert.deepEqual(workflowRuntime.calls[0].options.executionEnvelope.target, { kind: "workflow", id: "single-agent-safe" });
  assert.equal((await workflow.dispatch({ subcommand: "status", runId: workflowPreview.runId })).status, "WORKFLOW_STATUS");
  assert.equal((await workflow.dispatch({ subcommand: "cancel", runId: workflowPreview.runId })).status, "WORKFLOW_CANCEL");

  const swarmRuntime = fakeOrchestration();
  const swarm = createSwarmControlService({ rootDir: root, orchestration: swarmRuntime });
  const swarmPreview = await swarm.dispatch({ subcommand: "plan", recipeId: "research-synthesis" });
  const swarmExecuted = await swarm.dispatch({ subcommand: "run", recipeId: "research-synthesis", runId: swarmPreview.runId, yes: true, expectedPlanDigest: swarmPreview.plan.planDigest, expectedExecutionDigest: swarmPreview.executionEnvelope.executionEnvelopeDigest, input: swarmPreview.input });
  assert.equal(swarmExecuted.status, "SWARM_COMPLETED");
  assert.equal(swarmExecuted.kind, "legacy-workflow");
  assert.match(swarmRuntime.calls[0].plan.$schema, /workflow-plan-v1\.schema\.json$/);
  assert.equal(swarmRuntime.calls[0].options.input, swarmPreview.input);
  assert.equal(swarmRuntime.calls[0].options.executionEnvelope.executionEnvelopeDigest, swarmPreview.executionEnvelope.executionEnvelopeDigest);
  assert.deepEqual(swarmRuntime.calls[0].options.executionEnvelope.target, { kind: "swarm", id: "research-synthesis" });
  assert.equal((await swarm.dispatch({ subcommand: "status", runId: swarmPreview.runId })).status, "SWARM_STATUS");
  assert.equal((await swarm.dispatch({ subcommand: "cancel", runId: swarmPreview.runId })).status, "SWARM_CANCEL");
});

test("public control services have no static import of either legacy controller", () => {
  for (const file of [
    "packages/control-service/workflow-service.mjs",
    "packages/control-service/swarm-service.mjs",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /createSingleAgentWorkflowRunner|createSwarmRunController/);
  }
});

test("public control services reject fake coordinators that do not match the RunCoordinator API", () => {
  const legacyShape = { async run() {}, async inspect() {}, async cancel() {} };
  assert.throws(() => createWorkflowControlService({ rootDir: root, orchestration: legacyShape }), /must implement execute/);
  assert.throws(() => createSwarmControlService({ rootDir: root, orchestration: legacyShape }), /must implement execute/);
});

test("public execution rejects a missing or stale confirmed plan digest before coordinator dispatch", async () => {
  const workflowRuntime = fakeOrchestration();
  const workflow = createWorkflowControlService({ rootDir: root, orchestration: workflowRuntime });
  const workflowPreview = await workflow.dispatch({ subcommand: "run", workflowId: "single-agent-safe" });
  const workflowStale = await workflow.dispatch({
    subcommand: "run",
    workflowId: "single-agent-safe",
    apply: true,
    yes: true,
    expectedPlanDigest: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(workflowStale.status, "WORKFLOW_PLAN_STALE");
  assert.equal(workflowStale.code, "PLAN_DIGEST_MISMATCH");
  assert.equal(workflowStale.currentPlanDigest, workflowPreview.plan.planDigest);
  assert.equal(workflowRuntime.calls.length, 0);

  const workflowUnbound = await workflow.dispatch({
    subcommand: "run",
    workflowId: "single-agent-safe",
    apply: true,
    yes: true,
    expectedPlanDigest: workflowPreview.plan.planDigest,
    input: workflowPreview.input,
  });
  assert.equal(workflowUnbound.code, "EXACT_EXECUTION_ENVELOPE_REQUIRED");
  assert.equal(workflowRuntime.calls.length, 0);

  const swarmRuntime = fakeOrchestration();
  const swarm = createSwarmControlService({ rootDir: root, orchestration: swarmRuntime });
  const swarmPreview = await swarm.dispatch({ subcommand: "plan", recipeId: "research-synthesis" });
  const swarmStale = await swarm.dispatch({
    subcommand: "run",
    recipeId: "research-synthesis",
    yes: true,
    expectedPlanDigest: `sha256:${"f".repeat(64)}`,
  });
  assert.equal(swarmStale.status, "SWARM_PLAN_STALE");
  assert.equal(swarmStale.code, "PLAN_DIGEST_MISMATCH");
  assert.equal(swarmStale.currentPlanDigest, swarmPreview.plan.planDigest);
  assert.equal(swarmRuntime.calls.length, 0);
});

test("Workflow execution allocates a unique run id instead of reusing the workflow id", async () => {
  const orchestration = fakeOrchestration();
  const service = createWorkflowControlService({ rootDir: root, orchestration });
  const preview = await service.dispatch({ subcommand: "run", workflowId: "single-agent-safe" });
  const result = await service.dispatch({
    subcommand: "run",
    workflowId: "single-agent-safe",
    runId: preview.runId,
    apply: true,
    yes: true,
    expectedPlanDigest: preview.plan.planDigest,
    expectedExecutionDigest: preview.executionEnvelope.executionEnvelopeDigest,
    input: preview.input,
  });
  assert.match(result.state.runId, /^workflow-[a-f0-9-]{36}$/u);
  assert.notEqual(result.state.runId, "single-agent-safe");
});

test("control projections preserve explicit awaiting-approval instead of reporting execution failure", async () => {
  const orchestration = {
    async execute() { return { runId: "approval-control-run", status: "awaiting-approval" }; },
    async inspect() { return { projection: { status: "awaiting-approval" } }; },
    async cancel(runId) { return { status: "RUN_NOT_ACTIVE", runId }; },
  };
  const workflow = createWorkflowControlService({ rootDir: root, orchestration });
  const workflowPreview = await workflow.dispatch({ subcommand: "run", workflowId: "plan-build-review", conditions: ["profile-resolved", "mode-resolved", "session-idle", "explicit-approval"] });
  assert.equal((await workflow.dispatch({ subcommand: "run", workflowId: "plan-build-review", apply: true, yes: true, expectedPlanDigest: workflowPreview.plan.planDigest, expectedExecutionDigest: workflowPreview.executionEnvelope.executionEnvelopeDigest, input: workflowPreview.input, runId: workflowPreview.runId, conditions: ["profile-resolved", "mode-resolved", "session-idle", "explicit-approval"] })).status, "WORKFLOW_AWAITING_APPROVAL");
  const swarm = createSwarmControlService({ rootDir: root, orchestration });
  const swarmPreview = await swarm.dispatch({ subcommand: "plan", recipeId: "coding-guarded" });
  assert.equal((await swarm.dispatch({ subcommand: "run", recipeId: "coding-guarded", yes: true, expectedPlanDigest: swarmPreview.plan.planDigest, expectedExecutionDigest: swarmPreview.executionEnvelope.executionEnvelopeDigest, input: swarmPreview.input, runId: swarmPreview.runId })).status, "SWARM_AWAITING_APPROVAL");
});

test("a migrated v1 Workflow executes through the real unified RunCoordinator contract", async (t) => {
  const stateRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-control-facade-"));
  t.after(() => fsp.rm(stateRoot, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 18);
  let sequence = 0;
  const clock = () => new Date(now += 5);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir: stateRoot, filesystem: fsp, clock, idFactory });
  let plan;
  const budgetLedger = createBudgetLedger({
    eventJournal,
    envelope: () => plan.budget,
    metering: () => ({ tokens: false, cost: false }),
  });
  const coordinator = createRunCoordinator({
    eventJournal,
    budgetLedger,
    clock: () => now,
    idFactory,
    nodeExecutor: {
      async runAgent(node, context) {
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { verdict: "pass" } };
      },
    },
    gateRunner: { async run() { return { status: "PASS", digest: "sha256:gate" }; } },
  });
  const service = createWorkflowControlService({ rootDir: root, orchestration: coordinator });
  const preview = await service.dispatch({ subcommand: "run", workflowId: "single-agent-safe", runId: "real-facade-run" });
  plan = preview.plan;
  const result = await service.dispatch({
    subcommand: "run",
    workflowId: "single-agent-safe",
    runId: "real-facade-run",
    apply: true,
    yes: true,
    expectedPlanDigest: preview.plan.planDigest,
    expectedExecutionDigest: preview.executionEnvelope.executionEnvelopeDigest,
    input: preview.input,
    conditions: ["profile-resolved", "mode-resolved", "session-idle"],
  });
  assert.equal(result.status, "WORKFLOW_COMPLETED", JSON.stringify(result.state));
  assert.equal((await eventJournal.verify("real-facade-run")).snapshot.state.status, "completed");
});
