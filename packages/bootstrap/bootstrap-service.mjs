import path from "node:path";

import {
  canonicalJson,
  listTransactionJournals,
  loadOwnedSettingsSnapshot,
  loadSettings,
  readState,
  sha256,
} from "../config-runtime/index.mjs";
import { createDoctorService } from "./doctor-service.mjs";
import { buildGenerationPlan } from "./index.mjs";
import { createProfileService } from "./profile-service.mjs";
import {
  createGenerationLayout,
  verifyPromotedGeneration,
} from "./npm-stager.mjs";
import { compileGenerationSettings } from "./settings-compiler.mjs";
import { compileRollbackSettings } from "./transaction-engine.mjs";
import {
  compilePublishedSettings,
  compileUninstalledSettings,
  extractManagedMetadata,
} from "./settings-merge.mjs";
import { resolveBootstrapMode } from "../control-service/mode-service.mjs";

const PLAN_FORMAT_VERSION = 1;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MODE_ID = /^(?:[a-z][a-z0-9-]{0,63}|(?:user|project|package):[a-z][a-z0-9-]{0,63}|[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63})$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const ZERO_WRITE = Object.freeze({ writes: 0, subprocesses: 0, providerRequests: 0 });

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function digestPlan(plan) {
  const payload = { ...plan };
  delete payload.planDigest;
  return sha256(canonicalJson(payload));
}

function finalizePlan(plan) {
  const output = { ...plan };
  output.planDigest = digestPlan(output);
  return Object.freeze(output);
}

function validateMetadataSelection({ provider, model }) {
  if (model !== null && provider === null) fail("PROVIDER_REQUIRED", "--model requires --provider");
  if (provider !== null && !ID.test(provider)) fail("INVALID_PROVIDER_ID", "provider must be a canonical non-secret id");
  if (model !== null && !MODEL_ID.test(model)) fail("INVALID_MODEL_ID", "model must be a bounded non-secret id");
  return provider === null
    ? null
    : Object.freeze({ providerId: provider, modelId: model, status: "CONFIGURED_UNVERIFIED" });
}

function validateInitialMode(mode) {
  if (mode === null) return null;
  if (!MODE_ID.test(mode)) fail("INVALID_MODE_ID", "initial mode must be a canonical id or namespaced mode");
  return Object.freeze({ id: mode, status: "PENDING_M3_RESOLUTION" });
}

function desiredMetadata({ profileId, graphPlan, providerSelection, initialMode }) {
  return Object.freeze({
    profileId,
    generationId: graphPlan.graphDigest,
    graphDigest: graphPlan.graphDigest,
    providerSelection,
    initialMode,
  });
}

function graphSummary(graphPlan) {
  return Object.freeze({
    graphDigest: graphPlan.graphDigest,
    generationKey: graphPlan.generationKey,
    packages: graphPlan.packages.map((entry) => Object.freeze({ id: entry.id, spec: entry.spec })),
    resources: graphPlan.resources.map((entry) => Object.freeze({
      id: entry.id,
      type: entry.type,
      path: entry.path,
      defaultLoaded: entry.defaultLoaded,
    })),
  });
}

function expectedGenerationReceipt(configRoot, graphPlan) {
  const layout = createGenerationLayout({
    configRoot,
    graphDigest: graphPlan.graphDigest,
    transactionId: "plan-verification",
  });
  return verifyPromotedGeneration({ plan: graphPlan, layout });
}

