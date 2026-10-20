import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createMcpHost, providerReply, until, untilPiInitialized, mcpReception } from "./fixtures/mcp-host.mjs";

async function configured(t, options = {}, mode) {
  const f = await createMcpHost(options); t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, ...(mode ? { env: { F_MODE: mode } } : {}) } });
  await f.mcp({ type: "enable", revision: 1, name: "local", enabled: true }); return f;
}
const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
const awaiting = async (f, id) => {
  await untilPiInitialized(() => f.task(id));
  return until(() => f.task(id), (task) => task.approvals.length > 0 || terminal(task), "approval or terminal");
};
const reply = (f, task, value) => f.request("/api/command", { type: "answerApproval", taskId: task.taskId, approvalId: task.approvals[0].approvalId, value });
const readRun = async (f, id) => (await f.mcp({ type: "status" })).runs.find((run) => run.taskId === id);
const reception = mcpReception;

test("single-process admission physically refuses child creation", { timeout: 15000 }, async (t) => {
  const f = await configured(t, {}, "fork"), started = await f.start(), waiting = await awaiting(f, started.taskId);
  const run = await readRun(f, started.taskId), received = await reception(run);
  assert.ok(received.some((item) => item.type === "fork-attempt"));
  await assert.rejects(fs.access(path.join(run.processes[0].runtimeDir, "forked")), { code: "ENOENT" });
  if (waiting.approvals.length) await reply(f, waiting, "拒绝");
});

test("discovery startup cannot read project data before per-call approval", { timeout: 15000 }, async (t) => {
  const f = await configured(t, {}, "read-before-approval"), started = await f.start(), waiting = await awaiting(f, started.taskId);
  const run = await readRun(f, started.taskId), received = await reception(run);
  assert.ok(["EPERM", "EACCES"].includes(received.find((item) => item.type === "startup-read").code));
  await reply(f, waiting, "拒绝");
});

test("real credentials use references, revocation blocks a pending call, and cross-project reuse never starts", { timeout: 25000 }, async (t) => {
  const f = await configured(t);
  const state = await f.mcp({ type: "credential", revision: 2, name: "local", envName: "MCP_TOKEN", value: "synthetic-mcp-credential" });
  assert.equal(JSON.stringify(state).includes("synthetic-mcp-credential"), false);
  const started = await f.start(), waiting = await awaiting(f, started.taskId), run = await readRun(f, started.taskId);
  assert.equal((await reception(run))[0].credentialPresent, true);
  await f.mcp({ type: "revokeCredential", revision: 3, name: "local", envName: "MCP_TOKEN" });
  await reply(f, waiting, "仅本次"); await until(() => f.task(started.taskId), terminal, "credential revoked");
  assert.equal((await reception(await readRun(f, started.taskId))).filter((item) => item.type === "call").length, 0);
  const other = path.join(f.root, "other"); await fs.mkdir(other); await fs.writeFile(path.join(other, "README.md"), "other project");
  const project = await f.request("/api/command", { type: "addProject", path: other });
  await f.request("/api/mcp", { type: "save", projectId: project.projectId, revision: 4, server: { ...f.server, enabled: true, credentialRefs: state.servers[0].credentialRefs } });
  const next = await f.start({ projectId: project.projectId }); await untilPiInitialized(() => f.task(next.taskId));
  const done = await until(() => f.task(next.taskId), terminal, "foreign credential denied");
  assert.equal(done.error, "MCP_CREDENTIAL_BINDING_CHANGED");
  const status = await f.request("/api/mcp", { type: "status", projectId: project.projectId }); assert.equal(status.runs.at(-1).processes.length, 0);
});

test("a crashed Pi owner leaves its actual service visible and prevents release and replacement", { timeout: 20000 }, async (t) => {
  const f = await createMcpHost();
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: "orphan" }, enabled: true } });
  const started = await f.start(), waiting = await awaiting(f, started.taskId), run = await readRun(f, started.taskId);
  const { groupAlive, processIdentity } = await import("../packages/host/ownership.mjs");
  t.after(async () => {
    for (const entry of run.processes) if (groupAlive(entry.pid) && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL");
    await until(() => run.processes.every((entry) => !groupAlive(entry.pid)), Boolean, "owned fixture orphan cleanup");
    await f.close({ unconfirmed: true });
  });
  assert.equal(waiting.approvals.length, 1);
  process.kill(run.ownerPid, "SIGKILL");
  const failed = await until(() => f.task(started.taskId), terminal, "owner crash");
  assert.equal(failed.error, "RPC_TERMINATION_UNCONFIRMED");
  const orphan = await readRun(f, started.taskId); assert.equal(orphan.status, "reconciliation"); assert.equal(orphan.processes[0].alive, true);
  const persisted = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/host/tasks.json"), "utf8")).tasks.find((task) => task.taskId === started.taskId);
  assert.equal(persisted.worker.pid, run.ownerPid, "worker reservation must be retained");
  const { McpRuns } = await import("../packages/mcp/runs.mjs");
  await assert.rejects(new McpRuns(f.config).begin({ taskId: "replacement", projectPath: f.project, revision: 1 }), { code: "MCP_PROCESS_RECONCILIATION_REQUIRED" });
});

