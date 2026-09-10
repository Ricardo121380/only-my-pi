import fs from "node:fs/promises";
import path from "node:path";

import { BootstrapService } from "../bootstrap/bootstrap-service.mjs";
import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { createNpmCommandRunner } from "../bootstrap/command-runner.mjs";
import { DoctorService } from "../bootstrap/doctor-service.mjs";
import { createNoModelSmokeRunner } from "../bootstrap/smoke-runner.mjs";
import { TransactionEngine } from "../bootstrap/transaction-engine.mjs";
import { extractManagedMetadata } from "../bootstrap/settings-merge.mjs";
import { loadSettings, saveSettings } from "../config-runtime/index.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function settingSource(value) {
  return typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value) ? value.source : null;
}

function sameMembers(left, right) {
  return Array.isArray(left) && left.length === right.length && new Set(left).size === left.length
    && [...left].sort().every((entry, index) => entry === [...right].sort()[index]);
}

function equivalentPackageSetting(current, expected) {
  if (typeof expected === "string") return current === expected;
  if (!current || typeof current !== "object" || Array.isArray(current)) return false;
  const keys = ["extensions", "prompts", "skills", "source", "themes"];
  return Object.keys(current).sort().join("\0") === keys.join("\0")
    && current.source === expected.source
    && ["extensions", "prompts", "skills", "themes"].every((key) => sameMembers(current[key], expected[key]));
}

async function verifyHarnessPackageRoot(packageRoot, expectedVersion = null, unavailableCode = "STACK_OMP_ARTIFACT_INVALID") {
  if (typeof packageRoot !== "string" || !path.isAbsolute(packageRoot)) {
    fail(unavailableCode, "Harness package root must be absolute");
  }
  const root = path.resolve(packageRoot);
  const [rootStat, manifestStat, executableStat] = await Promise.all([
    fs.lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
    fs.lstat(path.join(root, "package.json")).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
    fs.lstat(path.join(root, "bin", "omp.mjs")).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error)),
  ]);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()
    || !manifestStat?.isFile() || manifestStat.isSymbolicLink()
    || !executableStat?.isFile() || executableStat.isSymbolicLink()) {
    fail(unavailableCode, "Harness package root is missing or unsafe");
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.name !== "only-my-pi" || (expectedVersion !== null && manifest.version !== expectedVersion)) {
    fail("STACK_OMP_ARTIFACT_IDENTITY_INVALID", "only-my-pi package identity differs from the stack manifest");
  }
  return root;
}

export function compileStackPackageSettings(settings, graphPlan) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings) || !Array.isArray(settings.packages) || !Array.isArray(graphPlan?.packages)) fail("STACK_SETTINGS_INVALID", "stack settings and generation package plan are required");
  const output = structuredClone(settings);
  for (const entry of graphPlan.packages) {
    const indices = output.packages.map((setting, index) => settingSource(setting) === entry.spec ? index : -1).filter((index) => index >= 0);
    if (indices.length !== 1) fail("STACK_PACKAGE_SELECTION_INVALID", `stack settings must select governed package exactly once: ${entry.id}`);
    const expected = entry.resourceFilter.length === 0 ? entry.spec : { source: entry.spec, extensions: [...entry.resourceFilter], skills: [], prompts: [], themes: [] };
    if (!equivalentPackageSetting(output.packages[indices[0]], expected)) output.packages[indices[0]] = expected;
  }
  return output;
}

