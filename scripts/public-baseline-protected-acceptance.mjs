#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadSettings } from "../packages/config-runtime/index.mjs";
import { createUserCliInstaller } from "../packages/bootstrap/user-cli-installer.mjs";
import {
  PUBLIC_BASELINE_ASSERTION_IDS,
  publicBaselineDigest,
  validatePublicBaselineEvidence,
} from "../packages/release-authority/index.mjs";
import { M10_EXACT_PACKAGE_TARGET } from "../packages/upstream-migration/index.mjs";
import {
  M9_LIVE_CANDIDATE,
  M9_LIVE_PRICING,
  M9_LIVE_RECORD_TYPE,
} from "../packages/subagents/release/m9-live-acceptance-extension.mjs";
import { M8_LIVE_EXPECTED_ASSERTIONS } from "./m8-live-acceptance.mjs";
import { runPiM9Phase } from "./m9-live-acceptance.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_ROOT = path.join(os.homedir(), ".pi", "agent");
const CLI_BIN = path.join(os.homedir(), ".local", "bin", "omp");
const PI_COMMAND = "/opt/homebrew/bin/pi";
const PROVIDER = "cc-switch-open-code-go";
const MODEL = "deepseek-v4-flash";
const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(canonical(value)));
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

function protectedOutput(value) {
  const output = absolute(value, "output");
  const root = path.join(ROOT, "verification", "protected");
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !output.endsWith(".json")) fail("PUBLIC_BASELINE_PROTECTED_OUTPUT_INVALID", "output must be a JSON file inside verification/protected");
  return output;
}

export function parsePublicBaselineProtectedArgs(argv) {
  const result = { operation: "plan", yes: false, authorizeWeb: false, json: false, artifact: null, sourceCommit: null, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--plan", "--yes", "--authorize-web", "--json"].includes(token)) {
      if (seen.has(token)) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      if (token === "--run") result.operation = "run";
      else if (token === "--plan") result.operation = "plan";
      else if (token === "--yes") result.yes = true;
      else if (token === "--authorize-web") result.authorizeWeb = true;
      else result.json = true;
      continue;
    }
    if (["--artifact", "--source-commit", "--output"].includes(token)) {
      if (seen.has(token)) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `${token} requires a bounded value`);
      if (token === "--artifact") result.artifact = absolute(value, "artifact");
      else if (token === "--source-commit") result.sourceCommit = value;
      else result.output = protectedOutput(value);
      continue;
    }
    fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (seen.has("--run") && seen.has("--plan")) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", "--run and --plan are mutually exclusive");
  if (result.operation === "plan") {
    if (result.yes || result.authorizeWeb || result.output !== null) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", "plan mode is read-only and accepts no authorization or output");
    if (result.sourceCommit !== null && !FULL_SHA.test(result.sourceCommit)) fail("PUBLIC_BASELINE_PROTECTED_ARGUMENT_INVALID", "source commit is invalid");
  } else if (!result.yes || !result.authorizeWeb || result.artifact === null || !FULL_SHA.test(result.sourceCommit ?? "") || result.output === null) {
    fail("PUBLIC_BASELINE_PROTECTED_CONFIRMATION_REQUIRED", "run requires --yes, --authorize-web, an absolute artifact, source commit, and protected output");
  }
  return Object.freeze(result);
}

