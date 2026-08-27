import {
  digestValue,
  immutable,
  SubagentsError,
} from "../../domain/index.mjs";

export const PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION = 1;
export const PI_SUBAGENTS_RPC_V1_BACKEND_ID = "pi-subagents-rpc-v1";
export const PI_SUBAGENTS_RPC_V1_BACKEND_VERSION = "0.45.2";

export const PI_SUBAGENTS_RPC_V1_CANDIDATE_BACKEND_VERSION = "0.57.0";

export const PI_SUBAGENTS_RPC_V1_METHODS = Object.freeze([
  "ping",
  "status",
  "spawn",
  "steer",
  "interrupt",
  "stop",
  "resume",
]);

export const PI_SUBAGENTS_RPC_V1_EVENTS = Object.freeze({
  ready: "subagents:rpc:v1:ready",
  request: "subagents:rpc:v1:request",
  replyPrefix: "subagents:rpc:v1:reply:",
  asyncComplete: "subagent:async-complete",
  processTerminal: "subagent:process-terminal",
});

export const PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES = Object.freeze({
  status: true,
  fleetStatus: Object.freeze({ version: 1 }),
  asyncSpawn: true,
  steer: true,
  nonRecoveringSteer: true,
  interrupt: true,
  stop: true,
  resume: true,
  launchResolvedExtensions: Object.freeze({ version: 1, source: "launch-resolved" }),
  runtimeAcknowledgedExtensions: Object.freeze({
    version: 1,
    source: "child-runtime",
    event: "subagent:acknowledge-extension",
  }),
  processTerminalProof: Object.freeze({ version: 1, lifecycleArtifactVersion: 3 }),
});

const PI_SUBAGENTS_RPC_V1_CANDIDATE_METHODS = Object.freeze([
  "ping",
  "status",
  "manage",
  "spawn",
  "steer",
  "interrupt",
  "stop",
  "resume",
]);

const PI_SUBAGENTS_RPC_V1_CANDIDATE_EVENTS = Object.freeze({
  ready: "subagents:rpc:v1:ready",
  request: "subagents:rpc:v1:request",
  replyPrefix: "subagents:rpc:v1:reply:",
  asyncComplete: "subagent:async-complete",
  childStatus: "subagent:child-status",
  processTerminal: "subagent:process-terminal",
});

const PI_SUBAGENTS_RPC_V1_CANDIDATE_CAPABILITIES = Object.freeze({
  status: true,
  managementActions: Object.freeze([
    "schedule.list",
    "schedule.show",
    "schedule.history",
    "schedule.pause",
    "schedule.resume",
    "schedule.run",
    "schedule.delete",
  ]),
  fleetStatus: Object.freeze({ version: 1 }),
  asyncStatusSnapshot: Object.freeze({ kind: "pi-subagents.async-status-snapshot", version: 1 }),
  asyncSpawn: true,
  steer: true,
  nonRecoveringSteer: true,
  interrupt: true,
  stop: true,
  resume: true,
  launchResolvedExtensions: Object.freeze({ version: 1, source: "launch-resolved" }),
  runtimeAcknowledgedExtensions: Object.freeze({
    version: 1,
    source: "child-runtime",
    event: "subagent:acknowledge-extension",
  }),
  processTerminalProof: Object.freeze({ version: 1, lifecycleArtifactVersion: 3 }),
});

export const PI_SUBAGENTS_RPC_V1_DIALECTS = Object.freeze({
  [PI_SUBAGENTS_RPC_V1_BACKEND_VERSION]: Object.freeze({
    backendVersion: PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
    methods: PI_SUBAGENTS_RPC_V1_METHODS,
    events: PI_SUBAGENTS_RPC_V1_EVENTS,
    capabilities: PI_SUBAGENTS_RPC_V1_REQUIRED_CAPABILITIES,
  }),
  [PI_SUBAGENTS_RPC_V1_CANDIDATE_BACKEND_VERSION]: Object.freeze({
    backendVersion: PI_SUBAGENTS_RPC_V1_CANDIDATE_BACKEND_VERSION,
    methods: PI_SUBAGENTS_RPC_V1_CANDIDATE_METHODS,
    events: PI_SUBAGENTS_RPC_V1_CANDIDATE_EVENTS,
    capabilities: PI_SUBAGENTS_RPC_V1_CANDIDATE_CAPABILITIES,
  }),
});

export function resolvePiSubagentsRpcV1Dialect(backendVersion = PI_SUBAGENTS_RPC_V1_BACKEND_VERSION) {
  const dialect = PI_SUBAGENTS_RPC_V1_DIALECTS[backendVersion];
  if (!dialect) {
    wireError("pi-subagents backend version has no audited RPC v1 dialect", "UNSUPPORTED_PI_SUBAGENTS_BACKEND_VERSION", {
      backendVersion,
      supportedVersions: Object.keys(PI_SUBAGENTS_RPC_V1_DIALECTS),
    });
  }
  return dialect;
}

