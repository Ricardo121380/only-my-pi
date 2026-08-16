import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  atomicPublishDirectory,
  atomicWriteJson,
  isAtomicDirectoryTemporaryName,
  readJsonObject,
} from "./atomic-file.mjs";
import {
  configRuntimePaths,
  ensureConfigDirectory,
  normalizeConfigRoot,
  relativeConfigPath,
  validatePortableId,
} from "./paths.mjs";

export const TRANSACTION_SCHEMA =
  "https://github.com/Ricardo121380/only-my-pi/schemas/bootstrap-transaction-v1.schema.json";

export const TRANSACTION_PHASES = Object.freeze([
  "PREPARED",
  "BACKUP_DURABLE",
  "GRAPH_STAGING",
  "GRAPH_STAGED",
  "GRAPH_VERIFIED",
  "GRAPH_PROMOTED",
  "SETTINGS_PUBLISHED",
  "STATIC_DOCTOR_PASSED",
  "SMOKE_PASSED",
  "COMMITTED",
]);

export const TRANSACTION_STATUSES = Object.freeze([
  "ACTIVE",
  "RECOVERING",
  "COMMITTED",
  "ROLLED_BACK",
  "FAILED",
]);

const OPERATIONS = new Set(["bootstrap", "update", "uninstall", "rollback"]);
const TERMINAL_STATUSES = new Set(["COMMITTED", "ROLLED_BACK", "FAILED"]);
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;
const SCHEMA_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export class TransactionJournalError extends Error {
  constructor(message, code, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "TransactionJournalError";
    this.code = code;
    Object.assign(this, details);
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("config-runtime: journal clock returned an invalid date");
  return date.toISOString();
}

function validateTransactionId(value) {
  if (typeof value !== "string" || !TRANSACTION_ID.test(value)) {
    throw new TransactionJournalError(`invalid transaction id: ${String(value)}`, "INVALID_TRANSACTION_ID");
  }
  return value;
}

function transactionPaths(configRoot, transactionId) {
  const id = validateTransactionId(transactionId);
  const root = configRuntimePaths(configRoot).transactionsRoot;
  return {
    transactionId: id,
    directory: path.join(root, id),
    journalFile: path.join(root, id, "journal.json"),
  };
}

function expectedHistory(phase) {
  const phaseIndex = TRANSACTION_PHASES.indexOf(phase);
  return phaseIndex < 0 ? null : TRANSACTION_PHASES.slice(0, phaseIndex + 1);
}

function derivedFlags(phase) {
  const phaseIndex = TRANSACTION_PHASES.indexOf(phase);
  return {
    graphVerified: phaseIndex >= TRANSACTION_PHASES.indexOf("GRAPH_VERIFIED"),
    settingsPublished: phaseIndex >= TRANSACTION_PHASES.indexOf("SETTINGS_PUBLISHED"),
  };
}

function validateJournal(journal, expectedId) {
  if (!journal || typeof journal !== "object" || Array.isArray(journal)) {
    throw new TransactionJournalError("journal must be an object", "INVALID_JOURNAL");
  }
  const allowed = new Set([
    "$schema",
    "formatVersion",
    "transactionId",
    "operation",
    "status",
    "phase",
    "phaseHistory",
    "profileId",
    "generationId",
    "snapshotId",
    "graphVerified",
    "settingsPublished",
    "generationManifestDigest",
    "promotionCreated",
    "intendedSettingsDigest",
    "createdAt",
    "updatedAt",
    "failureCode",
  ]);
  if (Object.keys(journal).some((key) => !allowed.has(key))) {
    throw new TransactionJournalError("journal contains unknown fields", "INVALID_JOURNAL");
  }
  let portableFieldsValid = true;
  try {
    validatePortableId(journal.profileId, "profile id");
    validatePortableId(journal.snapshotId, "snapshot id");
    if (!SCHEMA_ID.test(journal.profileId) || !SCHEMA_ID.test(journal.snapshotId)) portableFieldsValid = false;
  } catch {
    portableFieldsValid = false;
  }
  if (
    journal.$schema !== TRANSACTION_SCHEMA
    || journal.formatVersion !== 1
    || journal.transactionId !== expectedId
    || !OPERATIONS.has(journal.operation)
    || !TRANSACTION_STATUSES.includes(journal.status)
    || !portableFieldsValid
    || (["bootstrap", "update"].includes(journal.operation)
      ? (typeof journal.generationId !== "string" || !HASH.test(journal.generationId))
      : journal.operation === "uninstall"
        ? journal.generationId !== null
        : !(journal.generationId === null || HASH.test(journal.generationId ?? "")))
    || !Number.isFinite(Date.parse(journal.createdAt))
    || !Number.isFinite(Date.parse(journal.updatedAt))
  ) {
    throw new TransactionJournalError("journal identity or metadata is invalid", "INVALID_JOURNAL");
  }
  const expected = expectedHistory(journal.phase);
  if (!expected || JSON.stringify(journal.phaseHistory) !== JSON.stringify(expected)) {
    throw new TransactionJournalError("journal phase history is not contiguous", "INVALID_JOURNAL");
  }
  const flags = derivedFlags(journal.phase);
  if (journal.graphVerified !== flags.graphVerified || journal.settingsPublished !== flags.settingsPublished) {
    throw new TransactionJournalError("journal derived flags do not match its phase", "INVALID_JOURNAL");
  }
  const phaseIndex = TRANSACTION_PHASES.indexOf(journal.phase);
  const graphVerifiedIndex = TRANSACTION_PHASES.indexOf("GRAPH_VERIFIED");
  const graphPromotedIndex = TRANSACTION_PHASES.indexOf("GRAPH_PROMOTED");
  const hasGraphEvidence = phaseIndex >= graphVerifiedIndex;
  const graphEvidenceValid = journal.generationId === null
    ? journal.generationManifestDigest === null
    : HASH.test(journal.generationManifestDigest ?? "");
  if (
    (hasGraphEvidence ? !graphEvidenceValid : Object.hasOwn(journal, "generationManifestDigest"))
    || (phaseIndex >= graphPromotedIndex) !== (typeof journal.promotionCreated === "boolean")
    || (phaseIndex >= graphPromotedIndex && journal.generationId === null && journal.promotionCreated !== false)
    || (phaseIndex >= graphPromotedIndex) !== HASH.test(journal.intendedSettingsDigest ?? "")
  ) {
    throw new TransactionJournalError("journal phase evidence is missing, premature, or invalid", "INVALID_JOURNAL");
  }
  if (journal.status === "COMMITTED" && journal.phase !== "COMMITTED") {
    throw new TransactionJournalError("COMMITTED status requires COMMITTED phase", "INVALID_JOURNAL");
  }
  if (journal.phase === "COMMITTED" && journal.status !== "COMMITTED") {
    throw new TransactionJournalError("COMMITTED phase requires COMMITTED status", "INVALID_JOURNAL");
  }
  if (["ROLLED_BACK", "FAILED"].includes(journal.status)) {
    if (!FAILURE_CODE.test(journal.failureCode ?? "")) {
      throw new TransactionJournalError("recovery settlement requires a failureCode", "INVALID_JOURNAL");
    }
  } else if (Object.hasOwn(journal, "failureCode") && journal.failureCode !== null) {
    throw new TransactionJournalError("active journal cannot carry a failureCode", "INVALID_JOURNAL");
  }
  return journal;
}

export async function createTransactionJournal(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const transactionId = options.transactionId ?? options.id ?? crypto.randomUUID();
  const operation = options.operation ?? "bootstrap";
  if (!OPERATIONS.has(operation)) throw new TypeError(`config-runtime: invalid transaction operation: ${operation}`);
  const profileId = validatePortableId(options.profileId, "profile id");
  const snapshotId = validatePortableId(options.snapshotId, "snapshot id");
  if (!SCHEMA_ID.test(profileId) || !SCHEMA_ID.test(snapshotId)) {
    throw new TypeError("config-runtime: profileId and snapshotId must be canonical lower-case ids");
  }
  if (
    (["bootstrap", "update"].includes(operation) && !HASH.test(options.generationId ?? ""))
    || (operation === "uninstall" && options.generationId !== null)
    || (operation === "rollback" && !(options.generationId === null || HASH.test(options.generationId ?? "")))
  ) {
    throw new TypeError(
      "config-runtime: generationId must be a digest for bootstrap/update, null for uninstall, and null or a digest for rollback",
    );
  }
  const target = transactionPaths(configRoot, transactionId);
  const transactionsRoot = configRuntimePaths(configRoot).transactionsRoot;
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, transactionsRoot));
  const at = nowIso(options.now);
  const journal = {
    $schema: TRANSACTION_SCHEMA,
    formatVersion: 1,
    transactionId: target.transactionId,
    operation,
    status: "ACTIVE",
    phase: "PREPARED",
    phaseHistory: ["PREPARED"],
    profileId,
    generationId: options.generationId,
    snapshotId,
    graphVerified: false,
    settingsPublished: false,
    createdAt: at,
    updatedAt: at,
  };
  try {
    await atomicPublishDirectory(
      configRoot,
      target.directory,
      async ({ temporary }) => {
        await atomicWriteJson(
          configRoot,
          path.join(temporary, "journal.json"),
          journal,
          options.atomic ?? {},
        );
      },
      options.directoryAtomic ?? {},
    );
  } catch (error) {
    if (error.code === "ATOMIC_DIRECTORY_EXISTS") {
      throw new TransactionJournalError(
        `transaction already exists: ${transactionId}`,
        "TRANSACTION_EXISTS",
        { cause: error },
      );
    }
    throw error;
  }
  return Object.freeze(journal);
}

