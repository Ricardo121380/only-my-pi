import { canonicalJson, sha256 } from "./atomic-file.mjs";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`config-runtime: ${label} must be a plain object`);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(output, key, {
        value: clone(entry),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  }
  return value;
}

function decodePointerToken(token) {
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

function encodePointerToken(token) {
  return token.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function normalizeOwnedPath(input) {
  let parts;
  if (Array.isArray(input)) {
    parts = [...input];
  } else if (typeof input === "string" && input.startsWith("/") && input.length > 1) {
    parts = input.slice(1).split("/").map(decodePointerToken);
  } else {
    throw new TypeError("config-runtime: owned paths must be non-root JSON pointers or string arrays");
  }
  if (parts.length === 0 || parts.some((part) => typeof part !== "string" || part.length === 0 || FORBIDDEN_KEYS.has(part))) {
    throw new TypeError(`config-runtime: invalid owned path: ${JSON.stringify(input)}`);
  }
  return parts;
}

export function ownedPathPointer(input) {
  return `/${normalizeOwnedPath(input).map(encodePointerToken).join("/")}`;
}

export function normalizeOwnedPaths(inputs) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new TypeError("config-runtime: at least one owned path is required");
  }
  const paths = inputs.map(normalizeOwnedPath);
  paths.sort((left, right) => ownedPathPointer(left).localeCompare(ownedPathPointer(right)));
  for (let index = 0; index < paths.length; index += 1) {
    const current = paths[index];
    if (index > 0 && ownedPathPointer(paths[index - 1]) === ownedPathPointer(current)) {
      throw new TypeError(`config-runtime: duplicate owned path: ${ownedPathPointer(current)}`);
    }
    for (let otherIndex = 0; otherIndex < paths.length; otherIndex += 1) {
      if (index === otherIndex) continue;
      const other = paths[otherIndex];
      if (current.length < other.length && current.every((part, partIndex) => part === other[partIndex])) {
        throw new TypeError(
          `config-runtime: overlapping owned paths: ${ownedPathPointer(current)} and ${ownedPathPointer(other)}`,
        );
      }
    }
  }
  return paths;
}

function lookup(object, parts) {
  let current = object;
  for (const part of parts) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return { present: false, value: undefined };
    current = current[part];
  }
  return { present: true, value: current };
}

function setPath(object, parts, value) {
  let current = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!Object.hasOwn(current, part)) current[part] = {};
    if (!isPlainObject(current[part])) {
      throw new TypeError(`config-runtime: cannot write owned child below non-object: /${parts.slice(0, index + 1).join("/")}`);
    }
    current = current[part];
  }
  current[parts.at(-1)] = clone(value);
}

function deletePath(object, parts) {
  let current = object;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return;
    current = current[part];
  }
  if (isPlainObject(current)) delete current[parts.at(-1)];
}

export function extractOwnedSettings(settings, ownedPaths) {
  assertPlainObject(settings, "settings");
  const normalized = normalizeOwnedPaths(ownedPaths);
  const values = {};
  const present = [];
  for (const parts of normalized) {
    const found = lookup(settings, parts);
    if (!found.present) continue;
    setPath(values, parts, found.value);
    present.push(ownedPathPointer(parts));
  }
  return Object.freeze({
    paths: normalized.map(ownedPathPointer),
    present: Object.freeze(present),
    values,
  });
}

export function mergeOwnedSettings(existingSettings, desiredSettings, ownedPaths) {
  assertPlainObject(existingSettings, "existing settings");
  assertPlainObject(desiredSettings, "desired settings");
  const normalized = normalizeOwnedPaths(ownedPaths);
  const output = clone(existingSettings);
  for (const parts of normalized) {
    const desired = lookup(desiredSettings, parts);
    if (desired.present) setPath(output, parts, desired.value);
    else deletePath(output, parts);
  }
  return output;
}

export function removeOwnedSettings(existingSettings, ownedPaths) {
  return mergeOwnedSettings(existingSettings, {}, ownedPaths);
}

export function restoreOwnedSettings(existingSettings, snapshot, ownedPaths = snapshot?.paths) {
  assertPlainObject(existingSettings, "existing settings");
  if (!snapshot || typeof snapshot !== "object") throw new TypeError("config-runtime: owned snapshot is required");
  const normalized = normalizeOwnedPaths(ownedPaths);
  const expectedPointers = normalized.map(ownedPathPointer);
  const snapshotPointers = [...(snapshot.paths ?? [])].sort();
  if (canonicalJson(expectedPointers) !== canonicalJson(snapshotPointers)) {
    throw new Error("config-runtime: snapshot ownership does not match requested ownership");
  }
  assertPlainObject(snapshot.values ?? {}, "snapshot values");
  const present = new Set(snapshot.present ?? []);
  for (const pointer of present) {
    if (!expectedPointers.includes(pointer)) throw new Error(`config-runtime: snapshot contains unowned value: ${pointer}`);
  }

  const desired = {};
  for (const parts of normalized) {
    const pointer = ownedPathPointer(parts);
    const value = lookup(snapshot.values, parts);
    if (present.has(pointer)) {
      if (!value.present) throw new Error(`config-runtime: snapshot is missing owned value: ${pointer}`);
      setPath(desired, parts, value.value);
    }
  }
  return mergeOwnedSettings(existingSettings, desired, normalized);
}

export function ownedSettingsDigest(settings) {
  assertPlainObject(settings, "settings");
  return sha256(canonicalJson(settings));
}
