import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { createWebRunAuthorizer } from "../packages/web-policy/index.mjs";
import { createRunRecordStore } from "../packages/run-management/index.mjs";
import { isValidRealWorkspaceReceipt } from "../packages/direct-agent/contracts.mjs";

import {
  DIRECT_DELEGATION_EVENTS,
  createDirectCodingOrchestrator,
} from "../packages/direct-agent/orchestration.mjs";

const HEAD = "a".repeat(40);
const verifiedPatch = async ({ patch }) => ({ status: "PASS", patchDigest: patch.sha256, baseCommit: HEAD, results: [{ status: "PASS", exitCode: 0, killed: false }] });
const USAGE = Object.freeze({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 });
const mockPatchPath = (configRoot) => path.join(configRoot, "only-my-pi", "runs", "fixture", "artifacts", "fixture-writer-1.patch");

test("real-worktree receipt rejects wrong phase, root, digest, empty or uncertain gates", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const receipt = { kind: "omp-real-workspace-verification", phase: "real-workspace", status: "PASS", runId: "run", patchDigest: hash, head: HEAD, manifestDigest: hash, repositoryRootDigest: hash, sourceScopeDigest: hash, sourceDigest: hash, bindingDigest: hash, receiptDigest: hash, results: [{ status: "PASS", exitCode: 0, killed: false, bindingDigest: hash }] };
  const expected = { runId: "run", patchDigest: hash, head: HEAD, manifestDigest: hash, repositoryRootDigest: hash, receiptDigest: hash };
  assert.equal(isValidRealWorkspaceReceipt(receipt, expected), true);
  for (const invalid of [{ phase: "clone" }, { repositoryRootDigest: `sha256:${"b".repeat(64)}` }, { receiptDigest: `sha256:${"b".repeat(64)}` }, { results: [] }, { results: [{ ...receipt.results[0], terminationUnconfirmed: true }] }]) {
    assert.equal(isValidRealWorkspaceReceipt({ ...receipt, ...invalid }, expected), false);
  }
});

function makeTransport({ responseFor } = {}) {
  const events = new EventEmitter();
  const requests = [];
  return {
    requests,
    subscribe(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
    emit(name, value) {
      events.emit(name, value);
      if (name !== DIRECT_DELEGATION_EVENTS.request || !responseFor) return;
      requests.push(value);
      queueMicrotask(() => {
        events.emit(DIRECT_DELEGATION_EVENTS.started, {
          requestId: value.requestId,
          ownerRunId: value.ownerRunId,
          nodeId: value.nodeId,
        });
        const result = responseFor(value);
        events.emit(DIRECT_DELEGATION_EVENTS.response, {
          requestId: value.requestId,
          ownerRunId: value.ownerRunId,
          nodeId: value.nodeId,
          status: "completed",
          exitCode: 0,
          result,
          usage: USAGE,
        });
      });
    },
    respond(request, result) {
      events.emit(DIRECT_DELEGATION_EVENTS.response, {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
        status: "completed",
        exitCode: 0,
        result,
        usage: USAGE,
      });
    },
  };
}

async function setup(t) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-orchestration-"));
  const projectRoot = path.join(configRoot, "project");
  await fs.mkdir(projectRoot);
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const ctx = {
    cwd: projectRoot,
    model: { provider: "provider", id: "model" },
    thinkingLevel: "medium",
    mode: "print",
  };
  const records = new Map();
  const recordStore = {
    async begin({ id, directWriter }) { const record = { runId: id, status: "planned", directWriter }; records.set(id, record); return record; },
    async update(id, patch) { const record = { ...records.get(id), ...patch }; records.set(id, record); return record; },
  };
  let sequence = 0;
  return { configRoot, projectRoot, ctx, recordStore, contextProvider: async () => ({ sessionId: "session", repository: { root: await fs.realpath(projectRoot), head: HEAD }, configurationDigest: `sha256:${"e".repeat(64)}` }), verifyRealWorkspace: async () => ({ status: "BLOCKED", code: "WRITER_REAL_GATE_DENIED" }), idFactory: () => `id-${++sequence}` };
}

