import {
  assertDomainId,
  assertRecord,
  assertSafeInteger,
  assertString,
  digestValue,
  immutable,
  normalizeStringSet,
} from "./shared.mjs";
import { fail } from "./errors.mjs";

export const BACKEND_CAPABILITY_STATES = Object.freeze(["SUPPORTED", "DEGRADED", "UNAVAILABLE"]);

export const BACKEND_CAPABILITY_KEYS = Object.freeze([
  "foreground",
  "background",
  "continuableResume",
  "status",
  "steer",
  "interrupt",
  "stop",
  "resume",
  "dispose",
  "terminalEvents",
  "processTerminalProof",
  "worktree",
  "perItemResult",
  "usageMeter",
  "rateLimitSignal",
  "dynamicConcurrency",
  "modelOverlay",
  "toolOverlay",
  "structuredOutput",
]);

export function createBackendCapabilityEntry(input, label = "backend capability") {
  assertRecord(input, label);
  if (!BACKEND_CAPABILITY_STATES.includes(input.state)) throw new TypeError(`${label}.state is invalid`);
  const reasonCode = assertDomainId(input.reasonCode, `${label}.reasonCode`);
  const evidence = normalizeStringSet(input.evidence ?? [], `${label}.evidence`, { maximumItems: 32 });
  if (evidence.length === 0) throw new TypeError(`${label}.evidence must identify public evidence`);
  const constraints = input.constraints === undefined ? {} : assertRecord(input.constraints, `${label}.constraints`);
  return immutable({ state: input.state, reasonCode, evidence, constraints });
}

export function createBackendCapabilityV2({
  backendId,
  backendVersion,
  protocol,
  capabilities,
  observedAt = 0,
} = {}) {
  assertDomainId(backendId, "backendId");
  assertString(backendVersion, "backendVersion", { maximum: 128 });
  assertRecord(protocol, "protocol");
  assertString(protocol.name, "protocol.name", { maximum: 128 });
  assertSafeInteger(protocol.version, "protocol.version", { minimum: 1, maximum: 1024 });
  assertSafeInteger(observedAt, "observedAt");
  assertRecord(capabilities, "capabilities");
  const unknown = Object.keys(capabilities).filter((key) => !BACKEND_CAPABILITY_KEYS.includes(key));
  if (unknown.length) throw new TypeError(`capabilities contains unknown keys: ${unknown.sort().join(", ")}`);
  const normalized = {};
  for (const key of BACKEND_CAPABILITY_KEYS) {
    if (!Object.hasOwn(capabilities, key)) throw new TypeError(`capabilities.${key} is required`);
    normalized[key] = createBackendCapabilityEntry(capabilities[key], `capabilities.${key}`);
  }
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/backend-capability-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    kind: "backend-capability-matrix",
    backendId,
    backendVersion,
    protocol: { name: protocol.name, version: protocol.version },
    observedAt,
    capabilities: normalized,
  };
  return immutable({ ...value, capabilityHash: digestValue(value) });
}

export function backendCapability(matrix, key) {
  if (matrix?.formatVersion !== 2 || matrix?.kind !== "backend-capability-matrix") {
    throw new TypeError("matrix must be BackendCapabilityV2");
  }
  if (!BACKEND_CAPABILITY_KEYS.includes(key)) throw new TypeError(`unknown backend capability: ${key}`);
  return matrix.capabilities[key];
}

export function requireBackendCapability(matrix, key, { allowDegraded = false } = {}) {
  const entry = backendCapability(matrix, key);
  if (entry.state === "SUPPORTED" || (allowDegraded && entry.state === "DEGRADED")) return entry;
  fail(`backend capability ${key} is ${entry.state.toLowerCase()}`, `BACKEND_${key.toUpperCase()}_${entry.state}`, {
    category: entry.state === "UNAVAILABLE" ? "unavailable" : "capability",
    details: { key, entry, capabilityHash: matrix.capabilityHash },
  });
}
