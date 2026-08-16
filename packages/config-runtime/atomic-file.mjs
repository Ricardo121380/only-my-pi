import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertSafeContainedPath,
  containedPath,
  ensureConfigDirectory,
  normalizeConfigRoot,
  relativeConfigPath,
} from "./paths.mjs";

export const ATOMIC_WRITE_PHASES = Object.freeze([
  "BEFORE_OPEN",
  "AFTER_OPEN",
  "AFTER_WRITE",
  "AFTER_FILE_SYNC",
  "BEFORE_RENAME",
  "AFTER_RENAME",
  "AFTER_DIRECTORY_SYNC",
]);

export const ATOMIC_DIRECTORY_PHASES = Object.freeze([
  "AFTER_TEMP_DIRECTORY_CREATED",
  "AFTER_DIRECTORY_PREPARED",
  "BEFORE_DIRECTORY_RENAME",
  "AFTER_DIRECTORY_RENAME",
  "AFTER_DIRECTORY_SYNC",
]);

const ATOMIC_DIRECTORY_TEMPORARY = /^\.only-my-pi-dir-[1-9][0-9]*-[a-f0-9]{32}\.tmp$/u;

export class AtomicDirectoryPublicationError extends Error {
  constructor(message, code, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "AtomicDirectoryPublicationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function canonicalValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("config-runtime: canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("config-runtime: canonical JSON rejects cycles");
    seen.add(value);
    const output = value.map((entry) => canonicalValue(entry, seen));
    seen.delete(value);
    return output;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`config-runtime: canonical JSON rejects ${typeof value}`);
  }
  if (seen.has(value)) throw new TypeError("config-runtime: canonical JSON rejects cycles");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("config-runtime: canonical JSON accepts plain objects only");
  }
  seen.add(value);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`config-runtime: undefined JSON field: ${key}`);
    Object.defineProperty(output, key, {
      value: canonicalValue(value[key], seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return output;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function runPhase(options, phase, context) {
  if (options.failAtPhase === phase) {
    const error = new Error(`config-runtime: injected atomic write failure at ${phase}`);
    error.code = "INJECTED_ATOMIC_WRITE_FAILURE";
    error.phase = phase;
    throw error;
  }
  if (typeof options.onPhase === "function") await options.onPhase(phase, context);
}

async function runDirectoryPhase(options, phase, context) {
  if (options.failAtPhase === phase) {
    const error = new Error(`config-runtime: injected atomic directory failure at ${phase}`);
    error.code = "INJECTED_ATOMIC_DIRECTORY_FAILURE";
    error.phase = phase;
    throw error;
  }
  if (typeof options.onPhase === "function") await options.onPhase(phase, context);
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function targetFromInput(configRoot, target) {
  if (typeof target !== "string" || target.length === 0) {
    throw new TypeError("config-runtime: atomic write target is required");
  }
  if (path.isAbsolute(target)) {
    relativeConfigPath(configRoot, target);
    return path.resolve(target);
  }
  return containedPath(configRoot, target);
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export function isAtomicDirectoryTemporaryName(name) {
  return typeof name === "string" && ATOMIC_DIRECTORY_TEMPORARY.test(name);
}

/**
 * Prepare a complete directory under a private sibling name and publish it with
 * one rename. A crash during preparation can leave only an ignorable temporary
 * sibling; the final path is either absent or fully initialized.
 */
export async function atomicPublishDirectory(
  configRootInput,
  targetInput,
  prepare,
  options = {},
) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (typeof prepare !== "function") {
    throw new TypeError("config-runtime: atomic directory prepare callback is required");
  }
  const target = targetFromInput(configRoot, targetInput);
  const relative = relativeConfigPath(configRoot, target);
  const parentRelative = path.posix.dirname(relative);
  let parent;
  if (parentRelative === ".") {
    await fs.mkdir(configRoot, { recursive: true, mode: options.directoryMode ?? 0o700 });
    const rootStat = await fs.lstat(configRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new TypeError(`config-runtime: configRoot is not a real directory: ${configRoot}`);
    }
    parent = configRoot;
  } else {
    parent = await ensureConfigDirectory(configRoot, parentRelative, options.directoryMode ?? 0o700);
    await assertSafeContainedPath(configRoot, parent, { leafType: "directory" });
  }
  await assertSafeContainedPath(configRoot, target);
  if (await lstatOrNull(target)) {
    throw new AtomicDirectoryPublicationError(
      `atomic directory target already exists: ${relative}`,
      "ATOMIC_DIRECTORY_EXISTS",
      { target },
    );
  }

  const temporary = path.join(
    parent,
    `.only-my-pi-dir-${process.pid}-${crypto.randomBytes(16).toString("hex")}.tmp`,
  );
  relativeConfigPath(configRoot, temporary);
  const context = Object.freeze({ configRoot, target, temporary });
  let temporaryCreated = false;
  let published = false;
  try {
    await fs.mkdir(temporary, { mode: options.mode ?? 0o700 });
    temporaryCreated = true;
    await runDirectoryPhase(options, "AFTER_TEMP_DIRECTORY_CREATED", context);
    await prepare(Object.freeze({ configRoot, target, temporary }));
    await assertSafeContainedPath(configRoot, temporary, { leafType: "directory" });
    await syncDirectory(temporary);
    await runDirectoryPhase(options, "AFTER_DIRECTORY_PREPARED", context);
    await runDirectoryPhase(options, "BEFORE_DIRECTORY_RENAME", context);

    // The caller's last failure-injection/observation hook runs before these
    // containment and existence checks. No caller callback runs between this
    // check and rename.
    await assertSafeContainedPath(configRoot, target);
    if (await lstatOrNull(target)) {
      throw new AtomicDirectoryPublicationError(
        `atomic directory target already exists: ${relative}`,
        "ATOMIC_DIRECTORY_EXISTS",
        { target },
      );
    }
    try {
      await fs.rename(temporary, target);
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY"].includes(error.code)) {
        throw new AtomicDirectoryPublicationError(
          `atomic directory target already exists: ${relative}`,
          "ATOMIC_DIRECTORY_EXISTS",
          { target, cause: error },
        );
      }
      throw error;
    }
    published = true;
    await runDirectoryPhase(options, "AFTER_DIRECTORY_RENAME", context);
    await syncDirectory(parent);
    await runDirectoryPhase(options, "AFTER_DIRECTORY_SYNC", context);
    return Object.freeze({ path: target, durable: true, published: true });
  } catch (error) {
    if (!published && temporaryCreated) {
      await fs.rm(temporary, { recursive: true, force: true }).catch((cleanupError) => {
        error.cleanupError = cleanupError;
      });
    }
    error.atomicPublication = published ? "PUBLISHED_NOT_CONFIRMED_DURABLE" : "NOT_PUBLISHED";
    throw error;
  }
}

export async function atomicWriteText(configRootInput, targetInput, contents, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (typeof contents !== "string" && !Buffer.isBuffer(contents) && !(contents instanceof Uint8Array)) {
    throw new TypeError("config-runtime: atomic contents must be text or bytes");
  }
  const target = targetFromInput(configRoot, targetInput);
  const relative = relativeConfigPath(configRoot, target);
  const parentRelative = path.posix.dirname(relative);
  let parent;
  if (parentRelative === ".") {
    await fs.mkdir(configRoot, { recursive: true, mode: options.directoryMode ?? 0o700 });
    const rootStat = await fs.lstat(configRoot);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new TypeError(`config-runtime: configRoot is not a real directory: ${configRoot}`);
    }
    parent = configRoot;
  } else {
    parent = await ensureConfigDirectory(configRoot, parentRelative, options.directoryMode ?? 0o700);
  }
  await assertSafeContainedPath(configRoot, target);

  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  relativeConfigPath(configRoot, temporary);
  const context = Object.freeze({ configRoot, target, temporary });
  let handle;
  let renamed = false;
  try {
    await runPhase(options, "BEFORE_OPEN", context);
    handle = await fs.open(temporary, "wx", options.mode ?? 0o600);
    await runPhase(options, "AFTER_OPEN", context);
    await handle.writeFile(contents);
    await runPhase(options, "AFTER_WRITE", context);
    await handle.sync();
    await runPhase(options, "AFTER_FILE_SYNC", context);
    await handle.close();
    handle = undefined;

    // Recheck the path immediately before publication. rename replaces a leaf
    // symlink rather than following it, while symlinked parents are rejected.
    await assertSafeContainedPath(configRoot, target);
    await runPhase(options, "BEFORE_RENAME", context);
    if (typeof options.beforeRename === "function") await options.beforeRename(context);
    await fs.rename(temporary, target);
    renamed = true;
    await runPhase(options, "AFTER_RENAME", context);
    await syncDirectory(parent);
    await runPhase(options, "AFTER_DIRECTORY_SYNC", context);
    return { path: target, bytes: Buffer.byteLength(contents), durable: true };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (!renamed) await fs.unlink(temporary).catch((cleanupError) => {
      if (cleanupError.code !== "ENOENT") error.cleanupError = cleanupError;
    });
    error.atomicPublication = renamed ? "PUBLISHED_NOT_CONFIRMED_DURABLE" : "NOT_PUBLISHED";
    throw error;
  }
}

export async function atomicWriteJson(configRoot, target, value, options = {}) {
  const indent = options.pretty === false ? undefined : 2;
  const serialized = indent === undefined
    ? canonicalJson(value)
    : `${JSON.stringify(canonicalValue(value), null, indent)}\n`;
  return atomicWriteText(configRoot, target, serialized, options);
}

export async function readJsonObject(configRootInput, targetInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = targetFromInput(configRoot, targetInput);
  await assertSafeContainedPath(configRoot, target);
  let text;
  try {
    text = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && options.allowMissing) return null;
    throw error;
  }
  if (text.trim().length === 0) {
    const error = new SyntaxError(`config-runtime: empty JSON file: ${relativeConfigPath(configRoot, target)}`);
    error.code = "EMPTY_JSON";
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const error = new SyntaxError(`config-runtime: malformed JSON file: ${relativeConfigPath(configRoot, target)}`);
    error.code = "MALFORMED_JSON";
    error.cause = cause;
    throw error;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const error = new TypeError(`config-runtime: JSON root must be an object: ${relativeConfigPath(configRoot, target)}`);
    error.code = "INVALID_JSON_ROOT";
    throw error;
  }
  return value;
}

export async function hashFile(configRootInput, targetInput) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = targetFromInput(configRoot, targetInput);
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
  return sha256(await fs.readFile(target));
}

