#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import { canonicalJson, loadSettings } from "../packages/config-runtime/index.mjs";
import {
  createStackLayout,
  extractVerifiedTarGzip,
  hashFile,
  sha256,
  validateReleaseIndex,
  validateStackManifest,
} from "../packages/release-stack/index.mjs";
import {
  runPublicBaselineLiveMatrix,
  verifyPublicPiList,
} from "./public-baseline-protected-acceptance.mjs";
import {
  M11_PROTECTED_ASSERTION_IDS,
  validateM11ProtectedEvidence,
} from "./m11-release-gates.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = os.homedir();
const CONFIG_ROOT = path.join(HOME, ".pi", "agent");
const CONTROLLED_PI = path.join(HOME, ".local", "bin", "pi");
const COMMIT = /^[a-f0-9]{40}$/u;
const RELEASE = "0.2.0-preview.1";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) fail("M11_PROTECTED_ARGUMENT_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("M11_PROTECTED_ARGUMENT_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

function protectedOutput(value) {
  const output = absolute(value, "output");
  const root = path.join(ROOT, "verification", "protected");
  const relative = path.relative(root, output);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !/^[a-z0-9][a-z0-9._-]*\.json$/u.test(relative)) fail("M11_PROTECTED_OUTPUT_INVALID", "output must be one JSON file directly inside verification/protected");
  return output;
}

