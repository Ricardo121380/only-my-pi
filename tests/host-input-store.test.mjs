import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";
import { HostInputStore } from "../packages/host/input-store.mjs";
import { INPUT_LIMITS, inputDigest, validateInputShard } from "../packages/host/input-contracts.mjs";
import { startHost } from "../packages/host/server.mjs";

const scope = { projectId: "project_a", sessionId: "session_a" };
const content = (inputId, overrides = {}) => ({ inputId, delivery: "queue", text: "完整输入", materialSnapshotIds: [],
  binding: { accountId: "cli-readonly", modelId: "mock/test", thinking: "low", mode: "readonly", resourceRevision: 1 }, ...overrides });
async function fixture(t, atomic = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-input-store-"))), configRoot = path.join(root, "config");
  const stores = [];
  t.after(async () => { await Promise.all(stores.map((store) => store.close())); await fs.rm(root, { recursive: true, force: true }); });
  const make = (options = {}) => { const store = new HostInputStore({ configRoot, ...options }); stores.push(store); return store; };
  const store = make({ atomic }); await store.load();
  return { root, configRoot, store, make, read: (kind, target = scope) => fs.readFile(store.file(kind, target), "utf8") };
}
const cas = (queue, inputId = queue.items.at(-1).inputId) => ({ expectedRevision: queue.revision, expectedInputRevision: queue.items.find((item) => item.inputId === inputId).revision });

test("drafts preserve full input and binding, isolate projects/sessions/new work, and expose no grants", async (t) => {
  const f = await fixture(t), long = "需求与代码\n".repeat(3000);
  const first = await f.store.saveDraft(scope, content("draft_a", { text: long }), { expectedRevision: 0 });
  assert.equal(first.draft.text, long); assert.equal(first.draft.revision, 1);
  assert.deepEqual(first.draft.binding, content("draft_a").binding);
  const targets = [{ projectId: "project_b", sessionId: "session_a" }, { projectId: "project_a", sessionId: "session_b" }, { projectId: "project_a", sessionId: null }];
  for (const [index, target] of targets.entries()) await f.store.saveDraft(target, content(`draft_${index}`, { delivery: "prompt", text: `other_${index}` }), { expectedRevision: 0 });
  assert.equal((await f.store.readDraft(scope)).draft.text, long);
  const copy = await f.store.readDraft(scope); copy.draft.text = "mutated return value";
  assert.equal((await f.store.readDraft(scope)).draft.text, long);
  assert.throws(() => f.store.saveDraft(scope, content("secret", { binding: { ...content("secret").binding, grant: "forbidden" } }), { expectedRevision: 1 }), { code: "INPUT_CONTENT_INVALID" });
  assert.throws(() => f.store.saveDraft(scope, { ...content("secret"), apiKey: "forbidden" }, { expectedRevision: 1 }), { code: "INPUT_CONTENT_INVALID" });
  const directories = [f.store.root, path.join(f.store.root, "drafts"), path.join(f.store.root, "queues")];
  for (const directory of directories) assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(f.store.file("draft", scope))).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(first).includes("grant"), false);
});

test("two windows race one draft revision; only one saves and stale clearing cannot discard it", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([f.store.saveDraft(scope, content("draft", { text: "window_a" }), { expectedRevision: 0 }), f.store.saveDraft(scope, content("draft", { text: "window_b" }), { expectedRevision: 0 })]);
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.equal(results[1].reason.code, "INPUT_REVISION_CONFLICT");
  await assert.rejects(f.store.clearDraft(scope, { expectedRevision: 0 }), { code: "INPUT_REVISION_CONFLICT" });
  assert.equal((await f.store.readDraft(scope)).draft.text, "window_a");
  await f.store.clearDraft(scope, { expectedRevision: 1 });
  assert.equal((await f.store.readDraft(scope)).draft, null);
});

