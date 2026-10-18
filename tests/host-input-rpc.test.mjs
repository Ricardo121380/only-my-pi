import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RpcWorker } from "../packages/host/rpc-worker.mjs";
import { HostTasks } from "../packages/host/tasks.mjs";
import { HostInputStore } from "../packages/host/input-store.mjs";
import { HostInputController } from "../packages/host/input-controller.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { groupAlive } from "../packages/host/ownership.mjs";
import { INPUT_CARRIER } from "../packages/host/input-protocol.mjs";

async function until(check) { for (let i = 0; i < 800; i++) { const found = await check(); if (found) return found; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("real Pi fixture timed out"); }
async function fixture(t, { startup = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-real-pi-"))), configRoot = path.join(root, "config"), cwd = path.join(root, "project"), sessionRoot = path.join(root, "sessions");
  await fs.mkdir(cwd); await fs.writeFile(path.join(cwd, "README.md"), "fixture tool finished\n"); await fs.mkdir(sessionRoot);
  await fs.symlink(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))), path.join(root, "pi"));
  const sdkManifest = await fs.readFile(path.join(root, "pi/package.json")); assert.equal(JSON.parse(sdkManifest).version, "1.3.0");
  const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "fixture", name: "local-only", authType: "api_key" }), paths = await accounts.runtimePaths(account.accountId);
  const f = { root, cwd, received: [], workers: [], toolWaiting: false, toolReleased: false, reject: false, startEvents: [] };
  const provider = http.createServer(async (req, res) => {
    let body = ""; for await (const bytes of req) body += bytes;
    f.received.push(JSON.parse(body));
    if (f.reject) { res.writeHead(401, { "content-type": "application/json" }); res.end('{"error":{"type":"authentication_error","message":"local fixture rejection"}}'); return; }
    const read = f.received.length === 1;
    const choices = read ? [
      { delta: { role: "assistant", tool_calls: [{ index: 0, id: "fixture-read", type: "function", function: { name: "read", arguments: '{"path":"README.md"}' } }] }, finish_reason: null },
      { delta: {}, finish_reason: "tool_calls" },
    ] : [{ delta: { role: "assistant", content: "fixture done" }, finish_reason: null }, { delta: {}, finish_reason: "stop" }];
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const choice of choices) res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
    res.write('data: {"id":"fixture","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'); res.end("data: [DONE]\n\n");
  });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  await fs.writeFile(paths.authPath, JSON.stringify({ fixture: { type: "api_key", key: "local-fixture-only" } }));
  await fs.writeFile(paths.modelsPath, JSON.stringify({ providers: { fixture: { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, api: "openai-completions", models: [{ id: "fixture", name: "Fixture", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 }] } } }));
  await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, `export default function(pi) {
    pi.registerFlag("perm", {description: "Fixture permission flag", type: "string"});
    ${startup ? `pi.on("before_agent_start", async (event, ctx) => {
      await new Promise(resolve => {
        const listener = frame => { if (["fixture_release_startup", "fixture_abort_startup"].includes(frame?.type)) {
          process.off("message", listener); if (frame.type === "fixture_abort_startup") ctx.abort(); resolve();
        } };
        process.on("message", listener); process.send({type:"fixture_starting", messageType:event.messageType});
      });
    });` : ""}
    pi.on("tool_call", async (event, ctx) => {
      if (event.toolName !== "read") return;
      await new Promise((resolve) => {
        const listener = (frame) => { if (frame?.type === "fixture_abort_tool") { ctx.abort(); process.off("message", listener); resolve(); } else if (frame?.type === "fixture_release_tool") { process.off("message", listener); resolve(); } };
        process.on("message", listener); process.send({type: "fixture_tool_waiting"});
      });
    });
  }`);
  const catalog = new ProjectCatalog({ sessionRoot }), project = await catalog.add(cwd), store = new HostInputStore({ configRoot }); await store.load();
  const tasks = new HostTasks({ configRoot, catalog, accounts, stack: { root, nodePath: process.execPath, piCliPath: "unused", stackId: `sha256:${"a".repeat(64)}` }, models: async () => [{ id: "fixture/fixture", thinkingLevels: ["low"] }], env: { PATH: process.env.PATH }, workerFactory: (options) => {
    const worker = new RpcWorker({ ...options, extensionResolver: async () => ({ extensions: [extension] }), spawnImpl: (...args) => {
      const child = spawn(...args);
      const emit = child.emit;
      child.emit = function(event, frame, ...rest) {
        if (event === "message" && frame?.type === "omp_input_response" && f.dropNextAck) { f.dropNextAck = false; f.droppedAck = frame.data; return true; }
        return emit.call(this, event, frame, ...rest);
      };
      child.on("message", (message) => { if (message?.type === "fixture_tool_waiting") f.toolWaiting = true; });
      child.on("message", (message) => { if (message?.type === "fixture_starting") f.startEvents.push(message); });
      return child;
    } }); f.workers.push(worker); return worker;
  } }); await tasks.load();
  const controller = new HostInputController({ store, tasks, catalog }); Object.assign(f, { tasks, controller, store, catalog });
  t.after(async () => {
    controller.beginStop(); await tasks.stop(); await controller.close(); await store.close();
    for (const worker of f.workers) { assert.equal(groupAlive(worker.identity?.pid), false); assert.equal(worker.inputPending.size, 0); }
    assert.equal(tasks.leases.size, 0); assert.equal(tasks.accountReleases.size, 0);
    if (process.env.OMP_INPUT_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_INPUT_EVIDENCE_ROOT, `pi-receipts-${process.pid}-${Date.now()}.json`), JSON.stringify({ case: t.name, sdk: { version: JSON.parse(sdkManifest).version, manifestSha256: createHash("sha256").update(sdkManifest).digest("hex") }, node: process.version, provider: "LOOPBACK_FIXTURE_ONLY", ...f.evidence, workers: f.workers.map((worker) => ({ pid: worker.identity?.pid, start: worker.identity?.start, groupAlive: groupAlive(worker.identity?.pid), pendingInputs: worker.inputPending.size })), sessionLeases: tasks.leases.size, accountReservations: tasks.accountReleases.size }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await new Promise((resolve) => { provider.closeAllConnections(); provider.close(resolve); }); await fs.rm(root, { recursive: true, force: true });
  });
  const first = await tasks.start({ type: "startTask", requestId: "first", projectId: project.projectId, accountId: account.accountId, model: "fixture/fixture", thinkingLevel: "low", prompt: "Read README.md" });
  await until(() => startup ? f.startEvents.length : f.toolWaiting); await catalog.scan();
  const task = tasks.tasks.get(first.taskId), target = { projectId: project.projectId, taskId: task.taskId }, scope = { projectId: project.projectId, sessionId: task.sessionId };
  Object.assign(f, { task, target, scope });
  f.input = (inputId, delivery) => ({ inputId, delivery, text: `fixture ${inputId}`, materialSnapshotIds: [], binding: { accountId: account.accountId, modelId: "fixture/fixture", thinking: "low", mode: "readonly", resourceRevision: 0 } });
  f.queue = () => store.readQueue(scope);
  f.enqueue = async (id, delivery) => controller.command({ type: delivery === "steer" ? "deliverSupplement" : "enqueueInput", target, [delivery === "steer" ? "taskId" : "predecessorTaskId"]: task.taskId, input: f.input(id, delivery), expectedRevision: (await f.queue()).revision });
  f.release = () => { f.toolReleased = true; f.workers[0].child.send({ type: "fixture_release_tool" }); };
  f.releaseStartup = (abort = false) => f.workers[0].child.send({ type: abort ? "fixture_abort_startup" : "fixture_release_startup" });
  return f;
}

