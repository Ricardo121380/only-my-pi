import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(nodeExecFile);
const MAX_STATUS_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const HASH = /^sha256:[a-f0-9]{64}$/u;

export const DESTRUCTIVE_GIT_CODES = Object.freeze({
  RESET: "DESTRUCTIVE_GIT_RESET",
  CLEAN: "DESTRUCTIVE_GIT_CLEAN",
  CHECKOUT: "DESTRUCTIVE_GIT_CHECKOUT",
  RESTORE: "DESTRUCTIVE_GIT_RESTORE",
  REVERT: "DESTRUCTIVE_GIT_REVERT",
  FORCE_PUSH: "DESTRUCTIVE_GIT_FORCE_PUSH",
  COMMIT: "AUTO_COMMIT_NOT_AUTHORIZED",
});

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function boundedOutput(value, label) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_STATUS_BYTES) {
    const error = new Error(`${label} exceeded the bounded output limit`);
    error.code = "WORKSPACE_OUTPUT_TOO_LARGE";
    throw error;
  }
  return text;
}

export function normalizeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    const error = new Error(`${label} must be a repository-relative POSIX path`);
    error.code = "WORKSPACE_PATH_INVALID";
    throw error;
  }
  const normalized = path.posix.normalize(value);
  if (normalized === ".." || normalized.startsWith("../") || normalized.split("/").some((part) => part === "..")) {
    const error = new Error(`${label} escapes the repository`);
    error.code = "WORKSPACE_PATH_ESCAPE";
    throw error;
  }
  return normalized === "." ? "." : normalized.replace(/^\.\//u, "");
}

function globToRegExp(pattern) {
  const normalized = pattern === "." ? "**" : pattern.replace(/^\.\//u, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          source += "(?:[^/]+/)*";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`${source}$`, "u");
}

export function pathMatchesScope(relativePath, scope = []) {
  const relative = normalizeRelativePath(relativePath);
  if (!Array.isArray(scope) || scope.length === 0) return false;
  return scope.some((pattern) => {
    if (typeof pattern !== "string") return false;
    try {
      return globToRegExp(normalizeRelativePath(pattern, "scope pattern")).test(relative);
    } catch {
      return false;
    }
  });
}

export function parseGitStatusPorcelainV2(output) {
  const text = boundedOutput(output, "git status");
  const records = text.split("\0").filter(Boolean);
  const paths = [];
  let head = null;
  let branch = null;
  for (const record of records) {
    if (record.startsWith("# branch.oid ")) {
      head = record.slice("# branch.oid ".length);
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      branch = record.slice("# branch.head ".length);
      continue;
    }
    if (record.startsWith("# ")) continue;
    const tab = record.indexOf("\t");
    let candidate;
    if (record.startsWith("? ")) candidate = record.slice(2);
    else if (tab === -1) candidate = record.slice(3).trim();
    else candidate = record.slice(tab + 1).split("\0")[0];
    if (candidate) {
      const normalized = normalizeRelativePath(candidate, "git status path");
      paths.push({ path: normalized, status: record.slice(0, 2), raw: record.slice(0, 256) });
    }
  }
  const unique = new Map(paths.map((entry) => [entry.path, entry]));
  return Object.freeze({ head, branch: branch === "(detached)" ? null : branch, paths: Object.freeze([...unique.values()].sort((left, right) => left.path.localeCompare(right.path))) });
}

async function digestPath(root, relative) {
  const absolute = path.resolve(root, relative);
  const relativeCheck = path.relative(root, absolute);
  if (relativeCheck.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCheck)) {
    const error = new Error("workspace path escaped root");
    error.code = "WORKSPACE_PATH_ESCAPE";
    throw error;
  }
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing", digest: null, bytes: 0 };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const target = await fs.readlink(absolute);
    return { kind: "symlink", digest: digestBytes(Buffer.from(target, "utf8")), bytes: Buffer.byteLength(target, "utf8"), target: target.slice(0, 1024) };
  }
  if (stat.isDirectory()) return { kind: "directory", digest: null, bytes: 0 };
  if (!stat.isFile()) return { kind: "other", digest: null, bytes: stat.size };
  if (stat.size > MAX_FILE_BYTES) return { kind: "file", digest: null, bytes: stat.size, oversized: true };
  const content = await fs.readFile(absolute);
  return { kind: "file", digest: digestBytes(content), bytes: stat.size };
}

