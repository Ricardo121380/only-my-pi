import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createPiSubagentsDelegationV1Backend,
  PI_SUBAGENTS_DELEGATION_V1_CANDIDATE_BACKEND_VERSION,
  PI_SUBAGENTS_DELEGATION_V1_EVENTS,
} from "../packages/subagents/adapters/pi-subagents-delegation-v1/index.mjs";
import {
  createPiSubagentsRpcV1Backend,
  PiSubagentsTerminalEventStore,
} from "../packages/subagents/adapters/pi-subagents-rpc-v1/index.mjs";
import { createPiSubagentsRpcV1CapabilityMatrix } from "../packages/subagents/adapters/pi-subagents-rpc-v1/capabilities.mjs";
import {
  PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
  PI_SUBAGENTS_RPC_V1_CANDIDATE_BACKEND_VERSION,
  PI_SUBAGENTS_RPC_V1_EVENTS,
} from "../packages/subagents/adapters/pi-subagents-rpc-v1/wire.mjs";
import { createBatchSwarmNodeExecutor } from "../packages/subagents/batch-swarm/index.mjs";
import {
  createAgentRunHandle,
  createAgentTemplate,
  createResolvedAgentSpec,
  createTaskAssignment,
  digestValue,
} from "../packages/subagents/domain/index.mjs";
import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import {
  createArtifactStore,
  createEventJournal,
  createPlanStore,
} from "../packages/subagents/state/index.mjs";
import { compileWorkflowDefinition } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import {
  createExecutionEnvelope,
  createRunCoordinator,
} from "../packages/subagents/workflow/run-coordinator/index.mjs";

const ADAPTER_SOAK_ITERATIONS = 100;
const BATCH_SOAK_ITERATIONS = 100;
const COORDINATOR_COMPLETION_ITERATIONS = 32;
const COORDINATOR_ORPHAN_ITERATIONS = 16;
const ARTIFACT_SOAK_ITERATIONS = 100;

function trackingScheduler({ autoRun = () => false } = {}) {
  const active = new Set();
  let nextId = 0;
  let peak = 0;
  const scheduler = {
    setTimeout(callback, delay) {
      const handle = { id: ++nextId, callback, delay, cancelled: false };
      active.add(handle);
      peak = Math.max(peak, active.size);
      if (autoRun(delay)) {
        queueMicrotask(() => {
          if (handle.cancelled) return;
          active.delete(handle);
          callback();
        });
      }
      return handle;
    },
    clearTimeout(handle) {
      if (!handle) return;
      handle.cancelled = true;
      active.delete(handle);
    },
  };
  return { active, scheduler, peak: () => peak };
}

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function transientResources(rootDir) {
  const found = [];
  async function walk(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      if (entry.name === ".state-operation.lock" || entry.name.includes(".tmp-")) {
        found.push(path.relative(rootDir, absolute));
      }
    }
  }
  await walk(rootDir);
  return found.sort();
}

