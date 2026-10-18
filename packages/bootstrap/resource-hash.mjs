import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function assertSafeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    fail("UNSAFE_RELATIVE_PATH", `${label} must be a non-empty portable relative path`);
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value === ".") {
    fail("UNSAFE_RELATIVE_PATH", `${label} must be a normalized relative path: ${value}`);
  }
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("UNSAFE_RELATIVE_PATH", `${label} contains an unsafe path segment: ${value}`);
  }
  return value;
}

async function* treeEntries(absolutePath, relativePath, options) {
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    if (!options.allowContainedSymlinks) {
      fail("RESOURCE_SYMLINK", `resource graph does not admit symlinks: ${relativePath}`);
    }
    let realTarget;
    try {
      realTarget = await fs.realpath(absolutePath);
    } catch (error) {
      fail("UNSAFE_TREE_SYMLINK", `managed tree contains a dangling symlink: ${relativePath}`, error);
    }
    if (realTarget !== options.realRoot && !realTarget.startsWith(`${options.realRoot}${path.sep}`)) {
      fail("UNSAFE_TREE_SYMLINK", `managed tree symlink escapes its root: ${relativePath}`);
    }
    const link = await fs.readlink(absolutePath);
    yield { type: "L", relativePath, link };
    return;
  }
  if (stat.isDirectory()) {
    yield { type: "D", relativePath };
    const names = await fs.readdir(absolutePath);
    names.sort();
    for (const name of names) {
      yield* treeEntries(
        path.join(absolutePath, name),
        relativePath === "." ? name : `${relativePath}/${name}`,
        options,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    fail("UNSUPPORTED_RESOURCE_TYPE", `resource graph only admits regular files and directories: ${relativePath}`);
  }
  yield { type: "F", relativePath, absolutePath };
}

async function hashTreeEntry(absolutePath, relativePath, hash, options) {
  // Prefetch a bounded window, then hash in the original depth-first order.
  // Every invocation reads fresh bytes; no file or admission result is cached.
  let pending = [];
  async function drain() {
    const results = await Promise.all(pending);
    pending = [];
    for (const result of results) {
      if (result.error) throw result.error;
      const { entry, bytes } = result;
      hash.update(`${entry.type}\0`);
      hash.update(entry.relativePath);
      hash.update("\0");
      if (entry.type === "L") {
        hash.update(entry.link);
        hash.update("\0");
      } else if (entry.type === "F") {
        hash.update(String(bytes.length));
        hash.update("\0");
        hash.update(bytes);
        hash.update("\0");
      }
    }
  }
  try {
    for await (const entry of treeEntries(absolutePath, relativePath, options)) {
      pending.push(entry.type === "F"
        ? fs.readFile(entry.absolutePath).then(bytes => ({ entry, bytes }), error => ({ error }))
        : Promise.resolve({ entry }));
      if (pending.length === 8) await drain();
    }
    await drain();
  } finally {
    // Complete pending reads before a rejection permits cleanup of the tree.
    await Promise.all(pending);
  }
}

export async function hashResourcePath({ artifactRoot, relativePath, allowContainedSymlinks = false }) {
  assertSafeRelativePath(relativePath, "resource path");
  const root = path.resolve(artifactRoot);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) {
    fail("RESOURCE_PATH_ESCAPE", `resource path escapes the artifact root: ${relativePath}`);
  }
  const hash = crypto.createHash("sha256");
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      fail("UNSAFE_RESOURCE_ROOT", "resource artifact root must be a real directory");
    }
    let current = root;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() && current !== absolutePath) {
        fail("RESOURCE_SYMLINK", `resource path traverses a symlink: ${relativePath}`);
      }
    }
    const realRoot = await fs.realpath(root);
    await hashTreeEntry(absolutePath, ".", hash, { root, realRoot, allowContainedSymlinks });
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("RESOURCE_MISSING", `resource path does not exist: ${relativePath}`);
    }
    throw error;
  }
  return hash.digest("hex");
}
