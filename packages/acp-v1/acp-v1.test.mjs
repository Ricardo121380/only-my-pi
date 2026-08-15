import assert from "node:assert/strict";
import test from "node:test";
import {
  ACP_METHODS,
  ACP_V1_CAPABILITY_MATRIX,
  AcpV1Adapter,
  JSON_RPC_ERROR_CODES,
  MemorySessionStore,
  NdjsonDecoder,
  decodeNdjsonLine,
  encodeNdjson,
} from "./index.mjs";

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, params });
const notify = (method, params) => ({ jsonrpc: "2.0", method, params });

async function initialized(options = {}) {
  const adapter = new AcpV1Adapter({ idFactory: (() => {
    let n = 0;
    return kind => `${kind}-${++n}`;
  })(), ...options });
  const [init] = await adapter.dispatch(rpc(1, ACP_METHODS.INITIALIZE, {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true }, terminal: false },
    clientInfo: { name: "deterministic-test", version: "1" },
  }));
  assert.equal(init.result.protocolVersion, 1);
  const [created] = await adapter.dispatch(rpc(2, ACP_METHODS.NEW_SESSION, { cwd: "/tmp/only-my-pi", mcpServers: [] }));
  assert.equal(created.result.sessionId, "session-1");
  adapter.drainOutbound();
  return { adapter, sessionId: created.result.sessionId };
}

test("NDJSON codec frames messages and handles split UTF-8 chunks", () => {
  const line = encodeNdjson(rpc("x", "initialize", { protocolVersion: 1 }));
  assert.equal(line.endsWith("\n"), true);
  assert.deepEqual(decodeNdjsonLine(line.trim()), JSON.parse(line));
  const decoder = new NdjsonDecoder();
  const bytes = new TextEncoder().encode(line + encodeNdjson(notify("session/update", {})));
  assert.deepEqual(decoder.push(bytes.slice(0, 7)), []);
  const messages = decoder.push(bytes.slice(7));
  assert.equal(messages.length, 2);
  assert.equal(messages[0].method, "initialize");
  assert.equal(messages[1].method, "session/update");
  assert.deepEqual(decoder.end(), []);
});

test("initialize negotiates v1 and exposes the explicit capability matrix", async () => {
  const adapter = new AcpV1Adapter({ agentCapabilities: { loadSession: true } });
  const [response] = await adapter.dispatch(rpc(1, "initialize", { protocolVersion: "1" }));
  assert.equal(response.result.protocolVersion, 1);
  assert.equal(response.result.agentCapabilities.loadSession, true);
  assert.equal(adapter.getNegotiation().initialized, true);
  assert.equal(ACP_V1_CAPABILITY_MATRIX["session/cancel"].kind, "notification");
  assert.equal(adapter.getCapabilityMatrix()["session/load"].available, true);
  const [duplicate] = await adapter.dispatch(rpc(2, "initialize", { protocolVersion: 1 }));
  assert.equal(duplicate.error.code, JSON_RPC_ERROR_CODES.INVALID_REQUEST);
  assert.equal(duplicate.error.data.code, "ALREADY_INITIALIZED");
});

test("session/new validates an absolute cwd and rejects use before initialize", async () => {
  const before = new AcpV1Adapter();
  const [notReady] = await before.dispatch(rpc(1, "session/new", { cwd: "/tmp", mcpServers: [] }));
  assert.equal(notReady.error.code, JSON_RPC_ERROR_CODES.NOT_INITIALIZED);

  const { adapter } = await initialized();
  const [bad] = await adapter.dispatch(rpc(3, "session/new", { cwd: "relative", mcpServers: [] }));
  assert.equal(bad.error.code, JSON_RPC_ERROR_CODES.INVALID_PARAMS);
  assert.equal(bad.error.data.code, "ABSOLUTE_PATH_REQUIRED");
});

test("prompt emits ACP session updates and returns a v1 stop reason", async () => {
  const seen = [];
  const { adapter, sessionId } = await initialized({
    onEvent: event => seen.push(event.type),
    promptHandler: async ({ emit }) => {
      emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } });
      emit({ sessionUpdate: "tool_call", toolCallId: "tool-1", title: "read" });
      return { stopReason: "end_turn" };
    },
  });
  const output = await adapter.dispatch(rpc(3, "session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "hi" }],
  }));
  assert.equal(output[0].method, "session/update");
  assert.equal(output[0].params.update.sessionUpdate, "agent_message_chunk");
  assert.equal(output[1].params.update.sessionUpdate, "tool_call");
  assert.deepEqual(output.at(-1), { jsonrpc: "2.0", id: 3, result: { stopReason: "end_turn" } });
  assert.deepEqual(seen, ["initialized", "session_created", "prompt_started", "session_update", "session_update", "prompt_finished"]);
});

