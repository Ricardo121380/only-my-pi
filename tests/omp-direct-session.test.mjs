import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODING_TOOL_NAMES,
  DIRECT_SESSION_STATES,
  DirectSessionController,
  INSPECTION_TOOL_NAMES,
  normalizeCodingAccessRequest,
  orderSelectableModels,
} from "../extensions/omp-direct/runtime.mjs";
import { createDirectCodingOrchestrator, DIRECT_DELEGATION_EVENTS } from "../packages/direct-agent/orchestration.mjs";

function model(provider, id, reasoning = true) {
  return { provider, id, reasoning };
}

function makePi() {
  const calls = { active: [], selected: [], thinking: [] };
  const pi = {
    calls,
    getAllTools: () => [
      ...["read", "grep", "find", "ls", "edit", "write", "bash", "powershell", "request_coding_access", "delegate_readonly_agent", "delegate_managed_writer"].map((name) => ({ name })),
    ],
    getActiveTools: () => calls.active.at(-1) ?? ["read", "grep", "find", "ls"],
    setActiveTools: (names) => calls.active.push([...names]),
    setModel: async (selected) => { calls.selected.push(selected); return true; },
    setThinkingLevel: (level) => calls.thinking.push(level),
    sendUserMessage: (message) => { calls.message = message; },
  };
  return pi;
}

function makeContext({ select = async () => undefined, mode = "tui", model: currentModel = null, scopedModels = [], availableModels = [] } = {}) {
  const calls = { notifications: [], statuses: [], widgets: [], titles: 0, shutdowns: 0 };
  return {
    calls,
    mode,
    hasUI: mode === "tui",
    cwd: "/tmp/example-project",
    model: currentModel,
    scopedModels,
    modelRegistry: { getAvailable: () => availableModels },
    isProjectTrusted: () => true,
    sessionManager: { getEntries: () => [], getSessionId: () => "test-session" },
    ui: {
      select,
      notify: (message, type) => calls.notifications.push({ message, type }),
      setStatus: (...args) => calls.statuses.push(args),
      setWidget: (...args) => calls.widgets.push(args),
      setTitle: () => { calls.titles += 1; },
    },
    shutdown: () => { calls.shutdowns += 1; },
  };
}

async function tempConfig(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-session-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("model picker prioritizes current, then recent, then stable provider/id order", () => {
  const current = model("zeta", "current");
  const ordered = orderSelectableModels({
    currentModel: current,
    lastModel: "alpha/recent",
    availableModels: [
      model("zeta", "other"),
      model("alpha", "recent"),
      current,
      model("beta", "first"),
      model("alpha", "recent"),
    ],
  });
  assert.deepEqual(ordered.map((entry) => entry.reference), ["zeta/current", "alpha/recent", "alpha/recent", "beta/first", "zeta/other"].filter((value, index, values) => values.indexOf(value) === index));
});

test("scoped models are the only model picker source and preserve pinned thinking", () => {
  const pinned = model("provider", "pinned");
  const ordered = orderSelectableModels({
    scopedModels: [{ model: pinned, thinkingLevel: "high" }],
    availableModels: [model("provider", "unscoped")],
  });
  assert.deepEqual(ordered.map((entry) => entry.reference), ["provider/pinned"]);
  assert.equal(ordered[0].thinkingLevel, "high");
});

test("coding access request rejects risky simple tasks and incomplete complex plans", () => {
  assert.throws(
    () => normalizeCodingAccessRequest({
      taskSummary: "touch auth",
      complexity: "simple",
      scope: ["src/auth/**"],
      riskFlags: ["security"],
      verification: [],
      orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
    }),
    { code: "COMPLEX_PLAN_REQUIRED" },
  );
  assert.throws(
    () => normalizeCodingAccessRequest({
      taskSummary: "refactor modules",
      complexity: "complex",
      scope: ["src/**"],
      riskFlags: [],
      verification: [],
      orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
    }),
    { code: "COMPLEX_PLAN_REQUIRED" },
  );
  assert.throws(
    () => normalizeCodingAccessRequest({
      taskSummary: "escape",
      complexity: "simple",
      scope: ["../outside"],
      riskFlags: [],
      verification: [],
      orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
    }),
    { code: "CODING_ACCESS_SCOPE_INVALID" },
  );
  assert.throws(
    () => normalizeCodingAccessRequest({
      taskSummary: "delegate a tiny edit",
      complexity: "simple",
      scope: ["src/**"],
      riskFlags: [],
      verification: [],
      orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: true, useFreshReviewer: false },
    }),
    { code: "MANAGED_WRITER_PLAN_REQUIRED" },
  );
});

