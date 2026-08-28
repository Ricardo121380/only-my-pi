import crypto from "node:crypto";

import { atomicWriteJson } from "../config-runtime/index.mjs";
import {
  advanceUpstreamJournal,
  createUpstreamJournal,
  listUpstreamJournals,
  loadUpstreamJournal,
  markUpstreamRecovery,
  upstreamTransactionPaths,
} from "./journal.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function safePlanRecord(plan) {
  return Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-upstream-transaction-plan",
    planDigest: plan.planDigest,
    bundleDigest: plan.bundle.sha256,
    manifestDigest: plan.manifestDigest,
    sourceCommit: plan.sourceCommit,
    candidateGraphDigest: plan.candidateGraphDigest,
    from: plan.from,
    to: plan.to,
    packages: plan.packages,
    processPolicy: plan.processPolicy,
    piProcesses: plan.piProcesses,
    preflight: plan.preflight ? {
      settingsDigest: plan.preflight.settings.digest,
      generationId: plan.preflight.generation.generationId,
      lkgGenerationId: plan.preflight.generation.lkgGenerationId,
      pi: plan.preflight.pi,
      external: plan.preflight.external,
      ownership: plan.preflight.ownership,
      privacy: plan.preflight.privacy,
    } : null,
  });
}

function receiptFor(plan, transactionId, status, failureCode = null) {
  return Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration-receipt",
    transactionId,
    status,
    failureCode,
    sourceCommit: plan?.sourceCommit ?? null,
    bundleDigest: plan?.bundle?.sha256 ?? plan?.bundleDigest ?? null,
    manifestDigest: plan?.manifestDigest ?? null,
    candidateGraphDigest: plan?.candidateGraphDigest ?? null,
    from: plan?.from ?? null,
    to: plan?.to ?? null,
    externalOwnership: { binding: "external", owner: "user", packageCount: 9 },
    secretMaterialRecorded: false,
    hostAbsolutePathsRecorded: false,
  });
}

function assertApplyInput(options) {
  const { plan, inspected } = options;
  if (plan?.kind !== "only-my-pi-upstream-migration-plan" || typeof plan.planDigest !== "string") fail("MIGRATION_PLAN_INVALID", "reviewed migration plan is required");
  if (inspected?.bundle?.sha256 !== plan.bundle.sha256 || inspected?.manifest?.manifestDigest !== plan.manifestDigest) fail("MIGRATION_BUNDLE_CHANGED_AFTER_PLAN", "verified bundle differs from the reviewed plan");
}

export class CrossRootTransactionEngine {
  constructor({ configRoot, platform, processAdmission, transactionIdFactory = () => crypto.randomUUID(), onBoundary } = {}) {
    if (typeof configRoot !== "string" || !configRoot.startsWith("/")) throw new TypeError("CrossRootTransactionEngine requires an absolute configRoot");
    if (!platform) throw new TypeError("CrossRootTransactionEngine requires a platform adapter");
    this.configRoot = configRoot;
    this.platform = platform;
    this.processAdmission = processAdmission ?? null;
    this.transactionIdFactory = transactionIdFactory;
    this.onBoundary = onBoundary;
  }

  async advance(context, phase, details = {}) {
    context.journal = await advanceUpstreamJournal(this.configRoot, context.transactionId, phase, details);
    if (typeof this.onBoundary === "function") await this.onBoundary(phase, Object.freeze({ transactionId: context.transactionId, journal: context.journal }));
    return context.journal;
  }

  async recoverPending() {
    const incomplete = await listUpstreamJournals(this.configRoot, { incompleteOnly: true });
    const receipts = [];
    for (const journal of incomplete.sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
      const result = await this.recoverTransaction(journal.transactionId, { failureCode: "AUTOMATIC_CRASH_RECOVERY" });
      receipts.push(result);
      if (result.status === "MANUAL_RECONCILIATION_REQUIRED") fail("MANUAL_RECONCILIATION_REQUIRED", "an incomplete upstream transaction cannot be recovered automatically", { transactionId: journal.transactionId });
    }
    return Object.freeze(receipts);
  }

