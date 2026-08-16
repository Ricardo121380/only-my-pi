import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  atomicPublishDirectory,
  atomicWriteJson,
  readJsonObject,
} from "./atomic-file.mjs";
import {
  assertSafeContainedPath,
  configRuntimePaths,
  ensureConfigDirectory,
  normalizeConfigRoot,
  relativeConfigPath,
} from "./paths.mjs";

const OPERATIONS = new Set(["apply", "rollback"]);

export class ConfigLockError extends Error {
  constructor(message, code, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "ConfigLockError";
    this.code = code;
    Object.assign(this, details);
  }
}

function timestamp(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("config-runtime: lock clock returned an invalid date");
  return date.toISOString();
}

function ageMilliseconds(isoTimestamp, now) {
  const then = Date.parse(isoTimestamp);
  const current = Date.parse(timestamp(now));
  return Number.isFinite(then) ? Math.max(0, current - then) : Number.POSITIVE_INFINITY;
}

function defaultIsOwnerAlive(owner) {
  if (owner.hostname !== os.hostname()) return true;
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return true;
  }
}

function validateOwner(owner) {
  if (!owner || typeof owner !== "object" || Array.isArray(owner)) return false;
  return owner.schemaVersion === 1
    && typeof owner.token === "string"
    && owner.token.length >= 16
    && OPERATIONS.has(owner.operation)
    && Number.isSafeInteger(owner.pid)
    && owner.pid > 0
    && typeof owner.hostname === "string"
    && Number.isFinite(Date.parse(owner.acquiredAt))
    && Number.isFinite(Date.parse(owner.heartbeatAt));
}

async function readOwner(configRoot, lockDirectory) {
  const ownerFile = path.join(lockDirectory, "owner.json");
  try {
    const owner = await readJsonObject(configRoot, ownerFile);
    if (!validateOwner(owner)) return { status: "CORRUPT", owner: null, ownerFile };
    return { status: "OWNED", owner, ownerFile };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "INITIALIZING", owner: null, ownerFile };
    if (["EMPTY_JSON", "MALFORMED_JSON", "INVALID_JSON_ROOT"].includes(error.code)) {
      return { status: "CORRUPT", owner: null, ownerFile, cause: error };
    }
    throw error;
  }
}

export async function inspectConfigLock(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const lockDirectory = options.lockDirectory ?? configRuntimePaths(configRoot).configurationLock;
  relativeConfigPath(configRoot, lockDirectory);
  await assertSafeContainedPath(configRoot, lockDirectory);
  let stat;
  try {
    stat = await fs.lstat(lockDirectory);
  } catch (error) {
    if (error.code === "ENOENT") return Object.freeze({ status: "FREE", stale: false, owner: null });
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConfigLockError("configuration lock path is unsafe", "CORRUPT_LOCK");
  }
  const read = await readOwner(configRoot, lockDirectory);
  const heartbeat = read.owner?.heartbeatAt ?? stat.mtime.toISOString();
  const ageMs = ageMilliseconds(heartbeat, options.now);
  const staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs < 1) {
    throw new TypeError("config-runtime: staleAfterMs must be a positive finite number");
  }
  const alive = read.owner
    ? await (options.isOwnerAlive ?? defaultIsOwnerAlive)(read.owner)
    : true;
  const stale = read.status === "OWNED" && ageMs > staleAfterMs && alive === false;
  return Object.freeze({
    status: read.status,
    stale,
    ageMs,
    owner: read.owner ? Object.freeze({ ...read.owner }) : null,
  });
}

async function createOwnedLock(configRoot, lockDirectory, owner, options) {
  try {
    await atomicPublishDirectory(
      configRoot,
      lockDirectory,
      async ({ temporary }) => {
        await atomicWriteJson(
          configRoot,
          path.join(temporary, "owner.json"),
          owner,
          options.atomic ?? {},
        );
      },
      options.directoryAtomic ?? {},
    );
    return true;
  } catch (error) {
    if (error.code === "ATOMIC_DIRECTORY_EXISTS") return false;
    throw error;
  }
}