test("serial admission snapshots caller data before an asynchronous save", async (t) => {
  const f = await fixture(t), target = { ...scope }, input = content("immutable"), version = { expectedRevision: 0 };
  const pending = f.store.saveDraft(target, input, version);
  target.projectId = "switched"; input.binding.modelId = "mock/other"; input.text = "later"; version.expectedRevision = 9;
  const saved = await pending;
  assert.deepEqual(saved.scope, scope); assert.equal(saved.draft.text, "完整输入"); assert.equal(saved.draft.binding.modelId, "mock/test");
});

test("queue insertion is FIFO, same ID/content is idempotent, altered content or scope conflicts", async (t) => {
  const f = await fixture(t), firstInput = content("input_1");
  const [first, duplicate] = await Promise.all([f.store.enqueue(scope, firstInput, { expectedRevision: 0 }), f.store.enqueue(scope, firstInput, { expectedRevision: 0 })]);
  assert.deepEqual(first, duplicate); assert.equal(first.items.length, 1);
  await assert.rejects(f.store.enqueue(scope, { ...firstInput, text: "changed" }, { expectedRevision: 1 }), { code: "INPUT_ID_CONFLICT" });
  await assert.rejects(f.store.enqueue({ ...scope, projectId: "other" }, firstInput, { expectedRevision: 0 }), { code: "INPUT_ID_CONFLICT" });
  let queue = await f.store.enqueue(scope, content("input_2"), { expectedRevision: 1 });
  queue = await f.store.enqueue(scope, content("input_3"), { expectedRevision: 2 });
  assert.deepEqual(queue.items.map((item) => item.inputId), ["input_1", "input_2", "input_3"]);
  await assert.rejects(f.store.enqueue(scope, content("input_4"), { expectedRevision: 0 }), { code: "INPUT_REVISION_CONFLICT" });
});

test("binding, material versions and whitespace participate in canonical effective-content identity", () => {
  const base = content("input");
  const same = { ...base, binding: { resourceRevision: 1, mode: "readonly", thinking: "low", modelId: "mock/test", accountId: "cli-readonly" } };
  assert.equal(inputDigest(scope, base), inputDigest(scope, same));
  for (const value of [content("input", { text: base.text + " " }), content("input", { materialSnapshotIds: ["snapshot"] }), content("input", { binding: { ...base.binding, resourceRevision: 2 } }), content("input", { binding: { ...base.binding, accountId: "another" } }), content("input", { delivery: "steer" })]) assert.notEqual(inputDigest(scope, base), inputDigest(scope, value));
  assert.notEqual(inputDigest(scope, base), inputDigest({ ...scope, sessionId: "another" }, base));
});

test("edit/dispatch CAS races cannot overwrite in-flight input; terminal/unknown states cannot be withdrawn or replayed", async (t) => {
  const f = await fixture(t);
  let queue = await f.store.enqueue(scope, content("first"), { expectedRevision: 0 });
  queue = await f.store.editQueued(scope, content("first", { text: "edited", binding: { ...content("first").binding, thinking: "high" } }), cas(queue));
  assert.equal(queue.items[0].text, "edited"); assert.equal(queue.items[0].binding.thinking, "high");
  const results = await Promise.allSettled([f.store.transition(scope, "first", { ...cas(queue), state: "dispatching", taskId: "task_a" }), f.store.editQueued(scope, content("first", { text: "stale" }), cas(queue))]);
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].reason.code, "INPUT_REVISION_CONFLICT");
  queue = await f.store.readQueue(scope);
  await assert.rejects(f.store.editQueued(scope, content("first"), cas(queue)), { code: "INPUT_NOT_EDITABLE" });
  await assert.rejects(f.store.transition(scope, "first", { ...cas(queue), state: "removed" }), { code: "INPUT_TRANSITION_INVALID" });
  await assert.rejects(f.store.transition(scope, "first", { ...cas(queue), state: "accepted", taskId: "task_b" }), { code: "INPUT_TASK_CONFLICT" });
  queue = await f.store.transition(scope, "first", { ...cas(queue), state: "accepted" });
  queue = await f.store.transition(scope, "first", { ...cas(queue), state: "unknown", pauseReason: "ACK_LOST" });
  await assert.rejects(f.store.transition(scope, "first", { ...cas(queue), state: "queued" }), { code: "INPUT_TRANSITION_INVALID" });
  queue = await f.store.transition(scope, "first", { ...cas(queue), state: "consumed", consumedEntryId: "entry_a" });
  assert.equal(queue.items[0].consumedEntryId, "entry_a");
  await assert.rejects(f.store.transition(scope, "first", { ...cas(queue), state: "removed" }), { code: "INPUT_TRANSITION_INVALID" });
});

