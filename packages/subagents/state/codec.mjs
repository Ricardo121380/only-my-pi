import crypto from "node:crypto";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("subagents state rejects non-finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol" || value === undefined) {
    throw new TypeError(`subagents state cannot encode ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError("subagents state rejects cyclic values");
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry, seen));
    if (!isPlainObject(value)) throw new TypeError("subagents state accepts plain JSON objects only");
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key], seen)]),
    );
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function jsonClone(value) {
  return JSON.parse(canonicalJson(value));
}

export function assertPlainJson(value, label = "value") {
  try {
    return jsonClone(value);
  } catch (cause) {
    throw new TypeError(`${label} must be canonical plain JSON`, { cause });
  }
}

export function withoutKey(value, key) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
