import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  CODING_TOOL_NAMES,
  DIRECT_SESSION_STATES,
  DirectSessionController,
  normalizeCodingAccessRequest,
  orderSelectableModels,
} from "../extensions/omp-direct/runtime.mjs";
import {
  buildDirectPiInvocation,
  classifyOmpInvocation,
  inspectDirectAgentArguments,
  resolveControlledStack,
  resolveDirectConfigRoot,
  resolveDirectExtensionSet,
} from "../packages/direct-agent/launcher.mjs";
import {
  captureWriterPatch,
  createManagedClone,
  verifyWriterPatch,
  writerScopeOverlapsDirtyPaths,
} from "../packages/direct-agent/managed-clone.mjs";
import { saveLastInteractiveModel } from "../packages/daily-config/index.mjs";

const execFile = promisify(nodeExecFile);
const COMMIT = "a".repeat(40);
const STACK_ID = `sha256:${"b".repeat(64)}`;
const UUID = "00000000-0000-4000-8000-000000000000";

function model(provider = "provider", id = "model", reasoning = false) {
  return { provider, id, reasoning };
}

function piFixture({ acceptModel = true } = {}) {
  const calls = { active: [], selected: [], thinking: [], messages: [] };
  return {
    calls,
    getAllTools: () => ["read", "grep", "find", "ls", "edit", "write", "bash", "powershell", "request_coding_access", "delegate_readonly_agent", "delegate_managed_writer"].map((name) => ({ name })),
    getActiveTools: () => calls.active.at(-1) ?? [],
    setActiveTools: (value) => calls.active.push([...value]),
    setModel: async (value) => { calls.selected.push(value); return acceptModel; },
    setThinkingLevel: (value) => calls.thinking.push(value),
    sendUserMessage: (value) => calls.messages.push(value),
  };
}

function contextFixture({ mode = "tui", select, currentModel = null, availableModels = [], scopedModels = [] } = {}) {
  const calls = { notifications: [], shutdowns: 0, statuses: [], widgets: [] };
  return {
    calls,
    mode,
    hasUI: mode === "tui",
    cwd: "/tmp/project",
    model: currentModel,
    scopedModels,
    modelRegistry: { getAvailable: () => availableModels },
    sessionManager: { getEntries: () => [] },
    ui: {
      select: select ?? (async () => undefined),
      notify: (message, type) => calls.notifications.push({ message, type }),
      setStatus: (...args) => calls.statuses.push(args),
      setWidget: (...args) => calls.widgets.push(args),
      setTitle: () => {},
    },
    shutdown: () => { calls.shutdowns += 1; },
  };
}

async function privateRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function git(cwd, args) {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout).trim();
}

async function repository(t) {
  const root = await privateRoot(t, "omp-m12-errors-repo-");
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "OMP Test"]);
  await git(root, ["config", "user.email", "omp@example.invalid"]);
  await fs.writeFile(path.join(root, "app.js"), "export const value = 1;\n");
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  return { root, head: await git(root, ["rev-parse", "HEAD"]) };
}

function simpleRequest(overrides = {}) {
  return {
    taskSummary: "fix the local test",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: [],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
    ...overrides,
  };
}

test("M12 admission rejects malformed requests and invalid model entries", () => {
  for (const value of [null, [], "task"]) {
    assert.throws(() => normalizeCodingAccessRequest(value), { code: "CODING_ACCESS_REQUEST_INVALID" });
  }
  assert.throws(() => normalizeCodingAccessRequest({ ...simpleRequest(), unknown: true }), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ complexity: "medium" })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ riskFlags: ["security", "security"] })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ riskFlags: ["unknown"] })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ orchestration: [] })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false, extra: true } })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ taskSummary: "" })), { code: "CODING_ACCESS_REQUEST_INVALID" });
  assert.throws(() => normalizeCodingAccessRequest(simpleRequest({ scope: ["C:\\outside"] })), { code: "CODING_ACCESS_SCOPE_INVALID" });
  const defaults = normalizeCodingAccessRequest(simpleRequest({ orchestration: undefined }));
  assert.deepEqual(defaults.orchestration, { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false });
  assert.deepEqual(orderSelectableModels({ availableModels: [{ provider: "bad/provider", id: "x" }, null, model()] }).map((entry) => entry.reference), ["provider/model"]);
  assert.throws(() => new DirectSessionController({ pi: {}, configRoot: "/tmp" }), TypeError);
  assert.throws(() => new DirectSessionController({ pi: piFixture(), configRoot: "relative" }), TypeError);
});

