import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import { createApprovalReceipt } from "../packages/subagents/policy/approval-receipt.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";
import { compileWorkflowDefinition, digestWorkflowValue } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createExecutionEnvelope, createRunCoordinator } from "../packages/subagents/workflow/run-coordinator/index.mjs";

function definition(flow, overrides = {}) {
  return {
    $schema: "../../schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: "coordinator-fixture",
    version: "2.0.0",
    description: "RunCoordinator fixture",
    policy: {
      workspace: "shared-read-only",
      mutation: "none",
      egress: { web: "deny", mcp: "deny", provider: "allow" },
      tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    },
    budget: {
      maxNodes: 16,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 2,
      maxWallTimeMs: 20_000,
      maxOutputBytes: 1_000_000,
      maxAssignments: 8,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow,
    ...overrides,
  };
}

function agent(id, { needs = [], attempts = 1, mutation = false, maxTokens = null, maxCostUsd = null } = {}) {
  return {
    kind: "agent",
    id,
    agentTemplateRef: mutation ? "implementer" : "scout",
    needs,
    assignment: { taskTemplateRef: `task-${id}` },
    outputSchemaRef: null,
    policy: mutation
      ? { workspace: "managed-worktree", mutation: "guarded", tools: { allow: ["edit", "write"] } }
      : { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"] } },
    budget: { maxAttempts: attempts, timeoutMs: 1000, maxOutputBytes: 4096, maxTokens, maxCostUsd },
    cache: { mode: mutation ? "never" : "content-addressed", keyInputs: ["assignment"] },
    idempotency: mutation ? "receipt" : "content-addressed",
  };
}

function reservationVectorForTest(node) {
  const vector = { elapsedMs: node.budget.timeoutMs, rawOutputBytes: node.budget.maxOutputBytes };
  if (["agent", "batch-swarm"].includes(node.kind)) vector.assignments = 1;
  if (node.budget.maxTokens !== null) vector.tokens = node.budget.maxTokens;
  if (node.budget.maxCostUsd !== null) vector.cost = node.budget.maxCostUsd;
  return vector;
}

function gate(id, needs = []) {
  return {
    kind: "gate",
    id,
    gateId: "test-contract",
    needs,
    policy: { workspace: "shared-read-only", mutation: "none" },
    budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 },
    cache: { mode: "never", keyInputs: [] },
    idempotency: "receipt",
  };
}

function manualScheduler() {
  const pending = [];
  return {
    setTimeout(callback, delay) {
      const handle = { callback, delay, cancelled: false };
      pending.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cancelled = true;
    },
    async flushNext() {
      const handle = pending.shift();
      if (!handle) throw new Error("manual scheduler has no pending callback");
      if (handle.cancelled) return this.flushNext();
      await handle.callback();
    },
    async flushDelay(delay) {
      const index = pending.findIndex((handle) => !handle.cancelled && handle.delay === delay);
      if (index === -1) throw new Error(`manual scheduler has no pending ${delay}ms callback`);
      const [handle] = pending.splice(index, 1);
      await handle.callback();
    },
  };
}

async function harness(t, plan, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-run-coordinator-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let instant = Date.UTC(2026, 7, 18);
  let sequence = 0;
  const clock = () => new Date(instant += 5);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock, idFactory });
  const budgetLedger = createBudgetLedger({
    eventJournal,
    envelope: () => plan.budget,
    metering: () => options.metering ?? ({ tokens: false, cost: false }),
  });
  const coordinatorJournal = options.renewWriter === undefined
    ? eventJournal
    : Object.freeze({ ...eventJournal, renewWriter: options.renewWriter });
  const coordinator = createRunCoordinator({
    eventJournal: coordinatorJournal,
    budgetLedger,
    clock: () => instant,
    idFactory,
    nodeExecutor: options.nodeExecutor,
    gateRunner: options.gateRunner ?? { async run() { return { status: "PASS", digest: "sha256:gate" }; } },
    approvalVerifier: options.approvalVerifier,
    approvalEvidenceProvider: options.approvalEvidenceProvider,
    checkpointService: options.checkpointService,
    leaseTtlMs: options.leaseTtlMs,
    leaseRenewalIntervalMs: options.leaseRenewalIntervalMs,
    scheduler: options.scheduler,
  });
  return { root, eventJournal, budgetLedger, coordinator, clock, idFactory, advance: (ms) => { instant += ms; } };
}

