import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createAgentRegistry } from "../packages/agent-registry/index.mjs";
import {
  agentTemplateFromRegistryEntry,
  createAgentRunHandle,
  createResolvedAgentSpec,
  createTaskAssignment,
} from "../packages/subagents/domain/index.mjs";
import {
  compileAgentAssignmentToPiDelegationRequest,
  createPiSubagentsDelegationV1Backend,
  PI_SUBAGENTS_DELEGATION_V1_EVENTS,
} from "../packages/subagents/adapters/pi-subagents-delegation-v1/index.mjs";
import {
  createPiBatchSwarmRuntime,
  digestBatchSwarmDefinition,
} from "../packages/subagents/index.mjs";
import { terminalUsage } from "../packages/subagents/release/live-evidence-extension.mjs";

function transport() {
  const events = new EventEmitter();
  const emitted = [];
  return {
    emitted,
    subscribe(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
    emit(name, value) { emitted.push({ name, value }); queueMicrotask(() => events.emit(name, value)); },
    deliver(name, value) { queueMicrotask(() => events.emit(name, value)); },
  };
}

async function domain() {
  const registry = createAgentRegistry({ rootDir: process.cwd() });
  const entry = await registry.resolve("reviewer");
  const agentSpec = createResolvedAgentSpec({ template: agentTemplateFromRegistryEntry(entry), id: "delegation-reviewer" });
  const assignment = createTaskAssignment({
    assignmentId: "delegation-assignment",
    agentSpec,
    task: "Review the synthetic fixture without mutation.",
    ownership: { writer: false, workspace: "shared-read-only", allowedPaths: [] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: [] },
    budget: { maxElapsedMs: 60_000, maxOutputBytes: 65_536, maxTokens: 2_000, maxCostUsd: 1 },
  });
  const handle = createAgentRunHandle({ runId: "delegation-run", nodeId: "delegation-node", attemptId: "delegation-attempt", assignment, agentSpec });
  return { entry, agentSpec, assignment, handle };
}

function response(request, overrides = {}) {
  return {
    requestId: request.requestId,
    ownerRunId: request.ownerRunId,
    nodeId: request.nodeId,
    status: "completed",
    runId: "upstream-child-run",
    agent: request.agent,
    exitCode: 0,
    result: { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } },
    usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 0, durationMs: 50 },
    ...overrides,
  };
}

test("delegation compiler binds read-only domain objects and exposes no raw workflowScript", async () => {
  const values = await domain();
  const compiled = compileAgentAssignmentToPiDelegationRequest({ ...values, cwd: "/fixture", model: "provider/model" });
  assert.equal(compiled.request.agent, "omp-reviewer");
  assert.equal(compiled.request.context, "fresh");
  assert.equal(compiled.request.model, "provider/model");
  assert.equal(compiled.request.result.kind, "structured");
  assert.deepEqual(compiled.request.toolBudget.block, ["bash", "edit", "write", "web", "web_search", "source_check", "fetch_content", "get_search_content"]);
  assert.equal(Object.hasOwn(compiled.request, "workflowScript"), false);
  const lifecycleOnly = compileAgentAssignmentToPiDelegationRequest({ ...values, cwd: "/fixture", maximumToolCalls: 0 });
  assert.deepEqual(lifecycleOnly.request.toolBudget, {
    hard: 1,
    block: ["bash", "edit", "find", "grep", "ls", "read", "web", "write"],
  });
  assert.match(lifecycleOnly.request.task, /^Do not call file, network, shell, or delegation tools\./u);
  assert.match(lifecycleOnly.request.task, /only permitted tool call is the final structured_output/u);
  const metered = compileAgentAssignmentToPiDelegationRequest({ ...values, cwd: "/fixture", thinking: "high", maximumTurns: 8, maximumToolCalls: 16 });
  assert.equal(metered.request.thinking, "high");
  assert.deepEqual(metered.request.turnBudget, { maxTurns: 8 });
  assert.equal(metered.request.toolBudget.hard, 16);
  assert.throws(() => compileAgentAssignmentToPiDelegationRequest({ ...values, cwd: "/fixture", assignment: { ...values.assignment, ownership: { ...values.assignment.ownership, writer: true } } }), /read-only/u);
});

test("delegation backend creates an authoritative terminal only from correlated exit and usage", async () => {
  const values = await domain();
  const wire = transport();
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture", clock: (() => { let now = 100; return () => ++now; })() });
  const launching = backend.launch({ ...values, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const request = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  const launched = await launching;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.update, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, runId: "upstream-child-run" });
  assert.equal((await backend.waitForChildStart(launched.handle)).runId, "upstream-child-run");
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(request));
  const terminal = await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId });
  assert.equal(terminal.authoritative, true);
  assert.equal(terminal.outcome, "completed");
  assert.equal(terminal.processTerminal.instances[0].observationSource, "pi-subagents-structured-delegation-terminal-response");
  assert.equal(terminal.completion.usage.total, 15);
  assert.deepEqual(terminalUsage(terminal, 65_536), { rawOutputBytes: 60, tokens: 15, costUsd: 0.001 });
  await backend.dispose();
});