export class StackHarnessAdapter {
  constructor({ rootDir, configRoot, spawnImpl } = {}) {
    if (![rootDir, configRoot].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("stack harness adapter requires absolute rootDir and configRoot");
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
    this.spawnImpl = spawnImpl;
  }

  async stage({ context, artifact } = {}) {
    const destination = path.join(context.paths.stage, "only-my-pi");
    await extractVerifiedTarGzip({ archivePath: artifact, destination, expectedSha256: context.stack.onlyMyPi.artifactSha256, maxEntries: 50_000, maxExtractedBytes: 512 * 1024 * 1024 });
    const packageRoot = path.join(destination, "package");
    context.harnessRoot = await verifyHarnessPackageRoot(packageRoot, context.stack.onlyMyPi.version);
  }

  candidateRoot(context) {
    const candidate = context?.harnessRoot;
    const expected = path.join(context?.paths?.stage ?? "", "only-my-pi", "package");
    if (typeof candidate !== "string" || !path.isAbsolute(candidate) || path.resolve(candidate) !== path.resolve(expected)) {
      fail("STACK_OMP_STAGE_MISSING", "candidate generation requires the verified staged only-my-pi artifact");
    }
    return path.resolve(candidate);
  }

  bootstrapFor(context) {
    const rootDir = this.candidateRoot(context);
    const options = this.spawnImpl === undefined ? {} : { spawnImpl: this.spawnImpl };
    const doctor = new DoctorService({ rootDir });
    const runner = createNpmCommandRunner({ configRoot: this.configRoot });
    const smokeRunner = createNoModelSmokeRunner({ ...options, piCommand: path.join(context.paths.stage, "bin", "pi") });
    const transaction = new TransactionEngine({ rootDir, runner, smokeRunner, doctorService: doctor });
    return new BootstrapService({ rootDir, doctorService: doctor, transactionEngine: transaction });
  }

  async publish({ context, settings } = {}) {
    const rootDir = this.candidateRoot(context);
    const graphPlan = await buildGenerationPlan({ rootDir, profileId: "daily", sourceCommit: context.stack.sourceCommit });
    const governedSettings = compileStackPackageSettings(settings, graphPlan);
    await saveSettings(this.configRoot, governedSettings);
    const bootstrap = this.bootstrapFor(context);
    const plan = await bootstrap.planBootstrap({ configRoot: this.configRoot, profile: "daily", scope: "global" });
    const result = plan.status === "NO_CHANGES"
      ? { ok: true, status: "NO_CHANGES", transactionId: null }
      : await bootstrap.applyBootstrap({ configRoot: this.configRoot, plan });
    const installed = await loadSettings(this.configRoot);
    const metadata = extractManagedMetadata(installed.settings);
    if (!metadata?.generationId) fail("STACK_GENERATION_MISSING", "candidate artifact did not publish an only-my-pi generation");
    return Object.freeze({
      settings: installed.settings,
      generationId: metadata.generationId,
      rollbackIdentity: result.transactionId ? { bootstrapTransactionId: result.transactionId } : null,
    });
  }

  async generationId({ context } = {}) {
    if (context.harnessGenerationId) return context.harnessGenerationId;
    const installed = await loadSettings(this.configRoot);
    return extractManagedMetadata(installed.settings)?.generationId ?? null;
  }

  async rollback({ rollback, piCommand, harnessRoot } = {}) {
    const transactionId = rollback?.harness?.bootstrapTransactionId;
    if (!transactionId) return Object.freeze({ status: "NO_HARNESS_ROLLBACK_REQUIRED" });
    if (typeof piCommand !== "string" || !path.isAbsolute(piCommand)) fail("STACK_ROLLBACK_PI_UNAVAILABLE", "Harness rollback requires an absolute controlled Pi entrypoint");
    const rootDir = await verifyHarnessPackageRoot(harnessRoot, null, "STACK_ROLLBACK_HARNESS_UNAVAILABLE");
    const options = this.spawnImpl === undefined ? {} : { spawnImpl: this.spawnImpl };
    const doctor = new DoctorService({ rootDir });
    const runner = createNpmCommandRunner({ configRoot: this.configRoot });
    const smokeRunner = createNoModelSmokeRunner({ ...options, piCommand });
    const transaction = new TransactionEngine({ rootDir, runner, smokeRunner, doctorService: doctor });
    const bootstrap = new BootstrapService({ rootDir, doctorService: doctor, transactionEngine: transaction });
    const plan = await bootstrap.planRollback({ configRoot: this.configRoot, snapshotId: `before-${transactionId}` });
    return bootstrap.rollback({ configRoot: this.configRoot, plan });
  }
}

export function createStackHarnessAdapter(options) {
  return new StackHarnessAdapter(options);
}
