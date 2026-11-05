import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createMinimalWebFixture } from "./fixtures/minimal-web.mjs";

async function until(read, accept) { for (let i = 0; i < 400; i++) { const value = await read(); if (accept(value)) return value; await delay(25); } assert.fail("minimal input condition not reached"); }
test("minimal public HTTP steers native Pi and consumes edited FIFO inputs once without inheriting grants", { timeout: 30000 }, async t => {
  const f = await createMinimalWebFixture({ streamDelay: 2000 }); t.after(async () => { await f.stop(); await f.cleanup(); });
  const origin = f.host.origin;
  const pair = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(f.host.pairingUrl).hash.slice(6) }) });
  const headers = { origin, cookie: pair.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" };
  async function post(route, body, extra = {}) { const r = await fetch(origin + "/api/" + route, { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }); assert.equal(r.status, body.type === "startTask" ? 202 : 200, JSON.stringify(await r.clone().json())); return r.json(); }
  const project = await post("command", { type: "addProject", path: f.f.project });
  const started = await post("command", { type: "startTask", projectId: project.projectId, requestId: randomUUID(), accountId: "cli-readonly", model: "fixture/one", thinkingLevel: "off", prompt: "read project" });
  const task = await until(async () => (await fetch(`${origin}/api/task?taskId=${started.taskId}`, { headers })).json(), value => value.partial?.includes("已收到工具结果"));
  assert.equal(task.resourceRevision, 0);
  const target = { projectId: project.projectId, taskId: task.taskId };
  const read = () => post("input-command", { type: "getInputs", target });
  assert.equal((await fetch(origin + "/api/input-command", { method: "POST", headers: { ...headers, "x-omp-input-protocol": "0" }, body: JSON.stringify({ type: "getInputs", target }) })).status, 409);
  const input = (delivery, text) => ({ inputId: randomUUID(), delivery, text, materialSnapshotIds: [], binding: { accountId: task.accountId, modelId: task.model, thinking: task.thinkingLevel, mode: task.mode, resourceRevision: task.resourceRevision } });
  const steer = input("steer", "minimal steer accepted");
  let queue = await post("input-command", { type: "deliverSupplement", target, taskId: task.taskId, input: steer, expectedRevision: (await read()).queue.revision });
  assert.equal(queue.items[0].state, "accepted"); assert.equal(queue.items[0].consumedEntryId, null);
  const first = input("queue", "minimal queue first"), removed = input("queue", "minimal queue removed");
  for (const item of [first, removed]) queue = await post("input-command", { type: "enqueueInput", target, predecessorTaskId: task.taskId, input: item, expectedRevision: queue.revision });
  const old = queue.items.find(item => item.inputId === first.inputId);
  queue = await post("input-command", { type: "editQueuedInput", target, input: { ...first, text: "minimal queue edited" }, expectedRevision: queue.revision, expectedInputRevision: old.revision });
  const deletion = queue.items.find(item => item.inputId === removed.inputId);
  queue = await post("input-command", { type: "removeQueuedInput", target, inputId: removed.inputId, expectedRevision: queue.revision, expectedInputRevision: deletion.revision });
  const done = await until(read, value => value.queue.items.every(item => ["consumed", "removed"].includes(item.state)));
  await until(() => f.host.tasks.snapshot(), tasks => tasks.length === 2 && tasks.every(item => item.status === "succeeded"));
  assert.deepEqual(done.queue.items.map(item => item.state), ["consumed", "consumed", "removed"]);
  for (const item of done.queue.items.filter(item => item.state === "consumed")) assert.equal((await f.host.catalog.inputReceipt(item)).entryId, item.consumedEntryId);
  assert.equal(f.received.length, 4);
  assert.ok(JSON.stringify(f.received.at(-1).body.messages).includes("minimal queue edited"));
  assert.ok(!JSON.stringify(f.received.at(-1).body.messages).includes("minimal queue removed"));
  assert.ok(f.host.tasks.snapshot().every(item => item.access === "inspect" && !item.approvals.length));
  assert.equal(f.host.tasks.workers.size, 0);
});