test("delegation budget exhaustion retains an explicit stable error code", async () => {
  const values = await domain();
  const wire = transport();
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture" });
  const launching = backend.launch({ ...values, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const request = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  const launched = await launching;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(request, { status: "turn_budget_exhausted", exitCode: 0, result: undefined }));
  const terminal = await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId });
  assert.equal(terminal.outcome, "budget-exhausted");
  assert.equal(terminal.error.code, "DELEGATION_CHILD_BUDGET_EXHAUSTED");
  await backend.dispose();
});

test("delegation structured-output failure remains distinguishable from a generic child failure", async () => {
  const values = await domain();
  const wire = transport();
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture" });
  const launching = backend.launch({ ...values, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const request = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  const launched = await launching;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(request, { status: "structured_output_failed", exitCode: 1, result: undefined }));
  const terminal = await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId });
  assert.equal(terminal.outcome, "failed");
  assert.equal(terminal.error.code, "DELEGATION_STRUCTURED_OUTPUT_FAILED");
  await backend.dispose();
});

test("generic delegation failure exposes only a fixed classified code, never upstream error text", async () => {
  const values = await domain();
  const wire = transport();
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture" });
  const launching = backend.launch({ ...values, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const request = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  const launched = await launching;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(request, { status: "failed", exitCode: 1, result: undefined, error: "Structured JSON schema failed at /private/path with secret value" }));
  const terminal = await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId });
  assert.equal(terminal.error.code, "DELEGATION_CHILD_FAILED_STRUCTURED_OUTPUT");
  assert.doesNotMatch(JSON.stringify(terminal.error), /private|secret value/u);
  await backend.dispose();
});

test("delegation cancel is identity-correlated and cannot forge terminal without exit proof", async () => {
  const values = await domain();
  const wire = transport();
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture" });
  const launching = backend.launch({ ...values, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const request = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  const launched = await launching;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.update, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, runId: "upstream-child-run" });
  await backend.waitForChildStart(launched.handle);
  const cancelling = backend.interrupt(launched.handle);
  await new Promise((resolve) => setImmediate(resolve));
  const cancel = wire.emitted.find((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.cancel).value;
  assert.deepEqual(cancel, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(request, { status: "cancelled", exitCode: 130, result: undefined }));
  const cancelled = await cancelling;
  assert.equal(cancelled.terminal.outcome, "cancelled");
  assert.equal(cancelled.terminal.authoritative, true);

  const secondValues = await domain();
  const secondHandle = createAgentRunHandle({
    runId: secondValues.handle.local.runId,
    nodeId: secondValues.handle.local.nodeId,
    attemptId: "delegation-attempt-two",
    assignment: secondValues.assignment,
    agentSpec: secondValues.agentSpec,
  });
  const secondLaunch = backend.launch({ ...secondValues, handle: secondHandle, mode: "background" });
  await new Promise((resolve) => setImmediate(resolve));
  const secondRequest = wire.emitted.filter((entry) => entry.name === PI_SUBAGENTS_DELEGATION_V1_EVENTS.request).at(-1).value;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, { requestId: secondRequest.requestId, ownerRunId: secondRequest.ownerRunId, nodeId: secondRequest.nodeId });
  const second = await secondLaunch;
  wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(secondRequest, { exitCode: undefined }));
  await assert.rejects(() => backend.awaitTerminal(second.handle), { code: "DELEGATION_PROCESS_TERMINAL_UNAVAILABLE" });
  await backend.dispose();
});

test("homogeneous BatchSwarm uses two delegation children and preserves metered usage", async () => {
  const wire = transport();
  const originalEmit = wire.emit.bind(wire);
  wire.emit = (name, value) => {
    originalEmit(name, value);
    if (name !== PI_SUBAGENTS_DELEGATION_V1_EVENTS.request) return;
    queueMicrotask(() => wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, {
      requestId: value.requestId, ownerRunId: value.ownerRunId, nodeId: value.nodeId,
    }));
    queueMicrotask(() => wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.update, {
      requestId: value.requestId, ownerRunId: value.ownerRunId, nodeId: value.nodeId, runId: `child-${value.nodeId}`,
    }));
    queueMicrotask(() => wire.deliver(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, response(value, { runId: `child-${value.nodeId}` })));
  };
  const backend = createPiSubagentsDelegationV1Backend({ transport: wire, cwd: "/fixture" });
  const runtime = createPiBatchSwarmRuntime({
    backend,
    rootDir: process.cwd(),
    resolveItems: async () => [
      { itemId: "one", scope: ["package.json"], objective: "review" },
      { itemId: "two", scope: ["README.md"], objective: "review" },
    ],
  });
  const definition = (await runtime.registry.resolve("review-items")).definition;
  const result = await runtime.nodeExecutor.runBatch({
    id: "delegation-batch-node",
    kind: "batch-swarm",
    batchRef: definition.id,
    batchDigest: digestBatchSwarmDefinition(definition),
    batchMaxItems: definition.maxItems,
    batchMaxAttempts: definition.retryPolicy.maxAttempts,
    budget: { maxAttempts: 1, timeoutMs: 60_000, maxOutputBytes: 65_536, maxTokens: 4_000, maxCostUsd: 1 },
  }, {
    runId: "delegation-batch-run",
    attemptId: "delegation-batch-attempt",
    input: { artifacts: { items: [] } },
    inputDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assert.equal(result.outcome, "completed");
  assert.equal(result.result.succeeded, 2);
  assert.equal(result.usage.tokens, 30);
  assert.equal(result.usage.costUsd, 0.002);
  await backend.dispose();
});
