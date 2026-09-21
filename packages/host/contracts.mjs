import Ajv from "ajv";
export const HOST_PROTOCOL = 2;
export const HOST_VERSION = "phase2-v1";
export const CLI_ACCOUNT_ID = "cli-readonly";
const id = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" };
const schema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["type", "projectId"], properties: { type: { const: "enterManual" }, projectId: id } },
  { type: "object", additionalProperties: false, required: ["type", "projectId", "manualId"], properties: { type: { const: "leaveManual" }, projectId: id, manualId: id } },
  { type: "object", additionalProperties: false, required: ["type", "projectId", "manualId", "path", "version", "text"], properties: { type: { const: "saveFile" }, projectId: id, manualId: id, path: { type: "string", minLength: 1, maxLength: 4096 }, version: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, text: { type: "string", maxLength: 524288 } } },
  { type: "object", additionalProperties: false, required: ["type", "path"], properties: { type: { const: "addProject" }, path: { type: "string", minLength: 1, maxLength: 4096 } } },
  { type: "object", additionalProperties: false, required: ["type", "requestId", "projectId", "accountId", "model", "prompt"], properties: {
    type: { const: "startTask" }, mode: { enum: ["readonly", "controlled"] }, resumeSessionKey: id, requestId: id, projectId: id, accountId: id, model: { type: "string", pattern: "^[^\\s/]+/.{1,256}$" }, prompt: { type: "string", minLength: 1, maxLength: 32768 } } },
  { type: "object", additionalProperties: false, required: ["type", "taskId"], properties: { type: { const: "cancelTask" }, taskId: id } },
  { type: "object", additionalProperties: false, required: ["type", "taskId"], properties: { type: { const: "revokeTask" }, taskId: id } },
  { type: "object", additionalProperties: false, required: ["type", "taskId", "approvalId", "value"], properties: { type: { const: "answerApproval" }, taskId: id, approvalId: id, value: { anyOf: [{ type: "boolean" }, { type: "string", maxLength: 2048 }] } } },
] };
const validate = new Ajv({ strict: true }).compile(schema);
export function validateCommand(value) { if (!validate(value)) throw Object.assign(new Error("HOST_COMMAND_INVALID"), { code: "HOST_COMMAND_INVALID", status: 400 }); return value; }
export const hostError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const terminal = (status) => ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
export function textContent(content, limit = 65536) {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n") : "";
  return text.slice(0, limit);
}