test("direct research requires per-task Web approval and releases its grant", async (t) => {
  const fixture = await setup(t);
  const authority = createWebRunAuthorizer({ configRoot: fixture.configRoot, getSessionId: () => "session" });
  const transport = makeTransport({ responseFor: () => ({ kind: "text", text: "verified" }) });
  let confirmations = 0;
  let approve = false;
  fixture.ctx.mode = "tui";
  fixture.ctx.ui = { setWidget() {}, async confirm(_title, description) { confirmations++; assert.match(description, /cookies are disabled/u); return approve; } };
  const orchestrator = createDirectCodingOrchestrator({ ...fixture, getContext: () => fixture.ctx, transport, webAuthorizer: authority, webEnabled: true });
  t.after(() => orchestrator.dispose());
  const request = { agent: "omp-researcher", task: "Check public documentation" };
  await assert.rejects(orchestrator.delegateReadOnly(request), { code: "PUBLIC_WEB_DENIED" });
  assert.equal(transport.requests.length, 0);
  approve = true;
  await orchestrator.delegateReadOnly(request);
  await orchestrator.delegateReadOnly({ ...request, agent: "omp-source-verifier" });
  assert.equal(confirmations, 3);
  assert.notEqual(transport.requests[0].ownerRunId, transport.requests[1].ownerRunId);
  for (const sent of transport.requests) {
    assert.equal(sent.toolBudget.block, "*");
  }
  assert.equal(authority.grants.size, 0);
  await orchestrator.delegateReadOnly({ agent: "omp-reviewer", task: "Review locally" });
  assert.equal(transport.requests.at(-1).toolBudget.block, "*");
  assert.equal(confirmations, 3);
  fixture.ctx.mode = "print";
  await assert.rejects(orchestrator.delegateReadOnly(request), { code: "PUBLIC_WEB_APPROVAL_REQUIRED" });
  fixture.ctx.mode = "tui";
  fixture.ctx.ui.confirm = async () => {
    await fs.writeFile(path.join(fixture.configRoot, "web-search.json"), JSON.stringify({ allowBrowserCookies: true }));
    return true;
  };
  await assert.rejects(orchestrator.delegateReadOnly(request), { code: "PUBLIC_WEB_POLICY_BLOCKED" });
  assert.equal(transport.requests.length, 3);
  await fs.unlink(path.join(fixture.configRoot, "web-search.json"));
  fixture.ctx.ui.confirm = async () => true;
  await assert.rejects(orchestrator.delegateReadOnly({ ...request, signal: AbortSignal.abort() }), { code: "DIRECT_CHILD_CANCELLED" });
  assert.equal(authority.grants.size, 0);
  orchestrator.webEnabled = false;
  await assert.rejects(orchestrator.delegateReadOnly(request), { code: "DIRECT_WEB_UNAVAILABLE" });
});

test("read-only delegation uses the shared pi-subagents owner and enforces concurrency two", async (t) => {
  const fixture = await setup(t);
  const held = makeTransport();
  const seen = [];
  held.subscribe(DIRECT_DELEGATION_EVENTS.request, (request) => seen.push(request));
  const bounded = createDirectCodingOrchestrator({
    ...fixture,
    transport: held,
    configRoot: fixture.configRoot,
    getContext: () => fixture.ctx,
    idFactory: fixture.idFactory,
  });
  t.after(() => bounded.dispose());
  const calls = [
    bounded.delegateReadOnly({ agent: "omp-explorer", task: "Inspect A", label: "explorer-1" }),
    bounded.delegateReadOnly({ agent: "omp-scout", task: "Inspect B", label: "scout-1" }),
    bounded.delegateReadOnly({ agent: "omp-reviewer", task: "Review C", label: "reviewer-1" }),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 2);
  for (const request of seen) {
    assert.equal(request.toolBudget.block, "*");
    held.respond(request, { kind: "text", text: "bounded evidence" });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(seen.length, 3);
  held.respond(seen[2], { kind: "text", text: "fresh review" });
  await Promise.all(calls);
  assert.equal(bounded.snapshot().physicalRuntimeOwner, "pi-subagents");
  assert.equal(bounded.snapshot().maximumConcurrency, 2);
  await assert.rejects(
    bounded.delegateReadOnly({ agent: "omp-implementer", task: "mutate" }),
    { code: "DIRECT_AGENT_NOT_ALLOWED" },
  );
});

test("dirty scope falls back to the main Agent before a writer clone is created", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport({ responseFor: () => ({ kind: "text", text: "unused" }) });
  let creates = 0;
  const orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    transport,
    configRoot: fixture.configRoot,
    getContext: () => fixture.ctx,
    idFactory: fixture.idFactory,
    cloneService: { create: async () => { creates += 1; throw new Error("must not create"); } },
  });
  t.after(() => orchestrator.dispose());
  const result = await orchestrator.delegateWriter({
    task: "Implement",
    plan: "Complete approved plan",
    scope: ["src/**"],
    approvedScope: ["src/**"],
    baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [{ path: "src/dirty.ts" }] },
  });
  assert.equal(result.status, "MAIN_AGENT_FALLBACK_DIRTY_OVERLAP");
  assert.deepEqual(result.overlap, ["src/dirty.ts"]);
  assert.equal(creates, 0);
  assert.equal(orchestrator.snapshot().writerUsed, false);
});