export function parseM11ProtectedAcceptanceArgs(argv) {
  const result = { operation: "plan", yes: false, terminatePi: false, authorizeWeb: false, json: false, releaseRoot: null, sourceCommit: null, output: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--run", "--plan", "--yes", "--terminate-pi", "--authorize-web", "--json"].includes(token)) {
      if (seen.has(token)) fail("M11_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      if (token === "--run") result.operation = "run";
      else if (token === "--plan") result.operation = "plan";
      else if (token === "--yes") result.yes = true;
      else if (token === "--terminate-pi") result.terminatePi = true;
      else if (token === "--authorize-web") result.authorizeWeb = true;
      else result.json = true;
      continue;
    }
    if (["--release-root", "--source-commit", "--output"].includes(token)) {
      if (seen.has(token)) fail("M11_PROTECTED_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("--") || /[\0\r\n]/u.test(value)) fail("M11_PROTECTED_ARGUMENT_INVALID", `${token} requires a bounded value`);
      if (token === "--release-root") result.releaseRoot = absolute(value, "release root");
      else if (token === "--source-commit") result.sourceCommit = value;
      else result.output = protectedOutput(value);
      continue;
    }
    fail("M11_PROTECTED_ARGUMENT_INVALID", `unsupported argument: ${token}`);
  }
  if (seen.has("--run") && seen.has("--plan")) fail("M11_PROTECTED_ARGUMENT_INVALID", "--run and --plan are mutually exclusive");
  if (result.operation === "plan") {
    if (result.yes || result.terminatePi || result.authorizeWeb || result.output !== null) fail("M11_PROTECTED_ARGUMENT_INVALID", "plan mode is zero-write and accepts no authority or output");
    if (result.sourceCommit !== null && !COMMIT.test(result.sourceCommit)) fail("M11_PROTECTED_ARGUMENT_INVALID", "source commit is invalid");
  } else if (!result.yes || !result.terminatePi || !result.authorizeWeb || result.releaseRoot === null || !COMMIT.test(result.sourceCommit ?? "") || result.output === null) {
    fail("M11_PROTECTED_CONFIRMATION_REQUIRED", "run requires separate mutation, Pi termination, Web, exact source, RC root, and protected output authority");
  }
  return Object.freeze(result);
}

async function git(args) {
  return (await execFile("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
}

function runtimeEnvironment(extraPath = null) {
  return {
    PATH: [extraPath, path.join(HOME, ".local", "bin"), "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].filter(Boolean).join(path.delimiter),
    HOME,
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    LC_ALL: "C",
    NO_COLOR: "1",
    TERM: "dumb",
    PI_TELEMETRY: "0",
    PI_CODING_AGENT_DIR: CONFIG_ROOT,
  };
}

async function runJson(command, args, { env = runtimeEnvironment(), timeout = 30 * 60 * 1000 } = {}) {
  let stdout;
  try {
    ({ stdout } = await execFile(command, args, { cwd: ROOT, env, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 }));
  } catch (cause) {
    fail("M11_PROTECTED_COMMAND_FAILED", "a bounded protected command failed", { cause, commandDigest: sha256(canonicalJson({ command: path.basename(command), args })) });
  }
  try { return JSON.parse(stdout); }
  catch { fail("M11_PROTECTED_COMMAND_OUTPUT_INVALID", "protected command did not return one JSON document"); }
}

async function readJson(target, maxBytes = 64 * 1024 * 1024) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maxBytes || await fs.realpath(target) !== path.resolve(target)) fail("M11_PROTECTED_RELEASE_ASSET_INVALID", `release metadata is unsafe: ${path.basename(target)}`);
  try { return JSON.parse(await fs.readFile(target, "utf8")); }
  catch { fail("M11_PROTECTED_RELEASE_ASSET_INVALID", `release metadata is invalid JSON: ${path.basename(target)}`); }
}

async function inspectReleaseRoot(requested, sourceCommit) {
  const stat = await fs.lstat(requested).catch(() => null);
  const root = stat ? await fs.realpath(requested).catch(() => null) : null;
  if (!stat?.isDirectory() || stat.isSymbolicLink() || root !== path.resolve(requested)) fail("M11_PROTECTED_RELEASE_ROOT_UNSAFE", "RC release root is missing or unsafe");
  const relative = path.relative(ROOT, root);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) fail("M11_PROTECTED_RELEASE_ROOT_UNSAFE", "RC release root must stay outside the source repository");
  const [releaseIndexInput, stackManifestInput] = await Promise.all([
    readJson(path.join(root, "release-index.json")),
    readJson(path.join(root, "stack-manifest.json")),
  ]);
  const releaseIndex = validateReleaseIndex(releaseIndexInput);
  const stackManifest = validateStackManifest(stackManifestInput);
  if (releaseIndex.status !== "RC" || releaseIndex.version !== RELEASE || releaseIndex.sourceCommit !== sourceCommit || stackManifest.sourceCommit !== sourceCommit || releaseIndex.stackManifestSha256 !== await hashFile(path.join(root, "stack-manifest.json"))) fail("M11_PROTECTED_RELEASE_IDENTITY_INVALID", "RC metadata is not bound to exact source S");
  const assets = {};
  for (const mode of ["full", "thin"]) {
    const expected = releaseIndex.assets[mode];
    const target = path.join(root, expected.name);
    const assetStat = await fs.lstat(target).catch(() => null);
    if (!assetStat?.isFile() || assetStat.isSymbolicLink() || assetStat.size !== expected.bytes || await hashFile(target) !== expected.sha256) fail("M11_PROTECTED_RELEASE_ASSET_INVALID", `RC ${mode} asset differs from release-index`);
    assets[mode] = target;
  }
  return Object.freeze({ root, releaseIndex, stackManifest, assets: Object.freeze(assets) });
}

async function prepareBootstrap(release, workspace) {
  const extraction = path.join(workspace, "bootstrap-full");
  await extractVerifiedTarGzip({ archivePath: release.assets.full, destination: extraction, expectedSha256: release.releaseIndex.assets.full.sha256, maxEntries: 100_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 });
  const payload = path.join(extraction, "only-my-pi");
  const nodeRoot = path.join(payload, "node");
  const node = path.join(nodeRoot, "bin", "node");
  const npm = path.join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const artifact = path.join(payload, "only-my-pi.tgz");
  const prefix = path.join(workspace, "bootstrap-prefix");
  const bootstrapHome = path.join(workspace, "bootstrap-home");
  const cache = path.join(workspace, "bootstrap-cache");
  await Promise.all([prefix, bootstrapHome, cache].map((target) => fs.mkdir(target, { recursive: true, mode: 0o700 })));
  const env = {
    PATH: `${path.join(nodeRoot, "bin")}:/usr/bin:/bin`,
    HOME: bootstrapHome,
    TMPDIR: workspace,
    npm_config_cache: cache,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_offline: "true",
  };
  await execFile(node, [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps", "--package-lock=false", "--no-save", "--prefix", prefix, "--", artifact], { cwd: workspace, env, encoding: "utf8", timeout: 5 * 60 * 1000, maxBuffer: 1024 * 1024 });
  const omp = path.join(prefix, "node_modules", "only-my-pi", "bin", "omp.mjs");
  if (!(await fs.lstat(node)).isFile() || !(await fs.lstat(omp)).isFile()) fail("M11_PROTECTED_BOOTSTRAP_INVALID", "RC bootstrap runtime is incomplete");
  return Object.freeze({ node, omp, nodeRoot });
}

async function runOmp(bootstrap, args, options = {}) {
  return runJson(bootstrap.node, [bootstrap.omp, ...args, "--config-root", CONFIG_ROOT, "--json"], { ...options, env: runtimeEnvironment(path.join(bootstrap.nodeRoot, "bin")) });
}

async function digestOrMissing(target) {
  const stat = await fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return sha256("MISSING");
  if (stat.isSymbolicLink()) return sha256(`LINK:${await fs.readlink(target)}`);
  if (stat.isFile()) return hashFile(target);
  if (stat.isDirectory()) return `sha256:${await hashResourcePath({ artifactRoot: target, relativePath: ".", allowContainedSymlinks: true })}`;
  fail("M11_PROTECTED_BASELINE_PATH_UNSAFE", "baseline identity contains an unsupported filesystem object");
}

async function captureBaselineIdentity(bootstrap) {
  const layout = createStackLayout({ homeDir: HOME, configRoot: CONFIG_ROOT });
  const [version, status, doctor, stack, settings, lock, lkg, cli, currentArtifact, stackState] = await Promise.all([
    runOmp(bootstrap, ["version"]),
    runOmp(bootstrap, ["status"]),
    runOmp(bootstrap, ["doctor"]),
    runOmp(bootstrap, ["stack", "status"]),
    digestOrMissing(path.join(CONFIG_ROOT, "settings.json")),
    digestOrMissing(path.join(CONFIG_ROOT, "npm", "package-lock.json")),
    digestOrMissing(path.join(CONFIG_ROOT, "only-my-pi", "state", "last-known-good.json")),
    digestOrMissing(layout.ompShim),
    digestOrMissing(path.join(HOME, ".local", "share", "only-my-pi", "current")),
    digestOrMissing(layout.stateFile),
  ]);
  if (stack.status !== "NOT_INSTALLED" || status.status !== "INSTALLED" || !["PASS", "PASS_WITH_UPDATE_AVAILABLE"].includes(doctor.status)) fail("M11_PROTECTED_PUBLIC_BASELINE_INVALID", "Q11 requires a healthy public baseline with no active Preview stack");
  return Object.freeze({ version: { sourceCommit: version.sourceCommit, artifactSha256: version.artifactSha256, generation: version.installedGenerationId, piVersion: version.piVersion, subagentsVersion: version.subagentsVersion }, status: status.status, doctor: doctor.status, stack: stack.status, settings, lock, lkg, cli, currentArtifact, stackState });
}

async function captureInstalledIdentity(bootstrap, sourceCommit, stackId) {
  const [version, status, doctor, stack, settings] = await Promise.all([
    runOmp(bootstrap, ["version"]),
    runOmp(bootstrap, ["status"]),
    runOmp(bootstrap, ["doctor"]),
    runOmp(bootstrap, ["stack", "status"]),
    loadSettings(CONFIG_ROOT),
  ]);
  const bindings = (settings.settings.onlyMyPi?.packageBindings ?? []).filter((entry) => entry.binding === "external" && entry.owner === "user");
  if (version.ok !== true || version.status !== "VERSION_IDENTITY" || version.sourceCommit !== sourceCommit || version.stackId !== stackId || version.releaseChannel !== "preview" || version.embeddedNodeVersion !== "24.19.0" || version.piVersion !== "0.84.3" || version.subagentsVersion !== "0.57.0" || version.decision !== "PUBLIC_PREVIEW") fail("M11_PROTECTED_VERSION_IDENTITY_INVALID", "installed Preview version identity drifted");
  if (stack.status !== "INSTALLED" || stack.stackId !== stackId || stack.externalOwnership?.binding !== "external" || stack.externalOwnership?.owner !== "user" || stack.externalOwnership?.packageCount !== 9 || status.status !== "INSTALLED" || doctor.status !== "PASS" || doctor.generation?.alignment !== "MATCH" || stack.incompleteTransactions?.length !== 0) fail("M11_PROTECTED_INSTALLED_IDENTITY_INVALID", "installed Preview stack is not healthy and aligned");
  if (bindings.length !== 7) fail("M11_PROTECTED_EXTERNAL_OWNERSHIP_INVALID", "daily bindings must remain external and user-owned");
  return Object.freeze({ stackId, payloadMode: stack.payloadMode, generationId: stack.generationId, nodeVersion: stack.nodeVersion, piVersion: stack.piVersion, sourceCommit: version.sourceCommit, artifactSha256: version.artifactSha256, bindingCount: bindings.length, externalPackageCount: stack.externalOwnership.packageCount });
}

async function executableIdentity(command, versionArgs) {
  const stat = await fs.lstat(command).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return Object.freeze({ exists: false });
  const real = await fs.realpath(command);
  const realStat = await fs.lstat(real);
  if (!realStat.isFile()) fail("M11_PROTECTED_SYSTEM_RUNTIME_UNSAFE", "system runtime entry is not a regular file");
  const { stdout } = await execFile(command, versionArgs, { cwd: ROOT, env: runtimeEnvironment(), encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  return Object.freeze({ exists: true, executableSha256: await hashFile(real), versionDigest: sha256(stdout.trim()) });
}

async function captureSystemRuntime() {
  const [pi, node] = await Promise.all([
    executableIdentity("/opt/homebrew/bin/pi", ["--version"]),
    executableIdentity("/opt/homebrew/bin/node", ["--version"]),
  ]);
  return Object.freeze({ pi, node });
}

async function applyStack(bootstrap, bundle) {
  const plan = await runOmp(bootstrap, ["stack", "install", "--bundle", bundle, "--plan"]);
  if (plan.mutation !== false || plan.stackId === undefined) fail("M11_PROTECTED_STACK_PLAN_INVALID", "stack install did not produce a reviewable plan");
  const result = await runOmp(bootstrap, ["stack", "install", "--bundle", bundle, "--apply", "--yes", "--terminate-pi"]);
  if (result.ok !== true || !["COMMITTED", "PATH_ACTION_REQUIRED"].includes(result.status)) fail("M11_PROTECTED_STACK_INSTALL_FAILED", "stack install did not commit");
  return Object.freeze({ plan, result });
}

async function removeStack(bootstrap) {
  const plan = await runOmp(bootstrap, ["stack", "remove", "--plan"]);
  if (plan.status !== "STACK_REMOVE_PLAN") fail("M11_PROTECTED_STACK_REMOVE_PLAN_INVALID", "stack remove did not produce a reviewable plan");
  const result = await runOmp(bootstrap, ["stack", "remove", "--apply", "--yes", "--terminate-pi"]);
  if (result.status !== "REMOVED" || result.systemHomebrewModified !== false || result.userDataDeleted !== false) fail("M11_PROTECTED_STACK_REMOVE_FAILED", "stack remove did not restore the prior boundary");
  return Object.freeze({ plan, result });
}

function liveMap(live) {
  return new Map(live.assertions.map((entry) => [entry.id, entry]));
}

function assertion(id, value) {
  return Object.freeze({ id, status: "PASS", evidenceSha256: sha256(canonicalJson(value)) });
}

export function createM11ProtectedEvidence({ sourceCommit, stackId, usage, values }) {
  if (!COMMIT.test(sourceCommit ?? "") || typeof usage !== "object" || usage === null || typeof values !== "object" || values === null) fail("M11_PROTECTED_EVIDENCE_INPUT_INVALID", "protected evidence input is invalid");
  for (const id of M11_PROTECTED_ASSERTION_IDS) if (values[id] === undefined) fail("M11_PROTECTED_ASSERTION_MISSING", `protected assertion is missing: ${id}`);
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-m11-protected-release-evidence",
    gateId: "Q11",
    evidenceId: "m11-protected-final-release-matrix",
    status: "PASS",
    sourceCommit,
    stackId,
    usage: { directlyMeteredTokens: usage.tokens, variableCostUsd: usage.costUsd, wallSeconds: usage.wallSeconds, toolCalls: usage.toolCalls, meteredTerminals: usage.meteredTerminals },
    assertions: M11_PROTECTED_ASSERTION_IDS.map((id) => assertion(id, values[id])),
    privacy: { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
  };
  document.evidenceDigest = sha256(canonicalJson(document));
  return validateM11ProtectedEvidence(document, sourceCommit);
}

async function writeEvidence(output, evidence) {
  if (await fs.lstat(output).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("M11_PROTECTED_OUTPUT_EXISTS", "protected evidence output already exists");
  const temporary = `${output}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function executeM11ProtectedAcceptance(args, { now = () => new Date() } = {}) {
  const head = await git(["rev-parse", "HEAD"]);
  const clean = await git(["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  const plan = Object.freeze({
    status: clean ? "M11_PROTECTED_PLAN_READY" : "M11_PROTECTED_PLAN_BLOCKED",
    sourceCommit: head,
    sourceClean: clean,
    phases: ["thin-install", "baseline-restore", "full-install", "live-matrix", "stack-remove", "thin-reinstall"],
    authority: { mutation: "EXPLICIT", piTermination: "EXPLICIT", publicWeb: "EXPLICIT", providerCredentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
    budgets: { maxDirectlyMeteredTokens: 75_000, maxWallSeconds: 3_600, maxVariableCostUsdPerRun: 0.25 },
    writes: args.operation === "run" ? "REAL_USER_STACK_AND_PROTECTED_EVIDENCE" : "ZERO",
    providerRequests: args.operation === "run" ? "AUTHORIZED_ON_CONFIRMATION" : "NOT_RUN_BY_POLICY",
  });
  if (args.operation === "plan") return Object.freeze({ ok: clean, status: plan.status, mutation: false, plan, exitCode: 0 });
  if (!clean || head !== args.sourceCommit) fail("M11_PROTECTED_SOURCE_INVALID", "protected Q11 requires the exact clean source S");
  if (await fs.lstat(args.output).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("M11_PROTECTED_OUTPUT_EXISTS", "protected evidence output already exists");
  const release = await inspectReleaseRoot(args.releaseRoot, head);
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-q11-")));
  await fs.chmod(workspace, 0o700);
  let active = false;
  let bootstrap;
  try {
    bootstrap = await prepareBootstrap(release, workspace);
    const [baseline, systemBefore] = await Promise.all([captureBaselineIdentity(bootstrap), captureSystemRuntime()]);

    const thinApply = await applyStack(bootstrap, release.assets.thin);
    active = true;
    const thin = await captureInstalledIdentity(bootstrap, head, release.stackManifest.stackId);
    await removeStack(bootstrap);
    active = false;
    const restoredAfterThin = await captureBaselineIdentity(bootstrap);
    if (!same(restoredAfterThin, baseline)) fail("M11_PROTECTED_BASELINE_ROLLBACK_DRIFT", "Thin removal did not exactly restore the public baseline");

    const fullApply = await applyStack(bootstrap, release.assets.full);
    active = true;
    const full = await captureInstalledIdentity(bootstrap, head, release.stackManifest.stackId);
    if (thin.stackId !== full.stackId || thin.generationId !== full.generationId || thin.artifactSha256 !== full.artifactSha256) fail("M11_PROTECTED_PAYLOAD_CONVERGENCE_FAILED", "Full and Thin installed different stack identities");
    const live = await runPublicBaselineLiveMatrix({ sourceCommit: head, installed: full, piCommand: CONTROLLED_PI });
    if (live.usage.tokens > 75_000 || live.usage.costUsd !== 0 || live.wallSeconds > 3_600) fail("M11_PROTECTED_LIVE_BUDGET_EXCEEDED", "protected release matrix exceeded its aggregate budget");
    const piList = await verifyPublicPiList(CONTROLLED_PI);

    await removeStack(bootstrap);
    active = false;
    const restoredAfterFull = await captureBaselineIdentity(bootstrap);
    if (!same(restoredAfterFull, baseline)) fail("M11_PROTECTED_STACK_REMOVE_DRIFT", "Full stack removal did not exactly restore the public baseline");

    const reinstallApply = await applyStack(bootstrap, release.assets.thin);
    active = true;
    const reinstalled = await captureInstalledIdentity(bootstrap, head, release.stackManifest.stackId);
    const systemAfter = await captureSystemRuntime();
    if (!same(systemAfter, systemBefore)) fail("M11_PROTECTED_SYSTEM_RUNTIME_DRIFT", "system Homebrew Pi or Node changed during Q11");

    const records = liveMap(live);
    const values = {
      "thin-install": { status: thinApply.result.status, identity: thin },
      "full-install": { status: fullApply.result.status, identity: full },
      "payload-convergence": { stackId: full.stackId, generationId: full.generationId },
      "agent-terminal": records.get("agent-terminal"),
      "workflow-artifact-flow": records.get("workflow-artifact-flow"),
      "ultra-route": { agent: records.get("ultra-agent-route"), workflow: records.get("ultra-workflow-route") },
      "public-web": records.get("public-web"),
      cancellation: records.get("cancellation"),
      "cross-session-resume": { prepared: records.get("resume-prepared"), resumed: records.get("resume-across-session") },
      "budget-denial": records.get("budget-boundary"),
      "writer-denial": records.get("writer-denial"),
      "usage-metering": { assertion: records.get("usage-metering"), directlyMeteredTokens: live.usage.tokens, variableCostUsd: live.usage.costUsd, toolCalls: live.usage.toolCalls, wallSeconds: live.wallSeconds },
      "embedded-runtime-identity": { nodeVersion: full.nodeVersion, piVersion: full.piVersion },
      "cli-generation-identity": { sourceCommit: full.sourceCommit, artifactSha256: full.artifactSha256, generationId: full.generationId },
      "external-ownership": { binding: "external", owner: "user", dailyBindings: full.bindingCount, packageCount: full.externalPackageCount },
      "no-duplicate-runtime-owner": piList,
      "public-baseline-rollback": { status: "PASS", baselineDigest: sha256(canonicalJson(restoredAfterThin)) },
      "stack-remove": { status: "PASS", baselineDigest: sha256(canonicalJson(restoredAfterFull)) },
      reinstall: { status: reinstallApply.result.status, identity: reinstalled },
      "system-runtime-preservation": systemAfter,
    };
    const evidence = createM11ProtectedEvidence({ sourceCommit: head, stackId: full.stackId, usage: { ...live.usage, wallSeconds: live.wallSeconds }, values });
    await writeEvidence(args.output, evidence);
    active = false;
    return Object.freeze({ ok: true, status: "M11_PROTECTED_RELEASE_MATRIX_COMPLETE", sourceCommit: head, stackId: full.stackId, assertionCount: evidence.assertions.length, evidenceDigest: evidence.evidenceDigest, output: path.relative(ROOT, args.output), finalStack: "THIN_REINSTALLED", exitCode: 0, completedAt: now().toISOString() });
  } catch (error) {
    if (active && bootstrap) {
      try {
        await removeStack(bootstrap);
      } catch (rollbackError) {
        fail("M11_PROTECTED_AUTOMATIC_ROLLBACK_FAILED", "Q11 failure could not restore the public baseline", { cause: error, rollbackError });
      }
    }
    throw error;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM11ProtectedAcceptanceArgs(argv);
  const result = await executeM11ProtectedAcceptance(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return result.exitCode;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "M11_PROTECTED_RELEASE_MATRIX_FAILED", code: error?.code ?? "M11_PROTECTED_RELEASE_MATRIX_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
}