test("only undelivered items can pause, resume explicitly, edit or become removed tombstones", async (t) => {
  const f = await fixture(t);
  let queue = await f.store.enqueue(scope, content("pending"), { expectedRevision: 0 });
  queue = await f.store.transition(scope, "pending", { ...cas(queue), state: "paused", pauseReason: "TASK_CANCELLED" });
  queue = await f.store.editQueued(scope, content("pending", { text: "after failure" }), cas(queue));
  assert.equal(queue.items[0].state, "paused"); assert.equal(queue.items[0].pauseReason, "TASK_CANCELLED");
  queue = await f.store.transition(scope, "pending", { ...cas(queue), state: "queued" });
  assert.equal(queue.items[0].pauseReason, null);
  queue = await f.store.transition(scope, "pending", { ...cas(queue), state: "removed" });
  assert.equal(queue.items[0].text, "after failure"); assert.equal(queue.items[0].state, "removed");
  assert.deepEqual(await f.store.enqueue(scope, content("pending", { text: "after failure" }), { expectedRevision: 0 }), queue);
});

test("restart preserves drafts and bindings, pauses queued items, marks in-flight unknown, never recovers a grant", async (t) => {
  const f = await fixture(t);
  await f.store.saveDraft(scope, content("draft"), { expectedRevision: 0 });
  let queue = await f.store.enqueue(scope, content("queued"), { expectedRevision: 0 });
  queue = await f.store.enqueue(scope, content("dispatching"), { expectedRevision: queue.revision });
  queue = await f.store.enqueue(scope, content("accepted"), { expectedRevision: queue.revision });
  queue = await f.store.enqueue(scope, content("consumed"), { expectedRevision: queue.revision });
  for (const id of ["dispatching", "accepted", "consumed"]) queue = await f.store.transition(scope, id, { ...cas(queue, id), state: "dispatching", taskId: `task_${id}` });
  for (const id of ["accepted", "consumed"]) queue = await f.store.transition(scope, id, { ...cas(queue, id), state: "accepted" });
  queue = await f.store.transition(scope, "consumed", { ...cas(queue, "consumed"), state: "consumed", consumedEntryId: "real_entry" });
  const original = await f.read("draft"), originalRevision = queue.revision;
  await f.store.close();
  const recovered = f.make(); assert.deepEqual(await recovered.load(), { paused: 1, unknown: 2 });
  queue = await recovered.readQueue(scope);
  assert.deepEqual(queue.items.map((item) => item.state), ["paused", "unknown", "unknown", "consumed"]);
  assert.equal(queue.revision, originalRevision + 1); assert.equal(await f.read("draft"), original);
  assert(queue.items.slice(0, 3).every((item) => item.pauseReason === "HOST_RESTARTED"));
  assert(queue.items.every((item) => item.binding.resourceRevision === 1));
  const saved = await f.read("queue"); await recovered.close();
  const again = f.make(); assert.deepEqual(await again.load(), { paused: 0, unknown: 0 });
  assert.equal(await f.read("queue"), saved);
});

test("before-rename failure preserves old content and does not poison an explicit later retry", async (t) => {
  let fail = false;
  const f = await fixture(t, { onPhase(phase) { if (fail && phase === "BEFORE_RENAME") throw new Error("injected"); } });
  await f.store.saveDraft(scope, content("draft"), { expectedRevision: 0 }); const original = await f.read("draft");
  fail = true;
  await assert.rejects(f.store.saveDraft(scope, content("draft", { text: "new" }), { expectedRevision: 1 }), { code: "INPUT_STORAGE_FAILED", atomicPublication: "NOT_PUBLISHED" });
  assert.equal(await f.read("draft"), original);
  fail = false; const saved = await f.store.saveDraft(scope, content("draft", { text: "retry" }), { expectedRevision: 1 });
  assert.equal(saved.revision, 2); assert.equal(saved.draft.text, "retry");
});

