import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { DIRECT_DELEGATION_EVENTS as EVENTS, createDirectCodingOrchestrator } from "../packages/direct-agent/orchestration.mjs";
import { DirectSessionController } from "../extensions/omp-direct/runtime.mjs";

const USAGE = { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, budget = {}, options = {}) {
  const events = new EventEmitter();
  const requests = [];
  const cancellations = [];
  events.on(EVENTS.request, (request) => requests.push(request));
  events.on(EVENTS.cancel, (request) => cancellations.push(request));
  const orchestrator = createDirectCodingOrchestrator({
    configRoot: "/tmp/omp-direct-budget",
    getContext: () => ({ cwd: "/tmp/project", model: { provider: "test", id: "test" }, mode: "print" }),
    transport: {
      subscribe(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
      emit(name, value) { events.emit(name, value); },
    },
    budget,
    ...options,
  });
  t.after(() => orchestrator.dispose());
  const respond = (request, overrides = {}) => events.emit(EVENTS.response, {
    requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
    status: "completed", exitCode: 0, result: { kind: "text", text: "ok" }, usage: { ...USAGE }, ...overrides,
  });
  const delegate = (signal) => orchestrator.delegateReadOnly({ agent: "omp-scout", task: "Inspect one file", signal });
  return { events, requests, cancellations, orchestrator, respond, delegate };
}

test("configured child turn/tool limits and zero depth reach the admission boundary", async (t) => {
  const f = fixture(t, { maxTurnsPerChild: 2, maxToolCallsPerChild: 3 });
  const run = f.delegate();
  await flush();
  assert.deepEqual(f.requests[0].turnBudget, { maxTurns: 2, graceTurns: 0 });
  assert.deepEqual(f.requests[0].toolBudget, { hard: 3, block: "*" });
  f.respond(f.requests[0]);
  await run;
  const disabled = fixture(t, { maxDepth: 0 });
  await assert.rejects(disabled.delegate(), { code: "DIRECT_CHILD_DEPTH_EXHAUSTED" });
  assert.equal(disabled.requests.length, 0);
});

test("child tokens include cache usage, accumulate across calls, and block further dispatch", async (t) => {
  const f = fixture(t, { maxTotalTokens: 30 });
  const first = f.delegate();
  await flush();
  f.respond(f.requests[0], { usage: { ...USAGE, cacheRead: 10, cacheWrite: 1 } });
  await first;
  assert.equal(f.orchestrator.snapshot().budget.used.tokens, 21);
  const second = f.delegate();
  const rejected = assert.rejects(second, { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "tokens" });
  await flush();
  f.respond(f.requests[1]);
  await rejected;
  await assert.rejects(f.delegate(), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED" });
  assert.equal(f.requests.length, 2);
  assert.equal(f.orchestrator.snapshot().budget.used.tokens, 31);
});

test("failed children consume cost and cannot reopen a spent budget", async (t) => {
  const f = fixture(t, { maxCostUsd: 0.002 });
  const first = f.delegate();
  const failed = assert.rejects(first, { code: "DIRECT_CHILD_FAILED" });
  await flush();
  f.respond(f.requests[0], { status: "failed", exitCode: 1, usage: { ...USAGE, cost: 0.002 } });
  await failed;
  await assert.rejects(f.delegate(), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "costUsd" });
  assert.equal(f.orchestrator.snapshot().budget.used.costUsd, 0.002);
  assert.equal(f.requests.length, 1);
});

test("missing or malformed terminal usage blocks current success and future spending", async (t) => {
  for (const usage of [undefined, { ...USAGE, cost: NaN }, { ...USAGE, input: 0.5 }]) {
    const f = fixture(t);
    const rejected = assert.rejects(f.delegate(), { code: "DIRECT_CHILD_USAGE_UNAVAILABLE" });
    await flush();
    f.respond(f.requests[0], { usage });
    await rejected;
    await assert.rejects(f.delegate(), { code: "DIRECT_CHILD_USAGE_UNAVAILABLE" });
    assert.equal(f.requests.length, 1);
  }
});

test("progress updates are identity-bound, monotonic and counted once at completion", async (t) => {
  const f = fixture(t);
  const run = f.delegate();
  await flush();
  const request = f.requests[0];
  f.events.emit(EVENTS.update, { ...request, ownerRunId: "other", tokens: 999999, toolCount: 999 });
  for (const tokens of [8, 8, 4]) f.events.emit(EVENTS.update, { ...request, tokens, toolCount: 1 });
  assert.equal(f.orchestrator.snapshot().budget.used.tokens, 8);
  f.respond(request);
  f.respond(request);
  await run;
  assert.deepEqual(f.orchestrator.snapshot().budget.used, { tokens: 10, costUsd: 0.001, toolCalls: 1, resultBytes: 4 });
});

test("observed token exhaustion cancels active children and rejects queued children", async (t) => {
  const f = fixture(t, { maxTotalTokens: 15 });
  const runs = Array.from({ length: 3 }, () => f.delegate());
  const rejected = runs.map((run) => assert.rejects(run, { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "tokens" }));
  await flush();
  assert.equal(f.requests.length, 2);
  f.events.emit(EVENTS.update, { ...f.requests[0], tokens: 15 });
  await Promise.all(rejected);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(new Set(f.cancellations.map((entry) => entry.requestId)), new Set(f.requests.map((entry) => entry.requestId)));
  assert.equal(f.orchestrator.client.active, 0);
  assert.equal(f.orchestrator.client.pending.size, 0);
});

test("parallel tool reservations never promise the same remaining calls twice", async (t) => {
  const f = fixture(t, { maxToolCallsPerChild: 2, maxTotalToolCalls: 3 });
  const first = f.delegate();
  const second = f.delegate();
  await flush();
  assert.deepEqual(f.requests.map((request) => request.toolBudget.hard), [2, 1]);
  f.respond(f.requests[0]);
  f.respond(f.requests[1]);
  await Promise.all([first, second]);
  const rejected = assert.rejects(f.delegate(), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "toolCalls" });
  await flush();
  assert.equal(f.requests[2].toolBudget.hard, 1);
  f.respond(f.requests[2]);
  await rejected;
});