function wireError(message, code, details = undefined) {
  throw new SubagentsError(message, {
    code,
    category: code.includes("CORRELATION") ? "correlation" : "capability",
    details,
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactShape(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((entry, index) => exactShape(actual[index], entry));
  }
  if (expected === true || expected === false || typeof expected !== "object" || expected === null) {
    return actual === expected;
  }
  if (!isRecord(actual)) return false;
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (expectedKeys.length !== actualKeys.length) return false;
  if (!expectedKeys.every((key, index) => key === actualKeys[index])) return false;
  return expectedKeys.every((key) => exactShape(actual[key], expected[key]));
}

function exactStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

export function assertPiSubagentsRpcV1RequestId(value, label = "requestId") {
  if (typeof value !== "string" || value.trim().length === 0 || /[\r\n]/u.test(value)) {
    wireError(`${label} must be a non-empty string without newlines`, "INVALID_RPC_REQUEST_ID");
  }
  return value;
}

export function assertPiSubagentsRpcV1Reply(reply, requestId) {
  if (!isRecord(reply)) wireError("RPC reply must be an object", "INVALID_RPC_REPLY");
  if (reply.version !== PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION) {
    wireError("RPC reply uses an unsupported protocol version", "UNSUPPORTED_RPC_VERSION", {
      expected: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
      actual: reply.version,
    });
  }
  if (reply.requestId !== requestId) {
    wireError("RPC reply requestId is not correlated", "RPC_CORRELATION_MISMATCH", {
      expectedRequestId: requestId,
      actualRequestId: reply.requestId,
    });
  }
  if (typeof reply.success !== "boolean") wireError("RPC reply success must be boolean", "INVALID_RPC_REPLY");
  if (!reply.success) {
    throw new SubagentsError(reply.error?.message ?? "pi-subagents RPC request failed", {
      code: reply.error?.code ?? "PI_SUBAGENTS_RPC_REQUEST_FAILED",
      category: "backend",
      retryable: reply.error?.retryable === true,
      details: { method: reply.method, upstream: reply.error },
    });
  }
  return reply;
}

export function assertExactPiSubagentsRpcV1Ping(value, { backendVersion = PI_SUBAGENTS_RPC_V1_BACKEND_VERSION } = {}) {
  const dialect = resolvePiSubagentsRpcV1Dialect(backendVersion);
  const data = value?.success === true && value?.data !== undefined ? value.data : value;
  if (!isRecord(data) || data.version !== PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION) {
    wireError("ping reply does not advertise RPC protocol v1", "INVALID_PI_SUBAGENTS_PING");
  }
  if (!exactStringSet(data.methods, dialect.methods)) {
    wireError(`ping reply method set differs from audited pi-subagents@${backendVersion}`, "PI_SUBAGENTS_METHOD_DRIFT", {
      expected: dialect.methods,
      actual: data.methods,
    });
  }
  if (!exactShape(data.events, dialect.events)) {
    wireError(`ping reply event map differs from audited pi-subagents@${backendVersion}`, "PI_SUBAGENTS_EVENT_DRIFT", {
      expected: dialect.events,
      actual: data.events,
    });
  }
  if (!exactShape(data.capabilities, dialect.capabilities)) {
    wireError(`ping reply capability set differs from audited pi-subagents@${backendVersion}`, "PI_SUBAGENTS_CAPABILITY_DRIFT", {
      expected: dialect.capabilities,
      actual: data.capabilities,
    });
  }
  const normalized = {
    version: data.version,
    methods: [...data.methods],
    capabilities: data.capabilities,
    events: data.events,
    session: isRecord(data.session) ? data.session : {},
  };
  return immutable({ ...normalized, backendVersion, capabilityHash: digestValue(normalized) });
}

export function createPiSubagentsRpcV1Envelope({ requestId, method, params = {}, source = {}, backendVersion = PI_SUBAGENTS_RPC_V1_BACKEND_VERSION } = {}) {
  const dialect = resolvePiSubagentsRpcV1Dialect(backendVersion);
  assertPiSubagentsRpcV1RequestId(requestId);
  if (!dialect.methods.includes(method)) {
    wireError(`unsupported pi-subagents RPC method: ${method}`, "UNSUPPORTED_RPC_METHOD", { method });
  }
  if (!isRecord(params)) wireError("RPC params must be an object", "INVALID_RPC_PARAMS");
  return {
    version: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
    requestId,
    method,
    source: { extension: "only-my-pi", ...source },
    params: structuredClone(params),
  };
}
