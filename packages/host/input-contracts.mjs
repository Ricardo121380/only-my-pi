// @ts-check
import { Ajv } from "ajv";
import { createHash } from "node:crypto";
import { canonicalJson } from "../config-runtime/atomic-file.mjs";

/** @typedef {import('./contracts.d.ts').InputScopeV1} InputScopeV1 */
/** @typedef {import('./contracts.d.ts').InputContentV1} InputContentV1 */
/** @typedef {import('./contracts.d.ts').InputRecordV1} InputRecordV1 */
/** @typedef {import('./contracts.d.ts').InputShardV1} InputShardV1 */

export const INPUT_LIMITS = Object.freeze({ text: 32768, materials: 10, records: 1000, shardBytes: 16 * 1024 ** 2, shards: 10000, identities: 100000 });
const id = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" };
const sessionId = { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 256 }] };
const revision = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const scope = { type: "object", additionalProperties: false, required: ["projectId", "sessionId"], properties: { projectId: id, sessionId } };
const binding = { type: "object", additionalProperties: false, required: ["accountId", "modelId", "thinking", "mode", "resourceRevision"], properties: {
  accountId: id, modelId: { type: "string", pattern: "^[^\\s/]+/.{1,256}$" }, thinking: { enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] },
  mode: { enum: ["readonly", "controlled"] }, resourceRevision: revision,
} };
const content = { inputId: id, delivery: { enum: ["prompt", "steer", "queue"] }, text: { type: "string", maxLength: INPUT_LIMITS.text },
  materialSnapshotIds: { type: "array", maxItems: INPUT_LIMITS.materials, uniqueItems: true, items: id }, binding };
const record = { type: "object", additionalProperties: false, required: [...Object.keys(content), "schemaVersion", "revision", "projectId", "sessionId", "taskId", "contentDigest", "state", "consumedEntryId", "pauseReason", "createdAt", "updatedAt"], properties: {
  ...content, schemaVersion: { const: 1 }, revision: { ...revision, minimum: 1 }, projectId: id, sessionId, taskId: { anyOf: [{ type: "null" }, id] },
  contentDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, state: { enum: ["draft", "queued", "dispatching", "accepted", "consumed", "paused", "unknown", "removed"] },
  consumedEntryId: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 256 }] },
  pauseReason: { anyOf: [{ type: "null" }, { type: "string", pattern: "^[A-Z_]{1,128}$" }] },
  createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" },
} };
const ajv = new Ajv({ strict: true, formats: { "date-time": { type: "string", validate: (/** @type {string} */ value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value } } });
/** @type {import('ajv').ValidateFunction<InputScopeV1>} */
const checkScope = ajv.compile(scope);
/** @type {import('ajv').ValidateFunction<InputContentV1>} */
const checkContent = ajv.compile({ type: "object", additionalProperties: false, required: Object.keys(content), properties: content });
/** @type {import('ajv').ValidateFunction<InputShardV1>} */
const checkShard = ajv.compile({ oneOf: [
  { type: "object", additionalProperties: false, required: ["schemaVersion", "kind", "revision", "scope", "draft"], properties: { schemaVersion: { const: 1 }, kind: { const: "draft" }, revision, scope, draft: { anyOf: [{ type: "null" }, record] } } },
  { type: "object", additionalProperties: false, required: ["schemaVersion", "kind", "revision", "scope", "items"], properties: { schemaVersion: { const: 1 }, kind: { const: "queue" }, revision, scope, items: { type: "array", maxItems: INPUT_LIMITS.records, items: record } } },
] });

/** @param {string} code @param {number} [status] */
export const inputError = (code, status = 409) => Object.assign(new Error(code), { code, status });
/** @param {unknown} value @returns {InputScopeV1} */
export function validateInputScope(value) {
  if (!checkScope(value)) throw inputError("INPUT_SCOPE_INVALID", 400);
  return value;
}
/** @param {unknown} value @returns {InputContentV1} */
export function validateInputContent(value) {
  if (!checkContent(value)) throw inputError("INPUT_CONTENT_INVALID", 400);
  return value;
}
/** State and tracing metadata do not alter the effective content identity.
 * @param {InputScopeV1} target @param {InputContentV1} value */
export function inputDigest(target, value) {
  return `sha256:${createHash("sha256").update(canonicalJson({ schemaVersion: 1, scope: target, delivery: value.delivery, text: value.text, materialSnapshotIds: value.materialSnapshotIds, binding: value.binding })).digest("hex")}`;
}
/** @param {unknown} value @returns {InputShardV1} */
export function validateInputShard(value) {
  if (value && typeof value === "object" && "schemaVersion" in value && value.schemaVersion !== 1) throw inputError("INPUT_SCHEMA_UNSUPPORTED");
  if (!checkShard(value)) throw inputError("INPUT_STATE_INVALID");
  const records = value.kind === "draft" ? value.draft ? [value.draft] : [] : value.items;
  if (records.length && (value.revision < 1 || (value.kind === "queue" && value.scope.sessionId === null))) throw inputError("INPUT_STATE_INVALID");
  const seen = new Set();
  for (const item of records) {
    if (seen.has(item.inputId) || item.revision > value.revision || item.projectId !== value.scope.projectId || item.sessionId !== value.scope.sessionId || inputDigest(value.scope, item) !== item.contentDigest) throw inputError("INPUT_STATE_INVALID");
    seen.add(item.inputId);
    if ((value.kind === "draft") !== (item.state === "draft") || (item.delivery !== "prompt" && item.sessionId === null)) throw inputError("INPUT_STATE_INVALID");
    if ((item.state === "consumed") !== (item.consumedEntryId !== null) || (["accepted", "consumed"].includes(item.state) && !item.taskId)) throw inputError("INPUT_STATE_INVALID");
    if (["draft", "queued", "paused", "removed"].includes(item.state) && item.taskId !== null) throw inputError("INPUT_STATE_INVALID");
    if (["paused", "unknown"].includes(item.state) !== (item.pauseReason !== null) || item.updatedAt < item.createdAt) throw inputError("INPUT_STATE_INVALID");
  }
  return value;
}
