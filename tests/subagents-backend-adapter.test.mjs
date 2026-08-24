import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  activeBackendBinding,
  bindBackendRun,
  createAgentRunHandle,
  createAgentTemplate,
  createResolvedAgentSpec,
  createTaskAssignment,
  digestValue,
  SubagentsError,
} from "../packages/subagents/domain/index.mjs";
import {
  assertExactPiSubagentsRpcV1Ping,
  compileAgentAssignmentToPiSpawnRequest,
  createPiSubagentsRpcV1Backend,
  createPiSubagentsRpcV1CapabilityMatrix,
  createPiSubagentsAdapterCompatibility,
  PI_SUBAGENTS_RPC_V1_EVENTS,
  PI_SUBAGENTS_RPC_V1_METHODS,
  PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES,
} from "../packages/subagents/adapters/pi-subagents-rpc-v1/index.mjs";
import { createPiSubagentsBatchItemExecutor } from "../packages/subagents/batch-swarm/pi-item-executor.mjs";

function domainFixture({ taskText = "Read the requested files and return a verdict." } = {}) {
  const template = createAgentTemplate({
    id: "reviewer",
    version: "1.0.0",
    backendAgentId: "omp-reviewer",
    sourceHash: digestValue("reviewer-source"),
    promptHash: digestValue("reviewer-prompt"),
    tools: { allow: ["read", "grep"], deny: ["bash", "edit", "write"] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "read-only",
      mutation: "none",
      approval: "ask",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "review",
    outputSchema: { type: "object", required: ["verdict"] },
    writer: false,
    continuable: true,
    resumable: true,
    timeoutSeconds: 60,
  });
  const agentSpec = createResolvedAgentSpec({
    template,
    id: "reviewer-resolved",
    effectivePolicy: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "allow-listed", extension: "deny" },
    },
  });
  const assignment = createTaskAssignment({
    assignmentId: "review-01",
    agentSpec,
    task: taskText,
    ownership: { writer: false, workspace: "read-only", allowedPaths: ["src/index.mjs"] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: [] },
  });
  const handle = createAgentRunHandle({
    runId: "run-01",
    nodeId: "review-node",
    attemptId: "attempt-01",
    assignment,
    agentSpec,
  });
  return { template, agentSpec, assignment, handle };
}

function pingData() {
  return {
    version: 1,
    methods: [...PI_SUBAGENTS_RPC_V1_METHODS],
    capabilities: structuredClone(PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES),
    events: structuredClone(PI_SUBAGENTS_RPC_V1_EVENTS),
    session: { fixture: true },
  };
}

function reply(envelope, data = {}) {
  return { version: 1, requestId: envelope.requestId, success: true, data };
}

function terminalEvidence(runId, { state = "completed", success = true, proofState = "observed" } = {}) {
  return {
    completion: {
      runId,
      state,
      success,
      results: [{ nodeId: "review-01", status: state, result: { verdict: success ? "pass" : "fail" } }],
    },
    processTerminal: proofState === null ? null : {
      version: 1,
      state: proofState,
      runId,
      runnerProcessInstanceId: "runner-01",
      ...(proofState === "observed"
        ? { observedAt: 200, instances: [{ processInstanceId: "runner-01", exitCode: 0 }] }
        : { reason: "observer-unavailable" }),
    },
  };
}

function createFixtureTransport({
  runIds = ["backend-run-01", "backend-run-02"],
  waitForTerminal,
  spawnData,
} = {}) {
  const calls = [];
  let runIndex = 0;
  const transport = {
    calls,
    async request(envelope) {
      calls.push(structuredClone(envelope));
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn" || envelope.method === "resume") {
        const runId = runIds[Math.min(runIndex++, runIds.length - 1)];
        return reply(envelope, envelope.method === "spawn" && spawnData !== undefined
          ? spawnData
          : { text: `accepted:${runId}`, details: { runId, asyncId: runId } });
      }
      return reply(envelope, { ok: true, state: envelope.method === "stop" ? "stopping" : "accepted" });
    },
  };
  if (waitForTerminal !== false) {
    transport.waitForTerminal = waitForTerminal ?? (async ({ runId }) => terminalEvidence(runId));
  }
  return transport;
}

function createBackend(transport, options = {}) {
  let sequence = 0;
  let now = 100;
  return createPiSubagentsRpcV1Backend({
    transport,
    idFactory: (prefix) => `${prefix}-fixture-${++sequence}`,
    clock: () => ++now,
    timeoutMs: 100,
    terminalTimeoutMs: 100,
    ...options,
  });
}