test("RunCoordinator admits ready nodes, preserves parallel logical admission, and closes one hash-chained run", async (t) => {
  const plan = compileWorkflowDefinition(definition({
    kind: "sequence",
    steps: [
      { kind: "parallel", branches: [agent("inspect-a"), agent("inspect-b")] },
      gate("verify"),
    ],
  }));
  const started = [];
  const observedInputs = [];
  const { coordinator, eventJournal } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        started.push(node.id);
        observedInputs.push(context.input);
        return {
          runId: context.runId,
          nodeId: node.id,
          attemptId: context.attemptId,
          outcome: "completed",
          authoritative: true,
          result: { summary: `${node.id} done` },
          usage: { elapsedMs: 10 },
        };
      },
    },
  });
  const result = await coordinator.execute(plan, { runId: "parallel-run", input: { goal: "inspect both branches" } });
  assert.equal(result.status, "completed");
  assert.deepEqual(started.sort(), ["inspect-a", "inspect-b"]);
  assert.deepEqual(observedInputs, [{ goal: "inspect both branches" }, { goal: "inspect both branches" }]);
  assert.equal(observedInputs.every((input) => Object.isFrozen(input)), true);
  assert.equal(result.nodes.verify.outcome, "completed");
  const verified = await eventJournal.verify("parallel-run");
  assert.equal(verified.ok, true);
  assert.equal(verified.snapshot.state.status, "completed");
  assert.deepEqual(verified.journal.events.map((event) => event.seq), Array.from({ length: verified.journal.events.length }, (_, index) => index + 1));
  assert.ok(verified.journal.events.some((event) => event.type === "BudgetReserved"));
  assert.ok(verified.journal.events.some((event) => event.type === "BudgetConsumed"));
});

test("lease heartbeat keeps child and gate execution writable beyond the original lease TTL", async (t) => {
  const plan = compileWorkflowDefinition(definition({
    kind: "sequence",
    steps: [agent("inspect"), gate("verify", ["inspect"])],
  }));
  const scheduler = manualScheduler();
  let advance;
  const { coordinator, eventJournal, advance: advanceClock } = await harness(t, plan, {
    scheduler,
    leaseTtlMs: 500,
    leaseRenewalIntervalMs: 100,
    nodeExecutor: {
      async runAgent(node, context) {
        advance(100);
        await scheduler.flushDelay(100);
        advance(350);
        await scheduler.flushDelay(100);
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { renewed: true } };
      },
    },
    gateRunner: {
      async run(_gateId, context) {
        advance(300);
        await scheduler.flushDelay(100);
        return { status: "PASS", digest: "sha256:renewed-gate" };
      },
    },
  });
  advance = advanceClock;

  const result = await coordinator.execute(plan, { runId: "heartbeat-long-run" });
  assert.equal(result.status, "completed");
  assert.equal(result.nodes.inspect.outcome, "completed");
  assert.equal(result.nodes.verify.outcome, "completed");
  const events = (await eventJournal.read("heartbeat-long-run")).events;
  assert.ok(events.some((event) => event.type === "ChildTerminal"));
  assert.ok(events.some((event) => event.type === "GateEvaluated"));
  assert.ok(events.some((event) => event.type === "RunCompleted"));
});