test("interactive session selects a model, starts in inspect, and persists no write access", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const selected = model("provider", "ready");
  const ctx = makeContext({
    availableModels: [selected],
    select: async (_title, options) => options[0],
  });
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "0" },
    now: () => "2026-08-30T06:00:00.000Z",
  });
  const result = await controller.start({ reason: "startup" }, ctx);
  assert.equal(result.status, "MODEL_SELECTED");
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);
  assert.deepEqual(pi.calls.selected.map((entry) => `${entry.provider}/${entry.id}`), ["provider/ready"]);
  assert.deepEqual(pi.calls.active.at(-1), INSPECTION_TOOL_NAMES);
  assert.equal(controller.hasCodingAccess(), false);
  assert.equal(ctx.calls.shutdowns, 0);
});

test("model selection cancellation shuts down the interactive process", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const ctx = makeContext({ availableModels: [model("provider", "ready")] });
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "0" },
  });
  const result = await controller.start({ reason: "startup" }, ctx);
  assert.equal(result.status, "MODEL_SELECTION_CANCELLED");
  assert.equal(ctx.calls.shutdowns, 1);
});

test("headless sessions use the recent model but can never request coding access", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const selected = model("provider", "ready");
  const interactive = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "0" },
  });
  const interactiveContext = makeContext({ availableModels: [selected], select: async (_title, options) => options[0] });
  await interactive.start({ reason: "startup" }, interactiveContext);

  const headlessPi = makePi();
  const headless = new DirectSessionController({
    pi: headlessPi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "1", ONLY_MY_PI_MODEL_EXPLICIT: "0" },
  });
  const headlessContext = makeContext({ mode: "print", availableModels: [selected] });
  const start = await headless.start({ reason: "startup" }, headlessContext);
  assert.equal(start.status, "MODEL_SELECTED");
  assert.deepEqual(headlessPi.calls.active.at(-1), INSPECTION_TOOL_NAMES.filter((name) => name !== "request_coding_access"));
  const result = await headless.requestCodingAccess({
    taskSummary: "edit",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: [],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, headlessContext);
  assert.equal(result.details.status, "CODING_ACCESS_UI_REQUIRED");
  assert.equal(headless.hasCodingAccess(), false);
});

test("approval enables coding once, revoke immediately removes mutation tools, and backstop blocks them", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const ctx = makeContext({ select: async (_title, options) => options[0] });
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" },
  });
  await controller.start({ reason: "startup" }, { ...ctx, model: model("provider", "ready") });
  const approved = await controller.requestCodingAccess({
    taskSummary: "fix a local test",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: ["npm test"],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, ctx);
  assert.equal(approved.details.status, "CODING_ACCESS_GRANTED");
  assert.equal(controller.state, DIRECT_SESSION_STATES.CODING);
  assert.deepEqual(pi.calls.active.at(-1), CODING_TOOL_NAMES);
  assert.equal(controller.blockToolCall({ toolName: "edit", input: { path: "src/example.ts" } }), undefined);
  assert.match(controller.blockToolCall({ toolName: "bash", input: { command: "echo ok\ngit reset --hard HEAD" } }).reason, /BASH_MULTILINE_UNSUPPORTED/u);
  assert.match(controller.inspectUserBash({ command: "echo ok\ngit commit -m fix" }).result.output, /BASH_MULTILINE_UNSUPPORTED/u);
  controller.accessCommand("revoke", ctx);
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);
  assert.deepEqual(pi.calls.active.at(-1), INSPECTION_TOOL_NAMES);
  assert.equal(controller.blockToolCall({ toolName: "write" }).block, true);
  assert.equal(controller.blockUserBash().result.exitCode, 126);
});

test("a pending approval cannot regrant coding after revocation", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  let resolveChoice;
  const ctx = makeContext({ select: () => new Promise((resolve) => { resolveChoice = resolve; }) });
  const controller = new DirectSessionController({ pi, configRoot, environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" } });
  await controller.start({ reason: "startup" }, { ...ctx, model: model("provider", "ready") });
  const pending = controller.requestCodingAccess({ taskSummary: "fix", complexity: "simple", scope: ["src/**"], riskFlags: [], verification: [], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } }, ctx);
  controller.accessCommand("revoke", ctx);
  resolveChoice("Approve plan and allow coding for this session");
  const result = await pending;
  assert.notEqual(result.details.status, "CODING_ACCESS_GRANTED");
  assert.equal(controller.hasCodingAccess(), false);
});

