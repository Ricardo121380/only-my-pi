import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";
import { compileWorkflowDefinition } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createRunCoordinator } from "../packages/subagents/workflow/run-coordinator/index.mjs";

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

function agent(id, { needs = [], attempts = 1, mutation = false } = {}) {
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
    budget: { maxAttempts: attempts, timeoutMs: 1000, maxOutputBytes: 4096 },
    cache: { mode: mutation ? "never" : "content-addressed", keyInputs: ["assignment"] },
    idempotency: mutation ? "receipt" : "content-addressed",
  };
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
    metering: () => ({ tokens: false, cost: false }),
  });
  const coordinator = createRunCoordinator({
    eventJournal,
    budgetLedger,
    clock: () => instant,
    idFactory,
    nodeExecutor: options.nodeExecutor,
    gateRunner: options.gateRunner ?? { async run() { return { status: "PASS", digest: "sha256:gate" }; } },
    approvalVerifier: options.approvalVerifier,
    checkpointService: options.checkpointService,
  });
  return { root, eventJournal, budgetLedger, coordinator, clock, idFactory };
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
  const { coordinator, eventJournal } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        started.push(node.id);
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
  const result = await coordinator.execute(plan, { runId: "parallel-run" });
  assert.equal(result.status, "completed");
  assert.deepEqual(started.sort(), ["inspect-a", "inspect-b"]);
  assert.equal(result.nodes.verify.outcome, "completed");
  const verified = await eventJournal.verify("parallel-run");
  assert.equal(verified.ok, true);
  assert.equal(verified.snapshot.state.status, "completed");
  assert.deepEqual(verified.journal.events.map((event) => event.seq), Array.from({ length: verified.journal.events.length }, (_, index) => index + 1));
  assert.ok(verified.journal.events.some((event) => event.type === "BudgetReserved"));
  assert.ok(verified.journal.events.some((event) => event.type === "BudgetConsumed"));
});

test("mutating plans wait for an exact plan/policy/revision approval receipt", async (t) => {
  const plan = compileWorkflowDefinition(definition({ kind: "sequence", steps: [agent("implement", { mutation: true }), gate("verify", ["implement"])] }, {
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } },
  }));
  let calls = 0;
  const { coordinator } = await harness(t, plan, {
    nodeExecutor: {
      async runAgent(node, context) {
        calls += 1;
        return { runId: context.runId, nodeId: node.id, attemptId: context.attemptId, outcome: "completed", authoritative: true, result: { changedFiles: ["safe.txt"] } };
      },
    },
  });
  const waiting = await coordinator.execute(plan, { runId: "approval-run" });
  assert.equal(waiting.status, "awaiting-approval");
  assert.equal(calls, 0);
  const approved = await coordinator.execute(plan, {
    runId: "approval-run",
    approval: { planDigest: plan.planDigest, policyDigest: plan.policyDigest, revision: 0, origin: "user" },
  });
  assert.equal(approved.status, "completed");
  assert.equal(calls, 1);
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
  const lease = await eventJournal.acquireWriter("recovery-run", { writerId: "fixture-writer", ttlMs: 1000 });
  let version = await eventJournal.read("recovery-run");
  const append = async (event) => {
    const result = await eventJournal.append("recovery-run", event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest } });
  await append({ eventId: "fixture-approved", type: "RunApproved", revision: 0, payload: { planDigest: plan.planDigest, policyDigest: plan.policyDigest, revision: 0, receiptDigest: `sha256:${"a".repeat(64)}` } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "implement", payload: { nodeDigest: `sha256:${"b".repeat(64)}`, needs: [] } });
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId: "implement", attemptId: "implement:old-attempt", payload: { reservationId: "old-reservation", attemptNumber: 1 } });
  await append({ eventId: "fixture-child", type: "ChildStarted", revision: 0, nodeId: "implement", attemptId: "implement:old-attempt", childId: "old-child", payload: { localOnly: true } });
  await eventJournal.releaseWriter("recovery-run", { lease });
  const result = await coordinator.execute(plan, { runId: "recovery-run" });
  assert.equal(result.status, "interrupted");
  assert.equal(result.nodes.implement.outcome, "interrupted");
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
