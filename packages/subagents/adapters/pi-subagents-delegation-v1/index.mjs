import {
  activeBackendBinding,
  bindBackendRun,
  createBackendCapabilityV2,
  createTerminalReceipt,
  digestValue,
  immutable,
  SubagentsError,
} from "../../domain/index.mjs";

export const PI_SUBAGENTS_DELEGATION_V1_BACKEND_ID = "pi-subagents-delegation-v1";
export const PI_SUBAGENTS_DELEGATION_V1_BACKEND_VERSION = "0.45.2";
export const PI_SUBAGENTS_DELEGATION_V1_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_DELEGATION_V1_EVENTS = Object.freeze({
  request: "prompt-template:subagent:request",
  started: "prompt-template:subagent:started",
  update: "prompt-template:subagent:update",
  response: "prompt-template:subagent:response",
  cancel: "prompt-template:subagent:cancel",
});

const TERMINAL_STATUS = new Set([
  "acceptance_failed", "cancelled", "completed", "duplicate_node", "failed",
  "interrupted", "invalid_request", "structured_output_failed", "timed_out",
  "tool_budget_exhausted", "turn_budget_exhausted", "unavailable_context",
]);
const MUTATING_TOOLS = Object.freeze(["bash", "edit", "write"]);
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function entry(state, reasonCode, evidence, constraints = {}) {
  return { state, reasonCode, evidence, constraints };
}

export function createPiSubagentsDelegationV1CapabilityMatrix({ observedAt = 0 } = {}) {
  const wire = "pi-subagents@0.45.2 exported structured delegation events";
  return createBackendCapabilityV2({
    backendId: PI_SUBAGENTS_DELEGATION_V1_BACKEND_ID,
    backendVersion: PI_SUBAGENTS_DELEGATION_V1_BACKEND_VERSION,
    protocol: { name: "pi-subagents-structured-delegation", version: 1 },
    observedAt,
    capabilities: {
      foreground: entry("SUPPORTED", "native-foreground-delegation", [wire]),
      background: entry("DEGRADED", "event-correlated-parent-wait", [wire], { durableResume: false }),
      continuableResume: entry("UNAVAILABLE", "delegation-is-one-shot", [wire]),
      status: entry("DEGRADED", "bounded-progress-events", [wire]),
      steer: entry("UNAVAILABLE", "no-delegation-steer-event", [wire]),
      interrupt: entry("SUPPORTED", "correlated-delegation-cancel", [wire]),
      stop: entry("SUPPORTED", "correlated-delegation-cancel", [wire]),
      resume: entry("UNAVAILABLE", "delegation-is-one-shot", [wire]),
      dispose: entry("SUPPORTED", "adapter-local-dispose", ["only-my-pi adapter lifecycle"], { stopsBackendRun: false }),
      terminalEvents: entry("SUPPORTED", "correlated-terminal-response", [wire]),
      processTerminalProof: entry("SUPPORTED", "terminal-response-after-child-close", [wire], { exitCodeRequired: true }),
      worktree: entry("UNAVAILABLE", "delegation-contract-has-no-worktree", [wire]),
      perItemResult: entry("SUPPORTED", "structured-delegation-result", [wire]),
      usageMeter: entry("SUPPORTED", "delegation-terminal-usage", [wire]),
      rateLimitSignal: entry("UNAVAILABLE", "not-exported", [wire]),
      dynamicConcurrency: entry("UNAVAILABLE", "parent-owned-bounded-fanout", [wire]),
      modelOverlay: entry("DEGRADED", "optional-delegation-model", [wire]),
      toolOverlay: entry("DEGRADED", "agent-definition-plus-tool-budget", [wire]),
      structuredOutput: entry("SUPPORTED", "delegation-inline-schema", [wire]),
    },
  });
}

function fail(message, code, category = "backend", details = {}) {
  throw new SubagentsError(message, { code, category, details });
}

function keyOf(value) {
  return JSON.stringify([value?.requestId, value?.ownerRunId, value?.nodeId]);
}

function exactIdentity(value, attempt) {
  return value?.requestId === attempt.request.requestId
    && value?.ownerRunId === attempt.request.ownerRunId
    && value?.nodeId === attempt.request.nodeId;
}

function outputSchema(agentSpec, assignment) {
  const output = assignment.output ?? agentSpec.outputSchema;
  if (output?.schema !== undefined) return output.schema;
  if (output?.value !== undefined) return output.value;
  return output ?? null;
}