test("a cancelled or superseded approval cannot change the current grant", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const choices = [];
  const ctx = makeContext({ select: () => new Promise((resolve) => { choices.push(resolve); }) });
  const controller = new DirectSessionController({ pi, configRoot, environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" } });
  await controller.start({ reason: "startup" }, { ...ctx, model: model("provider", "ready") });
  const request = { taskSummary: "fix", complexity: "simple", scope: ["src/**"], riskFlags: [], verification: [], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const abort = new AbortController();
  const cancelled = controller.requestCodingAccess(request, ctx, abort.signal);
  abort.abort();
  choices.shift()("Approve plan and allow coding for this session");
  assert.equal((await cancelled).details.status, "CODING_ACCESS_STALE");
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);

  const old = controller.requestCodingAccess(request, ctx);
  const newer = controller.requestCodingAccess(request, ctx);
  choices.pop()("Approve plan and allow coding for this session");
  assert.equal((await newer).details.status, "CODING_ACCESS_GRANTED");
  choices.shift()("Deny");
  assert.equal((await old).details.status, "CODING_ACCESS_STALE");
  assert.equal(controller.hasCodingAccess(), true);
});

test("permission YOLO revokes coding, blocks mutation, and the turn ceiling repairs tool visibility", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const environment = {
    ONLY_MY_PI_DIRECT: "1",
    ONLY_MY_PI_HEADLESS: "0",
    ONLY_MY_PI_MODEL_EXPLICIT: "1",
    PI_PERMISSION_MODE: "build",
  };
  const ctx = makeContext({ select: async (_title, options) => options[0] });
  const controller = new DirectSessionController({ pi, configRoot, environment });
  await controller.start({ reason: "startup" }, { ...ctx, model: model("provider", "ready") });
  const approved = await controller.requestCodingAccess({
    taskSummary: "fix a local test",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: ["npm test"],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, ctx);
  assert.equal(approved.details.status, "CODING_ACCESS_GRANTED");
  assert.equal(controller.hasCodingAccess(), true);

  environment.PI_PERMISSION_MODE = "yolo";
  pi.calls.active.push(["read", "edit", "write", "bash"]);
  const prompt = controller.beforeAgentStart({ systemPrompt: "base" });
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);
  assert.equal(controller.hasCodingAccess(), false);
  assert.deepEqual(pi.calls.active.at(-1), INSPECTION_TOOL_NAMES);
  assert.match(prompt.systemPrompt, /YOLO was detected/u);
  assert.match(ctx.calls.notifications.at(-1).message, /UNSUPPORTED_UNSAFE_OVERRIDE/u);
  assert.match(controller.blockToolCall({ toolName: "edit", input: { path: "src/file.ts" } }).reason, /CODING_ACCESS_REQUIRED/u);

  const denied = await controller.requestCodingAccess({
    taskSummary: "try again",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: [],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, ctx);
  assert.equal(denied.details.status, "UNSUPPORTED_UNSAFE_OVERRIDE");

  environment.PI_PERMISSION_MODE = "build";
  controller.beforeAgentStart({ systemPrompt: "base" });
  assert.deepEqual(pi.calls.active.at(-1), INSPECTION_TOOL_NAMES);
});

test("latest public permission-mode session entry is honored without importing package internals", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const ctx = makeContext();
  ctx.sessionManager.getEntries = () => [
    { type: "custom", customType: "perm-mode", data: { mode: "build" } },
    { type: "custom", customType: "perm-mode", data: { mode: "yolo" } },
  ];
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" },
  });
  controller.context = ctx;
  controller.state = DIRECT_SESSION_STATES.CODING;
  assert.equal(controller.enforcePermissionBoundary(ctx).code, "UNSUPPORTED_UNSAFE_OVERRIDE");
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);
});