test("permission request round trip is an agent-to-client request", async () => {
  const { adapter, sessionId } = await initialized({
    promptHandler: async ({ requestPermission, emit }) => {
      const outcome = await requestPermission({
        toolCall: { toolCallId: "tool-1", title: "write file" },
        options: [{ optionId: "allow", name: "Allow once", kind: "allow_once" }],
      });
      emit({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: outcome.outcome } });
      return { stopReason: "end_turn" };
    },
  });
  const promptPromise = adapter.dispatch(rpc(3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "write" }] }));
  await new Promise(resolve => setImmediate(resolve));
  const request = adapter.drainOutbound().find(message => message.method === "session/request_permission");
  assert.ok(request);
  assert.equal(request.params.sessionId, sessionId);
  assert.equal(adapter.pendingPermissionCount, 1);
  const response = await adapter.dispatch({
    jsonrpc: "2.0",
    id: request.id,
    result: { outcome: { outcome: "selected", optionId: "allow" } },
  });
  assert.deepEqual(response, []);
  const output = await promptPromise;
  assert.equal(output.at(-1).result.stopReason, "end_turn");
  assert.equal(adapter.pendingPermissionCount, 0);
});

test("session/cancel aborts prompt and resolves pending permission as cancelled", async () => {
  let entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const { adapter, sessionId } = await initialized({
    promptHandler: async ({ requestPermission }) => {
      entered();
      const result = await requestPermission({
        toolCall: { toolCallId: "tool-1", title: "danger" },
        options: [{ optionId: "deny", name: "Deny", kind: "reject_once" }],
      });
      return { stopReason: result.outcome === "cancelled" ? "cancelled" : "end_turn" };
    },
  });
  const promptPromise = adapter.dispatch(rpc(3, "session/prompt", { sessionId, prompt: [{ type: "text", text: "cancel" }] }));
  await enteredPromise;
  await new Promise(resolve => setImmediate(resolve));
  const cancelOutput = await adapter.dispatch(notify("session/cancel", { sessionId }));
  assert.deepEqual(cancelOutput, []);
  const output = await promptPromise;
  assert.equal(output.at(-1).result.stopReason, "cancelled");
  assert.equal(adapter.pendingPermissionCount, 0);
});

test("loadSession is capability-gated and replays only stored update records", async () => {
  const store = new MemorySessionStore({ idFactory: (() => {
    let n = 0;
    return kind => `${kind}-persisted-${++n}`;
  })() });
  const first = await initialized({ agentCapabilities: { loadSession: true }, sessionStore: store });
  const update = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "history" } };
  first.adapter.emitSessionUpdate(first.sessionId, update);
  first.adapter.drainOutbound();
  const second = new AcpV1Adapter({ agentCapabilities: { loadSession: true }, sessionStore: store });
  await second.dispatch(rpc(1, "initialize", { protocolVersion: 1 }));
  const output = await second.dispatch(rpc(2, "session/load", {
    sessionId: first.sessionId,
    cwd: "/tmp/only-my-pi",
    mcpServers: [],
  }));
  assert.equal(output[0].result !== undefined, true);
  assert.equal(output[1].method, "session/update");
  assert.deepEqual(output[1].params.update, update);
  const persistedAfterReplay = await store.load(first.sessionId);
  assert.equal(persistedAfterReplay.history.length, 1);

  const unsupported = new AcpV1Adapter();
  await unsupported.dispatch(rpc(1, "initialize", { protocolVersion: 1 }));
  const [error] = await unsupported.dispatch(rpc(2, "session/load", {
    sessionId: "missing",
    cwd: "/tmp",
    mcpServers: [],
  }));
  assert.equal(error.error.code, JSON_RPC_ERROR_CODES.CAPABILITY_NOT_SUPPORTED);
});

test("unsupported content, methods, and wrong-direction messages are explicit", async () => {
  const { adapter, sessionId } = await initialized();
  const [image] = await adapter.dispatch(rpc(3, "session/prompt", {
    sessionId,
    prompt: [{ type: "image", data: "AA==", mimeType: "image/png" }],
  }));
  assert.equal(image.error.data.code, "CAPABILITY_NOT_SUPPORTED");
  const [unknown] = await adapter.dispatch(rpc(4, "session/list", {}));
  assert.equal(unknown.error.code, JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND);
  assert.equal(unknown.error.data.code, "UNSUPPORTED_METHOD");
  const [wrongDirection] = await adapter.dispatch(rpc(5, "session/update", {}));
  assert.equal(wrongDirection.error.data.code, "WRONG_DIRECTION");
});

test("malformed NDJSON yields a JSON-RPC parse error without leaking input", async () => {
  const adapter = new AcpV1Adapter();
  const [line] = await adapter.dispatchLine("{not-json");
  const response = JSON.parse(line);
  assert.equal(response.error.code, JSON_RPC_ERROR_CODES.PARSE_ERROR);
  assert.equal(response.error.data.code, "INVALID_JSON");
  assert.equal(line.includes("not-json"), false);
});