test("managed writer cannot widen an approved single-level glob", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport();
  const orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    transport,
    configRoot: fixture.configRoot,
    getContext: () => fixture.ctx,
    idFactory: fixture.idFactory,
  });
  t.after(() => orchestrator.dispose());
  await assert.rejects(
    orchestrator.delegateWriter({
      task: "Implement",
      plan: "Plan",
      scope: ["src/**"],
      approvedScope: ["src/*"],
      baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] },
    }),
    { code: "DIRECT_WRITER_SCOPE_EXPANSION" },
  );
});

test("managed writer requires exact captured paths and a fresh passing review before apply", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport({
    responseFor(request) {
      if (request.agent === "omp-implementer") {
        return { kind: "structured", value: { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: ["test passed"], followUp: [] } };
      }
      return { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } };
    },
  });
  const calls = [];
  const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath: mockPatchPath(fixture.configRoot) };
  const orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    transport,
    configRoot: fixture.configRoot,
    getContext: () => fixture.ctx,
    idFactory: fixture.idFactory,
    verifyWriter: verifiedPatch,
    cloneService: {
      async create() { calls.push("create"); return { cloneRoot: path.join(fixture.configRoot, "clone"), patchRoot: path.join(fixture.configRoot, "artifacts") }; },
      async capture() { calls.push("capture"); return patch; },
      async apply(input) { calls.push("apply"); assert.equal(input.patch, patch); return { patchDigest: patch.sha256, changedPaths: patch.changedPaths }; },
    },
  });
  t.after(() => orchestrator.dispose());
  const result = await orchestrator.delegateWriter({
    task: "Implement the fix",
    plan: "Inspect, modify, test, review",
    scope: ["src/**"],
    approvedScope: ["src/**"],
    verification: ["npm test"],
    baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] },
  });
  assert.equal(result.status, "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION");
  assert.deepEqual(calls, ["create", "capture", "capture", "capture", "apply"]);
  assert.deepEqual(transport.requests.map((request) => request.agent), ["omp-implementer", "omp-reviewer"]);
  assert.equal(transport.requests[0].toolBudget.block, "*");
  assert.equal(transport.requests[1].toolBudget.block, "*");
  assert.match(transport.requests[1].task, /Changed files: \["src\/fix.ts"\]/u);
  assert.match(transport.requests[1].task, /do not traverse \.git objects/u);
  assert.equal(orchestrator.snapshot().writerUsed, true);
  await assert.rejects(
    orchestrator.delegateWriter({ task: "again", plan: "again", scope: ["src/**"], approvedScope: ["src/**"], baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] } }),
    { code: "DIRECT_WRITER_LIMIT_REACHED" },
  );
});