test("explicit /plan forces complex access and sends a read-only planning prompt", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  const ctx = makeContext();
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" },
  });
  controller.context = ctx;
  controller.enterPlanning("refactor auth", ctx);
  assert.equal(controller.state, DIRECT_SESSION_STATES.PLANNING);
  assert.match(pi.calls.message, /without modifying the project/u);
  assert.throws(() => normalizeCodingAccessRequest({
    taskSummary: "refactor auth",
    complexity: "simple",
    scope: ["src/auth/**"],
    riskFlags: [],
    verification: [],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, { explicitPlan: true }), { code: "COMPLEX_PLAN_REQUIRED" });
});

test("direct tools use one attached orchestrator and managed writer requires its approved plan", async (t) => {
  const configRoot = await tempConfig(t);
  const pi = makePi();
  pi.exec = async () => ({ stdout: "", stderr: "", code: 0 });
  const ctx = makeContext({ select: async (_title, options) => options[0] });
  const calls = [];
  const childAnswer = "Verified answer: CHILD_RESULT_R73";
  let writerResult = { status: "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION", changedPaths: ["src/fix.ts"] };
  const orchestrator = {
    async delegateReadOnly(input) { calls.push(["read", input]); return { status: "completed", result: childAnswer }; },
    async delegateWriter(input) { calls.push(["write", input]); return writerResult; },
    snapshot() { return { physicalRuntimeOwner: "pi-subagents", maximumConcurrency: 2, maximumChildren: 8, totalChildren: 2, writerUsed: true, children: [] }; },
  };
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" },
    captureBaseline: async () => ({ formatVersion: 1, status: "GIT_REPOSITORY", head: "a".repeat(40), paths: [] }),
  });
  assert.equal(controller.attachOrchestrator(orchestrator), true);
  await controller.start({ reason: "startup" }, { ...ctx, model: model("provider", "ready") });
  const read = await controller.delegateReadOnly({ agent: "omp-explorer", task: "inspect" }, ctx);
  assert.equal(read.details.status, "DIRECT_CHILD_COMPLETED");
  const modelText = (result) => result.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n");
  assert.ok(modelText(read).includes(childAnswer), "the parent model must receive the actual child answer");
  const denied = await controller.delegateManagedWriter({ scope: ["src/**"] }, ctx);
  assert.equal(denied.details.status, "CODING_ACCESS_REQUIRED");
  const approved = await controller.requestCodingAccess({
    taskSummary: "implement a coordinated fix",
    complexity: "complex",
    scope: ["src/**"],
    riskFlags: [],
    plan: "Inspect the behavior, implement the change, test it, and review the patch.",
    verification: ["npm test"],
    orchestration: { useReadOnlyScouts: true, useManagedCloneWriter: true, useFreshReviewer: true },
  }, ctx);
  assert.equal(approved.details.status, "CODING_ACCESS_GRANTED");
  const written = await controller.delegateManagedWriter({ scope: ["src/**"] }, ctx);
  assert.equal(written.details.status, "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION");
  assert.ok(modelText(written).includes("src/fix.ts"), "the parent model must receive changed paths");
  assert.equal(calls[0][0], "read");
  assert.equal(calls[1][0], "write");
  assert.equal(calls[1][1].plan, "Inspect the behavior, implement the change, test it, and review the patch.");
  assert.equal(calls[1][1].baseline.status, "GIT_REPOSITORY");
  const assertWriterAuthority = calls[1][1].assertAuthority;
  assert.doesNotThrow(() => assertWriterAuthority(ctx));
  ctx.cwd = "/tmp/other-project";
  assert.throws(() => assertWriterAuthority(ctx), { code: "DIRECT_WRITER_AUTHORIZATION_REVOKED" });
  ctx.cwd = "/tmp/example-project";
  ctx.isProjectTrusted = () => false;
  assert.throws(() => assertWriterAuthority(ctx), { code: "DIRECT_WRITER_AUTHORIZATION_REVOKED" });
  ctx.isProjectTrusted = () => true;
  controller.environment.PI_PERMISSION_MODE = "yolo";
  assert.throws(() => assertWriterAuthority(ctx), { code: "DIRECT_WRITER_AUTHORIZATION_REVOKED" });
  delete controller.environment.PI_PERMISSION_MODE;
  await controller.agentsCommand(ctx);
  assert.match(ctx.calls.notifications.at(-1).message, /Runtime owner: pi-subagents/u);
  for (const diagnostic of [
    { status: "WRITER_REVIEW_BLOCKED", findings: ["Signed addition fails for negative operands"] },
    { status: "WRITER_VERIFICATION_BLOCKED", code: "WRITER_GATE_DENIED", verificationReceipt: { status: "BLOCKED", code: "WRITER_GATE_DENIED" } },
  ]) {
    writerResult = diagnostic;
    const blocked = await controller.delegateManagedWriter({ scope: ["src/**"] }, ctx);
    assert.ok(modelText(blocked).includes(diagnostic.findings?.[0] ?? diagnostic.code), "the parent model must receive the reason integration stopped");
    assert.equal(blocked.details.status, diagnostic.status);
  }
});

