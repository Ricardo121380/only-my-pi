import { execFile } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createWriterHandoff, validateIntegrationHandoff } from "../policy/writer-handoff.mjs";
import { sha256 } from "../state/codec.mjs";

const execFileAsync = promisify(execFile);
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const FULL_COMMIT = /^[a-f0-9]{40}$/u;

export class GuardedWriterVerificationError extends Error {
  constructor(message, code, details = {}) {
    super(`guarded writer verifier: ${message}`);
    this.name = "GuardedWriterVerificationError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new GuardedWriterVerificationError(message, code, details);
}

function contained(root, candidate, code = "WRITER_PATH_ESCAPE") {
  if (typeof root !== "string" || typeof candidate !== "string" || !path.isAbsolute(root) || !path.isAbsolute(candidate)) {
    fail("verification paths must be absolute", code);
  }
  const absoluteRoot = path.resolve(root);
  const absoluteCandidate = path.resolve(candidate);
  const relative = path.relative(absoluteRoot, absoluteCandidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("verification path escapes its governed root", code);
  }
  return absoluteCandidate;
}

async function safeRealDirectory(root, target) {
  try {
    const lexicalRoot = path.resolve(root);
    const absolute = contained(lexicalRoot, target, "WRITER_WORKTREE_PATH_ESCAPE");
    const relative = path.relative(lexicalRoot, absolute);
    let current = lexicalRoot;
    for (const segment of relative.split(path.sep)) {
      if (!segment) continue;
      current = path.join(current, segment);
      const stat = await fsPromises.lstat(current);
      if (stat.isSymbolicLink()) fail("symlinked worktree path is forbidden", "WRITER_SYMLINK_FORBIDDEN");
    }
    const absoluteRoot = await fsPromises.realpath(lexicalRoot);
    const real = await fsPromises.realpath(absolute);
    contained(absoluteRoot, real, "WRITER_WORKTREE_PATH_ESCAPE");
    if (real !== path.join(absoluteRoot, relative)) {
      fail("worktree path does not resolve canonically", "WRITER_SYMLINK_FORBIDDEN");
    }
    const stat = await fsPromises.lstat(real);
    if (!stat.isDirectory()) fail("preserved worktree is unavailable", "WRITER_WORKTREE_UNAVAILABLE");
    return real;
  } catch (cause) {
    if (cause instanceof GuardedWriterVerificationError) throw cause;
    fail("preserved worktree is unavailable", "WRITER_WORKTREE_UNAVAILABLE");
  }
}

async function safeRegularFile(root, target, maximum = MAX_MANIFEST_BYTES) {
  try {
    const absolute = contained(root, target);
    const relative = path.relative(path.resolve(root), absolute);
    let current = path.resolve(root);
    for (const segment of relative.split(path.sep)) {
      if (!segment) continue;
      current = path.join(current, segment);
      const stat = await fsPromises.lstat(current);
      if (stat.isSymbolicLink()) fail("symlinked verification artifact is forbidden", "WRITER_SYMLINK_FORBIDDEN");
    }
    const stat = await fsPromises.lstat(absolute);
    if (!stat.isFile() || stat.size < 2 || stat.size > maximum) {
      fail("verification artifact must be a bounded regular file", "WRITER_ARTIFACT_INVALID");
    }
    return absolute;
  } catch (cause) {
    if (cause instanceof GuardedWriterVerificationError) throw cause;
    fail("verification artifact is unavailable", "WRITER_ARTIFACT_INVALID");
  }
}

function oneString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) fail(`${label} is invalid`, "WRITER_HANDOFF_MANIFEST_INVALID");
  return value;
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.version !== 1 || !["parallel", "chain"].includes(manifest.mode)
    || !["foreground", "async"].includes(manifest.source) || !Array.isArray(manifest.groups)
    || manifest.groups.length !== 1) {
    fail("upstream handoff manifest shape is invalid", "WRITER_HANDOFF_MANIFEST_INVALID");
  }
  oneString(manifest.runId, "manifest runId");
  oneString(manifest.cwd, "manifest cwd");
  const group = manifest.groups[0];
  if (!FULL_COMMIT.test(group?.baseCommit ?? "") || !Array.isArray(group?.children)
    || group.children.length !== 1 || !Array.isArray(group?.cleanup?.tasks)
    || group.cleanup.tasks.length !== 1) {
    fail("upstream handoff group shape is invalid", "WRITER_HANDOFF_MANIFEST_INVALID");
  }
  const child = group.children[0];
  const cleanup = group.cleanup.tasks[0];
  if (child?.status !== "completed" || child?.patch?.changed !== true
    || typeof child.patch.path !== "string" || typeof child.patch.branch !== "string"
    || cleanup?.preserved !== true || cleanup.worktreeRemoved !== false
    || cleanup.branchRemoved !== false || cleanup.path !== undefined && typeof cleanup.path !== "string") {
    fail("upstream writer handoff is not a preserved completed change", "WRITER_HANDOFF_MANIFEST_INVALID");
  }
  if (cleanup.path === undefined || cleanup.branch !== child.patch.branch) {
    fail("upstream worktree identity is incomplete", "WRITER_WORKTREE_IDENTITY_INVALID");
  }
  return { group, child, cleanup };
}