test("managed writer records application before independent real-worktree verification", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport({ responseFor(request) {
    return request.agent === "omp-implementer"
      ? { kind: "structured", value: { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: [], followUp: [] } }
      : { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } };
  } });
  const store = createRunRecordStore({ managedRoot: path.join(fixture.configRoot, "only-my-pi") });
  const patchDigest = `sha256:${"b".repeat(64)}`;
  const manifestDigest = `sha256:${"c".repeat(64)}`;
  const receiptDigest = `sha256:${"d".repeat(64)}`;
  let runId;
  let applyCalls = 0;
  const orchestrator = createDirectCodingOrchestrator({
    transport, configRoot: fixture.configRoot, getContext: () => fixture.ctx, idFactory: fixture.idFactory,
    recordStore: store,
    contextProvider: async () => ({ sessionId: "session", repository: { root: await fs.realpath(fixture.projectRoot), head: HEAD }, configurationDigest: `sha256:${"e".repeat(64)}` }),
    verifyWriter: async ({ patch }) => ({ status: "PASS", patchDigest: patch.sha256, baseCommit: HEAD, manifestDigest, receiptDigest, results: [{ status: "PASS", exitCode: 0, killed: false }] }),
    verifyRealWorkspace: async ({ patch, runId: id }) => {
      const record = await store.require(id);
      assert.equal(record.directWriter.stage, "VERIFYING");
      assert.equal(record.directWriter.application, "APPLIED");
      const receipt = { status: "PASS", kind: "omp-real-workspace-verification", phase: "real-workspace", runId: id, patchDigest: patch.sha256, head: HEAD, manifestDigest, repositoryRootDigest: `sha256:${createHash("sha256").update(await fs.realpath(fixture.projectRoot)).digest("hex")}`, sourceScopeDigest: receiptDigest, sourceDigest: receiptDigest, bindingDigest: receiptDigest, results: [{ status: "PASS", exitCode: 0, killed: false, bindingDigest: receiptDigest }] };
      return { ...receipt, receiptDigest: `sha256:${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}` };
    },
    cloneService: {
      async create({ runId: id }) { runId = id; return { cloneRoot: path.join(fixture.configRoot, "clone"), patchRoot: path.join(fixture.configRoot, "only-my-pi", "runs", id, "artifacts") }; },
      async capture({ patchRoot }) { return { status: "READY", sha256: patchDigest, bytes: 4, changedPaths: ["src/fix.ts"], patchPath: path.join(patchRoot, `${runId}-writer-1.patch`) }; },
      async apply() { applyCalls++; assert.equal((await store.require(runId)).directWriter.stage, "APPLYING"); return { patchDigest, changedPaths: ["src/fix.ts"] }; },
    },
  });
  t.after(() => orchestrator.dispose());
  const result = await orchestrator.delegateWriter({ task: "Fix", plan: "Apply reviewed patch", scope: ["src/**"], approvedScope: ["src/**"], baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] } });
  assert.equal(result.status, "WRITER_PATCH_VERIFIED");
  assert.equal(applyCalls, 1);
  const record = await store.require(runId);
  assert.equal(record.directWriter.stage, "VERIFIED");
  assert.equal(record.directWriter.verification, "PASS");
  assert.equal(record.directWriter.patch.relativePath, `runs/${runId}/artifacts/${runId}-writer-1.patch`);
});

test("cancellation during the final patch freshness check prevents apply", async (t) => {
  const fixture = await setup(t);
  const abort = new AbortController();
  const transport = makeTransport({ responseFor: (request) => request.agent === "omp-implementer"
    ? { kind: "structured", value: { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: [], followUp: [] } }
    : { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } } });
  const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath: mockPatchPath(fixture.configRoot) };
  let captures = 0;
  let applies = 0;
  const orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    getContext: () => fixture.ctx,
    transport,
    verifyWriter: verifiedPatch,
    cloneService: {
      async create() { return { cloneRoot: path.join(fixture.configRoot, "clone"), patchRoot: path.join(fixture.configRoot, "artifacts") }; },
      async capture() { captures++; if (captures === 3) abort.abort(); return patch; },
      async apply() { applies++; return { patchDigest: patch.sha256, changedPaths: patch.changedPaths }; },
    },
  });
  t.after(() => orchestrator.dispose());
  const result = await orchestrator.delegateWriter({ task: "Fix", plan: "Plan", scope: ["src/**"], approvedScope: ["src/**"], baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] }, signal: abort.signal });
  assert.equal(result.status, "WRITER_VERIFICATION_BLOCKED");
  assert.equal(applies, 0);
});

test("the final apply callback rechecks a budget exhausted during target preflight", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport({ responseFor: (request) => request.agent === "omp-implementer"
    ? { kind: "structured", value: { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: [], followUp: [] } }
    : { kind: "structured", value: { verdict: "pass", findings: [], tested: [], unverified: [] } } });
  const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath: mockPatchPath(fixture.configRoot) };
  let orchestrator;
  orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    getContext: () => fixture.ctx,
    transport,
    verifyWriter: verifiedPatch,
    cloneService: {
      async create() { return { cloneRoot: path.join(fixture.configRoot, "clone"), patchRoot: path.join(fixture.configRoot, "artifacts") }; },
      async capture() { return patch; },
      async apply({ assertAuthority }) {
        orchestrator.client.budgetError = Object.assign(new Error("budget reached"), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED" });
        assertAuthority();
        return { patchDigest: patch.sha256, changedPaths: patch.changedPaths };
      },
    },
  });
  t.after(() => orchestrator.dispose());
  await assert.rejects(orchestrator.delegateWriter({ task: "Fix", plan: "Plan", scope: ["src/**"], approvedScope: ["src/**"], baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] } }), { code: "DIRECT_CHILD_BUDGET_EXHAUSTED" });
});

