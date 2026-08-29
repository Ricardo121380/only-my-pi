#!/usr/bin/env node

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  StackTransactionEngine,
  createLocalReleasePayloadSource,
  createStackHarnessAdapter,
  createStackLayout,
  createStackService,
  createThinPayloadResolver,
  extractVerifiedTarGzip,
  planStackEnvironment,
  sha256,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parse(argv) {
  const tokens = new Set(argv);
  if (tokens.size !== argv.length || argv.some((token) => !["--run", "--json"].includes(token)) || !tokens.has("--run")) fail("Q10_ARGUMENT_INVALID", "Q10 requires exactly --run and optionally --json");
  return { json: tokens.has("--json") };
}

function platform() {
  if (process.platform !== "darwin" || process.arch !== "arm64") fail("Q10_PLATFORM_UNSUPPORTED", "Q10 requires native macOS Apple Silicon");
  let version;
  let translated = "0";
  try {
    version = execFileSync("/usr/bin/sw_vers", ["-productVersion"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    translated = execFileSync("/usr/sbin/sysctl", ["-in", "sysctl.proc_translated"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    translated = "0";
  }
  const major = Number(version?.split(".")[0]);
  if (!Number.isSafeInteger(major) || major < 14 || translated === "1") fail("Q10_PLATFORM_UNSUPPORTED", "Q10 requires native macOS 14 or newer without Rosetta translation");
  return Object.freeze({ os: "darwin", arch: "arm64", minimumMacOSSatisfied: true, rosetta: false, majorVersion: major });
}

async function realReleaseRoot() {
  const requested = process.env.M11_Q10_RELEASE_ROOT;
  if (typeof requested !== "string" || !path.isAbsolute(requested)) fail("Q10_RELEASE_ROOT_REQUIRED", "M11_Q10_RELEASE_ROOT must be an absolute RC directory");
  const stat = await fs.lstat(requested).catch(() => null);
  const real = stat ? await fs.realpath(requested).catch(() => null) : null;
  if (!stat?.isDirectory() || stat.isSymbolicLink() || real !== path.resolve(requested)) fail("Q10_RELEASE_ROOT_UNSAFE", "Q10 RC directory is missing or unsafe");
  const relative = path.relative(ROOT, real);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) fail("Q10_RELEASE_ROOT_UNSAFE", "Q10 RC directory must remain outside the repository");
  return real;
}

async function missing(target) {
  return fs.lstat(target).then(() => false, (error) => error?.code === "ENOENT" ? true : Promise.reject(error));
}

async function installOne({ releaseRoot, payloadMode, platformIdentity, workspace }) {
  const home = path.join(workspace, `home-${payloadMode}`);
  const cache = path.join(workspace, `cache-${payloadMode}`);
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  const layout = createStackLayout({ homeDir: home });
  const source = createLocalReleasePayloadSource({ cacheRoot: cache, thinResolver: createThinPayloadResolver() });
  const bundle = path.join(releaseRoot, `only-my-pi-0.2.0-preview.1-darwin-arm64-${payloadMode}.tar.gz`);
  const inspection = await source.inspect({ bundle });
  if (inspection.payloadMode !== payloadMode) fail("Q10_PAYLOAD_MODE_DRIFT", `Q10 ${payloadMode} asset identity drifted`);
  const prepared = await source.prepare({ bundle });
  const harnessExtraction = path.join(workspace, `harness-${payloadMode}`);
  await extractVerifiedTarGzip({ archivePath: path.join(prepared.resolvedRoot, "only-my-pi.tgz"), destination: harnessExtraction, expectedSha256: inspection.stackManifest.onlyMyPi.artifactSha256, maxEntries: 50_000, maxExtractedBytes: 512 * 1024 * 1024 });
  const harness = createStackHarnessAdapter({ rootDir: path.join(harnessExtraction, "package"), configRoot: layout.configRoot });
  const engine = new StackTransactionEngine({ layout, harness, doctor: async () => ({ ok: true, status: "Q10_STATIC_DOCTOR_PASSED" }), smoke: async () => ({ ok: true, status: "Q10_NO_MODEL_SMOKE_PASSED" }) });
  const service = createStackService({ layout, localSource: source, releaseSource: source, engine, platformInspector: async () => platformIdentity, pathValue: () => layout.binRoot });
  try {
    const plan = await planStackEnvironment({ layout, stackManifest: inspection.stackManifest, payloadMode, operation: "install", platform: platformIdentity, pathValue: layout.binRoot });
    const applied = await engine.apply({ plan, stackManifest: inspection.stackManifest, resolvedRoot: prepared.resolvedRoot });
    if (!applied.ok || !["COMMITTED", "PATH_ACTION_REQUIRED"].includes(applied.status)) fail("Q10_INSTALL_FAILED", `Q10 ${payloadMode} install did not commit`);
    const status = await service.status();
    if (!status.ok || status.status !== "INSTALLED" || status.stackId !== inspection.stackId || status.externalOwnership?.owner !== "user") fail("Q10_STATUS_FAILED", `Q10 ${payloadMode} installed state did not verify`);
    const removal = await service.planLifecycle({ subcommand: "remove" });
    const removed = await service.applyLifecycle({ subcommand: "remove" }, removal);
    if (removed.status !== "REMOVED" || (await service.status()).status !== "NOT_INSTALLED") fail("Q10_REMOVE_FAILED", `Q10 ${payloadMode} removal did not restore the empty baseline`);
    if (!(await missing(layout.ompShim)) || !(await missing(layout.piShim)) || !(await missing(layout.npmRoot))) fail("Q10_REMOVE_PRESERVATION_FAILED", `Q10 ${payloadMode} removal left provisioned entrypoints or package roots`);
    for (const relative of ["auth.json", "sessions", "models.json", "memory"]) if (!(await missing(path.join(layout.configRoot, relative)))) fail("Q10_PRIVATE_DATA_TOUCHED", `Q10 created private user data: ${relative}`);
    return Object.freeze({ payloadMode, stackId: inspection.stackId, installStatus: applied.status, installedStatus: status.status, removeStatus: removed.status, externalOwner: status.externalOwnership.owner, generationId: status.generationId });
  } finally {
    await prepared.cleanup();
  }
}

export async function runM11MacosNoModelAcceptance() {
  const platformIdentity = platform();
  const releaseRoot = await realReleaseRoot();
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-q10-")));
  await fs.chmod(workspace, 0o700);
  try {
    const full = await installOne({ releaseRoot, payloadMode: "full", platformIdentity, workspace });
    const thin = await installOne({ releaseRoot, payloadMode: "thin", platformIdentity, workspace });
    if (full.stackId !== thin.stackId || full.generationId !== thin.generationId) fail("Q10_PAYLOAD_CONVERGENCE_FAILED", "Q10 Full and Thin installed different stack or generation identities");
    return Object.freeze({ formatVersion: 1, ok: true, status: "Q10_MACOS_ARM64_NO_MODEL_PASSED", code: "Q10_MACOS_ARM64_NO_MODEL_PASSED", message: "Full and Thin clean-home installs converged, verified and removed", next: null, platform: "darwin-arm64", minimumMacOSMajor: platformIdentity.majorVersion, stackId: full.stackId, generationId: full.generationId, payloads: [full, thin], networkHosts: ["nodejs.org", "registry.npmjs.org"], providerRequests: 0, systemHomebrewModified: false, privateUserDataRead: false, receiptDigest: sha256(JSON.stringify({ full, thin })) });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parse(argv);
  const result = await runM11MacosNoModelAcceptance();
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "Q10_FAILED", code: error?.code ?? "Q10_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