test("production Host/Pi RPC consumes steering at a safe tool boundary and three queued turns exactly once", { timeout: 45000 }, async (t) => {
  const f = await fixture(t);
  const accepted = await f.enqueue("steer", "steer"); assert.equal(accepted.items[0].state, "accepted"); assert.equal(accepted.items[0].consumedEntryId, null);
  f.evidence = { acceptedBeforeToolRelease: { state: accepted.items[0].state, consumedEntryId: accepted.items[0].consumedEntryId, toolReleased: f.toolReleased, requests: f.received.length } };
  assert.deepEqual(f.tasks.public(f.task).inputFeedback, [
    { inputId: null, source: "pi-prompt", disposition: "started" },
    { inputId: "steer", source: "omp-custom-message", disposition: "queued" },
  ]);
  assert.equal(f.received.length, 1); assert.equal(f.toolReleased, false, "steering did not abort or complete the blocked tool");
  await f.controller.command({ type: "deliverSupplement", target: f.target, taskId: f.task.taskId, input: f.input("steer", "steer"), expectedRevision: 0 });
  for (const id of ["one", "two", "three"]) await f.enqueue(id, "queue");
  f.release();
  await until(async () => (await f.queue()).items.every((item) => item.state === "consumed"));
  await until(() => [...f.tasks.tasks.values()].every((task) => task.status === "succeeded"));
  await Promise.all([...f.tasks.running.values()]); await f.catalog.scan();
  const queue = await f.queue(); assert.equal(new Set(queue.items.map((item) => item.taskId)).size, 4);
  for (const task of f.tasks.tasks.values()) {
    assert.deepEqual(task.settlement, { aborted: false });
    assert.ok(task.messages.some(message => message.role === "assistant" && message.durationMs >= 0));
    assert.ok(task.inputFeedback.some(feedback => feedback.inputId === queue.items.find(item => item.taskId === task.taskId).inputId));
  }
  assert.ok(f.task.messages.some(message => message.role === "toolResult" && message.durationMs >= 0));
  const session = f.catalog.listSessions(f.scope.projectId).find((session) => session.sessionId === f.scope.sessionId);
  const file = (await f.catalog.resume(session.sessionKey, f.scope.projectId)).file;
  const entries = (await fs.readFile(file, "utf8")).trim().split("\n").map(JSON.parse);
  const carriers = entries.filter((entry) => entry.type === "custom_message" && entry.customType === INPUT_CARRIER);
  Object.assign(f.evidence, { carriers, states: queue.items.map(({ inputId, taskId, state, consumedEntryId }) => ({ inputId, taskId, state, consumedEntryId })), requests: f.received.length, historySha256: createHash("sha256").update(await fs.readFile(file)).digest("hex") });
  assert.deepEqual(carriers.map((entry) => entry.details.inputId), ["steer", "one", "two", "three"]);
  assert.deepEqual(carriers.map((entry) => entry.id), queue.items.map((item) => item.consumedEntryId));
  assert.equal(f.received.length, 5); assert.ok(f.received.every((request) => request.reasoning_effort === "low"));
  assert.ok(f.received[1].messages.some((message) => message.role === "tool" && JSON.stringify(message.content).includes("fixture tool finished")));
  assert.equal(f.received[1].messages.filter((message) => JSON.stringify(message.content).includes("fixture steer")).length, 1);
  assert.ok(f.received.every((request) => !JSON.stringify(request).includes("contentDigest") && !JSON.stringify(request).includes("omp-host-input")), "business IDs remain metadata, not provider text");
  await assert.rejects(f.enqueue("late", "steer"), { code: "TASK_NOT_RUNNING" }); assert.equal(f.workers.length, 4);
  assert.ok((await f.catalog.history(session.sessionKey)).messages.some((message) => message.role === "user" && message.text === "fixture steer"));
});

