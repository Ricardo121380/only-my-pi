import { createHash, randomUUID } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  captureWorkspaceBaseline,
  normalizeRelativePath,
  parseGitStatusPorcelainV2,
  pathMatchesScope,
} from "./workspace.mjs";

const execFile = promisify(nodeExecFile);
const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_PATCH_BYTES = 16 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

export const WRITER_PATCH_FORMAT_VERSION = 1;
export const WRITER_PATCH_KIND = "omp-writer-patch";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    fail("MANAGED_CLONE_PATH_INVALID", `${label} must be an absolute path`);
  }
  return path.resolve(value);
}

function contained(root, target, code = "MANAGED_CLONE_PATH_ESCAPE") {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(code, "managed clone path escapes its private root");
  return path.resolve(target);
}

function digestBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function boundedBuffer(value, label) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""), "utf8");
  if (bytes.byteLength > MAX_GIT_OUTPUT_BYTES) fail("MANAGED_CLONE_OUTPUT_TOO_LARGE", `${label} exceeds the bounded output limit`);
  return bytes;
}

function safeRunId(value) {
  if (typeof value !== "string" || !RUN_ID.test(value)) fail("MANAGED_CLONE_RUN_ID_INVALID", "runId is invalid");
  return value;
}

function safeCommit(value) {
  if (typeof value !== "string" || !COMMIT.test(value)) fail("MANAGED_CLONE_BASE_COMMIT_INVALID", "baseCommit must be a full lowercase Git commit");
  return value;
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function assertNoSymlink(root, target, { allowMissing = true } = {}) {
  const base = absolute(root, "private root");
  const candidate = contained(base, absolute(target, "target"));
  let current = base;
  const relative = path.relative(base, candidate);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstatOrNull(current);
    if (!stat) {
      if (allowMissing) break;
      fail("MANAGED_CLONE_PATH_MISSING", `path is missing: ${path.relative(base, current)}`);
    }
    if (stat.isSymbolicLink()) fail("MANAGED_CLONE_SYMLINK_ESCAPE", "managed clone path may not traverse a symlink");
  }
  return candidate;
}

async function ensurePrivateDirectory(root, directory) {
  const base = absolute(root, "private root");
  const target = await assertNoSymlink(base, directory);
  await fs.mkdir(target, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("MANAGED_CLONE_PATH_UNSAFE", "managed clone directory must be a real directory");
  await fs.chmod(target, 0o700);
  return target;
}

async function defaultRunGit(cwd, args, options = {}) {
  const requestedEnvironment = options.env ?? {};
  const environment = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    LANG: "C",
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/usr/bin/false",
    SSH_ASKPASS: "/usr/bin/false",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "/dev/null",
    ...(typeof requestedEnvironment.GIT_INDEX_FILE === "string" ? { GIT_INDEX_FILE: requestedEnvironment.GIT_INDEX_FILE } : {}),
  };
  try {
    const result = await execFile("git", args, {
      cwd,
      encoding: "buffer",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      windowsHide: true,
      ...options,
      env: environment,
    });
    return { stdout: boundedBuffer(result.stdout, "git stdout"), stderr: boundedBuffer(result.stderr, "git stderr"), code: 0 };
  } catch (error) {
    return {
      stdout: boundedBuffer(error.stdout, "git stdout"),
      stderr: boundedBuffer(error.stderr ?? error.message, "git stderr"),
      code: Number.isInteger(error.code) ? error.code : 1,
    };
  }
}

function textOutput(value) { return Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? ""); }

async function requiredGit(runGit, cwd, args, label, options) {
  const result = await runGit(cwd, args, options);
  if (result?.code !== 0) fail("MANAGED_CLONE_GIT_FAILED", `${label} failed`, { stderr: textOutput(result?.stderr).slice(0, 1024) });
  return result;
}

async function assertRealDirectory(target, code = "MANAGED_CLONE_PATH_UNSAFE") {
  const stat = await fs.lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, "expected a real directory");
  return fs.realpath(target);
}