test("M12 startup fails closed for unavailable, unauthenticated and missing recent models", async (t) => {
  const configRoot = await privateRoot(t, "omp-m12-models-");
  const explicit = new DirectSessionController({
    pi: piFixture(),
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1", ONLY_MY_PI_HEADLESS: "0" },
  });
  assert.equal((await explicit.selectStartupModel(contextFixture())).status, "EXPLICIT_MODEL_UNAVAILABLE");

  const noModels = new DirectSessionController({ pi: piFixture(), configRoot, environment: {} });
  assert.equal((await noModels.selectStartupModel(contextFixture())).status, "NO_AUTHENTICATED_MODELS");

  const headless = new DirectSessionController({ pi: piFixture(), configRoot, environment: { ONLY_MY_PI_HEADLESS: "1" } });
  assert.equal((await headless.selectStartupModel(contextFixture({ mode: "print", availableModels: [model()] }))).status, "HEADLESS_MODEL_REQUIRED");
  await saveLastInteractiveModel({ configRoot, model: "provider/old", selectedAt: "2026-08-30T00:00:00.000Z" });
  assert.equal((await headless.selectStartupModel(contextFixture({ mode: "print", availableModels: [model("provider", "new")] }))).status, "RECENT_MODEL_UNAVAILABLE");

  const rejected = new DirectSessionController({ pi: piFixture({ acceptModel: false }), configRoot, environment: {} });
  const rejectedContext = contextFixture({ availableModels: [model()], select: async (_title, options) => options[0] });
  assert.equal((await rejected.selectStartupModel(rejectedContext)).status, "MODEL_AUTH_UNAVAILABLE");

  const pinnedPi = piFixture();
  const pinned = new DirectSessionController({ pi: pinnedPi, configRoot, environment: {} });
  const pinnedContext = contextFixture({ scopedModels: [{ model: model("provider", "pinned", true), thinkingLevel: "high" }], select: async (_title, options) => options[0] });
  assert.equal((await pinned.selectStartupModel(pinnedContext)).status, "MODEL_SELECTED");
  assert.deepEqual(pinnedPi.calls.thinking, ["high"]);
});

test("M12 access revise, deny, command, baseline-failure and delegation errors remain read-only", async (t) => {
  const configRoot = await privateRoot(t, "omp-m12-access-");
  const pi = piFixture();
  pi.exec = async () => { throw Object.assign(new Error("unavailable"), { code: "GIT_UNAVAILABLE" }); };
  const choices = ["Revise plan", "Deny"];
  const ctx = contextFixture({ currentModel: model(), select: async () => choices.shift() });
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1", ONLY_MY_PI_HEADLESS: "0" },
  });
  const started = await controller.start({}, ctx);
  assert.equal(started.status, "EXPLICIT_MODEL_SELECTED");
  assert.equal(controller.workspaceBaseline.status, "BASELINE_UNAVAILABLE");
  assert.equal((await controller.requestCodingAccess(simpleRequest(), ctx)).details.status, "CODING_ACCESS_REVISION_REQUESTED");
  assert.equal(controller.state, DIRECT_SESSION_STATES.PLANNING);
  assert.equal((await controller.requestCodingAccess(simpleRequest({ complexity: "complex", plan: "Inspect, edit, test, and review." }), ctx)).details.status, "CODING_ACCESS_DENIED");
  assert.equal((await controller.requestCodingAccess({ ...simpleRequest(), taskSummary: "" }, ctx)).details.status, "CODING_ACCESS_REQUEST_INVALID");
  controller.enterPlanning("", ctx);
  controller.accessCommand("unexpected", ctx);
  controller.accessCommand("", ctx);
  assert.match(ctx.calls.notifications.at(-1).message, /OMP access/u);
  assert.equal((await controller.delegateReadOnly({ agent: "unknown", task: "x" }, ctx)).details.status, "DIRECT_ORCHESTRATION_UNAVAILABLE");
  assert.equal((await controller.delegateManagedWriter({}, ctx)).details.status, "CODING_ACCESS_REQUIRED");
  controller.agentsCommand(ctx);
  assert.match(ctx.calls.notifications.at(-1).message, /unavailable/u);
  controller.shutdown(ctx);
  assert.equal(controller.context, null);
  assert.deepEqual(ctx.calls.statuses.at(-1), ["omp-direct", undefined]);
});

