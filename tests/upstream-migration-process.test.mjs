import assert from "node:assert/strict";
import test from "node:test";

import { createPiProcessAdmission } from "../packages/upstream-migration/index.mjs";

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