test("lost fencing aborts a child and refuses to forge terminal or settlement events", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const scheduler = manualScheduler();
  let entered;
  let advance;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const { coordinator, eventJournal, advance: advanceClock } = await harness(t, plan, {
    scheduler,
    leaseTtlMs: 500,
    leaseRenewalIntervalMs: 100,
    nodeExecutor: {
      async runAgent(_node, context) {
        entered();
        await new Promise((resolve) => context.signal.addEventListener("abort", resolve, { once: true }));
        return { outcome: "completed", authoritative: true, result: { mustNotBeRecorded: true } };
      },
    },
  });
  advance = advanceClock;

  const running = coordinator.execute(plan, { runId: "heartbeat-fenced-run" });
  await enteredPromise;
  advance(600);
  const replacement = await eventJournal.acquireWriter("heartbeat-fenced-run", {
    writerId: "replacement-writer",
    ttlMs: 500,
    provePreviousWriterDead: async () => true,
  });
  assert.equal(replacement.fencingToken, 2);
  await scheduler.flushNext();
  await assert.rejects(running, (error) => error?.code === "STALE_WRITER");

  const events = (await eventJournal.read("heartbeat-fenced-run")).events;
  assert.equal(events.some((event) => event.type === "ChildTerminal"), false);
  assert.equal(events.some((event) => event.type === "NodeSettled"), false);
  assert.equal(events.some((event) => ["RunCompleted", "RunFailed", "RunInterrupted", "RunOrphaned"].includes(event.type)), false);
  await eventJournal.releaseWriter("heartbeat-fenced-run", { lease: replacement });
});

test("non-fencing renewal failure interrupts an uncooperative child and fails closed", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const scheduler = manualScheduler();
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const renewalError = Object.assign(new Error("injected renewal I/O failure"), { code: "LEASE_IO_FAILURE" });
  const { coordinator, eventJournal } = await harness(t, plan, {
    scheduler,
    leaseTtlMs: 500,
    leaseRenewalIntervalMs: 100,
    renewWriter: async () => { throw renewalError; },
    nodeExecutor: {
      async runAgent() {
        entered();
        return new Promise(() => {});
      },
    },
  });

  const running = coordinator.execute(plan, { runId: "heartbeat-renewal-failure" });
  await enteredPromise;
  await scheduler.flushNext();
  await assert.rejects(running, (error) => error?.code === "LEASE_RENEWAL_FAILED");
  const events = (await eventJournal.read("heartbeat-renewal-failure")).events;
  assert.equal(events.some((event) => event.type === "ChildTerminal"), false);
  assert.equal(events.some((event) => event.type === "NodeSettled"), false);
});

test("lease renewal cadence must be strictly shorter than the writer TTL", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  await assert.rejects(
    harness(t, plan, { leaseTtlMs: 500, leaseRenewalIntervalMs: 500 }),
    (error) => error instanceof TypeError && /below leaseTtlMs/u.test(error.message),
  );
});

test("node deadline charges worst-case but remains orphaned without terminal process proof", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const scheduler = manualScheduler();
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const { coordinator, eventJournal } = await harness(t, plan, {
    scheduler,
    nodeExecutor: {
      async runAgent() {
        entered();
        return new Promise(() => {});
      },
    },
  });

  const running = coordinator.execute(plan, { runId: "node-timeout-run" });
  await enteredPromise;
  await scheduler.flushDelay(1000);
  const result = await running;
  assert.equal(result.status, "orphaned");
  assert.equal(result.nodes.inspect.outcome, "orphaned");
  const events = (await eventJournal.read("node-timeout-run")).events;
  const childTerminal = events.find((event) => event.type === "ChildTerminal");
  assert.equal(childTerminal.payload.outcome, "timed-out");
  assert.equal(childTerminal.payload.authoritative, false);
  assert.equal(childTerminal.payload.errorCode, "BUDGET_OVERRUN");
  const nodeSettled = events.find((event) => event.type === "NodeSettled");
  assert.equal(nodeSettled.payload.outcome, "orphaned");
  assert.equal(nodeSettled.payload.authoritative, false);
  assert.equal(nodeSettled.payload.errorCode, "BUDGET_OVERRUN");
  assert.ok(events.some((event) => event.type === "RunOrphaned" && event.payload.details.errorCode === "BUDGET_OVERRUN"));
  assert.equal(events.some((event) => event.type === "RunFailed"), false);
  const consumed = events.find((event) => event.type === "BudgetConsumed").payload.consumed;
  assert.equal(consumed.elapsedMs, 1000);
});

