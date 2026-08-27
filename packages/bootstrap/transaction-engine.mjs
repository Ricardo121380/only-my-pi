import crypto from "node:crypto";
import path from "node:path";

import {
  acquireExclusiveLock,
  advanceJournal,
  beginTransactionRecovery,
  compareAndRemoveSettings,
  compareAndSaveSettings,
  configRuntimePaths,
  createJournal,
  createSnapshot,
  durableRemoveFile,
  hashFile,
  listTransactionJournals,
  loadJournal,
  loadOwnedSettingsSnapshot,
  loadSettings,
  relativeConfigPath,
  settingsDigest,
  settleTransactionRecovery,
  verifyLastKnownGood,
  verifyTransactionRecoveryEvidence,
  writeState,
} from "../config-runtime/index.mjs";
import { createDoctorService } from "./doctor-service.mjs";
import { buildGenerationPlan } from "./index.mjs";
import {
  atomicPromoteGeneration,
  createGenerationLayout,
  removeStagingGeneration,
  removeUnreferencedGeneration,
  stageAndPromoteGeneration,
  verifyGenerationByManifest,
  verifyPromotedGeneration,
} from "./npm-stager.mjs";
import { compileGenerationSettings } from "./settings-compiler.mjs";
import { bindExistingPackages } from "./package-bindings.mjs";
import {
  MANAGED_SETTING_FIELDS,
  compilePublishedSettings,
  compileUninstalledSettings,
  extractManagedMetadata,
} from "./settings-merge.mjs";

export const BOOTSTRAP_OWNED_PATHS = Object.freeze([
  ...MANAGED_SETTING_FIELDS.map((field) => `/${field}`),
  "/onlyMyPi",
].sort());

const TERMINAL = new Set(["COMMITTED", "ROLLED_BACK", "FAILED"]);
const REPAIRABLE_STATE_ERRORS = new Set([
  "ENOENT",
  "EMPTY_JSON",
  "MALFORMED_JSON",
  "INVALID_JSON_ROOT",
  "INVALID_LAST_KNOWN_GOOD",
  "LAST_KNOWN_GOOD_DIGEST_MISMATCH",
  "SNAPSHOT_SETTINGS_HASH_MISMATCH",
  "SNAPSHOT_DIGEST_MISMATCH",
  "INVALID_SNAPSHOT",
  "GENERATION_MANIFEST_HASH_MISMATCH",
  "CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD",
]);