test("a fully reserved tool budget rejects admission without consuming a child slot", async (t) => {
  const f = fixture(t, { maxTotalToolCalls: 2, maxToolCallsPerChild: 2 });
  const first = f.delegate();
  await flush();
  await assert.rejects(f.delegate(), { code: "DIRECT_CHILD_BUDGET_RESERVED" });
  assert.equal(f.orchestrator.snapshot().totalChildren, 1);
  f.respond(f.requests[0], { usage: { ...USAGE, toolCalls: 0 } });
  await first;
  const next = f.delegate();
  await flush();
  assert.equal(f.requests[1].toolBudget.hard, 2);
  f.respond(f.requests[1]);
  await next;
});

test("wall time is shared across delegations and queued work, not reset per child", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const f = fixture(t, { maxConcurrency: 1, maxWallSeconds: 1 });
  const first = f.delegate();
  await flush();
  assert.equal(f.requests[0].timeoutMs, 1000);
  f.respond(f.requests[0]);
  await first;
  t.mock.timers.tick(600);
  const runs = [f.delegate(), f.delegate()];
  const rejected = runs.map((run) => assert.rejects(run, { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "wallTime" }));
  await flush();
  assert.equal(f.requests[1].timeoutMs, 400);
  t.mock.timers.tick(400);
  await Promise.all(rejected);
  assert.equal(f.requests.length, 2);
  assert.equal(f.orchestrator.client.waiters.length, 0);
});

test("cancelled queued work is free; cancelling an unmetered active child stops further delegation", async (t) => {
  const f = fixture(t, { maxConcurrency: 1 });
  const cancelled = fixture(t);
  await assert.rejects(cancelled.delegate(AbortSignal.abort()), { code: "DIRECT_CHILD_CANCELLED" });
  assert.equal(cancelled.requests.length, 0);
  const controller = new AbortController();
  const first = f.delegate(controller.signal);
  const rejected = assert.rejects(first, { code: "DIRECT_CHILD_CANCELLED" });
  await flush();
  const queuedController = new AbortController();
  const queued = assert.rejects(f.delegate(queuedController.signal), { code: "DIRECT_CHILD_CANCELLED" });
  await flush();
  queuedController.abort();
  await queued;
  assert.equal(f.orchestrator.snapshot().totalChildren, 1);
  controller.abort();
  await rejected;
  await assert.rejects(f.delegate(), { code: "DIRECT_CHILD_USAGE_UNAVAILABLE" });
  assert.equal(f.requests.length, 1);
});