test("exact 0.45.2 ping and BackendCapabilityV2 fail closed on drift", () => {
  const ping = assertExactPiSubagentsRpcV1Ping(pingData());
  assert.match(ping.capabilityHash, /^sha256:/u);
  assert.equal(ping.events.asyncComplete, "subagent:async-complete");
  assert.throws(
    () => assertExactPiSubagentsRpcV1Ping({ ...pingData(), capabilities: { ...pingData().capabilities, asyncSpawn: false } }),
    (error) => error instanceof SubagentsError && error.code === "PI_SUBAGENTS_CAPABILITY_DRIFT",
  );

  const observable = createPiSubagentsRpcV1CapabilityMatrix({ terminalTransport: true });
  assert.equal(observable.capabilities.background.state, "SUPPORTED");
  assert.equal(observable.capabilities.foreground.state, "DEGRADED");
  assert.equal(observable.capabilities.status.state, "DEGRADED");
  assert.equal(observable.capabilities.rateLimitSignal.state, "UNAVAILABLE");
  assert.equal(observable.capabilities.dynamicConcurrency.state, "UNAVAILABLE");
  const blind = createPiSubagentsRpcV1CapabilityMatrix({ terminalTransport: false });
  assert.equal(blind.capabilities.foreground.state, "UNAVAILABLE");
  assert.equal(blind.capabilities.background.state, "UNAVAILABLE");
  assert.equal(blind.capabilities.processTerminalProof.state, "UNAVAILABLE");
});

