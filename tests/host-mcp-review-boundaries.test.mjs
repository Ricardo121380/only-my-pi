import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createMcpHost, until, mcpReception } from "./fixtures/mcp-host.mjs";
const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
const strings = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];

test("real escaped and unicode-escaped credential results never enter public Pi messages", { timeout: 40000 }, async (t) => {
  for (const [mode, secret] of [["secret-output", 'synthetic"secret'], ["unicode-secret-output", "synthetic-secret"]]) {
    const f = await createMcpHost(); t.after(() => f.close());
    await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: mode }, enabled: true } });
    await f.mcp({ type: "credential", revision: 1, name: "local", envName: "MCP_TOKEN", value: secret });
    const started = await f.start(), waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0 || terminal(task), "approval");
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
    const completed = await until(() => f.task(started.taskId), terminal, "secret rejected");
    assert.ok(strings(completed.messages).every((text) => !text.includes(secret)), "decoded secret reached public task");
    assert.ok(strings(f.requests.at(-1).body.messages).every((text) => !text.includes(secret)), "decoded secret reached model input");
    const run = (await f.mcp({ type: "status" })).runs.at(-1);
    assert.equal(run.calls[0].status, "unknown"); assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 1);
    await f.close();
  }
});
test("saving a disabled server revokes a pending actual task before any tool dispatch", { timeout: 20000 }, async (t) => {
  const f = await createMcpHost(); t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true } });
  const started = await f.start(), waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0, "approval");
  await f.mcp({ type: "save", revision: 1, server: f.server });
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" });
  await until(() => f.task(started.taskId), terminal, "disabled call denied");
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 0);
});
test("actual service has only fixed scratch slots and a kernel file size limit", { timeout: 20000 }, async (t) => {
  const f = await createMcpHost(); t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: "storage" }, enabled: true } });
  const started = await f.start(); await until(() => f.task(started.taskId), (task) => terminal(task) || task.approvals.length > 0, "storage limit or unsafe startup");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), received = await mcpReception(run);
  assert.ok(["EPERM", "EACCES"].includes(received.find((item) => item.type === "storage-extra").code));
  assert.ok((await fs.stat(path.join(run.processes[0].runtimeDir, "scratch"))).size <= 65536);
  assert.ok(run.processes.every((entry) => entry.status === "stopped" && !entry.alive));
  assert.equal(received.filter((item) => item.type === "call").length, 0);
});