export const TRANSACTION_DURABLE_BOUNDARIES = Object.freeze([
  "PREPARED",
  "BACKUP_DURABLE",
  "GRAPH_STAGING",
  "GRAPH_STAGED",
  "GRAPH_VERIFIED",
  "GENERATION_RENAMED",
  "GRAPH_PROMOTED",
  "SETTINGS_RENAMED",
  "SETTINGS_PUBLISHED",
  "STATIC_DOCTOR_PASSED",
  "SMOKE_PASSED",
  "LAST_KNOWN_GOOD_RECORDED",
  "LAST_KNOWN_GOOD_CLEARED",
  "COMMITTED",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function explicitConfigRoot(configRoot) {
  if (typeof configRoot !== "string" || configRoot.length === 0) {
    fail("CONFIG_ROOT_REQUIRED", "an explicit absolute configRoot is required");
  }
  if (!path.isAbsolute(configRoot)) {
    fail("CONFIG_ROOT_NOT_ABSOLUTE", "configRoot must be an explicit absolute path");
  }
  const resolved = path.resolve(configRoot);
  if (resolved === path.parse(resolved).root) {
    fail("CONFIG_ROOT_TOO_BROAD", "a filesystem root cannot be used as configRoot");
  }
  return resolved;
}

function desiredMetadataFromPlan(plan) {
  return plan.desired?.metadata ?? null;
}

function assertStaticDoctor(result) {
  if (result?.ok !== true || result.errors !== 0) {
    fail("STATIC_DOCTOR_FAILED", "repository static doctor rejected the target profile", { doctor: result });
  }
}

function assertSmoke(result) {
  if (result?.ok !== true) fail("NO_MODEL_SMOKE_FAILED", "isolated no-model startup smoke did not pass", { smoke: result });
}

function isDeepEmptyObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every(isDeepEmptyObject);
}

function cloneSettings(value) {
  return JSON.parse(JSON.stringify(value));
}

function settingsExpectation(state) {
  return Object.freeze({ exists: state.exists, digest: state.digest });
}

/**
 * Reconcile only the entries claimed by the current and historical
 * onlyMyPi.managedSettings receipts. The top-level Pi arrays contain both user
 * and managed values, so restoring the snapshot's complete arrays would erase
 * user entries added after the snapshot was taken.
 */
export function compileRollbackSettings(currentSettings, snapshot) {
  if (snapshot?.owned === null || typeof snapshot?.owned !== "object") {
    throw new TypeError("rollback requires an owned settings snapshot");
  }
  const present = new Set(snapshot.owned.present ?? []);
  const currentMetadata = extractManagedMetadata(currentSettings);
  let reconciled = currentMetadata === null
    ? cloneSettings(currentSettings)
    : compileUninstalledSettings(currentSettings);
  const historicalMetadata = present.has("/onlyMyPi")
    ? extractManagedMetadata(snapshot.owned.values ?? {})
    : null;

  if (historicalMetadata !== null) {
    reconciled = compilePublishedSettings(
      reconciled,
      historicalMetadata.managedSettings,
      historicalMetadata,
    );
  }

  // Preserve historical absence without deleting a field that now contains a
  // user entry. This keeps first-install rollback capable of removing an
  // originally absent settings file while retaining later user additions.
  for (const field of MANAGED_SETTING_FIELDS) {
    if (!present.has(`/${field}`) && Array.isArray(reconciled[field]) && reconciled[field].length === 0) {
      delete reconciled[field];
    }
  }
  return reconciled;
}

export class TransactionEngine {
  constructor({
    rootDir,
    runner,
    smokeRunner,
    doctorService,
    transactionIdFactory = () => crypto.randomUUID(),
    onBoundary,
    settingsAtomic,
    generationRuntime = {},
  } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
      throw new TypeError("TransactionEngine requires an absolute rootDir");
    }
    this.rootDir = path.resolve(rootDir);
    this.runner = runner ?? null;
    this.smokeRunner = smokeRunner ?? null;
    this.doctor = doctorService ?? createDoctorService({ rootDir: this.rootDir });
    this.transactionIdFactory = transactionIdFactory;
    this.onBoundary = onBoundary;
    this.settingsAtomic = settingsAtomic;
    this.generation = Object.freeze({
      buildPlan: generationRuntime.buildPlan ?? buildGenerationPlan,
      createLayout: generationRuntime.createLayout ?? createGenerationLayout,
      stageAndPromote: generationRuntime.stageAndPromote ?? stageAndPromoteGeneration,
      promote: generationRuntime.promote ?? atomicPromoteGeneration,
      verifyByManifest: generationRuntime.verifyByManifest ?? verifyGenerationByManifest,
      verifyPromoted: generationRuntime.verifyPromoted ?? verifyPromotedGeneration,
      compileSettings: generationRuntime.compileSettings ?? compileGenerationSettings,
      removeStaging: generationRuntime.removeStaging ?? removeStagingGeneration,
      removeUnreferenced: generationRuntime.removeUnreferenced ?? removeUnreferencedGeneration,
    });
  }

  generationLayout(configRoot, generationId, transactionId) {
    if (generationId === null) return null;
    return this.generation.createLayout({ configRoot, graphDigest: generationId, transactionId });
  }

  async boundary(name, context) {
    if (typeof this.onBoundary === "function") await this.onBoundary(name, Object.freeze({ ...context }));
  }

  async recoverPending(configRoot, options = {}) {
    configRoot = explicitConfigRoot(configRoot);
    const incomplete = (await listTransactionJournals(configRoot, { incompleteOnly: true }))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const receipts = [];
    for (const journal of incomplete) receipts.push(await this.recoverJournal(configRoot, journal, options));
    return receipts;
  }

  async recoverJournal(configRoot, journalInput, options = {}) {
    configRoot = explicitConfigRoot(configRoot);
    let journal = await loadJournal(configRoot, journalInput.transactionId);
    if (TERMINAL.has(journal.status)) return { transactionId: journal.transactionId, status: journal.status };
    const layout = this.generationLayout(configRoot, journal.generationId, journal.transactionId);
    let snapshot = null;
    let current = null;
    let recoveryEvidence = {};
    let disposition = "NOT_APPLICABLE";

    if (journal.phase !== "PREPARED") {
      snapshot = await loadOwnedSettingsSnapshot(configRoot, journal.snapshotId);
    }
    if (journal.intendedSettingsDigest) {
      current = await loadSettings(configRoot);
      recoveryEvidence = {
        currentSettingsDigest: current.digest,
        snapshotSourceDigest: snapshot.source.digest,
        preserveConcurrentSettings: true,
      };
      disposition = verifyTransactionRecoveryEvidence(journal, recoveryEvidence).settingsDisposition;
    }

    journal = await beginTransactionRecovery(configRoot, journal.transactionId, { evidence: recoveryEvidence });
    if (disposition === "RESTORE_SNAPSHOT") {
      const restoredSettings = compileRollbackSettings(current.settings, snapshot);
      if (snapshot.source.exists === false && isDeepEmptyObject(restoredSettings)) {
        current = await compareAndRemoveSettings(configRoot, {
          expectedCurrent: settingsExpectation(current),
          atomic: this.settingsAtomic,
        });
      } else {
        current = await compareAndSaveSettings(configRoot, restoredSettings, {
          expectedCurrent: settingsExpectation(current),
          atomic: this.settingsAtomic,
        });
      }
    }

    if (layout) {
      await this.generation.removeStaging({ layout });
      if (journal.promotionCreated === true) {
        let referencesTransactionGeneration = true;
        try {
          current ??= await loadSettings(configRoot);
          referencesTransactionGeneration = extractManagedMetadata(current.settings)?.generationId === journal.generationId;
        } catch {
          // Malformed concurrent ownership metadata fails safe by retaining the
          // immutable generation rather than creating a dangling reference.
        }
        if (!referencesTransactionGeneration) {
          await this.generation.removeUnreferenced({
            layout,
            expectedManifestDigest: journal.generationManifestDigest,
          });
        }
      }
    }

    let lastKnownGood;
    if (options.reconcileLastKnownGood === false || disposition === "PRESERVE_CONCURRENT") {
      try {
        lastKnownGood = await this.reconcileLastKnownGood(configRoot);
      } catch (error) {
        lastKnownGood = Object.freeze({
          status: "DEGRADED_CURRENT_GENERATION",
          mutation: false,
          generationId: null,
          errorCode: error?.code ?? "CURRENT_GENERATION_UNAVAILABLE",
        });
      }
    } else {
      lastKnownGood = await this.reconcileLastKnownGood(configRoot);
    }

    const concurrent = disposition === "PRESERVE_CONCURRENT";
    const settled = await settleTransactionRecovery(configRoot, journal.transactionId, concurrent ? "FAILED" : "ROLLED_BACK", {
      failureCode: concurrent ? "CONCURRENT_SETTINGS_CHANGE" : "AUTOMATIC_RECOVERY",
    });
    return {
      transactionId: settled.transactionId,
      status: settled.status,
      phase: settled.phase,
      settingsDisposition: disposition,
      lastKnownGood,
    };
  }

  async reconcileLastKnownGood(configRoot) {
    const current = await loadSettings(configRoot);
    const metadata = extractManagedMetadata(current.settings);
    const stateFile = configRuntimePaths(configRoot).lastKnownGoodFile;
    if (metadata === null) {
      const cleared = await durableRemoveFile(configRoot, stateFile);
      return Object.freeze({
        status: cleared.removed ? "CLEARED" : "UNCHANGED",
        mutation: cleared.removed,
        generationId: null,
      });
    }

    const generationId = metadata.generationId ?? metadata.graphDigest ?? null;
    if (typeof generationId !== "string" || generationId !== metadata.graphDigest) {
      fail("RECOVERY_METADATA_INVALID", "restored only-my-pi metadata has no canonical generation identity");
    }
    try {
      const state = (await verifyLastKnownGood(configRoot)).state;
      if (state.settingsDigest === current.digest && state.generationId === generationId) {
        return Object.freeze({ status: "PRESERVED", mutation: false, generationId });
      }
    } catch (error) {
      if (!REPAIRABLE_STATE_ERRORS.has(error?.code)) throw error;
    }

    const layout = this.generationLayout(configRoot, generationId, "reconcile-last-known-good");
    await this.generation.verifyByManifest({ layout });
    const snapshotId = `lkg-reconciled-${generationId.slice(7, 19)}-${current.digest.slice(7, 19)}`;
    let snapshot;
    try {
      snapshot = await createSnapshot(configRoot, { id: snapshotId, ownedPaths: BOOTSTRAP_OWNED_PATHS });
    } catch (error) {
      if (error?.code !== "SNAPSHOT_EXISTS") throw error;
      snapshot = await loadOwnedSettingsSnapshot(configRoot, snapshotId);
      if (snapshot.source.digest !== current.digest) {
        fail("LKG_SNAPSHOT_DRIFT", "existing recovery LKG snapshot does not match restored settings");
      }
    }
    const manifestPath = path.join(layout.generationRoot, layout.manifestName);
    const generationManifestDigest = await hashFile(configRoot, manifestPath);
    await writeState(configRoot, {
      generationId,
      generationManifestRelativePath: relativeConfigPath(configRoot, manifestPath),
      generationManifestDigest,
      settingsDigest: current.digest,
      snapshotId: snapshot.snapshotId,
      transactionId: null,
      metadata: {
        providerSelection: metadata.providerSelection ?? null,
        initialMode: metadata.initialMode ?? null,
      },
    });
    return Object.freeze({ status: "REBUILT", mutation: true, generationId });
  }

  async withMutationLock(configRoot, operation, callback, options = {}) {
    configRoot = explicitConfigRoot(configRoot);
    const lock = await acquireExclusiveLock(configRoot, {
      operation: operation === "rollback" ? "rollback" : "apply",
    });
    try {
      const shouldReconcile = options.reconcileLastKnownGood !== false;
      const recovered = await this.recoverPending(configRoot, { reconcileLastKnownGood: shouldReconcile });
      const reconciledLastKnownGood = shouldReconcile
        ? await this.reconcileLastKnownGood(configRoot)
        : Object.freeze({ status: "DEFERRED_FOR_REPAIR_OPERATION", mutation: false, generationId: null });
      return await callback({ lock, recovered, reconciledLastKnownGood });
    } finally {
      await lock.release();
    }
  }

  async createTransaction({ configRoot, operation, profileId, generationId }) {
    const transactionId = this.transactionIdFactory();
    const snapshotId = `before-${transactionId}`;
    let journal = await createJournal(configRoot, {
      transactionId,
      operation,
      profileId,
      generationId,
      snapshotId,
    });
    try {
      await this.boundary("PREPARED", { journal });
      await createSnapshot(configRoot, {
        id: snapshotId,
        ownedPaths: BOOTSTRAP_OWNED_PATHS,
      });
      journal = await advanceJournal(configRoot, transactionId, "BACKUP_DURABLE", { expectedPhase: journal.phase });
      await this.boundary("BACKUP_DURABLE", { journal });
      return journal;
    } catch (error) {
      error.transactionJournal = journal;
      throw error;
    }
  }

  async advance(configRoot, journal, phase, options = {}) {
    const next = await advanceJournal(configRoot, journal.transactionId, phase, {
      expectedPhase: journal.phase,
      ...(options.evidence ? { evidence: options.evidence } : {}),
    });
    try {
      await this.boundary(phase, { journal: next });
      return next;
    } catch (error) {
      error.transactionJournal = next;
      throw error;
    }
  }

  async finishVisibleMutation({
    configRoot,
    journal,
    intendedSettings,
    metadata,
    generationVerification,
    expectedCurrent,
    publishAbsence = false,
  }) {
    const saved = publishAbsence
      ? await compareAndRemoveSettings(configRoot, {
          expectedCurrent,
          atomic: this.settingsAtomic,
        })
      : await compareAndSaveSettings(configRoot, intendedSettings, {
          expectedCurrent,
          atomic: this.settingsAtomic,
        });
    if (saved.digest !== journal.intendedSettingsDigest) {
      fail("SETTINGS_PUBLICATION_DIGEST_MISMATCH", "published settings do not match the durable transaction intent");
    }
    await this.boundary("SETTINGS_RENAMED", { journal, settingsDigest: saved.digest });
    journal = await this.advance(configRoot, journal, "SETTINGS_PUBLISHED");

    const staticResult = this.doctor.static({ profileId: metadata?.profileId ?? null, strict: false });
    assertStaticDoctor(staticResult);
    journal = await this.advance(configRoot, journal, "STATIC_DOCTOR_PASSED");

    if (typeof this.smokeRunner !== "function") {
      fail("SMOKE_RUNNER_UNAVAILABLE", "mutation requires an isolated no-model smoke runner");
    }
    const smoke = await this.smokeRunner({
      configRoot,
      operation: journal.operation,
      settings: saved.settings,
      generation: generationVerification ?? null,
    });
    assertSmoke(smoke);
    journal = await this.advance(configRoot, journal, "SMOKE_PASSED");

    let lastKnownGood = null;
    let lkgStatus;
    if (journal.generationId !== null) {
      lastKnownGood = await this.repairLastKnownGood({ configRoot, journal, metadata });
      lkgStatus = "RECORDED";
      await this.boundary("LAST_KNOWN_GOOD_RECORDED", { journal, lastKnownGood });
    } else {
      const stateFile = configRuntimePaths(configRoot).lastKnownGoodFile;
      await durableRemoveFile(configRoot, stateFile);
      lkgStatus = "CLEARED";
      await this.boundary("LAST_KNOWN_GOOD_CLEARED", { journal });
    }
    journal = await this.advance(configRoot, journal, "COMMITTED");
    return { journal, saved, smoke, staticResult, lastKnownGood, lkgStatus };
  }

  async settleUnpublishedCasConflict(configRoot, journalInput, error) {
    if (error?.code !== "CONCURRENT_SETTINGS_CHANGE" || error.atomicPublication !== "NOT_PUBLISHED") {
      return null;
    }
    return this.recoverJournal(configRoot, journalInput, {
      // A concurrent writer owns the current settings state. Journal cleanup
      // must still terminate even if that state cannot become our LKG.
      reconcileLastKnownGood: false,
    });
  }

  async repairLastKnownGood({ configRoot, journal, metadata }) {
    const layout = this.generationLayout(configRoot, journal.generationId, journal.transactionId);
    const verified = await this.generation.verifyByManifest({
      layout,
      expectedManifestDigest: journal.generationManifestDigest,
    });
    const current = await loadSettings(configRoot);
    if (current.digest !== journal.intendedSettingsDigest) {
      fail("LKG_SETTINGS_DRIFT", "cannot record last-known-good after settings drift");
    }
    const snapshotId = `lkg-${journal.transactionId}`;
    let snapshot;
    try {
      snapshot = await createSnapshot(configRoot, { id: snapshotId, ownedPaths: BOOTSTRAP_OWNED_PATHS });
    } catch (error) {
      if (error?.code !== "SNAPSHOT_EXISTS") throw error;
      snapshot = await loadOwnedSettingsSnapshot(configRoot, snapshotId);
      if (snapshot.source.digest !== current.digest) fail("LKG_SNAPSHOT_DRIFT", "existing LKG snapshot does not match current settings");
    }
    const manifestPath = path.join(layout.generationRoot, layout.manifestName);
    const generationManifestDigest = await hashFile(configRoot, manifestPath);
    return writeState(configRoot, {
      generationId: journal.generationId,
      generationManifestRelativePath: relativeConfigPath(configRoot, manifestPath),
      generationManifestDigest,
      settingsDigest: current.digest,
      snapshotId: snapshot.snapshotId,
      transactionId: journal.transactionId,
      metadata: {
        providerSelection: metadata?.providerSelection ?? null,
        initialMode: metadata?.initialMode ?? null,
      },
    });
  }

  async applyGraphPlan(plan, { operation }) {
    const configRoot = explicitConfigRoot(plan?.configRoot);
    if (plan.status === "NO_CHANGES") {
      return this.withMutationLock(configRoot, operation, async ({ recovered, reconciledLastKnownGood }) => ({
        ok: true,
        status: recovered.length > 0
          ? "RECOVERED_REPLAN_REQUIRED"
          : (reconciledLastKnownGood.mutation ? "REPAIRED_NO_CHANGES" : "NO_CHANGES"),
        mutation: recovered.length > 0 || reconciledLastKnownGood.mutation,
        planDigest: plan.planDigest,
        recovered,
        reconciledLastKnownGood,
      }));
    }
    return this.withMutationLock(configRoot, operation, async ({ recovered }) => {
      const current = await loadSettings(configRoot);
      if (current.digest !== plan.sourceSettings.digest) {
        fail("PLAN_STALE", "settings changed after plan generation", { recovered });
      }
      const freshBaseGraph = await this.generation.buildPlan({ rootDir: this.rootDir, profileId: plan.profileId });
      // v2 bootstrap plans bind package ownership before entering the
      // transaction. Recompute that read-only evidence while holding the
      // mutation lock. Injected v1 graph seams used by recovery tests and old
      // callers carry no packageBindings and retain their original digest.
      const freshGraph = Array.isArray(plan.graphPlan?.packageBindings)
        ? await bindExistingPackages({
            configRoot,
            settings: current.settings,
            plan: freshBaseGraph,
            priorBindings: plan.current?.metadata?.packageBindings,
          })
        : freshBaseGraph;
      if (freshGraph.graphDigest !== plan.graphPlan.graphDigest) {
        fail("PLAN_STALE", "inventory, profile, or first-party resources changed after plan generation", { recovered });
      }
      if (typeof this.runner !== "function") fail("PACKAGE_RUNNER_UNAVAILABLE", "graph mutation requires the scripts-disabled npm runner");

      let journal;
      try {
        journal = await this.createTransaction({
          configRoot,
          operation,
          profileId: plan.profileId,
          generationId: freshGraph.graphDigest,
        });
        journal = await this.advance(configRoot, journal, "GRAPH_STAGING");
        const layout = this.generationLayout(configRoot, freshGraph.graphDigest, journal.transactionId);
        let intendedSettings;
        let promotedVerification;

        const staged = await this.generation.stageAndPromote({
          plan: freshGraph,
          configRoot,
          transactionId: journal.transactionId,
          artifactRoot: this.rootDir,
          runCommand: this.runner,
          promote: async (promotion) => {
            journal = await this.advance(configRoot, journal, "GRAPH_STAGED");
            journal = await this.advance(configRoot, journal, "GRAPH_VERIFIED", {
              evidence: { generationManifestDigest: promotion.manifestDigest },
            });
            await this.generation.promote(promotion);
            await this.boundary("GENERATION_RENAMED", { journal, promotion });
            promotedVerification = await this.generation.verifyPromoted({ plan: freshGraph, layout });
            const compiled = await this.generation.compileSettings({
              plan: freshGraph,
              promotion: promotedVerification.receipt,
              configRoot,
              transactionId: journal.transactionId,
            });
            intendedSettings = compilePublishedSettings(
              current.settings,
              compiled.ownedSettings,
              desiredMetadataFromPlan(plan),
            );
            journal = await this.advance(configRoot, journal, "GRAPH_PROMOTED", {
              evidence: {
                promotionCreated: true,
                intendedSettingsDigest: settingsDigest(intendedSettings),
              },
            });
          },
        });

        if (journal.phase === "GRAPH_STAGING") {
          journal = await this.advance(configRoot, journal, "GRAPH_STAGED");
          journal = await this.advance(configRoot, journal, "GRAPH_VERIFIED", {
            evidence: { generationManifestDigest: staged.manifest.manifestDigest },
          });
          promotedVerification = await this.generation.verifyPromoted({ plan: freshGraph, layout });
          const compiled = await this.generation.compileSettings({
            plan: freshGraph,
            promotion: promotedVerification.receipt,
            configRoot,
            transactionId: journal.transactionId,
          });
          intendedSettings = compilePublishedSettings(
            current.settings,
            compiled.ownedSettings,
            desiredMetadataFromPlan(plan),
          );
          journal = await this.advance(configRoot, journal, "GRAPH_PROMOTED", {
            evidence: {
              promotionCreated: false,
              intendedSettingsDigest: settingsDigest(intendedSettings),
            },
          });
        }

        const completed = await this.finishVisibleMutation({
          configRoot,
          journal,
          intendedSettings,
          metadata: desiredMetadataFromPlan(plan),
          generationVerification: promotedVerification,
          expectedCurrent: settingsExpectation(current),
        });
        return {
          ok: true,
          status: "COMMITTED",
          mutation: true,
          transactionId: completed.journal.transactionId,
          generationId: completed.journal.generationId,
          settingsDigest: completed.saved.digest,
          lastKnownGood: completed.lkgStatus,
          recovered,
          next: "pi --offline --no-session",
        };
      } catch (error) {
        journal = error?.transactionJournal ?? journal;
        if (error?.simulateCrash === true) throw error;
        if (!journal) throw error;
        if (journal && !TERMINAL.has((await loadJournal(configRoot, journal.transactionId)).status)) {
          let conflictRecovery;
          try {
            conflictRecovery = await this.settleUnpublishedCasConflict(configRoot, journal, error);
          } catch (recoveryError) {
            error.recoveryError = recoveryError;
            throw error;
          }
          if (conflictRecovery) {
            error.recovery = conflictRecovery;
            throw error;
          }
          try {
            await this.recoverJournal(configRoot, journal);
          } catch (recoveryError) {
            error.recoveryError = recoveryError;
            throw error;
          }
        }
        fail("TRANSACTION_ROLLED_BACK", `${operation} failed and the owned state was rolled back`, {
          cause: error,
          originalCode: error?.code ?? "UNKNOWN",
        });
      }
    });
  }

  async applyUninstallPlan(plan) {
    const result = await this.applySettingsOnlyPlan(plan, {
      operation: "uninstall",
      generationId: null,
      buildIntended: (current) => compileUninstalledSettings(current.settings),
      generationManifestDigest: null,
      skipCurrentGenerationReconciliation: true,
    });
    return Object.freeze({
      ...result,
      resourceDisposition: Object.freeze({
        policy: "RETAIN_IMMUTABLE_FOR_ROLLBACK",
        generationId: plan.current?.metadata?.generationId ?? null,
        deletionAttempted: false,
      }),
    });
  }

  async applyRollbackPlan(plan) {
    const configRoot = explicitConfigRoot(plan?.configRoot);
    const targetSnapshot = await loadOwnedSettingsSnapshot(configRoot, plan.snapshotId);
    const previewCurrent = await loadSettings(configRoot);
    const preview = compileRollbackSettings(previewCurrent.settings, targetSnapshot);
    const metadata = extractManagedMetadata(preview);
    const generationId = metadata?.graphDigest ?? metadata?.generationId ?? null;
    let generationManifestDigest = null;
    if (generationId !== null) {
      const layout = this.generationLayout(configRoot, generationId, "rollback-verification");
      const verified = await this.generation.verifyByManifest({ layout });
      generationManifestDigest = verified.manifest.manifestDigest;
    }
    return this.applySettingsOnlyPlan(plan, {
      operation: "rollback",
      generationId,
      generationManifestDigest,
      publishAbsence: targetSnapshot.source.exists === false && isDeepEmptyObject(preview),
      skipCurrentGenerationReconciliation: true,
      buildIntended: async (current) => {
        const snapshot = await loadOwnedSettingsSnapshot(configRoot, plan.snapshotId);
        return compileRollbackSettings(current.settings, snapshot);
      },
    });
  }

  async applySettingsOnlyPlan(plan, {
    operation,
    generationId,
    generationManifestDigest,
    buildIntended,
    publishAbsence = false,
    skipCurrentGenerationReconciliation = false,
  }) {
    const configRoot = explicitConfigRoot(plan?.configRoot);
    if (plan.status === "NO_CHANGES") {
      return this.withMutationLock(configRoot, operation, async ({ recovered, reconciledLastKnownGood }) => ({
        ok: true,
        status: recovered.length > 0
          ? "RECOVERED_REPLAN_REQUIRED"
          : (reconciledLastKnownGood.mutation ? "REPAIRED_NO_CHANGES" : "NO_CHANGES"),
        mutation: recovered.length > 0 || reconciledLastKnownGood.mutation,
        planDigest: plan.planDigest,
        recovered,
        reconciledLastKnownGood,
      }), { reconcileLastKnownGood: !skipCurrentGenerationReconciliation });
    }
    return this.withMutationLock(configRoot, operation, async ({ recovered }) => {
      const current = await loadSettings(configRoot);
      if (current.digest !== plan.sourceSettings.digest) fail("PLAN_STALE", "settings changed after plan generation", { recovered });
      const intendedSettings = await buildIntended(current);
      if (settingsDigest(intendedSettings) !== plan.desired.settingsDigest) fail("PLAN_STALE", "settings-only target changed after plan generation");
      const metadata = extractManagedMetadata(intendedSettings);
      let journal;
      try {
        if (generationId !== null) {
          const layout = this.generationLayout(configRoot, generationId, "settings-only-verification");
          const verified = await this.generation.verifyByManifest({ layout, expectedManifestDigest: generationManifestDigest });
          generationManifestDigest = verified.manifest.manifestDigest;
        }
        journal = await this.createTransaction({
          configRoot,
          operation,
          profileId: metadata?.profileId ?? plan.profileId ?? "minimal",
          generationId,
        });
        journal = await this.advance(configRoot, journal, "GRAPH_STAGING");
        journal = await this.advance(configRoot, journal, "GRAPH_STAGED");
        journal = await this.advance(configRoot, journal, "GRAPH_VERIFIED", {
          evidence: { generationManifestDigest },
        });
        journal = await this.advance(configRoot, journal, "GRAPH_PROMOTED", {
          evidence: {
            promotionCreated: false,
            intendedSettingsDigest: publishAbsence
              ? (await loadOwnedSettingsSnapshot(configRoot, plan.snapshotId)).source.digest
              : settingsDigest(intendedSettings),
          },
        });
        const completed = await this.finishVisibleMutation({
          configRoot,
          journal,
          intendedSettings,
          metadata,
          generationVerification: null,
          expectedCurrent: settingsExpectation(current),
          publishAbsence,
        });
        return {
          ok: true,
          status: "COMMITTED",
          mutation: true,
          transactionId: completed.journal.transactionId,
          generationId: completed.journal.generationId,
          settingsDigest: completed.saved.digest,
          lastKnownGood: completed.lkgStatus,
          recovered,
        };
      } catch (error) {
        journal = error?.transactionJournal ?? journal;
        if (error?.simulateCrash === true) throw error;
        if (!journal) throw error;
        if (journal && !TERMINAL.has((await loadJournal(configRoot, journal.transactionId)).status)) {
          let conflictRecovery;
          try {
            conflictRecovery = await this.settleUnpublishedCasConflict(configRoot, journal, error);
          } catch (recoveryError) {
            error.recoveryError = recoveryError;
            throw error;
          }
          if (conflictRecovery) {
            error.recovery = conflictRecovery;
            throw error;
          }
          try {
            await this.recoverJournal(configRoot, journal, {
              reconcileLastKnownGood: !skipCurrentGenerationReconciliation,
            });
          } catch (recoveryError) {
            error.recoveryError = recoveryError;
            throw error;
          }
        }
        fail("TRANSACTION_ROLLED_BACK", `${operation} failed and the owned state was rolled back`, {
          cause: error,
          originalCode: error?.code ?? "UNKNOWN",
        });
      }
    }, { reconcileLastKnownGood: !skipCurrentGenerationReconciliation });
  }
}

export function createTransactionEngine(options) {
  return new TransactionEngine(options);
}

export function createCrashBoundary(name) {
  return async (boundary) => {
    if (boundary !== name) return;
    const error = new Error(`simulated process crash after ${name}`);
    error.code = "SIMULATED_PROCESS_CRASH";
    error.simulateCrash = true;
    throw error;
  };
}