test("per-child and cumulative returned-result byte limits reject oversized results", async (t) => {
  for (const [budget, code] of [
    [{ maxOutputBytesPerChild: 1024 }, "DIRECT_CHILD_RESULT_TOO_LARGE"],
    [{ maxTotalOutputBytes: 1024 }, "DIRECT_CHILD_BUDGET_EXHAUSTED"],
  ]) {
    const f = fixture(t, budget);
    const rejected = assert.rejects(f.delegate(), { code });
    await flush();
    f.respond(f.requests[0], { result: { kind: "text", text: "中".repeat(400) } });
    await rejected;
    assert.equal(f.orchestrator.snapshot().budget.used.resultBytes, 1202);
  }
});

test("an exhausted writer budget cannot reach verification or modify the real workspace", async (t) => {
  let captured = false;
  let applied = false;
  const f = fixture(t, { maxCostUsd: 0.001 }, {
    cloneService: {
      create: async () => ({ cloneRoot: "/tmp/clone", patchRoot: "/tmp/omp-direct-budget" }),
      capture: async () => { captured = true; },
      apply: async () => { applied = true; },
    },
  });
  const rejected = assert.rejects(f.orchestrator.delegateWriter({
    task: "fix", plan: "fix and test", scope: ["app.js"], approvedScope: ["app.js"],
    baseline: { status: "GIT_REPOSITORY", head: "a".repeat(40), paths: [] },
  }), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "costUsd" });
  await flush();
  f.respond(f.requests[0], { result: { kind: "structured", value: { status: "completed", changedPaths: ["app.js"], summary: "fixed", verification: [], followUp: [] } } });
  await rejected;
  assert.equal(captured, false);
  assert.equal(applied, false);
});

test("the shared deadline is rechecked after writer verification and review before integration", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let captures = 0;
  let applied = false;
  const head = "a".repeat(40);
  const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["app.js"], patchPath: "/tmp/omp-direct-budget/patch.diff" };
  const f = fixture(t, { maxWallSeconds: 1 }, {
    cloneService: {
      create: async () => ({ cloneRoot: "/tmp/clone", patchRoot: "/tmp/omp-direct-budget" }),
      capture: async () => {
        if (++captures === 3) t.mock.timers.tick(1000);
        return patch;
      },
      apply: async () => { applied = true; },
    },
    verifyWriter: async () => ({ status: "PASS", patchDigest: patch.sha256, baseCommit: head, results: [{ status: "PASS", exitCode: 0, killed: false }] }),
  });
  const rejected = assert.rejects(f.orchestrator.delegateWriter({
    task: "fix", plan: "fix and test", scope: ["app.js"], approvedScope: ["app.js"],
    baseline: { status: "GIT_REPOSITORY", head, paths: [] },
  }), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED", resource: "wallTime" });
  await flush();
  f.respond(f.requests[0], { result: { kind: "structured", value: { status: "completed", changedPaths: ["app.js"], summary: "fixed", verification: [], followUp: [] } } });
  await flush();
  f.respond(f.requests[1], { result: { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } } });
  await rejected;
  assert.equal(applied, false);
});

test("agents status exposes observed child usage and explicitly excludes the main Agent", async (t) => {
  const f = fixture(t);
  const notifications = [];
  const controller = new DirectSessionController({
    configRoot: "/tmp/omp-direct-budget",
    pi: { getActiveTools: () => [], setActiveTools() {} },
  });
  controller.attachOrchestrator(f.orchestrator);
  controller.agentsCommand({ ui: { notify: (message) => notifications.push(message) } });
  assert.match(notifications[0], /main Agent usage is separate/u);
  assert.match(notifications[0], /Reported tokens: 0\/50000/u);
  assert.equal(f.orchestrator.snapshot().budget.mainAgentIncluded, false);
});
