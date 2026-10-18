import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import pty from "node-pty";
import { DirectSessionOwnership } from "../packages/direct-agent/ownership.mjs";
import { createHash } from "node:crypto";
import { createMcpHost, providerReply } from "./fixtures/mcp-host.mjs";
import { codingRequest } from "./fixtures/mcp-write-host.mjs";
import { createWriteHost, codingApproved, approveWrite, terminal } from "./fixtures/mcp-write-host.mjs";
import { until, untilPiInitialized, slowPiInitialization, mcpReception } from "./fixtures/mcp-host.mjs";
import { byteEvidence, errorEvidence, mcpDenialEvidence, processEvidence, saveRegressionEvidence } from "./fixtures/regression-evidence.mjs";
const dispatched = async (f) => {
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  if (run.processes.some((entry) => !entry.runtimeDir)) return [];
  try { return await mcpReception(run); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
};
test("a lost Host stop receipt cannot leave the controlled fixture provider listening", { timeout: 15000 }, async (t) => {
  const f = await createMcpHost();
  const stop = f.host.stop;
  t.after(async () => { await stop(); await f.close().catch(() => {}); await fs.rm(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 }); });
  await stop();
  f.host.stop = async () => { throw Object.assign(new Error("FIXTURE_STOP_RECEIPT_LOST"), { code: "FIXTURE_STOP_RECEIPT_LOST" }); };
  await assert.rejects(f.close(), { code: "FIXTURE_STOP_RECEIPT_LOST" });
  await assert.rejects(fetch(f.providerOrigin));
  assert.ok((await fs.stat(f.root)).isDirectory(), "an unconfirmed close retains its fixture evidence");
});
test("four authorities admit one actual descriptor write with truthful result identity", { timeout: 25000 }, async (t) => {
  const f = await createWriteHost(); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  assert.equal(waiting.access, "coding"); assert.match(waiting.approvals[0].title, /写入/u);
  await approveWrite(f, waiting); await until(() => f.task(started.taskId), terminal, "write complete");
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 1);
  assert.ok(receipts.filter((entry) => entry.type === "startup-write").every((entry) => ["EPERM", "EACCES"].includes(entry.code)));
  assert.equal(run.calls[0].effect, "write"); assert.equal(run.calls[0].application, "applied"); assert.ok(run.calls[0].beforeDigest && run.calls[0].afterDigest); assert.equal(run.calls[0].verification, "not_run");
  assert.ok(run.processes.every((entry) => !entry.alive));
});

async function deniedWrites(t, { slowStartup = false } = {}) {
  for (const [coding, answer] of slowStartup ? [[false, null]] : [[false, null], [true, "拒绝"]]) {
    const f = await createWriteHost({ coding });
    const mode = coding ? "controlled" : "readonly";
    const original = await fs.readFile(path.join(f.project, "README.md"));
    let started, lastTask, closed = false;
    const timing = { requestedAt: null, readyAt: null, deniedAt: null };
    const context = () => ({ coding, mode, answer, slowStartup, timing, taskId: started?.taskId, original: byteEvidence(original), lastTask });
    const close = async () => {
      if (closed) return;
      const before = await mcpDenialEvidence(f, { ...context(), phase: "before-cleanup" });
      const pids = [...new Set((before.mcp.value?.runs ?? []).flatMap(run => [run.ownerPid, ...run.processes.map(entry => entry.pid)]).concat(before.worker.value?.pid).filter(Number.isSafeInteger))];
      try { await f.close(); closed = true; await saveRegressionEvidence("mcp-cleanup", { root: f.root, ...context(), result: "closed", processes: await Promise.all(pids.map(processEvidence)) }); }
      catch (error) { await saveRegressionEvidence("mcp-cleanup", { root: f.root, ...context(), result: "UNKNOWN", error: errorEvidence(error) }); throw error; }
    };
    t.after(close);
    try {
      if (slowStartup) {
        // Fault injection stays at the copied public SDK factory. The actual
        // Host HTTP entry, Pi runtime, MCP receiver and policy remain in use.
        await slowPiInitialization(f.sdk);
      }
      timing.requestedAt = Date.now();
      started = await f.start({ mode });
      // startTask is asynchronous (202/starting). Its worker initialization
      // uses the existing 30s RPC readiness contract; denial keeps the original
      // 7.5s poll after initialization, including all original effect assertions.
      await untilPiInitialized(async () => lastTask = await f.task(started.taskId));
      timing.readyAt = Date.now();
      if (coding) await approveWrite(f, await codingApproved(f, started), answer);
      await until(async () => lastTask = await f.task(started.taskId), terminal, "unauthorized write denied");
      timing.deniedAt = Date.now();
      const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
      assert.equal(receipts.filter((entry) => entry.type === "call").length, 0); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 0);
      assert.deepEqual(await fs.readFile(path.join(f.project, "README.md")), original); assert.equal(run.calls[0].status, "rejected");
      assert.equal(run.calls[0].code, coding ? "MCP_CALL_DENIED" : "MCP_CODING_AUTHORITY_REQUIRED");
    } catch (error) {
      const snapshot = await mcpDenialEvidence(f, { ...context(), phase: "failure-before-cleanup", error: errorEvidence(error) });
      t.diagnostic(JSON.stringify({ coding, mode, answer, taskId: started?.taskId, task: snapshot.task, reception: snapshot.reception.status }));
      throw error;
    }
    await close();
  }
}

