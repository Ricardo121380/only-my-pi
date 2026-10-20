import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { HostTasks } from "../packages/host/tasks.mjs";

test("task binding reaches worker, survives restart and participates in idempotency", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-binding-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const accounts = new AccountCatalog(root);
  const a = await accounts.create({ providerId: "fixture", name: "A", authType: "api_key" });
  const b = await accounts.create({ providerId: "fixture", name: "B", authType: "api_key" });
  const selected = [], launched = [];
  class Worker extends EventEmitter {
    identity = null;
    async start() { return { sessionId: "bound-session" }; }
    async command() { this.emit("event", { type: "agent_settled" }); }
    async stop() {}
  }
  const options = { configRoot: root, stack: {}, accounts,
    catalog: { sessionRoot: root, project: () => ({ projectId: "project", path: root, available: true }), scan: async () => {} },
    models: async (id) => { selected.push(id); return [{ id: "fixture/model" }]; },
    workerFactory: (args) => { launched.push(args.accountId); return new Worker(); },
  };
  const tasks = new HostTasks(options); await tasks.load();
  t.after(() => tasks.stop());
  const command = { requestId: "request", projectId: "project", model: "fixture/model", prompt: "inspect" };
  await assert.rejects(tasks.start(command), { code: "ACCOUNT_BINDING_REQUIRED" });
  await assert.rejects(tasks.start({ ...command, accountId: "missing" }), { code: "ACCOUNT_NOT_FOUND" });
  await assert.rejects(tasks.start({ ...command, accountId: a.accountId, model: "other/model" }), { code: "ACCOUNT_MODEL_MISMATCH" });
  const task = await tasks.start({ ...command, accountId: a.accountId });
  await Promise.all([...tasks.running.values()]);
  assert.deepEqual(selected, [a.accountId]); assert.deepEqual(launched, [a.accountId]);
  assert.equal(task.accountId, a.accountId);
  await assert.rejects(tasks.start({ ...command, accountId: b.accountId }), { code: "REQUEST_ID_CONFLICT" });
  await tasks.stop();
  const restored = new HostTasks(options); await restored.load(); t.after(() => restored.stop());
  const replay = await restored.start({ ...command, accountId: a.accountId });
  assert.equal(replay.taskId, task.taskId); assert.equal(replay.accountId, a.accountId);
  assert.equal(launched.length, 1);
  const legacy = new HostTasks({ ...options, accounts: undefined });
  await assert.rejects(legacy.start({ ...command, accountId: a.accountId }), { code: "ACCOUNT_BINDING_UNAVAILABLE" });
});

test("failed initial persistence releases reservation without launching a worker", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-storage-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "fixture", name: "A", authType: "api_key" });
  let launches = 0;
  const tasks = new HostTasks({ configRoot: root, stack: {}, accounts,
    catalog: { project: () => ({ projectId: "project", path: root, available: true }) },
    models: async () => [{ id: "fixture/model" }], workerFactory: () => { launches++; },
  });
  tasks.persist = async () => { throw new Error("fixture disk failure"); };
  const command = { requestId: "request", projectId: "project", model: "fixture/model", prompt: "inspect", accountId: account.accountId };
  await assert.rejects(tasks.start(command), { code: "HOST_STORAGE_FAILED" });
  assert.equal(launches, 0); assert.equal(tasks.tasks.size, 0); assert.equal(tasks.requests.size, 0);
  await accounts.rename(account.accountId, "Released");
  await assert.rejects(tasks.start(command), { code: "HOST_STORAGE_FAILED" });
});

test("account reservation spans model lookup, cancellation and confirmed worker exit", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-reservation-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "fixture", name: "A", authType: "api_key" });
  let resolveModels, started, stopped;
  const modelGate = new Promise((resolve) => { resolveModels = resolve; });
  const startGate = new Promise((resolve) => { started = resolve; });
  const stopGate = new Promise((resolve) => { stopped = resolve; });
  class Worker extends EventEmitter {
    identity = null;
    async start() { await startGate; return { sessionId: "reservation-session" }; }
    async cancel() {}
    async stop() { await stopGate; }
  }
  const tasks = new HostTasks({ configRoot: root, accounts, stack: {}, catalog: { sessionRoot: root, project: () => ({ projectId: "project", available: true, path: root }), scan: async () => {} }, models: () => modelGate, workerFactory: () => new Worker() });
  await tasks.load();
  t.after(async () => { started(); stopped(); await tasks.stop(); });
  const pending = tasks.start({ accountId: account.accountId, projectId: "project", requestId: "reserved", model: "fixture/model", prompt: "inspect" });
  await assert.rejects(accounts.remove(account.accountId), { code: "ACCOUNT_BUSY" });
  resolveModels([{ id: "fixture/model" }]);
  const task = await pending;
  await tasks.cancel(task.taskId); started();
  await assert.rejects(accounts.rename(account.accountId, "Too soon"), { code: "ACCOUNT_BUSY" });
  stopped(); await Promise.all([...tasks.running.values()]);
  assert.equal(tasks.tasks.get(task.taskId).status, "cancelled");
  await accounts.rename(account.accountId, "Released");
});

test("unconfirmed termination retains account and session ownership through failed shutdown", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-unconfirmed-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const accounts = new AccountCatalog(root);
  const account = await accounts.create({ providerId: "fixture", name: "A", authType: "api_key" });
  let allowStop = false;
  class Worker extends EventEmitter {
    identity = null;
    async start() { return { sessionId: "unconfirmed-session" }; }
    async command() { this.emit("event", { type: "agent_settled" }); }
    async stop() { if (!allowStop) throw Object.assign(new Error("fixture"), { code: "RPC_TERMINATION_UNCONFIRMED" }); }
  }
  const options = { configRoot: root, accounts, stack: {}, catalog: { sessionRoot: root, project: () => ({ projectId: "project", available: true, path: root }), scan: async () => {} }, models: async () => [{ id: "fixture/model" }], workerFactory: () => new Worker() };
  const tasks = new HostTasks(options); await tasks.load();
  t.after(async () => { allowStop = true; await tasks.stop(); });
  const task = await tasks.start({ accountId: account.accountId, projectId: "project", requestId: "unconfirmed", model: "fixture/model", prompt: "inspect" });
  await Promise.all([...tasks.running.values()]);
  assert.equal(tasks.tasks.get(task.taskId).error, "RPC_TERMINATION_UNCONFIRMED");
  assert.equal(tasks.workers.size, 1); assert.equal(tasks.leases.size, 1);
  await assert.rejects(accounts.remove(account.accountId), { code: "ACCOUNT_BUSY" });
  await assert.rejects(tasks.stop(), { code: "RPC_TERMINATION_UNCONFIRMED" });
  assert.equal(tasks.leases.size, 1);
  await assert.rejects(accounts.rename(account.accountId, "Premature"), { code: "ACCOUNT_BUSY" });
  await assert.rejects(new HostTasks(options).load(), { code: "WORKER_RECONCILIATION_REQUIRED" });
  allowStop = true; await tasks.stop();
  assert.equal(tasks.workers.size, 0); assert.equal(tasks.leases.size, 0);
  await accounts.rename(account.accountId, "Released");
  const restored = new HostTasks(options); await restored.load(); await restored.stop();
});