async function reclaimStaleLock(configRoot, lockDirectory, owner, options) {
  const reclaimDirectory = `${lockDirectory}.reclaim`;
  relativeConfigPath(configRoot, reclaimDirectory);
  try {
    await fs.mkdir(reclaimDirectory, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new ConfigLockError("another process is reclaiming the stale lock", "LOCK_RECLAIMING");
    }
    throw error;
  }

  let staleArchive;
  try {
    const latest = await inspectConfigLock(configRoot, options);
    if (!latest.stale) {
      throw new ConfigLockError("configuration lock is no longer stale", "LOCK_HELD", { holder: latest.owner });
    }
    staleArchive = `${lockDirectory}.stale-${crypto.randomBytes(8).toString("hex")}`;
    relativeConfigPath(configRoot, staleArchive);
    await fs.rename(lockDirectory, staleArchive);
    const created = await createOwnedLock(configRoot, lockDirectory, owner, options);
    if (!created) {
      throw new ConfigLockError("configuration lock was acquired during stale recovery", "LOCK_HELD");
    }
    await fs.rm(staleArchive, { recursive: true, force: true });
    staleArchive = undefined;
    return true;
  } finally {
    await fs.rm(reclaimDirectory, { recursive: true, force: true }).catch(() => {});
    if (staleArchive) {
      // An archive is never restored over a newly acquired lock. It remains
      // inspectable if publication failed after the stale lock was isolated.
    }
  }
}

export async function acquireConfigLock(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const operation = options.operation ?? "apply";
  if (!OPERATIONS.has(operation)) throw new TypeError(`config-runtime: invalid lock operation: ${operation}`);
  const token = options.ownerToken ?? crypto.randomUUID();
  if (typeof token !== "string" || token.length < 16) throw new TypeError("config-runtime: owner token is too short");
  const paths = configRuntimePaths(configRoot);
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, paths.locksRoot));
  const lockDirectory = options.lockDirectory ?? paths.configurationLock;
  relativeConfigPath(configRoot, lockDirectory);
  const acquiredAt = timestamp(options.now);
  const owner = Object.freeze({
    schemaVersion: 1,
    token,
    operation,
    pid: options.pid ?? process.pid,
    hostname: options.hostname ?? os.hostname(),
    acquiredAt,
    heartbeatAt: acquiredAt,
  });
  if (!validateOwner(owner)) {
    throw new TypeError("config-runtime: lock owner metadata is invalid");
  }

  let acquired = await createOwnedLock(configRoot, lockDirectory, owner, options);
  if (!acquired) {
    const inspection = await inspectConfigLock(configRoot, options);
    if (inspection.stale) {
      acquired = await reclaimStaleLock(configRoot, lockDirectory, owner, options);
    } else {
      throw new ConfigLockError(
        `configuration is locked for ${inspection.owner?.operation ?? inspection.status.toLowerCase()}`,
        inspection.status === "CORRUPT" ? "CORRUPT_LOCK" : "LOCK_HELD",
        { holder: inspection.owner, status: inspection.status },
      );
    }
  }

  let released = false;
  async function assertOwnership() {
    if (released) throw new ConfigLockError("lock handle was already released", "LOCK_RELEASED");
    const current = await readOwner(configRoot, lockDirectory);
    if (current.status !== "OWNED" || current.owner.token !== token) {
      throw new ConfigLockError("lock ownership token changed", "LOCK_OWNERSHIP_LOST", { holder: current.owner });
    }
    return current.owner;
  }

  return Object.freeze({
    configRoot,
    lockDirectory,
    token,
    operation,
    owner,
    async refresh(refreshOptions = {}) {
      const current = await assertOwnership();
      const refreshed = { ...current, heartbeatAt: timestamp(refreshOptions.now ?? options.now) };
      await atomicWriteJson(configRoot, path.join(lockDirectory, "owner.json"), refreshed, refreshOptions.atomic ?? {});
      return Object.freeze(refreshed);
    },
    async release() {
      await assertOwnership();
      await fs.rm(lockDirectory, { recursive: true, force: false });
      released = true;
      return Object.freeze({ released: true, token });
    },
  });
}

export async function withConfigLock(configRoot, options, callback) {
  if (typeof callback !== "function") throw new TypeError("config-runtime: lock callback is required");
  const lock = await acquireConfigLock(configRoot, options);
  try {
    return await callback(lock);
  } finally {
    await lock.release();
  }
}

export async function releaseConfigLock(lock) {
  if (!lock || typeof lock.release !== "function") {
    throw new TypeError("config-runtime: an acquired lock handle is required");
  }
  return lock.release();
}