test("Inspect and an unapproved MCP tool cannot obtain real project write effects", { timeout: 45000 }, deniedWrites);
test("Inspect denial retains zero effects after a slow real Pi initialization", { timeout: 45000 }, t => deniedWrites(t, { slowStartup: true }));

test("directory symlinks, file symlinks, hardlinks and outside targets reach zero actual writes", { timeout: 65000 }, async (t) => {
  for (const kind of ["symlink", "directory", "hardlink", "outside"]) {
    const target = kind === "directory" ? "alias/file" : kind === "outside" ? "../outside" : "alias";
    const f = await createWriteHost({ target }); t.after(() => f.close());
    const outside = path.join(f.root, "outside"); await fs.writeFile(outside, "outside original");
    if (kind === "symlink") await fs.symlink(outside, path.join(f.project, "alias"));
    if (kind === "directory") { const dir = path.join(f.root, "other"); await fs.mkdir(dir); await fs.writeFile(path.join(dir, "file"), "outside original"); await fs.symlink(dir, path.join(f.project, "alias")); }
    if (kind === "hardlink") await fs.link(outside, path.join(f.project, "alias"));
    if (kind !== "outside") await f.mcp({ type: "save", revision: 1, server: { ...f.server, enabled: true, tools: [{ ...f.server.tools[0], paths: [kind === "directory" ? "alias" : target] }] } });
    const started = await f.start({ mode: "controlled" }), ended = await codingApproved(f, started);
    assert.equal(ended.approvals.length, 0); await until(() => f.task(started.taskId), terminal, "link denied");
    const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
    assert.equal(receipts.filter((entry) => ["call", "effect"].includes(entry.type)).length, 0);
    assert.equal(await fs.readFile(outside, "utf8"), "outside original");
    if (kind === "directory") assert.equal(await fs.readFile(path.join(f.root, "other/file"), "utf8"), "outside original");
    await f.close();
  }
});

test("target replaced while approval is pending invalidates that approval before writer startup", { timeout: 25000 }, async (t) => {
  const f = await createWriteHost(); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started), outside = path.join(f.root, "outside");
  await fs.writeFile(outside, "outside original"); await fs.rename(path.join(f.project, "README.md"), path.join(f.project, "saved")); await fs.symlink(outside, path.join(f.project, "README.md"));
  await approveWrite(f, waiting); await until(() => f.task(started.taskId), terminal, "changed target denied");
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  assert.equal(run.calls[0].code, "MCP_TARGET_CHANGED"); assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 0);
  assert.equal(await fs.readFile(outside, "utf8"), "outside original"); assert.equal(await fs.readFile(path.join(f.project, "saved"), "utf8"), "temporary CLI project\n");
});

test("post-dispatch path replacement cannot redirect the pinned descriptor to an outside file", { timeout: 45000 }, async (t) => {
  const f = await createWriteHost({ mode: "slow" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  await approveWrite(f, waiting);
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatch");
  const outside = path.join(f.root, "outside"); await fs.writeFile(outside, "outside original");
  await fs.rename(path.join(f.project, "README.md"), path.join(f.project, "saved")); await fs.symlink(outside, path.join(f.project, "README.md"));
  await until(() => f.task(started.taskId), terminal, "pinned write complete");
  const final = (await f.mcp({ type: "status" })).runs.find((entry) => entry.runId === run.runId);
  assert.equal(await fs.readFile(outside, "utf8"), "outside original"); assert.equal(await fs.readFile(path.join(f.project, "saved"), "utf8"), "approved MCP file bytes\n");
  assert.equal(final.calls[0].status, "unknown"); assert.equal(final.calls[0].observedChange, true);
});

test("actual mutation followed by receipt loss remains UNKNOWN and cannot auto replay", { timeout: 30000 }, async (t) => {
  const f = await createWriteHost({ mode: "crash", repeat: true }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting, "本任务");
  await until(() => f.task(started.taskId), terminal, "lost receipt");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 1);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  assert.equal(run.calls[0].status, "unknown"); assert.equal(run.calls[0].application, "unknown"); assert.equal(run.calls[0].observedChange, true);
  assert.equal(run.calls[1].code, "MCP_WRITE_RECONCILIATION_REQUIRED");
  await f.restart(); assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].status, "unknown");
  const next = await f.start({ mode: "controlled" });
  const pending = await until(() => f.task(next.taskId), (task) => task.approvals.length > 0, "new coding authority required");
  assert.equal(pending.access, "inspect");
  await f.request("/api/command", { type: "cancelTask", taskId: next.taskId }, 202);
});