test("revoking the controller grant cancels a real orchestrator before patch apply", { timeout: 5000 }, async (t) => {
  const configRoot = await tempConfig(t);
  const ctx = makeContext({ select: async (_title, options) => options[0] });
  ctx.cwd = await fs.realpath(configRoot);
  ctx.model = model("provider", "ready");
  const pi = makePi();
  pi.exec = async () => ({ stdout: "", stderr: "", code: 0 });
  const controller = new DirectSessionController({ pi, configRoot, environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1" }, captureBaseline: async () => ({ status: "GIT_REPOSITORY", head: "a".repeat(40), paths: [] }) });
  await controller.start({ reason: "startup" }, ctx);
  const events = new EventEmitter();
  const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 };
  const transport = {
    subscribe(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
    emit(name, request) {
      events.emit(name, request);
      if (name !== DIRECT_DELEGATION_EVENTS.request) return;
      queueMicrotask(() => events.emit(DIRECT_DELEGATION_EVENTS.response, {
        requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId,
        status: "completed", exitCode: 0, usage,
        result: { kind: "structured", value: request.agent === "omp-implementer"
          ? { status: "completed", changedPaths: ["src/fix.ts"], summary: "fixed", verification: [], followUp: [] }
          : { verdict: "pass", findings: [], tested: [], unverified: [] } },
      }));
    },
  };
  let releaseVerification;
  let verifying;
  const verificationStarted = new Promise((resolve) => { verifying = resolve; });
  const patch = { status: "READY", sha256: `sha256:${"b".repeat(64)}`, changedPaths: ["src/fix.ts"], patchPath: path.join(configRoot, "only-my-pi", "runs", "fixture", "artifacts", "fixture-writer-1.patch") };
  let applied = false;
  let writerRecord;
  const orchestrator = createDirectCodingOrchestrator({ transport, configRoot, getContext: () => ctx,
    recordStore: { async begin({ id, directWriter }) { writerRecord = { runId: id, status: "planned", directWriter }; return writerRecord; }, async update(_id, patch) { writerRecord = { ...writerRecord, ...patch }; return writerRecord; } },
    contextProvider: async () => ({ sessionId: ctx.sessionManager.getSessionId(), repository: { root: ctx.cwd, head: "a".repeat(40) }, configurationDigest: `sha256:${"a".repeat(64)}` }),
    verifyRealWorkspace: async () => ({ status: "BLOCKED", code: "WRITER_REAL_GATE_DENIED" }),
    verifyWriter: async () => {
    verifying();
    return new Promise((resolve) => { releaseVerification = resolve; });
  }, cloneService: {
    async create() { return { cloneRoot: path.join(configRoot, "clone"), patchRoot: path.join(configRoot, "artifacts") }; },
    async capture() { return patch; },
    async apply() { applied = true; return { patchDigest: patch.sha256, changedPaths: patch.changedPaths }; },
  } });
  t.after(() => orchestrator.dispose());
  controller.attachOrchestrator(orchestrator);
  assert.equal((await controller.requestCodingAccess({ taskSummary: "fix", complexity: "complex", scope: ["src/**"], riskFlags: [], plan: "Fix and test", verification: [], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: true, useFreshReviewer: true } }, ctx)).details.status, "CODING_ACCESS_GRANTED");
  const writing = controller.delegateManagedWriter({ scope: ["src/**"] }, ctx);
  const first = await Promise.race([verificationStarted.then(() => "verifying"), writing.then((result) => result.details.status)]);
  assert.equal(first, "verifying");
  controller.accessCommand("revoke", ctx);
  releaseVerification({ status: "PASS", patchDigest: patch.sha256, baseCommit: "a".repeat(40), results: [{ status: "PASS", exitCode: 0, killed: false }] });
  const result = await writing;
  assert.equal(applied, false);
  assert.notEqual(result.details.status, "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION");
});
