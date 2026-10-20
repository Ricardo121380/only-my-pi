import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import WebSocket from "ws";
import { startHost } from "../packages/host/server.mjs";
import { ApprovalBridge } from "../packages/host/approval-bridge.mjs";

class FakeWorker extends EventEmitter {
  constructor() { super(); this.identity = { pid: 99999999, start: "fixture" }; this.closed = false; }
  async start() { return { sessionId: randomUUID() }; }
  async command(type) {
    if (type === "prompt") {
      this.emit("event", { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "分析进行中" } });
      this.timer = setTimeout(() => { this.emit("event", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "只读分析完成" }] } }); this.emit("event", { type: "agent_settled" }); }, 80);
    }
    return {};
  }
  async cancel() { this.emit("event", { type: "agent_settled" }); await this.stop(); }
  async stop() { clearTimeout(this.timer); if (!this.closed) { this.closed = true; this.emit("exit", { code: 0 }); } }
}
async function fixture(t, overrides = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-host-test-")));
  const configRoot = path.join(root, "config"), assetsRoot = path.join(root, "assets"), project = path.join(root, "project");
  await fs.mkdir(assetsRoot); await fs.mkdir(project); await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>fixture</title>");
  await fs.writeFile(path.join(project, "README.md"), "# fixture\n");
  let launches = 0;
  const options = { configRoot, assetsRoot, stack: { stackId: `sha256:${"a".repeat(64)}` }, modelsProvider: async () => [{ id: "mock/test", name: "Fixture", provider: "mock" }], workerFactory: () => { launches++; return new FakeWorker(); }, ...overrides };
  let host = await startHost(options);
  t.after(async () => { await host.stop(); await fs.rm(root, { recursive: true, force: true }); });
  async function pair() {
    const token = new URL(host.pairingUrl).hash.slice(6);
    const r = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
    assert.equal(r.status, 200); return r.headers.get("set-cookie").split(";")[0];
  }
  let cookie = await pair();
  const request = (route, data, extra = {}) => fetch(host.origin + route, { method: data ? "POST" : "GET", headers: { Origin: host.origin, Cookie: cookie, ...(data ? { "content-type": "application/json", "x-omp-host-protocol": "2" } : {}), ...extra }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { root, project, configRoot, options, get host() { return host; }, get cookie() { return cookie; }, request, launches: () => launches,
    async restart() { await host.stop(); host = await startHost(options); cookie = await pair(); } };
}
async function waitTask(f, id, expected) {
  for (let i = 0; i < 100; i++) { const task = await (await f.request(`/api/task?taskId=${id}`)).json(); if (expected.includes(task.status)) return task; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error("task did not settle");
}
test("loopback host authenticates HTTP, consumes pairing once and rejects cross-origin writes", async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.host.origin + "/api/state")).status, 401);
  assert.equal((await f.request("/api/state")).status, 200);
  const token = new URL(f.host.pairingUrl).hash.slice(6);
  assert.equal((await f.request("/pair", { token })).status, 403);
  assert.equal((await f.request("/api/command", { type: "addProject", path: f.project }, { Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await f.request("/api/command", { type: "bash", command: "echo unsafe" })).status, 400);
  const state = await (await f.request("/api/state")).json();
  assert.equal(JSON.stringify(state).includes(f.host.controlToken), false);
  const stat = await fs.stat(path.join(f.configRoot, "only-my-pi/host/endpoint.json")); assert.equal(stat.mode & 0o777, 0o600);
  await assert.rejects(startHost(f.options), { code: "OWNERSHIP_HELD" });
});

test("controlled HTTP approvals are authenticated, one-use and invalidated by revoke", async (t) => {
  let worker;
  class ControlledWorker extends FakeWorker {
    constructor() {
      super(); this.answers = [];
      this.bridge = new ApprovalBridge({ send: (answer) => this.answers.push(answer), publish: (approvals) => this.emit("approvals", approvals) });
    }
    async command(type) {
      if (type === "prompt") this.bridge.request({ id: "private-pi-id", method: "confirm", title: "Verify fixture", message: "Only this fixture" });
      return {};
    }
    answerApproval(id, value) { this.bridge.answer(id, value); }
    async revoke() { this.bridge.invalidate(); }
    async stop() { this.bridge.close(); await super.stop(); }
  }
  const f = await fixture(t, { allowControlled: true, workerFactory: () => (worker = new ControlledWorker()) });
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  const task = await (await f.request("/api/command", { type: "startTask", requestId: "controlled-http", projectId: project.projectId, accountId: "cli-readonly", model: "mock/test", prompt: "fixture", mode: "controlled" })).json();
  const running = await waitTask(f, task.taskId, ["running"]);
  assert.equal(running.approvals.length, 1);
  assert.equal(JSON.stringify(running).includes("private-pi-id"), false);
  const answer = { type: "answerApproval", taskId: task.taskId, approvalId: running.approvals[0].approvalId, value: true };
  assert.equal((await f.request("/api/command", answer, { Cookie: "" })).status, 401);
  assert.equal((await f.request("/api/command", answer, { Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await f.request("/api/command", answer, { "x-omp-host-protocol": "1" })).status, 409);
  assert.equal((await f.request("/api/command", { ...answer, unrestricted: true })).status, 400);
  assert.equal(worker.answers.length, 0);
  assert.equal((await f.request("/api/command", answer)).status, 200);
  assert.equal((await f.request("/api/command", answer)).status, 409);
  assert.deepEqual(worker.answers, [{ type: "extension_ui_response", id: "private-pi-id", confirmed: true }]);
  worker.bridge.request({ id: "next-private-id", method: "confirm", title: "Second" });
  const stale = worker.bridge.snapshot()[0].approvalId;
  assert.equal((await f.request("/api/command", { type: "revokeTask", taskId: task.taskId })).status, 200);
  assert.equal((await f.request("/api/command", { ...answer, approvalId: stale })).status, 409);
  assert.equal(worker.answers.at(-1).cancelled, true);
  await f.request("/api/command", { type: "cancelTask", taskId: task.taskId });
  await waitTask(f, task.taskId, ["cancelled"]);
  assert.equal((await f.request("/api/command", answer)).status, 409);
});

test("ordinary host refuses controlled tasks before launching a worker", async (t) => {
  const f = await fixture(t);
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  const result = await f.request("/api/command", { type: "startTask", requestId: "closed", projectId: project.projectId, accountId: "cli-readonly", model: "mock/test", prompt: "fixture", mode: "controlled" });
  assert.equal(result.status, 409);
  assert.equal((await result.json()).code, "CONTROLLED_MODE_UNAVAILABLE");
  assert.equal(f.launches(), 0);
});
test("project inspector rejects escapes and symlinks, and never offers writes", async (t) => {
  const f = await fixture(t);
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  await fs.symlink(f.root, path.join(f.project, "escape"));
  assert.equal((await f.request(`/api/file?projectId=${project.projectId}&path=README.md`)).status, 200);
  assert.equal((await f.request(`/api/file?projectId=${project.projectId}&path=../outside`)).status, 403);
  assert.equal((await f.request(`/api/files?projectId=${project.projectId}&path=escape`)).status, 403);
  assert.equal((await f.request(`/api/file?projectId=${project.projectId}&path=.env`)).status, 403);
  assert.equal((await f.request("/api/command", { type: "startTask", requestId: "a", projectId: project.projectId, model: "mock/test", prompt: "read", permission: "write" })).status, 400);
});
test("account metadata API requires pairing, origin and explicit protocol without accepting secrets", async (t) => {
  const f = await fixture(t);
  const input = { providerId: "mock", name: "First", authType: "api_key" };
  const headers = { "x-omp-account-protocol": "1" };
  assert.equal((await fetch(f.host.origin + "/api/accounts")).status, 401);
  assert.equal((await f.request("/api/accounts", input)).status, 409);
  assert.equal((await f.request("/api/accounts", input, { ...headers, Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await f.request("/api/accounts", { ...input, apiKey: "never-persist" }, headers)).status, 400);
  const a = await f.request("/api/accounts", input, headers);
  assert.equal(a.status, 201);
  const first = await a.json();
  assert.equal(first.authentication, "not_connected");
  const second = await (await f.request("/api/accounts", { ...input, name: "Second" }, headers)).json();
  assert.notEqual(first.account.accountId, second.account.accountId);
  await f.restart();
  const listing = await (await f.request("/api/accounts")).json();
  assert.deepEqual(listing.accounts, [first.account, second.account]);
  assert.equal(JSON.stringify(listing).includes("never-persist"), false);
  assert.equal(f.launches(), 0);
  const missing = await f.request("/api/models?accountId=missing");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "ACCOUNT_NOT_FOUND");
  await assert.rejects(fs.access(path.join(f.configRoot, "auth.json")), { code: "ENOENT" });
});
test("tasks deduplicate, cancel to a real terminal state and do not replay after restart", async (t) => {
  const f = await fixture(t);
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  const input = { type: "startTask", requestId: "test-request", projectId: project.projectId, accountId: "cli-readonly", model: "mock/test", prompt: "只读分析" };
  const [first, repeated] = await Promise.all([f.request("/api/command", input).then((r) => r.json()), f.request("/api/command", input).then((r) => r.json())]);
  assert.equal(first.taskId, repeated.taskId);
  await f.request("/api/command", { type: "cancelTask", taskId: first.taskId });
  assert.equal((await waitTask(f, first.taskId, ["cancelled", "failed"])).status, "cancelled");
  assert.equal(f.launches(), 1);
  await f.restart();
  assert.equal((await (await f.request("/api/command", input)).json()).taskId, first.taskId);
  assert.equal(f.launches(), 1);
});
test("invalid project does not prevent a later task or retry", async (t) => {
  const f = await fixture(t);
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  const invalid = await f.request("/api/command", { type: "addProject", path: path.join(f.root, "missing") });
  assert.equal((await invalid.json()).code, "ENOENT");
  const input = { type: "startTask", requestId: "after-invalid", projectId: project.projectId, accountId: "cli-readonly", model: "mock/test", prompt: "只读分析" };
  const rejected = await f.request("/api/command", { ...input, model: "missing/model" });
  assert.equal((await rejected.json()).code, "MODEL_UNAVAILABLE");
  const result = await f.request("/api/command", input);
  assert.equal(result.status, 202);
  const task = await result.json();
  assert.equal((await waitTask(f, task.taskId, ["succeeded", "failed"])).status, "succeeded");
  assert.equal(f.launches(), 1);
});
test("WebSocket requires auth, Origin and protocol; reconnect begins with an authoritative snapshot", async (t) => {
  const f = await fixture(t);
  const url = f.host.origin.replace("http:", "ws:") + "/events?protocol=2";
  const denied = new WebSocket(url, { headers: { Origin: f.host.origin } });
  const [error] = await once(denied, "error"); assert.match(error.message, /403/u);
  const socket = new WebSocket(url, { headers: { Origin: f.host.origin, Cookie: f.cookie } });
  const [data] = await once(socket, "message"); const snapshot = JSON.parse(data.toString());
  assert.equal(snapshot.type, "snapshot"); assert.equal(snapshot.epoch, f.host.epoch);
  socket.close(); await once(socket, "close");
  const reconnect = new WebSocket(url, { headers: { Origin: f.host.origin, Cookie: f.cookie } });
  const [next] = await once(reconnect, "message"); assert.equal(JSON.parse(next.toString()).type, "snapshot");
  reconnect.close(); await once(reconnect, "close");
});

test("public account binding rejects old protocol, missing identity and CLI mutations", async (t) => {
  const f = await fixture(t);
  const project = await (await f.request("/api/command", { type: "addProject", path: f.project })).json();
  const input = { type: "startTask", requestId: "bound", projectId: project.projectId, model: "mock/test", prompt: "inspect" };
  assert.equal((await f.request("/api/command", input, { "x-omp-host-protocol": "1" })).status, 409);
  assert.equal((await f.request("/api/command", input)).status, 400);
  assert.equal((await f.request("/api/models")).status, 409);
  const headers = { "x-omp-account-protocol": "1" };
  for (const action of [{ type: "rename", name: "Changed" }, { type: "remove" }, { type: "logout" }]) {
    const response = await f.request("/api/account-action", { accountId: "cli-readonly", action }, headers);
    assert.equal(response.status, 403); assert.equal((await response.json()).code, "ACCOUNT_READ_ONLY");
  }
  const { account } = await (await f.request("/api/accounts", { providerId: "mock", name: "GUI", authType: "api_key" }, headers)).json();
  const response = await f.request("/api/command", { ...input, accountId: account.accountId });
  assert.equal(response.status, 202);
  const task = await response.json(); assert.equal(task.accountId, account.accountId);
  assert.equal((await f.request("/api/account-action", { accountId: account.accountId, action: { type: "remove" } }, headers)).status, 409);
  await waitTask(f, task.taskId, ["succeeded"]);
  // The terminal projection is delivered only after worker exit and account release.
  assert.equal((await f.request("/api/account-action", { accountId: account.accountId, action: { type: "rename", name: "Released" } }, headers)).status, 200);
  assert.equal((await f.request("/api/command", { ...input, accountId: "cli-readonly" })).status, 409);
  const oldSocket = new WebSocket(f.host.origin.replace("http:", "ws:") + "/events?protocol=1", { headers: { Origin: f.host.origin, Cookie: f.cookie } });
  assert.match((await once(oldSocket, "error"))[0].message, /403/u);
});