function failOnceFilesystem(method, code = "EIO") {
  let failed = false;
  return new Proxy(fs, {
    get(target, property) {
      if (property === method) {
        return async (...args) => {
          if (!failed) {
            failed = true;
            throw Object.assign(new Error(`injected ${String(method)} failure`), { code });
          }
          return target[property](...args);
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function delegationFixture(index) {
  const template = createAgentTemplate({
    id: "soak-reviewer",
    version: "1.0.0",
    backendAgentId: "omp-reviewer",
    sourceHash: digestValue("soak-reviewer-source"),
    promptHash: digestValue("soak-reviewer-prompt"),
    tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "review",
    inputSchema: null,
    outputSchema: { type: "object", required: ["verdict"] },
    writer: false,
    continuable: false,
    resumable: false,
    timeoutSeconds: 60,
  });
  const agentSpec = createResolvedAgentSpec({ template, id: "soak-reviewer-resolved" });
  const assignment = createTaskAssignment({
    assignmentId: `soak-assignment-${index}`,
    agentSpec,
    task: "Exercise adapter lifecycle cleanup without child execution.",
    ownership: { writer: false, workspace: "shared-read-only", allowedPaths: [] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: [] },
    budget: { maxElapsedMs: 60_000, maxOutputBytes: 4096 },
  });
  const handle = createAgentRunHandle({
    runId: `soak-run-${index}`,
    nodeId: "review",
    attemptId: `soak-attempt-${index}`,
    assignment,
    agentSpec,
  });
  return { agentSpec, assignment, handle };
}

function workflowPlan() {
  return compileWorkflowDefinition({
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id: "resource-leak-soak",
    version: "2.0.0",
    description: "Deterministic resource lifecycle soak fixture",
    policy: {
      workspace: "shared-read-only",
      mutation: "none",
      egress: { web: "deny", mcp: "deny", provider: "allow" },
      tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    },
    budget: {
      maxNodes: 1,
      maxParallel: 1,
      maxDepth: 1,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: 10_000,
      maxOutputBytes: 65_536,
      maxAssignments: 1,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: {
      kind: "agent",
      id: "inspect",
      agentTemplateRef: "scout",
      needs: [],
      assignment: { taskTemplateRef: "resource-leak-inspect" },
      outputSchemaRef: null,
      policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"] } },
      budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096, maxTokens: null, maxCostUsd: null },
      cache: { mode: "content-addressed", keyInputs: ["assignment"] },
      idempotency: "content-addressed",
    },
    terminalNodeId: "inspect",
  });
}

function coordinatorHarness(rootDir, plan, scheduler, nodeExecutor) {
  let now = Date.UTC(2026, 7, 24);
  let sequence = 0;
  const journalClock = () => new Date(now += 5);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir, filesystem: fs, clock: journalClock, idFactory });
  const planStore = createPlanStore({ rootDir, filesystem: fs, clock: journalClock, idFactory });
  const budgetLedger = createBudgetLedger({
    eventJournal,
    envelope: () => plan.budget,
    metering: () => ({ tokens: false, cost: false }),
  });
  const coordinator = createRunCoordinator({
    eventJournal,
    planStore,
    budgetLedger,
    clock: () => now,
    idFactory,
    nodeExecutor,
    scheduler,
  });
  return { coordinator, eventJournal };
}

test("100-cycle per audited RPC version disposes hanging requests and releases listeners and timers", async () => {
  class Transport extends EventEmitter {
    async request() {
      return new Promise(() => {});
    }
  }
  const transport = new Transport();
  transport.setMaxListeners(0);
  const timers = trackingScheduler();
  for (const backendVersion of [PI_SUBAGENTS_RPC_V1_BACKEND_VERSION, PI_SUBAGENTS_RPC_V1_CANDIDATE_BACKEND_VERSION]) {
    for (let index = 0; index < ADAPTER_SOAK_ITERATIONS; index += 1) {
      const backend = createPiSubagentsRpcV1Backend({
        transport,
        backendVersion,
        timeoutMs: 60_000,
        terminalTimeoutMs: 60_000,
        scheduler: timers.scheduler,
      });
      const pending = backend.ensureReady();
      const rejection = assert.rejects(pending, { code: "ADAPTER_DISPOSED" });
      await nextTurn();
      assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete), 1);
      assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal), 1);
      assert.equal(timers.active.size, 1);
      assert.equal((await backend.dispose()).status, "DISPOSED");
      await rejection;
      assert.equal((await backend.dispose()).status, "DISPOSED");
      assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete), 0);
      assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal), 0);
      assert.equal(timers.active.size, 0);
    }
  }
  assert.equal(transport.eventNames().length, 0);
  assert.ok(timers.peak() >= 1);
});

test("100-cycle terminal event store dispose rejects every waiter and clears its timeout", async () => {
  const transport = new EventEmitter();
  transport.setMaxListeners(0);
  const timers = trackingScheduler();
  for (let index = 0; index < ADAPTER_SOAK_ITERATIONS; index += 1) {
    const store = new PiSubagentsTerminalEventStore({
      transport,
      events: PI_SUBAGENTS_RPC_V1_EVENTS,
      scheduler: timers.scheduler,
    });
    const waiting = store.wait(`terminal-${index}`, { timeoutMs: 60_000 });
    const rejection = assert.rejects(waiting, { code: "ADAPTER_DISPOSED" });
    assert.equal(timers.active.size, 1);
    store.dispose();
    await rejection;
    store.dispose();
    assert.equal(timers.active.size, 0);
    assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.asyncComplete), 0);
    assert.equal(transport.listenerCount(PI_SUBAGENTS_RPC_V1_EVENTS.processTerminal), 0);
  }
});

test("100-cycle per audited structured delegation version settles start waiters and clears resources", async () => {
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const transport = {
    subscribe(name, handler) {
      events.on(name, handler);
      return () => events.off(name, handler);
    },
    emit() {},
  };
  const timers = trackingScheduler();
  for (const backendVersion of ["0.45.2", PI_SUBAGENTS_DELEGATION_V1_CANDIDATE_BACKEND_VERSION]) {
    for (let index = 0; index < ADAPTER_SOAK_ITERATIONS; index += 1) {
      const backend = createPiSubagentsDelegationV1Backend({
        transport,
        cwd: "/fixture",
        backendVersion,
        timeoutMs: 60_000,
        scheduler: timers.scheduler,
      });
      const launching = backend.launch({ ...delegationFixture(index), mode: "background" });
      const rejection = assert.rejects(launching, { code: "ADAPTER_DISPOSED" });
      await nextTurn();
      for (const name of [
        PI_SUBAGENTS_DELEGATION_V1_EVENTS.started,
        PI_SUBAGENTS_DELEGATION_V1_EVENTS.update,
        PI_SUBAGENTS_DELEGATION_V1_EVENTS.response,
      ]) assert.equal(events.listenerCount(name), 1);
      assert.equal(timers.active.size, 1);
      assert.equal((await backend.dispose()).status, "DISPOSED");
      await rejection;
      assert.equal((await backend.dispose()).status, "DISPOSED");
      assert.equal(timers.active.size, 0);
      for (const name of events.eventNames()) assert.equal(events.listenerCount(name), 0);
    }
  }
  assert.equal(events.eventNames().length, 0);
});

