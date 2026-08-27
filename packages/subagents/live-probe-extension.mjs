import fs from "node:fs";
import path from "node:path";

export const PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE = "omp_pi_subagents_live_probe_v1";
export const PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID = "omp-pi-subagents-live-probe-v1";

const READY_EVENT = "subagents:rpc:v1:ready";
const REQUEST_EVENT = "subagents:rpc:v1:request";
const REPLY_EVENT = `subagents:rpc:v1:reply:${PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID}`;
const OWNER_ENV = "OMP_SUBAGENTS_PROBE_UPSTREAM_ROOT";
const FIRST_PARTY_ENV = "OMP_SUBAGENTS_PROBE_FIRST_PARTY_ROOT";
const MAX_NAME_LENGTH = 128;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_NAME_LENGTH || /[\0\r\n]/u.test(value)) {
    return "<invalid>";
  }
  return value;
}

function realDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) return null;
  try {
    const resolved = fs.realpathSync(value);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function within(root, candidate) {
  if (!root || typeof candidate !== "string" || !path.isAbsolute(candidate)) return false;
  try {
    const resolved = fs.realpathSync(candidate);
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function classifyProbeSource(sourceInfo, { upstreamRoot, firstPartyRoot } = {}) {
  const sourcePath = isObject(sourceInfo) ? sourceInfo.path : undefined;
  if (within(upstreamRoot, sourcePath)) return "pi-subagents";
  if (within(firstPartyRoot, sourcePath)) return "only-my-pi";
  if (typeof sourcePath === "string" && sourcePath.startsWith("<builtin:")) return "pi-builtin";
  if (typeof sourcePath === "string" && sourcePath.startsWith("<inline:")) return "pi-inline";
  return "other";
}

function sanitizeSession(value) {
  const session = isObject(value) ? value : {};
  return {
    cwdPresent: typeof session.cwd === "string" && session.cwd.length > 0,
    sessionIdPresent: typeof session.sessionId === "string" && session.sessionId.length > 0,
    sessionFilePresent: typeof session.sessionFile === "string" && session.sessionFile.length > 0,
  };
}

function sanitizePingData(value) {
  const data = isObject(value) ? value : {};
  return {
    version: data.version,
    methods: Array.isArray(data.methods) ? structuredClone(data.methods) : data.methods,
    capabilities: isObject(data.capabilities) ? structuredClone(data.capabilities) : data.capabilities,
    events: isObject(data.events) ? structuredClone(data.events) : data.events,
    session: sanitizeSession(data.session),
  };
}

function sanitizeReply(value) {
  const reply = isObject(value) ? value : {};
  if (reply.success === true) {
    return {
      version: reply.version,
      requestId: reply.requestId,
      method: reply.method,
      success: true,
      data: sanitizePingData(reply.data),
    };
  }
  return {
    version: reply.version,
    requestId: reply.requestId,
    method: reply.method,
    success: false,
    error: { code: isObject(reply.error) ? boundedName(reply.error.code) : "unknown" },
  };
}

function sameSession(ready, reply) {
  const readySession = isObject(ready?.session) ? ready.session : {};
  const replySession = isObject(reply?.data?.session) ? reply.data.session : {};
  return typeof readySession.sessionId === "string"
    && readySession.sessionId.length > 0
    && readySession.sessionId === replySession.sessionId
    && (readySession.sessionFile ?? null) === (replySession.sessionFile ?? null)
    && readySession.cwd === replySession.cwd;
}

export function createPiSubagentsLiveProbeRecord({ pi, ready, reply, upstreamRoot, firstPartyRoot } = {}) {
  if (!pi || typeof pi.getActiveTools !== "function" || typeof pi.getAllTools !== "function" || typeof pi.getCommands !== "function") {
    throw new TypeError("live probe requires the public Pi tool and command registry APIs");
  }
  const roots = {
    upstreamRoot: realDirectory(upstreamRoot),
    firstPartyRoot: realDirectory(firstPartyRoot),
  };
  const activeNames = new Set(pi.getActiveTools().map(boundedName));
  const activeTools = pi.getAllTools()
    .filter((tool) => activeNames.has(boundedName(tool?.name)))
    .map((tool) => ({
      name: boundedName(tool?.name),
      owner: classifyProbeSource(tool?.sourceInfo, roots),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.owner.localeCompare(right.owner));
  const commands = pi.getCommands()
    .map((command) => ({
      name: boundedName(command?.name),
      owner: classifyProbeSource(command?.sourceInfo, roots),
    }))
    .sort((left, right) => left.name.localeCompare(right.name) || left.owner.localeCompare(right.owner));
  return {
    formatVersion: 1,
    type: PI_SUBAGENTS_LIVE_PROBE_RECORD_TYPE,
    ready: sanitizePingData(ready),
    reply: sanitizeReply(reply),
    sameSession: sameSession(ready, reply),
    activeTools,
    commands,
  };
}

export default function piSubagentsLiveProbeExtension(pi) {
  let ready;
  let reply;
  let emitted = false;
  const emitWhenComplete = () => {
    if (emitted || ready === undefined || reply === undefined) return;
    emitted = true;
    const record = createPiSubagentsLiveProbeRecord({
      pi,
      ready,
      reply,
      upstreamRoot: process.env[OWNER_ENV],
      firstPartyRoot: process.env[FIRST_PARTY_ENV],
    });
    process.stdout.write(`${JSON.stringify(record)}\n`);
  };

  pi.events.on(READY_EVENT, (value) => {
    ready = value;
    emitWhenComplete();
  });
  pi.events.on(REPLY_EVENT, (value) => {
    reply = value;
    emitWhenComplete();
  });
  pi.on("session_start", () => {
    pi.events.emit(REQUEST_EVENT, {
      version: 1,
      requestId: PI_SUBAGENTS_LIVE_PROBE_REQUEST_ID,
      method: "ping",
      source: { extension: "only-my-pi" },
    });
  });
}

export const PI_SUBAGENTS_LIVE_PROBE_OWNER_ENV = OWNER_ENV;
export const PI_SUBAGENTS_LIVE_PROBE_FIRST_PARTY_ENV = FIRST_PARTY_ENV;
