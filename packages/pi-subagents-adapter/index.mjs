import crypto from "node:crypto";

const PROTOCOL_VERSION = 1;
const METHODS = Object.freeze(["ping", "status", "spawn", "steer", "interrupt", "stop", "resume"]);
const EVENTS = Object.freeze({
  ready: "subagents:rpc:v1:ready",
  request: "subagents:rpc:v1:request",
  replyPrefix: "subagents:rpc:v1:reply:",
  asyncComplete: "subagent:async-complete",
  processTerminal: "subagent:process-terminal",
});
const REQUIRED_CAPABILITIES = Object.freeze({
  status: true,
  fleetStatus: { version: 1 },
  asyncSpawn: true,
  steer: true,
  nonRecoveringSteer: true,
  interrupt: true,
  stop: true,
  resume: true,
  launchResolvedExtensions: { version: 1, source: "launch-resolved" },
  runtimeAcknowledgedExtensions: { version: 1, source: "child-runtime", event: "subagent:acknowledge-extension" },
  processTerminalProof: { version: 1, lifecycleArtifactVersion: 3 },
});

export class PiSubagentsAdapterError extends Error {
  constructor(message, code = "PI_SUBAGENTS_ADAPTER_ERROR", details = {}) {
    super(`pi-subagents-adapter: ${message}`);
    this.name = "PiSubagentsAdapterError";
    this.code = code;
    Object.assign(this, details);
  }
}
function fail(message, code, details) { throw new PiSubagentsAdapterError(message, code, details); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex")}`; }
function requestId(prefix = "omp-rpc") { return `${prefix}-${crypto.randomUUID()}`; }
function validRequestId(value) { return typeof value === "string" && value.trim().length > 0 && !/[\r\n]/u.test(value); }
function equalShape(actual, expected, path = "") {
  if (expected === true) return actual === true;
  if (expected === false) return actual === false;
  if (expected && typeof expected === "object") return Object.entries(expected).every(([key, value]) => equalShape(actual?.[key], value, `${path}/${key}`));
  return actual === expected;
}
function validateReply(reply, expectedId) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) fail("RPC reply must be an object", "INVALID_RPC_REPLY");
  if (reply.version !== PROTOCOL_VERSION) fail("unsupported RPC reply version", "UNSUPPORTED_RPC_VERSION");
  if (reply.requestId !== expectedId) fail("RPC reply correlation mismatch", "RPC_CORRELATION_MISMATCH");
  if (typeof reply.success !== "boolean") fail("RPC reply success must be boolean", "INVALID_RPC_REPLY");
  if (!reply.success) fail(reply.error?.message ?? "pi-subagents RPC request failed", reply.error?.code ?? "RPC_REQUEST_FAILED", { reply });
  return reply;
}