test("100-cycle BatchSwarm soak clears deadline, ramp, and finite-retry timers", async () => {
  const sourceDefinition = JSON.parse(fsSync.readFileSync("swarm/batches/review-items.json", "utf8"));
  const definition = {
    ...sourceDefinition,
    concurrency: { initial: 1, max: 2, rampEveryMs: 1, adaptiveRateLimit: false },
    failurePolicy: { kind: "continue" },
    retryPolicy: { maxAttempts: 2, maxDelayMs: 1, deadlineMs: 10_000 },
  };
  const agentSpec = JSON.parse(fsSync.readFileSync("swarm/agent-specs/omp-reviewer-resolved.json", "utf8"));
  const promptTemplate = fsSync.readFileSync("swarm/templates/review-item.txt", "utf8");
  const timers = trackingScheduler({ autoRun: (delay) => delay < definition.retryPolicy.deadlineMs });
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => agentSpec,
    resolvePromptTemplate: async () => promptTemplate,
    resolveItems: async (_definition, _input, context) => context.input.artifacts.items,
    executeItem: async (input) => {
      if (input.index === 0 && input.itemAttempt === 1) {
        return {
          outcome: "failed",
          authoritative: true,
          error: { code: "RATE_LIMITED", retryable: true, retryAfterMs: 1 },
          usage: { elapsedMs: 1, tokens: 0, costUsd: 0 },
          handle: { handleId: `${input.runId}-retry` },
        };
      }
      return {
        outcome: "completed",
        authoritative: true,
        receiptId: digestValue({ runId: input.runId, index: input.index, attempt: input.itemAttempt }),
        result: { verdict: "pass", findings: [], tested: [], unverified: [] },
        usage: { elapsedMs: 1, tokens: 0, costUsd: 0 },
        handle: { handleId: `${input.runId}-${input.index}` },
      };
    },
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix({ terminalTransport: true }),
    scheduler: timers.scheduler,
    clock: () => 1000,
  });
  const node = {
    kind: "batch-swarm",
    id: "leak-soak",
    batchRef: definition.id,
    budget: { timeoutMs: definition.retryPolicy.deadlineMs, maxOutputBytes: 65_536 },
  };
  for (let index = 0; index < BATCH_SOAK_ITERATIONS; index += 1) {
    const result = await executor.runBatch(node, {
      runId: `batch-leak-${index}`,
      attemptId: `batch-attempt-${index}`,
      input: { artifacts: { items: [{ value: 0 }, { value: 1 }, { value: 2 }] } },
    });
    assert.equal(result.outcome, "completed");
    assert.equal(result.result.total, 3);
    assert.equal(result.result.attempts, 4);
    assert.equal(timers.active.size, 0);
  }
  assert.ok(timers.peak() >= 2, "soak must exercise overlapping deadline and ramp/retry timers");
});

test("32 completed coordinator runs release heartbeat/deadline timers, leases, locks, and active entries", { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-coordinator-complete-soak-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plan = workflowPlan();
  const timers = trackingScheduler();
  const { coordinator, eventJournal } = coordinatorHarness(root, plan, timers.scheduler, {
    async runAgent(node, context) {
      return {
        runId: context.runId,
        nodeId: node.id,
        attemptId: context.attemptId,
        outcome: "completed",
        authoritative: true,
        result: { ok: true },
      };
    },
  });
  for (let index = 0; index < COORDINATOR_COMPLETION_ITERATIONS; index += 1) {
    const runId = `complete-soak-${index}`;
    const result = await coordinator.execute(plan, { runId, input: { iteration: index } });
    assert.equal(result.status, "completed");
    assert.equal((await coordinator.pause(runId)).status, "RUN_NOT_ACTIVE");
    assert.equal((await eventJournal.writer(runId)).status, "released");
    assert.equal(timers.active.size, 0);
  }
  assert.ok(timers.peak() >= 2, "coordinator must exercise lease-heartbeat and node-deadline timers");
  assert.deepEqual(await transientResources(root), []);
});