test("Pi 1.3 startup is busy: steering stays correlated while before_agent_start waits", { timeout: 30000 }, async t => {
  const f = await fixture(t, { startup: true });
  assert.deepEqual(f.startEvents.map(event => event.messageType), ["user"]);
  const accepted = await f.enqueue("during-startup", "steer");
  assert.equal(accepted.items[0].state, "accepted");
  assert.equal(accepted.items[0].consumedEntryId, null);
  assert.equal(f.received.length, 0);
  await f.enqueue("during-startup", "steer");
  f.releaseStartup(); await until(() => f.toolWaiting); f.release();
  await until(() => f.task.status === "succeeded");
  await until(async () => (await f.queue()).items[0].state === "consumed");
  const item = (await f.queue()).items[0];
  assert.equal((await f.catalog.inputReceipt(item)).entryId, item.consumedEntryId);
  assert.equal(f.received.length, 2);
  assert.equal(f.workers.length, 1);
  f.evidence = { kind: "ACTUAL_PI_STARTUP_STEERING", acceptedBeforeStart: accepted, item, requests: f.received.length, startEvents: f.startEvents };
});

test("Pi 1.3 abort during startup sends no model request while preserving proven consumption", { timeout: 30000 }, async t => {
  const f = await fixture(t, { startup: true });
  await f.enqueue("abort-startup", "steer"); f.releaseStartup(true);
  await until(() => f.task.status === "cancelled");
  await Promise.all([...f.tasks.running.values()]);
  const queue = await f.queue();
  assert.equal(queue.items[0].state, "consumed");
  assert.equal((await f.catalog.inputReceipt(queue.items[0])).entryId, queue.items[0].consumedEntryId);
  assert.equal(f.received.length, 0); assert.equal(f.workers.length, 1);
  assert.deepEqual(f.task.settlement, { aborted: true });
  f.evidence = { kind: "ACTUAL_PI_ABORT_DURING_STARTUP", queue, requests: 0, settlement: f.task.settlement };
});
test("real model failure pauses an admitted queue instead of starting another worker", { timeout: 30000 }, async (t) => {
  const f = await fixture(t); await f.enqueue("later", "queue"); f.reject = true; f.release();
  await until(() => f.task.status === "failed"); await until(async () => (await f.queue()).items[0].state === "paused");
  assert.equal(f.workers.length, 1); assert.equal(f.received.length, 2); assert.equal(f.task.error, "MODEL_REQUEST_FAILED");
  f.evidence = { status: f.task.status, error: f.task.error, states: (await f.queue()).items.map(({ inputId, state, pauseReason }) => ({ inputId, state, pauseReason })), requests: f.received.length };
});
test("real Pi shutdown before steering consumption preserves unknown input and paused queue on reopening", { timeout: 30000 }, async (t) => {
  const f = await fixture(t); await f.enqueue("queue", "queue"); await f.enqueue("unconsumed", "steer");
  assert.equal(f.received.length, 1);
  f.controller.beginStop(); await f.tasks.stop(); await f.controller.close(); await f.store.close();
  const reopened = new HostInputStore({ configRoot: f.store.configRoot }); await reopened.load();
  try {
    const queue = await reopened.readQueue(f.scope);
    assert.deepEqual(queue.items.map((item) => item.state), ["paused", "unknown"]); assert.equal(f.received.length, 1); assert.equal(f.workers.length, 1);
    await f.catalog.scan(); assert.equal(await f.catalog.inputReceipt(queue.items[1]), null);
    f.evidence = { states: queue.items.map(({ inputId, state, pauseReason, consumedEntryId }) => ({ inputId, state, pauseReason, consumedEntryId })), requests: f.received.length, autoReplay: false };
  } finally { await reopened.close(); }
});
test("real Pi accepts a new-session draft through the task-bound ledger before model consumption", { timeout: 30000 }, async (t) => {
  const f = await fixture(t); f.release(); await until(() => f.task.status === "succeeded"); await Promise.all([...f.tasks.running.values()]);
  const target = { projectId: f.scope.projectId, sessionKey: null }, input = { ...f.input("first-draft", "prompt"), text: "fixture new session" };
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  const task = await f.controller.command({ type: "submitPrompt", target, requestId: "real-new-prompt", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision });
  await until(() => f.tasks.tasks.get(task.taskId).status === "succeeded"); await Promise.all([...f.tasks.running.values()]);
  const bound = f.tasks.tasks.get(task.taskId), scope = { projectId: f.scope.projectId, sessionId: bound.sessionId };
  await until(async () => (await f.store.readQueue(scope)).items[0]?.state === "consumed");
  const queue = await f.store.readQueue(scope); assert.equal(queue.items[0].state, "consumed"); assert.equal(queue.items[0].inputId, task.inputId); assert.notEqual(task.inputId, input.inputId);
  assert.equal((await f.store.readDraft({ projectId: scope.projectId, sessionId: null })).draft, null); assert.equal(f.received.length, 3);
  assert.ok(f.received.at(-1).messages.some((message) => JSON.stringify(message.content).includes("fixture new session")));
  assert.equal(f.workers.length, 2); assert.notEqual(f.workers[0].state.sessionId, f.workers[1].state.sessionId);
  f.evidence = { originDraftInputId: task.originDraftInputId, inputId: task.inputId, state: queue.items[0].state, consumedEntryId: queue.items[0].consumedEntryId, requests: f.received.length, changedSession: f.workers[0].state.sessionId !== f.workers[1].state.sessionId };
});


