import assert from "node:assert/strict";
import test from "node:test";

import * as subagents from "../packages/subagents/index.mjs";

test("the unified facade exposes typed Agent and Workflow APIs without a raw workflow-script surface", async () => {
  for (const name of [
    "createSubagentsFacade",
    "createAgentTemplate",
    "createResolvedAgentSpec",
    "createTaskAssignment",
    "createAgentRunHandle",
    "createPiSubagentsRpcV1Backend",
    "createBatchSwarmNodeExecutor",
    "createBatchSwarmRegistry",
    "createPiSubagentsBatchItemExecutor",
    "createPiBatchSwarmRuntime",
    "compileWorkflowDefinition",
    "createRunCoordinator",
    "createEventJournal",
    "createPlanStore",
    "createBudgetLedger",
    "createApprovalReceipt",
    "createApprovalVerifier",
  ]) assert.equal(typeof subagents[name], "function", `${name} must be exported`);

  assert.equal(Object.hasOwn(subagents, "createPiSubagentsAdapter"), false);
  assert.equal(Object.hasOwn(subagents, "compileWorkflowScript"), false);

  const facade = subagents.createSubagentsFacade();
  assert.equal(facade.apiVersion, 2);
  assert.equal(facade.owner, "@only-my-pi/subagents");
  assert.equal(facade.physicalRuntimeOwner, "pi-subagents");
  assert.equal(facade.agent.capabilities().backendId, "unconfigured");
  assert.throws(() => facade.agent.launch({ workflowScript: "return 1" }), {
    code: "SUBAGENTS_BACKEND_UNAVAILABLE",
  });
  assert.throws(() => facade.workflow(), { code: "WORKFLOW_RUNTIME_UNAVAILABLE" });
  assert.deepEqual(await facade.agent.dispose(), { status: "DISPOSED", stoppedBackendRuns: false });
});

test("facade forwards only domain-correlated lifecycle operations to its injected backend", async () => {
  const calls = [];
  const backend = {
    capabilityMatrix: { formatVersion: 2, backendId: "fixture" },
    async ensureReady(value) { calls.push(["ensureReady", value]); return { ok: true }; },
    async launch(value) { calls.push(["launch", value]); return { status: "RUNNING" }; },
    async status(handle, value) { calls.push(["status", handle, value]); return { status: "running" }; },
    async steer(handle, message, value) { calls.push(["steer", handle, message, value]); return { ok: true }; },
    async interrupt(handle, value) { calls.push(["interrupt", handle, value]); return { ok: true }; },
    async stop(handle, value) { calls.push(["stop", handle, value]); return { ok: true }; },
    async resume(handle, value) { calls.push(["resume", handle, value]); return { ok: true }; },
    async dispose() { calls.push(["dispose"]); return { status: "DISPOSED" }; },
  };
  const facade = subagents.createSubagentsFacade({ backend });
  const handle = Object.freeze({ kind: "agent-run-handle" });
  const launch = Object.freeze({ handle, agentSpec: {}, assignment: {} });
  assert.deepEqual(await facade.agent.negotiate({ signal: null }), { ok: true });
  assert.deepEqual(await facade.agent.launch(launch), { status: "RUNNING" });
  await facade.agent.status(handle, {});
  await facade.agent.steer(handle, "narrow update", {});
  await facade.agent.interrupt(handle, {});
  await facade.agent.stop(handle, {});
  await facade.agent.resume(handle, { message: "continue" });
  await facade.agent.dispose();
  assert.deepEqual(calls.map(([name]) => name), [
    "ensureReady", "launch", "status", "steer", "interrupt", "stop", "resume", "dispose",
  ]);
});

test("facade forwards the live approval evidence provider into its unified coordinator", () => {
  const approvalEvidenceProvider = async () => ({
    repo: null,
    capabilityEnvelopeHash: null,
  });
  const facade = subagents.createSubagentsFacade({
    eventJournal: { async append() {} },
    budgetLedger: { async reserve() {} },
    nodeExecutor: {},
    approvalEvidenceProvider,
  });
  const coordinator = facade.workflow();
  assert.equal(coordinator.approvalEvidenceProvider, approvalEvidenceProvider);
});