test("raw result bytes are measured before projection and output overrun cannot complete", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const { coordinator, eventJournal } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: "x".repeat(10_000), usage: { elapsedMs: 10 } };
      },
    },
  });
  const result = await coordinator.execute(plan, { runId: "output-overrun-run" });
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.nodes.inspect.outcome, "budget-exhausted");
  const events = (await eventJournal.read("output-overrun-run")).events;
  const settled = events.find((event) => event.type === "NodeSettled");
  assert.equal(settled.payload.errorCode, "BUDGET_OVERRUN");
  const consumed = events.find((event) => event.type === "BudgetConsumed").payload.consumed;
  assert.equal(consumed.rawOutputBytes, 4096);
  assert.equal(consumed.elapsedMs, 1000);
});

test("cyclic and excessively deep child results fail closed before unbounded cloning or serialization", async (t) => {
  for (const [suffix, resultValue] of [
    ["cyclic", (() => { const value = {}; value.self = value; return value; })()],
    ["deep", (() => { const root = {}; let cursor = root; for (let depth = 0; depth < 80; depth += 1) { cursor.next = {}; cursor = cursor.next; } return root; })()],
  ]) {
    const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
    const { coordinator, eventJournal } = await harness(t, plan, {
      nodeExecutor: {
        async runAgent(node, context) {
          return {
            runId: context.runId,
            nodeId: node.id,
            attemptId: context.attemptId,
            outcome: "completed",
            authoritative: true,
            result: resultValue,
            usage: { elapsedMs: 10 },
          };
        },
      },
    });
    const runId = `output-bomb-${suffix}`;
    const result = await coordinator.execute(plan, { runId });
    assert.equal(result.status, "budget-exhausted");
    const events = (await eventJournal.read(runId)).events;
    const childTerminal = events.find((event) => event.type === "ChildTerminal");
    assert.equal(childTerminal.payload.errorCode, "BUDGET_OVERRUN");
    assert.equal(events.find((event) => event.type === "NodeSettled").payload.errorCode, "BUDGET_OVERRUN");
  }
});

test("token and cost overrun charge worst-case and cannot be reported completed", async (t) => {
  const plan = compileWorkflowDefinition(definition({
    kind: "sequence",
    steps: [agent("inspect", { maxTokens: 50, maxCostUsd: 0.5 })],
  }, {
    budget: {
      maxNodes: 16,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 2,
      maxWallTimeMs: 20_000,
      maxOutputBytes: 1_000_000,
      maxAssignments: 8,
      maxTokens: 100,
      maxCostUsd: 1,
    },
  }));
  const { coordinator, eventJournal } = await harness(t, plan, {
    metering: { tokens: true, cost: true },
    nodeExecutor: {
      async runAgent(node, context) {
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { ok: true }, usage: { elapsedMs: 10, tokens: 60, costUsd: 0.75 } };
      },
    },
  });
  const result = await coordinator.execute(plan, { runId: "metered-overrun-run" });
  assert.equal(result.status, "budget-exhausted");
  const events = (await eventJournal.read("metered-overrun-run")).events;
  assert.equal(events.find((event) => event.type === "NodeSettled").payload.errorCode, "BUDGET_OVERRUN");
  const consumed = events.find((event) => event.type === "BudgetConsumed").payload.consumed;
  assert.equal(consumed.tokens, 50);
  assert.equal(consumed.cost, 0.5);
});