test("lost real IPC acceptance ACK is reconciled from Pi history without redelivery", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  f.dropNextAck = true;
  const unknown = await f.enqueue("lost-ack", "steer");
  assert.equal(f.droppedAck.status, "accepted");
  assert.equal(unknown.items[0].state, "unknown");
  assert.equal(f.received.length, 1);
  const retry = await f.enqueue("lost-ack", "steer");
  assert.equal(retry.items[0].state, "unknown");
  assert.ok(f.task.inputFeedback.some(feedback => feedback.inputId === "lost-ack" && feedback.disposition === "queued"));
  assert.equal(f.received.length, 1);
  f.release();
  await until(async () => (await f.queue()).items[0].state === "consumed");
  await until(() => f.task.status === "succeeded");
  await Promise.all([...f.tasks.running.values()]);
  assert.equal(f.received.length, 2);
  assert.equal(f.received[1].messages.filter(message => JSON.stringify(message.content).includes("fixture lost-ack")).length, 1);
  const item = (await f.queue()).items[0];
  assert.equal((await f.catalog.inputReceipt(item)).entryId, item.consumedEntryId);
  f.evidence = { injected: "DROP_ACTUAL_IPC_ACCEPTANCE_FRAME", originalAck: f.droppedAck, item, requests: f.received.length, autoReplay: false };
});