export function extractPiSubagentsHandoffPath(terminalReceipt) {
  if (terminalReceipt?.authoritative !== true || terminalReceipt?.outcome !== "completed") {
    fail("authoritative completed terminal receipt is required", "WRITER_TERMINAL_PROOF_REQUIRED");
  }
  const candidates = [];
  const visit = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 32)) visit(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (typeof value.parallelHandoff?.path === "string") candidates.push(value.parallelHandoff.path);
    if (typeof value.artifactPaths?.outputPath === "string" && /handoff.*\.json$/u.test(path.basename(value.artifactPaths.outputPath))) {
      candidates.push(value.artifactPaths.outputPath);
    }
    for (const [key, child] of Object.entries(value).slice(0, 64)) {
      if (["completion", "processTerminal"].includes(key)) continue;
      visit(child, depth + 1);
    }
  };
  visit(terminalReceipt.result);
  const unique = [...new Set(candidates)];
  if (unique.length !== 1 || !path.isAbsolute(unique[0])) {
    fail("terminal receipt must expose exactly one absolute handoff manifest path", "WRITER_HANDOFF_REFERENCE_INVALID", { count: unique.length });
  }
  return unique[0];
}

export function createGuardedWriterGitRunner({ gitCommand = "git", env = process.env } = {}) {
  return async ({ cwd, argv }) => {
    if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string" || part.includes("\0"))) {
      fail("git argv is invalid", "WRITER_GIT_COMMAND_INVALID");
    }
    try {
      const result = await execFileAsync(gitCommand, argv, {
        cwd,
        env: {
          PATH: env.PATH ?? "/usr/bin:/bin",
          HOME: env.HOME,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          LC_ALL: "C",
        },
        encoding: "buffer",
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: 30_000,
        windowsHide: true,
      });
      return { status: 0, stdout: Buffer.from(result.stdout ?? ""), stderr: Buffer.from(result.stderr ?? "") };
    } catch (error) {
      return {
        status: Number.isInteger(error?.code) ? error.code : 1,
        stdout: Buffer.from(error?.stdout ?? ""),
        stderr: Buffer.from(error?.stderr ?? error?.message ?? ""),
      };
    }
  };
}

async function git(runGit, cwd, argv, code = "WRITER_GIT_VERIFICATION_FAILED") {
  const result = await runGit({ cwd, argv: [...argv] });
  const stdout = Buffer.from(result?.stdout ?? "");
  const stderr = Buffer.from(result?.stderr ?? "");
  if (stdout.byteLength + stderr.byteLength > MAX_GIT_OUTPUT_BYTES) fail("git verification output exceeded its bound", "WRITER_GIT_OUTPUT_TOO_LARGE");
  if (result?.status !== 0) fail("git verification command failed", code, { argv, status: result?.status });
  return stdout;
}

function nulStrings(buffer) {
  const values = Buffer.from(buffer).toString("utf8").split("\0");
  if (values.at(-1) === "") values.pop();
  if (values.some((value) => value.length === 0 || value.includes("\n") || value.includes("\r"))) {
    fail("git returned an invalid path record", "WRITER_GIT_OUTPUT_INVALID");
  }
  return values;
}

function gateReceipt(gateId, status, detail) {
  return {
    gateId,
    status,
    receiptDigest: sha256({ gateId, status, detail }),
  };
}