test("fresh reviewer failure preserves the patch artifact without applying it", async (t) => {
  const fixture = await setup(t);
  const transport = makeTransport({
    responseFor(request) {
      if (request.agent === "omp-implementer") {
        return { kind: "structured", value: { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: [], followUp: [] } };
      }
      return { kind: "structured", value: { verdict: "fail", findings: ["regression"], tested: [], unverified: [] } };
    },
  });
  let applied = false;
  const patchPath = path.join(fixture.configRoot, "only-my-pi", "runs", "run", "artifacts", "patch.diff");
  const orchestrator = createDirectCodingOrchestrator({
    ...fixture,
    transport,
    configRoot: fixture.configRoot,
    getContext: () => fixture.ctx,
    idFactory: fixture.idFactory,
    verifyWriter: verifiedPatch,
    cloneService: {
      async create() { return { cloneRoot: path.join(fixture.configRoot, "clone"), patchRoot: path.dirname(patchPath) }; },
      async capture() { return { status: "READY", sha256: `sha256:${"c".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath }; },
      async apply() { applied = true; },
    },
  });
  t.after(() => orchestrator.dispose());
  const result = await orchestrator.delegateWriter({
    task: "Implement",
    plan: "Plan",
    scope: ["src/**"],
    approvedScope: ["src/**"],
    baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] },
  });
  assert.equal(result.status, "WRITER_REVIEW_BLOCKED");
  assert.equal(applied, false);
  assert.deepEqual(result.findings, ["regression"]);
  assert.equal(result.artifact, "only-my-pi/runs/run/artifacts/patch.diff");
});

test("writer reports cannot bypass runtime verification or post-review patch freshness", async (t) => {
  for (const scenario of ["missing", "failed", "empty", "killed", "mismatch", "throws", "test-drift", "review-drift", "cancelled"]) {
    await t.test(scenario, async (t) => {
      const fixture = await setup(t);
      const abort = new AbortController();
      let captures = 0;
      let applied = false;
      const transport = makeTransport({ responseFor: (request) => ({ kind: "structured", value: request.agent === "omp-implementer"
        ? { status: "completed", changedPaths: ["src/fix.ts"], summary: "all tests passed", verification: ["PASS"], followUp: [] }
        : { verdict: "pass", findings: [], tested: ["PASS"], unverified: [] } }) });
      const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath: mockPatchPath(fixture.configRoot) };
      const verifyWriter = scenario === "missing" ? null : async (input) => {
        if (scenario === "throws") throw new Error("verification unavailable");
        const result = await verifiedPatch(input);
        if (scenario === "failed") result.results[0].exitCode = 1;
        if (scenario === "empty") result.results = [];
        if (scenario === "killed") result.results[0].killed = true;
        if (scenario === "mismatch") result.patchDigest = `sha256:${"c".repeat(64)}`;
        if (scenario === "cancelled") abort.abort();
        return result;
      };
      const orchestrator = createDirectCodingOrchestrator({ ...fixture, transport, configRoot: fixture.configRoot, getContext: () => fixture.ctx, verifyWriter, cloneService: {
        async create() { return { cloneRoot: fixture.projectRoot, patchRoot: fixture.configRoot }; },
        async capture() {
          captures++;
          if ((scenario === "test-drift" && captures === 2) || (scenario === "review-drift" && captures === 3)) return { ...patch, sha256: `sha256:${"c".repeat(64)}` };
          return patch;
        },
        async apply() { applied = true; },
      } });
      t.after(() => orchestrator.dispose());
      const run = orchestrator.delegateWriter({ task: "fix", plan: "fix and test", scope: ["src/**"], approvedScope: ["src/**"], baseline: { status: "GIT_REPOSITORY", head: HEAD, paths: [] }, signal: abort.signal });
      if (scenario === "throws") await assert.rejects(run, /verification unavailable/u);
      else assert.equal((await run).status, "WRITER_VERIFICATION_BLOCKED");
      assert.equal(applied, false);
    });
  }
});