export function compileAgentAssignmentToPiDelegationRequest({
  handle,
  agentSpec,
  assignment,
  cwd,
  model,
  thinking,
  maximumTurns,
  maximumToolCalls = 8,
} = {}) {
  if (handle?.kind !== "agent-run-handle" || agentSpec?.kind !== "resolved-agent-spec" || assignment?.kind !== "task-assignment") {
    throw new TypeError("delegation compilation requires AgentRunHandle, ResolvedAgentSpec, and TaskAssignment");
  }
  if (handle.local.agentSpecHash !== agentSpec.specHash || handle.local.assignmentHash !== assignment.assignmentHash) {
    fail("delegation domain objects do not correlate", "DELEGATION_DOMAIN_CORRELATION_MISMATCH", "correlation");
  }
  if (assignment.ownership.writer || assignment.ownership.workspace !== "shared-read-only") {
    fail("structured delegation v1 only admits read-only shared-workspace assignments", "DELEGATION_WRITER_UNAVAILABLE", "policy");
  }
  if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("delegation cwd must be non-empty");
  if (!Number.isSafeInteger(maximumToolCalls) || maximumToolCalls < 0 || maximumToolCalls > 64) throw new TypeError("maximumToolCalls is invalid");
  if (maximumTurns !== undefined && (!Number.isSafeInteger(maximumTurns) || maximumTurns < 1 || maximumTurns > 128)) throw new TypeError("maximumTurns is invalid");
  if (thinking !== undefined && !THINKING_LEVELS.has(thinking)) throw new TypeError("thinking is invalid");
  const schema = outputSchema(agentSpec, assignment);
  const blockedTools = [...MUTATING_TOOLS];
  if (agentSpec.effectivePolicy?.egress?.web === "deny") blockedTools.push("web", "web_search", "source_check", "fetch_content", "get_search_content");
  const request = {
    requestId: handle.local.attemptId,
    ownerRunId: handle.local.runId,
    nodeId: handle.local.nodeId,
    agent: agentSpec.backendAgentId,
    task: maximumToolCalls === 0
      ? `Do not call file, network, shell, or delegation tools. This is a lifecycle-only probe, not a quality review. Your only permitted tool call is the final structured_output submission. ${assignment.task.text}`
      : assignment.task.text,
    context: assignment.context.mode,
    cwd,
    ...(typeof model === "string" && model.length > 0 ? { model } : {}),
    ...(thinking === undefined ? {} : { thinking }),
    timeoutMs: assignment.budget.maxElapsedMs,
    ...(maximumTurns === undefined ? {} : { turnBudget: { maxTurns: maximumTurns } }),
    toolBudget: maximumToolCalls === 0
      ? { hard: 1, block: ["bash", "edit", "fetch_content", "find", "get_search_content", "grep", "ls", "read", "source_check", "web", "web_search", "write"] }
      : { hard: maximumToolCalls, block: blockedTools },
    artifacts: false,
    result: schema === null ? { kind: "text" } : { kind: "structured", schema },
  };
  return immutable({
    formatVersion: 1,
    kind: "pi-subagents-delegation-v1-request",
    request,
    requestDigest: digestValue(request),
    assignmentHash: assignment.assignmentHash,
    agentSpecHash: agentSpec.specHash,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, deny) => { resolve = accept; reject = deny; });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

function normalizeScheduler(input) {
  const scheduler = input ?? {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };
  if (typeof scheduler.setTimeout !== "function" || typeof scheduler.clearTimeout !== "function") {
    throw new TypeError("delegation adapter scheduler requires setTimeout and clearTimeout");
  }
  return scheduler;
}

function withTimeout(promise, timeoutMs, createError, scheduler) {
  return new Promise((resolve, reject) => {
    const timer = scheduler.setTimeout(() => reject(createError()), timeoutMs);
    promise.then(
      (value) => { scheduler.clearTimeout(timer); resolve(value); },
      (error) => { scheduler.clearTimeout(timer); reject(error); },
    );
  });
}

function normalizeUsage(response) {
  const usage = response?.usage;
  if (!usage || !["input", "output", "cacheRead", "cacheWrite", "cost", "durationMs"].every((key) => Number.isFinite(usage[key]) && usage[key] >= 0)) {
    fail("delegation terminal response lacks reliable usage", "DELEGATION_USAGE_UNAVAILABLE");
  }
  for (const key of ["input", "output", "cacheRead", "cacheWrite"]) {
    if (!Number.isSafeInteger(usage[key])) fail("delegation token usage is not an integer", "DELEGATION_USAGE_UNAVAILABLE");
  }
  const total = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  if (!Number.isSafeInteger(total)) fail("delegation aggregate token usage is invalid", "DELEGATION_USAGE_UNAVAILABLE");
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total,
    costUsd: usage.cost,
    durationMs: usage.durationMs,
    turns: usage.turns ?? 0,
    toolCalls: usage.toolCalls ?? 0,
  };
}