test("after-rename uncertainty is not acknowledged and blocks all admission until reopened/reconciled", async (t) => {
  const f = await fixture(t, { failAtPhase: "AFTER_RENAME" });
  await assert.rejects(f.store.enqueue(scope, content("maybe"), { expectedRevision: 0 }), { code: "INPUT_STORAGE_RECONCILIATION_REQUIRED", atomicPublication: "PUBLISHED_NOT_CONFIRMED_DURABLE" });
  await assert.rejects(f.store.enqueue(scope, content("another"), { expectedRevision: 0 }), { code: "INPUT_STORAGE_RECONCILIATION_REQUIRED" });
  const published = JSON.parse(await f.read("queue")); assert.equal(published.items[0].state, "queued");
  await f.store.close(); const recovered = f.make(); await recovered.load();
  assert.equal((await recovered.readQueue(scope)).items[0].state, "paused");
});

test("unknown schemas, malformed JSON, digest drift and scope substitution are preserved, never reset", async (t) => {
  const f = await fixture(t);
  const good = await f.store.saveDraft(scope, content("draft"), { expectedRevision: 0 }); await f.store.close();
  const invalid = [JSON.stringify({ ...good, schemaVersion: 2 }), "{", "", JSON.stringify({ ...good, draft: { ...good.draft, text: "tampered" } }), JSON.stringify({ ...good, scope: { ...scope, projectId: "other" }, draft: { ...good.draft, projectId: "other", contentDigest: inputDigest({ ...scope, projectId: "other" }, good.draft) } })];
  for (const bytes of invalid) {
    await fs.writeFile(f.store.file("draft", scope), bytes, { mode: 0o600 });
    const next = f.make(); await assert.rejects(next.load()); assert.equal(await f.read("draft"), bytes);
  }
  await fs.writeFile(f.store.file("draft", scope), JSON.stringify(good), { mode: 0o600 });
  const restored = f.make(); await restored.load(); assert.equal((await restored.readDraft(scope)).draft.text, "完整输入");
});

test("a bad shard blocks recovery of all valid queues before any publication", async (t) => {
  const f = await fixture(t);
  await f.store.enqueue(scope, content("queued"), { expectedRevision: 0 });
  await f.store.saveDraft(scope, content("draft"), { expectedRevision: 0 });
  const original = await f.read("queue"); await f.store.close();
  await fs.writeFile(f.store.file("draft", scope), "bad", { mode: 0o600 });
  const next = f.make(); await assert.rejects(next.load(), { code: "MALFORMED_JSON" });
  assert.equal(await f.read("queue"), original);
});

test("queue corruption after load blocks read/edit/admission and preserves exact bytes", async (t) => {
  const f = await fixture(t), good = await f.store.enqueue(scope, content("original"), { expectedRevision: 0 });
  for (const bytes of ["{", JSON.stringify({ ...good, schemaVersion: 2 }), JSON.stringify({ ...good, items: [{ ...good.items[0], text: "digest drift" }] })]) {
    await fs.writeFile(f.store.file("queue", scope), bytes, { mode: 0o600 });
    await assert.rejects(f.store.readQueue(scope));
    await assert.rejects(f.store.enqueue(scope, content("extra"), { expectedRevision: good.revision }));
    await assert.rejects(f.store.editQueued(scope, content("original", { text: "must not replace" }), cas(good)));
    assert.equal(await f.read("queue"), bytes);
  }
});

