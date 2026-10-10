import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { HostInputStore } from "../packages/host/input-store.mjs";
import { HostInputController } from "../packages/host/input-controller.mjs";
import { HostTasks } from "../packages/host/tasks.mjs";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { INPUT_CARRIER, findInputReceipt, validateInputCommand } from "../packages/host/input-protocol.mjs";
import { createPiInputBridge } from "../packages/host/pi-input-bridge.mjs";
import { inputDigest } from "../packages/host/input-contracts.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 400; i++) { const value = await check(); if (value) return value; await sleep(10); } throw new Error("fixture did not settle"); }
const content = (inputId, delivery = "queue", text = inputId, binding = { accountId: "account", modelId: "fixture/fixture", thinking: "low", mode: "readonly", resourceRevision: 0 }) => ({ inputId, delivery, text, materialSnapshotIds: [], binding });
function record(input = content("input", "steer")) {
  const scope = { projectId: "project", sessionId: "session" }, date = new Date().toISOString();
  return { ...input, ...scope, schemaVersion: 1, revision: 1, taskId: "task", contentDigest: inputDigest(scope, input), state: "dispatching", consumedEntryId: null, pauseReason: null, createdAt: date, updatedAt: date };
}
const carrier = (item, id = "receipt", parentId = null) => ({ type: "custom_message", id, parentId, timestamp: new Date().toISOString(), customType: INPUT_CARRIER, content: item.text, display: true, details: { version: 1, inputId: item.inputId, taskId: item.taskId, scope: { projectId: item.projectId, sessionId: item.sessionId }, contentDigest: item.contentDigest } });

