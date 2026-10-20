import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { groupAlive } from "../packages/host/ownership.mjs";
import { ControlledStdioTransport, launchIdentity } from "../packages/mcp/process.mjs";
import { McpRuns } from "../packages/mcp/runs.mjs";

async function fixture(t, drainingGroup = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-close-")));
  const project = path.join(root, "project"), configRoot = path.join(root, "config");
  await fs.mkdir(project); await fs.mkdir(configRoot);
  const file = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
  const server = { command: process.execPath, args: [file], codePaths: [file], env: { F_MODE: drainingGroup ? "read" : "orphan" } };
  const runs = new McpRuns(configRoot), run = await runs.begin({ taskId: "transport-fixture", projectPath: project, revision: 0 });
  const record = { kind: "read", pid: null, status: "starting" }; run.processes.push(record);
  const transport = new ControlledStdioTransport({ server, files: await launchIdentity(server), readPaths: [project], configRoot, env: {}, secrets: [], record, save: () => runs.save(run) });
  transport.cwd = project;
  const kill = process.kill;
  t.after(async () => {
    if (record.pid && groupAlive(record.pid)) kill(-record.pid, "SIGKILL");
    await transport.exited;
    await transport.close().catch(() => {});
    assert.equal(record.pid ? groupAlive(record.pid) : false, false);
    if (record.runtimeDir) await fs.rm(record.runtimeDir, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  });
  const initialized = new Promise(resolve => transport.onMessage(message => { if (message.id === 1) resolve(message); }));
  const spawn = childProcess.spawn;
  if (drainingGroup) {
    // A real launcher leaves a short-lived member in the service group after
    // its leader closes. The MCP service still runs inside the actual sandbox.
    childProcess.spawn = (command, args, options) => spawn("/bin/sh", ["-c", '"$@"; /bin/sleep 0.05 </dev/null >/dev/null 2>&1 &', "draining-launcher", command, ...args], options);
    syncBuiltinESMExports();
  }
  try { await transport.start(); }
  finally { childProcess.spawn = spawn; syncBuiltinESMExports(); }
  await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal((await initialized).result.serverInfo.name, "omp-controlled-fixture");
  return { transport, record, runs, project };
}

test("MCP close waits for a real service group after its leader closes", { timeout: 10000 }, async (t) => {
  const { transport, record, runs, project } = await fixture(t, true);
  const pid = record.pid, kill = process.kill, signals = [];
  let aliveAtLeaderClose;
  transport.child.once("close", () => { aliveAtLeaderClose = groupAlive(pid); });
  t.mock.method(process, "kill", (target, signal) => { if (target === -pid && signal !== 0) signals.push(signal); return kill(target, signal); });
  let failure;
  try { await transport.close(); }
  catch (error) { failure = error; }
  const stored = (await runs.status(project)).runs[0].processes[0];
  if (failure) t.diagnostic(JSON.stringify({ code: failure.code, aliveAtLeaderClose, status: stored.status, alive: stored.alive, signals }));
  assert.equal(aliveAtLeaderClose, true, "a real member outlives the group leader");
  assert.ifError(failure);
  assert.equal(groupAlive(pid), false); assert.deepEqual(signals, []);
  assert.equal(stored.status, "stopped"); assert.equal(stored.alive, false);
});

test("MCP close confirms a group that exits during the real identity probe", { timeout: 10000 }, async (t) => {
  const { transport, record, runs, project } = await fixture(t);
  const pid = record.pid, execFile = childProcess.execFile, kill = process.kill;
  const signals = []; let probed = false, failure;
  t.mock.method(process, "kill", (target, signal) => { if (target === -pid && signal !== 0) signals.push(signal); return kill(target, signal); });
  const intercepted = (...args) => execFile(...args);
  intercepted[promisify.custom] = async (file, args, options) => {
    if (file === "/bin/ps" && args[1] === String(pid)) {
      assert.equal(groupAlive(pid), true, "the initial group probe observes the live service");
      kill(pid, "SIGTERM"); await transport.exited;
      assert.equal(groupAlive(pid), false); probed = true;
    }
    return promisify(execFile)(file, args, options);
  };
  childProcess.execFile = intercepted; syncBuiltinESMExports();
  try { await transport.close(); }
  catch (error) { failure = error; }
  finally { childProcess.execFile = execFile; syncBuiltinESMExports(); }
  const stored = (await runs.status(project)).runs[0].processes[0];
  if (failure) t.diagnostic(JSON.stringify({ code: failure.code, status: stored.status, alive: stored.alive, probed, signals }));
  assert.ifError(failure);
  assert.equal(probed, true); assert.deepEqual(signals, []); assert.equal(groupAlive(pid), false);
  assert.equal(stored.status, "stopped"); assert.equal(stored.alive, false);
});

for (const identity of [null, "different-start"]) test(`MCP close cannot signal a live group with identity ${identity}`, { timeout: 10000 }, async (t) => {
  const { transport, record, runs, project } = await fixture(t);
  const pid = record.pid, kill = process.kill, signals = [];
  record.identity = identity;
  t.mock.method(process, "kill", (target, signal) => { if (target === -pid && signal !== 0) signals.push(signal); return kill(target, signal); });
  await assert.rejects(transport.close(), { code: "MCP_PROCESS_RECONCILIATION_REQUIRED" });
  assert.equal(groupAlive(pid), true); assert.deepEqual(signals, []);
  const stored = (await runs.status(project)).runs[0].processes[0];
  assert.equal(stored.status, "reconciliation"); assert.equal(stored.alive, true);
});