for (const action of ["revokeTask", "cancelTask"]) test(`actual dispatched write ${action} keeps effects truthful and stops service`, { timeout: 25000 }, async (t) => {
  const f = await createWriteHost({ mode: "slow" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatch");
  await f.request("/api/command", { type: action, taskId: started.taskId }, action === "cancelTask" ? 202 : 200);
  await until(() => f.task(started.taskId), terminal, "stopped write");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1); assert.equal(receipts.filter((entry) => entry.type === "effect").length, 0);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.equal(run.calls[0].status, "unknown"); assert.ok(run.processes.every((entry) => !entry.alive));
});

test("startup descriptor effects are recorded UNKNOWN even when no tools/call is dispatched", { timeout: 25000 }, async (t) => {
  const f = await createWriteHost({ mode: "startup-effect" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => f.task(started.taskId), terminal, "startup effect");
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 0); assert.equal(receipts.filter((entry) => entry.type === "startup-effect").length, 1);
  assert.equal(run.calls[0].status, "unknown"); assert.equal(run.calls[0].observedChange, true); assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "startup effect");
});

test("real terminal and Agent/MCP alternate the same canonical project ownership", { timeout: 35000 }, async (t) => {
  const f = await createWriteHost(); t.after(() => f.close());
  const manual = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 90, rows: 24 });
  await f.request("/api/command", { type: "writeTerminal", terminalId: manual.terminalId, seq: 1, data: "printf manual > terminal-proof.txt\r" });
  await until(async () => fs.readFile(path.join(f.project, "terminal-proof.txt"), "utf8").catch(() => null), (value) => value === "manual", "actual manual terminal effect");
  const blocked = await f.start({ mode: "controlled" }), failed = await until(() => f.task(blocked.taskId), terminal, "Agent blocked by terminal");
  assert.equal(failed.error, "OWNERSHIP_HELD"); assert.equal((await f.mcp({ type: "status" })).runs.length, 0);
  const closed = await f.request("/api/command", { type: "closeTerminal", terminalId: manual.terminalId }); assert.equal(closed.status, "closed");
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  const terminalConflict = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 90, rows: 24 }, 500); assert.equal(terminalConflict.code, "OWNERSHIP_HELD");
  const manualConflict = await f.request("/api/command", { type: "enterManual", projectId: f.projectId }, 500); assert.equal(manualConflict.code, "OWNERSHIP_HELD");
  await assert.rejects(new DirectSessionOwnership(f.config).acquire("project", f.project), { code: "OWNERSHIP_HELD" });
  await approveWrite(f, waiting); await until(() => f.task(started.taskId), terminal, "Agent write complete");
  const owned = new DirectSessionOwnership(f.config); await owned.acquire("project", f.project); await owned.close();
});

test("actual CLI TUI writes through the shared approval and physical descriptor contract", { timeout: 45000 }, async (t) => {
  const f = await createWriteHost(); let output = "", exited;
  const term = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 120, rows: 36 });
  term.onData((data) => { output += data; }); term.onExit((exit) => { exited = exit; });
  t.after(async () => { if (!exited) { term.kill("SIGTERM"); await until(() => exited, Boolean, "owned CLI fixture exit"); } await f.close(); });
  await until(() => output, (value) => value.includes("Inspect") || exited, "TUI ready", 30000); assert.equal(exited, undefined, output);
  term.write("MCP write probe\r");
  await until(() => output, (value) => value.includes("Approve") || exited, "coding approval");
  term.write("\r");
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.at(-1)?.calls[0]?.status === "awaiting_approval", "TUI MCP approval");
  term.write("\x1b[B\r");
  await until(async () => fs.readFile(path.join(f.project, "README.md"), "utf8"), (value) => value === "approved MCP file bytes\n", "actual CLI descriptor effect");
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.at(-1).status === "stopped", "TUI task stopped");
  const run = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(run.calls[0].application, "applied"); assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 1);
  term.write("\x04"); await until(() => exited, Boolean, "TUI normal exit"); assert.equal(exited.exitCode, 0);
});

