import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { McpRuns } from "../packages/mcp/runs.mjs";
import { acquireConfigLock, inspectConfigLock } from "../packages/config-runtime/index.mjs";
import { withMcpMetadataLock } from "../packages/mcp/metadata-lock.mjs";

for (const action of ["begin", "save"]) test(`MCP run ${action} waits for another real process without losing either update`, { timeout: 15000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-ledger-"))), children = [];
  t.after(async () => {
    for (const record of children) if (record.child.connected) record.child.send({ type: "stop" });
    await Promise.all(children.map(record => record.exited));
    await fs.rm(root, { recursive: true });
  });
  const start = role => {
    const child = fork(fileURLToPath(new URL("./fixtures/mcp-runs-contender.mjs", import.meta.url)), [root, role, action], { execPath: process.execPath, execArgv: [], stdio: ["ignore", "ignore", "pipe", "ipc"] });
    const messages = [], waiters = []; let stderr = "";
    const record = { child, exited: new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal }))), next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)) };
    child.stderr.on("data", bytes => { stderr += bytes; });
    child.on("message", message => { const waiter = waiters.shift(); if (waiter) waiter(message); else messages.push(message); });
    child.on("error", error => { const waiter = waiters.shift(); if (waiter) waiter({ type: "failed", message: error.message }); });
    record.stderr = () => stderr; children.push(record); return record;
  };
  const holder = start("holder"), initial = await holder.next(); assert.equal(initial.type, "ready");
  const contender = start("contender"); assert.equal((await contender.next()).type, "ready");
  holder.child.send({ type: "hold" }); const held = await holder.next(); assert.equal(held.type, "held");
  contender.child.send({ type: "start", ownerPid: held.pid });
  assert.equal((await contender.next()).type, "contended");
  holder.child.send({ type: "release" }); assert.equal((await holder.next()).type, "released");
  contender.child.send({ type: "continue" });
  const result = await contender.next(); assert.equal(result.type, "done", JSON.stringify(result));
  assert.equal(result.observed, true); assert.equal(result.writes, 1);
  const state = await new McpRuns(root).read(); assert.equal(state.runs.length, 2);
  assert.equal(new Set(state.runs.map(run => run.runId)).size, 2);
  assert.deepEqual(state.runs.find(run => run.runId === initial.run.runId).calls, [{ marker: "holder update" }]);
  const own = state.runs.find(run => run.runId === result.run.runId);
  assert.equal(own.ownerPid, contender.child.pid); assert.equal(own.taskId, "contender"); assert.equal(own.revision, 11);
  assert.deepEqual(own.calls, action === "save" ? [{ marker: "contender update" }] : []);
  for (const record of children) record.child.send({ type: "stop" });
  for (const record of children) assert.deepEqual(await record.exited, { code: 0, signal: null }, record.stderr());
});

test("MCP metadata waits are bounded and preserve a live owner's lock", { timeout: 10000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-ledger-held-")));
  const options = new McpRuns(root).lockOptions(), lock = await acquireConfigLock(root, options);
  t.after(async () => { await lock.release(); await fs.rm(root, { recursive: true }); });
  let probes = 0, updates = 0;
  await assert.rejects(withMcpMetadataLock(root, { ...options, isOwnerAlive: owner => {
    assert.equal(owner.pid, process.pid); assert.equal(owner.token, lock.token); process.kill(owner.pid, 0); probes++; return true;
  } }, () => { updates++; }), error => error.code === "LOCK_HELD" && error.holder.token === lock.token);
  assert.equal(probes, 100); assert.equal(updates, 0);
  assert.equal((await inspectConfigLock(root, options)).owner.token, lock.token);
});

test("MCP metadata never repeats an entered update or hides a corrupt lock", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-ledger-error-")));
  t.after(() => fs.rm(root, { recursive: true }));
  const options = new McpRuns(root).lockOptions(), failure = Object.assign(new Error("nested lock failure"), { code: "LOCK_HELD" });
  let updates = 0;
  await assert.rejects(withMcpMetadataLock(root, options, () => { updates++; throw failure; }), error => error === failure);
  assert.equal(updates, 1); assert.equal((await inspectConfigLock(root, options)).status, "FREE");
  await fs.mkdir(options.lockDirectory); await fs.writeFile(path.join(options.lockDirectory, "owner.json"), "{invalid");
  await assert.rejects(withMcpMetadataLock(root, options, () => { updates++; }), { code: "CORRUPT_LOCK" });
  assert.equal(updates, 1); assert.equal(await fs.readFile(path.join(options.lockDirectory, "owner.json"), "utf8"), "{invalid");
});