export async function loadTransactionJournal(configRootInput, transactionId) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = transactionPaths(configRoot, transactionId);
  const journal = await readJsonObject(configRoot, target.journalFile);
  return Object.freeze(validateJournal(journal, target.transactionId));
}

export async function advanceTransactionJournal(configRootInput, transactionId, nextPhase, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = transactionPaths(configRoot, transactionId);
  const current = await loadTransactionJournal(configRoot, target.transactionId);
  if (current.status !== "ACTIVE") {
    throw new TransactionJournalError(
      `cannot advance transaction with status ${current.status}`,
      "JOURNAL_NOT_ACTIVE",
    );
  }
  if (options.expectedPhase && current.phase !== options.expectedPhase) {
    throw new TransactionJournalError(
      `expected ${options.expectedPhase}, found ${current.phase}`,
      "JOURNAL_COMPARE_AND_SWAP_FAILED",
      { expectedPhase: options.expectedPhase, actualPhase: current.phase },
    );
  }
  const currentIndex = TRANSACTION_PHASES.indexOf(current.phase);
  const expectedNext = TRANSACTION_PHASES[currentIndex + 1];
  if (nextPhase !== expectedNext) {
    throw new TransactionJournalError(
      `invalid journal transition ${current.phase} -> ${nextPhase}; expected ${expectedNext ?? "none"}`,
      "INVALID_JOURNAL_TRANSITION",
    );
  }
  const flags = derivedFlags(nextPhase);
  const evidence = options.evidence ?? {};
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("config-runtime: journal transition evidence must be an object");
  }
  const requiredEvidence = {
    GRAPH_VERIFIED: ["generationManifestDigest"],
    GRAPH_PROMOTED: ["intendedSettingsDigest", "promotionCreated"],
  }[nextPhase] ?? [];
  const evidenceKeys = Object.keys(evidence).sort();
  if (
    evidenceKeys.length !== requiredEvidence.length
    || evidenceKeys.some((key, index) => key !== [...requiredEvidence].sort()[index])
  ) {
    throw new TransactionJournalError(
      `transition to ${nextPhase} requires exactly: ${requiredEvidence.join(", ") || "no evidence"}`,
      "INVALID_TRANSITION_EVIDENCE",
    );
  }
  if (
    nextPhase === "GRAPH_VERIFIED"
    && (current.generationId === null
      ? evidence.generationManifestDigest !== null
      : !HASH.test(evidence.generationManifestDigest))
  ) {
    throw new TransactionJournalError("generation manifest evidence is invalid", "INVALID_TRANSITION_EVIDENCE");
  }
  if (
    nextPhase === "GRAPH_PROMOTED"
    && (typeof evidence.promotionCreated !== "boolean"
      || (current.generationId === null && evidence.promotionCreated !== false))
  ) {
    throw new TransactionJournalError(
      "promotion evidence must identify whether a generation was created",
      "INVALID_TRANSITION_EVIDENCE",
    );
  }
  if (nextPhase === "GRAPH_PROMOTED" && !HASH.test(evidence.intendedSettingsDigest)) {
    throw new TransactionJournalError("intended settings evidence is invalid", "INVALID_TRANSITION_EVIDENCE");
  }
  const next = {
    ...current,
    status: nextPhase === "COMMITTED" ? "COMMITTED" : "ACTIVE",
    phase: nextPhase,
    phaseHistory: [...current.phaseHistory, nextPhase],
    ...flags,
    ...evidence,
    updatedAt: nowIso(options.now),
  };
  await atomicWriteJson(configRoot, target.journalFile, next, options.atomic ?? {});
  return Object.freeze(next);
}