test("compiler emits a statement body and JSON-safe invocation, never raw executable task text", async () => {
  const dangerous = `Review x\"); throw new Error(\"injected\"); //\u2028then finish`;
  const fixture = domainFixture({ taskText: dangerous });
  const compiled = compileAgentAssignmentToPiSpawnRequest({
    agentSpec: fixture.agentSpec,
    assignment: fixture.assignment,
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
  });
  assert.equal(compiled.params.async, true);
  assert.match(compiled.params.workflowScript, /^return await runs\.run\(/u);
  assert.doesNotMatch(compiled.params.workflowScript, /export default|ctx\.execute/u);
  assert.doesNotMatch(compiled.params.workflowScript, /\u2028/u);

  const observed = [];
  const AsyncFunction = Object.getPrototypeOf(async function fixtureFunction() {}).constructor;
  const execute = new AsyncFunction("runs", compiled.params.workflowScript);
  await execute({
    async run(name, invocation) {
      observed.push({ name, invocation });
      return { ok: true };
    },
  });
  assert.equal(observed.length, 1);
  assert.equal(observed[0].name, `assignment-${fixture.assignment.assignmentHash.slice(7, 39)}`);
  assert.match(observed[0].name, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
  assert.equal(observed[0].name.includes(":"), false);
  assert.equal(observed[0].invocation.agent, "omp-reviewer");
  assert.equal(observed[0].invocation.task, dangerous);
  assert.deepEqual(observed[0].invocation.outputSchema, { type: "object", required: ["verdict"] });

  const detached = compileAgentAssignmentToPiSpawnRequest({
    agentSpec: fixture.agentSpec,
    assignment: fixture.assignment,
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
    childAsync: true,
  });
  const detachedObserved = [];
  await new AsyncFunction("runs", detached.params.workflowScript)({
    async run(name, invocation) {
      detachedObserved.push({ name, invocation });
      return { ok: true };
    },
  });
  assert.equal(detached.childAsync, true);
  assert.equal(detached.source.childLifecycle, "detached-async");
  assert.equal(detachedObserved[0].invocation.async, true);
});

test("compiler rejects unenforceable tool narrowing and unproven writer worktrees before spawn", () => {
  const fixture = domainFixture();
  const narrowedSpec = createResolvedAgentSpec({
    template: fixture.template,
    id: "narrowed-reviewer",
    tools: { allow: ["read"], deny: ["grep"] },
  });
  const narrowedAssignment = createTaskAssignment({
    assignmentId: "narrowed-review-01",
    agentSpec: narrowedSpec,
    task: "Review with the narrowed tool set.",
    ownership: { writer: false, workspace: "shared-read-only" },
  });
  assert.throws(
    () => compileAgentAssignmentToPiSpawnRequest({
      agentSpec: narrowedSpec,
      assignment: narrowedAssignment,
      capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
    }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_TOOLOVERLAY_UNAVAILABLE",
  );

  const writerTemplate = createAgentTemplate({
    id: "implementer",
    version: "1.0.0",
    backendAgentId: "omp-implementer",
    sourceHash: digestValue("implementer-source"),
    promptHash: digestValue("implementer-prompt"),
    tools: { allow: ["read", "edit", "write"], deny: [] },
    requiredCapabilities: ["workspace-write"],
    policyCeiling: {
      workspace: "managed-worktree",
      mutation: "guarded",
      approval: "ask",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "build",
    writer: true,
    continuable: true,
    resumable: true,
    timeoutSeconds: 60,
  });
  const writerSpec = createResolvedAgentSpec({ template: writerTemplate, id: "implementer-resolved" });
  const writerAssignment = createTaskAssignment({
    assignmentId: "implement-01",
    agentSpec: writerSpec,
    task: "Apply the approved patch.",
    ownership: {
      writer: true,
      workspace: "managed-worktree",
      allowedPaths: ["src/index.mjs"],
      fileClaims: ["src/index.mjs"],
      baseCommit: "0123456789abcdef0123456789abcdef01234567",
    },
  });
  assert.throws(
    () => compileAgentAssignmentToPiSpawnRequest({
      agentSpec: writerSpec,
      assignment: writerAssignment,
      capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
      allowWorktree: true,
    }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_WORKTREE_DEGRADED",
  );
  const protectedWriter = compileAgentAssignmentToPiSpawnRequest({
    agentSpec: writerSpec,
    assignment: writerAssignment,
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
    allowWorktree: true,
    allowProtectedWorktreeProbe: true,
  });
  assert.match(protectedWriter.params.workflowScript, /"worktree":true/u);
  assert.equal(protectedWriter.source.worktreeAdmission, "protected-degraded-probe-v1");
});

test("background launch maps only structured details into a stable handle", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport();
  const backend = createBackend(transport);
  const launched = await backend.launch({ ...fixture, mode: "background" });
  assert.equal(launched.status, "RUNNING");
  assert.equal(launched.handle.handleId, fixture.handle.handleId);
  assert.equal(activeBackendBinding(launched.handle).backendRunId, "backend-run-01");
  assert.deepEqual(transport.calls.map((call) => call.method), ["ping", "spawn"]);
  assert.equal(transport.calls[1].params.async, true);
  assert.equal(transport.calls[1].params.agent, undefined);
  assert.equal(transport.calls[1].params.task, undefined);

  const missing = createBackend(createFixtureTransport({ spawnData: { runId: "untrusted-top-level" } }));
  await assert.rejects(
    () => missing.launch({ ...domainFixture(), mode: "background" }),
    (error) => error instanceof SubagentsError && error.code === "PI_SUBAGENTS_BACKEND_ID_MISSING",
  );
});

test("detached child launch resolves the public workflow root to one process-terminal child", async () => {
  const fixture = domainFixture();
  const emitter = new EventEmitter();
  const calls = [];
  const transport = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async request(envelope) {
      calls.push(structuredClone(envelope));
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn") {
        const key = `assignment-${fixture.assignment.assignmentHash.slice(7, 39)}`;
        queueMicrotask(() => {
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, {
            runId: "workflow-root-01",
            mode: "workflow",
            state: "complete",
            success: true,
            results: [{ agent: key, runId: "detached-child-01", success: true, status: "completed" }],
          });
          const evidence = terminalEvidence("detached-child-01");
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, evidence.completion);
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal, evidence.processTerminal);
        });
        return reply(envelope, { text: "accepted", details: { runId: "workflow-root-01", asyncId: "workflow-root-01" } });
      }
      return reply(envelope, {});
    },
  };
  const backend = createBackend(transport);
  const launched = await backend.launch({ ...fixture, mode: "background", childAsync: true });
  assert.equal(launched.binding.backendRunId, "detached-child-01");
  assert.equal(launched.binding.backendAsyncId, "detached-child-01");
  assert.match(calls[1].params.workflowScript, /"async":true/u);
  const terminal = await backend.awaitTerminal(launched.handle, { bindingId: launched.binding.bindingId });
  assert.equal(terminal.authoritative, true);
  assert.equal(terminal.outcome, "completed");
});