test("mutating plans wait for an exact plan/policy/revision approval receipt", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("implement", { mutation: true }), gate("verify", ["implement"])] }, {
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } },
  }));
  let calls = 0;
  const repo = { identity: "github.com/example/fixture", baseCommit: "0123456789abcdef0123456789abcdef01234567", allowedPaths: ["packages/subagents"], writerClaims: ["packages/subagents"] };
  const capabilityEnvelopeHash = `sha256:${"c".repeat(64)}`;
  const envelope = createExecutionEnvelope(plan, { runId: "approval-run", input: {} });
  let evidenceReads = 0;
  let observedAuthorization = null;
  const { coordinator } = await harness(t, plan, {
    approvalEvidenceProvider: async () => {
      evidenceReads += 1;
      return { repo, capabilityEnvelopeHash };
    },
    nodeExecutor: {
      capabilities: { pathEnforcement: "ENFORCED" },
      async runAgent(node, context) {
        calls += 1;
        observedAuthorization = context.authorization;
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { changedFiles: ["safe.txt"] } };
      },
    },
  });
  const waiting = await coordinator.execute(plan, { runId: "approval-run" });
  assert.equal(waiting.status, "awaiting-approval");
  assert.equal(calls, 0);
  const receipt = createApprovalReceipt({ plan, repo, capabilityEnvelopeHash, executionEnvelopeDigest: envelope.executionEnvelopeDigest, origin: "explicit-cli-yes", approvedAt: "2026-08-18T00:00:00.000Z" });
  const approved = await coordinator.execute(plan, {
    runId: "approval-run",
    executionEnvelope: envelope,
    approval: receipt,
  });
  assert.equal(approved.status, "completed");
  assert.equal(calls, 1);
  assert.deepEqual(observedAuthorization, {
    formatVersion: 1,
    repo,
    scope: receipt.scope,
    receiptId: receipt.receiptId,
    executionEnvelopeDigest: envelope.executionEnvelopeDigest,
  });
  assert.equal(Object.isFrozen(observedAuthorization), true);
  assert.equal(Object.isFrozen(observedAuthorization.repo.allowedPaths), true);
  assert.equal(Object.isFrozen(observedAuthorization.scope), true);
  assert.ok(evidenceReads >= 3, "initial denial, resume, and mutating-node admission each read current evidence");

  await assert.rejects(
    coordinator.execute(plan, { runId: "approval-run-replay", executionEnvelope: envelope, approval: receipt }),
    (error) => error?.code === "RUN_ID_DRIFT",
  );
  const replayEnvelope = createExecutionEnvelope(plan, { runId: "approval-run-replay", input: {} });
  const replay = await coordinator.execute(plan, { runId: "approval-run-replay", executionEnvelope: replayEnvelope, approval: receipt });
  assert.equal(replay.status, "awaiting-approval");
  assert.equal(calls, 1, "one run's ApprovalReceipt cannot authorize a second writer run");
});

test("RunApproved never bypasses live revalidation on resume or mutating-node admission", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("implement", { mutation: true })] }, {
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } },
  }));
  const repo = { identity: "github.com/example/fixture", baseCommit: "0123456789abcdef0123456789abcdef01234567", allowedPaths: ["packages/subagents"], writerClaims: ["packages/subagents"] };
  const driftedRepo = { ...repo, baseCommit: "fedcba9876543210fedcba9876543210fedcba98" };
  const capabilityEnvelopeHash = `sha256:${"d".repeat(64)}`;
  const envelope = createExecutionEnvelope(plan, { runId: "live-reapproval-run", input: { goal: "guarded" } });
  const receipt = createApprovalReceipt({ plan, repo, capabilityEnvelopeHash, executionEnvelopeDigest: envelope.executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  let driftAtAdmission = true;
  let mutations = 0;
  const { coordinator, eventJournal } = await harness(t, plan, {
    approvalEvidenceProvider: async ({ stage }) => ({
      repo: stage === "mutating-node-admission" && driftAtAdmission ? driftedRepo : repo,
      capabilityEnvelopeHash,
    }),
    nodeExecutor: {
      capabilities: { pathEnforcement: "ENFORCED" },
      async runAgent(node, context) {
        mutations += 1;
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { changed: true } };
      },
    },
  });

  const waitingAtAdmission = await coordinator.execute(plan, { runId: "live-reapproval-run", input: { goal: "guarded" }, executionEnvelope: envelope, approval: receipt });
  assert.equal(waitingAtAdmission.status, "awaiting-approval");
  assert.equal(mutations, 0);
  assert.ok((await eventJournal.read("live-reapproval-run")).events.some((event) => event.type === "RunApproved"));

  driftAtAdmission = false;
  const missingOnResume = await coordinator.execute(plan, { runId: "live-reapproval-run", input: { goal: "guarded" }, executionEnvelope: envelope });
  assert.equal(missingOnResume.status, "awaiting-approval");
  assert.equal(mutations, 0);

  const completed = await coordinator.execute(plan, { runId: "live-reapproval-run", input: { goal: "guarded" }, executionEnvelope: envelope, approval: receipt });
  assert.equal(completed.status, "completed");
  assert.equal(mutations, 1);
});

