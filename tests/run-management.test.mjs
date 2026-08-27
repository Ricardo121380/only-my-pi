import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManagedCoordinator, createRunManagementService, createRunRecordStore, runRecordDigest } from "../packages/run-management/index.mjs";

const d = (value) => `sha256:${value.repeat(64).slice(0, 64)}`;

async function root(t, { now = Date.UTC(2026, 7, 27) } = {}) {
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-run-management-"));
  t.after(() => fs.rm(managedRoot, { recursive: true, force: true }));
  let instant = now;
  const clock = () => instant;
  const store = createRunRecordStore({ managedRoot, clock });
  const context = {
    sessionId: "session-one",
    repository: { root: "/workspace", rootDigest: d("a"), head: "0123456789abcdef0123456789abcdef01234567" },
    configurationDigest: d("b"),
  };
  return { managedRoot, store, context, setNow: (value) => { instant = value; } };
}

function beginInput(id = "run-one") {
  return { id, sessionId: "session-one", repository: { root: "/workspace", rootDigest: d("a"), head: "0123456789abcdef0123456789abcdef01234567" }, configurationDigest: d("b"), planDigest: d("c"), executionEnvelopeDigest: d("d"), input: { task: "private raw task" }, inputDigest: d("e") };
}

test("private run records are atomic, mode-protected, digest-bound and listable", async (t) => {
  const { managedRoot, store } = await root(t);
  const created = await store.begin(beginInput());
  assert.equal(created.status, "planned");
  assert.equal(created.input.task, "private raw task");
  assert.match(created.recordDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal((await fs.stat(path.join(managedRoot, "runs", "run-one"))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(managedRoot, "runs", "run-one", "run-record.json"))).mode & 0o777, 0o600);
  assert.equal((await store.list())[0].runId, "run-one");
  const raw = JSON.parse(await fs.readFile(path.join(managedRoot, "runs", "run-one", "run-record.json"), "utf8"));
  raw.status = "completed";
  await fs.writeFile(path.join(managedRoot, "runs", "run-one", "run-record.json"), `${JSON.stringify(raw)}\n`);
  await assert.rejects(store.get("run-one"), { code: "RUN_RECORD_TAMPERED" });
});

test("terminal raw input and artifacts become explicit seven-day GC candidates while interrupted runs never do", async (t) => {
  const startedAt = Date.UTC(2026, 7, 1);
  const { managedRoot, store, setNow } = await root(t, { now: startedAt });
  await store.begin(beginInput("terminal-run"));
  const bytes = Buffer.from(JSON.stringify({ result: "private raw result" }));
  const artifactDigest = runRecordDigest(bytes);
  const relativePath = `runs/terminal-run/${artifactDigest.slice(7)}.blob`;
  await fs.writeFile(path.join(managedRoot, relativePath), bytes, { mode: 0o600 });
  await store.updateProjection("terminal-run", {
    status: "completed",
    terminal: { status: "completed" },
    nodes: { node: { artifacts: [{ kind: "artifact-ref", id: "art-terminal", digest: artifactDigest, byteLength: bytes.byteLength, storage: { scheme: "artifact", relativePath } }] } },
  });
  await store.begin(beginInput("interrupted-run"));
  await store.update("interrupted-run", { status: "interrupted" });
  assert.equal((await store.gcPlan()).candidates.length, 0);
  setNow(startedAt + 8 * 24 * 60 * 60 * 1000);
  const plan = await store.gcPlan();
  assert.deepEqual(plan.candidates.map((entry) => entry.runId), ["terminal-run"]);
  const result = await store.gcApply(plan);
  assert.equal(result.status, "RUN_GC_APPLIED");
  await assert.rejects(fs.access(path.join(managedRoot, relativePath)));
  const retained = await store.require("terminal-run");
  assert.equal(retained.input, null);
  assert.equal(retained.inputRetained, false);
  assert.equal(retained.artifactsRetained, false);
  assert.equal(retained.artifacts[0].digest, artifactDigest);
  assert.equal(typeof retained.receiptDigest, "string");
  assert.equal((await store.gcPlan()).candidates.length, 0);
  assert.equal((await store.require("interrupted-run")).inputRetained, true);
});