test("foreground is normalized as async spawn plus correlated authoritative terminal receipt", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport();
  const backend = createBackend(transport);
  const result = await backend.launch({ ...fixture, mode: "foreground" });
  assert.equal(result.status, "TERMINAL");
  assert.equal(result.terminal.outcome, "completed");
  assert.equal(result.terminal.authoritative, true);
  assert.equal(result.terminal.backendRunId, "backend-run-01");
  assert.equal(transport.calls[1].params.async, true);
});

test("public event subscription also correlates async-complete with process-terminal proof", async () => {
  const fixture = domainFixture();
  const emitter = new EventEmitter();
  const calls = [];
  const transport = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    waitForTerminal: async () => new Promise(() => {}),
    async request(envelope) {
      calls.push(structuredClone(envelope));
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn") {
        queueMicrotask(() => {
          const evidence = terminalEvidence("event-run-01");
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, {
            ...evidence.completion,
            runId: undefined,
            asyncId: "event-async-01",
          });
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal, evidence.processTerminal);
        });
        return reply(envelope, { text: "accepted", details: { runId: "event-run-01", asyncId: "event-async-01" } });
      }
      return reply(envelope, {});
    },
  };
  const backend = createBackend(transport);
  const result = await backend.launch({ ...fixture, mode: "foreground" });
  assert.equal(result.terminal.outcome, "completed");
  assert.equal(result.terminal.authoritative, true);
  assert.deepEqual(calls.map((call) => call.method), ["ping", "spawn"]);
});

test("a transport without terminal observation fails before spawn or terminal control RPC", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport({ waitForTerminal: false });
  const backend = createBackend(transport);
  await assert.rejects(
    () => backend.launch({ ...fixture, mode: "background" }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_BACKGROUND_UNAVAILABLE",
  );
  const bound = bindBackendRun(fixture.handle, {
    backendId: "pi-subagents-rpc-v1",
    backendVersion: "0.45.2",
    protocolVersion: 1,
    lifecycle: "launch",
    requestId: "existing-request",
    backendRunId: "existing-run",
  });
  await assert.rejects(
    () => backend.stop(bound),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_TERMINALEVENTS_UNAVAILABLE",
  );
  await assert.rejects(
    () => backend.interrupt(bound),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_TERMINALEVENTS_UNAVAILABLE",
  );
  await assert.rejects(
    () => backend.resume(bound, { message: "Resume safely.", mode: "foreground" }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_FOREGROUND_UNAVAILABLE",
  );
  assert.deepEqual(transport.calls.map((call) => call.method), ["ping"]);
});

test("status, steer, interrupt, resume, and stop always address explicit backend ids", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport({
    waitForTerminal: async ({ runId }) => terminalEvidence(runId, { state: "stopped", success: false }),
  });
  const backend = createBackend(transport);
  const launched = await backend.launch({ ...fixture, mode: "continuable" });
  await backend.status(launched.handle);
  await backend.steer(launched.handle, "Focus on the failing test.", { mode: "steer", index: 0 });
  await backend.interrupt(launched.handle, { awaitTerminal: false });
  const resumed = await backend.resume(launched.handle, {
    message: "Continue after reviewing the failure.",
    output: "artifacts/review.md",
    outputMode: "file",
    mode: "background",
  });
  assert.equal(resumed.handle.handleId, launched.handle.handleId);
  assert.equal(resumed.handle.backendBindings.length, 2);
  assert.equal(activeBackendBinding(resumed.handle).backendRunId, "backend-run-02");
  await backend.status(resumed.handle);
  const stopped = await backend.stop(resumed.handle);
  assert.equal(stopped.terminal.outcome, "cancelled");
  assert.equal(stopped.terminal.authoritative, true);

  const statusCalls = transport.calls.filter((call) => call.method === "status");
  assert.deepEqual(statusCalls[0].params, { runId: "backend-run-01" });
  assert.deepEqual(statusCalls[1].params, { runId: "backend-run-02" });
  const steer = transport.calls.find((call) => call.method === "steer");
  assert.deepEqual(steer.params, { runId: "backend-run-01", message: "Focus on the failing test.", mode: "steer", index: 0 });
  const interrupt = transport.calls.find((call) => call.method === "interrupt");
  assert.deepEqual(interrupt.params, { runId: "backend-run-01" });
  const resume = transport.calls.find((call) => call.method === "resume");
  assert.deepEqual(resume.params, {
    runId: "backend-run-01",
    message: "Continue after reviewing the failure.",
    output: "artifacts/review.md",
    outputMode: "file",
  });
  assert.deepEqual(transport.calls.find((call) => call.method === "stop").params, { runId: "backend-run-02" });
});

