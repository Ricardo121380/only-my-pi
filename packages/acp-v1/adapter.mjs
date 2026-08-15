import {
  ACP_METHODS,
  ACP_V1_CAPABILITY_MATRIX,
  ACP_V1_PROTOCOL_VERSION,
  ACP_V1_RESERVED_METHODS,
  AcpCapabilityError,
  AcpError,
  AcpProtocolError,
  AcpUnsupportedMethodError,
  JSON_RPC_ERROR_CODES,
  assertAbsolutePath,
  assertJsonRpcMessage,
  cloneJson,
  hasOwn,
  hasRequestId,
  idKey,
  isObject,
  makeJsonRpcErrorResponse,
  makeJsonRpcResultResponse,
  normalizeAgentCapabilities,
  normalizeError,
  normalizeImplementation,
  normalizeProtocolVersion,
  requireParamsObject,
  validatePromptBlocks,
} from "./protocol.mjs";
import { NdjsonDecoder, decodeNdjsonLine, encodeNdjson } from "./ndjson.mjs";

function defaultIdFactory() {
  const counters = new Map();
  return (kind) => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

function makeAbortController() {
  if (typeof AbortController === "function") return new AbortController();
  let aborted = false;
  const listeners = new Set();
  const signal = {
    get aborted() {
      return aborted;
    },
    addEventListener(type, listener) {
      if (type === "abort" && typeof listener === "function") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of listeners) listener();
    },
  };
}

function isValidStopReason(value) {
  return ["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled"].includes(value);
}

function normalizeStopReason(value, fallback = "end_turn") {
  return isValidStopReason(value) ? value : fallback;
}

function normalizeMcpServers(params, capabilities) {
  const servers = params.mcpServers === undefined ? [] : params.mcpServers;
  if (!Array.isArray(servers)) {
    throw new AcpProtocolError("mcpServers must be an array", {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "MCP_SERVERS_ARRAY_REQUIRED" },
    });
  }
  for (const [index, server] of servers.entries()) {
    if (!isObject(server)) {
      throw new AcpProtocolError(`mcpServers[${index}] must be an object`, {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "MCP_SERVER_OBJECT_REQUIRED", index },
      });
    }
    const type = server.type ?? "stdio";
    if (type === "http" && capabilities.http !== true) {
      throw new AcpCapabilityError("mcpCapabilities.http");
    }
    if (type === "sse" && capabilities.sse !== true) {
      throw new AcpCapabilityError("mcpCapabilities.sse");
    }
    if (!["stdio", "http", "sse"].includes(type)) {
      throw new AcpProtocolError(`unsupported MCP transport: ${type}`, {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "UNSUPPORTED_MCP_TRANSPORT", index, type },
      });
    }
  }
  return cloneJson(servers);
}

function normalizeAdditionalDirectories(params, capabilities) {
  const roots = params.additionalDirectories;
  if (roots === undefined) return [];
  if (!Array.isArray(roots)) {
    throw new AcpProtocolError("additionalDirectories must be an array", {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "ADDITIONAL_DIRECTORIES_ARRAY_REQUIRED" },
    });
  }
  if (roots.length > 0 && !isObject(capabilities)) {
    throw new AcpCapabilityError("sessionCapabilities.additionalDirectories");
  }
  for (const [index, root] of roots.entries()) assertAbsolutePath(root, `additionalDirectories[${index}]`);
  return [...roots];
}

