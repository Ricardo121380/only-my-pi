import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { HostTasks } from "../packages/host/tasks.mjs";

test("task effort is capability-bound, verified before prompt, idempotent and usage survives restart", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-task-metrics-")));
  t.after(() => fs.rm(root, { recursive: true }));
  let mismatch = false;
  const calls = [];
  class Worker extends EventEmitter {
    identity = null;
    async start() { return { sessionId: "metrics-session", thinkingLevel: "off" }; }
    async command(type, fields) {
      calls.push(type);
      if (type === "set_thinking_level") this.level = fields.level;
      if (type === "get_state") return { thinkingLevel: mismatch ? "off" : this.level };
      if (type === "prompt") {
        this.emit("event", { type: "message_end", message: { role: "assistant", content: [], usage: { input: 70, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: 120, cost: { total: 0 } } } });
        this.emit("event", { type: "tool_execution_start", toolName: "read" });
        this.emit("event", { type: "tool_execution_end", toolName: "read", result: { content: [] } });
        this.emit("event", { type: "agent_settled" });
      }
    }
    async stop() {}
  }
  const options = { configRoot: root, stack: {}, catalog: { sessionRoot: root, project: () => ({ projectId: "project", path: root, available: true }), scan: async () => {} },
    models: async () => [{ id: "fixture/model", thinkingLevels: ["off", "low", "high"] }], workerFactory: () => new Worker() };
  const tasks = new HostTasks(options); await tasks.load(); t.after(() => tasks.stop());
  const request = { requestId: "effort", projectId: "project", model: "fixture/model", prompt: "inspect", thinkingLevel: "low" };
  await assert.rejects(tasks.start({ ...request, thinkingLevel: "xhigh" }), { code: "THINKING_LEVEL_UNAVAILABLE" });
  const task = await tasks.start(request); await Promise.all([...tasks.running.values()]);
  assert.deepEqual(calls, ["set_thinking_level", "get_state", "prompt"]);
  const result = tasks.public(tasks.tasks.get(task.taskId));
  assert.equal(result.status, "succeeded"); assert.equal(result.thinkingLevel, "low");
  assert.equal(result.usage.tokens.totalTokens, 120); assert.equal(result.usage.tools, 1); assert.equal(result.usage.estimatedCost, null);
  await assert.rejects(tasks.start({ ...request, thinkingLevel: "high" }), { code: "REQUEST_ID_CONFLICT" });
  await tasks.stop();
  const restored = new HostTasks(options); await restored.load(); t.after(() => restored.stop());
  assert.deepEqual((await restored.start(request)).usage, result.usage);
  mismatch = true; calls.length = 0;
  const rejected = await restored.start({ ...request, requestId: "mismatch" }); await Promise.all([...restored.running.values()]);
  assert.equal(restored.tasks.get(rejected.taskId).error, "THINKING_LEVEL_MISMATCH");
  assert.deepEqual(calls, ["set_thinking_level", "get_state"], "never prompt when actual setting differs");
});