export async function beginTransactionRecovery(configRootInput, transactionId, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = transactionPaths(configRoot, transactionId);
  const current = await loadTransactionJournal(configRoot, transactionId);
  if (TERMINAL_STATUSES.has(current.status)) {
    throw new TransactionJournalError(`transaction is already ${current.status}`, "JOURNAL_TERMINAL");
  }
  verifyTransactionRecoveryEvidence(current, options.evidence ?? {});
  if (current.status === "RECOVERING") return current;
  const next = { ...current, status: "RECOVERING", updatedAt: nowIso(options.now) };
  await atomicWriteJson(configRoot, target.journalFile, next, options.atomic ?? {});
  return Object.freeze(next);
}

export function verifyTransactionRecoveryEvidence(journal, evidence = {}) {
  validateJournal(journal, journal?.transactionId);
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new TypeError("config-runtime: recovery evidence must be an object");
  }
  if (evidence.preserveConcurrentSettings !== undefined && typeof evidence.preserveConcurrentSettings !== "boolean") {
    throw new TransactionJournalError(
      "preserveConcurrentSettings recovery evidence must be boolean",
      "RECOVERY_CONCURRENT_PRESERVATION_INVALID",
    );
  }
  if (evidence.preserveConcurrentSettings === true && !journal.intendedSettingsDigest) {
    throw new TransactionJournalError(
      "concurrent settings preservation requires a promoted settings intent",
      "RECOVERY_CONCURRENT_PRESERVATION_INVALID",
    );
  }
  let settingsDisposition = "NOT_APPLICABLE";
  if (journal.intendedSettingsDigest) {
    if (
      !HASH.test(evidence.currentSettingsDigest ?? "")
      || !HASH.test(evidence.snapshotSourceDigest ?? "")
    ) {
      throw new TransactionJournalError(
        "recovery after promotion requires current and snapshot-source settings digests",
        "RECOVERY_SETTINGS_CAS_REQUIRED",
      );
    }
    const preserveConcurrentSettings = evidence.preserveConcurrentSettings === true;
    if (evidence.currentSettingsDigest === journal.intendedSettingsDigest) {
      settingsDisposition = "RESTORE_SNAPSHOT";
    } else if (evidence.currentSettingsDigest === evidence.snapshotSourceDigest) {
      settingsDisposition = journal.settingsPublished ? "ALREADY_RESTORED" : "SETTINGS_UNCHANGED";
    } else if (preserveConcurrentSettings) {
      if (journal.phase !== "GRAPH_PROMOTED" || journal.settingsPublished !== false) {
        throw new TransactionJournalError(
          "a third settings digest can be preserved only before SETTINGS_PUBLISHED",
          "RECOVERY_CONCURRENT_PRESERVATION_INVALID",
          {
            phase: journal.phase,
            settingsPublished: journal.settingsPublished,
            before: evidence.snapshotSourceDigest,
            intended: journal.intendedSettingsDigest,
            actual: evidence.currentSettingsDigest,
          },
        );
      }
      settingsDisposition = "PRESERVE_CONCURRENT";
    } else {
      throw new TransactionJournalError(
        "current settings match neither the pre-transaction snapshot nor the intended publication",
        "RECOVERY_SETTINGS_CAS_MISMATCH",
        {
          before: evidence.snapshotSourceDigest,
          intended: journal.intendedSettingsDigest,
          actual: evidence.currentSettingsDigest,
        },
      );
    }
  }
  if (
    evidence.generationManifestDigest !== undefined
    && evidence.generationManifestDigest !== journal.generationManifestDigest
  ) {
    throw new TransactionJournalError(
      "generation manifest does not match the transaction verification receipt",
      "RECOVERY_GENERATION_HASH_MISMATCH",
    );
  }
  if (evidence.promotionExists !== undefined && evidence.promotionExists !== journal.promotionCreated) {
    throw new TransactionJournalError("promotion state does not match the transaction receipt", "RECOVERY_PROMOTION_MISMATCH");
  }
  return Object.freeze({
    ok: true,
    transactionId: journal.transactionId,
    generationManifestDigest: journal.generationManifestDigest ?? null,
    promotionCreated: journal.promotionCreated ?? false,
    intendedSettingsDigest: journal.intendedSettingsDigest ?? null,
    preserveConcurrentSettings: evidence.preserveConcurrentSettings === true,
    settingsDisposition,
  });
}