function normalizePermissionRequest(sessionId, request) {
  const value = isObject(request) ? request : {};
  if (!isObject(value.toolCall) || typeof value.toolCall.toolCallId !== "string" || typeof value.toolCall.title !== "string") {
    throw new AcpProtocolError("permission request requires toolCall", {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "TOOL_CALL_REQUIRED" },
    });
  }
  if (!Array.isArray(value.options) || value.options.length === 0) {
    throw new AcpProtocolError("permission request requires options", {
      code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
      data: { code: "PERMISSION_OPTIONS_REQUIRED" },
    });
  }
  const allowedKinds = new Set(["allow_once", "allow_always", "reject_once", "reject_always"]);
  for (const [index, option] of value.options.entries()) {
    if (
      !isObject(option) ||
      typeof option.optionId !== "string" ||
      typeof option.name !== "string" ||
      typeof option.kind !== "string" ||
      !allowedKinds.has(option.kind)
    ) {
      throw new AcpProtocolError(`permission option ${index} is invalid`, {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "INVALID_PERMISSION_OPTION", index },
      });
    }
  }
  return {
    sessionId,
    toolCall: cloneJson(value.toolCall),
    options: cloneJson(value.options),
    ...(value._meta === undefined ? {} : { _meta: cloneJson(value._meta) }),
  };
}

function normalizeSessionRecord(record, sessionId, params = {}) {
  const value = isObject(record) ? cloneJson(record) : {};
  return {
    ...value,
    sessionId: typeof value.sessionId === "string" ? value.sessionId : sessionId,
    cwd: value.cwd ?? params.cwd,
    additionalDirectories: Array.isArray(value.additionalDirectories)
      ? [...value.additionalDirectories]
      : Array.isArray(params.additionalDirectories)
        ? [...params.additionalDirectories]
        : [],
    mcpServers: Array.isArray(value.mcpServers) ? cloneJson(value.mcpServers) : cloneJson(params.mcpServers ?? []),
    history: Array.isArray(value.history) ? cloneJson(value.history) : [],
  };
}

function assertRequestMessage(message, method) {
  if (!hasRequestId(message)) {
    throw new AcpProtocolError(`${method} must be a JSON-RPC request with an id`, {
      code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
      data: { code: "REQUEST_ID_REQUIRED", method },
    });
  }
}

/**
 * In-memory persistence useful for tests and small adapters.  It deliberately
 * has no filesystem or network behavior; callers needing durable sessions must
 * provide a reviewed `create/load/save` implementation.
 */
export class MemorySessionStore {
  #sessions = new Map();
  #idFactory;

  constructor({ idFactory = defaultIdFactory() } = {}) {
    this.#idFactory = idFactory;
  }

  async create(params) {
    const sessionId = params.sessionId ?? this.#idFactory("session");
    const record = normalizeSessionRecord(params, sessionId, params);
    this.#sessions.set(sessionId, cloneJson(record));
    return cloneJson(record);
  }

  async load(sessionId) {
    const record = this.#sessions.get(sessionId);
    return record === undefined ? undefined : cloneJson(record);
  }

  async save(record) {
    if (!isObject(record) || typeof record.sessionId !== "string") return;
    this.#sessions.set(record.sessionId, cloneJson(record));
  }

  async delete(sessionId) {
    this.#sessions.delete(sessionId);
  }
}

/**
 * Runtime-neutral ACP v1 Agent-side adapter.
 *
 * `dispatch()` consumes parsed JSON-RPC messages and returns messages emitted
 * while handling that call. `dispatchLine()`/`dispatchChunk()` add NDJSON
 * framing, but never read or write a stream. A caller may optionally provide
 * `send(message)` to observe outbound messages immediately; transport code is
 * still responsible for writing bytes and handling process lifetime.
 */
export class AcpV1Adapter {
  #initialized = false;
  #clientCapabilities = {};
  #clientInfo;
  #sessions = new Map();
  #activePrompts = new Map();
  #pendingPermissions = new Map();
  #outbox = [];
  #idFactory;
  #decoder;
  #send;
  #onTransportError;
  #onEvent;
  #now;
  #recordSessionUpdates;
  #sessionStore;

