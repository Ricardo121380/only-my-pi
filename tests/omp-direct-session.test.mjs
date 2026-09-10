import assert from "node:assert/strict";
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
    sessionManager: { getEntries: () => [] },
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
  controller.accessCommand("revoke", ctx);
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);
  assert.deepEqual(pi.calls.active.at(-1), INSPECTION_TOOL_NAMES);
  assert.equal(controller.blockToolCall({ toolName: "write" }).block, true);
  assert.equal(controller.blockUserBash().result.exitCode, 126);
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
  const orchestrator = {
    async delegateReadOnly(input) { calls.push(["read", input]); return { status: "completed", result: "evidence" }; },
    async delegateWriter(input) { calls.push(["write", input]); return { status: "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION", changedPaths: ["src/fix.ts"] }; },
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
  assert.equal(calls[0][0], "read");
  assert.equal(calls[1][0], "write");
  assert.equal(calls[1][1].plan, "Inspect the behavior, implement the change, test it, and review the patch.");
  assert.equal(calls[1][1].baseline.status, "GIT_REPOSITORY");
  controller.agentsCommand(ctx);
  assert.match(ctx.calls.notifications.at(-1).message, /Runtime owner: pi-subagents/u);
});
