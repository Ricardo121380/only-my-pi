import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { groupAlive, processIdentity } from "../packages/host/ownership.mjs";

async function until(check) { for (let i = 0; i < 600; i++) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("CRASH_FIXTURE_TIMED_OUT"); }
for (const mode of ["readonly", "controlled"]) test(`real Pi ${mode} input survives abrupt Host SIGKILL without replay or restored grants`, { skip: !process.env.OMP_TEST_STACK_PACKAGE && process.env.OMP_INPUT_PI110_SOURCE !== "1", timeout: 45000 }, async (t) => {
  assert(process.env.OMP_TEST_STACK_PACKAGE || process.env.OMP_INPUT_PI110_SOURCE === "1", "explicit Pi stack/source harness is required");
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-crash-"))), configRoot = path.join(root, "config"), assets = path.join(root, "assets"), project = path.join(root, "project"), extension = path.join(root, "boundary.mjs");
  const sourceCli = process.env.OMP_INPUT_PI110_SOURCE === "1" ? await createPi110SourceCli(root, { installedExtensions: true }) : null;
  await fs.mkdir(assets); await fs.writeFile(path.join(assets, "index.html"), "fixture"); await fs.mkdir(project, { recursive: true }); await fs.writeFile(path.join(project, "README.md"), "temporary crash fixture");
  await fs.writeFile(extension, `export default function(pi){pi.on("tool_call",async(event)=>{if(event.toolName!=="read")return;await new Promise(resolve=>{process.on("message",function release(frame){if(frame?.type==="fixture_release_tool"){process.off("message",release);resolve();}});process.send({type:"fixture_tool_waiting"});});});}`);
  let requests = 0, workerIdentity; const children = [];
  const provider = http.createServer(async (req, res) => {
    let bytes = ""; for await (const chunk of req) bytes += chunk;
    assert.equal(req.headers.authorization, "Bearer local-crash-fixture"); JSON.parse(bytes); requests++;
    const choices = [{ delta: { role: "assistant", tool_calls: [{ index: 0, id: "crash-read", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } }] }, finish_reason: null }, { delta: {}, finish_reason: "tool_calls" }];
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of choices) res.write(`data: ${JSON.stringify({ id: "crash", model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  }); await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); if (child.connected) child.send({ type: "release" }); child.kill("SIGTERM"); await exited; }
    if (workerIdentity && groupAlive(workerIdentity.pid)) {
      assert.equal(await processIdentity(workerIdentity.pid), workerIdentity.start); process.kill(-workerIdentity.pid, "SIGKILL"); await until(() => !groupAlive(workerIdentity.pid));
    }
    await new Promise((resolve) => { provider.closeAllConnections(); provider.close(resolve); }); await fs.rm(root, { recursive: true });
  });
  const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "fixture", name: "crash local only", authType: "api_key" }), own = await accounts.runtimePaths(account.accountId);
  await fs.writeFile(own.authPath, JSON.stringify({ fixture: { type: "api_key", key: "local-crash-fixture" } }), { mode: 0o600 });
  await fs.writeFile(own.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "Crash Fixture", reasoning: true, contextWindow: 32000, maxTokens: 128 }] } } }), { mode: 0o600 });
  await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify({ ...(sourceCli ? JSON.parse(await fs.readFile(path.join(configRoot, "settings.json"), "utf8")) : {}), retry: { enabled: false }, compaction: { enabled: false } }), { mode: 0o600 });
  async function start() {
    const child = fork(new URL("./fixtures/host-input-crash.mjs", import.meta.url), [configRoot, assets, extension], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, ...(sourceCli ? { OMP_INPUT_PI110_STACK: sourceCli.stack } : {}) } }); children.push(child);
    const messages = []; child.on("message", (message) => messages.push(message));
    const ready = await until(() => messages.find((message) => ["ready", "error"].includes(message.type))); return { child, ready, messages };
  }
  const first = await start(); assert.equal(first.ready.type, "ready", first.ready.code);
  async function pair(ready) {
    const response = await fetch(`${ready.origin}/pair`, { method: "POST", headers: { Origin: ready.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(ready.pairingUrl).hash.slice(6) }) }); assert(response.ok); return response.headers.get("set-cookie").split(";")[0];
  }
  const cookie = await pair(first.ready);
  async function command(ready, cookie, input, route = "/api/command") {
    const response = await fetch(ready.origin + route, { method: "POST", headers: { Origin: ready.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, body: JSON.stringify(input) }); const value = await response.json(); assert(response.ok, value.code); return value;
  }
  const p = await command(first.ready, cookie, { type: "addProject", path: project });
  const task = await command(first.ready, cookie, { type: "startTask", projectId: p.projectId, requestId: "crash-never-replay", accountId: account.accountId, model: "fixture/fixture", thinkingLevel: "low", mode, prompt: "read README.md" });
  await until(async () => {
    const current = await fetch(`${first.ready.origin}/api/task?taskId=${task.taskId}`, { headers: { Cookie: cookie } }).then((response) => response.json());
    assert(!["failed", "cancelled", "succeeded"].includes(current.status), current.error ?? "tool was not requested");
    return first.messages.some((message) => message.type === "waiting");
  });
  const tasksFile = path.join(configRoot, "only-my-pi/host/tasks.json");
  const saved = await until(async () => { const state = JSON.parse(await fs.readFile(tasksFile, "utf8")); return state.tasks.find((item) => item.taskId === task.taskId && item.worker && item.sessionId); }); workerIdentity = saved.worker;
  const target = { projectId: p.projectId, taskId: task.taskId }, binding = { accountId: account.accountId, modelId: "fixture/fixture", thinking: "low", mode, resourceRevision: 0 };
  const input = (id, delivery) => ({ inputId: id, delivery, text: `crash ${id}`, materialSnapshotIds: [], binding });
  let view = await command(first.ready, cookie, { type: "getInputs", target }, "/api/input-command");
  const draft = await command(first.ready, cookie, { type: "saveDraft", target, input: input("draft", "queue"), expectedRevision: view.draft.revision }, "/api/input-command");
  let queue = await command(first.ready, cookie, { type: "enqueueInput", target, predecessorTaskId: task.taskId, input: input("queued", "queue"), expectedRevision: 0 }, "/api/input-command");
  queue = await command(first.ready, cookie, { type: "deliverSupplement", target, taskId: task.taskId, input: input("steer", "steer"), expectedRevision: queue.revision }, "/api/input-command");
  assert.deepEqual(queue.items.map((item) => item.state), ["queued", "accepted"]); assert.equal(requests, 1);
  const locksRoot = path.join(configRoot, "only-my-pi/host/locks"), originalLocks = await fs.readdir(locksRoot);
  const exited = once(first.child, "exit"); first.child.kill("SIGKILL"); const [, signal] = await exited; assert.equal(signal, "SIGKILL");
  const second = await start(); let after;
  if (mode === "controlled") {
    assert.equal(second.ready.code, "CONTROLLED_ORPHAN_REQUIRES_RECONCILIATION");
    const remaining = await fs.readdir(locksRoot); assert(originalLocks.filter((name) => /^(project|session)-/.test(name)).every((name) => remaining.includes(name)));
    after = { restart: "BLOCKED_SAFE_RECONCILIATION_REQUIRED", locksRetained: remaining, tasks: JSON.parse(await fs.readFile(tasksFile, "utf8")) };
  } else {
    assert.equal(second.ready.type, "ready", second.ready.code); assert.notEqual(second.ready.epoch, first.ready.epoch);
    assert.equal((await fetch(second.ready.origin + "/api/state", { headers: { Cookie: cookie } })).status, 401);
    const nextCookie = await pair(second.ready), state = await fetch(second.ready.origin + "/api/state", { headers: { Cookie: nextCookie } }).then((response) => response.json());
    const recovered = state.tasks.find((item) => item.taskId === task.taskId); assert.equal(recovered.status, "interrupted"); assert.equal(recovered.error, "HOST_RESTARTED"); assert.equal(recovered.access, "inspect"); assert.deepEqual(recovered.approvals, []);
    view = await command(second.ready, nextCookie, { type: "getInputs", target }, "/api/input-command");
    assert.deepEqual(view.queue.items.map((item) => item.state), ["paused", "unknown"]); assert.deepEqual(view.draft, draft);
    const response = await fetch(second.ready.origin + "/api/input-command", { method: "POST", headers: { Origin: second.ready.origin, Cookie: nextCookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, body: JSON.stringify({ type: "resumeQueue", target, expectedRevision: view.queue.revision }) }); assert.equal(response.status, 409); assert.equal((await response.json()).code, "INPUT_RECONCILIATION_REQUIRED");
    assert.equal(state.tasks.length, 1); after = { restart: "RECOVERED_INSPECT_ONLY", task: recovered, draft: view.draft, queue: view.queue };
  }
  assert.equal(requests, 1); await until(() => !groupAlive(workerIdentity.pid));
  if (process.env.OMP_INPUT_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_INPUT_EVIDENCE_ROOT, `pi-crash-${mode}-${process.pid}-${Date.now()}.json`), JSON.stringify({ node: process.version, stackId: first.ready.stackId, piVersion: sourceCli?.piVersion ?? null, harness: sourceCli ? "SOURCE_WORKTREE_REAL_EXTENSIONS" : "VERIFIED_DISTRIBUTION", mode, kind: "ACTUAL_HOST_CHILD_SIGKILL", provider: "LOOPBACK_ONLY", hostSignal: signal, originalQueue: queue, after, requestsBefore: 1, requestsAfter: requests, worker: { ...workerIdentity, groupAlive: false }, draftDigest: createHash("sha256").update(JSON.stringify(draft)).digest("hex") }, null, 2), { flag: "wx", mode: 0o600 });
});