  constructor({
    agentInfo = { name: "only-my-pi-acp", version: "0.1.0" },
    agentCapabilities = {},
    authMethods = [],
    sessionStore = new MemorySessionStore(),
    promptHandler = async () => ({ stopReason: "end_turn" }),
    idFactory = defaultIdFactory(),
    send,
    onTransportError,
    onEvent,
    now = () => new Date().toISOString(),
    recordSessionUpdates = true,
    maxLineBytes,
  } = {}) {
    if (typeof promptHandler !== "function") throw new TypeError("promptHandler must be a function");
    if (typeof idFactory !== "function") throw new TypeError("idFactory must be a function");
    this.agentInfo = normalizeImplementation(agentInfo, "only-my-pi-acp", "0.1.0");
    this.agentCapabilities = normalizeAgentCapabilities(agentCapabilities);
    this.authMethods = Array.isArray(authMethods) ? cloneJson(authMethods) : [];
    this.promptHandler = promptHandler;
    this.#idFactory = idFactory;
    this.#send = typeof send === "function" ? send : null;
    this.#onTransportError = typeof onTransportError === "function" ? onTransportError : null;
    this.#onEvent = typeof onEvent === "function" ? onEvent : null;
    this.#now = typeof now === "function" ? now : () => new Date().toISOString();
    this.#recordSessionUpdates = recordSessionUpdates === true;
    this.#sessionStore = sessionStore && typeof sessionStore === "object" ? sessionStore : new MemorySessionStore();
    this.#decoder = new NdjsonDecoder({ maxLineBytes });
  }

  get initialized() {
    return this.#initialized;
  }

