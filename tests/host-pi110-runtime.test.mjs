import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { startHost } from "../packages/host/server.mjs";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";

function finish(res, content = "fixture done") {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [{ delta: { role: "assistant", content }, finish_reason: null }, { delta: {}, finish_reason: "stop" }])
    res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "one", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

function tool(res, name, args) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const choice of [
    { delta: { role: "assistant", tool_calls: [{ index: 0, id: randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null },
    { delta: {}, finish_reason: "tool_calls" },
  ]) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "one", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

async function until(read, accept, label, attempts = 200) {
  for (let i = 0; i < attempts; i++) {
    const value = await read();
    if (accept(value)) return value;
    await delay(25);
  }
  assert.fail(`Timed out: ${label}`);
}

// Only the Provider and audited external-package boundary are fixtures. The
// HTTP server, account catalog, task service, RpcWorker and Pi SDK are real.
async function fixture(t, respond, settingsOverrides = {}, { initializationDelayMs = 0, onWorker = () => {} } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-http-")));
  const configRoot = path.join(root, "config"), project = path.join(root, "project"), assetsRoot = path.join(root, "assets");
  await fs.mkdir(project); await fs.mkdir(assetsRoot); await fs.mkdir(configRoot);
  await fs.writeFile(path.join(assetsRoot, "index.html"), "<!doctype html><title>Pi source fixture</title>");
  await fs.writeFile(path.join(project, "README.md"), "only temporary project data\n");
  const settings = JSON.stringify({ cacheWarming: "idle", enableAnalytics: false, ...settingsOverrides });
  await fs.writeFile(path.join(configRoot, "settings.json"), settings);
  const received = [], connections = new Set();
  const provider = http.createServer(async (req, res) => {
    let text = ""; for await (const bytes of req) text += bytes;
    const request = { key: req.headers.authorization, body: JSON.parse(text), res, closed: false };
    res.on("close", () => { request.closed = true; });
    received.push(request);
    await respond(request, received);
  });
  provider.on("connection", (socket) => { connections.add(socket); socket.on("close", () => connections.delete(socket)); });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const piRoot = path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
  assert.equal(JSON.parse(await fs.readFile(path.join(piRoot, "package.json"), "utf8")).version, "1.3.0");
  await fs.symlink(piRoot, path.join(root, "pi"));
  const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  const extension = path.join(root, "provider.mjs");
  await fs.writeFile(extension, `export default pi => {
    pi.registerFlag("perm", { type: "string" });
    pi.registerProvider("fixture", { baseUrl: ${JSON.stringify(baseUrl)}, api: "openai-completions",
      models: [{ id: "one", name: "Fixture", input: ["text"], contextWindow: 32000, maxTokens: 128,
        promptCache: { short: 11 }, cost: { input: 100, output: 1, cacheRead: 0.1, cacheWrite: 100 } }] });
    // A controlled trigger overrides unavailable economics, so the absence of
    // warm requests cannot pass merely because this fixture is ineligible.
    pi.on("cache_warming_decision", () => ({ action: "warm" }));
  };`);
  const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "fixture", name: "Fixture A", authType: "api_key" });
  const paths = await accounts.runtimePaths(account.accountId);
  await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture-a" } }));
  await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl, api: "openai-completions", models: [{ id: "one", name: "Fixture", contextWindow: 32000, maxTokens: 128 }] } } }));
  const stack = { root, nodePath: process.execPath, piCliPath: "unused", stackId: `sha256:${"a".repeat(64)}` };
  const host = await startHost({ stack, configRoot, assetsRoot, allowControlled: true, env: { PATH: process.env.PATH, HOME: root, OPENAI_API_KEY: "ambient-must-not-run", FIXTURE_API_KEY: "ambient-must-not-run" },
    workerFactory: (options) => {
      const worker = new RpcWorker({ ...options, extensionResolver: async () => {
        if (initializationDelayMs) await delay(initializationDelayMs);
        return { extensions: [extension, fileURLToPath(new URL("../extensions/omp-direct/index.ts", import.meta.url)), fileURLToPath(new URL("../extensions/context-doctor/index.ts", import.meta.url))] };
      } });
      onWorker(worker); return worker;
    } });
  t.after(async () => {
    await host.stop();
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => provider.close(resolve));
    await writePiEvidence(t.name, { sdk: path.join(piRoot, "dist/index.js"), service: { baseUrl, source: "tests/host-pi110-runtime.test.mjs" },
      received: received.map(({ key, body, closed }) => ({ key, body, closed })), tasks: host.snapshot().tasks,
      sessionLeases: host.tasks.leases.size, accountReservations: host.tasks.accountReleases.size });
    await fs.rm(root, { recursive: true, force: true });
  });
  const paired = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get("set-cookie").split(";")[0];
  const request = (route, data) => fetch(host.origin + route, { method: data ? "POST" : "GET", headers: { Origin: host.origin, Cookie: cookie,
    ...(data ? { "content-type": "application/json", "x-omp-host-protocol": "2" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const command = async (data, status = 200) => { const response = await request("/api/command", data); assert.equal(response.status, status); return response.json(); };
  const added = await command({ type: "addProject", path: project });
  const start = (prompt, extra = {}) => command({ type: "startTask", requestId: randomUUID(), projectId: added.projectId, accountId: account.accountId, model: "fixture/one", prompt, ...extra }, 202);
  const task = async (id) => (await request(`/api/task?taskId=${id}`)).json();
  return { root, configRoot, project, projectId: added.projectId, account, paths, accounts, received, command, start, task, request, host, settings };
}

test("public Host and real Pi suppress warming even when a loaded extension requests it", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, async ({ res, body }) => {
    if (body.max_tokens === 1 || body.max_completion_tokens === 1) { finish(res, "warm request"); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"one","choices":[{"index":0,"delta":{"role":"assistant","content":"waiting"},"finish_reason":null}]}\n\n');
  });
  const started = await f.start("warming trigger");
  await until(() => f.received.length, (count) => count >= 1, "first Pi request");
  await delay(1800); // Real TTL=11s schedules its first warm at 1s.
  assert.equal(f.received.length, 1, "Provider must receive only the user request, including while streaming");
  assert.equal(f.received[0].key, "Bearer fixture-a");
  assert.deepEqual(f.received[0].body.tools.map((tool) => tool.function.name).sort(), ["codemode", "context_snapshot", "find", "grep", "ls", "read"]);
  const ack = await f.command({ type: "cancelTask", taskId: started.taskId }, 202);
  assert.equal(ack.status, "cancelling");
  const stopped = await until(() => f.task(started.taskId), (task) => task.status === "cancelled", "cancelled task");
  assert.equal(stopped.error, null);
  assert.deepEqual(stopped.approvals, []);
  await until(() => f.received[0].closed, Boolean, "Provider connection close");
  assert.equal(await fs.readFile(path.join(f.configRoot, "settings.json"), "utf8"), f.settings, "OMP policy must not rewrite raw Pi settings");
});

test("public Host fixes same-provider and CLI account identity, reads with real Pi, and rejects missing credentials/models without execution", { timeout: 20000 }, async (t) => {
  const f = await fixture(t, ({ res, body }) => {
    if (body.messages.some((message) => message.role === "tool")) finish(res, "read confirmed");
    else tool(res, "read", { path: "README.md" });
  });
  const second = await f.accounts.create({ providerId: "fixture", name: "Fixture B", authType: "api_key" });
  const secondPaths = await f.accounts.runtimePaths(second.accountId);
  const models = await fs.readFile(f.paths.modelsPath);
  await fs.writeFile(secondPaths.modelsPath, models);
  await fs.writeFile(secondPaths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "fixture-b" } }));
  await fs.writeFile(path.join(f.configRoot, "models.json"), models);
  await fs.writeFile(path.join(f.configRoot, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture-cli" } }));
  for (const [accountId, key] of [[f.account.accountId, "fixture-a"], [second.accountId, "fixture-b"], ["cli-readonly", "fixture-cli"]]) {
    const before = f.received.length;
    const started = await f.start("read README.md", { accountId });
    const completed = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "read completion");
    assert.equal(completed.status, "succeeded", JSON.stringify(completed));
    assert.equal(completed.accountId, accountId); assert.equal(completed.model, "fixture/one");
    const requests = f.received.slice(before);
    assert.equal(requests.length, 2, "one prompt and one tool-result continuation");
    assert.ok(requests.every((request) => request.key === `Bearer ${key}` && request.body.model === "one"));
    assert.match(JSON.stringify(requests[1].body.messages), /only temporary project data/);
    assert.deepEqual(requests[0].body.tools.map((entry) => entry.function.name).sort(), ["codemode", "context_snapshot", "find", "grep", "ls", "read"]);
  }
  const before = f.received.length;
  const bad = (extra) => f.command({ type: "startTask", requestId: randomUUID(), projectId: f.projectId, accountId: f.account.accountId, model: "fixture/one", prompt: "must not run", ...extra }, 409);
  assert.equal((await bad({ model: "other/one" })).code, "ACCOUNT_MODEL_MISMATCH");
  assert.equal((await bad({ model: "fixture/missing" })).code, "MODEL_UNAVAILABLE");
  await fs.rm(f.paths.authPath);
  assert.equal((await bad({})).code, "MODEL_UNAVAILABLE", "GUI must not borrow CLI or environment credentials");
  await fs.rm(path.join(f.configRoot, "auth.json"));
  // CLI discovery has a short catalog cache. An ACK may still be returned;
  // the actual worker must recheck credentials and fail before execution.
  const revoked = await f.start("must not borrow GUI credentials", { accountId: "cli-readonly" });
  await until(() => f.task(revoked.taskId), (task) => task.status === "failed", "revoked CLI worker failure");
  assert.equal(f.received.length, before, "wrong identity and revoked credentials must receive zero requests");
  const unpaired = await fetch(f.host.origin + "/api/command", { method: "POST", headers: { Origin: f.host.origin, "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify({ type: "addProject", path: f.project }) });
  assert.equal(unpaired.status, 401); assert.equal(f.received.length, before);
});

test("public Host distinguishes Pi provider failure from success", { timeout: 15000 }, async (t) => {
  const f = await fixture(t, ({ res }) => { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "fixture denied" } })); });
  const started = await f.start("fail once");
  const completed = await until(() => f.task(started.taskId), (task) => task.status === "failed", "provider failure");
  assert.equal(completed.error, "MODEL_REQUEST_FAILED");
  assert.equal(f.received.length, 1); assert.equal(f.received[0].key, "Bearer fixture-a");
  assert.deepEqual(completed.approvals, []);
});