  async apply(options = {}) {
    assertApplyInput(options);
    await this.recoverPending();
    const pending = await listUpstreamJournals(this.configRoot, { incompleteOnly: true });
    if (pending.length > 0) fail("UPSTREAM_TRANSACTION_INCOMPLETE", "another upstream transaction is incomplete");
    const { plan, inspected } = options;
    const transactionId = this.transactionIdFactory();
    const paths = upstreamTransactionPaths(this.configRoot, transactionId);
    let context = { transactionId, paths, plan, inspected, options, journal: null, state: {} };
    context.journal = await createUpstreamJournal(this.configRoot, {
      transactionId,
      planDigest: plan.planDigest,
      bundleDigest: plan.bundle.sha256,
      sourceCommit: plan.sourceCommit,
    });
    await atomicWriteJson(this.configRoot, paths.plan, safePlanRecord(plan), { mode: 0o600 });
    try {
      await this.platform.preflight(context);
      await this.advance(context, "PREFLIGHT_VERIFIED");
      await this.platform.backup(context);
      await this.advance(context, "BACKUP_DURABLE");
      await this.platform.stagePi(context);
      await this.advance(context, "PI_STAGED");
      await this.platform.stageExternalTree(context);
      await this.advance(context, "EXTERNAL_TREE_STAGED");
      await this.platform.stageGeneration(context);
      await this.advance(context, "GENERATION_STAGED");
      await this.platform.stageCli(context);
      await this.advance(context, "CLI_STAGED");
      if (this.processAdmission) {
        context.state.processes = await this.processAdmission.terminate(plan.piProcesses ?? [], { authorized: options.terminatePi === true });
      } else if ((plan.piProcesses ?? []).length > 0) {
        fail("PI_PROCESS_ADMISSION_UNAVAILABLE", "cannot stop reviewed Pi processes without a process admission service");
      }
      await this.advance(context, "PI_PROCESSES_STOPPED");
      await this.platform.renamePiOld(context);
      await this.advance(context, "PI_OLD_RENAMED");
      await this.platform.renamePiNew(context);
      await this.advance(context, "PI_NEW_RENAMED");
      await this.platform.renameExternalOld(context);
      await this.advance(context, "EXTERNAL_OLD_RENAMED");
      await this.platform.renameExternalNew(context);
      await this.advance(context, "EXTERNAL_NEW_RENAMED");
      await this.platform.publishSettings(context);
      await this.advance(context, "SETTINGS_PUBLISHED");
      await this.platform.activateGeneration(context);
      await this.advance(context, "GENERATION_ACTIVATED");
      await this.platform.activateCli(context);
      await this.advance(context, "CLI_ACTIVATED");
      await this.platform.staticDoctor(context);
      await this.advance(context, "STATIC_DOCTOR_PASSED");
      await this.platform.noModelSmoke(context);
      await this.advance(context, "NO_MODEL_SMOKE_PASSED");
      await this.platform.recordLkg(context);
      await this.advance(context, "LKG_RECORDED");
      await this.platform.commit(context);
      await this.advance(context, "COMMITTED");
      const receipt = receiptFor(plan, transactionId, "COMMITTED");
      await atomicWriteJson(this.configRoot, paths.receipt, receipt, { mode: 0o600 });
      return Object.freeze({ ok: true, status: "COMMITTED", mutation: true, transactionId, receipt });
    } catch (error) {
      if (error?.simulateCrash === true) throw error;
      let recovery;
      try { recovery = await this.recoverTransaction(transactionId, { failureCode: error?.code ?? "UPSTREAM_APPLY_FAILED" }); } catch (recoveryError) {
        await markUpstreamRecovery(this.configRoot, transactionId, { status: "MANUAL_RECONCILIATION_REQUIRED", failureCode: recoveryError?.code ?? "RECOVERY_FAILED" });
        error.recovery = { status: "MANUAL_RECONCILIATION_REQUIRED", code: recoveryError?.code ?? "RECOVERY_FAILED" };
        throw error;
      }
      error.recovery = recovery;
      throw error;
    }
  }

  async recoverTransaction(transactionId, { failureCode = "AUTOMATIC_RECOVERY" } = {}) {
    let journal = await loadUpstreamJournal(this.configRoot, transactionId);
    if (["ROLLED_BACK", "FAILED", "MANUAL_RECONCILIATION_REQUIRED"].includes(journal.status)) return Object.freeze({ transactionId, status: journal.status });
    journal = await markUpstreamRecovery(this.configRoot, transactionId, { status: "RECOVERING", failureCode });
    const result = await this.platform.rollback({ transactionId, paths: upstreamTransactionPaths(this.configRoot, transactionId), journal, state: {} });
    const status = result?.manualReconciliation === true ? "MANUAL_RECONCILIATION_REQUIRED" : "ROLLED_BACK";
    await markUpstreamRecovery(this.configRoot, transactionId, { status, failureCode: result?.code ?? failureCode, recovery: result ?? null });
    const plan = await this.platform.readRecordedPlan?.(transactionId) ?? null;
    const receipt = receiptFor(plan, transactionId, status, result?.code ?? failureCode);
    await atomicWriteJson(this.configRoot, upstreamTransactionPaths(this.configRoot, transactionId).receipt, receipt, { mode: 0o600 });
    return Object.freeze({ ok: status === "ROLLED_BACK", status, mutation: true, transactionId, recovery: result ?? null });
  }

  async rollback({ transactionId, terminatePi = false } = {}) {
    const journal = await loadUpstreamJournal(this.configRoot, transactionId);
    if (journal.status !== "COMMITTED") fail("UPSTREAM_ROLLBACK_NOT_COMMITTED", "explicit upstream rollback requires a committed transaction");
    if (this.processAdmission) {
      const current = await this.processAdmission.plan();
      await this.processAdmission.terminate(current, { authorized: terminatePi === true });
    }
    return this.recoverTransaction(transactionId, { failureCode: "EXPLICIT_UPSTREAM_ROLLBACK" });
  }

  async status({ transactionId = null } = {}) {
    if (transactionId) return Object.freeze({ ok: true, status: "UPSTREAM_TRANSACTION_STATUS", mutation: false, journal: await loadUpstreamJournal(this.configRoot, transactionId) });
    const journals = await listUpstreamJournals(this.configRoot);
    return Object.freeze({ ok: true, status: "UPSTREAM_TRANSACTION_LIST", mutation: false, transactions: journals.map((entry) => ({ transactionId: entry.transactionId, status: entry.status, phase: entry.phase, createdAt: entry.createdAt, failureCode: entry.failureCode })) });
  }
}

export function createCrossRootTransactionEngine(options) {
  return new CrossRootTransactionEngine(options);
}