test("draft corruption after load blocks clear/save without replacing content by empty defaults", async (t) => {
  const f = await fixture(t); await f.store.saveDraft(scope, content("original"), { expectedRevision: 0 });
  const bytes = "invalid original draft";
  await fs.writeFile(f.store.file("draft", scope), bytes, { mode: 0o600 });
  await assert.rejects(f.store.readDraft(scope));
  await assert.rejects(f.store.clearDraft(scope, { expectedRevision: 1 }));
  await assert.rejects(f.store.saveDraft(scope, content("new"), { expectedRevision: 1 }));
  assert.equal(await f.read("draft"), bytes);
});

test("schema bounds reject oversize/empty inputs, unbound supplements and invalid terminal evidence", async (t) => {
  const f = await fixture(t);
  assert.throws(() => f.store.saveDraft(scope, content("large", { text: "x".repeat(32769) }), { expectedRevision: 0 }), { code: "INPUT_CONTENT_INVALID" });
  assert.throws(() => f.store.saveDraft(scope, content("materials", { materialSnapshotIds: ["same", "same"] }), { expectedRevision: 0 }), { code: "INPUT_CONTENT_INVALID" });
  assert.throws(() => f.store.saveDraft(scope, content("bad_binding", { binding: { ...content("x").binding, resourceRevision: -1 } }), { expectedRevision: 0 }), { code: "INPUT_CONTENT_INVALID" });
  await assert.rejects(f.store.enqueue(scope, content("empty", { text: "  " }), { expectedRevision: 0 }), { code: "INPUT_EMPTY" });
  await assert.rejects(f.store.enqueue({ ...scope, sessionId: null }, content("unbound"), { expectedRevision: 0 }), { code: "INPUT_SESSION_REQUIRED" });
  await assert.rejects(f.store.enqueue({ ...scope, sessionId: null }, content("new_prompt", { delivery: "prompt" }), { expectedRevision: 0 }), { code: "INPUT_SESSION_REQUIRED" });
  let queue = await f.store.enqueue(scope, content("proof"), { expectedRevision: 0 });
  queue = await f.store.transition(scope, "proof", { ...cas(queue), state: "dispatching", taskId: "task" });
  await assert.rejects(f.store.transition(scope, "proof", { ...cas(queue), state: "consumed" }), { code: "INPUT_STATE_INVALID" });
  assert.equal((await f.store.readQueue(scope)).items[0].state, "dispatching");
  assert.throws(() => validateInputShard({ ...queue, items: [queue.items[0], queue.items[0]] }), { code: "INPUT_STATE_INVALID" });
});

test("exact text/material/record limits work; excess and unsafe permissions preserve the authoritative file", async (t) => {
  const f = await fixture(t), maximum = content("maximum", { text: "x".repeat(INPUT_LIMITS.text), materialSnapshotIds: Array.from({ length: 10 }, (_, index) => `material_${index}`) });
  assert.equal((await f.store.saveDraft(scope, maximum, { expectedRevision: 0 })).draft.text.length, INPUT_LIMITS.text);
  assert.throws(() => f.store.saveDraft(scope, { ...maximum, materialSnapshotIds: [...maximum.materialSnapshotIds, "overflow"] }, { expectedRevision: 1 }), { code: "INPUT_CONTENT_INVALID" });
  const first = await f.store.enqueue(scope, content("record_0"), { expectedRevision: 0 });
  const filled = { ...first, revision: INPUT_LIMITS.records, items: Array.from({ length: INPUT_LIMITS.records }, (_, index) => ({ ...first.items[0], inputId: `record_${index}` })) };
  await fs.writeFile(f.store.file("queue", scope), JSON.stringify(filled), { mode: 0o600 });
  assert.equal((await f.store.readQueue(scope)).items.length, INPUT_LIMITS.records);
  const before = await f.read("queue");
  await assert.rejects(f.store.enqueue(scope, content("too_many"), { expectedRevision: filled.revision }), { code: "INPUT_QUEUE_LIMIT" });
  assert.equal(await f.read("queue"), before);
  await fs.writeFile(f.store.file("queue", scope), Buffer.alloc(INPUT_LIMITS.shardBytes + 1, 32));
  await assert.rejects(f.store.readQueue(scope), { code: "INPUT_SHARD_LIMIT" });
  await fs.writeFile(f.store.file("queue", scope), before); await fs.chmod(f.store.file("queue", scope), 0o644);
  await assert.rejects(f.store.readQueue(scope), { code: "INPUT_FILE_UNSAFE" });
  await fs.chmod(f.store.file("queue", scope), 0o600);
});

