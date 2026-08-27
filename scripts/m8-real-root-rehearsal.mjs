#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { protectedEvidenceDigest, validateDailyHarnessProtectedEvidence } from "./lib/daily-harness-gates.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ompBin = path.join(rootDir, "bin", "omp.mjs");
const FULL_SHA = /^[a-f0-9]{40}$/u;
const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^[a-f0-9-]{16,64}$/u;
const EXPECTED_PACKAGES = Object.freeze([
  "npm:@narumitw/pi-lsp@0.49.4",
  "npm:@narumitw/pi-plan-mode@0.49.3",
  "npm:@sreetej510/pi-usage@0.4.5",
  "npm:pi-agent-extensions@0.5.2",
  "npm:pi-git-sync@0.1.3",
  "npm:pi-memory@0.4.1",
  "npm:pi-permission-modes@2.2.0",
  "npm:pi-subagents@0.45.2",
  "npm:pi-web-access@0.20.0",
].sort());
const EXTERNAL_IDS = Object.freeze(["agent-extensions", "lsp", "permission-modes", "plan-mode", "subagents", "usage", "web-access"].sort());

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); throw error; }
function canonical(value) { if (value === null || typeof value !== "object") return value; if (Array.isArray(value)) return value.map(canonical); return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function digest(value) { return `sha256:${sha256(JSON.stringify(canonical(value)))}`; }
function assertion(id, value) { return Object.freeze({ id, status: "PASS", digest: digest(value) }); }

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) fail("M8_REHEARSAL_ARGUMENT_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("M8_REHEARSAL_ARGUMENT_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

export function parseM8RealRootArgs(argv) {
  const output = { operation: "plan", yes: false, json: false, artifact: null, configRoot: path.join(os.homedir(), ".pi", "agent"), baselineRawSha256: null, baselineSemanticSha256: null, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--run", "--plan", "--yes", "--json"].includes(argument)) {
      if (seen.has(argument)) fail("M8_REHEARSAL_ARGUMENT_INVALID", `duplicate ${argument}`);
      seen.add(argument);
      if (argument === "--run") output.operation = "run";
      else if (argument === "--plan") output.operation = "plan";
      else if (argument === "--yes") output.yes = true;
      else output.json = true;
      continue;
    }
    if (["--artifact", "--config-root", "--baseline-raw-sha256", "--baseline-semantic-sha256", "--output"].includes(argument)) {
      if (seen.has(argument)) fail("M8_REHEARSAL_ARGUMENT_INVALID", `duplicate ${argument}`);
      seen.add(argument);
      const value = argv[++index];
      if (!value || value.startsWith("-") || value.includes("\0") || /[\r\n]/u.test(value)) fail("M8_REHEARSAL_ARGUMENT_INVALID", `${argument} requires a bounded value`);
      if (argument === "--artifact") output.artifact = absolute(value, "artifact");
      else if (argument === "--config-root") output.configRoot = absolute(value, "configRoot");
      else if (argument === "--output") output.output = absolute(value, "output");
      else if (argument === "--baseline-raw-sha256") output.baselineRawSha256 = value.replace(/^sha256:/u, "");
      else output.baselineSemanticSha256 = value.replace(/^sha256:/u, "");
      continue;
    }
    fail("M8_REHEARSAL_ARGUMENT_INVALID", `unknown argument ${argument}`);
  }
  if (seen.has("--run") && seen.has("--plan")) fail("M8_REHEARSAL_ARGUMENT_INVALID", "--run and --plan are mutually exclusive");
  if (output.yes && output.operation !== "run") fail("M8_REHEARSAL_ARGUMENT_INVALID", "--yes requires --run");
  if (output.operation === "run" && (!output.yes || output.artifact === null || output.output === null || !HEX_SHA256.test(output.baselineRawSha256 ?? "") || !HEX_SHA256.test(output.baselineSemanticSha256 ?? ""))) fail("M8_REHEARSAL_ARGUMENT_INVALID", "--run requires --yes, artifact, both baseline digests, and output");
  return Object.freeze(output);
}

