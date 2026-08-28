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