test("storage has one cooperative owner and refuses symlinks without touching their targets", async (t) => {
  const f = await fixture(t), competing = f.make(); await assert.rejects(competing.load(), { code: "OWNERSHIP_HELD" });
  const outside = path.join(f.root, "untouched"); await fs.writeFile(outside, "original");
  await fs.symlink(outside, f.store.file("draft", scope));
  await assert.rejects(f.store.saveDraft(scope, content("draft"), { expectedRevision: 0 }), { code: "SYMLINK_ESCAPE" });
  assert.equal(await fs.readFile(outside, "utf8"), "original");
});

test("real child death before rename leaves only an unpublished temporary; recovery retains complete old draft", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.store.saveDraft(scope, content("draft", { text: "old complete" }), { expectedRevision: 0 }); await f.store.close();
  const entry = new URL("../packages/host/input-store.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {HostInputStore} from ${JSON.stringify(entry)}; setInterval(()=>{},1000); const store=new HostInputStore({configRoot:process.argv[1],atomic:{onPhase:async(phase)=>{if(phase==='BEFORE_RENAME'){process.stdout.write('waiting');await new Promise(()=>{});}}}}); await store.load(); await store.saveDraft(${JSON.stringify(scope)},${JSON.stringify(content("draft", { text: "new incomplete" }))},{expectedRevision:1});`, f.configRoot], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; } });
  await once(child.stdout, "data");
  const competing = f.make(); await assert.rejects(competing.load(), { code: "OWNERSHIP_HELD" });
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const recovered = f.make(); await recovered.load();
  assert.equal((await recovered.readDraft(scope)).draft.text, "old complete");
  assert.equal((await fs.readdir(path.join(recovered.root, "drafts"))).filter((name) => name.endsWith(".tmp")).length, 1);
});

test("real child death after rename preserves a complete queue but never automatically dispatches it", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.store.close();
  const entry = new URL("../packages/host/input-store.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import {HostInputStore} from ${JSON.stringify(entry)};setInterval(()=>{},1000);const store=new HostInputStore({configRoot:process.argv[1],atomic:{onPhase:async(phase)=>{if(phase==='AFTER_RENAME'){process.stdout.write('published');await new Promise(()=>{});}}}});await store.load();await store.enqueue(${JSON.stringify(scope)},${JSON.stringify(content("published"))},{expectedRevision:0});`, f.configRoot], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exit = once(child, "exit"); child.kill("SIGKILL"); await exit; } });
  await once(child.stdout, "data");
  const bytes = await f.read("queue"); assert.equal(JSON.parse(bytes).items[0].state, "queued");
  const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
  const recovered = f.make(); assert.deepEqual(await recovered.load(), { paused: 1, unknown: 0 });
  const queue = await recovered.readQueue(scope);
  assert.equal(queue.items[0].state, "paused"); assert.equal(queue.items[0].text, "完整输入");
});

test("Host restart owns storage lifecycle and never launches a worker for recovered inputs", { timeout: 15000 }, async (t) => {
  const f = await fixture(t); await f.store.enqueue(scope, content("queued"), { expectedRevision: 0 }); await f.store.close();
  const assetsRoot = path.join(f.root, "assets"); await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "fixture");
  let launches = 0;
  const options = { configRoot: f.configRoot, assetsRoot, stack: { stackId: "sha256:" + "a".repeat(64) }, modelsProvider: async () => [], workerFactory: () => { launches++; throw new Error("unexpected execution"); } };
  const host = await startHost(options); t.after(() => host.stop());
  assert.equal((await host.inputs.readQueue(scope)).items[0].state, "paused"); assert.equal(launches, 0);
  assert.deepEqual(host.snapshot().capabilities.inputs, { protocol: 1, materials: false, resourceRevision: 0 });
  const oldEpoch = host.epoch; await host.stop(); const next = await startHost(options); t.after(() => next.stop());
  assert.notEqual(next.epoch, oldEpoch); assert.equal(launches, 0); await next.stop();
});

