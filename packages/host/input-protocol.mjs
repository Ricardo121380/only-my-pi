// @ts-check
import { inputDigest, inputError, validateInputContent, validateInputShard } from "./input-contracts.mjs";

export const INPUT_PROTOCOL = 1;
export const INPUT_CARRIER = "omp-host-input-v1";
/** @typedef {import('./contracts.d.ts').InputRecordV1} RecordV1 */
/** @typedef {import('./contracts.d.ts').InputReceiptV1} Receipt */
const id = /^[a-zA-Z0-9_-]{1,128}$/u;
/** @param {unknown} value @param {readonly string[]} fields @returns {Record<string, unknown>} */
function object(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) throw inputError("INPUT_COMMAND_INVALID", 400);
  return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value */
function identity(value) { if (typeof value !== "string" || !id.test(value)) throw inputError("INPUT_COMMAND_INVALID", 400); }
/** @param {unknown} value @returns {import('./contracts.d.ts').InputCommandV1} */
export function validateInputCommand(value) {
  /** @type {Record<string, string[]>} */
  const fields = { getInputs: [], submitPrompt: ["requestId", "input", "expectedRevision", "expectedInputRevision"], saveDraft: ["input", "expectedRevision"], clearDraft: ["expectedRevision"], enqueueInput: ["predecessorTaskId", "input", "expectedRevision"], deliverSupplement: ["taskId", "input", "expectedRevision"], editQueuedInput: ["input", "expectedRevision", "expectedInputRevision"], removeQueuedInput: ["inputId", "expectedRevision", "expectedInputRevision"], resumeQueue: ["expectedRevision"], reconcileInput: ["inputId"] };
  const type = value && typeof value === "object" && "type" in value ? value.type : null;
  if (typeof type !== "string" || !Object.hasOwn(fields, type)) throw inputError("INPUT_COMMAND_INVALID", 400);
  const command = object(value, ["type", "target", ...fields[type]]);
  const hasTask = command.target && typeof command.target === "object" && "taskId" in command.target;
  const target = object(command.target, ["projectId", hasTask ? "taskId" : "sessionKey"]);
  identity(target.projectId);
  if (hasTask) identity(target.taskId);
  else if (target.sessionKey !== null && (typeof target.sessionKey !== "string" || !/^[a-f0-9]{64}$/u.test(target.sessionKey))) throw inputError("INPUT_COMMAND_INVALID", 400);
  for (const key of ["taskId", "predecessorTaskId", "inputId", "requestId"]) if (key in command) identity(command[key]);
  for (const key of ["expectedRevision", "expectedInputRevision"]) if (key in command && (typeof command[key] !== "number" || !Number.isSafeInteger(command[key]) || command[key] < (key === "expectedInputRevision" ? 1 : 0))) throw inputError("INPUT_COMMAND_INVALID", 400);
  if ("input" in command) validateInputContent(command.input);
  if (type === "submitPrompt" && (hasTask || ("input" in command && /** @type {import('./contracts.d.ts').InputContentV1} */ (command.input).delivery !== "prompt"))) throw inputError("INPUT_COMMAND_INVALID", 400);
  return /** @type {import('./contracts.d.ts').InputCommandV1} */ (command);
}
/** IPC records are independently checked, not trusted merely because they came from IPC.
 * @param {unknown} value @returns {RecordV1} */
export function validateDeliveryRecord(value) {
  if (!value || typeof value !== "object" || !("projectId" in value) || !("sessionId" in value) || !("revision" in value)) throw inputError("INPUT_STATE_INVALID");
  const shard = validateInputShard({ schemaVersion: 1, kind: "queue", revision: value.revision, scope: { projectId: value.projectId, sessionId: value.sessionId }, items: [value] });
  if (shard.kind !== "queue" || shard.items[0].state !== "dispatching" || !shard.items[0].taskId) throw inputError("INPUT_STATE_INVALID");
  return shard.items[0];
}
/** Only a correlated custom entry on the CURRENT branch proves consumption.
 * Compaction context/messages and identical text are not evidence.
 * @param {readonly unknown[]} entries @param {RecordV1} record @returns {Receipt | null} */
export function findInputReceipt(entries, record) {
  /** @type {Receipt | null} */ let receipt = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !("type" in entry) || entry.type !== "custom_message" || !("customType" in entry) || entry.customType !== INPUT_CARRIER || !("details" in entry)) continue;
    const details = entry.details;
    if (!details || typeof details !== "object" || !("inputId" in details) || details.inputId !== record.inputId) continue;
    if (!("version" in details) || details.version !== INPUT_PROTOCOL || !("taskId" in details) || details.taskId !== record.taskId || !("contentDigest" in details) || details.contentDigest !== record.contentDigest || !("scope" in details) || !details.scope || typeof details.scope !== "object" || !("projectId" in details.scope) || details.scope.projectId !== record.projectId || !("sessionId" in details.scope) || details.scope.sessionId !== record.sessionId || !("content" in entry) || entry.content !== record.text || !("id" in entry) || typeof entry.id !== "string" || !entry.id || entry.id.length > 256 || inputDigest({ projectId: record.projectId, sessionId: record.sessionId }, record) !== record.contentDigest || receipt) throw inputError("INPUT_RECEIPT_CONFLICT");
    receipt = { inputId: record.inputId, taskId: /** @type {string} */ (record.taskId), contentDigest: record.contentDigest, entryId: entry.id };
  }
  return receipt;
}
/** @param {unknown} value @param {RecordV1} record @returns {Receipt} */
export function validateReceipt(value, record) {
  const receipt = object(value, ["inputId", "taskId", "contentDigest", "entryId"]);
  if (receipt.inputId !== record.inputId || receipt.taskId !== record.taskId || receipt.contentDigest !== record.contentDigest || typeof receipt.entryId !== "string" || !receipt.entryId || receipt.entryId.length > 256) throw inputError("INPUT_RECEIPT_CONFLICT");
  return /** @type {Receipt} */ (/** @type {unknown} */ (receipt));
}