test("denial and pending revocation receive zero calls and reject late approval", { timeout: 30000 }, async (t) => {
  const f = await configured(t);
  for (const action of ["deny", "revoke", "cancel"]) {
    const started = await f.start(), waiting = await awaiting(f, started.taskId); assert.equal(waiting.approvals.length, 1);
    if (action === "deny") await reply(f, waiting, "拒绝");
    else await f.request("/api/command", { type: action === "revoke" ? "revokeTask" : "cancelTask", taskId: started.taskId }, action === "cancel" ? 202 : 200);
    await until(() => f.task(started.taskId), terminal, "termination");
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" }, 409);
    const run = await readRun(f, started.taskId); assert.equal((await reception(run)).filter((item) => item.type === "call").length, 0); assert.equal(run.status, "stopped");
  }
});

test("task grant reuses one approval for two actual reads, then expires before a new task", { timeout: 30000 }, async (t) => {
  const f = await configured(t, { respond: ({ body, res }) => providerReply(res, body.messages.filter((message) => message.role === "tool").length < 2 ? "mcp__local__read_file" : null, { path: "README.md" }) });
  const started = await f.start(), waiting = await awaiting(f, started.taskId); await reply(f, waiting, "本任务");
  const done = await until(() => f.task(started.taskId), terminal, "two reads"); assert.equal(done.status, "succeeded");
  const run = await readRun(f, started.taskId); assert.equal((await reception(run)).filter((item) => item.type === "call").length, 2); assert.deepEqual(run.calls.map((call) => call.authorization), ["task", "task"]);
  const next = await f.start(), prompt = await awaiting(f, next.taskId); assert.equal(prompt.approvals.length, 1); await reply(f, prompt, "拒绝");
});

// Independent hosts need independent startup and cleanup deadlines.
for (const [name, mode, args] of [
  ["read definition change", "list-change", { path: "README.md" }],
  ["oversized read input", null, { path: "x".repeat(17000) }],
  ["undeclared read field", null, { path: "README.md", extra: "undeclared" }],
  ["outside read path", null, { path: "../outside" }],
]) test(`${name} reaches zero tool calls`, { timeout: 45000 }, async (t) => {
  const f = await configured(t, { respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "mcp__local__read_file", args) }, mode);
  const started = await f.start(); await untilPiInitialized(() => f.task(started.taskId));
  await until(() => f.task(started.taskId), terminal, "denied input");
  const run = await readRun(f, started.taskId); assert.equal((await reception(run)).filter((item) => item.type === "call").length, 0);
  await f.close();
});

test("readOnlyHint cannot grant writes: startup and tool effects are physically denied", { timeout: 20000 }, async (t) => {
  const f = await configured(t, {}, "readonly-sideeffect"), original = await fs.readFile(path.join(f.project, "README.md"), "utf8");
  const started = await f.start(), waiting = await awaiting(f, started.taskId); await reply(f, waiting, "仅本次");
  await until(() => f.task(started.taskId), terminal, "sandboxed read");
  const received = await reception(await readRun(f, started.taskId));
  assert.ok(received.filter((item) => ["startup-write", "tool-write"].includes(item.type)).every((item) => ["EPERM", "EACCES"].includes(item.code)));
  assert.equal(received.filter((item) => item.type === "tool-write").length, 1);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), original);
});

for (const mode of ["crash", "large-output"]) test(`${mode} retains UNKNOWN with one independent reception and no replay`, { timeout: 30000 }, async (t) => {
  const f = await configured(t, {}, mode), started = await f.start(), waiting = await awaiting(f, started.taskId); await reply(f, waiting, "仅本次");
  await until(() => f.task(started.taskId), terminal, "unknown result");
  const run = await readRun(f, started.taskId); assert.equal(run.calls[0].status, "unknown"); assert.equal((await reception(run)).filter((item) => item.type === "call").length, 1); assert.ok(run.processes.every((entry) => !entry.alive));
  await f.close();
});

test("editing the future configuration keeps the old task target; explicit disable rejects its pending call", { timeout: 25000 }, async (t) => {
  const f = await configured(t), started = await f.start(), waiting = await awaiting(f, started.taskId);
  await f.mcp({ type: "save", revision: 2, server: { ...f.server, enabled: true, args: [...f.server.args, "future-only"] } });
  await reply(f, waiting, "仅本次"); await until(() => f.task(started.taskId), terminal, "snapshot read");
  assert.equal((await readRun(f, started.taskId)).revision, 2);
  const next = await f.start(), pending = await awaiting(f, next.taskId); assert.equal((await readRun(f, next.taskId)).revision, 3);
  await f.mcp({ type: "enable", revision: 3, name: "local", enabled: false });
  await reply(f, pending, "仅本次"); await until(() => f.task(next.taskId), terminal, "revoked read");
  assert.equal((await reception(await readRun(f, next.taskId))).filter((item) => item.type === "call").length, 0);
  await f.restart(); assert.equal((await f.mcp({ type: "list" })).servers[0].enabled, false);
});
