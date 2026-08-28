import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCrossRootTransactionEngine,
  loadUpstreamJournal,
  UPSTREAM_DURABLE_BOUNDARIES,
} from "../packages/upstream-migration/index.mjs";

const transactionId = "11111111-1111-4111-8111-111111111111";

function plan() {
  return {
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration-plan",
    planDigest: `sha256:${"1".repeat(64)}`,
    bundle: { sha256: `sha256:${"2".repeat(64)}` },
    manifestDigest: `sha256:${"3".repeat(64)}`,
    sourceCommit: "a".repeat(40),
    candidateGraphDigest: `sha256:${"4".repeat(64)}`,
    from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" },
    to: { piVersion: "0.84.3", subagentsVersion: "0.57.0" },
    packages: [],
    processPolicy: { requirePiStopped: true, signal: "SIGTERM", timeoutSeconds: 15, forceKill: false },
    piProcesses: [],
    preflight: null,
  };
}

function platformFixture({ failMethod = null } = {}) {
  const calls = [];
  const state = { stack: "old", rolledBack: false };
  const names = [
    "preflight", "backup", "stagePi", "stageExternalTree", "stageGeneration", "stageCli",
    "renamePiOld", "renamePiNew", "renameExternalOld", "renameExternalNew", "publishSettings",
    "activateGeneration", "activateCli", "staticDoctor", "noModelSmoke", "recordLkg", "commit",
  ];
  const platform = {};
  for (const name of names) platform[name] = async () => {
    calls.push(name);
    if (name === "renamePiNew" || name === "renameExternalNew" || name === "publishSettings") state.stack = "transitioning";
    if (name === "commit") state.stack = "new";
    if (name === failMethod) throw Object.assign(new Error(`fault at ${name}`), { code: "FAULT_INJECTED" });
  };
  platform.rollback = async () => { calls.push("rollback"); state.stack = "old"; state.rolledBack = true; return { status: "STACK_RESTORED", manualReconciliation: false }; };
  platform.readRecordedPlan = async () => ({ ...plan(), bundleDigest: plan().bundle.sha256 });
  return { platform, calls, state };
}

function inspected(value = plan()) {
  return { bundle: { sha256: value.bundle.sha256 }, manifest: { manifestDigest: value.manifestDigest } };
}

test("cross-root engine advances every durable boundary and commits one complete stack", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture();
  const boundaries = [];
  const engine = createCrossRootTransactionEngine({
    configRoot,
    platform: fixture.platform,
    transactionIdFactory: () => transactionId,
    onBoundary: async (phase) => boundaries.push(phase),
  });
  const value = plan();
  const result = await engine.apply({ plan: value, inspected: inspected(value) });
  assert.equal(result.status, "COMMITTED");
  assert.equal(fixture.state.stack, "new");
  assert.deepEqual(boundaries, UPSTREAM_DURABLE_BOUNDARIES.slice(1));
  const journal = await loadUpstreamJournal(configRoot, transactionId);
  assert.equal(journal.status, "COMMITTED");
  assert.deepEqual(journal.history.map((entry) => entry.phase), UPSTREAM_DURABLE_BOUNDARIES);
});

test("ordinary failure automatically restores the old complete stack", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-fail-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture({ failMethod: "publishSettings" });
  const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, transactionIdFactory: () => transactionId });
  const value = plan();
  await assert.rejects(engine.apply({ plan: value, inspected: inspected(value) }), (error) => {
    assert.equal(error.code, "FAULT_INJECTED");
    assert.equal(error.recovery.status, "ROLLED_BACK");
    return true;
  });
  assert.equal(fixture.state.stack, "old");
  assert.equal(fixture.state.rolledBack, true);
  assert.equal((await loadUpstreamJournal(configRoot, transactionId)).status, "ROLLED_BACK");
});

test("a hard crash is recovered before the next mutation", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-crash-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture();
  const crash = Object.assign(new Error("simulated hard crash"), { simulateCrash: true, code: "SIMULATED_CRASH" });
  const first = createCrossRootTransactionEngine({
    configRoot,
    platform: fixture.platform,
    transactionIdFactory: () => transactionId,
    onBoundary: async (phase) => { if (phase === "PI_NEW_RENAMED") throw crash; },
  });
  const value = plan();
  await assert.rejects(first.apply({ plan: value, inspected: inspected(value) }), { code: "SIMULATED_CRASH" });
  assert.equal((await loadUpstreamJournal(configRoot, transactionId)).status, "ACTIVE");

  const resumed = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform });
  const recovered = await resumed.recoverPending();
  assert.equal(recovered[0].status, "ROLLED_BACK");
  assert.equal(fixture.state.stack, "old");
});

test("explicit rollback converts a committed transaction to a durable rolled-back state", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-explicit-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture();
  const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, transactionIdFactory: () => transactionId });
  const value = plan();
  await engine.apply({ plan: value, inspected: inspected(value) });
  const result = await engine.rollback({ transactionId });
  assert.equal(result.status, "ROLLED_BACK");
  assert.equal((await loadUpstreamJournal(configRoot, transactionId)).status, "ROLLED_BACK");
  assert.equal(fixture.state.stack, "old");
});