test("mutating execution fails closed when only a static approval verifier is injected", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("implement", { mutation: true })] }, {
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } },
  }));
  let calls = 0;
  const { coordinator } = await harness(t, plan, {
    approvalVerifier: { verify: () => ({ ok: true, receiptDigest: `sha256:${"a".repeat(64)}` }) },
    nodeExecutor: { async runAgent() { calls += 1; return { outcome: "completed", authoritative: true }; } },
  });
  const result = await coordinator.execute(plan, { runId: "static-verifier-run", input: {}, approval: { planDigest: plan.planDigest } });
  assert.equal(result.status, "awaiting-approval");
  assert.equal(calls, 0);
});

test("idempotent failed attempts may retry, but use a fresh correlated attempt", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect", { attempts: 2 })] }));
  let calls = 0;
  const attempts = [];
  const { coordinator, eventJournal } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        calls += 1;
        attempts.push(context.attemptId);
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: calls === 1 ? "failed" : "completed", authoritative: true, result: { call: calls } };
      },
    },
  });
  const result = await coordinator.execute(plan, { runId: "retry-run" });
  assert.equal(result.status, "completed");
  assert.equal(result.nodes.inspect.attempts.length, 2);
  assert.equal(new Set(attempts).size, 2);
  const reservations = (await eventJournal.read("retry-run")).events.filter((event) => event.type === "BudgetReserved");
  assert.equal(reservations.length, 2);
  assert.deepEqual(reservations.map((event) => event.payload.worstCase.elapsedMs), [1000, 1000]);
});

test("recovery refuses transparent replay of an unfinished mutating attempt", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("implement", { mutation: true })] }, {
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } },
  }));
  const { coordinator, eventJournal } = await harness(t, plan, { nodeExecutor: { async runAgent() { assert.fail("unfinished mutating node must not replay"); } } });
  const envelope = createExecutionEnvelope(plan, { runId: "recovery-run", input: {} });
  const lease = await eventJournal.acquireWriter("recovery-run", { writerId: "fixture-writer", ttlMs: 1000 });
  let version = await eventJournal.read("recovery-run");
  const append = async (event) => {
    const result = await eventJournal.append("recovery-run", event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue({}), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-approved", type: "RunApproved", revision: 0, payload: { planDigest: plan.planDigest, policyDigest: plan.policyDigest, revision: 0, receiptDigest: `sha256:${"a".repeat(64)}`, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "implement", payload: { nodeDigest: `sha256:${"b".repeat(64)}`, needs: [] } });
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId: "implement", attemptId: "implement:old-attempt", payload: { reservationId: "old-reservation", attemptNumber: 1 } });
  await append({ eventId: "fixture-child", type: "ChildStarted", revision: 0, nodeId: "implement", attemptId: "implement:old-attempt", childId: "old-child", payload: { localOnly: true } });
  await eventJournal.releaseWriter("recovery-run", { lease });
  const result = await coordinator.execute(plan, { runId: "recovery-run" });
  assert.equal(result.status, "interrupted");
  assert.equal(result.nodes.implement.outcome, "interrupted");
});