async function sourceIdentity({ requireClean = true } = {}) {
  const head = (await execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
  const status = (await execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
  if (!FULL_SHA.test(head)) fail("M8_REHEARSAL_SOURCE_INVALID", "source commit is invalid");
  if (requireClean && status !== "") fail("M8_REHEARSAL_SOURCE_DIRTY", "real-root rehearsal requires a clean source commit");
  return { sourceCommit: head, clean: status === "" };
}

async function artifactIdentity(artifact) {
  const stat = await fs.lstat(artifact);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1) fail("M8_REHEARSAL_ARTIFACT_INVALID", "artifact must be a non-empty regular file");
  const bytes = await fs.readFile(artifact);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

async function settingsState(configRoot) {
  const bytes = await fs.readFile(path.join(configRoot, "settings.json"));
  const document = JSON.parse(bytes.toString("utf8"));
  const packageSources = (document.packages ?? []).map((entry) => typeof entry === "string" ? entry : entry?.source).filter(Boolean).sort();
  const userPackageSources = packageSources.filter((source) => source.startsWith("npm:") || source.startsWith("git:"));
  const managedPackageSources = packageSources.filter((source) => !userPackageSources.includes(source));
  const bindings = document.onlyMyPi?.packageBindings ?? [];
  const externalIds = bindings.filter((entry) => entry.binding === "external" && entry.owner === "user").map((entry) => entry.id).sort();
  return {
    rawSha256: sha256(bytes),
    semanticSha256: sha256(JSON.stringify(canonical(document))),
    packageSources,
    userPackageSources,
    managedPackageSources,
    externalIds,
    installed: document.onlyMyPi?.profileId === "daily" && typeof document.onlyMyPi?.generationId === "string",
    generationId: document.onlyMyPi?.generationId ?? null,
  };
}

async function runOmp(args, temporaryHome) {
  let result;
  try {
    result = await execFile(process.execPath, [ompBin, ...args, "--json"], {
      cwd: rootDir,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH ?? "", HOME: temporaryHome, TMPDIR: path.join(temporaryHome, "tmp"), NO_COLOR: "1", PI_TELEMETRY: "0", npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false" },
    });
  } catch (cause) {
    fail("M8_REHEARSAL_OMP_FAILED", "an artifact rehearsal command failed", { exitCode: cause?.code });
  }
  try { return JSON.parse(result.stdout); }
  catch { fail("M8_REHEARSAL_OMP_FAILED", "artifact rehearsal command returned invalid JSON"); }
}

async function transactionEvidence(configRoot, transactionId) {
  if (!TRANSACTION_ID.test(transactionId ?? "")) fail("M8_REHEARSAL_TRANSACTION_INVALID", "transaction id is invalid");
  const document = JSON.parse(await fs.readFile(path.join(configRoot, "only-my-pi", "transactions", transactionId, "journal.json"), "utf8"));
  const phases = document.phaseHistory ?? [];
  if (!phases.includes("SMOKE_PASSED") || !phases.includes("COMMITTED")) fail("M8_REHEARSAL_SMOKE_MISSING", "committed transaction lacks no-model smoke evidence");
  return { transactionId: digest(transactionId), phases, journalDigest: digest(document) };
}

function requireInstalled(state, label) {
  if (!state.installed
    || JSON.stringify(state.externalIds) !== JSON.stringify(EXTERNAL_IDS)
    || JSON.stringify(state.userPackageSources) !== JSON.stringify(EXPECTED_PACKAGES)
    || state.managedPackageSources.length !== 1
    || !state.managedPackageSources[0].startsWith("./only-my-pi/generations/")) fail("M8_REHEARSAL_EXTERNAL_DRIFT", `${label} does not preserve the installed external package set and sole first-party bundle`);
}

function outputPath(output) {
  const root = path.join(rootDir, "verification", "protected");
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !output.endsWith(".json")) fail("M8_REHEARSAL_OUTPUT_INVALID", "evidence output must be inside verification/protected");
  return output;
}

export async function executeM8RealRootRehearsal(args, { now = () => new Date() } = {}) {
  const source = await sourceIdentity({ requireClean: args.operation === "run" });
  const artifact = args.artifact ? await artifactIdentity(args.artifact) : null;
  const plan = { status: "M8_REAL_ROOT_PLAN_READY", sourceCommit: source.sourceCommit, sourceClean: source.clean, artifact: artifact ? { bytes: artifact.bytes, sha256: `sha256:${artifact.sha256}` } : null, configRoot: "REAL_PI_HOME_EXPLICIT", sequence: ["idempotent-artifact-apply", "verify-external", "rollback", "verify-baseline", "artifact-reapply", "verify-smoke-and-final"] };
  if (args.operation === "plan") return { status: source.clean ? "PLAN" : "PLAN_BLOCKED_SOURCE_DIRTY", plan, exitCode: 0 };
  const configRoot = await fs.realpath(args.configRoot);
  const before = await settingsState(configRoot);
  requireInstalled(before, "pre-rehearsal state");
  const temporaryHome = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-m8-rehearsal-"));
  await fs.mkdir(path.join(temporaryHome, "tmp"), { mode: 0o700 });
  try {
    const firstApply = await runOmp(["install", "--artifact", args.artifact, "--profile", "daily", "--config-root", configRoot, "--apply", "--yes"], temporaryHome);
    if (firstApply.status !== "ARTIFACT_APPLIED" || firstApply.artifact?.sha256 !== `sha256:${artifact.sha256}` || !["NO_CHANGES", "REPAIRED_NO_CHANGES", "COMMITTED"].includes(firstApply.receipt?.status)) fail("M8_REHEARSAL_APPLY_FAILED", "idempotent artifact apply did not validate the installed generation");
    const afterFirstApply = await settingsState(configRoot);
    requireInstalled(afterFirstApply, "idempotent apply state");
    const rollback = await runOmp(["rollback", "--config-root", configRoot, "--yes"], temporaryHome);
    if (rollback.status !== "COMMITTED") fail("M8_REHEARSAL_ROLLBACK_FAILED", "rollback did not commit");
    const restored = await settingsState(configRoot);
    const baselineMatches = restored.rawSha256 === args.baselineRawSha256 || restored.semanticSha256 === args.baselineSemanticSha256;
    if (!baselineMatches || restored.installed || JSON.stringify(restored.packageSources) !== JSON.stringify(EXPECTED_PACKAGES) || restored.managedPackageSources.length !== 0) fail("M8_REHEARSAL_BASELINE_DRIFT", "rollback did not restore the pre-install settings baseline");
    const reapplied = await runOmp(["install", "--artifact", args.artifact, "--profile", "daily", "--config-root", configRoot, "--apply", "--yes"], temporaryHome);
    if (reapplied.status !== "ARTIFACT_APPLIED" || reapplied.receipt?.status !== "COMMITTED") fail("M8_REHEARSAL_REAPPLY_FAILED", "artifact reapply did not commit");
    const smoke = await transactionEvidence(configRoot, reapplied.receipt.transactionId);
    const final = await settingsState(configRoot);
    requireInstalled(final, "final state");
    const status = await runOmp(["status", "--config-root", configRoot], temporaryHome);
    if (status.status !== "INSTALLED" || status.incompleteTransactions?.length !== 0 || status.lastKnownGood?.generationId !== final.generationId) fail("M8_REHEARSAL_FINAL_INVALID", "final installed status, LKG, or transaction state is invalid");
    if ((await sourceIdentity()).sourceCommit !== source.sourceCommit) fail("M8_REHEARSAL_SOURCE_DRIFT", "source changed during real-root rehearsal");
    const assertions = [
      assertion("artifact-applied", { artifact: artifact.sha256, generationId: before.generationId, status: firstApply.receipt.status }),
      assertion("external-packages-preserved", { ids: afterFirstApply.externalIds, packageSources: afterFirstApply.userPackageSources, managedBundleCount: afterFirstApply.managedPackageSources.length }),
      assertion("no-model-smoke", smoke),
      assertion("rollback-restored", { rawMatch: restored.rawSha256 === args.baselineRawSha256, semanticMatch: restored.semanticSha256 === args.baselineSemanticSha256, packageSources: restored.packageSources }),
      assertion("reapplied", { artifact: artifact.sha256, transaction: smoke.transactionId, generationId: final.generationId }),
      assertion("final-installed", { generationId: final.generationId, lkg: status.lastKnownGood.generationId, incompleteTransactions: status.incompleteTransactions.length }),
    ].sort((left, right) => left.id.localeCompare(right.id));
    const evidence = { formatVersion: 1, kind: "only-my-pi-daily-harness-protected-evidence", gateId: "D14", evidenceId: "m8-real-root-rehearsal", sourceCommit: source.sourceCommit, status: "PASS", createdAt: now().toISOString(), assertions, privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false }, authorization: { providerRequests: "NOT_RUN_BY_POLICY", realPiHome: "AUTHORIZED", credentials: "NOT_READ", writer: "NOT_RUN_BY_POLICY" } };
    evidence.evidenceDigest = protectedEvidenceDigest(evidence);
    validateDailyHarnessProtectedEvidence(evidence, { gateId: "D14", expectedSourceCommit: source.sourceCommit });
    const target = outputPath(args.output);
    await fs.writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return { status: "RUN_COMPLETE", sourceCommit: source.sourceCommit, evidenceDigest: evidence.evidenceDigest, assertionCount: assertions.length, finalStatus: status.status, generationId: final.generationId, output: path.relative(rootDir, target), exitCode: 0 };
  } finally {
    await fs.rm(temporaryHome, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM8RealRootArgs(argv);
  const result = await executeM8RealRootRehearsal(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result.exitCode;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`m8-real-root-rehearsal: ERROR ${error.code ?? "M8_REHEARSAL_FAILED"} ${error.message}\n`); process.exitCode = 1; }
}

export { EXPECTED_PACKAGES as M8_REAL_ROOT_EXPECTED_PACKAGES };
