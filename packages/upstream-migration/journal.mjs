import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, readJsonObject } from "../config-runtime/index.mjs";

const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TERMINAL = new Set(["COMMITTED", "ROLLED_BACK", "FAILED", "MANUAL_RECONCILIATION_REQUIRED"]);

export const UPSTREAM_DURABLE_BOUNDARIES = Object.freeze([
  "PREPARED",
  "PREFLIGHT_VERIFIED",
  "BACKUP_DURABLE",
  "PI_STAGED",
  "EXTERNAL_TREE_STAGED",
  "GENERATION_STAGED",
  "CLI_STAGED",
  "PI_PROCESSES_STOPPED",
  "PI_OLD_RENAMED",
  "PI_NEW_RENAMED",
  "EXTERNAL_OLD_RENAMED",
  "EXTERNAL_NEW_RENAMED",
  "SETTINGS_PUBLISHED",
  "GENERATION_ACTIVATED",
  "CLI_ACTIVATED",
  "STATIC_DOCTOR_PASSED",
  "NO_MODEL_SMOKE_PASSED",
  "LKG_RECORDED",
  "COMMITTED",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function transactionRoot(configRoot, transactionId) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("configRoot must be an absolute path");
  if (!TRANSACTION_ID.test(transactionId ?? "")) fail("UPSTREAM_TRANSACTION_ID_INVALID", "upstream transaction id is invalid");
  return path.join(path.resolve(configRoot), "only-my-pi", "upstream-transactions", transactionId);
}

export function upstreamTransactionPaths(configRoot, transactionId) {
  const root = transactionRoot(configRoot, transactionId);
  return Object.freeze({
    root,
    journal: path.join(root, "journal.json"),
    plan: path.join(root, "plan.json"),
    receipt: path.join(root, "receipt.json"),
    rollbackManifest: path.join(root, "rollback-manifest.json"),
    staging: path.join(root, "staging"),
  });
}

function validateJournal(journal) {
  if (journal?.formatVersion !== 1 || journal.kind !== "only-my-pi-upstream-transaction"
    || !TRANSACTION_ID.test(journal.transactionId ?? "") || typeof journal.createdAt !== "string"
    || typeof journal.updatedAt !== "string" || !UPSTREAM_DURABLE_BOUNDARIES.includes(journal.phase)
    || typeof journal.status !== "string" || !Array.isArray(journal.history)) {
    fail("UPSTREAM_JOURNAL_INVALID", "upstream transaction journal is invalid");
  }
  return journal;
}

export async function createUpstreamJournal(configRoot, { transactionId, planDigest, bundleDigest, sourceCommit, now = () => new Date().toISOString() } = {}) {
  const paths = upstreamTransactionPaths(configRoot, transactionId);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  await fs.chmod(paths.root, 0o700);
  const existing = await fs.lstat(paths.journal).then(() => true, (error) => { if (error?.code === "ENOENT") return false; throw error; });
  if (existing) fail("UPSTREAM_TRANSACTION_EXISTS", "upstream transaction already exists");
  const timestamp = now();
  const journal = validateJournal({
    formatVersion: 1,
    kind: "only-my-pi-upstream-transaction",
    transactionId,
    status: "ACTIVE",
    phase: "PREPARED",
    createdAt: timestamp,
    updatedAt: timestamp,
    planDigest,
    bundleDigest,
    sourceCommit,
    failureCode: null,
    recovery: null,
    history: [{ phase: "PREPARED", at: timestamp }],
  });
  await atomicWriteJson(configRoot, paths.journal, journal, { mode: 0o600 });
  return Object.freeze(journal);
}

export async function loadUpstreamJournal(configRoot, transactionId) {
  const paths = upstreamTransactionPaths(configRoot, transactionId);
  return Object.freeze(validateJournal(await readJsonObject(configRoot, paths.journal)));
}

export async function advanceUpstreamJournal(configRoot, transactionId, phase, details = {}, { now = () => new Date().toISOString() } = {}) {
  if (!UPSTREAM_DURABLE_BOUNDARIES.includes(phase)) fail("UPSTREAM_PHASE_INVALID", `unknown upstream durable boundary: ${phase}`);
  const paths = upstreamTransactionPaths(configRoot, transactionId);
  const current = await loadUpstreamJournal(configRoot, transactionId);
  if (TERMINAL.has(current.status)) fail("UPSTREAM_TRANSACTION_TERMINAL", "terminal upstream transaction cannot advance");
  const currentIndex = UPSTREAM_DURABLE_BOUNDARIES.indexOf(current.phase);
  const nextIndex = UPSTREAM_DURABLE_BOUNDARIES.indexOf(phase);
  if (nextIndex < currentIndex || nextIndex > currentIndex + 1) fail("UPSTREAM_PHASE_ORDER_INVALID", `invalid upstream phase transition ${current.phase} -> ${phase}`);
  if (nextIndex === currentIndex) return current;
  const timestamp = now();
  const journal = validateJournal({
    ...current,
    ...details,
    phase,
    status: phase === "COMMITTED" ? "COMMITTED" : current.status,
    updatedAt: timestamp,
    history: [...current.history, { phase, at: timestamp }],
  });
  await atomicWriteJson(configRoot, paths.journal, journal, { mode: 0o600 });
  return Object.freeze(journal);
}

export async function markUpstreamRecovery(configRoot, transactionId, { status, failureCode, recovery = null, now = () => new Date().toISOString() } = {}) {
  if (!new Set(["RECOVERING", "ROLLED_BACK", "FAILED", "MANUAL_RECONCILIATION_REQUIRED"]).has(status)) fail("UPSTREAM_RECOVERY_STATUS_INVALID", "invalid upstream recovery status");
  const paths = upstreamTransactionPaths(configRoot, transactionId);
  const current = await loadUpstreamJournal(configRoot, transactionId);
  if (TERMINAL.has(current.status)) return current;
  const timestamp = now();
  const journal = validateJournal({ ...current, status, failureCode: failureCode ?? current.failureCode, recovery, updatedAt: timestamp });
  await atomicWriteJson(configRoot, paths.journal, journal, { mode: 0o600 });
  return Object.freeze(journal);
}

export async function listUpstreamJournals(configRoot, { incompleteOnly = false } = {}) {
  const root = path.join(path.resolve(configRoot), "only-my-pi", "upstream-transactions");
  let names;
  try { names = await fs.readdir(root); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const journals = [];
  for (const name of names.sort()) {
    if (!TRANSACTION_ID.test(name)) continue;
    const journal = await loadUpstreamJournal(configRoot, name);
    if (!incompleteOnly || !TERMINAL.has(journal.status)) journals.push(journal);
  }
  return Object.freeze(journals);
}
