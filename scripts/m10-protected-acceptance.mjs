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
import {
  inspectMigrationBundle,
  loadMigrationArtifactBytes,
  M10_EXACT_PACKAGE_TARGET,
  M10_P10_ASSERTION_IDS,
  M10_P9_ASSERTION_IDS,
  m10ProtectedEvidenceDigest,
  validateM10ProtectedEvidence,
} from "../packages/upstream-migration/index.mjs";
import {
  M9_LIVE_CANDIDATE,
  M9_LIVE_PRICING,
  M9_LIVE_RECORD_TYPE,
} from "../packages/subagents/release/m9-live-acceptance-extension.mjs";
import { M8_LIVE_EXPECTED_ASSERTIONS } from "./m8-live-acceptance.mjs";
import { runPiM9Phase } from "./m9-live-acceptance.mjs";
import { parsePackageSpec } from "./lib/package-source.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_ROOT = path.join(os.homedir(), ".pi", "agent");
const PI_COMMAND = "/opt/homebrew/bin/pi";
const CLI_BIN = path.join(os.homedir(), ".local", "bin", "omp");
const CLI_ROOT = path.join(os.homedir(), ".local", "share", "only-my-pi");
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PROVIDER = "cc-switch-open-code-go";
const MODEL = "deepseek-v4-flash";
const TERMINAL_TRANSACTIONS = new Set(["COMMITTED", "ROLLED_BACK", "FAILED", "MANUAL_RECONCILIATION_REQUIRED"]);

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
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) fail("M10_PROTECTED_ARGUMENT_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("M10_PROTECTED_ARGUMENT_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

function protectedOutput(value, label) {
  const output = absolute(value, label);
  const protectedRoot = path.join(ROOT, "verification", "protected");
  const relative = path.relative(protectedRoot, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !output.endsWith(".json")) fail("M10_PROTECTED_OUTPUT_INVALID", `${label} must be a JSON file inside verification/protected`);
  return output;
}

export function parseM10ProtectedAcceptanceArgs(argv) {
  const result = { operation: "plan", yes: false, terminatePi: false, authorizeWeb: false, json: false, bundle: null, sourceCommit: null, p9Output: null, p10Output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--plan", "--yes", "--terminate-pi", "--authorize-web", "--json"].includes(token)) {
      if (seen.has(token)) fail("M10_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      if (token === "--run") result.operation = "run";
      else if (token === "--plan") result.operation = "plan";
      else if (token === "--yes") result.yes = true;
      else if (token === "--terminate-pi") result.terminatePi = true;
      else if (token === "--authorize-web") result.authorizeWeb = true;
      else result.json = true;
      continue;
    }
    if (["--bundle", "--source-commit", "--p9-output", "--p10-output"].includes(token)) {
      if (seen.has(token)) fail("M10_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("M10_PROTECTED_ARGUMENT_INVALID", `${token} requires a bounded value`);
      if (token === "--bundle") result.bundle = absolute(value, "bundle");
      else if (token === "--source-commit") result.sourceCommit = value;
      else if (token === "--p9-output") result.p9Output = protectedOutput(value, "p9Output");
      else result.p10Output = protectedOutput(value, "p10Output");
      continue;
    }
    fail("M10_PROTECTED_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (seen.has("--run") && seen.has("--plan")) fail("M10_PROTECTED_ARGUMENT_INVALID", "--run and --plan are mutually exclusive");
  if (result.operation === "plan") {
    if (result.yes || result.terminatePi || result.authorizeWeb || result.p9Output || result.p10Output) fail("M10_PROTECTED_ARGUMENT_INVALID", "plan mode is read-only and accepts no authorization or output paths");
    if (result.sourceCommit !== null && !FULL_SHA.test(result.sourceCommit)) fail("M10_PROTECTED_ARGUMENT_INVALID", "source commit must be a full lowercase SHA");
  } else if (!result.yes || !result.terminatePi || !result.authorizeWeb || result.bundle === null || !FULL_SHA.test(result.sourceCommit ?? "") || result.p9Output === null || result.p10Output === null || result.p9Output === result.p10Output) {
    fail("M10_PROTECTED_CONFIRMATION_REQUIRED", "run requires --yes, --terminate-pi, --authorize-web, an absolute bundle, source commit, and distinct P9/P10 outputs");
  }
  return Object.freeze(result);
}

async function git(args) {
  return (await execFile("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
}

async function assertSource(sourceCommit, { clean = true } = {}) {
  const head = await git(["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head) || (sourceCommit !== null && sourceCommit !== head)) fail("M10_PROTECTED_SOURCE_INVALID", "protected runner source differs from the requested commit");
  const dirty = await git(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (clean && dirty !== "") fail("M10_PROTECTED_SOURCE_DIRTY", "protected runner requires a clean source commit");
  return Object.freeze({ sourceCommit: head, clean: dirty === "" });
}

export function m10ProtectedCliEnvironment() {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: os.homedir(),
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    LC_ALL: "C",
    NO_COLOR: "1",
    TERM: "dumb",
    PI_TELEMETRY: "0",
  };
}

async function runJson(command, args, { cwd, timeout = 30 * 60 * 1000 } = {}) {
  let result;
  try {
    result = await execFile(command, args, { cwd, env: m10ProtectedCliEnvironment(), encoding: "utf8", timeout, maxBuffer: 2 * 1024 * 1024 });
  } catch (cause) {
    fail("M10_PROTECTED_COMMAND_FAILED", "a bounded protected command failed", { cause, commandDigest: digest({ command: path.basename(command), args }) });
  }
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { fail("M10_PROTECTED_COMMAND_OUTPUT_INVALID", "protected command did not return one JSON document"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.ok === false) fail("M10_PROTECTED_COMMAND_REJECTED", "protected command returned an unsuccessful result");
  return parsed;
}

async function runOmp(cli, args) {
  return runJson(process.execPath, [cli, ...args, "--config-root", CONFIG_ROOT, "--json"], { cwd: path.dirname(cli) });
}

export function validateM10ArtifactArchiveListing(listing) {
  const names = listing.split(/\r?\n/gu).filter(Boolean);
  if (names.length === 0) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi archive is empty");
  for (const name of names) {
    if (name.includes("\\") || name.startsWith("/") || (name !== "package" && name !== "package/" && !name.startsWith("package/"))) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi archive layout is unsafe");
    const segments = name.split("/").filter(Boolean);
    if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\0"))) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi archive path is unsafe");
  }
}

async function extractOnlyMyPi(bundle, inspected) {
  const loaded = await loadMigrationArtifactBytes({ bundlePath: bundle, rootDir: ROOT, expectedBundleSha256: inspected.bundle.sha256 });
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m10-protected-"));
  await fs.chmod(temporaryRoot, 0o700);
  try {
    const archive = path.join(temporaryRoot, "only-my-pi.tgz");
    const destination = path.join(temporaryRoot, "artifact");
    await fs.writeFile(archive, loaded.artifactBytes.get("only-my-pi.tgz"), { mode: 0o600, flag: "wx" });
    await fs.mkdir(destination, { mode: 0o700 });
    const list = (await execFile("tar", ["-tzf", archive], { cwd: temporaryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })).stdout;
    validateM10ArtifactArchiveListing(list);
    const verbose = (await execFile("tar", ["-tvzf", archive], { cwd: temporaryRoot, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })).stdout;
    if (verbose.split(/\r?\n/gu).filter(Boolean).some((line) => !["-", "d"].includes(line[0]))) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi archive contains a non-regular entry");
    await execFile("tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { cwd: temporaryRoot, maxBuffer: 1024 * 1024 });
    const packageRoot = await fs.realpath(path.join(destination, "package"));
    if (!packageRoot.startsWith(`${destination}${path.sep}`)) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi artifact escaped its extraction root");
    const [manifest, identity] = await Promise.all([
      fs.readFile(path.join(packageRoot, "package.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(packageRoot, "artifact-identity.json"), "utf8").then(JSON.parse),
    ]);
    const cli = path.join(packageRoot, "bin", "omp.mjs");
    const cliStat = await fs.lstat(cli);
    if (manifest.name !== "only-my-pi" || identity.sourceCommit !== inspected.manifest.sourceCommit || !cliStat.isFile() || cliStat.isSymbolicLink()) fail("M10_PROTECTED_ARTIFACT_INVALID", "only-my-pi artifact identity is invalid");
    return { temporaryRoot, packageRoot, cli };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function npmSource(setting) {
  const source = typeof setting === "string" ? setting : setting?.source;
  try { const parsed = parsePackageSpec(source); return parsed.type === "npm" ? `${parsed.name}@${parsed.version}` : null; } catch { return null; }
}

async function installedIdentity({ sourceCommit, artifactSha256, candidateGraphDigest }) {
  const state = await loadSettings(CONFIG_ROOT);
  const metadata = state.settings.onlyMyPi;
  const bindings = metadata?.packageBindings ?? [];
  const external = bindings.filter((entry) => entry.binding === "external" && entry.owner === "user");
  const expectedBindings = M10_EXACT_PACKAGE_TARGET.filter((entry) => !["memory", "git-sync"].includes(entry.id));
  if (metadata?.generationId !== candidateGraphDigest || metadata.graphDigest !== candidateGraphDigest || external.length !== 7
    || new Set(bindings.map((entry) => entry.id)).size !== bindings.length
    || expectedBindings.some((entry) => !external.some((binding) => binding.id === entry.id && binding.resolvedVersion === entry.toVersion))) {
    fail("M10_PROTECTED_INSTALL_IDENTITY_INVALID", "candidate generation or external ownership identity drifted");
  }
  const npmSources = (state.settings.packages ?? []).map(npmSource).filter(Boolean);
  const expectedSources = M10_EXACT_PACKAGE_TARGET.map((entry) => `${entry.name}@${entry.toVersion}`);
  if (new Set(npmSources).size !== npmSources.length || expectedSources.some((entry) => !npmSources.includes(entry))) fail("M10_PROTECTED_PACKAGE_SET_INVALID", "candidate settings do not contain the unique exact nine-package target");
  const version = await runOmp(CLI_BIN, ["version"]);
  const status = await runOmp(CLI_BIN, ["status"]);
  const doctor = await runOmp(CLI_BIN, ["doctor"]);
  if (version.sourceCommit !== sourceCommit || version.artifactSha256 !== artifactSha256 || version.installedGenerationId !== candidateGraphDigest
    || version.piVersion !== "0.84.3" || version.subagentsVersion !== "0.57.0" || status.status !== "INSTALLED"
    || status.generationId !== candidateGraphDigest || doctor.status !== "PASS" || doctor.generation?.alignment !== "MATCH") {
    fail("M10_PROTECTED_CLI_GENERATION_DRIFT", "candidate CLI, generation, Pi, or doctor identity drifted");
  }
  return Object.freeze({ settingsDigest: state.digest, generationId: metadata.generationId, bindings: external.map((entry) => ({ id: entry.id, version: entry.resolvedVersion })).sort((a, b) => a.id.localeCompare(b.id)), version, status, doctor });
}

async function verifyPiList() {
  const result = await execFile(PI_COMMAND, ["list", "--no-approve"], { cwd: ROOT, env: { ...m10ProtectedCliEnvironment(), PI_CODING_AGENT_DIR: CONFIG_ROOT }, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  const packageLines = result.stdout.split(/\r?\n/gu).filter((line) => /^  (?:npm:|\.\/only-my-pi\/)/u.test(line));
  const expected = M10_EXACT_PACKAGE_TARGET.map((entry) => `npm:${entry.name}@${entry.toVersion}`);
  if (packageLines.length !== 10 || expected.some((spec) => packageLines.filter((line) => line.trim().startsWith(spec)).length !== 1)
    || packageLines.filter((line) => line.trim().startsWith("./only-my-pi/")).length !== 1) fail("M10_PROTECTED_PI_LIST_INVALID", "pi list does not expose the exact unique candidate package set");
  return Object.freeze({ packageCount: packageLines.length, listingDigest: digest(result.stdout) });
}

function terminalJournal(status, transactionId, expectedStatus) {
  if (status?.journal?.transactionId !== transactionId || status.journal.status !== expectedStatus || !TERMINAL_TRANSACTIONS.has(status.journal.status)) fail("M10_PROTECTED_TRANSACTION_INVALID", "upstream transaction did not reach the expected terminal state");
  return status.journal;
}

function exactRollback(before, after) {
  const fields = [
    ["settings", before.preflight.settings, after.preflight.settings],
    ["generation", before.preflight.generation, after.preflight.generation],
    ["pi", before.preflight.pi, after.preflight.pi],
    ["external", before.preflight.external, after.preflight.external],
    ["ownership", before.preflight.ownership, after.preflight.ownership],
    ["privacy", before.preflight.privacy, after.preflight.privacy],
  ];
  for (const [label, left, right] of fields) if (JSON.stringify(canonical(left)) !== JSON.stringify(canonical(right))) fail("M10_PROTECTED_ROLLBACK_DRIFT", `rollback did not exactly restore ${label}`);
}

function assertion(id, value) {
  return Object.freeze({ id, status: "PASS", digest: digest(value) });
}

export function createM10P9Evidence({ sourceCommit, inspected, before, firstApply, firstJournal, rollbackJournal, rollbackPlan, cliAbsent, reapply, reapplyJournal, createdAt }) {
  exactRollback(before, rollbackPlan);
  if (firstApply?.status !== "COMMITTED" || firstJournal?.status !== "COMMITTED" || rollbackJournal?.status !== "ROLLED_BACK"
    || reapply?.status !== "COMMITTED" || reapplyJournal?.status !== "COMMITTED" || cliAbsent !== true
    || !firstJournal.history?.some((entry) => entry.phase === "NO_MODEL_SMOKE_PASSED")
    || !reapplyJournal.history?.some((entry) => entry.phase === "NO_MODEL_SMOKE_PASSED")
    || before.processPolicy?.signal !== "SIGTERM" || before.processPolicy?.forceKill !== false) {
    fail("M10_PROTECTED_P9_ASSERTION_INVALID", "P9 requires committed apply/reapply, exact rollback, no-model smoke, CLI absence, and SIGTERM-only process policy");
  }
  const values = {
    "bundle-provenance": { bundle: inspected.bundle.sha256, manifest: inspected.manifest.manifestDigest, sourceCommit },
    "preflight-old-stack": { settings: before.preflight.settings.digest, generation: before.preflight.generation, pi: before.preflight.pi, external: before.preflight.external },
    "pi-process-policy": { processCount: before.piProcesses.length, processDigests: before.piProcesses.map((entry) => digest(entry)).sort(), policy: before.processPolicy },
    "candidate-apply": { status: firstApply.status, transactionId: firstApply.transactionId },
    "no-model-smoke": { first: firstJournal.history.some((entry) => entry.phase === "NO_MODEL_SMOKE_PASSED"), second: reapplyJournal.history.some((entry) => entry.phase === "NO_MODEL_SMOKE_PASSED") },
    "rollback-pi": { before: before.preflight.pi, after: rollbackPlan.preflight.pi },
    "rollback-external-tree": { before: before.preflight.external, after: rollbackPlan.preflight.external },
    "rollback-settings": { before: before.preflight.settings, after: rollbackPlan.preflight.settings },
    "rollback-generation-lkg": { before: before.preflight.generation, after: rollbackPlan.preflight.generation },
    "rollback-cli-absence": { cliAbsent },
    "candidate-reapply": { status: reapply.status, transactionId: reapply.transactionId },
    "transaction-terminal": { first: firstJournal.status, rollback: rollbackJournal.status, reapply: reapplyJournal.status },
  };
  const evidence = {
    formatVersion: 1,
    kind: "only-my-pi-m10-protected-evidence",
    gateId: "P9",
    evidenceId: "m10-real-root-migration",
    sourceCommit,
    status: "PASS",
    createdAt,
    artifacts: { migrationBundleSha256: inspected.bundle.sha256, onlyMyPiArtifactSha256: inspected.manifest.onlyMyPiArtifact.sha256, candidateGraphDigest: inspected.manifest.candidateGraphDigest },
    assertions: M10_P9_ASSERTION_IDS.map((id) => assertion(id, values[id])),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
    authorization: { realRoots: "EXPLICIT", piTermination: "SIGTERM_ONLY", providerRequests: "NOT_RUN_BY_POLICY", writer: "DENIED" },
  };
  evidence.evidenceDigest = m10ProtectedEvidenceDigest(evidence);
  return validateM10ProtectedEvidence(evidence, { gateId: "P9", expectedSourceCommit: sourceCommit });
}

function liveAssertionMap(main, resume, sourceCommit) {
  for (const record of [main, resume]) {
    if (record?.type !== M9_LIVE_RECORD_TYPE || record.status !== "PASS" || record.sourceCommit !== sourceCommit || JSON.stringify(record.candidate) !== JSON.stringify(M9_LIVE_CANDIDATE) || JSON.stringify(record.pricing) !== JSON.stringify(M9_LIVE_PRICING)) fail("M10_PROTECTED_LIVE_RECORD_INVALID", "live matrix record identity drifted");
  }
  const records = [...main.assertions, ...resume.assertions];
  const ids = records.map((entry) => entry.id).sort();
  const expected = M8_LIVE_EXPECTED_ASSERTIONS.filter((id) => id !== "artifact-identity").sort();
  if (JSON.stringify(ids) !== JSON.stringify(expected) || new Set(ids).size !== ids.length) fail("M10_PROTECTED_LIVE_ASSERTIONS_INVALID", "live matrix assertion set is incomplete or duplicated");
  return new Map(records.map((entry) => [entry.id, entry]));
}

export function createM10P10Evidence({ sourceCommit, inspected, main, resume, identity, piList, wallSeconds, createdAt }) {
  const live = liveAssertionMap(main, resume, sourceCommit);
  const usage = {
    directlyMeteredTokens: main.usage.tokens + resume.usage.tokens,
    variableCostUsd: Number((main.usage.costUsd + resume.usage.costUsd).toFixed(12)),
    wallSeconds,
    toolCalls: main.usage.toolCalls + resume.usage.toolCalls,
    meteredTerminals: main.usage.meteredTerminals + resume.usage.meteredTerminals,
  };
  const values = {
    "agent-terminal": live.get("agent-terminal"),
    "batch-swarm": live.get("batch-swarm-terminal"),
    "workflow-artifact-flow": live.get("workflow-artifact-flow"),
    "swarm-goal-replan": live.get("swarm-goal-replan"),
    "ultra-agent-route": live.get("ultra-agent-route"),
    "ultra-workflow-route": live.get("ultra-workflow-route"),
    "public-web": live.get("public-web"),
    cancellation: live.get("cancellation"),
    "cross-session-resume": { prepared: live.get("resume-prepared"), resumed: live.get("resume-across-session") },
    "budget-denial": live.get("budget-boundary"),
    "writer-denial": live.get("writer-denial"),
    "candidate-runtime-identity": { piVersion: identity.version.piVersion, subagentsVersion: identity.version.subagentsVersion },
    "installed-generation-identity": { generationId: identity.generationId, doctor: identity.doctor.generation },
    "cli-generation-artifact-identity": { sourceCommit: identity.version.sourceCommit, artifact: identity.version.artifactSha256, generationId: identity.version.installedGenerationId },
    "external-ownership-preservation": identity.bindings,
    "usage-metering": { assertion: live.get("usage-metering"), usage },
    "no-duplicate-runtime-ownership": piList,
  };
  const pricing = { mode: M9_LIVE_PRICING.mode, inputPerMillion: 0, outputPerMillion: 0, fixedFeeUsd: 10, fixedFeeIncludedInRunCost: false };
  const evidence = {
    formatVersion: 1,
    kind: "only-my-pi-m10-protected-evidence",
    gateId: "P10",
    evidenceId: "m10-promoted-live-model-matrix",
    sourceCommit,
    status: "PASS",
    createdAt,
    artifacts: { migrationBundleSha256: inspected.bundle.sha256, onlyMyPiArtifactSha256: inspected.manifest.onlyMyPiArtifact.sha256, candidateGraphDigest: inspected.manifest.candidateGraphDigest },
    runtime: { piVersion: "0.84.3", subagentsVersion: "0.57.0", provider: PROVIDER, model: MODEL },
    pricing,
    usage,
    assertions: M10_P10_ASSERTION_IDS.map((id) => assertion(id, values[id])),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
    authorization: { realRoots: "AUTH_AND_PRIVATE_RUN_STATE_ONLY", providerRequests: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  evidence.evidenceDigest = m10ProtectedEvidenceDigest(evidence);
  return validateM10ProtectedEvidence(evidence, { gateId: "P10", expectedSourceCommit: sourceCommit });
}

async function writeEvidencePair(p9Path, p10Path, p9, p10) {
  for (const target of [p9Path, p10Path]) {
    if (await fs.lstat(target).then(() => true, (error) => { if (error?.code === "ENOENT") return false; throw error; })) fail("M10_PROTECTED_OUTPUT_EXISTS", "protected evidence output already exists");
  }
  const temporaryP9 = `${p9Path}.${crypto.randomUUID()}.tmp`;
  const temporaryP10 = `${p10Path}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryP9, `${JSON.stringify(p9, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.writeFile(temporaryP10, `${JSON.stringify(p10, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporaryP9, p9Path);
    try { await fs.rename(temporaryP10, p10Path); } catch (error) { await fs.rm(p9Path, { force: true }); throw error; }
  } finally {
    await Promise.all([temporaryP9, temporaryP10].map((target) => fs.rm(target, { force: true })));
  }
}

async function rollbackCandidate(cli, transactionId) {
  if (transactionId === null) return null;
  return runOmp(cli, ["upstream", "rollback", transactionId, "--yes", "--terminate-pi"]);
}

async function recoverCandidate(cli, inspected, preferredTransactionId = null) {
  const listed = await runOmp(cli, ["upstream", "status"]);
  const candidates = [];
  for (const entry of listed.transactions ?? []) {
    if (preferredTransactionId !== null && entry.transactionId !== preferredTransactionId) continue;
    if (!new Set(["ACTIVE", "RECOVERING", "COMMITTED"]).has(entry.status)) continue;
    const detail = await runOmp(cli, ["upstream", "status", entry.transactionId]);
    if (detail.journal?.sourceCommit === inspected.manifest.sourceCommit && detail.journal.bundleDigest === inspected.bundle.sha256) candidates.push(detail.journal);
  }
  const candidate = candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  if (candidate === null) return { status: "NO_CANDIDATE_TRANSACTION" };
  try { await rollbackCandidate(cli, candidate.transactionId); } catch {
    // An ACTIVE transaction is recovered by the mutating dispatch pre-hook;
    // explicit rollback then rejects because recovery already made it terminal.
  }
  const settled = await runOmp(cli, ["upstream", "status", candidate.transactionId]);
  if (settled.journal?.status !== "ROLLED_BACK") fail("M10_PROTECTED_AUTOMATIC_ROLLBACK_FAILED", "protected failure did not restore the prior stack");
  return { status: "ROLLED_BACK", transactionId: candidate.transactionId };
}

async function liveMatrix({ sourceCommit, inspected, artifactRoot }) {
  const auth = await runJson(PI_COMMAND, ["auth", "check", "--provider", PROVIDER, "--model", MODEL, "--json", "--no-refresh"], { cwd: artifactRoot, timeout: 30_000 });
  if (auth.status !== "ready" || auth.provider !== PROVIDER) fail("M10_PROTECTED_AUTH_UNAVAILABLE", "candidate Pi authentication is not ready for the approved model");
  const npmRoot = path.join(CONFIG_ROOT, "npm");
  const subagentsRoot = await fs.realpath(path.join(npmRoot, "node_modules", "pi-subagents"));
  const manifest = JSON.parse(await fs.readFile(path.join(subagentsRoot, "package.json"), "utf8"));
  const subagentsEntry = await fs.realpath(path.resolve(subagentsRoot, manifest.pi.extensions[0]));
  if (!subagentsEntry.startsWith(`${subagentsRoot}${path.sep}`) || manifest.version !== "0.57.0") fail("M10_PROTECTED_SUBAGENTS_INVALID", "candidate pi-subagents entry is invalid");
  const acceptanceExtension = path.join(artifactRoot, "packages", "subagents", "release", "m9-live-acceptance-extension.mjs");
  const request = {
    formatVersion: 1,
    phase: "main",
    sourceCommit,
    repositoryRoot: artifactRoot,
    configRoot: CONFIG_ROOT,
    candidateInstallationRoot: npmRoot,
    candidateAuditDigest: digest(await installedIdentity({ sourceCommit, artifactSha256: inspected.manifest.onlyMyPiArtifact.sha256, candidateGraphDigest: inspected.manifest.candidateGraphDigest })),
    candidateContractDigest: inspected.manifest.candidateGraphDigest,
    model: { provider: PROVIDER, id: MODEL },
    pricing: M9_LIVE_PRICING,
    runNonce: `${sourceCommit.slice(0, 8)}-${crypto.randomBytes(4).toString("hex")}`,
    webAuthorized: true,
  };
  const started = Date.now();
  const main = await runPiM9Phase({ piCommand: PI_COMMAND, phase: "main", request, configRoot: CONFIG_ROOT, subagentsEntry, acceptanceExtension, timeoutMs: 30 * 60 * 1000 });
  const resume = await runPiM9Phase({ piCommand: PI_COMMAND, phase: "resume", request, configRoot: CONFIG_ROOT, subagentsEntry, acceptanceExtension, timeoutMs: 10 * 60 * 1000 });
  return { main, resume, wallSeconds: Math.ceil((Date.now() - started) / 1000) };
}

export async function executeM10ProtectedAcceptance(args) {
  const source = await assertSource(args.sourceCommit, { clean: args.operation === "run" });
  const inspected = args.bundle === null ? null : await inspectMigrationBundle({ bundlePath: args.bundle, rootDir: ROOT });
  if (inspected && inspected.manifest.sourceCommit !== source.sourceCommit) fail("M10_PROTECTED_BUNDLE_SOURCE_DRIFT", "migration bundle is not bound to the protected source commit");
  const plan = {
    status: source.clean ? "M10_PROTECTED_PLAN_READY" : "M10_PROTECTED_PLAN_BLOCKED_SOURCE_DIRTY",
    mutation: false,
    sourceCommit: source.sourceCommit,
    bundle: inspected ? { sha256: inspected.bundle.sha256, sourceCommit: inspected.manifest.sourceCommit, candidateGraphDigest: inspected.manifest.candidateGraphDigest } : "REQUIRED_FOR_RUN",
    sequence: ["preflight", "candidate-apply", "no-model-smoke", "exact-rollback", "candidate-reapply", "live-matrix", "evidence-pair"],
    authorization: { realRoots: "REQUIRES_--yes", piTermination: "REQUIRES_--terminate-pi_SIGTERM_ONLY", publicWeb: "REQUIRES_--authorize-web", providerRequests: "NOT_RUN_IN_PLAN", writer: "DENIED" },
    writes: 0,
    providerRequests: 0,
  };
  if (args.operation === "plan") return { ok: true, status: "PLAN", mutation: false, plan };

  const extracted = await extractOnlyMyPi(args.bundle, inspected);
  let candidateTransaction = null;
  try {
    const before = await runOmp(extracted.cli, ["upstream", "plan", "--bundle", args.bundle]);
    for (const entry of before.piProcesses) process.stderr.write(`M10_PI_PROCESS pid=${entry.pid} started=${entry.startedAt} class=${entry.executableClass} commandDigest=${entry.commandDigest}\n`);
    const firstApply = await runOmp(extracted.cli, ["upstream", "apply", "--bundle", args.bundle, "--apply", "--yes", "--terminate-pi"]);
    candidateTransaction = firstApply.transactionId;
    const firstStatus = await runOmp(CLI_BIN, ["upstream", "status", firstApply.transactionId]);
    const firstJournal = terminalJournal(firstStatus, firstApply.transactionId, "COMMITTED");
    const rollback = await rollbackCandidate(CLI_BIN, firstApply.transactionId);
    candidateTransaction = null;
    const rollbackStatus = await runOmp(extracted.cli, ["upstream", "status", firstApply.transactionId]);
    const rollbackJournal = terminalJournal(rollbackStatus, firstApply.transactionId, "ROLLED_BACK");
    if (rollback.status !== "ROLLED_BACK") fail("M10_PROTECTED_ROLLBACK_FAILED", "explicit candidate rollback did not complete");
    const rollbackPlan = await runOmp(extracted.cli, ["upstream", "plan", "--bundle", args.bundle]);
    exactRollback(before, rollbackPlan);
    const cliAbsent = await fs.lstat(CLI_BIN).then(() => false, (error) => { if (error?.code === "ENOENT") return true; throw error; });
    if (!cliAbsent) fail("M10_PROTECTED_CLI_ROLLBACK_DRIFT", "candidate rollback did not restore CLI absence");
    const reapply = await runOmp(extracted.cli, ["upstream", "apply", "--bundle", args.bundle, "--apply", "--yes", "--terminate-pi"]);
    candidateTransaction = reapply.transactionId;
    const reapplyStatus = await runOmp(CLI_BIN, ["upstream", "status", reapply.transactionId]);
    const reapplyJournal = terminalJournal(reapplyStatus, reapply.transactionId, "COMMITTED");
    const identityBefore = await installedIdentity({ sourceCommit: source.sourceCommit, artifactSha256: inspected.manifest.onlyMyPiArtifact.sha256, candidateGraphDigest: inspected.manifest.candidateGraphDigest });
    const piList = await verifyPiList();
    const live = await liveMatrix({ sourceCommit: source.sourceCommit, inspected, artifactRoot: identityBefore.version.cliRoot === "USER_LOCAL_IMMUTABLE_ARTIFACT" ? path.join(CLI_ROOT, "current", "package") : extracted.packageRoot });
    const identityAfter = await installedIdentity({ sourceCommit: source.sourceCommit, artifactSha256: inspected.manifest.onlyMyPiArtifact.sha256, candidateGraphDigest: inspected.manifest.candidateGraphDigest });
    if (identityAfter.settingsDigest !== identityBefore.settingsDigest || identityAfter.generationId !== identityBefore.generationId) fail("M10_PROTECTED_LIVE_STATE_DRIFT", "live matrix changed candidate settings or generation");
    await assertSource(source.sourceCommit, { clean: true });
    const createdAt = new Date().toISOString();
    const p9 = createM10P9Evidence({ sourceCommit: source.sourceCommit, inspected, before, firstApply, firstJournal, rollbackJournal, rollbackPlan, cliAbsent, reapply, reapplyJournal, createdAt });
    const p10 = createM10P10Evidence({ sourceCommit: source.sourceCommit, inspected, ...live, identity: identityAfter, piList, createdAt });
    await writeEvidencePair(args.p9Output, args.p10Output, p9, p10);
    return { ok: true, status: "M10_PROTECTED_ACCEPTANCE_PASS", mutation: true, sourceCommit: source.sourceCommit, transactionId: reapply.transactionId, evidence: { P9: p9.evidenceDigest, P10: p10.evidenceDigest }, usage: p10.usage };
  } catch (error) {
    try {
      error.rollback = await recoverCandidate(extracted.cli, inspected, candidateTransaction);
    } catch (rollbackError) {
      error.rollback = { status: "MANUAL_RECONCILIATION_REQUIRED", code: rollbackError?.code ?? "M10_PROTECTED_ROLLBACK_FAILED" };
    }
    throw error;
  } finally {
    await fs.rm(extracted.temporaryRoot, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM10ProtectedAcceptanceArgs(argv);
  const result = await executeM10ProtectedAcceptance(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`m10-protected-acceptance: ERROR ${error?.code ?? "M10_PROTECTED_FAILED"} ${error?.message ?? "protected acceptance failed"}${error?.rollback ? ` rollback=${error.rollback.status}` : ""}\n`);
    process.exitCode = 1;
  });
}