test("M12 approval is rechecked, reused once, and guards delegation and mutation errors", async (t) => {
  const configRoot = await privateRoot(t, "omp-m12-approval-");
  const environment = { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1", ONLY_MY_PI_HEADLESS: "0", PI_PERMISSION_MODE: "build" };
  const pi = piFixture();
  let first = true;
  const ctx = contextFixture({
    currentModel: model(),
    select: async (_title, options) => {
      if (first) {
        first = false;
        environment.PI_PERMISSION_MODE = "yolo";
      }
      return options[0];
    },
  });
  const controller = new DirectSessionController({ pi, configRoot, environment });
  await controller.start({}, ctx);
  assert.equal((await controller.requestCodingAccess(simpleRequest(), ctx)).details.status, "UNSUPPORTED_UNSAFE_OVERRIDE");

  environment.PI_PERMISSION_MODE = "build";
  const approved = await controller.requestCodingAccess(simpleRequest(), ctx);
  assert.equal(approved.details.status, "CODING_ACCESS_GRANTED");
  assert.equal((await controller.requestCodingAccess(simpleRequest(), ctx)).details.status, "CODING_ACCESS_ALREADY_GRANTED");
  assert.deepEqual(controller.activeToolCeiling(), CODING_TOOL_NAMES);
  assert.equal(controller.blockToolCall({ toolName: "edit", input: { path: "outside.txt" } }), undefined);
  assert.match(controller.blockToolCall({ toolName: "edit", input: { path: "/tmp/outside.txt" } }).reason, /PROJECT_PATH_ESCAPE/u);
  assert.match(controller.blockToolCall({ toolName: "bash", input: { command: "git reset --hard" } }).reason, /DESTRUCTIVE_GIT_RESET/u);
  assert.match(controller.blockToolCall({ toolName: "powershell", input: {} }).reason, /UNSUPPORTED_MUTATION_TOOL/u);
  assert.equal(controller.inspectUserBash({ command: "npm test" }), undefined);
  assert.equal(controller.inspectUserBash({ command: "git clean -fd" }).result.exitCode, 126);

  const failing = {
    delegateReadOnly: async () => { throw Object.assign(new Error("child failed"), { code: "CHILD_FAILED" }); },
    delegateWriter: async () => { throw Object.assign(new Error("writer failed"), { code: "WRITER_FAILED" }); },
    snapshot: () => null,
  };
  controller.attachOrchestrator(failing);
  assert.equal((await controller.delegateReadOnly({ agent: "unknown", task: "inspect" }, ctx)).details.status, "DIRECT_AGENT_NOT_ALLOWED");
  assert.equal((await controller.delegateReadOnly({ agent: "omp-explorer", task: "inspect" }, ctx)).details.status, "CHILD_FAILED");
  assert.equal((await controller.delegateManagedWriter({}, ctx)).details.status, "MANAGED_WRITER_NOT_APPROVED");
  controller.agentsCommand(ctx);
  assert.match(ctx.calls.notifications.at(-1).message, /unavailable/u);
});

test("M12 launcher rejects malformed argv, stack and extension contracts", async (t) => {
  assert.throws(() => classifyOmpInvocation(null), { code: "OMP_ARGUMENTS_INVALID" });
  assert.equal(classifyOmpInvocation(["-h"]).kind, "agent-help");
  assert.throws(() => inspectDirectAgentArguments(Array.from({ length: 129 }, () => "x")), { code: "OMP_ARGUMENTS_INVALID" });
  assert.throws(() => inspectDirectAgentArguments(["bad\nvalue"]), { code: "OMP_ARGUMENTS_INVALID" });
  assert.throws(() => inspectDirectAgentArguments(["--model=provider/model"]), { code: "OMP_AGENT_OPTION_UNSUPPORTED" });
  assert.throws(() => inspectDirectAgentArguments(["--model"]), { code: "OMP_AGENT_OPTION_INVALID" });
  assert.throws(() => resolveDirectConfigRoot({ env: { PI_CODING_AGENT_DIR: "/tmp/bad\nroot" } }), { code: "OMP_DIRECT_CONFIG_ROOT_INVALID" });
  await assert.rejects(resolveControlledStack({ stackRoot: "relative" }), { code: "OMP_CONTROLLED_STACK_INVALID" });
  const missing = await privateRoot(t, "omp-m12-stack-");
  await assert.rejects(resolveControlledStack({ stackRoot: path.join(missing, "not-a-stack"), homeDir: missing }), { code: "OMP_CONTROLLED_STACK_UNAVAILABLE" });
  assert.throws(() => buildDirectPiInvocation({ argv: [], stack: {}, extensionPaths: ["/tmp/e.ts"], randomUUIDImpl: () => UUID }), { code: "OMP_CONTROLLED_STACK_INVALID" });
  assert.throws(() => buildDirectPiInvocation({ argv: [], stack: { nodePath: "/node", piCliPath: "/pi", stackId: STACK_ID }, extensionPaths: ["relative"] , randomUUIDImpl: () => UUID }), { code: "OMP_DIRECT_EXTENSION_SET_INVALID" });
  assert.throws(() => buildDirectPiInvocation({ argv: [], stack: { nodePath: "/node", piCliPath: "/pi", stackId: STACK_ID }, extensionPaths: ["/tmp/e.ts"], randomUUIDImpl: () => "bad" }), { code: "OMP_LAUNCH_ID_INVALID" });
  await assert.rejects(resolveDirectExtensionSet({ stack: {}, configRoot: "/tmp" }), { code: "OMP_CONTROLLED_STACK_INVALID" });
  await assert.rejects(resolveDirectExtensionSet({ stack: { ompPackageRoot: "/tmp" }, configRoot: "relative" }), { code: "OMP_DIRECT_CONFIG_ROOT_INVALID" });
});

test("M12 managed-clone contract rejects invalid identities and records no-op writers", async (t) => {
  const { root, head } = await repository(t);
  const runsRoot = path.join(await privateRoot(t, "omp-m12-runs-"), "runs");
  await assert.rejects(createManagedClone({ repositoryRoot: "relative", runId: "writer", baseCommit: head, runsRoot }), { code: "MANAGED_CLONE_PATH_INVALID" });
  await assert.rejects(createManagedClone({ repositoryRoot: root, runId: "../writer", baseCommit: head, runsRoot }), { code: "MANAGED_CLONE_RUN_ID_INVALID" });
  await assert.rejects(createManagedClone({ repositoryRoot: root, runId: "writer", baseCommit: "bad", runsRoot }), { code: "MANAGED_CLONE_BASE_COMMIT_INVALID" });

  const managed = await createManagedClone({ repositoryRoot: root, runId: "writer", baseCommit: head, runsRoot });
  await assert.rejects(createManagedClone({ repositoryRoot: root, runId: "writer", baseCommit: head, runsRoot }), { code: "MANAGED_CLONE_ALREADY_EXISTS" });
  const noChanges = await captureWriterPatch({ cloneRoot: managed.cloneRoot, baseCommit: head, scope: ["**"], patchRoot: managed.patchRoot, runId: managed.runId });
  assert.equal(noChanges.status, "NO_CHANGES");
  await assert.rejects(captureWriterPatch({ cloneRoot: managed.cloneRoot, baseCommit: head, scope: [], patchRoot: managed.patchRoot }), { code: "WRITER_PATCH_SCOPE_REQUIRED" });
  await assert.rejects(captureWriterPatch({ cloneRoot: managed.cloneRoot, baseCommit: COMMIT, scope: ["**"], patchRoot: managed.patchRoot }), { code: "WRITER_PATCH_BASE_DRIFT" });
  await assert.rejects(verifyWriterPatch({ patch: noChanges, repositoryRoot: root, scope: ["**"] }), { code: "WRITER_PATCH_INVALID" });
  assert.deepEqual(writerScopeOverlapsDirtyPaths(null, ["**"]), []);
});
