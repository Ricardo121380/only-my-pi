import fs from "node:fs/promises";
import path from "node:path";

import { BootstrapService } from "../bootstrap/bootstrap-service.mjs";
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
    const [manifestStat, executableStat] = await Promise.all([
      fs.lstat(path.join(packageRoot, "package.json")),
      fs.lstat(path.join(packageRoot, "bin", "omp.mjs")),
    ]);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || !executableStat.isFile() || executableStat.isSymbolicLink()) fail("STACK_OMP_ARTIFACT_INVALID", "only-my-pi artifact did not contain a safe CLI package");
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== "only-my-pi" || manifest.version !== context.stack.onlyMyPi.version) fail("STACK_OMP_ARTIFACT_IDENTITY_INVALID", "only-my-pi artifact package identity differs from the stack manifest");
  }

  bootstrapFor(context) {
    const options = this.spawnImpl === undefined ? {} : { spawnImpl: this.spawnImpl };
    const doctor = new DoctorService({ rootDir: this.rootDir });
    const runner = createNpmCommandRunner({ configRoot: this.configRoot });
    const smokeRunner = createNoModelSmokeRunner({ ...options, piCommand: path.join(context.paths.stage, "bin", "pi") });
    const transaction = new TransactionEngine({ rootDir: this.rootDir, runner, smokeRunner, doctorService: doctor });
    return new BootstrapService({ rootDir: this.rootDir, doctorService: doctor, transactionEngine: transaction });
  }

  async publish({ context, settings } = {}) {
    await saveSettings(this.configRoot, settings);
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

  async rollback({ rollback } = {}) {
    const transactionId = rollback?.harness?.bootstrapTransactionId;
    if (!transactionId) return Object.freeze({ status: "NO_HARNESS_ROLLBACK_REQUIRED" });
    const doctor = new DoctorService({ rootDir: this.rootDir });
    const runner = createNpmCommandRunner({ configRoot: this.configRoot });
    const transaction = new TransactionEngine({ rootDir: this.rootDir, runner, doctorService: doctor });
    const bootstrap = new BootstrapService({ rootDir: this.rootDir, doctorService: doctor, transactionEngine: transaction });
    const plan = await bootstrap.planRollback({ configRoot: this.configRoot, snapshotId: `before-${transactionId}` });
    return bootstrap.rollback({ configRoot: this.configRoot, plan });
  }
}

export function createStackHarnessAdapter(options) {
  return new StackHarnessAdapter(options);
}
