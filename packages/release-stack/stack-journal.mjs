import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { sha256 } from "./contracts.mjs";
import { stackTransactionLayout } from "./layout.mjs";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const STACK_TRANSACTION_PHASES = Object.freeze([
  "PREPARED",
  "PAYLOADS_VERIFIED",
  "BACKUP_DURABLE",
  "NODE_STAGED",
  "PI_STAGED",
  "EXTERNAL_TREE_STAGED",
  "OMP_ARTIFACT_STAGED",
  "GENERATION_STAGED",
  "SHIMS_STAGED",
  "PI_PROCESSES_STOPPED",
  "EXTERNAL_TREE_SWITCHED",
  "SETTINGS_PUBLISHED",
  "STACK_ACTIVATED",
  "SHIMS_ACTIVATED",
  "STATIC_DOCTOR_PASSED",
  "NO_MODEL_SMOKE_PASSED",
  "LKG_RECORDED",
  "COMMITTED",
]);

const TERMINAL = new Set(["COMMITTED", "ROLLED_BACK", "MANUAL_RECONCILIATION_REQUIRED"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "w" });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, file);
}

function validate(journal) {
  if (journal?.formatVersion !== 1 || journal.kind !== "only-my-pi-stack-transaction" || !ID.test(journal.transactionId ?? "")
    || !STACK_TRANSACTION_PHASES.includes(journal.phase) || typeof journal.status !== "string" || !Array.isArray(journal.history)
    || journal.journalDigest !== digest(journal)) fail("STACK_JOURNAL_INVALID", "stack transaction journal is invalid");
  return journal;
}

function digest(journal) {
  const unsigned = structuredClone(journal);
  delete unsigned.journalDigest;
  return sha256(canonicalJson(unsigned));
}

function withDigest(journal) {
  const result = { ...journal, journalDigest: "sha256:" + "0".repeat(64) };
  result.journalDigest = digest(result);
  return result;
}

export async function createStackJournal(layout, { transactionId, operation, stackId, planDigest, now = () => new Date().toISOString() } = {}) {
  if (!ID.test(transactionId ?? "")) fail("STACK_TRANSACTION_ID_INVALID", "stack transaction ID is invalid");
  if (!["install", "update", "rollback", "remove"].includes(operation)) fail("STACK_OPERATION_INVALID", "stack transaction operation is invalid");
  const paths = stackTransactionLayout(layout, transactionId);
  await fs.mkdir(paths.root, { recursive: true, mode: 0o700 });
  if (await fs.lstat(paths.journal).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("STACK_TRANSACTION_EXISTS", "stack transaction already exists");
  const at = now();
  const journal = withDigest({
    formatVersion: 1,
    kind: "only-my-pi-stack-transaction",
    transactionId,
    operation,
    stackId,
    planDigest,
    status: "ACTIVE",
    phase: "PREPARED",
    failureCode: null,
    createdAt: at,
    updatedAt: at,
    history: [{ phase: "PREPARED", at }],
  });
  await writeJson(paths.journal, journal);
  return Object.freeze(journal);
}

export async function readStackJournal(layout, transactionId) {
  const file = stackTransactionLayout(layout, transactionId).journal;
  return Object.freeze(validate(JSON.parse(await fs.readFile(file, "utf8"))));
}

export async function advanceStackJournal(layout, transactionId, phase, { now = () => new Date().toISOString() } = {}) {
  if (!STACK_TRANSACTION_PHASES.includes(phase)) fail("STACK_PHASE_INVALID", `unknown stack transaction phase: ${phase}`);
  const current = await readStackJournal(layout, transactionId);
  if (TERMINAL.has(current.status)) fail("STACK_TRANSACTION_TERMINAL", "terminal stack transaction cannot advance");
  const before = STACK_TRANSACTION_PHASES.indexOf(current.phase);
  const after = STACK_TRANSACTION_PHASES.indexOf(phase);
  if (after < before || after > before + 1) fail("STACK_PHASE_ORDER_INVALID", `invalid phase transition ${current.phase} -> ${phase}`);
  if (after === before) return current;
  const at = now();
  const journal = withDigest({ ...current, phase, status: phase === "COMMITTED" ? "COMMITTED" : current.status, updatedAt: at, history: [...current.history, { phase, at }] });
  await writeJson(stackTransactionLayout(layout, transactionId).journal, journal);
  return Object.freeze(journal);
}

export async function markStackJournal(layout, transactionId, { status, failureCode, now = () => new Date().toISOString() } = {}) {
  if (!["RECOVERING", "ROLLED_BACK", "MANUAL_RECONCILIATION_REQUIRED"].includes(status)) fail("STACK_RECOVERY_STATUS_INVALID", "stack recovery status is invalid");
  const current = await readStackJournal(layout, transactionId);
  const journal = withDigest({ ...current, status, failureCode: failureCode ?? current.failureCode, updatedAt: now() });
  await writeJson(stackTransactionLayout(layout, transactionId).journal, journal);
  return Object.freeze(journal);
}

export async function listStackJournals(layout, { incompleteOnly = false } = {}) {
  const names = await fs.readdir(layout.transactionRoot).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  const journals = [];
  for (const name of names.sort()) {
    if (!ID.test(name)) continue;
    const journal = await readStackJournal(layout, name);
    if (!incompleteOnly || !TERMINAL.has(journal.status)) journals.push(journal);
  }
  return Object.freeze(journals);
}

export const writeStackJson = writeJson;