async function fixture(t, { mode = "readonly", thinking = "low", levels = [thinking], promptDisposition } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-delivery-")));
  const configRoot = path.join(root, "config"), cwd = path.join(root, "project"), sessionRoot = path.join(root, "sessions");
  await fs.mkdir(cwd); await fs.mkdir(sessionRoot);
  const catalog = new ProjectCatalog({ sessionRoot }), project = await catalog.add(cwd);
  const accounts = new AccountCatalog(configRoot), account = await accounts.create({ providerId: "fixture", name: "fixture", authType: "api_key" });
  const store = new HostInputStore({ configRoot }); await store.load();
  const f = { root, configRoot, cwd, sessionRoot, catalog, store, workers: [], calls: [], lookups: 0, lostAck: false, modelsAvailable: true, resource: 0, consumeSteering: false };
  class Worker extends EventEmitter {
    constructor(options) { super(); this.options = options; this.identity = { pid: 99999999, start: "fixture" }; this.pending = []; }
    async start() {
      if (f.failNextWorkerStart) { f.failNextWorkerStart = false; throw new Error("fixture pre-prompt startup failure"); }
      await fs.mkdir(this.options.sessionRoot, { recursive: true });
      this.file = this.options.resumeFile ?? path.join(this.options.sessionRoot, `fixture-${randomUUID()}.jsonl`);
      if (this.options.resumeFile) this.sessionId = JSON.parse((await fs.readFile(this.file, "utf8")).split("\n")[0]).id;
      else { this.sessionId = randomUUID(); await fs.writeFile(this.file, JSON.stringify({ type: "session", version: 3, id: this.sessionId, cwd, timestamp: new Date().toISOString() }) + "\n"); }
      return { sessionId: this.sessionId, thinkingLevel: thinking };
    }
    async command(type) { if (type === "get_state") return { thinkingLevel: thinking }; return promptDisposition ? { disposition: promptDisposition } : {}; }
    async consume(item) {
      const entries = (await fs.readFile(this.file, "utf8")).trim().split("\n").map(JSON.parse);
      const entry = carrier(item, randomUUID(), entries.at(-1).type === "session" ? null : entries.at(-1).id);
      await fs.appendFile(this.file, JSON.stringify(entry) + "\n");
      this.emit("event", { type: "message_end", message: { role: "custom", customType: INPUT_CARRIER, content: item.text } });
      const receipt = findInputReceipt([entry], item); this.emit("input", receipt); return receipt;
    }
    async deliverInput(item) {
      const published = (await store.readQueue({ projectId: item.projectId, sessionId: item.sessionId })).items.find((value) => value.inputId === item.inputId);
      assert.equal(published.state, "dispatching", "ledger must be published before worker invocation"); assert.equal(published.taskId, this.options.taskId);
      assert.equal(f.tasks.tasks.get(item.taskId).access, "inspect", "a fresh queued task never inherits a grant");
      if (f.rejectLate) throw Object.assign(new Error("task already settled"), { code: "TASK_NOT_RUNNING" });
      f.calls.push(item); this.pending.push(item);
      if (item.delivery !== "steer" || f.consumeSteering) {
        const receipt = await this.consume(item);
        if (item.delivery !== "steer") this.timer = setTimeout(() => this.finish(), 30);
        if (f.lostAck) throw new Error("lost response");
        return { status: "consumed", receipt };
      }
      if (f.lostAck) throw new Error("lost response");
      return { status: "accepted" };
    }
    async lookupInput(item) { f.lookups++; const receipt = await catalog.inputReceipt(item); return receipt ? { status: "consumed", receipt } : { status: "accepted" }; }
    finish(failed = false) {
      if (failed) this.emit("fault", { code: "MODEL_REQUEST_FAILED" });
      else this.emit("event", { type: "agent_settled" });
    }
    async cancel() { this.emit("event", { type: "agent_settled" }); await this.stop(); }
    async revoke() {}
    async stop() { clearTimeout(this.timer); if (!this.closed) { this.closed = true; this.emit("exit", { code: 0 }); } }
  }
  const tasks = new HostTasks({ configRoot, stack: {}, accounts, catalog, models: async () => f.modelsAvailable ? [{ id: "fixture/fixture", thinkingLevels: levels }] : [], allowControlled: true, workerFactory: (options) => { const worker = new Worker(options); f.workers.push(worker); return worker; } });
  f.tasks = tasks; await tasks.load();
  const controller = new HostInputController({ store, tasks, catalog, resourceRevision: () => f.resource }); f.controller = controller;
  const first = await tasks.start({ type: "startTask", requestId: "first", projectId: project.projectId, accountId: account.accountId, model: "fixture/fixture", thinkingLevel: thinking, mode, prompt: "first" });
  const task = await until(() => tasks.tasks.get(first.taskId).status === "running" && tasks.tasks.get(first.taskId));
  await catalog.scan();
  f.target = { projectId: project.projectId, taskId: task.taskId }; f.scope = { projectId: project.projectId, sessionId: task.sessionId }; f.task = task;
  f.input = (id, delivery = "queue") => content(id, delivery, id, { accountId: account.accountId, modelId: task.model, thinking, mode, resourceRevision: 0 });
  f.command = (value) => controller.command({ target: f.target, ...value });
  f.queue = () => store.readQueue(f.scope);
  f.enqueue = async (id, delivery = "queue") => f.command({ type: delivery === "steer" ? "deliverSupplement" : "enqueueInput", [delivery === "steer" ? "taskId" : "predecessorTaskId"]: task.taskId, input: f.input(id, delivery), expectedRevision: (await f.queue()).revision });
  t.after(async () => { controller.beginStop(); await tasks.stop(); await controller.close(); await store.close(); await f.reopened?.close(); await fs.rm(root, { recursive: true, force: true }); });
  return f;
}