async function defaultGit(cwd, args) {
  try {
    const result = await execFile("git", args, { cwd, encoding: "utf8", maxBuffer: MAX_STATUS_BYTES });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? String(error.message ?? error), code: Number.isInteger(error.code) ? error.code : 1 };
  }
}

export async function captureWorkspaceBaseline({ cwd, runGit = defaultGit } = {}) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) throw new TypeError("captureWorkspaceBaseline requires an absolute cwd");
  const root = await fs.realpath(cwd);
  const top = await runGit(root, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    return Object.freeze({ formatVersion: 1, status: "NOT_A_GIT_REPOSITORY", root, head: null, branch: null, dirty: false, paths: Object.freeze([]), pathDigests: Object.freeze({}), submodules: Object.freeze([]), capturedAt: new Date().toISOString() });
  }
  const gitRoot = await fs.realpath(String(top.stdout).trim());
  if (gitRoot !== root) {
    const error = new Error("cwd must be the Git repository root");
    error.code = "WORKSPACE_ROOT_MISMATCH";
    throw error;
  }
  const status = await runGit(root, ["status", "--porcelain=v2", "--branch", "-z"]);
  if (status.code !== 0) {
    const error = new Error("unable to read Git working-tree status");
    error.code = "WORKSPACE_STATUS_UNAVAILABLE";
    throw error;
  }
  const parsed = parseGitStatusPorcelainV2(status.stdout);
  const pathDigests = {};
  for (const entry of parsed.paths) pathDigests[entry.path] = await digestPath(root, entry.path);
  const submodules = [];
  const modules = await runGit(root, ["submodule", "status", "--recursive"]);
  if (modules.code === 0) {
    for (const line of String(modules.stdout).split("\n").map((item) => item.trim()).filter(Boolean)) {
      const match = line.match(/^[ +-]?([0-9a-f]{40})\s+([^ ]+)/u);
      if (match) submodules.push({ commit: match[1], path: normalizeRelativePath(match[2], "submodule path") });
    }
  }
  return Object.freeze({
    formatVersion: 1,
    status: "GIT_REPOSITORY",
    root,
    head: parsed.head,
    branch: parsed.branch,
    dirty: parsed.paths.length > 0,
    paths: Object.freeze(parsed.paths.map(({ path: itemPath, status: itemStatus }) => ({ path: itemPath, status: itemStatus }))),
    pathDigests: Object.freeze(pathDigests),
    submodules: Object.freeze(submodules),
    capturedAt: new Date().toISOString(),
  });
}

export function classifyWorkspaceChanges(baseline, current) {
  const before = new Map((baseline?.paths ?? []).map((entry) => [entry.path, entry]));
  const after = new Map((current?.paths ?? []).map((entry) => [entry.path, entry]));
  const all = new Set([...before.keys(), ...after.keys()]);
  const changes = [];
  for (const itemPath of [...all].sort()) {
    const previous = before.get(itemPath);
    const next = after.get(itemPath);
    const beforeDigest = baseline?.pathDigests?.[itemPath]?.digest ?? null;
    const afterDigest = current?.pathDigests?.[itemPath]?.digest ?? null;
    changes.push({
      path: itemPath,
      origin: previous ? "PRE_EXISTING" : "SESSION",
      state: next ? (previous ? "PRESENT" : "ADDED") : "REMOVED",
      statusBefore: previous?.status ?? null,
      statusAfter: next?.status ?? null,
      digestBefore: beforeDigest,
      digestAfter: afterDigest,
      changedBySession: !previous || beforeDigest !== afterDigest || previous?.status !== next?.status,
    });
  }
  return Object.freeze({
    formatVersion: 1,
    baselineHead: baseline?.head ?? null,
    currentHead: current?.head ?? null,
    changes: Object.freeze(changes),
    preExisting: Object.freeze(changes.filter((entry) => entry.origin === "PRE_EXISTING")),
    sessionChanges: Object.freeze(changes.filter((entry) => entry.changedBySession)),
  });
}

