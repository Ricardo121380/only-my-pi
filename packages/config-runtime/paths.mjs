import fs from "node:fs/promises";
import path from "node:path";

const PORTABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class ConfigPathError extends Error {
  constructor(message, code = "UNSAFE_CONFIG_PATH") {
    super(`config-runtime: ${message}`);
    this.name = "ConfigPathError";
    this.code = code;
  }
}

function fail(message, code) {
  throw new ConfigPathError(message, code);
}

export function normalizeConfigRoot(configRoot) {
  if (typeof configRoot !== "string" || configRoot.length === 0) {
    fail("configRoot must be an explicit absolute path", "CONFIG_ROOT_REQUIRED");
  }
  if (configRoot.includes("\0")) fail("configRoot contains NUL");
  if (!path.isAbsolute(configRoot)) {
    fail("configRoot must be absolute", "CONFIG_ROOT_NOT_ABSOLUTE");
  }
  return path.resolve(configRoot);
}

export function validatePortableId(value, label = "id") {
  if (typeof value !== "string" || !PORTABLE_ID.test(value) || value === "." || value === "..") {
    fail(`invalid ${label}: ${String(value)}`, "INVALID_ID");
  }
  return value;
}

export function validateRelativeConfigPath(relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    fail("relative path must be a non-empty string");
  }
  if (relativePath.includes("\0")) fail("relative path contains NUL");
  if (relativePath.includes("\\")) fail(`backslash is not allowed: ${relativePath}`);
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    fail(`absolute path is not allowed: ${relativePath}`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized === "." || normalized === "..") {
    fail(`non-canonical relative path: ${relativePath}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    fail(`path traversal is not allowed: ${relativePath}`);
  }
  return normalized;
}

export function containedPath(configRoot, relativePath) {
  const root = normalizeConfigRoot(configRoot);
  const clean = validateRelativeConfigPath(relativePath);
  const target = path.resolve(root, ...clean.split("/"));
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail(`path escapes configRoot: ${relativePath}`);
  }
  return target;
}

export function relativeConfigPath(configRoot, absolutePath) {
  const root = normalizeConfigRoot(configRoot);
  if (typeof absolutePath !== "string" || !path.isAbsolute(absolutePath)) {
    fail("target path must be absolute");
  }
  const relative = path.relative(root, path.resolve(absolutePath)).split(path.sep).join("/");
  validateRelativeConfigPath(relative);
  return relative;
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Rejects symlinks and non-directory parents inside the trusted configRoot.
 * Ancestors above configRoot are deliberately outside this boundary; this
 * keeps explicit roots below platform aliases such as macOS /var usable.
 */
export async function assertSafeContainedPath(configRoot, target, options = {}) {
  const root = normalizeConfigRoot(configRoot);
  const absolute = path.resolve(target);
  const relative = relativeConfigPath(root, absolute);
  const rootStat = await lstatOrNull(root);
  if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) {
    fail(`configRoot is not a real directory: ${root}`, "UNSAFE_CONFIG_ROOT");
  }

  const parts = relative.split("/");
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = await lstatOrNull(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      fail(`symlink is not allowed inside configRoot: ${relativeConfigPath(root, current)}`, "SYMLINK_ESCAPE");
    }
    const isLeaf = index === parts.length - 1;
    if (!isLeaf && !stat.isDirectory()) {
      fail(`non-directory path component: ${relativeConfigPath(root, current)}`, "NON_DIRECTORY_PARENT");
    }
    if (isLeaf && options.leafType === "file" && !stat.isFile()) {
      fail(`target is not a regular file: ${relative}`, "INVALID_LEAF_TYPE");
    }
    if (isLeaf && options.leafType === "directory" && !stat.isDirectory()) {
      fail(`target is not a directory: ${relative}`, "INVALID_LEAF_TYPE");
    }
  }
  return absolute;
}

export async function ensureConfigDirectory(configRoot, relativePath, mode = 0o700) {
  const root = normalizeConfigRoot(configRoot);
  await fs.mkdir(root, { recursive: true, mode });
  const target = containedPath(root, relativePath);
  await assertSafeContainedPath(root, target);

  const parts = validateRelativeConfigPath(relativePath).split("/");
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const existing = await lstatOrNull(current);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        fail(`cannot create directory through unsafe component: ${relativeConfigPath(root, current)}`);
      }
      continue;
    }
    try {
      await fs.mkdir(current, { mode });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const raced = await lstatOrNull(current);
      if (!raced?.isDirectory() || raced.isSymbolicLink()) {
        fail(`concurrent directory creation produced an unsafe component: ${relativeConfigPath(root, current)}`);
      }
    }
  }
  await assertSafeContainedPath(root, target, { leafType: "directory" });
  return target;
}

export function configRuntimePaths(configRoot) {
  const root = normalizeConfigRoot(configRoot);
  return Object.freeze({
    configRoot: root,
    settingsFile: containedPath(root, "settings.json"),
    runtimeRoot: containedPath(root, "only-my-pi"),
    generationsRoot: containedPath(root, "only-my-pi/generations"),
    transactionsRoot: containedPath(root, "only-my-pi/transactions"),
    snapshotsRoot: containedPath(root, "only-my-pi/snapshots"),
    stateRoot: containedPath(root, "only-my-pi/state"),
    locksRoot: containedPath(root, "only-my-pi/locks"),
    configurationLock: containedPath(root, "only-my-pi/locks/configuration.lock"),
    lastKnownGoodFile: containedPath(root, "only-my-pi/state/last-known-good.json"),
  });
}
