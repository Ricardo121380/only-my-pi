import crypto from "node:crypto";

import {
  activeBackendBinding,
  bindBackendRun,
  digestValue,
  immutable,
  normalizeSubagentsError,
  requireBackendCapability,
  SubagentsError,
} from "../../domain/index.mjs";
import { createPiSubagentsRpcV1CapabilityMatrix } from "./capabilities.mjs";
import {
  assertPiSubagentsRpcV1CompiledSpawn,
  compileAgentAssignmentToPiSpawnRequest,
} from "./compiler.mjs";
import {
  createPiSubagentsTerminalReceipt,
  extractPiSubagentsBackendRunMapping,
  normalizePiSubagentsTerminalEvidence,
  piSubagentsEventRunId,
} from "./normalization.mjs";
import { PiSubagentsTerminalEventStore } from "./terminal-store.mjs";
import {
  assertExactPiSubagentsRpcV1Ping,
  assertPiSubagentsRpcV1Reply,
  createPiSubagentsRpcV1Envelope,
  PI_SUBAGENTS_RPC_V1_BACKEND_ID,
  PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
  PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
  resolvePiSubagentsRpcV1Dialect,
} from "./wire.mjs";

const EXECUTION_MODES = new Set(["foreground", "background", "continuable"]);
const STEER_MODES = new Set(["steer", "follow_up", "auto"]);

function normalizeScheduler(input) {
  const scheduler = input ?? {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
  };
  if (typeof scheduler.setTimeout !== "function" || typeof scheduler.clearTimeout !== "function") {
    throw new TypeError("RPC adapter scheduler requires setTimeout and clearTimeout");
  }
  return scheduler;
}

function requestId(prefix = "omp-rpc") {
  return `${prefix}-${crypto.randomUUID()}`;
}

