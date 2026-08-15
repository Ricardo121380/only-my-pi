/**
 * Small, dependency-free ACP v1 protocol helpers.
 *
 * This module intentionally models the stable ACP v1 surface that the
 * runtime-neutral adapter implements.  It is not a generated replacement for
 * the upstream ACP schema.  Callers should still validate any runtime-owned
 * tool payloads before they cross a trust boundary.
 */

export const ACP_V1_PROTOCOL_VERSION = 1;

export const ACP_METHODS = Object.freeze({
  INITIALIZE: "initialize",
  NEW_SESSION: "session/new",
  LOAD_SESSION: "session/load",
  PROMPT: "session/prompt",
  CANCEL: "session/cancel",
  UPDATE: "session/update",
  REQUEST_PERMISSION: "session/request_permission",
});

/**
 * The matrix is deliberately explicit.  `advertisedBy` names a capability
 * field, while `implemented` describes this package rather than a future Pi
 * integration.
 */
export const ACP_V1_CAPABILITY_MATRIX = Object.freeze({
  initialize: Object.freeze({
    direction: "client->agent",
    kind: "request",
    required: true,
    implemented: true,
  }),
  "session/new": Object.freeze({
    direction: "client->agent",
    kind: "request",
    required: true,
    implemented: true,
  }),
  "session/load": Object.freeze({
    direction: "client->agent",
    kind: "request",
    required: false,
    advertisedBy: "agentCapabilities.loadSession",
    implemented: true,
  }),
  "session/prompt": Object.freeze({
    direction: "client->agent",
    kind: "request",
    required: true,
    implemented: true,
  }),
  "session/cancel": Object.freeze({
    direction: "client->agent",
    kind: "notification",
    required: true,
    implemented: true,
  }),
  "session/update": Object.freeze({
    direction: "agent->client",
    kind: "notification",
    required: true,
    implemented: true,
  }),
  "session/request_permission": Object.freeze({
    direction: "agent->client",
    kind: "request",
    required: false,
    advertisedBy: "runtime.permissionCallback",
    implemented: true,
  }),
});

/** Methods reserved by ACP v1 but intentionally not implemented by this core. */
export const ACP_V1_RESERVED_METHODS = Object.freeze([
  "authenticate",
  "logout",
  "session/list",
  "session/delete",
  "session/resume",
  "session/close",
  "session/set_mode",
  "session/set_config_option",
  "fs/read_text_file",
  "fs/write_text_file",
  "terminal/create",
  "terminal/output",
  "terminal/wait_for_exit",
  "terminal/kill",
]);

export const JSON_RPC_ERROR_CODES = Object.freeze({
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  NOT_INITIALIZED: -32001,
  UNSUPPORTED_PROTOCOL: -32002,
  CAPABILITY_NOT_SUPPORTED: -32003,
  SESSION_NOT_FOUND: -32004,
  PROMPT_IN_PROGRESS: -32005,
  CANCELLED: -32800,
});

export class AcpError extends Error {
  constructor(message, { code = JSON_RPC_ERROR_CODES.INTERNAL_ERROR, data, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AcpError";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export class AcpProtocolError extends AcpError {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "AcpProtocolError";
  }
}

export class AcpUnsupportedMethodError extends AcpProtocolError {
  constructor(method, data = {}) {
    super(`ACP method is not supported: ${method}`, {
      code: JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND,
      data: { code: "UNSUPPORTED_METHOD", method, ...data },
    });
    this.name = "AcpUnsupportedMethodError";
  }
}

export class AcpCapabilityError extends AcpProtocolError {
  constructor(capability, message = `ACP capability is not supported: ${capability}`, data = {}) {
    super(message, {
      code: JSON_RPC_ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
      data: { code: "CAPABILITY_NOT_SUPPORTED", capability, ...data },
    });
    this.name = "AcpCapabilityError";
  }
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

export function isJsonRpcId(value) {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

export function hasRequestId(message) {
  return hasOwn(message, "id");
}

export function idKey(id) {
  return `${typeof id}:${String(id)}`;
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to a JSON clone for plain protocol values.
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function makeJsonRpcErrorResponse(id, error) {
  const normalized = normalizeError(error);
  const response = {
    jsonrpc: "2.0",
    id: id === undefined ? null : id,
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };
  if (normalized.data !== undefined) response.error.data = cloneJson(normalized.data);
  return response;
}

export function makeJsonRpcResultResponse(id, result) {
  return { jsonrpc: "2.0", id, result: cloneJson(result) };
}

export function normalizeError(error) {
  if (error instanceof AcpError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data === undefined ? {} : { data: error.data }),
    };
  }
  return {
    code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
    message: "ACP adapter internal error",
    data: { code: "INTERNAL_ERROR" },
  };
}

export function assertJsonRpcMessage(message) {
  if (!isObject(message)) {
    throw new AcpProtocolError("JSON-RPC message must be an object", {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "INVALID_MESSAGE" },
    });
  }
  if (message.jsonrpc !== "2.0") {
    throw new AcpProtocolError("JSON-RPC message must use jsonrpc=2.0", {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "INVALID_JSONRPC_VERSION" },
    });
  }
  const response = hasOwn(message, "result") || hasOwn(message, "error");
  if (response) {
    if (!hasOwn(message, "id") || !isJsonRpcId(message.id)) {
      throw new AcpProtocolError("JSON-RPC response must contain a valid id", {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        data: { code: "INVALID_RESPONSE_ID" },
      });
    }
    if (hasOwn(message, "result") === hasOwn(message, "error")) {
      throw new AcpProtocolError("JSON-RPC response must contain exactly one of result or error", {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        data: { code: "INVALID_RESPONSE_SHAPE" },
      });
    }
    if (hasOwn(message, "error") && !isObject(message.error)) {
      throw new AcpProtocolError("JSON-RPC error must be an object", {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        data: { code: "INVALID_ERROR_SHAPE" },
      });
    }
    return { kind: "response", id: message.id };
  }
  if (typeof message.method !== "string" || message.method.length === 0) {
    throw new AcpProtocolError("JSON-RPC request must contain a method", {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "MISSING_METHOD" },
    });
  }
  if (hasOwn(message, "id") && !isJsonRpcId(message.id)) {
    throw new AcpProtocolError("JSON-RPC request id is invalid", {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "INVALID_REQUEST_ID" },
    });
  }
  if (hasOwn(message, "params") && !(isObject(message.params) || Array.isArray(message.params))) {
    throw new AcpProtocolError("JSON-RPC params must be an object or array", {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "INVALID_PARAMS_CONTAINER" },
    });
  }
  return { kind: hasRequestId(message) ? "request" : "notification", method: message.method };
}

