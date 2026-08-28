import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createNodeProcessAdapter, createPiProcessAdmission } from "../packages/upstream-migration/index.mjs";

const piRoot = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";
const piBin = "/opt/homebrew/bin/pi";

function processFixture() {
  const rows = [
    { pid: 101, parentPid: 1, startedAt: "Wed Aug 28 10:00:00 2026", commandLine: `${piBin} --no-session` },
    { pid: 102, parentPid: 101, startedAt: "Wed Aug 28 10:00:01 2026", commandLine: `/opt/homebrew/bin/node ${piRoot}/dist/cli.js --mode rpc` },
    { pid: 999, parentPid: 1, startedAt: "Wed Aug 28 09:00:00 2026", commandLine: "/usr/bin/vim notes.txt" },
  ];
  const alive = new Set([101, 102]);
  const signals = [];
  return {
    rows,
    alive,
    signals,
    adapter: {
      async list() { return structuredClone(rows); },
      async signal(pid, signal) { signals.push({ pid, signal }); alive.delete(pid); },
      async alive(pid) { return alive.has(pid); },
      async wait() {},
    },
  };
}

test("Pi process admission reports bounded identities and terminates only after separate authority", async () => {
  const fixture = processFixture();
  const admission = createPiProcessAdmission({ piPackageRoot: piRoot, piBinPath: piBin, adapter: fixture.adapter });
  const plan = await admission.plan();
  assert.equal(plan.length, 2);
  assert.equal(plan[1].childOfDetectedPi, true);
  assert.equal(Object.hasOwn(plan[0], "commandLine"), false);
  await assert.rejects(admission.terminate(plan), { code: "PI_PROCESSES_REQUIRE_TERMINATION_AUTHORITY" });
  const result = await admission.terminate(plan, { authorized: true });
  assert.equal(result.status, "PI_PROCESSES_STOPPED");
  assert.deepEqual(fixture.signals, [{ pid: 101, signal: "SIGTERM" }, { pid: 102, signal: "SIGTERM" }]);
  assert.equal(result.forceKill, false);
});

test("Pi process admission rejects PID reuse and never escalates a timeout to SIGKILL", async () => {
  const reused = processFixture();
  const admission = createPiProcessAdmission({ piPackageRoot: piRoot, piBinPath: piBin, adapter: reused.adapter });
  const plan = await admission.plan();
  reused.rows[0].startedAt = "Wed Aug 28 11:00:00 2026";
  await assert.rejects(admission.terminate(plan, { authorized: true }), { code: "PI_PROCESS_IDENTITY_CHANGED" });

  const stuck = processFixture();
  stuck.adapter.signal = async (pid, signal) => { stuck.signals.push({ pid, signal }); };
  stuck.adapter.wait = async () => new Promise((resolve) => setTimeout(resolve, 2));
  const bounded = createPiProcessAdmission({ piPackageRoot: piRoot, piBinPath: piBin, adapter: stuck.adapter, timeoutMs: 1, pollMs: 1 });
  await assert.rejects(bounded.terminate(await bounded.plan(), { authorized: true }), { code: "PI_TERMINATION_TIMEOUT" });
  assert.ok(stuck.signals.every((entry) => entry.signal === "SIGTERM"));
});

test("node process adapter parses bounded ps output and exposes signal/alive seams", async () => {
  const calls = [];
  function spawnImpl(command, argv, options) {
    calls.push({ command, argv, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from(`  123     1 Wed Aug 28 10:00:00 2026 ${piBin} --no-session\n`));
      child.emit("close", 0, null);
    });
    return child;
  }
  const signals = [];
  const adapter = createNodeProcessAdapter({
    spawnImpl,
    killImpl(pid, signal) {
      signals.push({ pid, signal });
      if (signal === 0 && pid === 404) throw Object.assign(new Error("gone"), { code: "ESRCH" });
    },
  });
  const listed = await adapter.list();
  assert.equal(listed[0].pid, 123);
  assert.equal(calls[0].options.shell, false);
  await adapter.signal(123, "SIGTERM");
  assert.equal(await adapter.alive(123), true);
  assert.equal(await adapter.alive(404), false);
  assert.deepEqual(signals, [{ pid: 123, signal: "SIGTERM" }, { pid: 123, signal: 0 }, { pid: 404, signal: 0 }]);
});

test("node process adapter rejects malformed and oversized process listings", async () => {
  function spawnWith(output) {
    return () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      process.nextTick(() => { child.stdout.emit("data", Buffer.from(output)); child.emit("close", 0, null); });
      return child;
    };
  }
  await assert.rejects(createNodeProcessAdapter({ spawnImpl: spawnWith("invalid\n") }).list(), { code: "PI_PROCESS_LIST_INVALID" });
  await assert.rejects(createNodeProcessAdapter({ spawnImpl: spawnWith("x".repeat(2 * 1024 * 1024 + 1)) }).list(), { code: "PI_PROCESS_LIST_TOO_LARGE" });
});
