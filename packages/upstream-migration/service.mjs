import path from "node:path";

import { canonicalJson, sha256 } from "../config-runtime/index.mjs";
import { inspectMigrationBundle } from "./contract.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function digestPlan(plan) {
  const unsigned = structuredClone(plan);
  delete unsigned.planDigest;
  return sha256(canonicalJson(unsigned));
}

function assertPlan(plan, configRoot) {
  if (plan?.formatVersion !== 1 || plan.kind !== "only-my-pi-upstream-migration-plan"
    || plan.configRoot !== configRoot || plan.planDigest !== digestPlan(plan)) {
    fail("MIGRATION_PLAN_INVALID", "a current immutable upstream migration plan is required");
  }
  return plan;
}

export class UpstreamMigrationService {
  constructor({ rootDir, configRoot, planner, engine } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("UpstreamMigrationService requires an absolute rootDir");
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("UpstreamMigrationService requires an absolute configRoot");
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
    this.planner = planner ?? null;
    this.engine = engine ?? null;
  }

  async plan({ bundle } = {}) {
    const inspected = await inspectMigrationBundle({ bundlePath: bundle, rootDir: this.rootDir });
    const preflight = this.planner?.inspect ? await this.planner.inspect({ manifest: inspected.manifest }) : null;
    const plan = {
      formatVersion: 1,
      kind: "only-my-pi-upstream-migration-plan",
      ok: true,
      status: "UPSTREAM_MIGRATION_PLAN",
      mutation: false,
      configRoot: this.configRoot,
      bundle: inspected.bundle,
      manifestDigest: inspected.manifest.manifestDigest,
      sourceCommit: inspected.manifest.sourceCommit,
      candidateGraphDigest: inspected.manifest.candidateGraphDigest,
      from: inspected.manifest.from,
      to: inspected.manifest.to,
      packages: inspected.manifest.externalPackages.map((entry) => ({ id: entry.id, name: entry.name, fromVersion: entry.fromVersion, toVersion: entry.toVersion, action: entry.action, binding: "external", owner: "user" })),
      processPolicy: { requirePiStopped: true, signal: "SIGTERM", timeoutSeconds: 15, forceKill: false },
      preflight,
      zeroWriteEvidence: inspected.zeroWriteEvidence,
    };
    return Object.freeze({ ...plan, planDigest: digestPlan(plan) });
  }

  async apply(options = {}) {
    if (!this.engine?.apply) fail("UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE", "upstream migration transaction engine is unavailable");
    const plan = assertPlan(options.plan, this.configRoot);
    const inspected = await inspectMigrationBundle({ bundlePath: options.bundle, rootDir: this.rootDir });
    if (inspected.bundle.sha256 !== plan.bundle.sha256 || inspected.manifest.manifestDigest !== plan.manifestDigest) {
      fail("MIGRATION_BUNDLE_CHANGED_AFTER_PLAN", "migration bundle changed after its reviewed plan");
    }
    return this.engine.apply({ ...options, plan, inspected });
  }

  async status(transactionId = null) {
    if (!this.engine?.status) return { ok: false, status: "UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE", mutation: false };
    return this.engine.status({ transactionId });
  }

  async rollback(options = {}) {
    if (!this.engine?.rollback) fail("UPSTREAM_TRANSACTION_ENGINE_UNAVAILABLE", "upstream migration transaction engine is unavailable");
    return this.engine.rollback(options);
  }
}

export function createUpstreamMigrationService(options) {
  return new UpstreamMigrationService(options);
}