  get clientCapabilities() {
    return cloneJson(this.#clientCapabilities);
  }

  get clientInfo() {
    return cloneJson(this.#clientInfo);
  }

  get sessions() {
    return new Map([...this.#sessions.entries()].map(([id, record]) => [id, cloneJson(record)]));
  }

  get pendingPermissionCount() {
    return this.#pendingPermissions.size;
  }

  getCapabilityMatrix() {
    const matrix = {};
    for (const [method, entry] of Object.entries(ACP_V1_CAPABILITY_MATRIX)) {
      matrix[method] = {
        ...entry,
        available:
          method === ACP_METHODS.LOAD_SESSION
            ? this.agentCapabilities.loadSession
            : method === ACP_METHODS.REQUEST_PERMISSION
              ? true
              : true,
      };
    }
    return matrix;
  }

  getNegotiation() {
    return {
      initialized: this.#initialized,
      protocolVersion: this.#initialized ? ACP_V1_PROTOCOL_VERSION : null,
      clientCapabilities: cloneJson(this.#clientCapabilities),
      agentCapabilities: cloneJson(this.agentCapabilities),
    };
  }

  /** Return and clear messages emitted outside a dispatch call. */
  drainOutbound() {
    const messages = this.#outbox.splice(0);
    return messages.map((message) => cloneJson(message));
  }

  /** Handle one parsed JSON-RPC message. */
  async dispatch(message) {
    const emitted = [];
    try {
      assertJsonRpcMessage(message);
      await this.#dispatchMessage(message, emitted);
    } catch (error) {
      const id = isObject(message) && hasRequestId(message) ? message.id : null;
      if (isObject(message) && hasRequestId(message)) this.#emit(makeJsonRpcErrorResponse(id, error), emitted);
      else if (isObject(message) && message.jsonrpc === "2.0" && typeof message.method === "string") {
        // JSON-RPC notifications never receive a response, including errors.
      } else {
        this.#emit(makeJsonRpcErrorResponse(null, error), emitted);
      }
    }
    return emitted.map((message) => cloneJson(message));
  }

  /** Handle one complete NDJSON line and return encoded outbound lines. */
  async dispatchLine(line) {
    try {
      const message = decodeNdjsonLine(line);
      return (await this.dispatch(message)).map((value) => encodeNdjson(value));
    } catch (error) {
      const response = makeJsonRpcErrorResponse(null, error);
      this.#emit(response);
      return [encodeNdjson(response)];
    }
  }

  /** Feed an arbitrary NDJSON chunk and return encoded responses/events. */
  async dispatchChunk(chunk) {
    let messages;
    try {
      messages = this.#decoder.push(chunk);
    } catch (error) {
      const response = makeJsonRpcErrorResponse(null, error);
      this.#emit(response);
      return [encodeNdjson(response)];
    }
    const output = [];
    for (const message of messages) output.push(...(await this.dispatch(message)).map((value) => encodeNdjson(value)));
    return output;
  }

  /** Flush a decoder at transport EOF; a partial line is a parse error. */
  async endChunk() {
    try {
      const messages = this.#decoder.end();
      const output = [];
      for (const message of messages) output.push(...(await this.dispatch(message)).map((value) => encodeNdjson(value)));
      return output;
    } catch (error) {
      const response = makeJsonRpcErrorResponse(null, error);
      this.#emit(response);
      return [encodeNdjson(response)];
    }
  }

  /** Emit an ACP session/update notification without touching a transport. */
  emitSessionUpdate(sessionId, update, { meta, collector, record = true } = {}) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new AcpError(`session does not exist: ${sessionId}`, {
      code: JSON_RPC_ERROR_CODES.SESSION_NOT_FOUND,
      data: { code: "SESSION_NOT_FOUND", sessionId },
    });
    if (!isObject(update) || typeof update.sessionUpdate !== "string") {
      throw new AcpProtocolError("session/update requires an update discriminator", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "SESSION_UPDATE_REQUIRED" },
      });
    }
    const params = { sessionId, update: cloneJson(update) };
    if (meta !== undefined) params._meta = cloneJson(meta);
    if (this.#recordSessionUpdates && record !== false) {
      if (!Array.isArray(session.history)) session.history = [];
      session.history.push(cloneJson(update));
      void this.#saveSession(session);
    }
    const message = { jsonrpc: "2.0", method: ACP_METHODS.UPDATE, params };
    this.#emit(message, collector);
    this.#event("session_update", { sessionId, update: cloneJson(update) });
    return cloneJson(message);
  }

  /**
   * Ask the ACP client for a permission decision. The returned promise settles
   * when a matching JSON-RPC response arrives, or with `{outcome:"cancelled"}`
   * when the session is cancelled.
   */
  requestPermission(sessionId, request, { signal, collector, timeoutMs = 0 } = {}) {
    if (!this.#initialized) {
      return Promise.reject(new AcpError("initialize must complete before requesting permission", {
        code: JSON_RPC_ERROR_CODES.NOT_INITIALIZED,
        data: { code: "NOT_INITIALIZED" },
      }));
    }
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return Promise.reject(new AcpError(`session does not exist: ${sessionId}`, {
        code: JSON_RPC_ERROR_CODES.SESSION_NOT_FOUND,
        data: { code: "SESSION_NOT_FOUND", sessionId },
      }));
    }
    const params = normalizePermissionRequest(sessionId, request);
    if (signal?.aborted || this.#activePrompts.get(sessionId)?.controller.signal.aborted) {
      return Promise.resolve({ outcome: "cancelled" });
    }
    const id = this.#uniqueId("permission");
    const key = idKey(id);
    const message = { jsonrpc: "2.0", id, method: ACP_METHODS.REQUEST_PERMISSION, params };
    return new Promise((resolve, reject) => {
      const pending = {
        id,
        key,
        sessionId,
        resolve,
        reject,
        timer: null,
        signal,
        collector,
        optionIds: new Set(params.options.map(option => option.optionId)),
      };
      this.#pendingPermissions.set(key, pending);
      if (signal?.addEventListener) {
        const abort = () => this.#settlePermission(key, { outcome: "cancelled" });
        pending.abortListener = abort;
        signal.addEventListener("abort", abort, { once: true });
      }
      if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
        pending.timer = setTimeout(() => this.#settlePermission(key, { outcome: "cancelled" }), timeoutMs);
      }
      this.#emit(message, collector);
      this.#event("permission_request", { sessionId, requestId: id });
    });
  }

  async #dispatchMessage(message, collector) {
    if (message.result !== undefined || message.error !== undefined) {
      await this.#handleResponse(message);
      return;
    }
    const method = message.method;
    if (!this.#initialized && method !== ACP_METHODS.INITIALIZE) {
      throw new AcpError("initialize must be the first ACP request", {
        code: JSON_RPC_ERROR_CODES.NOT_INITIALIZED,
        data: { code: "NOT_INITIALIZED", requiredMethod: ACP_METHODS.INITIALIZE },
      });
    }
    switch (method) {
      case ACP_METHODS.INITIALIZE:
        await this.#initialize(message, collector);
        return;
      case ACP_METHODS.NEW_SESSION:
        await this.#newSession(message, collector);
        return;
      case ACP_METHODS.LOAD_SESSION:
        await this.#loadSession(message, collector);
        return;
      case ACP_METHODS.PROMPT:
        await this.#prompt(message, collector);
        return;
      case ACP_METHODS.CANCEL:
        await this.#cancel(message, collector);
        return;
      case ACP_METHODS.UPDATE:
      case ACP_METHODS.REQUEST_PERMISSION:
        throw new AcpProtocolError(`${method} is an agent-to-client message`, {
          code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
          data: { code: "WRONG_DIRECTION", method },
        });
      default:
        throw new AcpUnsupportedMethodError(method, {
          reserved: ACP_V1_RESERVED_METHODS.includes(method),
          capabilityMatrix: this.getCapabilityMatrix()[method] ?? null,
        });
    }
  }