test("recovery refunds admitted-but-not-started read-only work and requeues it", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const envelope = createExecutionEnvelope(plan, { runId: "replayable-recovery", input: {} });
  let calls = 0;
  const { coordinator, eventJournal } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        calls += 1;
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { recovered: true } };
      },
    },
  });
  const lease = await eventJournal.acquireWriter("replayable-recovery", { writerId: "fixture-writer", ttlMs: 1000 });
  let version = await eventJournal.read("replayable-recovery");
  const append = async (event) => {
    const result = await eventJournal.append("replayable-recovery", event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue({}), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "inspect", payload: { nodeDigest: digestWorkflowValue(plan.nodes.find((node) => node.id === "inspect")), needs: [] } });
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId: "inspect", attemptId: "inspect:old-attempt", payload: { reservationId: "old-reservation", attemptNumber: 1 } });
  await eventJournal.releaseWriter("replayable-recovery", { lease });
  const result = await coordinator.execute(plan, { runId: "replayable-recovery", input: {}, executionEnvelope: envelope });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
  assert.equal(result.nodes.inspect.status, "completed");
  assert.equal(result.nodes.inspect.outcome, "completed");
});

test("recovery charges worst-case for a started child and cannot respawn past maxAssignments", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect", { attempts: 2 })] }, {
    budget: {
      maxNodes: 16,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 2,
      maxWallTimeMs: 20_000,
      maxOutputBytes: 1_000_000,
      maxAssignments: 1,
      maxTokens: null,
      maxCostUsd: null,
    },
  }));
  const envelope = createExecutionEnvelope(plan, { runId: "started-crash-budget", input: {} });
  let calls = 0;
  const { coordinator, eventJournal, budgetLedger } = await harness(t, plan, {
    nodeExecutor: { async runAgent() { calls += 1; return { outcome: "completed", authoritative: true }; } },
  });
  const lease = await eventJournal.acquireWriter("started-crash-budget", { writerId: "fixture-writer", ttlMs: 1000 });
  let version = await eventJournal.read("started-crash-budget");
  const append = async (event) => {
    const result = await eventJournal.append("started-crash-budget", event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue({}), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "inspect", payload: { nodeDigest: digestWorkflowValue(plan.nodes[0]), needs: [] } });
  await budgetLedger.reserve("started-crash-budget", { reservationId: "old-reservation", ownerId: "inspect", nodeId: "inspect", attemptId: "inspect:old-attempt", worstCase: reservationVectorForTest(plan.nodes[0]) }, { lease, revision: 0 });
  version = await eventJournal.read("started-crash-budget");
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId: "inspect", attemptId: "inspect:old-attempt", payload: { reservationId: "old-reservation", attemptNumber: 1 } });
  await append({ eventId: "fixture-child", type: "ChildStarted", revision: 0, nodeId: "inspect", attemptId: "inspect:old-attempt", childId: "old-child", payload: { localOnly: true } });
  await eventJournal.releaseWriter("started-crash-budget", { lease });

  const result = await coordinator.execute(plan, { runId: "started-crash-budget", input: {}, executionEnvelope: envelope });
  assert.equal(result.status, "budget-exhausted");
  assert.equal(calls, 0);
  const events = (await eventJournal.read("started-crash-budget")).events;
  assert.equal(events.filter((event) => event.type === "ChildStarted").length, 1);
  assert.equal(events.filter((event) => event.type === "BudgetConsumed" && event.payload.reservationId === "old-reservation").length, 1);
});