export async function durableRemoveFile(configRootInput, targetInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = targetFromInput(configRoot, targetInput);
  await assertSafeContainedPath(configRoot, target);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return Object.freeze({ path: target, removed: false, durable: true });
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError("config-runtime: durable removal target must be a regular file");
  }
  const parent = path.dirname(target);
  const tombstone = path.join(
    parent,
    `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.deleted`,
  );
  relativeConfigPath(configRoot, tombstone);
  const context = Object.freeze({ configRoot, target, tombstone });
  let published = false;
  try {
    if (typeof options.onPhase === "function") await options.onPhase("BEFORE_REMOVE_RENAME", context);
    if (typeof options.beforeRemoveRename === "function") await options.beforeRemoveRename(context);
    await fs.rename(target, tombstone);
    published = true;
    if (typeof options.onPhase === "function") await options.onPhase("AFTER_REMOVE_RENAME", context);
    await syncDirectory(parent);
    await fs.unlink(tombstone);
    await syncDirectory(parent);
    if (typeof options.onPhase === "function") await options.onPhase("AFTER_REMOVE_DIRECTORY_SYNC", context);
    return Object.freeze({ path: target, removed: true, durable: true });
  } catch (error) {
    error.atomicPublication = published ? "REMOVAL_PUBLISHED" : "NOT_PUBLISHED";
    throw error;
  }
}