export function requireParamsObject(params, method) {
  if (!isObject(params)) {
    throw new AcpProtocolError(`${method} params must be an object`, {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "PARAMS_OBJECT_REQUIRED", method },
    });
  }
  return params;
}

export function normalizeProtocolVersion(value) {
  if (value === ACP_V1_PROTOCOL_VERSION || value === String(ACP_V1_PROTOCOL_VERSION)) {
    return ACP_V1_PROTOCOL_VERSION;
  }
  return null;
}

export function isAbsolutePath(value) {
  return typeof value === "string" && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"));
}

export function assertAbsolutePath(value, field) {
  if (!isAbsolutePath(value)) {
    throw new AcpProtocolError(`${field} must be an absolute path`, {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "ABSOLUTE_PATH_REQUIRED", field },
    });
  }
}

export function normalizeAgentCapabilities(capabilities = {}) {
  const input = isObject(capabilities) ? capabilities : {};
  const prompt = isObject(input.promptCapabilities) ? input.promptCapabilities : {};
  const mcp = isObject(input.mcpCapabilities) ? input.mcpCapabilities : {};
  const sessions = isObject(input.sessionCapabilities) ? input.sessionCapabilities : {};
  return {
    loadSession: input.loadSession === true,
    promptCapabilities: {
      image: prompt.image === true,
      audio: prompt.audio === true,
      embeddedContext: prompt.embeddedContext === true,
      ...(prompt._meta === undefined ? {} : { _meta: cloneJson(prompt._meta) }),
    },
    mcpCapabilities: {
      http: mcp.http === true,
      sse: mcp.sse === true,
      ...(mcp._meta === undefined ? {} : { _meta: cloneJson(mcp._meta) }),
    },
    sessionCapabilities: cloneJson(sessions),
    auth: isObject(input.auth) ? cloneJson(input.auth) : {},
    ...(input._meta === undefined ? {} : { _meta: cloneJson(input._meta) }),
  };
}

export function normalizeImplementation(info, fallbackName, fallbackVersion) {
  const value = isObject(info) ? info : {};
  return {
    name: typeof value.name === "string" && value.name.length > 0 ? value.name : fallbackName,
    version: typeof value.version === "string" && value.version.length > 0 ? value.version : fallbackVersion,
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value._meta === undefined ? {} : { _meta: cloneJson(value._meta) }),
  };
}

export function validatePromptBlocks(prompt, capabilities) {
  if (!Array.isArray(prompt)) {
    throw new AcpProtocolError("session/prompt.prompt must be an array", {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "PROMPT_ARRAY_REQUIRED" },
    });
  }
  for (const [index, block] of prompt.entries()) {
    if (!isObject(block) || typeof block.type !== "string") {
      throw new AcpProtocolError(`prompt block ${index} is invalid`, {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "INVALID_CONTENT_BLOCK", index },
      });
    }
    switch (block.type) {
      case "text":
        if (typeof block.text !== "string") {
          throw new AcpProtocolError(`prompt text block ${index} is invalid`, {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            data: { code: "TEXT_REQUIRED", index },
          });
        }
        break;
      case "resource_link":
        if (typeof block.uri !== "string" || typeof block.name !== "string") {
          throw new AcpProtocolError(`prompt resource link ${index} is invalid`, {
            code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
            data: { code: "RESOURCE_LINK_FIELDS_REQUIRED", index },
          });
        }
        break;
      case "image":
        if (capabilities.image !== true) throw new AcpCapabilityError("promptCapabilities.image");
        break;
      case "audio":
        if (capabilities.audio !== true) throw new AcpCapabilityError("promptCapabilities.audio");
        break;
      case "resource":
        if (capabilities.embeddedContext !== true) throw new AcpCapabilityError("promptCapabilities.embeddedContext");
        break;
      default:
        throw new AcpUnsupportedMethodError(`content:${block.type}`, { code: "UNSUPPORTED_CONTENT_BLOCK" });
    }
  }
  return prompt;
}