test("close during initialization waits for the recovery publication and releases the storage owner", async (t) => {
  const f = await fixture(t); await f.store.enqueue(scope, content("pending"), { expectedRevision: 0 }); await f.store.close();
  let release, ready;
  const barrier = new Promise((resolve) => { release = resolve; }), entered = new Promise((resolve) => { ready = resolve; });
  const recovering = f.make({ atomic: { async onPhase(phase) { if (phase === "BEFORE_RENAME") { ready(); await barrier; } } } });
  const loading = recovering.load(); await entered;
  const closing = recovering.close(); const competing = f.make();
  await assert.rejects(competing.load(), { code: "OWNERSHIP_HELD" });
  release(); await loading; await closing;
  await assert.rejects(recovering.readQueue(scope), { code: "INPUT_STORE_UNAVAILABLE" });
  const next = f.make(); assert.deepEqual(await next.load(), { paused: 0, unknown: 0 });
  assert.equal((await next.readQueue(scope)).items[0].state, "paused");
});

test("100000 known input identities remain readable; new identities are refused before writing", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const first = await f.store.enqueue(scope, content("seed"), { expectedRevision: 0 }), prototype = first.items[0];
  for (let index = 0; index < INPUT_LIMITS.identities / INPUT_LIMITS.records; index++) {
    const target = index === 0 ? scope : { ...scope, sessionId: `capacity_${index}` }, digest = inputDigest(target, prototype);
    const items = Array.from({ length: INPUT_LIMITS.records }, (_, number) => ({ ...prototype, ...target, inputId: index === 0 && number === 0 ? "seed" : `identity_${index}_${number}`, contentDigest: digest }));
    const shard = { ...first, scope: target, revision: INPUT_LIMITS.records, items };
    await fs.writeFile(f.store.file("queue", target), JSON.stringify(shard), { mode: 0o600 });
    assert.equal((await f.store.readQueue(target)).items.length, INPUT_LIMITS.records);
  }
  const extra = { ...scope, sessionId: "overflow" };
  await assert.rejects(f.store.enqueue(extra, content("new_identity"), { expectedRevision: 0 }), { code: "INPUT_CATALOG_LIMIT" });
  await assert.rejects(fs.access(f.store.file("queue", extra)), { code: "ENOENT" });
  assert.equal((await f.store.readQueue(scope)).items[0].inputId, "seed");
});

test("10000 authoritative shards permit existing edits; a new shard is refused before publication", { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  await f.store.saveDraft(scope, content("seed"), { expectedRevision: 0 }); await f.store.close();
  for (let index = 1; index < INPUT_LIMITS.shards; index++) {
    const target = { ...scope, sessionId: `shard_${index}` };
    await fs.writeFile(f.store.file("draft", target), JSON.stringify({ schemaVersion: 1, kind: "draft", revision: 0, scope: target, draft: null }), { mode: 0o600 });
  }
  const loaded = f.make(); assert.deepEqual(await loaded.load(), { paused: 0, unknown: 0 });
  const extra = { ...scope, sessionId: "overflow" };
  await assert.rejects(loaded.saveDraft(extra, content("overflow"), { expectedRevision: 0 }), { code: "INPUT_SHARD_COUNT_LIMIT" });
  await assert.rejects(fs.access(loaded.file("draft", extra)), { code: "ENOENT" });
  const edited = await loaded.saveDraft(scope, content("seed", { text: "existing edits remain available" }), { expectedRevision: 1 });
  assert.equal(edited.draft.text, "existing edits remain available");
  assert.equal((await fs.readdir(path.join(loaded.root, "drafts"))).length, INPUT_LIMITS.shards);
});