test("MCP approval cannot repair a lost real Host project owner token", { timeout: 25000 }, async (t) => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const f = await createWriteHost({ respond: async ({ body, res }) => {
    const count = body.messages.filter((message) => message.role === "tool").length;
    if (count > 1) await gate;
    providerReply(res, count === 0 ? "request_coding_access" : count === 1 ? "mcp__local__write_file" : null, count === 0 ? codingRequest : { path: "README.md", text: "unowned effect" });
  } });
  let ownerFile, original;
  t.after(async () => { if (original) await fs.writeFile(ownerFile, original); release(); await f.close(); });
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
  const digest = createHash("sha256").update(f.project).digest("hex"); ownerFile = path.join(f.config, "only-my-pi/host/locks", `project-${digest}`, "owner.json");
  original = await fs.readFile(ownerFile); await fs.writeFile(ownerFile, JSON.stringify({ ...JSON.parse(original), token: "lost-fixture-token" }));
  await approveWrite(f, waiting);
  const run = await until(async () => (await f.mcp({ type: "status" })).runs.at(-1), (entry) => entry.calls[0]?.status === "rejected", "owner proof denied");
  assert.equal(run.calls[0].code, "OWNERSHIP_LOST"); assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 0);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  await fs.writeFile(ownerFile, original); original = null; release(); await until(() => f.task(started.taskId), terminal, "failed call settled");
});

test("crashed coding owner keeps real MCP residual effects UNKNOWN and project ownership blocked", { timeout: 30000 }, async (t) => {
  const f = await createWriteHost({ mode: "orphan" });
  const { groupAlive, processIdentity } = await import("../packages/host/ownership.mjs");
  let run;
  t.after(async () => {
    if (run) { for (const entry of run.processes) if (groupAlive(entry.pid) && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL"); await until(() => run.processes.every((entry) => !groupAlive(entry.pid)), Boolean, "owned orphan cleanup"); }
    await f.close({ unconfirmed: true });
  });
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); await approveWrite(f, waiting);
  await until(() => dispatched(f), (entries) => entries.some((entry) => entry.type === "call"), "actual dispatched orphan");
  run = (await f.mcp({ type: "status" })).runs.at(-1); process.kill(run.ownerPid, "SIGKILL");
  const ended = await until(() => f.task(started.taskId), terminal, "coding owner crash"); assert.equal(ended.error, "RPC_TERMINATION_UNCONFIRMED");
  await until(async () => fs.readFile(path.join(f.project, "README.md"), "utf8"), (value) => value === "approved MCP file bytes\n", "residual authorized descriptor effect");
  const orphan = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(orphan.status, "reconciliation"); assert.equal(orphan.calls[0].status, "unknown"); assert.ok(orphan.processes.some((entry) => entry.alive));
  assert.equal(orphan.calls[0].application, "unknown"); assert.equal(orphan.calls[0].observedChange, undefined); assert.equal(orphan.calls[0].verification, "not_run");
  const ledgerFile = path.join(f.config, "only-my-pi/mcp/runs.json"), ledger = JSON.parse(await fs.readFile(ledgerFile, "utf8"));
  assert.equal(ledger.runs.at(-1).calls[0].application, "unknown", "writer startup is durably uncertain before the owner can crash");
  ledger.runs.at(-1).calls[0].application = "not_applied";
  await fs.writeFile(ledgerFile, JSON.stringify(ledger));
  assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].application, "unknown", "legacy dispatched writes are projected as uncertain without rewriting history");
  assert.equal(JSON.parse(await fs.readFile(ledgerFile, "utf8")).runs.at(-1).calls[0].application, "not_applied");
  await assert.rejects(new DirectSessionOwnership(f.config).acquire("project", f.project), { code: "OWNERSHIP_HELD" });
  const received = await mcpReception(orphan); assert.equal(received.filter((entry) => entry.type === "call").length, 1); assert.equal(received.filter((entry) => entry.type === "effect").length, 1);
});

test("changed write schema and revoked credentials invalidate pending or discovered authority", { timeout: 45000 }, async (t) => {
  for (const mode of ["list-change", "credential-revoke"]) {
    const f = await createWriteHost({ mode: mode === "list-change" ? mode : undefined }); t.after(() => f.close());
    if (mode === "credential-revoke") await f.mcp({ type: "credential", revision: 1, name: "local", envName: "MCP_TOKEN", value: "synthetic-write-credential" });
    const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started);
    if (mode === "credential-revoke") {
      await f.mcp({ type: "revokeCredential", revision: 2, name: "local", envName: "MCP_TOKEN" });
      await approveWrite(f, waiting);
    } else assert.equal(waiting.approvals.length, 0);
    await until(() => f.task(started.taskId), terminal, "changed write authority rejected");
    const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
    assert.equal(receipts.filter((entry) => entry.type === "call" || entry.type === "effect").length, 0);
    assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
    assert.ok(!JSON.stringify(await f.task(started.taskId)).includes("synthetic-write-credential"));
    await f.close();
  }
});