async function readLastKnownGoodOrNull(configRoot) {
  try {
    return await readState(configRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function probeInstalledGeneration({ configRoot, graphPlan, settings, metadata }) {
  try {
    const verified = await expectedGenerationReceipt(configRoot, graphPlan);
    const compiled = await compileGenerationSettings({
      plan: graphPlan,
      promotion: verified.receipt,
      configRoot,
      transactionId: "plan-settings-verification",
    });
    const expectedSettings = compilePublishedSettings(settings, compiled.ownedSettings, metadata);
    return Object.freeze({
      status: same(expectedSettings, settings) ? "VERIFIED" : "SETTINGS_DRIFT",
      verified,
      expectedSettings,
    });
  } catch (error) {
    return Object.freeze({
      status: "UNAVAILABLE_OR_DRIFTED",
      errorCode: error?.code ?? "GENERATION_VERIFICATION_FAILED",
      message: error?.message ?? String(error),
    });
  }
}

function assertPlan(plan, operation, configRoot) {
  if (
    plan?.formatVersion !== PLAN_FORMAT_VERSION
    || plan.operation !== operation
    || plan.configRoot !== configRoot
    || plan.planDigest !== digestPlan(plan)
  ) {
    fail("PLAN_INVALID", `a current immutable ${operation} plan is required`);
  }
  return plan;
}

export class BootstrapService {
  constructor({ rootDir, profileService, doctorService, transactionEngine } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) {
      throw new TypeError("BootstrapService requires an absolute rootDir");
    }
    this.rootDir = path.resolve(rootDir);
    this.profiles = profileService ?? createProfileService({ rootDir: this.rootDir });
    this.doctors = doctorService ?? createDoctorService({ rootDir: this.rootDir });
    this.transaction = transactionEngine ?? null;
  }

  async planBootstrap(options = {}) {
    const profileId = options.profile ?? "coding";
    const configRoot = path.resolve(options.configRoot);
    this.profiles.resolve(profileId);
    const graphPlan = await buildGenerationPlan({ rootDir: this.rootDir, profileId });
    const current = await loadSettings(configRoot);
    const currentMetadata = extractManagedMetadata(current.settings);
    const providerSelection = options.provider === null || options.provider === undefined
      ? currentMetadata?.providerSelection ?? null
      : validateMetadataSelection({ provider: options.provider, model: options.model ?? null });
    if ((options.provider === null || options.provider === undefined) && options.model !== null && options.model !== undefined) {
      validateMetadataSelection({ provider: null, model: options.model });
    }
    const initialMode = options.initialMode === null || options.initialMode === undefined
      ? currentMetadata?.initialMode ?? null
      : validateInitialMode(options.initialMode);
    const initialModeResolution = initialMode
      ? await resolveBootstrapMode({ rootDir: this.rootDir, profileId, modeId: initialMode.id })
      : null;
    const metadata = desiredMetadata({ profileId, graphPlan, providerSelection, initialMode });
    const probe = await probeInstalledGeneration({
      configRoot,
      graphPlan,
      settings: current.settings,
      metadata,
    });
    const noOp = probe.status === "VERIFIED";
    return finalizePlan({
      formatVersion: PLAN_FORMAT_VERSION,
      kind: "only-my-pi-bootstrap-plan",
      operation: "bootstrap",
      status: noOp ? "NO_CHANGES" : "PLAN_READY",
      mutation: false,
      zeroWriteEvidence: ZERO_WRITE,
      configRoot,
      scope: options.scope ?? "global",
      profileId,
      sourceSettings: Object.freeze({ exists: current.exists, digest: current.digest }),
      current: Object.freeze({ metadata: currentMetadata }),
      desired: Object.freeze({ metadata, initialModeResolution, ...graphSummary(graphPlan) }),
      graphPlan,
      generationProbe: Object.freeze({
        status: probe.status,
        errorCode: probe.errorCode ?? null,
      }),
      changes: noOp
        ? Object.freeze([])
        : Object.freeze([
            "stage-and-verify-owned-generation",
            "publish-owned-settings-last",
            "run-static-doctor",
            "run-no-model-smoke",
          ]),
    });
  }

  async applyBootstrap(options = {}) {
    if (!this.transaction) fail("TRANSACTION_ENGINE_UNAVAILABLE", "bootstrap mutation engine is unavailable");
    const configRoot = path.resolve(options.configRoot);
    const plan = assertPlan(options.plan, "bootstrap", configRoot);
    return this.transaction.applyGraphPlan(plan, { operation: "bootstrap" });
  }

  async planUpdate(options = {}) {
    const configRoot = path.resolve(options.configRoot);
    const current = await loadSettings(configRoot);
    const metadata = extractManagedMetadata(current.settings);
    if (!metadata) fail("NOT_INSTALLED", "only-my-pi is not currently installed in this config root");
    const bootstrap = await this.planBootstrap({
      configRoot,
      profile: metadata.profileId,
      provider: metadata.providerSelection?.providerId ?? null,
      model: metadata.providerSelection?.modelId ?? null,
      initialMode: metadata.initialMode?.id ?? null,
      scope: "global",
    });
    const plan = {
      ...bootstrap,
      kind: "only-my-pi-update-plan",
      operation: "update",
      status: bootstrap.status,
      mutation: false,
    };
    delete plan.planDigest;
    return finalizePlan(plan);
  }

  async applyUpdate(options = {}) {
    if (!this.transaction) fail("TRANSACTION_ENGINE_UNAVAILABLE", "update mutation engine is unavailable");
    const configRoot = path.resolve(options.configRoot);
    const plan = assertPlan(options.plan, "update", configRoot);
    return this.transaction.applyGraphPlan(plan, { operation: "update" });
  }

  async planUninstall(options = {}) {
    const configRoot = path.resolve(options.configRoot);
    const current = await loadSettings(configRoot);
    const metadata = extractManagedMetadata(current.settings);
    const desiredSettings = metadata ? compileUninstalledSettings(current.settings) : current.settings;
    return finalizePlan({
      formatVersion: PLAN_FORMAT_VERSION,
      kind: "only-my-pi-uninstall-plan",
      operation: "uninstall",
      status: metadata ? "PLAN_READY" : "NO_CHANGES",
      mutation: false,
      zeroWriteEvidence: ZERO_WRITE,
      configRoot,
      profileId: metadata?.profileId ?? "minimal",
      sourceSettings: Object.freeze({ exists: current.exists, digest: current.digest }),
      current: Object.freeze({ metadata }),
      desired: Object.freeze({
        metadata: null,
        settingsDigest: sha256(canonicalJson(desiredSettings)),
        resourceDisposition: Object.freeze({
          policy: "RETAIN_IMMUTABLE_FOR_ROLLBACK",
          generationId: metadata?.generationId ?? null,
          deletionAttempted: false,
        }),
      }),
      changes: metadata
        ? Object.freeze([
            "remove-only-recorded-owned-settings",
            "retain-immutable-generation-for-reviewed-rollback",
          ])
        : Object.freeze([]),
    });
  }

  async applyUninstall(options = {}) {
    if (!this.transaction) fail("TRANSACTION_ENGINE_UNAVAILABLE", "uninstall mutation engine is unavailable");
    const configRoot = path.resolve(options.configRoot);
    const plan = assertPlan(options.plan, "uninstall", configRoot);
    return this.transaction.applyUninstallPlan(plan);
  }

  async planRollback(options = {}) {
    const configRoot = path.resolve(options.configRoot);
    const current = await loadSettings(configRoot);
    const journals = await listTransactionJournals(configRoot);
    const committed = journals
      .filter((journal) => journal.status === "COMMITTED")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const snapshotId = options.snapshotId ?? committed[0]?.snapshotId ?? null;
    if (!snapshotId) fail("ROLLBACK_SNAPSHOT_UNAVAILABLE", "no committed rollback snapshot is available");
    const snapshot = await loadOwnedSettingsSnapshot(configRoot, snapshotId);
    const restoredSettings = compileRollbackSettings(current.settings, snapshot);
    const metadata = extractManagedMetadata(restoredSettings);
    return finalizePlan({
      formatVersion: PLAN_FORMAT_VERSION,
      kind: "only-my-pi-rollback-plan",
      operation: "rollback",
      status: same(current.settings, restoredSettings) ? "NO_CHANGES" : "PLAN_READY",
      mutation: false,
      zeroWriteEvidence: ZERO_WRITE,
      configRoot,
      profileId: metadata?.profileId ?? "minimal",
      snapshotId,
      sourceSettings: Object.freeze({ exists: current.exists, digest: current.digest }),
      current: Object.freeze({ metadata: extractManagedMetadata(current.settings) }),
      desired: Object.freeze({ metadata, settingsDigest: sha256(canonicalJson(restoredSettings)) }),
      changes: same(current.settings, restoredSettings)
        ? Object.freeze([])
        : Object.freeze(["restore-hash-gated-owned-settings", "verify-historical-generation", "run-static-doctor", "run-no-model-smoke"]),
    });
  }

  async rollback(options = {}) {
    if (!this.transaction) fail("TRANSACTION_ENGINE_UNAVAILABLE", "rollback mutation engine is unavailable");
    const configRoot = path.resolve(options.configRoot);
    const plan = assertPlan(options.plan, "rollback", configRoot);
    return this.transaction.applyRollbackPlan(plan);
  }

  async status(options = {}) {
    const configRoot = path.resolve(options.configRoot);
    const [settings, journals, lastKnownGood] = await Promise.all([
      loadSettings(configRoot),
      listTransactionJournals(configRoot, { includeInvalid: true }),
      readLastKnownGoodOrNull(configRoot),
    ]);
    const metadata = extractManagedMetadata(settings.settings);
    const incomplete = journals.filter((entry) => entry.invalid || !["COMMITTED", "ROLLED_BACK", "FAILED"].includes(entry.status));
    let modeResolution = null;
    if (metadata?.initialMode) {
      try {
        modeResolution = await resolveBootstrapMode({
          rootDir: this.rootDir,
          profileId: metadata.profileId,
          modeId: metadata.initialMode.id,
        });
      } catch (error) {
        modeResolution = {
          status: "UNAVAILABLE",
          id: metadata.initialMode.id,
          code: error?.code ?? "MODE_RESOLUTION_FAILED",
          message: error?.message ?? String(error),
        };
      }
    }
    return {
      ok: incomplete.length === 0,
      status: metadata ? (incomplete.length === 0 ? "INSTALLED" : "RECOVERY_REQUIRED") : "NOT_INSTALLED",
      mutation: false,
      configRoot,
      profileId: metadata?.profileId ?? null,
      generationId: metadata?.generationId ?? null,
      providerSelection: metadata?.providerSelection ?? null,
      initialMode: metadata?.initialMode ?? null,
      modeResolution,
      lastKnownGood: lastKnownGood
        ? { generationId: lastKnownGood.generationId, committedAt: lastKnownGood.committedAt }
        : null,
      incompleteTransactions: incomplete.map((entry) => ({
        transactionId: entry.transactionId,
        status: entry.status ?? "INVALID",
        phase: entry.phase ?? null,
        errorCode: entry.errorCode ?? null,
      })),
    };
  }

  async doctor(options = {}) {
    const status = await this.status(options);
    const staticResult = this.doctors.static({ profileId: status.profileId, strict: false });
    let generation = { status: status.profileId ? "UNVERIFIED" : "NOT_INSTALLED" };
    if (status.profileId) {
      try {
        const graphPlan = await buildGenerationPlan({ rootDir: this.rootDir, profileId: status.profileId });
        const settings = await loadSettings(options.configRoot);
        const metadata = extractManagedMetadata(settings.settings);
        generation = await probeInstalledGeneration({
          configRoot: path.resolve(options.configRoot),
          graphPlan,
          settings: settings.settings,
          metadata,
        });
        generation = { status: generation.status, errorCode: generation.errorCode ?? null };
      } catch (error) {
        generation = { status: "UNAVAILABLE_OR_DRIFTED", errorCode: error?.code ?? "DOCTOR_FAILED" };
      }
    }
    const ok = staticResult.ok === true && status.incompleteTransactions.length === 0
      && ["VERIFIED", "NOT_INSTALLED"].includes(generation.status);
    return {
      ok,
      status: ok ? "PASS" : "FAIL",
      mutation: false,
      scope: "static-and-local-generation",
      repository: staticResult,
      runtime: status,
      generation,
      liveProviderVerified: false,
    };
  }

  async safe(options = {}) {
    const status = await this.status(options);
    return {
      ok: true,
      status: "SAFE_START_GUIDANCE",
      mutation: false,
      configRoot: status.configRoot,
      command: [
        "pi",
        "--offline",
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--tools",
        "read,grep,find,ls",
      ],
      note: "Pi offline mode suppresses Pi update/package checks; OS or container network policy is still required for true isolation.",
    };
  }
}

export function createBootstrapService(options) {
  return new BootstrapService(options);
}

export { assertPlan as assertBootstrapPlan, digestPlan as bootstrapPlanDigest };