for (const failure of ["disconnect", "503"]) test(`public Host does not resend a ${failure} response or borrow another account`, { timeout: 15000 }, async (t) => {
  const f = await fixture(t, ({ res }) => {
    if (failure === "disconnect") res.destroy();
    else { res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":{"message":"The service is temporarily unavailable"}}'); }
  }, { retry: { enabled: true, maxRetries: 2, baseDelayMs: 50 } });
  const started = await f.start("one uncertain request only");
  const completed = await until(() => f.task(started.taskId), (task) => task.status === "failed", "uncertain request stops");
  assert.equal(completed.error, "MODEL_REQUEST_FAILED");
  assert.equal(f.received.length, 1, "a received request with unknown/failure result must not be retried");
  assert.equal(f.received[0].key, "Bearer fixture-a");
  assert.equal(await fs.readFile(path.join(f.configRoot, "settings.json"), "utf8"), f.settings);
});

for (const { decision, suffix = "", delayedGrant = false, initializationDelayMs = 0 } of [
  { decision: "approve" }, { decision: "deny" }, { decision: "revoke" },
  { decision: "revoke", suffix: " with delayed grant event", delayedGrant: true },
  { decision: "revoke", suffix: " with slow initialization", initializationDelayMs: 8000 },
]) test(`public Host coding ${decision} is scoped to one project and worker lifetime${suffix}`, { timeout: 20000 }, async (t) => {
  let continueWrite;
  let releaseGrant;
  const writeGate = new Promise((resolve) => { continueWrite = resolve; });
  const access = { taskSummary: "Write fixture", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const f = await fixture(t, async ({ res, body }) => {
    const steps = body.messages.filter((message) => message.role === "tool").length;
    if (!steps) tool(res, "request_coding_access", access);
    else if (steps === 1) { if (decision === "revoke") await writeGate; tool(res, "write", { path: "proof.txt", content: "controlled\n" }); }
    else finish(res, "coding complete");
  }, {}, { initializationDelayMs, onWorker(worker) {
    if (!delayedGrant) return;
    const emit = worker.emit.bind(worker);
    worker.emit = (type, event, ...args) => {
      // Delay the actual SDK stdout event across the independent IPC revoke
      // acknowledgement; neither the grant nor its result is fabricated.
      if (type === "event" && event?.type === "tool_execution_end" && event.toolName === "request_coding_access") {
        assert.equal(releaseGrant, undefined);
        releaseGrant = () => emit(type, event, ...args); return true;
      }
      return emit(type, event, ...args);
    };
  } });
  t.after(() => continueWrite());
  const started = await f.start("write proof after approval", { mode: "controlled" });
  // The 202 response precedes worker readiness; wait for it separately.
  // Keep approval and completion polls at their original 200 x 25ms budget.
  const initialized = await until(() => f.task(started.taskId), (task) => task.status !== "starting", "coding worker initialized", 1200);
  assert.equal(initialized.status, "running", JSON.stringify(initialized));
  const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0, "coding approval");
  assert.equal(waiting.access, "inspect");
  await assert.rejects(fs.access(path.join(f.project, "proof.txt")), { code: "ENOENT" });
  assert.equal(f.received.length, 1, "no continuation before approval");
  const approval = waiting.approvals[0];
  assert.match(approval.title, new RegExp(f.project.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await f.command({ type: "answerApproval", taskId: started.taskId, approvalId: approval.approvalId, value: decision === "deny" ? "Deny" : approval.options[0] });
  if (decision === "revoke") {
    await until(() => f.received.length, (count) => count === 2, "post-grant request");
    if (delayedGrant) await until(() => releaseGrant, Boolean, "actual grant event captured");
    const revoked = await f.command({ type: "revokeTask", taskId: started.taskId });
    assert.equal(revoked.access, "inspect");
    if (delayedGrant) {
      releaseGrant();
      assert.equal((await f.task(started.taskId)).access, "inspect", "late grant result must not undo confirmed revoke");
    }
    continueWrite();
  }
  const completed = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "coding completion");
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.equal(f.received.length, 3, "access, write result, completion; no warming requests");
  assert.ok(f.received.every((request) => request.key === "Bearer fixture-a"));
  if (decision === "approve") assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "controlled\n");
  else { await assert.rejects(fs.access(path.join(f.project, "proof.txt")), { code: "ENOENT" }); assert.match(JSON.stringify(f.received.at(-1).body.messages), decision === "deny" ? /CODING_ACCESS_DENIED/ : /OMP_CODING_ACCESS_REQUIRED/); }
  assert.equal((await f.command({ type: "answerApproval", taskId: started.taskId, approvalId: approval.approvalId, value: approval.options[0] }, 409)).code, "APPROVAL_EXPIRED");
});