test("every orchestration step failure settles in a terminal old-stack state", async (t) => {
  const methods = [
    "backup", "stagePi", "stageExternalTree", "stageGeneration", "stageCli",
    "renamePiOld", "renamePiNew", "renameExternalOld", "renameExternalNew",
    "publishSettings", "activateGeneration", "activateCli", "staticDoctor",
    "noModelSmoke", "recordLkg", "commit",
  ];
  for (const [index, method] of methods.entries()) {
    const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), `omp-cross-root-${method}-`));
    t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
    const fixture = platformFixture({ failMethod: method });
    const id = `${String(index + 10).padStart(8, "0")}-1111-4111-8111-${String(index + 10).padStart(12, "0")}`;
    const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, transactionIdFactory: () => id });
    const value = plan();
    await assert.rejects(engine.apply({ plan: value, inspected: inspected(value) }), { code: "FAULT_INJECTED" });
    assert.equal(fixture.state.stack, "old", method);
    assert.equal((await loadUpstreamJournal(configRoot, id)).status, "ROLLED_BACK", method);
  }
});

test("transaction engine fails closed on invalid authority, status, and rollback inputs", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-invalid-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  assert.throws(() => createCrossRootTransactionEngine({ configRoot: "relative", platform: {} }), TypeError);
  assert.throws(() => createCrossRootTransactionEngine({ configRoot }), TypeError);
  const fixture = platformFixture();
  const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, transactionIdFactory: () => transactionId });
  await assert.rejects(engine.apply({ plan: {}, inspected: {} }), { code: "MIGRATION_PLAN_INVALID" });
  await assert.rejects(engine.apply({ plan: plan(), inspected: { bundle: { sha256: `sha256:${"9".repeat(64)}` }, manifest: { manifestDigest: plan().manifestDigest } } }), { code: "MIGRATION_BUNDLE_CHANGED_AFTER_PLAN" });
  assert.equal((await engine.status()).transactions.length, 0);
  await assert.rejects(engine.rollback({ transactionId }), { code: "ENOENT" });
});

test("transaction engine enforces process admission and surfaces manual reconciliation", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-authority-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const value = plan();
  value.piProcesses = [{ pid: 1, identityDigest: `sha256:${"1".repeat(64)}` }];
  const noAdmission = platformFixture();
  const first = createCrossRootTransactionEngine({ configRoot, platform: noAdmission.platform, transactionIdFactory: () => transactionId });
  await assert.rejects(first.apply({ plan: value, inspected: inspected(value) }), { code: "PI_PROCESS_ADMISSION_UNAVAILABLE" });
  assert.equal((await first.status({ transactionId })).journal.status, "ROLLED_BACK");

  const manualRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-manual-"));
  t.after(() => fs.rm(manualRoot, { recursive: true, force: true }));
  const manual = platformFixture({ failMethod: "publishSettings" });
  manual.platform.rollback = async () => ({ status: "MANUAL_RECONCILIATION_REQUIRED", manualReconciliation: true, code: "CONCURRENT_EXTERNAL_PACKAGE_CHANGE" });
  const engine = createCrossRootTransactionEngine({ configRoot: manualRoot, platform: manual.platform, transactionIdFactory: () => "22222222-2222-4222-8222-222222222222" });
  await assert.rejects(engine.apply({ plan: plan(), inspected: inspected() }), (error) => error.recovery.status === "MANUAL_RECONCILIATION_REQUIRED");
  const listed = await engine.status();
  assert.equal(listed.transactions[0].status, "MANUAL_RECONCILIATION_REQUIRED");
});

test("transaction engine preserves a failed recovery as manual reconciliation evidence", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-recovery-fail-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture({ failMethod: "publishSettings" });
  fixture.platform.rollback = async () => { throw Object.assign(new Error("recovery failed"), { code: "RECOVERY_FAULT" }); };
  const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, transactionIdFactory: () => transactionId });
  await assert.rejects(engine.apply({ plan: plan(), inspected: inspected() }), (error) => error.recovery.code === "RECOVERY_FAULT");
  assert.equal((await loadUpstreamJournal(configRoot, transactionId)).status, "MANUAL_RECONCILIATION_REQUIRED");
});

test("transaction engine uses reviewed process admission for apply and explicit rollback", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cross-root-process-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const fixture = platformFixture();
  const processCalls = [];
  const processAdmission = {
    plan: async () => [{ pid: 42 }],
    terminate: async (processes, options) => { processCalls.push({ processes, options }); return { stopped: processes.length }; },
  };
  const value = plan();
  value.piProcesses = [{ pid: 41 }];
  const engine = createCrossRootTransactionEngine({ configRoot, platform: fixture.platform, processAdmission, transactionIdFactory: () => transactionId });
  await engine.apply({ plan: value, inspected: inspected(value), terminatePi: true });
  await engine.rollback({ transactionId, terminatePi: true });
  assert.deepEqual(processCalls, [
    { processes: [{ pid: 41 }], options: { authorized: true } },
    { processes: [{ pid: 42 }], options: { authorized: true } },
  ]);
  assert.equal((await engine.recoverTransaction(transactionId)).status, "ROLLED_BACK");
});
