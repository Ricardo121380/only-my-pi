import assert from "node:assert/strict";
import test from "node:test";

import { createPiSubagentsAdapter, PI_SUBAGENTS_EVENTS, PI_SUBAGENTS_REQUIRED_CAPABILITIES } from "../packages/pi-subagents-adapter/index.mjs";
import { createSwarmRecipeRegistry, admitSwarm, compileSwarmRequest } from "../packages/swarm-core/index.mjs";

function pingReply(requestId, capabilities = PI_SUBAGENTS_REQUIRED_CAPABILITIES) {
  return {
    version: 1, requestId, success: true,
    data: { version: 1, methods: ["ping", "status", "spawn", "steer", "interrupt", "stop", "resume"], capabilities, events: PI_SUBAGENTS_EVENTS, session: {} },
  };
}

async function compiledResearch() {
  const registry = createSwarmRecipeRegistry({ rootDir: process.cwd() });
  const entry = await registry.resolve("research-synthesis");
  const admission = await admitSwarm(entry, { runtimeCapabilities: {}, depth: 0 });
  return compileSwarmRequest(entry, admission, { requestId: "compiled-research" });
}

test("adapter performs audited ping negotiation before spawn", async () => {
  const calls = [];
  const transport = { async request(envelope) { calls.push(envelope); return envelope.method === "ping" ? pingReply(envelope.requestId) : { version: 1, requestId: envelope.requestId, success: true, data: { runId: "child-1" } }; } };
  const adapter = createPiSubagentsAdapter({ transport, idFactory: (prefix) => `${prefix}-fixed` });
  const compiled = await compiledResearch();
  const result = await adapter.spawn(compiled);
  assert.equal(result.status, "ACCEPTED");
  assert.deepEqual(calls.map((entry) => entry.method), ["ping", "spawn"]);
  assert.equal(calls[1].params.async, true);
  assert.equal(calls[1].params.agent, undefined);
  assert.equal(calls[1].params.task, undefined);
});

test("adapter rejects a capability downgrade before any child spawn", async () => {
  let spawned = false;
  const transport = { async request(envelope) { if (envelope.method === "ping") return pingReply(envelope.requestId, { ...PI_SUBAGENTS_REQUIRED_CAPABILITIES, asyncSpawn: false }); spawned = true; return { version: 1, requestId: envelope.requestId, success: true, data: {} }; } };
  const adapter = createPiSubagentsAdapter({ transport, requiredCapabilities: PI_SUBAGENTS_REQUIRED_CAPABILITIES });
  const compiled = await compiledResearch();
  await assert.rejects(() => adapter.spawn(compiled), /insufficient/);
  assert.equal(spawned, false);
});

test("adapter completion path requires terminal proof and stop is explicit", async () => {
  const calls = [];
  const transport = {
    async request(envelope) { calls.push(envelope); if (envelope.method === "ping") return pingReply(envelope.requestId); return { version: 1, requestId: envelope.requestId, success: true, data: { runId: "r" } }; },
    async waitForCompletion() { return { status: "COMPLETED", items: [{ nodeId: "x", status: "completed", result: { verdict: "pass" } }] }; },
  };
  const adapter = createPiSubagentsAdapter({ transport });
  const compiled = await compiledResearch();
  const result = await adapter.execute(compiled, { runId: "r" });
  assert.equal(result.status, "COMPLETED");
  await adapter.stop("r");
  assert.deepEqual(calls.map((entry) => entry.method), ["ping", "spawn", "stop"]);
});

test("adapter fails closed on malformed replies and event map drift", async () => {
  const malformed = createPiSubagentsAdapter({ transport: { async request(envelope) { return { version: 1, requestId: envelope.requestId, success: true, data: { version: 1, methods: [], capabilities: {}, events: {} } }; } } });
  await assert.rejects(() => malformed.negotiate(), /does not advertise/);
  const drift = createPiSubagentsAdapter({ transport: { async request(envelope) { return pingReply(envelope.requestId, PI_SUBAGENTS_REQUIRED_CAPABILITIES); } } });
  drift.transport.request = async (envelope) => envelope.method === "ping" ? { ...pingReply(envelope.requestId), data: { ...pingReply(envelope.requestId).data, events: { ...PI_SUBAGENTS_EVENTS, ready: "wrong" } } } : null;
  await assert.rejects(() => drift.negotiate(), /event map differs/);
});
