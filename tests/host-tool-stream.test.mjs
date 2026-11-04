import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { HostTasks } from "../packages/host/tasks.mjs";

test("parallel tool output stays with its call while another tool finishes", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-tool-stream-")));
  let worker, release;
  const ready = new Promise(resolve => { release = resolve; });
  class Worker extends EventEmitter {
    identity = null;
    async start() { return { sessionId: "stream-session" }; }
    async command() { release(); }
    async stop() { this.emit("event", { type: "agent_settled" }); }
  }
  const tasks = new HostTasks({ minimal: true, configRoot: root, stack: {}, models: async () => [{ id: "fixture/one" }],
    catalog: { sessionRoot: root, project: () => ({ projectId: "p", path: root, available: true }), scan: async () => {} },
    workerFactory: () => worker = new Worker() });
  t.after(async () => { await tasks.stop(); await fs.rm(root, { recursive: true }); });
  await tasks.load(); const task = await tasks.start({ requestId: "r", projectId: "p", model: "fixture/one", prompt: "tools" }); await ready;
  for (const [id, name] of [["a", "bash"], ["b", "read"]]) worker.emit("event", { type: "tool_execution_start", toolCallId: id, toolName: name, args: { path: path.join(root, "file.txt"), content: "private-tool-arguments" } });
  worker.emit("event", { type: "tool_execution_update", toolCallId: "a", toolName: "bash", partialResult: { content: [{ type: "text", text: "shell partial" }] } });
  let state = tasks.public(tasks.tasks.get(task.taskId));
  assert.equal(state.toolCalls[0].output, "shell partial"); assert.equal(state.toolCalls[1].output, undefined);
  assert.equal(state.toolCalls[0].filePath, undefined); assert.equal(state.toolCalls[1].filePath, "file.txt");
  assert.ok(!JSON.stringify(state).includes("private-tool-arguments"));
  worker.emit("event", { type: "tool_execution_end", toolCallId: "b", toolName: "read", result: { content: [{ type: "text", text: "read done" }] } });
  worker.emit("event", { type: "tool_execution_update", toolCallId: "a", toolName: "bash", partialResult: { content: [{ type: "text", text: "shell next" }] } });
  state = tasks.public(tasks.tasks.get(task.taskId));
  assert.equal(state.tool.name, "bash"); assert.equal(state.tool.output, "shell next"); assert.equal(state.toolCalls[1].status, "completed");
  assert.equal(state.messages.find(message => message.toolCallId === "b").filePath, "file.txt");
  worker.emit("event", { type: "agent_settled" }); await Promise.all([...tasks.running.values()]);
});