async function git(args) {
  return (await execFile("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
}

function environment() {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: os.homedir(),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    LC_ALL: "C",
    NO_COLOR: "1",
    TERM: "dumb",
    PI_TELEMETRY: "0",
    PI_CODING_AGENT_DIR: CONFIG_ROOT,
  };
}

async function runJson(command, args, { timeout = 30 * 60 * 1000 } = {}) {
  let result;
  try {
    result = await execFile(command, args, { cwd: ROOT, env: environment(), encoding: "utf8", timeout, maxBuffer: 4 * 1024 * 1024 });
  } catch (cause) {
    fail("PUBLIC_BASELINE_PROTECTED_COMMAND_FAILED", "a bounded protected command failed", { cause, commandDigest: digest({ command: path.basename(command), args }) });
  }
  try { return JSON.parse(result.stdout); }
  catch { fail("PUBLIC_BASELINE_PROTECTED_OUTPUT_INVALID", "protected command did not return one JSON document"); }
}

async function runOmp(args) {
  return runJson(process.execPath, [CLI_BIN, ...args, "--config-root", CONFIG_ROOT, "--json"]);
}

async function fileDigest(target) {
  return `sha256:${crypto.createHash("sha256").update(await fs.readFile(target)).digest("hex")}`;
}

async function captureIdentity() {
  const [settings, version, status, doctor, lockDigest, lkgDigest, cliTarget] = await Promise.all([
    loadSettings(CONFIG_ROOT),
    runOmp(["version"]),
    runOmp(["status"]),
    runOmp(["doctor"]),
    fileDigest(path.join(CONFIG_ROOT, "npm", "package-lock.json")),
    fileDigest(path.join(CONFIG_ROOT, "only-my-pi", "state", "last-known-good.json")),
    fs.readlink(path.join(os.homedir(), ".local", "share", "only-my-pi", "current")),
  ]);
  if (version.piVersion !== "0.84.3" || version.subagentsVersion !== "0.57.0" || status.status !== "INSTALLED"
    || doctor.status !== "PASS" || doctor.generation?.alignment !== "MATCH" || status.incompleteTransactions?.length !== 0) {
    fail("PUBLIC_BASELINE_PROTECTED_INSTALL_INVALID", "installed stack is not a healthy M10 Stable baseline");
  }
  const bindings = (settings.settings.onlyMyPi?.packageBindings ?? [])
    .filter((entry) => entry.binding === "external" && entry.owner === "user")
    .map((entry) => ({ id: entry.id, version: entry.resolvedVersion, binding: entry.binding, owner: entry.owner }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (bindings.length !== 7) fail("PUBLIC_BASELINE_PROTECTED_OWNERSHIP_INVALID", "daily package bindings must remain external and user-owned");
  return Object.freeze({
    settingsDigest: settings.digest,
    packageLockDigest: lockDigest,
    lkgDigest,
    cliTarget,
    generationId: status.generationId,
    version: {
      sourceCommit: version.sourceCommit,
      artifactSha256: version.artifactSha256,
      installedGenerationId: version.installedGenerationId,
      packageVersion: version.packageVersion,
      piVersion: version.piVersion,
      subagentsVersion: version.subagentsVersion,
      decision: version.decision,
    },
    bindings,
  });
}

async function inspectArtifact(artifact, sourceCommit) {
  const stat = await fs.lstat(artifact);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 64 * 1024 * 1024) fail("PUBLIC_BASELINE_PROTECTED_ARTIFACT_INVALID", "source artifact must be a bounded regular file");
  const sha256 = await fileDigest(artifact);
  let identity;
  try {
    const result = await execFile("tar", ["-xOf", artifact, "package/artifact-identity.json"], { cwd: ROOT, encoding: "utf8", timeout: 30_000, maxBuffer: 4096 });
    identity = JSON.parse(result.stdout);
  } catch { fail("PUBLIC_BASELINE_PROTECTED_ARTIFACT_INVALID", "source artifact identity is unavailable"); }
  if (identity?.formatVersion !== 1 || identity.kind !== "only-my-pi-source-identity" || identity.sourceCommit !== sourceCommit) fail("PUBLIC_BASELINE_PROTECTED_ARTIFACT_INVALID", "source artifact does not bind the requested sanitized commit");
  return Object.freeze({ sha256, bytes: stat.size });
}

export async function verifyPublicPiList(piCommand = PI_COMMAND) {
  const result = await execFile(piCommand, ["list", "--no-approve"], { cwd: ROOT, env: environment(), encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  const packageLines = result.stdout.split(/\r?\n/gu).filter((line) => /^  (?:npm:|\.\/only-my-pi\/)/u.test(line));
  const expected = M10_EXACT_PACKAGE_TARGET.map((entry) => `npm:${entry.name}@${entry.toVersion}`);
  if (packageLines.length !== 10 || expected.some((spec) => packageLines.filter((line) => line.trim().startsWith(spec)).length !== 1)
    || packageLines.filter((line) => line.trim().startsWith("./only-my-pi/")).length !== 1) {
    fail("PUBLIC_BASELINE_PROTECTED_PI_LIST_INVALID", "Pi does not expose the exact unique Stable package set");
  }
  return Object.freeze({ packageCount: packageLines.length, listingDigest: digest(result.stdout) });
}

function assertion(id, value) {
  return Object.freeze({ id, status: "PASS", digest: digest(value) });
}

function liveById(evidence) {
  return new Map(evidence.assertions.map((entry) => [entry.id, entry]));
}

export async function runPublicBaselineLiveMatrix({ sourceCommit, installed, piCommand = PI_COMMAND }) {
  const auth = await runJson(piCommand, ["auth", "check", "--provider", PROVIDER, "--model", MODEL, "--json", "--no-refresh"], { timeout: 30_000 });
  if (auth.status !== "ready" || auth.provider !== PROVIDER) fail("PUBLIC_BASELINE_PROTECTED_AUTH_UNAVAILABLE", "Pi authentication is not ready for the approved model");
  const npmRoot = path.join(CONFIG_ROOT, "npm");
  const subagentsRoot = await fs.realpath(path.join(npmRoot, "node_modules", "pi-subagents"));
  const manifest = JSON.parse(await fs.readFile(path.join(subagentsRoot, "package.json"), "utf8"));
  const extensionEntry = manifest?.pi?.extensions?.[0];
  if (manifest.version !== "0.57.0" || typeof extensionEntry !== "string") fail("PUBLIC_BASELINE_PROTECTED_SUBAGENTS_INVALID", "pi-subagents runtime identity is invalid");
  const subagentsEntry = await fs.realpath(path.resolve(subagentsRoot, extensionEntry));
  if (!subagentsEntry.startsWith(`${subagentsRoot}${path.sep}`) || !(await fs.lstat(subagentsEntry)).isFile()) fail("PUBLIC_BASELINE_PROTECTED_SUBAGENTS_INVALID", "pi-subagents entry escaped its package root");
  const request = {
    formatVersion: 1,
    phase: "main",
    sourceCommit,
    repositoryRoot: ROOT,
    configRoot: CONFIG_ROOT,
    candidateInstallationRoot: npmRoot,
    candidateAuditDigest: digest({ sourceCommit, installed }),
    candidateContractDigest: installed.generationId,
    model: { provider: PROVIDER, id: MODEL },
    pricing: M9_LIVE_PRICING,
    runNonce: `${sourceCommit.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`,
    webAuthorized: true,
  };
  const acceptanceExtension = path.join(ROOT, "packages", "subagents", "release", "m9-live-acceptance-extension.mjs");
  const started = Date.now();
  const main = await runPiM9Phase({ piCommand, phase: "main", request, configRoot: CONFIG_ROOT, subagentsEntry, acceptanceExtension, timeoutMs: 30 * 60 * 1000 });
  const resume = await runPiM9Phase({ piCommand, phase: "resume", request, configRoot: CONFIG_ROOT, subagentsEntry, acceptanceExtension, timeoutMs: 10 * 60 * 1000 });
  for (const record of [main, resume]) {
    if (record?.type !== M9_LIVE_RECORD_TYPE || record.status !== "PASS" || record.sourceCommit !== sourceCommit
      || JSON.stringify(record.candidate) !== JSON.stringify(M9_LIVE_CANDIDATE)
      || JSON.stringify(record.pricing) !== JSON.stringify(M9_LIVE_PRICING)) {
      fail("PUBLIC_BASELINE_PROTECTED_LIVE_RECORD_INVALID", "protected live record identity is invalid");
    }
  }
  const assertions = [...main.assertions, ...resume.assertions];
  const ids = assertions.map((entry) => entry.id).sort();
  const expected = M8_LIVE_EXPECTED_ASSERTIONS.filter((id) => id !== "artifact-identity").sort();
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify(expected)) fail("PUBLIC_BASELINE_PROTECTED_LIVE_ASSERTIONS_INVALID", "protected live assertion set is incomplete or duplicated");
  return Object.freeze({
    assertions,
    usage: {
      tokens: main.usage.tokens + resume.usage.tokens,
      costUsd: Number((main.usage.costUsd + resume.usage.costUsd).toFixed(12)),
      toolCalls: main.usage.toolCalls + resume.usage.toolCalls,
      meteredTerminals: main.usage.meteredTerminals + resume.usage.meteredTerminals,
    },
    wallSeconds: Math.ceil((Date.now() - started) / 1000),
  });
}

function createEvidence({ sourceCommit, artifact, before, installed, live, usage, piList, wallSeconds, createdAt }) {
  const records = liveById(live);
  const values = {
    "agent-terminal": records.get("agent-terminal"),
    "batch-swarm": records.get("batch-swarm-terminal"),
    "workflow-artifact-flow": records.get("workflow-artifact-flow"),
    "swarm-goal-replan": records.get("swarm-goal-replan"),
    "ultra-agent-route": records.get("ultra-agent-route"),
    "ultra-workflow-route": records.get("ultra-workflow-route"),
    "public-web": records.get("public-web"),
    cancellation: records.get("cancellation"),
    "cross-session-resume": { prepared: records.get("resume-prepared"), resumed: records.get("resume-across-session") },
    "budget-denial": records.get("budget-boundary"),
    "writer-denial": records.get("writer-denial"),
    "runtime-identity": { piVersion: installed.version.piVersion, subagentsVersion: installed.version.subagentsVersion },
    "installed-generation-identity": installed.generationId,
    "cli-generation-artifact-identity": { sourceCommit: installed.version.sourceCommit, artifact: installed.version.artifactSha256, generation: installed.version.installedGenerationId },
    "external-ownership-preservation": installed.bindings,
    "usage-metering": { assertion: records.get("usage-metering"), usage },
    "no-duplicate-runtime-ownership": piList,
    "sanitized-artifact-apply": { sourceCommit, artifact: artifact.sha256 },
    "no-model-smoke": { status: "PASS", generation: installed.generationId },
    "private-baseline-rollback": { status: "PASS" },
    "private-baseline-exact-identity": { priorIdentityDigest: digest(before) },
    "sanitized-artifact-reapply": { sourceCommit, artifact: artifact.sha256, generation: installed.generationId },
    "legacy-authority-retired": { status: "LEGACY_PASS_NOT_CURRENT_AUTHORITY" },
  };
  if (PUBLIC_BASELINE_ASSERTION_IDS.some((id) => values[id] === undefined)) fail("PUBLIC_BASELINE_PROTECTED_ASSERTION_MISSING", "live acceptance did not produce the complete assertion set");
  const evidence = {
    formatVersion: 1,
    kind: "only-my-pi-public-baseline-evidence",
    evidenceId: "public-baseline-live-matrix",
    sourceCommit,
    status: "PASS",
    createdAt,
    artifacts: {
      sanitizedArtifactSha256: artifact.sha256,
      priorIdentityDigest: digest(before),
      stableGraphDigest: installed.generationId,
      installedGenerationId: installed.generationId,
    },
    runtime: { piVersion: "0.84.3", subagentsVersion: "0.57.0", provider: PROVIDER, model: MODEL },
    pricing: { mode: "subscription-fixed-fee", inputPerMillion: 0, outputPerMillion: 0, fixedFeeUsd: 10, fixedFeeIncludedInRunCost: false },
    usage: {
      directlyMeteredTokens: usage.tokens,
      variableCostUsd: usage.costUsd,
      wallSeconds,
      toolCalls: usage.toolCalls,
      meteredTerminals: usage.meteredTerminals,
    },
    assertions: PUBLIC_BASELINE_ASSERTION_IDS.map((id) => assertion(id, values[id])),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
    authorization: { realRoots: "EXPLICIT_APPLY_ROLLBACK_REAPPLY", providerRequests: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  evidence.evidenceDigest = publicBaselineDigest(evidence);
  return validatePublicBaselineEvidence(evidence, { expectedSourceCommit: sourceCommit });
}

async function writeEvidence(output, evidence) {
  const exists = await fs.lstat(output).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error));
  if (exists) fail("PUBLIC_BASELINE_PROTECTED_OUTPUT_EXISTS", "protected evidence output already exists");
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function rollbackTransaction(transactionId) {
  if (transactionId === null) return;
  await runOmp(["rollback", `before-${transactionId}`, "--yes"]);
}

async function rollbackAppliedArtifact({ transactionId, cliSnapshot }) {
  if (transactionId !== null) {
    await rollbackTransaction(transactionId);
    return;
  }
  if (!cliSnapshot || typeof cliSnapshot !== "object") fail("PUBLIC_BASELINE_PROTECTED_ROLLBACK_UNAVAILABLE", "artifact apply exposed neither a bootstrap transaction nor a CLI snapshot");
  const installer = createUserCliInstaller({
    cliRoot: path.join(os.homedir(), ".local", "share", "only-my-pi"),
    binPath: CLI_BIN,
  });
  await installer.restore(cliSnapshot);
}

export async function executePublicBaselineProtected(args, { now = () => new Date() } = {}) {
  const head = await git(["rev-parse", "HEAD"]);
  const clean = await git(["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  const plan = Object.freeze({
    status: clean ? "PUBLIC_BASELINE_PROTECTED_PLAN_READY" : "PUBLIC_BASELINE_PROTECTED_PLAN_BLOCKED",
    sourceCommit: head,
    sourceClean: clean,
    artifact: args.artifact === null ? null : "EXPLICIT_COMMIT_PINNED_ARTIFACT",
    phases: ["apply", "no-model-smoke", "live-17", "rollback-exact-verify", "reapply"],
    model: { provider: PROVIDER, id: MODEL },
    providerRequests: args.operation === "run" ? "AUTHORIZED_ON_CONFIRMATION" : "NOT_RUN_BY_POLICY",
    writes: args.operation === "run" ? "REAL_PI_HOME_AND_PROTECTED_EVIDENCE" : "ZERO",
  });
  if (args.operation === "plan") return { ok: clean, status: plan.status, plan, exitCode: 0 };
  if (!clean || head !== args.sourceCommit) fail("PUBLIC_BASELINE_PROTECTED_SOURCE_INVALID", "protected run requires the exact clean B source commit");
  const artifact = await inspectArtifact(args.artifact, head);
  const before = await captureIdentity();
  let activeRollback = null;
  try {
    const firstApply = await runOmp(["update", "--artifact", args.artifact, "--apply", "--yes"]);
    activeRollback = { transactionId: firstApply.receipt?.transactionId ?? null, cliSnapshot: firstApply.cli?.snapshot ?? null };
    if (firstApply.status !== "ARTIFACT_APPLIED") fail("PUBLIC_BASELINE_PROTECTED_APPLY_INVALID", "sanitized baseline artifact did not commit");
    const firstInstalled = await captureIdentity();
    if (firstInstalled.version.sourceCommit !== head || firstInstalled.version.artifactSha256 !== artifact.sha256) fail("PUBLIC_BASELINE_PROTECTED_APPLY_INVALID", "installed CLI does not match sanitized B artifact");
    await rollbackAppliedArtifact(activeRollback);
    activeRollback = null;
    const restored = await captureIdentity();
    if (JSON.stringify(canonical(restored)) !== JSON.stringify(canonical(before))) fail("PUBLIC_BASELINE_PROTECTED_ROLLBACK_DRIFT", "rollback did not exactly restore the M10 private baseline identity");
    const reapply = await runOmp(["update", "--artifact", args.artifact, "--apply", "--yes"]);
    activeRollback = { transactionId: reapply.receipt?.transactionId ?? null, cliSnapshot: reapply.cli?.snapshot ?? null };
    if (reapply.status !== "ARTIFACT_APPLIED") fail("PUBLIC_BASELINE_PROTECTED_REAPPLY_INVALID", "sanitized baseline artifact reapply did not commit");
    const installed = await captureIdentity();
    if (installed.version.sourceCommit !== head || installed.version.artifactSha256 !== artifact.sha256) fail("PUBLIC_BASELINE_PROTECTED_REAPPLY_INVALID", "reapplied CLI does not match sanitized B artifact");
    const live = await runPublicBaselineLiveMatrix({ sourceCommit: head, installed });
    const piList = await verifyPublicPiList();
    const evidence = createEvidence({
      sourceCommit: head,
      artifact,
      before,
      installed,
      live,
      usage: live.usage,
      piList,
      wallSeconds: live.wallSeconds,
      createdAt: now().toISOString(),
    });
    await writeEvidence(args.output, evidence);
    activeRollback = null;
    return { ok: true, status: "PUBLIC_BASELINE_PROTECTED_COMPLETE", sourceCommit: head, artifactSha256: artifact.sha256, evidenceDigest: evidence.evidenceDigest, assertionCount: evidence.assertions.length, output: path.relative(ROOT, args.output), exitCode: 0 };
  } catch (error) {
    if (activeRollback !== null) {
      try { await rollbackAppliedArtifact(activeRollback); }
      catch (rollbackError) { fail("PUBLIC_BASELINE_PROTECTED_AUTOMATIC_ROLLBACK_FAILED", "protected failure could not restore the M10 private baseline", { cause: error, rollbackError }); }
    }
    throw error;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parsePublicBaselineProtectedArgs(argv);
  const result = await executePublicBaselineProtected(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result.exitCode;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`public-baseline-protected: ERROR ${error.code ?? "PUBLIC_BASELINE_PROTECTED_FAILED"} ${error.message}\n`); process.exitCode = 1; }
}