test("recovery refunds an orphan reservation before NodeAdmitted and releases capacity", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }, {
    budget: {
      maxNodes: 16,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 2,
      maxWallTimeMs: 20_000,
      maxOutputBytes: 1_000_000,
      maxAssignments: 1,
      maxTokens: null,
      maxCostUsd: null,
    },
  }));
  const envelope = createExecutionEnvelope(plan, { runId: "orphan-reservation", input: {} });
  let calls = 0;
  const { coordinator, eventJournal, budgetLedger } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        calls += 1;
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { ok: true } };
      },
    },
  });
  const lease = await eventJournal.acquireWriter("orphan-reservation", { writerId: "fixture-writer", ttlMs: 1000 });
  let version = await eventJournal.read("orphan-reservation");
  const append = async (event) => {
    const result = await eventJournal.append("orphan-reservation", event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue({}), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "inspect", payload: { nodeDigest: digestWorkflowValue(plan.nodes[0]), needs: [] } });
  await budgetLedger.reserve("orphan-reservation", { reservationId: "orphan-reservation-id", ownerId: "inspect", nodeId: "inspect", attemptId: "inspect:never-admitted", worstCase: reservationVectorForTest(plan.nodes[0]) }, { lease, revision: 0 });
  await eventJournal.releaseWriter("orphan-reservation", { lease });

  const result = await coordinator.execute(plan, { runId: "orphan-reservation", input: {}, executionEnvelope: envelope });
  assert.equal(result.status, "completed");
  assert.equal(calls, 1);
  const events = (await eventJournal.read("orphan-reservation")).events;
  assert.equal(events.filter((event) => event.type === "BudgetRefunded" && event.payload.reservationId === "orphan-reservation-id").length, 1);
  assert.equal(events.filter((event) => event.type === "ChildStarted").length, 1);
});

test("cancel without correlated terminal proof becomes orphaned, never cancelled", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const { coordinator } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        entered();
        await new Promise((_, reject) => context.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted without process proof"), { code: "ABORT_ERR" })), { once: true }));
      },
    },
  });
  const running = coordinator.execute(plan, { runId: "cancel-run" });
  await enteredPromise;
  const cancellation = await coordinator.cancel("cancel-run", { graceMs: 2000 });
  const result = await running;
  assert.equal(cancellation.status, "CANCEL_REQUESTED");
  assert.equal(result.status, "orphaned");
  assert.notEqual(result.status, "cancelled");
});

test("durable runs bind canonical input and reject invalid, oversized, or drifted resume input", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("inspect")] }));
  const { coordinator } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { ok: true } };
      },
    },
  });
  const input = { goal: "stable", items: [1, 2] };
  const envelope = createExecutionEnvelope(plan, { runId: "input-bound-run", input, sourceHash: `sha256:${"e".repeat(64)}`, target: { kind: "workflow", id: "stable-target" }, conditions: ["session-idle", "mode-resolved"] });
  const completed = await coordinator.execute(plan, { runId: "input-bound-run", input, executionEnvelope: envelope });
  assert.equal(completed.runInputDigest, digestWorkflowValue(input));
  assert.equal(completed.executionEnvelopeDigest, envelope.executionEnvelopeDigest);
  assert.deepEqual(completed.executionEnvelope.target, { kind: "workflow", id: "stable-target" });
  await assert.rejects(coordinator.execute(plan, { runId: "input-bound-run", input: { goal: "changed" } }), (error) => error?.code === "RUN_INPUT_DRIFT");
  const driftedConditions = createExecutionEnvelope(plan, { runId: "input-bound-run", input, sourceHash: `sha256:${"e".repeat(64)}`, target: { kind: "workflow", id: "stable-target" }, conditions: ["session-idle"] });
  await assert.rejects(coordinator.execute(plan, { runId: "input-bound-run", input, executionEnvelope: driftedConditions }), (error) => error?.code === "EXECUTION_ENVELOPE_DRIFT");
  await assert.rejects(coordinator.execute(plan, { runId: "invalid-input-run", input: { bad: undefined } }), (error) => error?.code === "INVALID_RUN_INPUT");
  await assert.rejects(coordinator.execute(plan, { runId: "oversized-input-run", input: { text: "x".repeat(256 * 1024) } }), (error) => error?.code === "RUN_INPUT_TOO_LARGE");
});