test("GC refuses stale plans and artifact drift", async (t) => {
  const startedAt = Date.UTC(2026, 7, 1);
  const { managedRoot, store, setNow } = await root(t, { now: startedAt });
  await store.begin(beginInput("drift-run"));
  const bytes = Buffer.from("original");
  const artifactDigest = runRecordDigest(bytes);
  const relativePath = `runs/drift-run/${artifactDigest.slice(7)}.blob`;
  await fs.writeFile(path.join(managedRoot, relativePath), bytes);
  await store.updateProjection("drift-run", { status: "completed", terminal: { status: "completed" }, nodes: { node: { artifacts: [{ kind: "artifact-ref", id: "art-drift", digest: artifactDigest, byteLength: bytes.length, storage: { scheme: "artifact", relativePath } }] } } });
  setNow(startedAt + 8 * 24 * 60 * 60 * 1000);
  const plan = await store.gcPlan();
  await fs.writeFile(path.join(managedRoot, relativePath), "changed!");
  await assert.rejects(store.gcApply(plan), { code: "RUN_ARTIFACT_DRIFT" });
  await store.update("drift-run", { status: "failed" });
  await assert.rejects(store.gcApply(plan), { code: "RUN_GC_PLAN_STALE" });
});

test("managed coordinator records completion, checks resume repository/config and interrupts active work on shutdown", async (t) => {
  const { store, context } = await root(t);
  let resolveRunning;
  const raw = {
    async execute(plan, options) {
      if (options.runId === "active-run") return new Promise((resolve) => { resolveRunning = () => resolve({ runId: options.runId, status: "paused", terminal: null, nodes: {} }); });
      return { runId: options.runId, status: "completed", terminal: { status: "completed" }, nodes: {} };
    },
    async inspect(id) { return { projection: { runId: id, status: "paused", terminal: null, nodes: {} } }; },
    async cancel(id) { return { status: "CANCEL_REQUESTED", runId: id }; },
    async resume(id) { return { runId: id, status: "completed", terminal: { status: "completed" }, nodes: {} }; },
    async pause() { return { status: "PAUSE_REQUESTED" }; },
  };
  let currentContext = context;
  const coordinator = createManagedCoordinator({ coordinator: raw, recordStore: store, contextProvider: async () => currentContext });
  const plan = { planDigest: d("c") };
  const completed = await coordinator.execute(plan, { runId: "managed-run", input: { task: "do it" }, executionEnvelope: { executionEnvelopeDigest: d("d") } });
  assert.equal(completed.status, "completed");
  assert.equal((await store.require("managed-run")).status, "completed");
  currentContext = { ...context, configurationDigest: d("f") };
  await assert.rejects(coordinator.resume("managed-run"), { code: "RUN_CONFIGURATION_DRIFT" });
  currentContext = context;
  const active = coordinator.execute(plan, { runId: "active-run", input: { task: "wait" }, executionEnvelope: { executionEnvelopeDigest: d("d") } });
  while (!resolveRunning) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((await coordinator.shutdown()).runIds, ["active-run"]);
  assert.equal((await store.require("active-run")).status, "interrupted");
  resolveRunning();
  await active;
});

test("RunManagementService redacts raw input by default and exposes plan-first GC", async (t) => {
  const { store } = await root(t);
  await store.begin(beginInput("service-run"));
  const service = createRunManagementService({ recordStore: store });
  assert.equal((await service.list()).runs[0].runId, "service-run");
  assert.equal((await service.show("service-run")).run.input, "[private-raw-retained]");
  assert.deepEqual((await service.show("service-run", { includeRaw: true })).run.input, { task: "private raw task" });
  assert.equal((await service.cancel("service-run")).code, "PI_SESSION_REQUIRED");
  assert.equal((await service.gcPlan()).status, "RUN_GC_PLAN");
});
