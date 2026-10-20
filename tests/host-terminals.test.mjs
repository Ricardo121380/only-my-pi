import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fork } from "node:child_process";
import { HostTerminals } from "../packages/host/terminals.mjs";
import { TerminalProcesses } from "../packages/host/terminal-processes.mjs";
import { acquireOwnership, processIdentity } from "../packages/host/ownership.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await pause(30); }
  throw Error("TERMINAL_TEST_TIMEOUT");
}
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-terminals-")));
  const project = path.join(root, "project"), configRoot = path.join(root, "config");
  await fs.mkdir(project);
  const catalog = { project: () => ({ path: project, available: true }) };
  const options = { configRoot, catalog, env: { PATH: "/usr/bin:/bin", HOME: root, PROVIDER_API_KEY: "must-not-inherit" } };
  const manager = new HostTerminals(options); await manager.load();
  t.after(async () => { await manager.stop().catch(() => {}); await fs.rm(root, { recursive: true }); });
  const opened = await manager.open("p", 80, 24), id = opened.terminalId;
  let seq = 0;
  const write = (data) => manager.write(id, ++seq, data);
  await until(() => manager.read(id).output.includes("%"));
  return { root, project, configRoot, manager, id, write, options };
}

test("tracker never claims unrelated TTY attachments, prunes exited identities and retains observed orphans", () => {
  const tracker = new TerminalProcesses(10);
  const entry = (pid, parent, start = "start") => ({ pid, parent, start, tty: "ttys9" });
  const table = new Map([[10, entry(10, 1)], [11, entry(11, 10)], [12, entry(12, 11)], [90, entry(90, 1)]]);
  assert.deepEqual(tracker.observe(table), [11, 12]); assert.equal(tracker.unknown, true);
  table.delete(90); table.delete(11); table.set(12, entry(12, 1));
  assert.deepEqual(tracker.observe(table), [12]); assert.equal(tracker.known.size, 1); assert.equal(tracker.unknown, false);
  table.set(12, entry(12, 1, "reused-pid"));
  assert.deepEqual(tracker.observe(table), []); assert.equal(tracker.unknown, true); assert.equal(tracker.known.size, 0);
});

test("terminal holds shared project lease, executes real input, resizes and reattaches without replay", async (t) => {
  const { project, configRoot, manager, id, write } = await fixture(t);
  await assert.rejects(acquireOwnership(configRoot, "project", project), { code: "OWNERSHIP_HELD" });
  assert.equal((await manager.open("p", 100, 30)).terminalId, id);
  manager.resize(id, 110, 32);
  write('printf "%s" "$PROVIDER_API_KEY" > secret-check; pwd > cwd.txt; stty size > size.txt; echo done > proof.txt\r');
  await until(() => fs.readFile(path.join(project, "proof.txt"), "utf8").catch(() => null));
  assert.equal(await fs.readFile(path.join(project, "cwd.txt"), "utf8"), project + "\n");
  assert.equal(await fs.readFile(path.join(project, "size.txt"), "utf8"), "32 110\n");
  assert.equal(await fs.readFile(path.join(project, "secret-check"), "utf8"), "");
  const end = manager.read(id).end;
  assert.equal(manager.read(id, end).output, "");
  const data = "echo once >> count.txt\r";
  write(data); manager.write(id, 2, data);
  assert.throws(() => manager.write(id, 2, "echo twice\r"), { code: "TERMINAL_INPUT_CONFLICT" });
  await until(() => fs.readFile(path.join(project, "count.txt"), "utf8").catch(() => null));
  assert.equal(await fs.readFile(path.join(project, "count.txt"), "utf8"), "once\n");
  assert.equal((await manager.close(id)).status, "closed");
  const next = await acquireOwnership(configRoot, "project", project); await next.release();
});

test("close reaps disowned job-control process before releasing writer lease", async (t) => {
  const { project, configRoot, manager, id, write } = await fixture(t);
  write("/bin/sleep 60 & child=$!; disown; print -r -- $child > child.pid\r");
  const pid = Number(await until(() => fs.readFile(path.join(project, "child.pid"), "utf8").catch(() => null)));
  const identity = await processIdentity(pid); assert.ok(identity);
  t.after(async () => { if (await processIdentity(pid) === identity) process.kill(pid, "SIGKILL"); });
  assert.equal((await manager.close(id)).status, "closed");
  assert.equal(await processIdentity(pid), null);
  const lease = await acquireOwnership(configRoot, "project", project); await lease.release();
});

test("natural shell exit cleans observed jobs, whereas supervisor kill retains lease across restart", async (t) => {
  const { project, configRoot, manager, id, write, options } = await fixture(t);
  write("exit\r");
  await until(() => manager.get(id).status === "closed");
  const next = await manager.open("p", 80, 24);
  // This fixture has only an idle shell. After killing the supervisor, ensure
  // its test-owned shell is gone (it may already have exited on PTY hangup).
  const entry = manager.get(next.terminalId);
  const { processTable } = await import("../packages/host/terminal-processes.mjs");
  const children = [...(await processTable()).values()].filter((p) => p.parent === entry.pty.pid);
  entry.pty.kill("SIGKILL");
  for (const child of children) if ((await processTable()).get(child.pid)?.start === child.start) {
    try { process.kill(child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
  await until(() => entry.status === "reconciliation");
  await assert.rejects(acquireOwnership(configRoot, "project", project), { code: "OWNERSHIP_HELD" });
  const restarted = new HostTerminals(options); await restarted.load();
  assert.equal((await restarted.open("p", 80, 24)).status, "reconciliation");
  assert.equal((await restarted.close(next.terminalId)).status, "reconciliation");
});

test("output ring is bounded and reports truncation", async (t) => {
  const { manager, id, write } = await fixture(t);
  write("/usr/bin/yes x | /usr/bin/head -c 1200000; echo OUTPUT_DONE\r");
  await until(() => manager.read(id).end > 1100000 && manager.read(id).output.includes("OUTPUT_DONE"));
  const result = manager.read(id, 0);
  assert.equal(result.truncated, true); assert.ok(result.base > 0); assert.ok(result.output.length <= 1024 * 1024);
  assert.equal((await manager.close(id)).status, "closed");
});

test("dead Host cleanup receipt can reconcile only its matching project lease", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-terminal-crash-")));
  const project = path.join(root, "project"), configRoot = path.join(root, "config"); await fs.mkdir(project);
  const child = fork(new URL("./fixtures/terminal-host-crash.mjs", import.meta.url), [configRoot, project], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let supervisor;
  t.after(async () => { child.kill("SIGKILL"); if (supervisor && await processIdentity(supervisor)) process.kill(supervisor, "SIGKILL"); await fs.rm(root, { recursive: true }); });
  const started = await new Promise((resolve, reject) => { child.once("message", resolve); child.once("exit", () => reject(Error("fixture ended early"))); });
  supervisor = started.supervisor;
  const exited = new Promise((resolve) => child.once("exit", resolve)); child.kill("SIGKILL"); await exited;
  await until(async () => !await processIdentity(supervisor));
  const manager = new HostTerminals({ configRoot, catalog: { project: () => ({ path: project }) } }); await manager.load();
  assert.equal(manager.get(started.terminalId).status, "reconciliation");
  assert.equal((await manager.close(started.terminalId)).status, "closed");
  assert.deepEqual(await fs.readdir(path.join(configRoot, "only-my-pi/host/terminal-receipts")), []);
  const lease = await acquireOwnership(configRoot, "project", project); await lease.release();
});
