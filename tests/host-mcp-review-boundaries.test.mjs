import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { createMcpHost, until, mcpReception, providerReply } from "./fixtures/mcp-host.mjs";
const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
const strings = (value) => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.values(value).flatMap(strings) : [];
const exposed = (value, secret) => strings(value).some((text) => {
  if (text.includes(secret)) return true;
  try { return strings(JSON.parse(text)).some((decoded) => decoded.includes(secret)); } catch { return false; }
});

test("real escaped and unicode-escaped credential results never enter public Pi messages", { timeout: 40000 }, async (t) => {
  for (const [mode, secret] of [["secret-output", 'synthetic"secret'], ["unicode-secret-output", "synthetic-secret"], ["nested-secret-output", 'synthetic"secret']]) {
    const f = await createMcpHost(); t.after(() => f.close());
    await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: mode }, enabled: true } });
    await f.mcp({ type: "credential", revision: 1, name: "local", envName: "MCP_TOKEN", value: secret });
    const started = await f.start(), waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0 || terminal(task), "approval");
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
    const completed = await until(() => f.task(started.taskId), terminal, "secret rejected");
    assert.equal(exposed(completed.messages, secret), false, "recoverable secret reached public task");
    assert.equal(exposed(f.requests.at(-1).body.messages, secret), false, "recoverable secret reached model input");
    const run = (await f.mcp({ type: "status" })).runs.at(-1);
    assert.equal(run.calls[0].status, "unknown"); assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 1);
    await f.close();
  }
});

test("many complete MCP frames share one finite stdout allowance", { timeout: 20000 }, async (t) => {
  const f = await createMcpHost(); t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: "flood" }, enabled: true } });
  const started = await f.start(), waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0, "approval");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(started.taskId), terminal, "finite cumulative output");
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  assert.equal(run.calls[0].status, "unknown"); assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 1);
  assert.ok(run.processes.every((entry) => entry.status === "stopped" && !entry.alive));
});

for (const mode of ["readonly", "controlled"]) test(`journal quota failure cannot suppress ${mode} revocation and physical termination`, { timeout: 30000 }, async (t) => {
  const coding = { taskSummary: "Read controlled fixture", complexity: "simple", scope: ["README.md"], riskFlags: [], verification: ["read fixture"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const f = await createMcpHost({ installedExtensions: mode === "controlled", respond: ({ body, res }) => {
    const count = body.messages.filter((message) => message.role === "tool").length;
    providerReply(res, mode === "controlled" && count === 0 ? "request_coding_access" : "mcp__local__read_file", mode === "controlled" && count === 0 ? coding : { path: "README.md" });
  } });
  let cleanup = () => f.close(); t.after(() => cleanup());
  if (mode === "controlled") for (const args of [["init", "--quiet"], ["add", "README.md"], ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"]]) await promisify(execFile)("git", args, { cwd: f.project });
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, env: { F_MODE: "orphan" }, enabled: true } });
  const started = await f.start({ mode });
  if (mode === "controlled") {
    const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length > 0 || terminal(task), "coding approval");
    assert.ok(waiting.approvals.length, JSON.stringify(waiting));
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: waiting.approvals[0].options[0] });
  }
  await until(() => f.task(started.taskId), (task) => task.approvals.some((item) => item.title.startsWith("MCP ·")), "MCP approval");
  if (mode === "controlled") assert.equal((await f.task(started.taskId)).access, "coding");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), file = path.join(f.config, "only-my-pi/mcp/runs.json");
  const { groupAlive, processIdentity } = await import("../packages/host/ownership.mjs");
  const { MCP_LIMITS } = await import("../packages/mcp/catalog.mjs");
  const original = await fs.readFile(file, "utf8");
  cleanup = async () => {
    await fs.writeFile(file, original);
    for (const entry of [{ pid: run.ownerPid, identity: run.ownerIdentity }, ...run.processes]) if (groupAlive(entry.pid) && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL");
    await until(() => [run.ownerPid, ...run.processes.map((entry) => entry.pid)].every((pid) => !groupAlive(pid)), Boolean, "owned failed fixture cleanup");
    await f.close({ unconfirmed: true });
  };
  await fs.writeFile(file, JSON.stringify({ ...JSON.parse(original), quotaProbe: "x".repeat(MCP_LIMITS.storageBytes) }));
  await f.request("/api/command", { type: mode === "controlled" ? "revokeTask" : "cancelTask", taskId: started.taskId }, mode === "controlled" ? 409 : 202);
  const ended = await until(() => f.task(started.taskId), terminal, "failed persistence cancellation", 15000);
  if (mode === "controlled") assert.equal(ended.access, "inspect", "coding authority is revoked even when MCP receipt fails");
  assert.equal(groupAlive(run.ownerPid), false, "Pi must stop even when MCP cleanup receipt fails");
  assert.ok(run.processes.every((entry) => !groupAlive(entry.pid)), "service must stop even when its journal write fails");
  const state = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/host/tasks.json"), "utf8"));
  assert.equal(state.tasks.find((task) => task.taskId === started.taskId).worker.pid, run.ownerPid, "unconfirmed durable cleanup retains ownership");
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

test("disabled MCP cannot hide independent service groups during actual Host crash recovery", { timeout: 30000 }, async (t) => {
  const child = fork(new URL("./fixtures/mcp-host-orphan.mjs", import.meta.url), { execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "", host, fixture;
  child.stderr.on("data", (bytes) => { stderr += bytes; });
  const { groupAlive, processIdentity } = await import("../packages/host/ownership.mjs");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    if (!fixture) return;
    await host?.stop();
    for (const entry of fixture.run.processes) if (groupAlive(entry.pid) && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL");
    await until(() => fixture.run.processes.every((entry) => !groupAlive(entry.pid)), Boolean, "owned fixture process cleanup");
    await fs.rm(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  });
  fixture = await new Promise((resolve, reject) => { child.once("message", resolve); child.once("exit", () => reject(new Error(stderr))); });
  assert.equal(fixture.ended.error, "RPC_TERMINATION_UNCONFIRMED");
  assert.ok(fixture.run.processes.some((entry) => groupAlive(entry.pid)));
  const locks = path.join(fixture.config, "only-my-pi/host/locks");
  const sessions = (await fs.readdir(locks)).filter((name) => name.startsWith("session-"));
  assert.equal(sessions.length, 1);
  const priorOwner = await fs.readFile(path.join(locks, sessions[0], "owner.json"));
  const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
  const { startHost } = await import("../packages/host/server.mjs");
  let failure;
  try { host = await startHost({ configRoot: fixture.config, stack: fixture.stack, assetsRoot: path.join(fixture.root, "assets") }); } catch (error) { failure = error; }
  assert.equal(failure?.code, "MCP_PROCESS_RECONCILIATION_REQUIRED", "actual Host must refuse recovery with MCP disabled and independent group alive");
  assert.deepEqual(await fs.readFile(path.join(locks, sessions[0], "owner.json")), priorOwner, "session reservation cannot be released before MCP reconciliation");
});
