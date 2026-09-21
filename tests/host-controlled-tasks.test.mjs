import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { HostTasks } from "../packages/host/tasks.mjs";
import { AccountCatalog } from "../packages/host/accounts.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

test("internal controlled tasks hold project ownership and approvals; public default stays readonly", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-control-task-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const accounts = new AccountCatalog(root), account = await accounts.create({ providerId: "fixture", name: "Fixture", authType: "api_key" });
  let ready, worker;
  const prompted = new Promise((resolve) => { ready = resolve; });
  class Worker extends EventEmitter {
    identity = null;
    async start() { return { sessionId: "controlled-task" }; }
    async command(_type, fields) { assert.equal(fields.message, "implement fixture"); this.emit("approvals", [{ approvalId: "approval", kind: "confirm", title: "Approve?" }]); ready(); }
    answerApproval(id, value) { assert.equal(id, "approval"); assert.equal(value, true); this.emit("approvals", []); this.emit("event", { type: "tool_execution_end", toolName: "request_coding_access", result: { details: { status: "CODING_ACCESS_GRANTED" } } }); }
    async revoke() { this.emit("approvals", []); }
    async stop() { this.emit("event", { type: "agent_settled" }); }
  }
  const options = { configRoot: root, stack: {}, accounts, catalog: { sessionRoot: root, project: () => ({ projectId: "project", path: root, available: true }), scan: async () => {} }, models: async () => [{ id: "fixture/model" }], workerFactory: (args) => { assert.equal(args.controlled, true); worker = new Worker(); return worker; } };
  const command = { requestId: "controlled", projectId: "project", accountId: account.accountId, model: "fixture/model", mode: "controlled", prompt: "implement fixture" };
  await assert.rejects(new HostTasks(options).start(command), { code: "CONTROLLED_MODE_UNAVAILABLE" });
  const tasks = new HostTasks({ ...options, allowControlled: true }); await tasks.load();
  t.after(() => tasks.stop());
  const task = await tasks.start(command); await prompted;
  await assert.rejects(acquireOwnership(root, "project", root), { code: "OWNERSHIP_HELD" });
  assert.equal(tasks.public(tasks.tasks.get(task.taskId)).approvals.length, 1);
  assert.equal((await tasks.answerApproval(task.taskId, "approval", true)).access, "coding");
  assert.equal((await tasks.revoke(task.taskId)).access, "inspect");
  // Revoking permission does not release a still-running worker's writer lease.
  await assert.rejects(acquireOwnership(root, "project", root), { code: "OWNERSHIP_HELD" });
  worker.emit("event", { type: "agent_settled" }); await Promise.all([...tasks.running.values()]);
  await assert.rejects(tasks.answerApproval(task.taskId, "approval", true), { code: "APPROVAL_EXPIRED" });
  const lease = await acquireOwnership(root, "project", root); await lease.release();
  const restored = new HostTasks(options); await restored.load();
  assert.equal(restored.snapshot()[0].access, "inspect"); assert.deepEqual(restored.snapshot()[0].approvals, []); await restored.stop();
});