test("resume fails closed when upstream reuses an existing backend id", async () => {
  const fixture = domainFixture();
  const emitter = new EventEmitter();
  const transport = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async request(envelope) {
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn") {
        const prior = terminalEvidence("reused-run");
        queueMicrotask(() => {
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, prior.completion);
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal, prior.processTerminal);
        });
        return reply(envelope, { text: "accepted", details: { runId: "reused-run" } });
      }
      if (envelope.method === "resume") {
        const latePrior = terminalEvidence("reused-run");
        queueMicrotask(() => {
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, latePrior.completion);
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal, latePrior.processTerminal);
        });
        return reply(envelope, { text: "resumed", details: { runId: "reused-run" } });
      }
      return reply(envelope, {});
    },
  };
  const backend = createBackend(transport);
  const launched = await backend.launch({ ...fixture, mode: "background" });
  await assert.rejects(
    () => backend.resume(launched.handle, { message: "Try again.", mode: "background" }),
    (error) => error instanceof SubagentsError && error.code === "PI_SUBAGENTS_BACKEND_ID_REUSE",
  );
});

test("late terminal evidence for the pre-resume id cannot settle the new binding", async () => {
  const fixture = domainFixture();
  const emitter = new EventEmitter();
  const transport = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async request(envelope) {
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn") return reply(envelope, { text: "accepted", details: { runId: "old-run" } });
      if (envelope.method === "resume") {
        const latePrior = terminalEvidence("old-run");
        queueMicrotask(() => {
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, latePrior.completion);
          emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal, latePrior.processTerminal);
        });
        return reply(envelope, { text: "resumed", details: { runId: "new-run" } });
      }
      return reply(envelope, {});
    },
  };
  const backend = createBackend(transport, { terminalTimeoutMs: 10 });
  const launched = await backend.launch({ ...fixture, mode: "background" });
  const resumed = await backend.resume(launched.handle, { message: "Try again.", mode: "background" });
  const terminal = await backend.awaitTerminal(resumed.handle, { timeoutMs: 10 });
  assert.equal(terminal.backendRunId, "new-run");
  assert.equal(terminal.outcome, "orphaned");
});

test("contradictory event and helper evidence fails correlation instead of being merged", async () => {
  const fixture = domainFixture();
  const emitter = new EventEmitter();
  const transport = {
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    async waitForTerminal({ runId }) {
      return terminalEvidence(runId, { state: "failed", success: false });
    },
    async request(envelope) {
      if (envelope.method === "ping") return reply(envelope, pingData());
      if (envelope.method === "spawn") {
        const eventEvidence = terminalEvidence("conflict-run", { state: "completed", success: true });
        queueMicrotask(() => emitter.emit(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete, eventEvidence.completion));
        return reply(envelope, { text: "accepted", details: { runId: "conflict-run" } });
      }
      return reply(envelope, {});
    },
  };
  const backend = createBackend(transport);
  await assert.rejects(
    () => backend.launch({ ...fixture, mode: "foreground" }),
    (error) => error instanceof SubagentsError && error.code === "PI_SUBAGENTS_TERMINAL_EVENT_CONFLICT",
  );
});

test("stop intent does not overwrite an observed successful completion", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport({
    waitForTerminal: async ({ runId }) => terminalEvidence(runId, { state: "completed", success: true }),
  });
  const backend = createBackend(transport);
  const launched = await backend.launch({ ...fixture, mode: "background" });
  const result = await backend.stop(launched.handle);
  assert.equal(result.terminal.outcome, "completed");
  assert.equal(result.terminal.authoritative, true);
});

test("adapter bounds a hanging terminal helper and returns an orphan receipt", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport({
    waitForTerminal: async () => new Promise(() => {}),
  });
  const backend = createBackend(transport, { terminalTimeoutMs: 10 });
  const result = await backend.launch({ ...fixture, mode: "foreground" });
  assert.equal(result.terminal.outcome, "orphaned");
  assert.equal(result.terminal.authoritative, false);
});

test("unknown or missing process proof can only produce a non-authoritative orphan receipt", async () => {
  for (const proofState of ["unknown", null]) {
    const fixture = domainFixture();
    const transport = createFixtureTransport({
      waitForTerminal: async ({ runId }) => terminalEvidence(runId, { proofState }),
    });
    const backend = createBackend(transport);
    const result = await backend.launch({ ...fixture, mode: "foreground" });
    assert.equal(result.terminal.outcome, "orphaned");
    assert.equal(result.terminal.authoritative, false);
    assert.match(result.terminal.error.code, /^PI_SUBAGENTS_/u);
  }
});