test("input protocol is strict, versioned, bounded and denies execution metadata", () => {
  const good = { type: "deliverSupplement", target: { projectId: "project", taskId: "task" }, taskId: "task", input: content("input", "steer"), expectedRevision: 0 };
  assert.deepEqual(validateInputCommand(good), good);
  for (const invalid of [{ ...good, command: "bash" }, { ...good, target: { projectId: "project", path: "/tmp/history" } }, { ...good, target: { projectId: "project", sessionKey: "bad" } }, { ...good, expectedRevision: -1 }, { ...good, input: { ...good.input, grant: "coding" } }, { ...good, input: { ...good.input, text: "x".repeat(32769) } }]) assert.throws(() => validateInputCommand(invalid));
  assert.throws(() => validateInputCommand({ type: "submitPrompt", target: { projectId: "project", taskId: "task" }, requestId: "request", input: content("input", "prompt"), expectedRevision: 0, expectedInputRevision: 1 }), { code: "INPUT_COMMAND_INVALID" });
});
test("new-session draft transfers full text before Pi prompt with a distinct bound ID and retry-safe request", async (t) => {
  const f = await fixture(t), target = { projectId: f.scope.projectId, sessionKey: null }, input = { ...f.input("new-draft", "prompt"), text: "x".repeat(2049) };
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  const submission = { type: "submitPrompt", target, requestId: "submit-new", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision };
  const first = await f.controller.command(submission), repeated = await f.controller.command(submission);
  assert.equal(first.taskId, repeated.taskId); assert.equal(first.originDraftInputId, input.inputId); assert.equal(first.originDraftSessionId, null); assert.notEqual(first.inputId, input.inputId);
  await until(() => f.tasks.tasks.get(first.taskId).status === "succeeded");
  const task = f.tasks.tasks.get(first.taskId), queue = await f.store.readQueue({ projectId: f.scope.projectId, sessionId: task.sessionId });
  await until(async () => (await f.store.readQueue({ projectId: f.scope.projectId, sessionId: task.sessionId })).items[0]?.state === "consumed");
  assert.equal(queue.items[0].inputId, first.inputId); assert.equal(queue.items[0].text, input.text);
  assert.equal((await f.store.readDraft({ projectId: f.scope.projectId, sessionId: null })).draft, null);
  assert.equal(f.workers.length, 2); assert.equal(f.calls.filter((item) => item.taskId === first.taskId).length, 1);
});
test("stopped-history draft continues that exact session and never silently starts a new one", async (t) => {
  const f = await fixture(t); f.workers[0].finish(); await until(() => f.task.status === "succeeded"); await Promise.all([...f.tasks.running.values()]); await f.catalog.scan();
  const session = f.catalog.listSessions(f.scope.projectId).find((item) => item.sessionId === f.scope.sessionId), target = { projectId: f.scope.projectId, sessionKey: session.sessionKey }, input = f.input("resumed-draft", "prompt");
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  const task = await f.controller.command({ type: "submitPrompt", target, requestId: "resume-draft", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision });
  await until(() => f.tasks.tasks.get(task.taskId).status === "succeeded");
  await until(async () => (await f.queue()).items[0]?.state === "consumed");
  assert.equal(task.sessionId, f.scope.sessionId); assert.equal(task.inputId, input.inputId);
  assert.equal((await f.queue()).items[0].state, "consumed"); assert.equal((await f.store.readDraft(f.scope)).draft, null);
  assert.equal(f.workers.length, 2);
});
test("non-reasoning model with an explicit empty catalog accepts off through both task and input admission", async (t) => {
  const f = await fixture(t, { thinking: "off", levels: [] });
  const target = { projectId: f.scope.projectId, sessionKey: null }, input = f.input("plain-draft", "prompt");
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  const task = await f.controller.command({ type: "submitPrompt", target, requestId: "plain-submit", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision });
  await until(() => f.tasks.tasks.get(task.taskId).status === "succeeded");
  assert.equal(f.tasks.tasks.get(task.taskId).thinkingLevel, "off"); assert.equal(f.calls.length, 1);
  const invalid = { ...input, inputId: "plain-invalid", binding: { ...input.binding, thinking: "low" } };
  const again = await f.controller.command({ type: "saveDraft", target, input: invalid, expectedRevision: (await f.store.readDraft({ projectId: target.projectId, sessionId: null })).revision });
  await assert.rejects(f.controller.command({ type: "submitPrompt", target, requestId: "plain-rejected", input: invalid, expectedRevision: again.revision, expectedInputRevision: again.draft.revision }), { code: "INPUT_BINDING_CHANGED" });
  assert.equal(f.calls.length, 1);
});
test("failed pre-prompt startup preserves the draft; repeating the same request cannot re-execute", async (t) => {
  const f = await fixture(t), target = { projectId: f.scope.projectId, sessionKey: null }, input = f.input("unstarted", "prompt");
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  const submit = { type: "submitPrompt", target, requestId: "unstarted-request", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision };
  f.failNextWorkerStart = true; const task = await f.controller.command(submit); await until(() => f.tasks.tasks.get(task.taskId).status === "failed");
  assert.equal((await f.store.readDraft({ projectId: target.projectId, sessionId: null })).draft.text, input.text); assert.equal(f.calls.length, 0);
  assert.equal((await f.controller.command(submit)).taskId, task.taskId); assert.equal(f.workers.length, 2);
  await assert.rejects(f.controller.command({ ...submit, requestId: "different-request" }), { code: "INPUT_ID_CONFLICT" });
});
test("failure after session binding but before Pi prompt retains complete text in draft and unknown ledger", async (t) => {
  const f = await fixture(t), target = { projectId: f.scope.projectId, sessionKey: null }, input = f.input("not-executed", "prompt");
  const draft = await f.controller.command({ type: "saveDraft", target, input, expectedRevision: 0 });
  f.store.atomic = { onPhase(phase, context) { if (phase === "BEFORE_RENAME" && context.target.includes("/drafts/")) throw new Error("fixture clear failure"); } };
  const result = await f.controller.command({ type: "submitPrompt", target, requestId: "clear-failed", input, expectedRevision: draft.revision, expectedInputRevision: draft.draft.revision });
  await until(() => f.tasks.tasks.get(result.taskId).status === "failed"); f.store.atomic = {};
  const task = f.tasks.tasks.get(result.taskId), queue = await f.store.readQueue({ projectId: f.scope.projectId, sessionId: task.sessionId });
  await until(async () => (await f.store.readQueue({ projectId: f.scope.projectId, sessionId: task.sessionId })).items[0].state === "unknown");
  assert.equal(queue.items[0].text, input.text); assert.equal((await f.store.readDraft({ projectId: target.projectId, sessionId: null })).draft.text, input.text); assert.equal(f.calls.length, 0);
});
test("receipt identity rejects same text, conflicting content, duplicate IDs and foreign tasks", () => {
  const item = record(); const entry = carrier(item);
  assert.equal(findInputReceipt([{ type: "message", id: "ordinary", message: { role: "user", content: item.text } }], item), null);
  assert.equal(findInputReceipt([entry], item).entryId, "receipt");
  for (const entries of [[entry, entry], [{ ...entry, content: "changed" }], [{ ...entry, details: { ...entry.details, taskId: "other" } }]]) assert.throws(() => findInputReceipt(entries, item), { code: "INPUT_RECEIPT_CONFLICT" });
});
test("Pi bridge uses safe steering metadata and never starts a late prompt", async () => {
  const branches = [], frames = [], native = []; let listener;
  const session = { isStreaming: true, thinkingLevel: "low", sessionManager: { getBranch: () => branches, getSessionId: () => "session" }, subscribe: (fn) => { listener = fn; return () => {}; }, sendCustomMessage: async (message, options) => { native.push({ message, options }); } };
  const bridge = createPiInputBridge({ session, taskId: "task", accountId: "account", modelId: "fixture/fixture", mode: "readonly", send: (frame) => frames.push(frame) });
  const item = record(); assert.equal(bridge.deliver(item).status, "accepted"); bridge.deliver(item);
  assert.equal(native.length, 1); assert.equal(native[0].options.deliverAs, "steer"); assert.equal(native[0].message.content, item.text);
  assert.equal(bridge.lookup(item).status, "accepted");
  listener({ type: "message_end" }); branches.push(carrier(item)); await Promise.resolve();
  assert.equal(frames[0].type, "omp_input_candidate"); assert.equal(bridge.lookup(item).status, "consumed");
  listener({ type: "message_end" }); listener({ type: "message_end" }); await Promise.resolve(); assert.equal(frames.length, 1, "consumed input must not create a repeated IPC/history scan storm");
  listener({ type: "agent_settled" }); session.isStreaming = false;
  assert.throws(() => bridge.deliver(record(content("late", "steer"))), { code: "TASK_NOT_RUNNING" }); assert.equal(native.length, 1);
  bridge.dispose();
});
test("supplement persists first, ACK is not consumption, idempotency does not resend", async (t) => {
  const f = await fixture(t), input = f.input("steer", "steer");
  const queued = await f.enqueue("steer", "steer"); assert.equal(queued.items[0].state, "accepted"); assert.equal(queued.items[0].consumedEntryId, null);
  await f.command({ type: "deliverSupplement", taskId: f.task.taskId, input, expectedRevision: 0 }); assert.equal(f.calls.length, 1);
  await assert.rejects(f.command({ type: "deliverSupplement", taskId: f.task.taskId, input: { ...input, text: "different" }, expectedRevision: 0 }), { code: "INPUT_ID_CONFLICT" });
  await assert.rejects(f.command({ type: "removeQueuedInput", inputId: input.inputId, expectedRevision: queued.revision, expectedInputRevision: queued.items[0].revision }), { code: "INPUT_TRANSITION_INVALID" });
  await f.workers[0].consume(f.calls[0]); await until(async () => (await f.queue()).items[0].state === "consumed");
  f.workers[0].finish(); await until(() => f.task.status === "succeeded");
  await f.command({ type: "deliverSupplement", taskId: f.task.taskId, input, expectedRevision: 0 }); assert.equal(f.calls.length, 1);
  await assert.rejects(f.enqueue("late", "steer"), { code: "TASK_NOT_RUNNING" }); assert.equal(f.workers.length, 1);
});
test("lost ACK triggers read-only lookup, unknown state pauses FIFO without replay", async (t) => {
  const f = await fixture(t); await f.enqueue("queue"); f.lostAck = true;
  await f.enqueue("unknown", "steer"); assert.equal(f.lookups, 1);
  assert.deepEqual((await f.queue()).items.map((item) => item.state), ["paused", "unknown"]);
  await f.command({ type: "deliverSupplement", taskId: f.task.taskId, input: f.input("unknown", "steer"), expectedRevision: 0 }); assert.equal(f.calls.length, 1);
  await assert.rejects(f.command({ type: "resumeQueue", expectedRevision: (await f.queue()).revision }), { code: "INPUT_RECONCILIATION_REQUIRED" });
  f.workers[0].finish(); await until(() => f.task.status === "succeeded"); await sleep(40); assert.equal(f.workers.length, 1);
});
test("persisted proof can reconcile a lost ACK without a second delivery", async (t) => {
  const f = await fixture(t); f.consumeSteering = true; f.lostAck = true;
  const queue = await f.enqueue("proof", "steer"); assert.equal(queue.items[0].state, "consumed"); assert.equal(f.lookups, 1); assert.equal(f.calls.length, 1);
});
test("three queued turns execute FIFO with fresh tasks and no inherited grant", async (t) => {
  const f = await fixture(t, { mode: "controlled" });
  for (const id of ["one", "two", "three"]) await f.enqueue(id);
  f.task.access = "coding"; f.task.approvals = [{ approvalId: "old" }]; f.workers[0].finish();
  await until(async () => (await f.queue()).items.every((item) => item.state === "consumed"));
  assert.deepEqual(f.calls.map((item) => item.text), ["one", "two", "three"]);
  assert.equal(new Set(f.calls.map((item) => item.taskId)).size, 3); assert.equal(f.workers.length, 4);
  await until(() => [...f.tasks.tasks.values()].every((task) => task.status === "succeeded"));
  assert.ok([...f.tasks.tasks.values()].every((task) => task.worker === null && task.access === "inspect" && !task.approvals.length));
});
for (const kind of ["failure", "cancel", "revoke", "models", "resources"]) test(`queue pauses on ${kind} and does not spawn a successor`, async (t) => {
  const f = await fixture(t, { mode: "controlled" }); await f.enqueue("later");
  if (kind === "cancel") await f.tasks.cancel(f.task.taskId);
  else if (kind === "revoke") { await f.tasks.revoke(f.task.taskId); f.workers[0].finish(); }
  else { if (kind === "models") f.modelsAvailable = false; if (kind === "resources") f.resource = 1; f.workers[0].finish(kind === "failure"); }
  await until(async () => (await f.queue()).items[0].state === "paused"); await sleep(50); assert.equal(f.workers.length, 1);
});
test("binding changes and attachments are rejected before persistence or RPC", async (t) => {
  const f = await fixture(t), input = f.input("invalid", "steer");
  for (const patch of [{ thinking: "high" }, { modelId: "fixture/other" }, { accountId: "other" }, { mode: "controlled" }, { resourceRevision: 1 }]) await assert.rejects(f.command({ type: "deliverSupplement", taskId: f.task.taskId, expectedRevision: 0, input: { ...input, binding: { ...input.binding, ...patch } } }), { code: "INPUT_BINDING_CHANGED" });
  await assert.rejects(f.command({ type: "deliverSupplement", taskId: f.task.taskId, expectedRevision: 0, input: { ...input, materialSnapshotIds: ["attachment"] } }), { code: "INPUT_MATERIALS_UNAVAILABLE" });
  assert.equal((await f.queue()).items.length, 0); assert.equal(f.calls.length, 0);
});
test("multi-window edit/delete use both revisions and only affect unsubmitted items", async (t) => {
  const f = await fixture(t), initial = await f.enqueue("edit");
  const command = { type: "editQueuedInput", input: { ...f.input("edit"), text: "edited" }, expectedRevision: initial.revision, expectedInputRevision: initial.items[0].revision };
  const results = await Promise.allSettled([f.command(command), f.command(command)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1); assert.equal(results.find((result) => result.status === "rejected").reason.code, "INPUT_REVISION_CONFLICT");
  const queue = await f.queue(); await f.command({ type: "removeQueuedInput", inputId: "edit", expectedRevision: queue.revision, expectedInputRevision: queue.items[0].revision });
  f.workers[0].finish(); await until(() => f.task.status === "succeeded"); await sleep(40); assert.equal(f.calls.length, 0);
});
test("expired authorization during async discovery cannot admit or deliver", async (t) => {
  const f = await fixture(t); let resolve, entered; const checking = new Promise((r) => { entered = r; }); let allowed = true;
  f.tasks.models = () => { entered(); return new Promise((r) => { resolve = r; }); };
  const pending = f.controller.command({ type: "deliverSupplement", target: f.target, taskId: f.task.taskId, input: f.input("auth", "steer"), expectedRevision: 0 }, { isAuthorized: () => allowed });
  await checking; allowed = false; resolve([{ id: "fixture/fixture", thinkingLevels: ["low"] }]);
  await assert.rejects(pending, { code: "AUTH_REQUIRED" }); assert.equal(f.calls.length, 0); assert.equal((await f.queue()).items.length, 0);
});
test("Host restart preserves pending inputs, pauses queued work and never schedules by itself", async (t) => {
  const f = await fixture(t); await f.enqueue("queue"); await f.enqueue("pending", "steer");
  f.controller.beginStop(); await f.tasks.stop(); await f.controller.close(); await f.store.close();
  const reopened = new HostInputStore({ configRoot: f.configRoot }); f.reopened = reopened; await reopened.load();
  const queue = await reopened.readQueue(f.scope); assert.equal(queue.items[0].state, "paused"); assert.equal(queue.items[1].state, "unknown");
  await sleep(30); assert.equal(f.calls.length, 1); assert.equal(f.workers.length, 1);
});
test("a paused, unsubmitted queue starts only after explicit revision-checked resume", async (t) => {
  const f = await fixture(t); await f.enqueue("recover"); f.workers[0].finish(true);
  await until(async () => (await f.queue()).items[0].state === "paused"); await Promise.all([...f.tasks.running.values()]);
  const paused = await f.queue(); assert.equal(f.workers.length, 1);
  await assert.rejects(f.command({ type: "resumeQueue", expectedRevision: 0 }), { code: "INPUT_REVISION_CONFLICT" }); assert.equal(f.workers.length, 1);
  await f.command({ type: "resumeQueue", expectedRevision: paused.revision });
  await until(async () => (await f.queue()).items[0].state === "consumed"); assert.equal(f.workers.length, 2);
});
test("a task settling during admission cannot silently turn a supplement into a new task", async (t) => {
  const f = await fixture(t); const original = f.tasks.models;
  f.tasks.models = async (accountId) => { f.workers[0].finish(); await Promise.all([...f.tasks.running.values()]); return original(accountId); };
  await assert.rejects(f.enqueue("race", "steer"), { code: "TASK_NOT_RUNNING" });
  assert.equal(f.calls.length, 0); assert.equal(f.workers.length, 1); assert.equal((await f.queue()).items.length, 0);
});
test("worker-side end race returns TASK_NOT_RUNNING and retains uncertain intent without creating a task", async (t) => {
  const f = await fixture(t); f.rejectLate = true;
  await assert.rejects(f.enqueue("late-worker", "steer"), { code: "TASK_NOT_RUNNING" });
  const queue = await f.queue(); assert.equal(queue.items[0].state, "unknown"); assert.equal(queue.items[0].pauseReason, "TASK_NOT_RUNNING"); assert.equal(f.calls.length, 0); assert.equal(f.workers.length, 1);
});
for (const phase of ["BEFORE_RENAME", "AFTER_RENAME"]) test(`storage failure at ${phase} cannot invoke Pi or report successful admission`, async (t) => {
  const f = await fixture(t); f.store.atomic = { failAtPhase: phase };
  await assert.rejects(f.enqueue("persist", "steer"), { code: phase === "BEFORE_RENAME" ? "INPUT_STORAGE_FAILED" : "INPUT_STORAGE_RECONCILIATION_REQUIRED" });
  assert.equal(f.calls.length, 0); f.store.atomic = {};
  if (phase === "BEFORE_RENAME") assert.equal((await f.queue()).items.length, 0);
  else await assert.rejects(f.queue(), { code: "INPUT_STORAGE_RECONCILIATION_REQUIRED" });
});
test("persisted branch receipts survive compaction, exclude siblings and reject malformed trees", async (t) => {
  const f = await fixture(t); const queue = await f.enqueue("history", "steer"), item = queue.items[0];
  const entry = carrier(item, "consumed"), sibling = { type: "message", id: "sibling", parentId: null, message: { role: "user", content: "other branch" } };
  const header = JSON.parse((await fs.readFile(f.workers[0].file, "utf8")).split("\n")[0]);
  const publish = (entries) => fs.writeFile(f.workers[0].file, [header, ...entries].map(JSON.stringify).join("\n") + "\n");
  await publish([entry, { type: "compaction", id: "compact", parentId: entry.id, firstKeptEntryId: "compact", summary: "fixture", tokensBefore: 1 }]);
  assert.equal((await f.catalog.inputReceipt(item)).entryId, "consumed");
  assert.equal((await f.catalog.history(f.catalog.listSessions(f.scope.projectId)[0].sessionKey)).messages[0].role, "user");
  await publish([entry, sibling]); assert.equal(await f.catalog.inputReceipt(item), null);
  for (const bad of [[entry, entry], [{ ...entry, parentId: "missing" }], [{ ...entry, parentId: entry.id }]]) { await publish(bad); await assert.rejects(f.catalog.inputReceipt(item), { code: "SESSION_TREE_INVALID" }); }
  await publish([entry]); await fs.appendFile(f.workers[0].file, "{broken\n"); await assert.rejects(f.catalog.inputReceipt(item), { code: "SESSION_TREE_INVALID" });
  // Prevent shutdown reconciliation of this intentionally corrupt fixture.
  await publish([entry]);
});

// GP110-02: a Pi-side abort must stop FIFO even without a Host cancel command.
test("Pi aborted settlement persists cancelled status and pauses the next input", async (t) => {
  const f = await fixture(t);
  await f.enqueue("after-abort");
  f.workers[0].emit("event", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial" }], stopReason: "aborted", durationMs: 17 } });
  f.workers[0].emit("event", { type: "agent_settled", aborted: true });
  await Promise.all([...f.tasks.running.values()]);
  await until(async () => (await f.queue()).items[0].state !== "queued");
  const current = f.tasks.public(f.task);
  assert.equal(current.status, "cancelled");
  assert.deepEqual(current.settlement, { aborted: true });
  assert.equal(current.messages.at(-1).durationMs, 17);
  assert.equal(current.messages.at(-1).stopReason, "aborted");
  assert.equal((await f.queue()).items[0].state, "paused");
  assert.equal(f.workers.length, 1);
  const saved = JSON.parse(await fs.readFile(f.tasks.file, "utf8")).tasks.find(task => task.taskId === current.taskId);
  assert.deepEqual(saved.settlement, current.settlement);
});

test("Pi handled prompt completes without waiting for an agent run or claiming consumption", async (t) => {
  const f = await fixture(t, { promptDisposition: "handled" });
  await until(() => f.task.status === "succeeded");
  await Promise.all([...f.tasks.running.values()]);
  assert.deepEqual(f.tasks.public(f.task).inputFeedback, [{ inputId: null, source: "pi-prompt", disposition: "handled" }]);
  assert.equal(f.task.settlement ?? null, null);
  assert.equal(f.calls.length, 0);
  const state = JSON.parse(await fs.readFile(f.tasks.file, "utf8"));
  assert.deepEqual(state.tasks[0].inputFeedback, [{ inputId: null, source: "pi-prompt", disposition: "handled" }]);
});
