import Ajv from "ajv";
export const HOST_PROTOCOL = 2;
export const HOST_VERSION = "phase2-v1";
export const CLI_ACCOUNT_ID = "cli-readonly";
const id = { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" };
const schema = { oneOf: [
  { type: "object", additionalProperties: false, required: ["type", "path"], properties: { type: { const: "addProject" }, path: { type: "string", minLength: 1, maxLength: 4096 } } },
  { type: "object", additionalProperties: false, required: ["type", "requestId", "projectId", "accountId", "model", "prompt"], properties: {
    type: { const: "startTask" }, requestId: id, projectId: id, accountId: id, model: { type: "string", pattern: "^[^\\s/]+/.{1,256}$" }, prompt: { type: "string", minLength: 1, maxLength: 32768 } } },
  { type: "object", additionalProperties: false, required: ["type", "taskId"], properties: { type: { const: "cancelTask" }, taskId: id } },
] };
const validate = new Ajv({ strict: true }).compile(schema);
export function validateCommand(value) { if (!validate(value)) throw Object.assign(new Error("HOST_COMMAND_INVALID"), { code: "HOST_COMMAND_INVALID", status: 400 }); return value; }
export const hostError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const terminal = (status) => ["succeeded", "failed", "cancelled", "interrupted"].includes(status);
export function textContent(content, limit = 65536) {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n") : "";
  return text.slice(0, limit);
}