export async function verifyGuardedWriterWorktree({
  assignment,
  terminalReceipt,
  artifactRoot,
  worktreeRoot,
  fixtureRoot,
  manifestPath = extractPiSubagentsHandoffPath(terminalReceipt),
  expectedMarker,
  requiredGateIds = ["diff-check", "fixture-content"],
  runGit = createGuardedWriterGitRunner(),
} = {}) {
  if (assignment?.kind !== "task-assignment" || assignment.ownership?.writer !== true
    || assignment.ownership?.workspace !== "managed-worktree") {
    fail("a managed-worktree writer TaskAssignment is required", "WRITER_ASSIGNMENT_REQUIRED");
  }
  if (typeof expectedMarker !== "string" || expectedMarker.length < 1 || expectedMarker.length > 128) {
    fail("expected fixture marker is invalid", "WRITER_MARKER_INVALID");
  }
  const safeManifestPath = await safeRegularFile(artifactRoot, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await fsPromises.readFile(safeManifestPath, "utf8"));
  } catch {
    fail("handoff manifest is not valid JSON", "WRITER_HANDOFF_MANIFEST_INVALID");
  }
  const { group, child, cleanup } = validateManifestShape(manifest);
  let expectedFixture;
  let manifestRepository;
  let manifestCwd;
  try {
    expectedFixture = await fsPromises.realpath(fixtureRoot);
    manifestRepository = await fsPromises.realpath(group.repoRoot);
    manifestCwd = await fsPromises.realpath(manifest.cwd);
  } catch {
    fail("handoff repository is unavailable", "WRITER_BASE_COMMIT_DRIFT");
  }
  if (manifestRepository !== expectedFixture
    || manifestCwd !== expectedFixture
    || group.baseCommit !== assignment.ownership.baseCommit) {
    fail("handoff repository or base commit differs from the assignment", "WRITER_BASE_COMMIT_DRIFT");
  }
  const worktree = await safeRealDirectory(worktreeRoot, cleanup.path);
  await safeRegularFile(artifactRoot, child.patch.path, MAX_GIT_OUTPUT_BYTES);
  const head = (await git(runGit, worktree, ["rev-parse", "HEAD"])).toString("utf8").trim();
  if (head !== assignment.ownership.baseCommit) fail("worktree HEAD differs from the approved base", "WRITER_BASE_COMMIT_DRIFT");
  const status = nulStrings(await git(runGit, worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  if (status.some((entry) => entry.startsWith("?? "))) fail("untracked writer output is forbidden", "WRITER_UNTRACKED_PATH_FORBIDDEN");
  const unstagedPaths = nulStrings(await git(runGit, worktree, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"])).sort();
  if (unstagedPaths.length > 0) {
    fail("writer worktree contains changes outside the staged handoff", "WRITER_UNSTAGED_CHANGE_FORBIDDEN", { unstagedPaths });
  }
  const changedPaths = nulStrings(await git(runGit, worktree, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", assignment.ownership.baseCommit, "--"])).sort();
  if (changedPaths.length === 0) fail("writer worktree contains no staged change", "WRITER_EMPTY_DIFF");
  if (JSON.stringify(changedPaths) !== JSON.stringify(assignment.ownership.fileClaims)) {
    fail("writer changed paths outside the exact declared claims", "WRITER_CHANGED_PATH_OUTSIDE_CLAIMS", { changedPaths });
  }
  for (const changedPath of changedPaths) {
    const entries = (await git(runGit, worktree, ["ls-files", "-s", "--", changedPath])).toString("utf8").trim().split("\n").filter(Boolean);
    if (entries.length !== 1 || !/^100(?:644|755) [a-f0-9]{40,64} 0\t/u.test(entries[0])) {
      fail("writer changed a symlink, submodule, or unsupported file mode", "WRITER_FILE_MODE_FORBIDDEN", { changedPath });
    }
  }
  const patch = await git(runGit, worktree, ["diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", assignment.ownership.baseCommit, "--"]);
  await git(runGit, worktree, ["diff", "--cached", "--check", "--no-ext-diff", "--no-textconv", assignment.ownership.baseCommit, "--"], "WRITER_DIFF_CHECK_FAILED");
  const markerPath = await safeRegularFile(worktree, path.join(worktree, assignment.ownership.fileClaims[0]), 64 * 1024);
  const markerContent = await fsPromises.readFile(markerPath, "utf8");
  if (!markerContent.includes(expectedMarker)) fail("writer fixture content gate failed", "WRITER_FIXTURE_CONTENT_FAILED");
  const patchDigest = sha256(patch);
  const pathReceipt = sha256({
    assignmentHash: assignment.assignmentHash,
    baseCommit: assignment.ownership.baseCommit,
    changedPaths,
    patchDigest,
    worktreeBranch: cleanup.branch,
  });
  const gateReceipts = [
    gateReceipt("diff-check", "PASS", { baseCommit: assignment.ownership.baseCommit, patchDigest }),
    gateReceipt("fixture-content", "PASS", { expectedMarker: sha256(expectedMarker), changedPaths }),
  ].sort((left, right) => left.gateId.localeCompare(right.gateId));
  const handoff = createWriterHandoff({
    assignment,
    terminalReceipt,
    changedPaths,
    patchDigest,
    pathEnforcement: { state: "ENFORCED", mechanism: "parent-diff-verification", receiptDigest: pathReceipt },
    gateReceipts,
    artifactRefs: ["pi-subagents-worktree-handoff"],
  });
  const integration = validateIntegrationHandoff(handoff, {
    currentBaseCommit: assignment.ownership.baseCommit,
    requiredGateIds,
  });
  return Object.freeze({
    formatVersion: 1,
    status: "HANDOFF_READY_FOR_OPERATOR_REVIEW",
    manifestDigest: sha256(manifest),
    worktreeReceiptDigest: sha256({ manifestDigest: sha256(manifest), pathReceipt, branch: cleanup.branch }),
    baseCommitDigest: sha256(assignment.ownership.baseCommit),
    taskAssignmentDigest: sha256({ assignmentId: assignment.assignmentId, assignmentHash: assignment.assignmentHash }),
    terminalReceiptDigest: sha256({ receiptId: terminalReceipt.receiptId, outcome: terminalReceipt.outcome }),
    parentDiffVerificationDigest: pathReceipt,
    patchDigest,
    changedPaths: Object.freeze([...changedPaths]),
    gateReceipts: Object.freeze(gateReceipts),
    handoff,
    integration,
    automaticIntegration: false,
  });
}

export const GUARDED_WRITER_MAX_MANIFEST_BYTES = MAX_MANIFEST_BYTES;
export const GUARDED_WRITER_MAX_GIT_OUTPUT_BYTES = MAX_GIT_OUTPUT_BYTES;