export async function settleTransactionRecovery(configRootInput, transactionId, status, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (!["ROLLED_BACK", "FAILED"].includes(status)) {
    throw new TypeError("config-runtime: recovery settlement must be ROLLED_BACK or FAILED");
  }
  if (typeof options.failureCode !== "string" || !FAILURE_CODE.test(options.failureCode)) {
    throw new TypeError("config-runtime: recovery settlement requires a canonical failureCode");
  }
  const target = transactionPaths(configRoot, transactionId);
  const current = await loadTransactionJournal(configRoot, transactionId);
  if (current.status !== "RECOVERING") {
    throw new TransactionJournalError("transaction must be RECOVERING before settlement", "JOURNAL_NOT_RECOVERING");
  }
  const next = {
    ...current,
    status,
    updatedAt: nowIso(options.now),
    failureCode: options.failureCode,
  };
  await atomicWriteJson(configRoot, target.journalFile, next, options.atomic ?? {});
  return Object.freeze(next);
}

export function planTransactionRecovery(journal) {
  validateJournal(journal, journal?.transactionId);
  const actions = {
    PREPARED: "ABANDON_PREPARED_TRANSACTION",
    BACKUP_DURABLE: "REMOVE_STAGING_AND_KEEP_BACKUP",
    GRAPH_STAGING: "REMOVE_STAGING_AND_KEEP_BACKUP",
    GRAPH_STAGED: "REMOVE_STAGING_AND_KEEP_BACKUP",
    GRAPH_VERIFIED: "REMOVE_STAGING_AND_KEEP_BACKUP",
    GRAPH_PROMOTED: "COMPARE_SETTINGS_AND_RECOVER",
    SETTINGS_PUBLISHED: "COMPARE_SETTINGS_AND_RECOVER",
    STATIC_DOCTOR_PASSED: "COMPARE_SETTINGS_AND_RECOVER",
    SMOKE_PASSED: "COMPARE_SETTINGS_AND_RECOVER",
    COMMITTED: "NONE",
  };
  const terminal = TERMINAL_STATUSES.has(journal.status);
  return Object.freeze({
    transactionId: journal.transactionId,
    operation: journal.operation,
    status: journal.status,
    phase: journal.phase,
    required: !terminal,
    action: terminal ? "NONE" : actions[journal.phase],
    requiresRollbackLock: !terminal,
    generationManifestDigest: journal.generationManifestDigest ?? null,
    promotionCreated: journal.promotionCreated ?? false,
    intendedSettingsDigest: journal.intendedSettingsDigest ?? null,
  });
}

export async function listTransactionJournals(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const root = configRuntimePaths(configRoot).transactionsRoot;
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const journals = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    if (isAtomicDirectoryTemporaryName(entry.name)) continue;
    try {
      const journal = await loadTransactionJournal(configRoot, entry.name);
      if (!options.incompleteOnly || !TERMINAL_STATUSES.has(journal.status)) journals.push(journal);
    } catch (error) {
      if (!options.includeInvalid) throw error;
      journals.push(Object.freeze({ transactionId: entry.name, invalid: true, errorCode: error.code ?? "INVALID_JOURNAL" }));
    }
  }
  return journals;
}
