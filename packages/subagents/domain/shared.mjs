import crypto from "node:crypto";

const DOMAIN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|credential|password|prompt|reasoning|secret|token)/iu;

export function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function digestValue(value) {
  const input = typeof value === "string" ? value : JSON.stringify(canonicalize(value));
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if ((isRecord(value) || Array.isArray(value)) && !seen.has(value)) {
    seen.add(value);
    for (const child of Object.values(value)) deepFreeze(child, seen);
    Object.freeze(value);
  }
  return value;
}

export function immutable(value) {
  return deepFreeze(cloneJson(value));
}

export function assertRecord(value, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

export function assertString(value, label, { minimum = 1, maximum = 16_384 } = {}) {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || value.includes("\0")) {
    throw new TypeError(`${label} must be a string between ${minimum} and ${maximum} characters without NUL`);
  }
  return value;
}

export function assertDomainId(value, label) {
  assertString(value, label, { maximum: 128 });
  if (!DOMAIN_ID.test(value)) throw new TypeError(`${label} must be a canonical domain id`);
  return value;
}

export function assertOpaqueId(value, label) {
  assertString(value, label, { maximum: 512 });
  if (/\r|\n/u.test(value)) throw new TypeError(`${label} must not contain newlines`);
  return value;
}

export function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

export function assertBoolean(value, label) {
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

export function assertSafeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function normalizeStringSet(value, label, { id = false, maximumItems = 256 } = {}) {
  if (!Array.isArray(value) || value.length > maximumItems) throw new TypeError(`${label} must be an array with at most ${maximumItems} entries`);
  const output = value.map((item, index) => id
    ? assertDomainId(item, `${label}[${index}]`)
    : assertString(item, `${label}[${index}]`, { maximum: 256 }));
  if (new Set(output).size !== output.length) throw new TypeError(`${label} must not contain duplicates`);
  return output.sort();
}

export function assertRelativePath(value, label) {
  assertString(value, label, { maximum: 1_024 });
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || parts.includes("..") || parts.includes("")) {
    throw new TypeError(`${label} must be a contained relative path`);
  }
  return normalized;
}

function redacted(value, depth, seen) {
  if (depth > 6) return "[depth-limit]";
  if (typeof value === "string") return value.slice(0, 512);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => redacted(item, depth + 1, seen));
  if (!isRecord(value)) return String(value).slice(0, 128);
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const entries = [];
  for (const key of Object.keys(value).sort().slice(0, 64)) {
    entries.push([key, SENSITIVE_KEY.test(key) ? "[redacted]" : redacted(value[key], depth + 1, seen)]);
  }
  return Object.fromEntries(entries);
}

export function redactDetails(value) {
  return immutable(redacted(value, 0, new WeakSet()));
}

export function boundedProjection(value, maximumBytes = 64 * 1024) {
  assertSafeInteger(maximumBytes, "maximumBytes", { minimum: 256, maximum: 1024 * 1024 });
  const projected = redactDetails(value);
  const serialized = JSON.stringify(projected);
  if (Buffer.byteLength(serialized, "utf8") <= maximumBytes) return projected;
  return immutable({ truncated: true, digest: digestValue(serialized), originalBytes: Buffer.byteLength(serialized, "utf8") });
}

export const DOMAIN_PATTERNS = Object.freeze({ id: DOMAIN_ID, sha256: SHA256 });