  async #initialize(message, collector) {
    assertRequestMessage(message, ACP_METHODS.INITIALIZE);
    if (this.#initialized) {
      throw new AcpProtocolError("initialize may only be called once per connection", {
        code: JSON_RPC_ERROR_CODES.INVALID_REQUEST,
        data: { code: "ALREADY_INITIALIZED" },
      });
    }
    const params = requireParamsObject(message.params, ACP_METHODS.INITIALIZE);
    const protocolVersion = normalizeProtocolVersion(params.protocolVersion);
    if (protocolVersion === null) {
      throw new AcpProtocolError("only ACP protocol version 1 is supported", {
        code: JSON_RPC_ERROR_CODES.UNSUPPORTED_PROTOCOL,
        data: { code: "UNSUPPORTED_PROTOCOL_VERSION", supported: [ACP_V1_PROTOCOL_VERSION], received: params.protocolVersion },
      });
    }
    this.#clientCapabilities = isObject(params.clientCapabilities) ? cloneJson(params.clientCapabilities) : {};
    this.#clientInfo = params.clientInfo === undefined || params.clientInfo === null ? undefined : cloneJson(params.clientInfo);
    this.#initialized = true;
    this.#event("initialized", this.getNegotiation());
    this.#emit(
      makeJsonRpcResultResponse(message.id, {
        protocolVersion: ACP_V1_PROTOCOL_VERSION,
        agentCapabilities: cloneJson(this.agentCapabilities),
        authMethods: cloneJson(this.authMethods),
        agentInfo: cloneJson(this.agentInfo),
      }),
      collector,
    );
  }

  async #newSession(message, collector) {
    assertRequestMessage(message, ACP_METHODS.NEW_SESSION);
    const params = requireParamsObject(message.params, ACP_METHODS.NEW_SESSION);
    assertAbsolutePath(params.cwd, "cwd");
    const additionalDirectories = normalizeAdditionalDirectories(params, this.agentCapabilities.sessionCapabilities.additionalDirectories);
    const mcpServers = normalizeMcpServers(params, this.agentCapabilities.mcpCapabilities);
    const sessionId = this.#uniqueId("session", idFactoryResult => idFactoryResult);
    const requested = {
      ...cloneJson(params),
      cwd: params.cwd,
      additionalDirectories,
      mcpServers,
      sessionId,
    };
    let record;
    if (typeof this.#sessionStore.create === "function") record = await this.#sessionStore.create(requested);
    record = normalizeSessionRecord(record ?? requested, sessionId, requested);
    record.sessionId = record.sessionId || sessionId;
    this.#sessions.set(record.sessionId, record);
    await this.#saveSession(record);
    const response = { sessionId: record.sessionId };
    if (record.modes !== undefined) response.modes = cloneJson(record.modes);
    if (record.configOptions !== undefined) response.configOptions = cloneJson(record.configOptions);
    if (record._meta !== undefined) response._meta = cloneJson(record._meta);
    this.#emit(makeJsonRpcResultResponse(message.id, response), collector);
    this.#event("session_created", { sessionId: record.sessionId, cwd: record.cwd });
  }

  async #loadSession(message, collector) {
    assertRequestMessage(message, ACP_METHODS.LOAD_SESSION);
    if (this.agentCapabilities.loadSession !== true) throw new AcpCapabilityError("agentCapabilities.loadSession");
    const params = requireParamsObject(message.params, ACP_METHODS.LOAD_SESSION);
    if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
      throw new AcpProtocolError("session/load requires sessionId", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "SESSION_ID_REQUIRED" },
      });
    }
    assertAbsolutePath(params.cwd, "cwd");
    const additionalDirectories = normalizeAdditionalDirectories(params, this.agentCapabilities.sessionCapabilities.additionalDirectories);
    const mcpServers = normalizeMcpServers(params, this.agentCapabilities.mcpCapabilities);
    let record = this.#sessions.get(params.sessionId);
    if (!record && typeof this.#sessionStore.load === "function") record = await this.#sessionStore.load(params.sessionId, params);
    if (!record) {
      throw new AcpError(`session does not exist: ${params.sessionId}`, {
        code: JSON_RPC_ERROR_CODES.SESSION_NOT_FOUND,
        data: { code: "SESSION_NOT_FOUND", sessionId: params.sessionId },
      });
    }
    record = normalizeSessionRecord(record, params.sessionId, { ...params, additionalDirectories, mcpServers });
    if (record.cwd !== params.cwd) {
      throw new AcpProtocolError("session/load cwd must match the original session cwd", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "SESSION_CWD_MISMATCH", sessionId: params.sessionId },
      });
    }
    record.additionalDirectories = additionalDirectories;
    record.mcpServers = mcpServers;
    this.#sessions.set(params.sessionId, record);
    await this.#saveSession(record);
    const response = {};
    if (record.modes !== undefined) response.modes = cloneJson(record.modes);
    if (record.configOptions !== undefined) response.configOptions = cloneJson(record.configOptions);
    if (record._meta !== undefined) response._meta = cloneJson(record._meta);
    this.#emit(makeJsonRpcResultResponse(message.id, response), collector);
    // Replay only explicitly stored protocol updates. No filesystem/session
    // access is performed by this package.
    const history = Array.isArray(record.history) ? cloneJson(record.history) : [];
    for (const update of history) {
      if (isObject(update) && typeof update.sessionUpdate === "string") {
        this.emitSessionUpdate(params.sessionId, update, { collector, record: false });
      }
    }
    this.#event("session_loaded", { sessionId: params.sessionId, cwd: record.cwd });
  }

  async #prompt(message, collector) {
    assertRequestMessage(message, ACP_METHODS.PROMPT);
    const params = requireParamsObject(message.params, ACP_METHODS.PROMPT);
    if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
      throw new AcpProtocolError("session/prompt requires sessionId", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "SESSION_ID_REQUIRED" },
      });
    }
    const session = this.#sessions.get(params.sessionId);
    if (!session) {
      throw new AcpError(`session does not exist: ${params.sessionId}`, {
        code: JSON_RPC_ERROR_CODES.SESSION_NOT_FOUND,
        data: { code: "SESSION_NOT_FOUND", sessionId: params.sessionId },
      });
    }
    validatePromptBlocks(params.prompt, this.agentCapabilities.promptCapabilities);
    if (this.#activePrompts.has(params.sessionId)) {
      throw new AcpError("only one prompt may run per session", {
        code: JSON_RPC_ERROR_CODES.PROMPT_IN_PROGRESS,
        data: { code: "PROMPT_IN_PROGRESS", sessionId: params.sessionId },
      });
    }
    const controller = makeAbortController();
    const active = { controller, requestId: message.id, collector, cancelled: false };
    this.#activePrompts.set(params.sessionId, active);
    this.#event("prompt_started", { sessionId: params.sessionId });
    let result;
    try {
      result = await this.promptHandler({
        session: cloneJson(session),
        prompt: cloneJson(params.prompt),
        signal: controller.signal,
        emit: (update, options = {}) => this.emitSessionUpdate(params.sessionId, update, { ...options, collector }),
        requestPermission: (request, options = {}) =>
          this.requestPermission(params.sessionId, request, { ...options, signal: options.signal ?? controller.signal, collector }),
        isCancelled: () => controller.signal.aborted,
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        controller.abort();
        for (const [key, pending] of this.#pendingPermissions.entries()) {
          if (pending.sessionId === params.sessionId) this.#settlePermission(key, { outcome: "cancelled" });
        }
        this.#emit(makeJsonRpcErrorResponse(message.id, error), collector);
        this.#event("prompt_failed", { sessionId: params.sessionId, error: normalizeError(error) });
        this.#activePrompts.delete(params.sessionId);
        return;
      }
      result = { stopReason: "cancelled" };
    }
    const stopReason = controller.signal.aborted ? "cancelled" : normalizeStopReason(result?.stopReason);
    const response = { stopReason };
    if (isObject(result) && result._meta !== undefined) response._meta = cloneJson(result._meta);
    this.#emit(makeJsonRpcResultResponse(message.id, response), collector);
    this.#activePrompts.delete(params.sessionId);
    this.#event("prompt_finished", { sessionId: params.sessionId, stopReason });
  }

  async #cancel(message, collector) {
    const params = requireParamsObject(message.params, ACP_METHODS.CANCEL);
    if (typeof params.sessionId !== "string" || params.sessionId.length === 0) {
      throw new AcpProtocolError("session/cancel requires sessionId", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "SESSION_ID_REQUIRED" },
      });
    }
    const session = this.#sessions.get(params.sessionId);
    if (!session) {
      throw new AcpError(`session does not exist: ${params.sessionId}`, {
        code: JSON_RPC_ERROR_CODES.SESSION_NOT_FOUND,
        data: { code: "SESSION_NOT_FOUND", sessionId: params.sessionId },
      });
    }
    const active = this.#activePrompts.get(params.sessionId);
    if (active) {
      active.cancelled = true;
      active.controller.abort();
    }
    for (const [key, pending] of this.#pendingPermissions.entries()) {
      if (pending.sessionId === params.sessionId) this.#settlePermission(key, { outcome: "cancelled" });
    }
    // ACP v1 defines session/cancel as a notification. If a caller sends an
    // id for an acknowledgement, accepting it is a narrow compatibility
    // extension and does not change the canonical notification behavior.
    if (hasRequestId(message)) this.#emit(makeJsonRpcResultResponse(message.id, {}), collector);
    this.#event("prompt_cancel_requested", { sessionId: params.sessionId });
  }

  async #handleResponse(message) {
    const pending = this.#pendingPermissions.get(idKey(message.id));
    if (!pending) return;
    if (message.error !== undefined) {
      const responseCode = Number.isInteger(message.error.code)
        ? message.error.code
        : JSON_RPC_ERROR_CODES.INTERNAL_ERROR;
      this.#settlePermission(idKey(message.id), undefined, new AcpProtocolError("permission request failed", {
        code: responseCode,
        data: { code: "PERMISSION_RESPONSE_ERROR", error: cloneJson(message.error) },
      }));
      return;
    }
    const result = message.result;
    if (!isObject(result) || !isObject(result.outcome) || typeof result.outcome.outcome !== "string") {
      this.#settlePermission(idKey(message.id), undefined, new AcpProtocolError("permission response is invalid", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "INVALID_PERMISSION_RESPONSE" },
      }));
      return;
    }
    if (result.outcome.outcome === "selected" && typeof result.outcome.optionId !== "string") {
      this.#settlePermission(idKey(message.id), undefined, new AcpProtocolError("selected permission response requires optionId", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "PERMISSION_OPTION_ID_REQUIRED" },
      }));
      return;
    }
    if (result.outcome.outcome === "selected" && !pending.optionIds.has(result.outcome.optionId)) {
      this.#settlePermission(idKey(message.id), undefined, new AcpProtocolError("permission optionId was not offered", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "UNKNOWN_PERMISSION_OPTION_ID" },
      }));
      return;
    }
    if (!["selected", "cancelled"].includes(result.outcome.outcome)) {
      this.#settlePermission(idKey(message.id), undefined, new AcpProtocolError("permission outcome is invalid", {
        code: JSON_RPC_ERROR_CODES.INVALID_PARAMS,
        data: { code: "INVALID_PERMISSION_OUTCOME" },
      }));
      return;
    }
    this.#settlePermission(idKey(message.id), cloneJson(result.outcome));
  }

  #settlePermission(key, value, error) {
    const pending = this.#pendingPermissions.get(key);
    if (!pending) return;
    this.#pendingPermissions.delete(key);
    if (pending.timer !== null) clearTimeout(pending.timer);
    if (pending.signal?.removeEventListener && pending.abortListener) pending.signal.removeEventListener("abort", pending.abortListener);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  async #saveSession(record) {
    if (typeof this.#sessionStore.save !== "function") return;
    try {
      await this.#sessionStore.save(cloneJson(record));
    } catch (error) {
      this.#event("session_store_error", { operation: "save", error: normalizeError(error) });
    }
  }

  #uniqueId(kind, transform = value => value) {
    let candidate = transform(this.#idFactory(kind));
    let key = idKey(candidate);
    for (let attempts = 0; (kind === "session" && this.#sessions.has(candidate)) || (kind === "permission" && this.#pendingPermissions.has(key)); attempts += 1) {
      if (attempts >= 100) {
        throw new AcpError(`could not allocate a unique ${kind} id`, {
          code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
          data: { code: "ID_ALLOCATION_EXHAUSTED", kind },
        });
      }
      candidate = transform(this.#idFactory(kind));
      key = idKey(candidate);
    }
    if ((kind === "session" && (typeof candidate !== "string" || candidate.length === 0)) || candidate === undefined) {
      throw new AcpError(`idFactory returned an invalid ${kind} id`, {
        code: JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
        data: { code: "INVALID_GENERATED_ID", kind },
      });
    }
    return candidate;
  }

  #emit(message, collector) {
    const copy = cloneJson(message);
    this.#outbox.push(copy);
    if (collector) collector.push(cloneJson(copy));
    if (this.#send) {
      try {
        const result = this.#send(cloneJson(copy));
        if (result && typeof result.catch === "function") result.catch(error => this.#transportError(error));
      } catch (error) {
        this.#transportError(error);
      }
    }
  }

  #transportError(error) {
    if (!this.#onTransportError) return;
    try {
      this.#onTransportError(error);
    } catch {
      // An observer must not alter protocol dispatch or hide the original
      // transport failure.
    }
  }

  #event(type, data) {
    if (!this.#onEvent) return;
    try {
      this.#onEvent({ type, data: cloneJson(data), at: this.#now() });
    } catch {
      // Observability is intentionally best-effort and cannot change ACP
      // responses or prompt cancellation semantics.
    }
  }
}

export function createAcpV1Adapter(options) {
  return new AcpV1Adapter(options);
}