function assertMessage(value, label, maximum = 128 * 1024) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must be a non-empty string no longer than ${maximum} characters`);
  }
  return value;
}

function abortError() {
  return new SubagentsError("RPC request was aborted", {
    code: "ABORT_ERR",
    category: "cancelled",
  });
}

function adapterDisposedError() {
  return new SubagentsError("pi-subagents RPC adapter is disposed", {
    code: "ADAPTER_DISPOSED",
    category: "unavailable",
  });
}

function assertHandleForBackend(handle) {
  if (handle?.kind !== "agent-run-handle" || handle?.formatVersion !== 1) {
    throw new TypeError("handle must be an AgentRunHandle");
  }
  if (handle.backendId !== null && handle.backendId !== PI_SUBAGENTS_RPC_V1_BACKEND_ID) {
    throw new SubagentsError("AgentRunHandle belongs to another backend", {
      code: "HANDLE_BACKEND_MISMATCH",
      category: "correlation",
      details: { expected: PI_SUBAGENTS_RPC_V1_BACKEND_ID, actual: handle.backendId },
    });
  }
  return handle;
}

function bindingFor(handle, bindingId) {
  assertHandleForBackend(handle);
  if (bindingId === undefined) return activeBackendBinding(handle);
  const binding = handle.backendBindings.find((candidate) => candidate.bindingId === bindingId);
  if (!binding) {
    throw new SubagentsError("AgentRunHandle binding is unknown", {
      code: "HANDLE_BINDING_MISSING",
      category: "correlation",
      details: { handleId: handle.handleId, bindingId },
    });
  }
  return binding;
}

function transportCanObserveTerminal(transport, eventStore) {
  return typeof transport.waitForTerminal === "function" || eventStore.observable === 1;
}

function terminalEvidenceSettled(evidence) {
  return evidence?.processTerminal?.state === "unknown"
    || (evidence?.processTerminal?.state === "observed" && evidence?.completion !== null);
}

function mergeTerminalEvidence(first, second) {
  for (const key of ["completion", "processTerminal"]) {
    if (first?.[key] !== null && first?.[key] !== undefined
      && second?.[key] !== null && second?.[key] !== undefined
      && digestValue(first[key]) !== digestValue(second[key])) {
      throw new SubagentsError(`conflicting ${key} evidence from terminal observers`, {
        code: "PI_SUBAGENTS_TERMINAL_EVENT_CONFLICT",
        category: "correlation",
        details: { evidenceKind: key },
      });
    }
  }
  return {
    completion: first?.completion ?? second?.completion ?? null,
    processTerminal: first?.processTerminal ?? second?.processTerminal ?? null,
  };
}

function detachedChildMapping(completion, accepted, compiled) {
  const rootIds = new Set([accepted.mapping.backendRunId, accepted.mapping.backendAsyncId].filter(Boolean));
  if (!rootIds.has(piSubagentsEventRunId(completion))) {
    throw new SubagentsError("detached workflow completion does not correlate to its control run", {
      code: "PI_SUBAGENTS_DETACHED_ROOT_MISMATCH",
      category: "correlation",
    });
  }
  const state = completion?.state ?? completion?.status;
  const results = completion?.results;
  const child = Array.isArray(results) && results.length === 1 ? results[0] : null;
  const childRunId = typeof child?.runId === "string" && child.runId.length > 0 ? child.runId : null;
  if (!["complete", "completed"].includes(state)
    || completion?.success !== true
    || child === null
    || child.agent !== compiled.workflowKey
    || child.success === false
    || childRunId === null
    || rootIds.has(childRunId)) {
    throw new SubagentsError("detached workflow did not expose one correlated child run", {
      code: "PI_SUBAGENTS_DETACHED_CHILD_MISSING",
      category: "correlation",
      details: {
        state,
        resultCount: Array.isArray(results) ? results.length : null,
        childRunIdPresent: childRunId !== null,
      },
    });
  }
  return Object.freeze({ backendRunId: childRunId, backendAsyncId: childRunId });
}

async function boundedTerminalTransportWait(factory, {
  signal,
  timeoutMs,
  scheduler,
  disposal,
}) {
  if (signal?.aborted) throw abortError();
  let timer;
  let onAbort;
  const pending = Promise.resolve().then(factory);
  const competitors = [pending];
  competitors.push(new Promise((resolve) => {
    timer = scheduler.setTimeout(() => resolve(null), timeoutMs);
  }));
  competitors.push(disposal.then(() => { throw adapterDisposedError(); }));
  if (signal) {
    competitors.push(new Promise((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener("abort", onAbort, { once: true });
    }));
  }
  try {
    return await Promise.race(competitors);
  } finally {
    if (timer !== undefined) scheduler.clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export class PiSubagentsRpcV1Backend {
  constructor({
    transport,
    timeoutMs = 30_000,
    terminalTimeoutMs = 30_000,
    idFactory = requestId,
    clock = () => Date.now(),
    ownsTransport = false,
    scheduler,
    backendVersion = PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
  } = {}) {
    if (!transport || typeof transport.request !== "function") {
      throw new SubagentsError("an injected public RPC request transport is required", {
        code: "PI_SUBAGENTS_TRANSPORT_UNAVAILABLE",
        category: "unavailable",
      });
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be a positive integer");
    if (!Number.isSafeInteger(terminalTimeoutMs) || terminalTimeoutMs < 1) throw new TypeError("terminalTimeoutMs must be a positive integer");
    if (typeof idFactory !== "function") throw new TypeError("idFactory must be a function");
    if (typeof clock !== "function") throw new TypeError("clock must be a function");
    const dialect = resolvePiSubagentsRpcV1Dialect(backendVersion);
    this.transport = transport;
    this.backendVersion = backendVersion;
    this.events = dialect.events;
    this.timeoutMs = timeoutMs;
    this.terminalTimeoutMs = terminalTimeoutMs;
    this.idFactory = idFactory;
    this.clock = clock;
    this.scheduler = normalizeScheduler(scheduler);
    this.ownsTransport = ownsTransport === true;
    this.disposal = new Promise((resolve) => { this.resolveDisposal = resolve; });
    this.activeTerminalWaits = new Set();
    this.eventStore = new PiSubagentsTerminalEventStore({
      transport,
      events: this.events,
      scheduler: this.scheduler,
    });
    this.capabilityMatrix = createPiSubagentsRpcV1CapabilityMatrix({
      observedAt: 0,
      terminalTransport: transportCanObserveTerminal(transport, this.eventStore),
      backendVersion: this.backendVersion,
    });
    this.ping = null;
    this.ready = false;
    this.disposed = false;
    this.inFlight = new Map();
    this.startedAt = new Map();
    this.backendIdentifierOwners = new Map();
  }

  #mappingIdentifiers(mapping) {
    return [...new Set([mapping.backendRunId, mapping.backendAsyncId].filter(Boolean))];
  }

  #assertMappingAvailable(handleId, mapping) {
    for (const backendIdentifier of this.#mappingIdentifiers(mapping)) {
      const owner = this.backendIdentifierOwners.get(backendIdentifier);
      if (owner) {
        throw new SubagentsError("pi-subagents reused a backend identifier owned by an existing binding", {
          code: "PI_SUBAGENTS_BACKEND_ID_REUSE",
          category: "correlation",
          details: { backendIdentifier, ownerHandleId: owner.handleId, newHandleId: handleId },
        });
      }
    }
  }

  #recordMapping(handle, binding) {
    for (const backendIdentifier of this.#mappingIdentifiers(binding)) {
      this.backendIdentifierOwners.set(backendIdentifier, {
        handleId: handle.handleId,
        bindingId: binding.bindingId,
      });
    }
  }

  async #request(method, params = {}, { signal, timeoutMs = this.timeoutMs, source = {} } = {}) {
    if (this.disposed) throw adapterDisposedError();
    if (signal?.aborted) throw abortError();
    const id = this.idFactory(`omp-${method}`);
    const envelope = createPiSubagentsRpcV1Envelope({ requestId: id, method, params, source, backendVersion: this.backendVersion });
    const pending = Promise.resolve().then(() => this.transport.request(envelope));
    let resolveSettled;
    const settled = new Promise((resolve) => { resolveSettled = resolve; });
    this.inFlight.set(id, { pending, settled });
    let timer;
    let onAbort;
    const competitors = [pending];
    competitors.push(new Promise((_, reject) => {
      timer = this.scheduler.setTimeout(() => reject(new SubagentsError(`${method} RPC timed out`, {
        code: "PI_SUBAGENTS_RPC_TIMEOUT",
        category: "timeout",
        retryable: true,
        details: { method, timeoutMs },
      })), timeoutMs);
    }));
    competitors.push(this.disposal.then(() => { throw adapterDisposedError(); }));
    if (signal) {
      competitors.push(new Promise((_, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort, { once: true });
      }));
    }
    try {
      const reply = await Promise.race(competitors);
      return assertPiSubagentsRpcV1Reply(reply, id);
    } catch (error) {
      throw normalizeSubagentsError(error, {
        code: "PI_SUBAGENTS_TRANSPORT_ERROR",
        category: "transport",
        retryable: true,
        message: `pi-subagents ${method} RPC failed`,
      });
    } finally {
      if (timer !== undefined) this.scheduler.clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      this.inFlight.delete(id);
      resolveSettled();
    }
  }

  #trackTerminalWait(operation) {
    const tracked = Promise.resolve(operation);
    this.activeTerminalWaits.add(tracked);
    tracked.finally(() => this.activeTerminalWaits.delete(tracked)).catch(() => {});
    return tracked;
  }

  async negotiate({ signal } = {}) {
    const reply = await this.#request("ping", {
      sourceExtension: "only-my-pi",
      protocolVersion: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
    }, { signal });
    this.ping = assertExactPiSubagentsRpcV1Ping(reply, { backendVersion: this.backendVersion });
    this.capabilityMatrix = createPiSubagentsRpcV1CapabilityMatrix({
      observedAt: this.clock(),
      terminalTransport: transportCanObserveTerminal(this.transport, this.eventStore),
      backendVersion: this.backendVersion,
    });
    this.ready = true;
    return immutable({
      backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
      backendVersion: this.backendVersion,
      protocolVersion: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
      ping: this.ping,
      capabilityMatrix: this.capabilityMatrix,
    });
  }

  async ensureReady(options = {}) {
    if (this.disposed) throw adapterDisposedError();
    if (!this.ready) return this.negotiate(options);
    return immutable({
      backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
      backendVersion: this.backendVersion,
      protocolVersion: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
      ping: this.ping,
      capabilityMatrix: this.capabilityMatrix,
    });
  }

  async #spawnCompiled(compiled, { signal } = {}) {
    await this.ensureReady({ signal });
    assertPiSubagentsRpcV1CompiledSpawn(compiled);
    const reply = await this.#request("spawn", compiled.params, {
      signal,
      source: compiled.source,
    });
    const mapping = extractPiSubagentsBackendRunMapping(reply.data);
    return immutable({
      status: "ACCEPTED",
      requestId: reply.requestId,
      data: reply.data ?? null,
      mapping,
      capabilityHash: this.capabilityMatrix.capabilityHash,
      workflowScriptDigest: compiled.workflowScriptDigest,
    });
  }

  async launch({
    handle,
    agentSpec,
    assignment,
    mode = "background",
    compiled,
    allowWorktree = false,
    allowProtectedWorktreeProbe = false,
    allowModelOverlay = false,
    childAsync = false,
    signal,
  } = {}) {
    assertHandleForBackend(handle);
    if (!EXECUTION_MODES.has(mode)) throw new TypeError("mode must be foreground, background, or continuable");
    if (handle.backendBindings.length !== 0) {
      throw new SubagentsError("launch requires an unbound AgentRunHandle", {
        code: "HANDLE_ALREADY_BOUND",
        category: "correlation",
      });
    }
    if (handle.local.agentSpecHash !== agentSpec?.specHash
      || handle.local.assignmentHash !== assignment?.assignmentHash) {
      throw new SubagentsError("launch handle, AgentSpec, and TaskAssignment do not correlate", {
        code: "LAUNCH_DOMAIN_CORRELATION_MISMATCH",
        category: "correlation",
      });
    }
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, mode === "foreground" ? "foreground" : "background", {
      allowDegraded: mode === "foreground",
    });
    if (mode === "continuable") {
      requireBackendCapability(this.capabilityMatrix, "continuableResume");
      if (!handle.continuable) {
        throw new SubagentsError("AgentRunHandle is not continuable", {
          code: "HANDLE_NOT_CONTINUABLE",
          category: "capability",
        });
      }
    }
    const expectedRequest = compileAgentAssignmentToPiSpawnRequest({
      agentSpec,
      assignment,
      capabilityMatrix: this.capabilityMatrix,
      allowWorktree,
      allowProtectedWorktreeProbe,
      allowModelOverlay,
      childAsync,
    });
    const request = compiled ?? expectedRequest;
    if (compiled !== undefined) {
      assertPiSubagentsRpcV1CompiledSpawn(compiled);
      if (compiled.assignmentHash !== assignment.assignmentHash
        || compiled.agentSpecHash !== agentSpec.specHash
        || compiled.workflowScriptDigest !== expectedRequest.workflowScriptDigest) {
        throw new SubagentsError("supplied compiler product does not match the launch domain objects", {
          code: "COMPILED_LAUNCH_CORRELATION_MISMATCH",
          category: "correlation",
          details: {
            assignmentId: assignment.assignmentId,
            expectedWorkflowScriptDigest: expectedRequest.workflowScriptDigest,
            actualWorkflowScriptDigest: compiled.workflowScriptDigest,
          },
        });
      }
    }
    const accepted = await this.#spawnCompiled(request, { signal });
    let mapping = accepted.mapping;
    if (childAsync) {
      if (mode !== "background") throw new TypeError("childAsync requires background mode");
      if (this.eventStore.observable !== 1) {
        throw new SubagentsError("detached child mapping requires public async-complete events", {
          code: "PI_SUBAGENTS_DETACHED_MAPPING_UNOBSERVABLE",
          category: "capability",
        });
      }
      const rootIds = this.#mappingIdentifiers(accepted.mapping);
      const observed = await this.eventStore.wait(rootIds, {
        signal,
        timeoutMs: this.timeoutMs,
        completionOnly: true,
      });
      mapping = detachedChildMapping(observed.completion, accepted, request);
    }
    this.#assertMappingAvailable(handle.handleId, mapping);
    const boundHandle = bindBackendRun(handle, {
      backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
      backendVersion: this.backendVersion,
      protocolVersion: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
      lifecycle: "launch",
      requestId: accepted.requestId,
      ...mapping,
    });
    const binding = activeBackendBinding(boundHandle);
    this.#recordMapping(boundHandle, binding);
    this.startedAt.set(binding.bindingId, this.clock());
    if (mode !== "foreground") {
      return immutable({ status: "RUNNING", mode, handle: boundHandle, binding, accepted });
    }
    const terminal = await this.awaitTerminal(boundHandle, {
      bindingId: binding.bindingId,
      intent: "run",
      signal,
    });
    return immutable({ status: "TERMINAL", mode, handle: boundHandle, binding, accepted, terminal });
  }

  async status(handle, { signal } = {}) {
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, "status", { allowDegraded: true });
    const binding = bindingFor(handle);
    const reply = await this.#request("status", { runId: binding.backendRunId }, { signal });
    return immutable({ bindingId: binding.bindingId, backendRunId: binding.backendRunId, data: reply.data ?? null });
  }

  async steer(handle, message, { mode = "auto", index, signal } = {}) {
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, "steer");
    if (!STEER_MODES.has(mode)) throw new TypeError("steer mode must be steer, follow_up, or auto");
    if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) throw new TypeError("steer index must be a non-negative integer");
    const binding = bindingFor(handle);
    const params = {
      runId: binding.backendRunId,
      message: assertMessage(message, "steer message"),
      mode,
      ...(index === undefined ? {} : { index }),
    };
    const reply = await this.#request("steer", params, { signal });
    return immutable({ bindingId: binding.bindingId, backendRunId: binding.backendRunId, data: reply.data ?? null });
  }

  async interrupt(handle, { signal, awaitTerminal = true } = {}) {
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, "interrupt");
    if (awaitTerminal) {
      requireBackendCapability(this.capabilityMatrix, "terminalEvents");
      requireBackendCapability(this.capabilityMatrix, "processTerminalProof");
    }
    const binding = bindingFor(handle);
    const reply = await this.#request("interrupt", { runId: binding.backendRunId }, { signal });
    if (!awaitTerminal) return immutable({ status: "INTERRUPTING", binding, data: reply.data ?? null });
    const terminal = await this.awaitTerminal(handle, { bindingId: binding.bindingId, intent: "interrupt", signal });
    return immutable({ status: "TERMINAL", binding, data: reply.data ?? null, terminal });
  }

  async stop(handle, { signal } = {}) {
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, "stop");
    requireBackendCapability(this.capabilityMatrix, "terminalEvents");
    requireBackendCapability(this.capabilityMatrix, "processTerminalProof");
    const binding = bindingFor(handle);
    const reply = await this.#request("stop", { runId: binding.backendRunId }, { signal });
    const terminal = await this.awaitTerminal(handle, { bindingId: binding.bindingId, intent: "stop", signal });
    return immutable({ status: "TERMINAL", binding, data: reply.data ?? null, terminal });
  }

  async resume(handle, {
    message,
    output,
    outputMode,
    mode = "background",
    continuation = false,
    signal,
  } = {}) {
    await this.ensureReady({ signal });
    if (!EXECUTION_MODES.has(mode) || mode === "continuable") throw new TypeError("resume mode must be foreground or background");
    requireBackendCapability(this.capabilityMatrix, continuation ? "continuableResume" : "resume");
    requireBackendCapability(this.capabilityMatrix, mode === "foreground" ? "foreground" : "background", {
      allowDegraded: mode === "foreground",
    });
    if (continuation ? !handle?.continuable : !handle?.resumable) {
      throw new SubagentsError(continuation ? "AgentRunHandle is not continuable" : "AgentRunHandle is not resumable", {
        code: continuation ? "HANDLE_NOT_CONTINUABLE" : "HANDLE_NOT_RESUMABLE",
        category: "capability",
      });
    }
    const parent = bindingFor(handle);
    this.eventStore.clear(handle.backendBindings.flatMap((binding) => this.#mappingIdentifiers(binding)));
    const params = {
      runId: parent.backendRunId,
      message: assertMessage(message, "resume message"),
    };
    if (output !== undefined) {
      if (typeof output !== "string" || output.trim().length === 0) throw new TypeError("resume output must be a non-empty file path");
      if (outputMode !== undefined && outputMode !== "file") throw new TypeError(`pi-subagents@${this.backendVersion} resume only supports outputMode:file`);
      params.output = output;
      params.outputMode = "file";
    } else if (outputMode !== undefined) {
      throw new TypeError("resume outputMode requires output");
    }
    const reply = await this.#request("resume", params, { signal });
    const mapping = extractPiSubagentsBackendRunMapping(reply.data);
    this.#assertMappingAvailable(handle.handleId, mapping);
    const reboundHandle = bindBackendRun(handle, {
      backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
      backendVersion: this.backendVersion,
      protocolVersion: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
      lifecycle: "resume",
      parentBindingId: parent.bindingId,
      requestId: reply.requestId,
      ...mapping,
    });
    const binding = activeBackendBinding(reboundHandle);
    this.#recordMapping(reboundHandle, binding);
    this.startedAt.set(binding.bindingId, this.clock());
    if (mode === "background") {
      return immutable({ status: "RUNNING", mode, handle: reboundHandle, binding, data: reply.data ?? null });
    }
    const terminal = await this.awaitTerminal(reboundHandle, {
      bindingId: binding.bindingId,
      intent: continuation ? "continue" : "resume",
      signal,
    });
    return immutable({ status: "TERMINAL", mode, handle: reboundHandle, binding, data: reply.data ?? null, terminal });
  }

  async continueRun(handle, message, options = {}) {
    return this.resume(handle, { ...options, message, continuation: true });
  }

  async awaitTerminal(handle, {
    bindingId,
    intent = "run",
    signal,
    timeoutMs = this.terminalTimeoutMs,
  } = {}) {
    await this.ensureReady({ signal });
    requireBackendCapability(this.capabilityMatrix, "terminalEvents");
    requireBackendCapability(this.capabilityMatrix, "processTerminalProof");
    const binding = bindingFor(handle, bindingId);
    const identifiers = this.#mappingIdentifiers(binding);
    const cached = this.eventStore.snapshotAny(identifiers);
    let evidence = cached;
    if (!terminalEvidenceSettled(evidence)) {
      const eventWait = this.eventStore.observable === 1
        ? this.eventStore.wait(identifiers, { signal, timeoutMs })
        : null;
      const transportWait = typeof this.transport.waitForTerminal === "function"
        ? this.#trackTerminalWait(boundedTerminalTransportWait(() => this.transport.waitForTerminal({
            requestId: binding.requestId,
            runId: binding.backendRunId,
            backendRunId: binding.backendRunId,
            backendAsyncId: binding.backendAsyncId ?? null,
            backendIdentifiers: identifiers,
            bindingId: binding.bindingId,
            events: this.events,
            signal,
            timeoutMs,
          }), {
            signal,
            timeoutMs,
            scheduler: this.scheduler,
            disposal: this.disposal,
          }).then(normalizePiSubagentsTerminalEvidence))
        : null;
      if (eventWait && transportWait) {
        const first = await Promise.race([
          eventWait.then((value) => ({ source: "event", value })),
          transportWait.then((value) => ({ source: "transport", value })),
        ]);
        evidence = mergeTerminalEvidence(evidence, first.value);
        if (!terminalEvidenceSettled(evidence)) {
          const second = await (first.source === "event" ? transportWait : eventWait);
          evidence = mergeTerminalEvidence(evidence, second);
        }
      } else if (eventWait) {
        evidence = mergeTerminalEvidence(evidence, await eventWait);
      } else if (transportWait) {
        evidence = mergeTerminalEvidence(evidence, await transportWait);
      }
    }
    const terminal = createPiSubagentsTerminalReceipt({
      handle,
      bindingId: binding.bindingId,
      evidence,
      intent,
      startedAt: this.startedAt.get(binding.bindingId) ?? null,
      settledAt: this.clock(),
    });
    this.startedAt.delete(binding.bindingId);
    return terminal;
  }

  async dispose() {
    if (this.disposed) return immutable({ status: "DISPOSED", stoppedBackendRuns: false });
    this.disposed = true;
    this.ready = false;
    this.ping = null;
    const pendingRequests = [...this.inFlight.values()].map((entry) => entry.settled);
    const pendingTerminalWaits = [...this.activeTerminalWaits];
    this.resolveDisposal();
    this.eventStore.dispose();
    await Promise.allSettled([...pendingRequests, ...pendingTerminalWaits]);
    this.inFlight.clear();
    this.activeTerminalWaits.clear();
    this.startedAt.clear();
    this.backendIdentifierOwners.clear();
    if (this.ownsTransport && typeof this.transport.dispose === "function") await this.transport.dispose();
    return immutable({ status: "DISPOSED", stoppedBackendRuns: false });
  }
}

export function createPiSubagentsRpcV1Backend(options = {}) {
  return new PiSubagentsRpcV1Backend(options);
}