async function atomicWriteFile(root, target, bytes) {
  const base = absolute(root, "private root");
  const destination = contained(base, absolute(target, "destination"));
  await ensurePrivateDirectory(base, path.dirname(destination));
  await assertNoSymlink(base, destination);
  const temporary = path.join(path.dirname(destination), `.omp-patch-${process.pid}-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
  return destination;
}

function parseNulPaths(value) {
  return textOutput(value).split("\0").filter(Boolean).map((entry) => normalizeRelativePath(entry, "Git changed path"));
}

async function changedPaths(runGit, cloneRoot, baseCommit, statusOutput) {
  const tracked = await requiredGit(runGit, cloneRoot, ["diff", "--name-only", "-z", "--no-renames", baseCommit, "--"], "collect tracked writer changes");
  const paths = new Set(parseNulPaths(tracked.stdout));
  for (const entry of parseGitStatusPorcelainV2(textOutput(statusOutput)).paths) paths.add(entry.path);
  return [...paths].sort();
}

async function assertChangedPathsSafe(cloneRoot, paths, scope, runGit) {
  for (const relative of paths) {
    if (relative === ".git" || relative.startsWith(".git/")) fail("WRITER_PATCH_GIT_METADATA", "writer patch may not modify Git metadata");
    if (!pathMatchesScope(relative, scope)) fail("WRITER_PATCH_SCOPE_ESCAPE", `${relative} is outside the approved writer scope`, { path: relative });
    const target = contained(cloneRoot, path.resolve(cloneRoot, relative));
    const stat = await fs.lstat(target).catch((error) => { if (error?.code === "ENOENT") return null; throw error; });
    if (stat?.isSymbolicLink()) fail("WRITER_PATCH_SYMLINK", `${relative} is a symlink and cannot be integrated`, { path: relative });
    const mode = await runGit(cloneRoot, ["ls-files", "--stage", "-z", "--", relative]);
    if (mode.code === 0 && /(?:^|\0)160000\s/u.test(textOutput(mode.stdout))) fail("WRITER_PATCH_SUBMODULE", `${relative} is a submodule and cannot be integrated`, { path: relative });
  }
}

async function stageIntentToAdd(runGit, cloneRoot, indexPath) {
  const env = { GIT_INDEX_FILE: indexPath };
  await requiredGit(runGit, cloneRoot, ["read-tree", "HEAD"], "prepare isolated writer index", { env });
  await requiredGit(runGit, cloneRoot, ["add", "--intent-to-add", "--", "."], "index untracked writer files", { env });
  return env;
}

/**
 * Create a normal Git clone for the single production writer.
 * The clone contains committed files only and is never a Git worktree, so
 * project sandbox rules do not silently degrade in the writer process.
 */
export async function createManagedClone({ repositoryRoot, runId, baseCommit, runsRoot, runGit = defaultRunGit } = {}) {
  const source = await fs.realpath(absolute(repositoryRoot, "repositoryRoot"));
  const privateRunsRoot = await ensurePrivateDirectory(path.dirname(absolute(runsRoot, "runsRoot")), absolute(runsRoot, "runsRoot"));
  const id = safeRunId(runId);
  const commit = safeCommit(baseCommit);
  const runRoot = contained(privateRunsRoot, path.join(privateRunsRoot, id));
  await ensurePrivateDirectory(privateRunsRoot, runRoot);
  const clonesRoot = await ensurePrivateDirectory(privateRunsRoot, path.join(runRoot, "clones"));
  const cloneRoot = contained(clonesRoot, path.join(clonesRoot, "writer-1"));
  if (await lstatOrNull(cloneRoot)) fail("MANAGED_CLONE_ALREADY_EXISTS", "writer clone already exists for this run");
  await requiredGit(runGit, source, ["clone", "--no-local", "--no-checkout", source, cloneRoot], "create managed writer clone");
  try {
    await fs.chmod(cloneRoot, 0o700);
    await assertRealDirectory(cloneRoot);
    const top = textOutput((await requiredGit(runGit, cloneRoot, ["rev-parse", "--show-toplevel"], "verify managed clone root")).stdout).trim();
    const realTop = await fs.realpath(top);
    if (realTop !== await fs.realpath(cloneRoot)) fail("MANAGED_CLONE_ROOT_MISMATCH", "Git clone resolved to an unexpected root");
    await requiredGit(runGit, cloneRoot, ["checkout", "--detach", commit], "checkout approved writer base");
    const head = textOutput((await requiredGit(runGit, cloneRoot, ["rev-parse", "HEAD"], "verify writer base commit")).stdout).trim();
    if (head !== commit) fail("MANAGED_CLONE_BASE_COMMIT_MISMATCH", "managed clone did not reach the approved base commit");
  } catch (error) {
    await fs.rm(cloneRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return Object.freeze({
    formatVersion: 1,
    kind: "omp-managed-clone",
    runId: id,
    baseCommit: commit,
    repositoryRoot: source,
    runRoot,
    cloneRoot,
    patchRoot: path.join(runRoot, "artifacts"),
    runGit,
  });
}

/** Capture tracked and untracked writer changes as one bounded patch artifact. */
export async function captureWriterPatch({ cloneRoot, baseCommit, scope = [], patchRoot, runId = "writer", nodeId = "writer-1", runGit = defaultRunGit, now = () => new Date().toISOString() } = {}) {
  const root = await fs.realpath(absolute(cloneRoot, "cloneRoot"));
  const commit = safeCommit(baseCommit);
  if (!Array.isArray(scope) || scope.length === 0) fail("WRITER_PATCH_SCOPE_REQUIRED", "writer patch scope must be non-empty");
  const head = textOutput((await requiredGit(runGit, root, ["rev-parse", "HEAD"], "read writer HEAD")).stdout).trim();
  if (head !== commit) fail("WRITER_PATCH_BASE_DRIFT", "writer changed its base commit; commits are not accepted");
  const status = await requiredGit(runGit, root, ["status", "--porcelain=v2", "--branch", "-z"], "read writer status");
  // Keep Git's temporary index outside the tree scanned by intent-to-add.
  const indexRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-writer-index-"));
  const indexPath = path.join(indexRoot, "index");
  let diff;
  let diffPaths;
  try {
    const env = await stageIntentToAdd(runGit, root, indexPath);
    diff = await requiredGit(runGit, root, ["diff", "--binary", "--full-index", "--no-ext-diff", commit, "--"], "capture writer patch", { env });
    diffPaths = parseNulPaths((await requiredGit(runGit, root, ["diff", "--name-only", "-z", "--no-renames", commit, "--"], "verify captured writer paths", { env })).stdout).sort();
  } finally {
    await fs.rm(indexRoot, { recursive: true, force: true });
  }
  const patchBytes = boundedBuffer(diff.stdout, "writer patch");
  if (patchBytes.byteLength > MAX_PATCH_BYTES) fail("WRITER_PATCH_TOO_LARGE", "writer patch exceeds 16 MiB");
  const paths = await changedPaths(runGit, root, commit, status.stdout);
  if (JSON.stringify(diffPaths) !== JSON.stringify(paths)) fail("WRITER_PATCH_PATH_DRIFT", "captured patch paths differ from the verified writer paths");
  await assertChangedPathsSafe(root, paths, scope, runGit);
  if (patchBytes.byteLength === 0 || paths.length === 0) return Object.freeze({ formatVersion: WRITER_PATCH_FORMAT_VERSION, kind: WRITER_PATCH_KIND, status: "NO_CHANGES", baseCommit: commit, changedPaths: [] });
  if (patchBytes.includes(Buffer.from("Binary files ")) || patchBytes.includes(Buffer.from("\nGIT binary patch\n"))) fail("WRITER_PATCH_BINARY_UNAPPROVED", "binary writer changes require an explicit binary policy");
  const destinationRoot = await ensurePrivateDirectory(path.dirname(absolute(patchRoot, "patchRoot")), absolute(patchRoot, "patchRoot"));
  const patchPath = path.join(destinationRoot, `${safeRunId(runId)}-${safeRunId(nodeId)}.patch`);
  await atomicWriteFile(destinationRoot, patchPath, patchBytes);
  return Object.freeze({
    formatVersion: WRITER_PATCH_FORMAT_VERSION,
    kind: WRITER_PATCH_KIND,
    status: "READY",
    baseCommit: commit,
    changedPaths: Object.freeze(paths),
    bytes: patchBytes.byteLength,
    sha256: digestBytes(patchBytes),
    patchPath,
    createdAt: now(),
  });
}

export async function verifyWriterPatch({ patch, repositoryRoot, scope = [], runGit = defaultRunGit } = {}) {
  if (!patch || patch.formatVersion !== WRITER_PATCH_FORMAT_VERSION || patch.kind !== WRITER_PATCH_KIND || patch.status !== "READY") fail("WRITER_PATCH_INVALID", "writer patch contract is invalid");
  const root = await fs.realpath(absolute(repositoryRoot, "repositoryRoot"));
  const patchPath = await assertNoSymlink(path.dirname(absolute(patch.patchPath, "patchPath")), patch.patchPath, { allowMissing: false });
  const bytes = await fs.readFile(patchPath);
  if (bytes.byteLength !== patch.bytes || digestBytes(bytes) !== patch.sha256 || !DIGEST.test(patch.sha256)) fail("WRITER_PATCH_DIGEST_MISMATCH", "writer patch bytes changed");
  const head = textOutput((await requiredGit(runGit, root, ["rev-parse", "HEAD"], "read target HEAD")).stdout).trim();
  if (head !== patch.baseCommit) fail("WRITER_PATCH_BASE_DRIFT", "target repository HEAD changed before integration");
  await assertChangedPathsSafe(root, patch.changedPaths, scope, runGit);
  const check = await runGit(root, ["apply", "--check", "--binary", "--whitespace=error-all", patchPath]);
  if (check.code !== 0) fail("WRITER_PATCH_CONFLICT", "writer patch does not apply cleanly", { stderr: textOutput(check.stderr).slice(0, 1024) });
  return Object.freeze({ ok: true, status: "VERIFIED", patchDigest: patch.sha256, changedPaths: patch.changedPaths });
}

export async function applyWriterPatch({ patch, repositoryRoot, scope = [], baseline = null, runGit = defaultRunGit } = {}) {
  const verified = await verifyWriterPatch({ patch, repositoryRoot, scope, runGit });
  const root = await fs.realpath(absolute(repositoryRoot, "repositoryRoot"));
  if (baseline?.head && baseline.head !== patch.baseCommit) fail("WRITER_BASELINE_DRIFT", "writer base differs from the approved workspace baseline");
  const current = await captureWorkspaceBaseline({ cwd: root, runGit });
  const currentPaths = new Set((current.paths ?? []).map((entry) => entry.path));
  const baselinePaths = new Set((baseline?.paths ?? []).map((entry) => entry.path));
  const conflicts = patch.changedPaths.filter((entry) => currentPaths.has(entry) && (!baselinePaths.has(entry) || baseline?.pathDigests?.[entry]?.digest !== current.pathDigests?.[entry]?.digest));
  if (conflicts.length > 0) fail("WRITER_PATCH_WORKTREE_CONFLICT", "current worktree changed a writer path", { paths: conflicts });
  await requiredGit(runGit, root, ["apply", "--binary", "--whitespace=error-all", patch.patchPath], "apply verified writer patch");
  return Object.freeze({ ...verified, status: "APPLIED", repositoryRoot: root });
}

export function writerScopeOverlapsDirtyPaths(baseline, scope = []) {
  return Object.freeze((baseline?.paths ?? []).map((entry) => entry.path).filter((entry) => pathMatchesScope(entry, scope)));
}