function shellHasDestructiveGit(command) {
  const normalized = command.trim();
  if (/(?:^|[;&|()]\s*)git\s+(?:-\S+\s+)*(?:reset|clean|checkout|restore|revert)\b/iu.test(normalized)) {
    if (/\bgit\s+(?:-\S+\s+)*reset\b/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.RESET, reason: "git reset can discard user or Agent changes" };
    if (/\bgit\s+(?:-\S+\s+)*clean\b/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.CLEAN, reason: "git clean can delete untracked user data" };
    if (/\bgit\s+(?:-\S+\s+)*checkout\b/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.CHECKOUT, reason: "git checkout can overwrite working-tree changes" };
    if (/\bgit\s+(?:-\S+\s+)*restore\b/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.RESTORE, reason: "git restore can overwrite working-tree changes" };
    return { code: DESTRUCTIVE_GIT_CODES.REVERT, reason: "git revert changes repository history" };
  }
  if (/(?:^|[;&|()]\s*)git\s+(?:-\S+\s+)*push\b[^;&|()]*\s(?:--force(?:-with-lease)?|-f)(?:\s|$)/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.FORCE_PUSH, reason: "force push is not permitted by the coding grant" };
  if (/(?:^|[;&|()]\s*)git\s+(?:-\S+\s+)*commit\b/iu.test(normalized)) return { code: DESTRUCTIVE_GIT_CODES.COMMIT, reason: "OMP does not create commits without an explicit user request" };
  return null;
}

export function inspectMutationCommand(command, { allowCommit = false } = {}) {
  if (typeof command !== "string" || command.length > 32_768 || /[\0\r]/u.test(command)) return { code: "BASH_COMMAND_INVALID", reason: "command is invalid or too large" };
  if (/[`]|\$\(/u.test(command)) return { code: "SHELL_EXPANSION_UNSUPPORTED", reason: "command substitution is not allowed in the OMP coding shell" };
  const destructive = shellHasDestructiveGit(command);
  if (destructive && !(allowCommit && destructive.code === DESTRUCTIVE_GIT_CODES.COMMIT)) return destructive;
  if (/(?:^|[\s;&|()])(?:\/|~\/|\.\.\/|\.\.\s|\$HOME\b|\$USERPROFILE\b)/u.test(command)) return { code: "PROJECT_PATH_ESCAPE", reason: "command contains a path that may leave the active project" };
  return null;
}

export function inspectMutationPath(inputPath, { cwd, scope = [] } = {}) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return { code: "WORKSPACE_ROOT_INVALID", reason: "active project root is invalid" };
  let relative;
  try {
    const absolute = path.resolve(cwd, inputPath);
    const candidate = path.relative(cwd, absolute);
    if (candidate.startsWith(`..${path.sep}`) || path.isAbsolute(candidate)) return { code: "PROJECT_PATH_ESCAPE", reason: "mutation path leaves the active project" };
    relative = normalizeRelativePath(candidate || ".");
  } catch (error) {
    return { code: error?.code ?? "WORKSPACE_PATH_INVALID", reason: error instanceof Error ? error.message : String(error) };
  }
  if (!pathMatchesScope(relative, scope)) return { code: "CODING_SCOPE_DENIED", reason: `${relative} is outside the approved coding scope` };
  return null;
}

export function createWorkspacePolicy({ baseline = null, scope = [] } = {}) {
  return Object.freeze({
    baseline,
    scope: Object.freeze([...scope]),
    inspectPath: (inputPath, options = {}) => inspectMutationPath(inputPath, { ...options, scope }),
    inspectCommand: (command, options = {}) => inspectMutationCommand(command, options),
    classify: (current) => classifyWorkspaceChanges(baseline, current),
  });
}

export function isWorkspaceDigest(value) {
  return typeof value === "string" && HASH.test(value);
}