test("Pi's own aborted settlement cancels the Host task and pauses FIFO", { timeout: 30000 }, async (t) => {
  const f = await fixture(t); await f.enqueue("after-pi-abort", "queue");
  f.workers[0].child.send({ type: "fixture_abort_tool" });
  await until(() => ["cancelled", "failed", "succeeded"].includes(f.task.status));
  assert.equal(f.task.status, "cancelled", JSON.stringify({ error: f.task.error, settlement: f.task.settlement, requests: f.received.length }));
  await until(async () => (await f.queue()).items[0].state === "paused");
  await Promise.all([...f.tasks.running.values()]);
  assert.deepEqual(f.task.settlement, { aborted: true });
  assert.equal(f.received.length, 1); assert.equal(f.workers.length, 1);
  f.evidence = { kind: "ACTUAL_PI_ABORT_WITHOUT_HOST_CANCEL", status: f.task.status, settlement: f.task.settlement, queue: await f.queue(), requests: f.received.length };
});

test("actual Pi worker SIGKILL retains unknown steering and prevents FIFO replay", { timeout: 30000 }, async (t) => {
  const f = await fixture(t); await f.enqueue("after-worker-death", "queue"); await f.enqueue("before-worker-death", "steer");
  process.kill(-f.workers[0].identity.pid, "SIGKILL");
  await until(() => ["failed", "interrupted"].includes(f.task.status));
  assert.equal(f.task.error, "WORKER_EXITED");
  await Promise.all([...f.tasks.running.values()]);
  await until(async () => (await f.queue()).items[1].state === "unknown" && (await f.queue()).items[0].state === "paused");
  const queue = await f.queue();
  assert.deepEqual(queue.items.map(item => item.state), ["paused", "unknown"]);
  assert.equal(f.received.length, 1); assert.equal(f.workers.length, 1);
  assert.equal(await f.catalog.inputReceipt(queue.items[1]), null);
  f.evidence = { kind: "ACTUAL_PI_WORKER_SIGKILL", status: f.task.status, queue, requests: f.received.length, autoReplay: false };
});