export class PiSubagentsAdapter {
  constructor({ transport, timeoutMs = 30000, requiredCapabilities = REQUIRED_CAPABILITIES, idFactory = requestId } = {}) {
    if (!transport || typeof transport.request !== "function") fail("an injected request transport is required", "TRANSPORT_UNAVAILABLE");
    this.transport = transport;
    this.timeoutMs = timeoutMs;
    this.requiredCapabilities = clone(requiredCapabilities);
    this.idFactory = idFactory;
    this.capabilities = null;
    this.capabilityHash = null;
    this.ready = false;
    this.inFlight = new Map();
  }
  async #request(method, params = {}, { signal, timeoutMs = this.timeoutMs } = {}) {
    if (!METHODS.includes(method)) fail(`unsupported RPC method: ${method}`, "UNSUPPORTED_RPC_METHOD");
    const id = this.idFactory(`omp-${method}`);
    if (!validRequestId(id)) fail("idFactory returned an invalid request id", "INVALID_REQUEST_ID");
    const envelope = { version: PROTOCOL_VERSION, requestId: id, method, source: { extension: "only-my-pi" }, params: clone(params) };
    if (signal?.aborted) fail("RPC request aborted before send", "ABORT_ERR");
    const pending = Promise.resolve().then(() => this.transport.request(envelope));
    this.inFlight.set(id, pending);
    try {
      const reply = await Promise.race([
        pending,
        new Promise((_, reject) => {
          const timer = setTimeout(() => { const error = new PiSubagentsAdapterError(`${method} timed out`, "RPC_TIMEOUT"); reject(error); }, timeoutMs);
          pending.finally(() => clearTimeout(timer)).catch(() => {});
        }),
      ]);
      return validateReply(reply, id);
    } finally { this.inFlight.delete(id); }
  }
  async negotiate({ signal } = {}) {
    const reply = await this.#request("ping", { sourceExtension: "only-my-pi", protocolVersion: PROTOCOL_VERSION }, { signal });
    const data = reply.data;
    if (!data || data.version !== PROTOCOL_VERSION || !Array.isArray(data.methods)) fail("ping reply has invalid capability data", "INVALID_CAPABILITY_REPLY");
    for (const method of METHODS) if (!data.methods.includes(method)) fail(`pi-subagents does not advertise ${method}`, "MISSING_RPC_CAPABILITY", { method });
    if (!equalShape(data.capabilities, this.requiredCapabilities)) fail("pi-subagents capability ceiling is insufficient", "MISSING_RPC_CAPABILITY", { required: this.requiredCapabilities, actual: data.capabilities ?? null });
    if (JSON.stringify(data.events) !== JSON.stringify(EVENTS)) fail("pi-subagents event map differs from audited wire", "RPC_EVENT_MISMATCH");
    this.capabilities = clone(data);
    this.capabilityHash = digest(data);
    this.ready = true;
    return Object.freeze({ protocolVersion: PROTOCOL_VERSION, capabilityHash: this.capabilityHash, capabilities: clone(data.capabilities), events: clone(data.events) });
  }
  async ensureReady(options = {}) { return this.ready ? { protocolVersion: PROTOCOL_VERSION, capabilityHash: this.capabilityHash, capabilities: clone(this.capabilities?.capabilities), events: clone(this.capabilities?.events) } : this.negotiate(options); }
  async spawn(compiled, { signal } = {}) {
    await this.ensureReady({ signal });
    if (!compiled || compiled.method !== "spawn" || compiled.source?.extension !== "only-my-pi" || compiled.source?.kind !== "schema-validated-workflow-compiler" || compiled.source?.schemaValidated !== true) fail("spawn requires compiler-produced request", "INVALID_COMPILED_REQUEST");
    if (compiled.params?.async !== true || typeof compiled.params?.workflowScript !== "string" || !compiled.params.workflowScript.trim()) fail("spawn requires async non-empty workflowScript", "INVALID_COMPILED_REQUEST");
    const reply = await this.#request("spawn", compiled.params, { signal });
    return Object.freeze({ status: "ACCEPTED", requestId: reply.requestId, data: clone(reply.data), capabilityHash: this.capabilityHash, workflowScriptDigest: compiled.workflowScriptDigest ?? digest(compiled.params.workflowScript) });
  }
  async execute(compiled, { signal, runId } = {}) {
    const accepted = await this.spawn(compiled, { signal });
    if (typeof this.transport.waitForCompletion !== "function") return { ...accepted, status: "RUNNING", runId: runId ?? null, code: "CHILD_RUNTIME_NOT_TERMINAL" };
    const result = await this.transport.waitForCompletion({ requestId: accepted.requestId, runId, signal, events: EVENTS });
    if (!result || typeof result !== "object") fail("completion transport returned no terminal proof", "MISSING_TERMINAL_PROOF");
    return { ...result, requestId: accepted.requestId, capabilityHash: this.capabilityHash };
  }
  async status(runId, { signal } = {}) { await this.ensureReady({ signal }); return (await this.#request("status", { runId }, { signal })).data ?? null; }
  async stop(runId, { signal } = {}) { await this.ensureReady({ signal }); return (await this.#request("stop", { runId }, { signal })).data ?? null; }
  async interrupt(runId, { signal } = {}) { await this.ensureReady({ signal }); return (await this.#request("interrupt", { runId }, { signal })).data ?? null; }
  async dispose() { this.ready = false; this.capabilities = null; this.capabilityHash = null; this.inFlight.clear(); if (typeof this.transport.dispose === "function") await this.transport.dispose(); }
}

export function createPiSubagentsAdapter(options = {}) { return new PiSubagentsAdapter(options); }
export { EVENTS as PI_SUBAGENTS_EVENTS, METHODS as PI_SUBAGENTS_METHODS, REQUIRED_CAPABILITIES as PI_SUBAGENTS_REQUIRED_CAPABILITIES };
