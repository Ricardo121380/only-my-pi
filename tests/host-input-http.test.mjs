import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter, once } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { startHost } from "../packages/host/server.mjs";
import { findInputReceipt, INPUT_CARRIER } from "../packages/host/input-protocol.mjs";

test("input HTTP requires pairing, both versions and Origin; old clients and commands remain compatible", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-http-"))), assetsRoot = path.join(root, "assets"), configRoot = path.join(root, "config"), projectRoot = path.join(root, "project");
  await fs.mkdir(assetsRoot); await fs.mkdir(projectRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>fixture</title>");
  const host = await startHost({ assetsRoot, configRoot, stack: { stackId: "fixture" }, modelsProvider: async () => [] });
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const paired = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  const cookie = paired.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, Origin: host.origin, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" };
  const request = (route, data, extra = {}) => fetch(host.origin + route, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(data) });
  const project = await (await request("/api/command", { type: "addProject", path: projectRoot })).json();
  const command = { type: "getInputs", target: { projectId: project.projectId, sessionKey: null } };
  assert.equal((await request("/api/input-command", command, { Cookie: "" })).status, 401);
  assert.equal((await request("/api/input-command", command, { Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await request("/api/input-command", command, { "x-omp-host-protocol": "1" })).status, 409);
  assert.equal((await request("/api/input-command", command, { "x-omp-input-protocol": "" })).status, 409);
  assert.equal((await request("/api/input-command", { ...command, grant: "coding" })).status, 400);
  const read = await (await request("/api/input-command", command)).json(); assert.equal(read.protocol, 1); assert.equal(read.queue.items.length, 0);
  const state = await (await fetch(host.origin + "/api/state", { headers })).json(); assert.equal(state.protocol, 2); assert.equal(state.capabilities.inputs.protocol, 1); assert.equal(state.capabilities.inputs.materials, false);
  const old = new WebSocket(host.origin.replace("http", "ws") + "/events?protocol=2", { headers });
  const fresh = new WebSocket(host.origin.replace("http", "ws") + "/events?protocol=2&inputs=1", { headers });
  const oldMessages = [], freshMessages = [];
  old.on("message", (bytes) => oldMessages.push(JSON.parse(bytes))); fresh.on("message", (bytes) => freshMessages.push(JSON.parse(bytes)));
  await Promise.all([once(old, "open"), once(fresh, "open")]); t.after(() => { old.terminate(); fresh.terminate(); });
  const draft = { type: "saveDraft", target: command.target, expectedRevision: 0, input: { inputId: "draft", delivery: "prompt", text: "private text", materialSnapshotIds: [], binding: { accountId: "cli-readonly", modelId: "fixture/fixture", thinking: "off", mode: "readonly", resourceRevision: 0 } } };
  assert.equal((await request("/api/input-command", draft)).status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50)); assert.equal(oldMessages.some((message) => message.type === "inputs"), false);
  assert.equal(freshMessages.filter((message) => message.type === "inputs").length, 1); assert.equal(JSON.stringify(freshMessages).includes("private text"), false);
  await request("/api/command", { type: "addProject", path: projectRoot }); await new Promise((resolve) => setTimeout(resolve, 30));
  for (let index = 1; index < oldMessages.length; index++) assert.equal(oldMessages[index].seq, oldMessages[index - 1].seq + 1, "input-only events cannot create gaps for old clients");
  assert.equal((await request("/api/input-command", { ...draft, input: { ...draft.input, text: "x".repeat(270000) } })).status, 413);
  assert.equal((await request("/api/logout", {})).status, 200);
  assert.equal((await request("/api/input-command", command)).status, 401);
});
test("paired HTTP can submit a saved new-session draft once and inspect its real ledger receipt", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-http-submit-"))), assetsRoot = path.join(root, "assets"), configRoot = path.join(root, "config"), projectRoot = path.join(root, "project");
  await fs.mkdir(assetsRoot); await fs.mkdir(projectRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>fixture</title>");
  let launches = 0;
  class Worker extends EventEmitter {
    constructor(options) { super(); this.options = options; this.identity = { pid: 99999999, start: "fixture" }; }
    async start() {
      await fs.mkdir(this.options.sessionRoot, { recursive: true }); this.sessionId = randomUUID(); this.file = path.join(this.options.sessionRoot, `${this.sessionId}.jsonl`);
      await fs.writeFile(this.file, JSON.stringify({ type: "session", version: 3, id: this.sessionId, cwd: this.options.cwd, timestamp: new Date().toISOString() }) + "\n");
      return { sessionId: this.sessionId, thinkingLevel: "off" };
    }
    async command(type) { return type === "get_state" ? { thinkingLevel: "off" } : {}; }
    async deliverInput(item) {
      const entry = { type: "custom_message", id: randomUUID(), parentId: null, content: item.text, display: true, timestamp: new Date().toISOString(), customType: INPUT_CARRIER, details: { version: 1, inputId: item.inputId, taskId: item.taskId, scope: { projectId: item.projectId, sessionId: item.sessionId }, contentDigest: item.contentDigest } };
      await fs.appendFile(this.file, JSON.stringify(entry) + "\n");
      const receipt = findInputReceipt([entry], item); this.emit("input", receipt); this.timer = setTimeout(() => this.emit("event", { type: "agent_settled" }), 20);
      return { status: "consumed", receipt };
    }
    async cancel() { await this.stop(); }
    async stop() { clearTimeout(this.timer); if (!this.closed) { this.closed = true; this.emit("exit", { code: 0 }); } }
  }
  const host = await startHost({ assetsRoot, configRoot, stack: { stackId: "fixture" }, modelsProvider: async () => [{ id: "fixture/fixture", thinkingLevels: ["off"] }], workerFactory: (options) => { launches++; return new Worker(options); } });
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }); });
  const pair = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  const headers = { Cookie: pair.headers.get("set-cookie").split(";")[0], Origin: host.origin, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" };
  const post = (route, input) => fetch(host.origin + route, { method: "POST", headers, body: JSON.stringify(input) });
  const project = await (await post("/api/command", { type: "addProject", path: projectRoot })).json();
  const target = { projectId: project.projectId, sessionKey: null }, input = { inputId: "http-draft", delivery: "prompt", text: "HTTP draft sent once", materialSnapshotIds: [], binding: { accountId: "cli-readonly", modelId: "fixture/fixture", thinking: "off", mode: "readonly", resourceRevision: 0 } };
  const draft = await (await post("/api/input-command", { type: "saveDraft", target, input, expectedRevision: 0 })).json();
  const submitted = { type: "submitPrompt", target, requestId: "http-submit", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision };
  const first = await (await post("/api/input-command", submitted)).json(), duplicate = await (await post("/api/input-command", submitted)).json();
  assert.equal(first.taskId, duplicate.taskId); assert.equal(first.originDraftInputId, input.inputId);
  for (let index = 0; index < 200; index++) {
    const queue = await (await post("/api/input-command", { type: "getInputs", target: { projectId: project.projectId, taskId: first.taskId } })).json();
    if (queue.queue?.items?.[0]?.state === "consumed") { assert.equal(queue.queue.items[0].consumedEntryId?.length > 0, true); break; }
    if (index === 199) assert.fail("HTTP input never reached durable consumption");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(launches, 1); assert.equal((await (await post("/api/input-command", { type: "getInputs", target })).json()).draft.draft, null);
});