test("BatchSwarm item adapter uses the structured Pi backend and returns correlated terminal proof", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport();
  const backend = createBackend(transport);
  const itemExecutor = createPiSubagentsBatchItemExecutor({ backend });
  const result = await itemExecutor.executeItem({
    runId: "batch-adapter-run",
    nodeId: "review-batch",
    itemId: "item-zero",
    itemAttempt: 1,
    assignment: fixture.assignment,
    agentSpec: fixture.agentSpec,
  });
  assert.equal(result.terminal.outcome, "completed");
  assert.equal(result.terminal.authoritative, true);
  assert.equal(result.handle.local.assignmentHash, fixture.assignment.assignmentHash);
  assert.match(result.handle.local.nodeId, /^batch-item:/u);
  assert.match(result.handle.local.attemptId, /^batch-attempt:/u);
  const spawn = transport.calls.find((call) => call.method === "spawn");
  assert.ok(spawn);
  assert.match(spawn.params.workflowScript, /^return await runs\.run\(/u);
  assert.doesNotMatch(spawn.params.workflowScript, /export default|ctx\.execute/u);
});

test("BatchSwarm item cancellation requires interrupt terminal proof", async () => {
  const fixture = domainFixture();
  const controller = new AbortController();
  let interrupted = 0;
  const backend = {
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix(),
    async launch({ handle }) {
      const boundHandle = bindBackendRun(handle, {
        backendId: "fixture-backend",
        backendVersion: "1.0.0",
        protocolVersion: 1,
        lifecycle: "launch",
        requestId: "fixture-request",
        backendRunId: "fixture-run",
      });
      queueMicrotask(() => controller.abort());
      return { handle: boundHandle, binding: activeBackendBinding(boundHandle) };
    },
    async awaitTerminal() { return new Promise(() => {}); },
    async interrupt() {
      interrupted += 1;
      return { terminal: { outcome: "cancelled", authoritative: true, receiptId: digestValue("cancelled") } };
    },
  };
  const itemExecutor = createPiSubagentsBatchItemExecutor({ backend });
  const result = await itemExecutor.executeItem({
    runId: fixture.handle.local.runId,
    nodeId: "review-batch",
    itemId: "item-zero",
    itemAttempt: 1,
    assignment: fixture.assignment,
    agentSpec: fixture.agentSpec,
    signal: controller.signal,
  });
  assert.equal(interrupted, 1);
  assert.equal(result.terminal.outcome, "cancelled");
  assert.equal(result.terminal.authoritative, true);
});

test("mismatched completion or process proof is rejected instead of being rebound", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport({
    waitForTerminal: async ({ runId }) => ({
      ...terminalEvidence(runId),
      completion: { ...terminalEvidence(runId).completion, runId: "different-run" },
    }),
  });
  const backend = createBackend(transport);
  await assert.rejects(
    () => backend.launch({ ...fixture, mode: "foreground" }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_EVENT_CORRELATION_MISMATCH",
  );
});

test("dispose is idempotent, does not stop children, and compatibility rejects raw legacy scripts", async () => {
  const fixture = domainFixture();
  const transport = createFixtureTransport();
  let transportDisposals = 0;
  transport.dispose = async () => { transportDisposals += 1; };
  const backend = createBackend(transport);
  const compatibility = createPiSubagentsAdapterCompatibility({ backend });
  await assert.rejects(
    () => compatibility.spawn({
      method: "spawn",
      source: { extension: "only-my-pi", kind: "schema-validated-workflow-compiler", schemaValidated: true },
      params: { workflowScript: "return arbitraryHostCode();", async: true },
    }),
    (error) => error instanceof SubagentsError && error.code === "LEGACY_ADAPTER_DOMAIN_INPUT_REQUIRED",
  );
  const launched = await backend.launch({ ...fixture, mode: "background" });
  const first = await backend.dispose();
  const second = await backend.dispose();
  assert.equal(first.stoppedBackendRuns, false);
  assert.deepEqual(second, first);
  assert.equal(transport.calls.some((call) => call.method === "stop"), false);
  assert.equal(transportDisposals, 0);
  await assert.rejects(
    () => backend.status(launched.handle),
    (error) => error instanceof SubagentsError && error.code === "ADAPTER_DISPOSED",
  );
});