function terminalOutcome(status) {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "interrupted";
  if (status === "timed_out") return "timed-out";
  if (["tool_budget_exhausted", "turn_budget_exhausted"].includes(status)) return "budget-exhausted";
  if (status === "unavailable_context") return "unavailable";
  return "failed";
}

function failedStatusCode(status, upstreamError) {
  const fixed = ({
    acceptance_failed: "DELEGATION_ACCEPTANCE_FAILED",
    duplicate_node: "DELEGATION_DUPLICATE_NODE",
    invalid_request: "DELEGATION_INVALID_REQUEST",
    structured_output_failed: "DELEGATION_STRUCTURED_OUTPUT_FAILED",
  })[status];
  if (fixed) return fixed;
  const message = typeof upstreamError === "string" ? upstreamError.toLowerCase() : "";
  const category = [
    [/(?:structured|schema|json)/u, "STRUCTURED_OUTPUT"],
    [/(?:provider|model|api|http|request)/u, "PROVIDER"],
    [/(?:tool)/u, "TOOL"],
    [/(?:turn)/u, "TURN"],
    [/(?:agent)/u, "AGENT"],
  ].find(([pattern]) => pattern.test(message))?.[1] ?? "UNKNOWN";
  return `DELEGATION_CHILD_FAILED_${category}`;
}