test("16 uncooperative-child cancellations settle orphaned and release grace timers, leases, locks, and active entries", { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-coordinator-orphan-soak-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const plan = workflowPlan();
  const graceMs = 7;
  const timers = trackingScheduler({ autoRun: (delay) => delay === graceMs });
  let entered = null;
  const { coordinator, eventJournal } = coordinatorHarness(root, plan, timers.scheduler, {
    async startAgent(_node, context) {
      const terminal = new Promise((_, reject) => {
        context.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted without process-terminal proof"), { code: "ABORT_ERR" }));
        }, { once: true });
      });
      setImmediate(() => entered?.());
      return { handle: { backendId: `uncooperative-${context.runId}` }, terminal };
    },
    async stop() {
      return new Promise(() => {});
    },
  });
  for (let index = 0; index < COORDINATOR_ORPHAN_ITERATIONS; index += 1) {
    const runId = `orphan-soak-${index}`;
    const childEntered = new Promise((resolve) => { entered = resolve; });
    const running = coordinator.execute(plan, { runId, input: { iteration: index } });
    await childEntered;
    const cancellation = await coordinator.cancel(runId, { graceMs });
    const result = await running;
    assert.equal(cancellation.status, "CANCEL_REQUESTED");
    assert.equal(cancellation.stopResults[0].status, "STOP_PENDING");
    assert.equal(result.status, "orphaned");
    assert.equal((await coordinator.pause(runId)).status, "RUN_NOT_ACTIVE");
    assert.equal((await eventJournal.writer(runId)).status, "released");
    assert.equal(timers.active.size, 0);
    entered = null;
  }
  assert.ok(timers.peak() >= 2, "orphan soak must exercise coordinator and cancellation timers");
  assert.deepEqual(await transientResources(root), []);
});

test("100 artifact publications and injected state-store faults leave no locks or temporary files", { timeout: 120_000 }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-storage-soak-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifactRoot = path.join(root, "artifacts");
  const artifactStore = createArtifactStore({ rootDir: artifactRoot, filesystem: fs, maxArtifactBytes: 4096 });
  for (let index = 0; index < ARTIFACT_SOAK_ITERATIONS; index += 1) {
    const contents = `artifact-${index}\n`;
    const ref = await artifactStore.publish({
      id: `artifact-${index}`,
      mediaType: "text/plain",
      contents,
      producer: { runId: `artifact-run-${index}`, revision: 0, nodeId: "inspect", attemptId: `attempt-${index}` },
      provenance: {
        sourceDigest: digestValue({ source: index }),
        policyDigest: digestValue("resource-leak-policy"),
        redaction: "bounded",
      },
    });
    assert.equal((await artifactStore.read(ref)).toString("utf8"), contents);
  }

  const plan = workflowPlan();
  const planRoot = path.join(root, "plan-fault");
  const planStore = createPlanStore({
    rootDir: planRoot,
    filesystem: failOnceFilesystem("link"),
    clock: () => new Date(Date.UTC(2026, 7, 24)),
    idFactory: (prefix) => `${prefix}-fault`,
  });
  const envelope = createExecutionEnvelope(plan, { runId: "plan-fault", input: {} });
  await assert.rejects(
    () => planStore.put({ runId: "plan-fault", plan, executionEnvelope: envelope }),
    { code: "PLAN_STORE_WRITE_FAILED" },
  );

  const artifactFaultRoot = path.join(root, "artifact-fault");
  const faultingArtifactStore = createArtifactStore({
    rootDir: artifactFaultRoot,
    filesystem: failOnceFilesystem("link"),
    maxArtifactBytes: 4096,
  });
  await assert.rejects(() => faultingArtifactStore.publish({
    id: "artifact-fault",
    mediaType: "text/plain",
    contents: "fault\n",
    producer: { runId: "artifact-fault", revision: 0, nodeId: "inspect", attemptId: "attempt-fault" },
    provenance: {
      sourceDigest: digestValue("fault-source"),
      policyDigest: digestValue("fault-policy"),
      redaction: "digest-only",
    },
  }), { code: "EIO" });

  const journalFaultRoot = path.join(root, "journal-fault");
  const journal = createEventJournal({
    rootDir: journalFaultRoot,
    filesystem: failOnceFilesystem("rename"),
    clock: () => new Date(Date.UTC(2026, 7, 24)),
    idFactory: (prefix) => `${prefix}-fault`,
  });
  await assert.rejects(
    () => journal.acquireWriter("journal-fault", { writerId: "fault-writer", ttlMs: 1000 }),
    { code: "ATOMIC_PUBLICATION_FAILED" },
  );
  assert.deepEqual(await transientResources(root), []);
});
