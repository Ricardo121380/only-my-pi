import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { SessionAdmissions, createResumeAdmissionExtension } from "../packages/direct-agent/session-admission.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-switch-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "config"); await fs.mkdir(config);
  const files = ["source", "target"].map((id) => path.join(root, `${id}.jsonl`));
  for (const [index, file] of files.entries()) await fs.writeFile(file, JSON.stringify({ type: "session", version: index ? 1 : 3, id: index ? "target" : "source", cwd: root, timestamp: new Date().toISOString() }) + "\n");
  const state = { active: 0, unconfirmed: false };
  const admissions = new SessionAdmissions(config, { executionState: () => state });
  await admissions.admit(files[0]);
  const handlers = new Map();
  createResumeAdmissionExtension(admissions)({ on: (name, handler) => handlers.set(name, handler) });
  let aborted = 0, created = 0;
  const runner = { hasHandlers: (name) => handlers.has(name), emit: (event) => handlers.get(event.type)?.(event) };
  const session = (file) => ({ sessionFile: file, extensionRunner: runner, abort: async () => { aborted++; }, dispose() {} });
  const services = { cwd: root, agentDir: config };
  const runtime = new AgentSessionRuntime(session(files[0]), services, async ({ sessionManager }) => {
    created++;
    return { session: session(sessionManager.getSessionFile()), services, diagnostics: [] };
  });
  return { config, files, admissions, state, runtime, counts: () => ({ aborted, created }) };
}

test("real Pi switch refuses an occupied v1 target before migration, keeping source", async (t) => {
  const f = await fixture(t); const target = await acquireOwnership(f.config, "session", "target");
  try {
    const before = await fs.readFile(f.files[1], "utf8");
    assert.deepEqual(await f.runtime.switchSession(f.files[1]), { cancelled: true });
    assert.equal(await fs.readFile(f.files[1], "utf8"), before);
    assert.equal(f.runtime.session.sessionFile, f.files[0]);
    assert.deepEqual(f.counts(), { aborted: 0, created: 0 });
    await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
  } finally { await target.release(); await f.admissions.close(); }
});

test("real Pi switch migrates only after admission and retains leases until disposal", async (t) => {
  const f = await fixture(t);
  try {
    assert.deepEqual(await f.runtime.switchSession(f.files[1]), { cancelled: false });
    assert.equal(JSON.parse((await fs.readFile(f.files[1], "utf8")).split("\n")[0]).version, 3);
    assert.equal(f.runtime.session.sessionFile, f.files[1]);
    // Returning to an already admitted history must not deadlock on our lock.
    assert.deepEqual(await f.runtime.switchSession(f.files[0]), { cancelled: false });
    for (const id of ["source", "target"]) await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
    await f.runtime.dispose();
  } finally { await f.admissions.close(); }
  for (const id of ["source", "target"]) { const lease = await acquireOwnership(f.config, "session", id); await lease.release(); }
});

test("uncertain execution cleanup retains ownership and rejects later admission", async (t) => {
  const f = await fixture(t);
  f.state.unconfirmed = true;
  await assert.rejects(f.admissions.close(), { code: "OWNER_TERMINATION_UNCONFIRMED" });
  try {
    await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
    await assert.rejects(f.admissions.admit(f.files[1]), { code: "OWNER_CLOSING" });
  } finally { f.state.unconfirmed = false; await f.admissions.close(); }
});

test("missing target leaves the current runtime and ownership intact", async (t) => {
  const f = await fixture(t);
  try {
    assert.deepEqual(await f.runtime.switchSession(`${f.files[1]}.missing`), { cancelled: true });
    assert.deepEqual(f.counts(), { aborted: 0, created: 0 });
    await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
  } finally { await f.admissions.close(); }
});

test("identity replacement of an admitted file is refused", async (t) => {
  const f = await fixture(t);
  try {
    await fs.writeFile(f.files[0], JSON.stringify({ type: "session", id: "different" }) + "\n");
    await assert.rejects(f.admissions.admit(f.files[0]), { code: "SESSION_TARGET_CHANGED" });
    await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
  } finally { await f.admissions.close(); }
});