export class PiSubagentsDelegationV1Backend {
  constructor({ transport, cwd, model, thinking, modelResolver, clock = Date.now, timeoutMs = 120_000, maximumTurns, maximumToolCalls = 8, scheduler } = {}) {
    if (typeof transport?.subscribe !== "function" || typeof transport?.emit !== "function") throw new TypeError("delegation backend requires subscribe() and emit()");
    if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("delegation backend requires cwd");
    this.transport = transport;
    this.cwd = cwd;
    this.model = model;
    this.thinking = thinking;
    this.modelResolver = modelResolver;
    this.maximumTurns = maximumTurns;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
    this.maximumToolCalls = maximumToolCalls;
    this.scheduler = normalizeScheduler(scheduler);
    this.capabilityMatrix = createPiSubagentsDelegationV1CapabilityMatrix({ observedAt: clock() });
    this.attempts = new Map();
    this.disposed = false;
    this.unsubscribers = [
      transport.subscribe(PI_SUBAGENTS_DELEGATION_V1_EVENTS.started, (value) => this.#capture("started", value)),
      transport.subscribe(PI_SUBAGENTS_DELEGATION_V1_EVENTS.update, (value) => this.#capture("update", value)),
      transport.subscribe(PI_SUBAGENTS_DELEGATION_V1_EVENTS.response, (value) => this.#capture("response", value)),
    ].filter((value) => typeof value === "function");
  }

  #capture(kind, value) {
    const attempt = this.attempts.get(keyOf(value));
    if (!attempt || !exactIdentity(value, attempt)) return;
    if (kind === "started") {
      attempt.started.resolve(value);
      return;
    }
    if (kind === "update") {
      attempt.latestUpdate = immutable({
        requestId: value.requestId,
        ownerRunId: value.ownerRunId,
        nodeId: value.nodeId,
        ...(typeof value.runId === "string" ? { runId: value.runId } : {}),
        ...(Number.isFinite(value.durationMs) ? { durationMs: value.durationMs } : {}),
        ...(Number.isFinite(value.tokens) ? { tokens: value.tokens } : {}),
        ...(Number.isFinite(value.toolCount) ? { toolCount: value.toolCount } : {}),
      });
      if (typeof value.runId === "string" && value.runId.length > 0) attempt.childStarted.resolve(attempt.latestUpdate);
      return;
    }
    if (!TERMINAL_STATUS.has(value?.status)) {
      attempt.response.reject(new SubagentsError("delegation response has an invalid terminal status", { code: "DELEGATION_RESPONSE_INVALID", category: "backend" }));
      return;
    }
    attempt.response.resolve(value);
  }

  async ensureReady() {
    if (this.disposed) fail("delegation backend is disposed", "ADAPTER_DISPOSED", "unavailable");
    return immutable({ capabilityMatrix: this.capabilityMatrix });
  }

  async launch({ handle, agentSpec, assignment, model, thinking, maximumTurns, maximumToolCalls, mode = "background", signal } = {}) {
    await this.ensureReady();
    if (!new Set(["foreground", "background"]).has(mode)) throw new TypeError("delegation mode must be foreground or background");
    if (handle.backendBindings.length !== 0) fail("delegation launch requires an unbound handle", "HANDLE_ALREADY_BOUND", "correlation");
    const resolvedModel = typeof this.modelResolver === "function" ? await this.modelResolver({ agentSpec, assignment }) : null;
    const compiled = compileAgentAssignmentToPiDelegationRequest({
      handle,
      agentSpec,
      assignment,
      cwd: this.cwd,
      model: model ?? resolvedModel?.model ?? this.model,
      thinking: thinking ?? resolvedModel?.thinking ?? this.thinking,
      maximumTurns: maximumTurns ?? this.maximumTurns,
      maximumToolCalls: maximumToolCalls ?? this.maximumToolCalls,
    });
    const attempt = {
      request: compiled.request,
      compiled,
      started: deferred(),
      childStarted: deferred(),
      response: deferred(),
      latestUpdate: null,
      startedAt: this.clock(),
    };
    const key = keyOf(compiled.request);
    if (this.attempts.has(key)) fail("delegation attempt identity is already active", "DELEGATION_IDENTITY_REUSE", "correlation");
    this.attempts.set(key, attempt);
    const timer = this.scheduler.setTimeout(() => attempt.started.reject(new SubagentsError("delegation start timed out", { code: "DELEGATION_START_TIMEOUT", category: "unavailable" })), Math.min(this.timeoutMs, 30_000));
    const onAbort = () => this.transport.emit(PI_SUBAGENTS_DELEGATION_V1_EVENTS.cancel, {
      requestId: compiled.request.requestId,
      ownerRunId: compiled.request.ownerRunId,
      nodeId: compiled.request.nodeId,
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    this.transport.emit(PI_SUBAGENTS_DELEGATION_V1_EVENTS.request, compiled.request);
    try {
      await Promise.race([attempt.started.promise, attempt.response.promise.then((response) => {
        fail(`delegation settled before start: ${response.status}`, "DELEGATION_NOT_STARTED", "backend");
      })]);
    } catch (cause) {
      this.attempts.delete(key);
      throw cause;
    } finally {
      this.scheduler.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
    const boundHandle = bindBackendRun(handle, {
      backendId: PI_SUBAGENTS_DELEGATION_V1_BACKEND_ID,
      backendVersion: PI_SUBAGENTS_DELEGATION_V1_BACKEND_VERSION,
      protocolVersion: PI_SUBAGENTS_DELEGATION_V1_PROTOCOL_VERSION,
      lifecycle: "launch",
      requestId: compiled.request.requestId,
      backendRunId: compiled.request.requestId,
    });
    const binding = activeBackendBinding(boundHandle);
    attempt.handle = boundHandle;
    attempt.binding = binding;
    if (mode === "background") return immutable({ status: "RUNNING", mode, handle: boundHandle, binding, compiled });
    const terminal = await this.awaitTerminal(boundHandle, { bindingId: binding.bindingId, intent: "run", signal });
    return immutable({ status: "TERMINAL", mode, handle: boundHandle, binding, compiled, terminal });
  }

  #attempt(handle) {
    const binding = activeBackendBinding(handle);
    const attempt = this.attempts.get(keyOf({ requestId: binding.requestId, ownerRunId: handle.local.runId, nodeId: handle.local.nodeId }));
    if (!attempt || attempt.handle?.handleId !== handle.handleId) fail("delegation handle binding is unknown", "DELEGATION_BINDING_UNKNOWN", "correlation");
    return attempt;
  }

  async waitForChildStart(handle, { timeoutMs = 30_000 } = {}) {
    const attempt = this.#attempt(handle);
    if (attempt.latestUpdate?.runId) return attempt.latestUpdate;
    return await withTimeout(Promise.race([
      attempt.childStarted.promise,
      attempt.response.promise.then(() => {
        throw new SubagentsError("delegated child settled before a run id was observed", { code: "DELEGATION_CANCEL_TOO_LATE", category: "cancelled" });
      }),
    ]), timeoutMs, () => new SubagentsError("delegated child did not become observable", { code: "DELEGATION_CHILD_START_TIMEOUT", category: "unavailable" }), this.scheduler);
  }

  async awaitTerminal(handle, { bindingId, intent = "run", timeoutMs = this.timeoutMs } = {}) {
    const attempt = this.#attempt(handle);
    if (bindingId !== undefined && bindingId !== attempt.binding.bindingId) fail("delegation binding id drifted", "DELEGATION_BINDING_UNKNOWN", "correlation");
    const response = await withTimeout(attempt.response.promise, timeoutMs, () => new SubagentsError("delegation terminal timed out", { code: "DELEGATION_TERMINAL_TIMEOUT", category: "unavailable" }), this.scheduler);
    const usage = normalizeUsage(response);
    const outcome = terminalOutcome(response.status);
    const observedAt = this.clock();
    if (!["completed", "cancelled", "failed", "timed-out", "budget-exhausted"].includes(outcome)
      || !Number.isSafeInteger(response.exitCode)) {
      fail("delegation response cannot prove a child process terminal", "DELEGATION_PROCESS_TERMINAL_UNAVAILABLE", "correlation", { status: response.status });
    }
    const processInstanceId = `delegation:${digestValue([response.requestId, response.runId ?? null, response.exitCode]).slice(7, 39)}`;
    const completion = {
      runId: attempt.binding.backendRunId,
      state: response.status,
      success: response.status === "completed",
      usage: {
        total: usage.total,
        tokens: usage.total,
        costUsd: usage.costUsd,
        durationMs: usage.durationMs,
        elapsedMs: usage.durationMs,
        turns: usage.turns,
        toolCalls: usage.toolCalls,
      },
      totalTokens: { total: usage.total },
      totalCost: { totalTokens: usage.total, costUsd: usage.costUsd },
      upstreamRunId: response.runId ?? null,
      exitCode: response.exitCode,
      intent,
    };
    const processTerminal = {
      version: 1,
      state: "observed",
      runId: attempt.binding.backendRunId,
      runnerProcessInstanceId: processInstanceId,
      observedAt,
      instances: [{
        processInstanceId,
        kind: "delegated-child",
        closeObservedAt: observedAt,
        exitCode: response.exitCode,
        signal: null,
        observationSource: "pi-subagents-structured-delegation-terminal-response",
      }],
    };
    const result = response.result?.kind === "structured" ? response.result.value : response.result?.text ?? null;
    const terminal = createTerminalReceipt({
      handle,
      bindingId: attempt.binding.bindingId,
      outcome,
      completion,
      processTerminal,
      startedAt: attempt.startedAt,
      settledAt: observedAt,
      result,
      ...(outcome === "failed"
        ? { error: new SubagentsError("delegated child failed", { code: failedStatusCode(response.status, response.error), category: "backend" }) }
        : outcome === "budget-exhausted"
          ? { error: new SubagentsError("delegated child exhausted its upstream turn, tool, or usage budget", { code: "DELEGATION_CHILD_BUDGET_EXHAUSTED", category: "policy" }) }
          : {}),
    });
    this.attempts.delete(keyOf(attempt.request));
    return terminal;
  }

  async interrupt(handle, { awaitTerminal = true } = {}) {
    const attempt = this.#attempt(handle);
    this.transport.emit(PI_SUBAGENTS_DELEGATION_V1_EVENTS.cancel, {
      requestId: attempt.request.requestId,
      ownerRunId: attempt.request.ownerRunId,
      nodeId: attempt.request.nodeId,
    });
    if (!awaitTerminal) return immutable({ status: "INTERRUPTING", binding: attempt.binding });
    return immutable({ status: "TERMINAL", binding: attempt.binding, terminal: await this.awaitTerminal(handle, { intent: "cancel" }) });
  }

  async stop(handle) {
    return await this.interrupt(handle, { awaitTerminal: true });
  }

  async status(handle) {
    const attempt = this.#attempt(handle);
    return immutable({ bindingId: attempt.binding.bindingId, data: attempt.latestUpdate });
  }

  async steer() {
    fail("structured delegation v1 has no steer operation", "DELEGATION_STEER_UNAVAILABLE", "unavailable");
  }

  async resume() {
    fail("structured delegation v1 is one-shot and cannot resume", "DELEGATION_RESUME_UNAVAILABLE", "unavailable");
  }

  async dispose() {
    if (this.disposed) return immutable({ status: "DISPOSED", stoppedBackendRuns: false });
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const attempt of this.attempts.values()) {
      const error = new SubagentsError("delegation backend disposed", { code: "ADAPTER_DISPOSED", category: "unavailable" });
      attempt.started.reject(error);
      attempt.childStarted.reject(error);
      attempt.response.reject(error);
    }
    this.attempts.clear();
    return immutable({ status: "DISPOSED", stoppedBackendRuns: false });
  }
}

export function createPiSubagentsDelegationV1Backend(options = {}) {
  return new PiSubagentsDelegationV1Backend(options);
}
