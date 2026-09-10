import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  DIRECT_SESSION_STATES,
  DirectSessionController,
  INSPECTION_TOOL_NAMES,
} from "../extensions/omp-direct/runtime.mjs";
import { captureWorkspaceBaseline, classifyWorkspaceChanges } from "../packages/direct-agent/workspace.mjs";

const run = promisify(execFile);

async function git(cwd, args) {
  const result = await run("git", args, { cwd, encoding: "utf8" });
  return { code: 0, stdout: result.stdout, stderr: result.stderr };
}

async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m12-main-agent-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.name", "OMP Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await git(root, ["add", "src/app.js"]);
  await git(root, ["commit", "--quiet", "-m", "fixture"]);
  await fs.writeFile(path.join(root, "notes.txt"), "pre-existing user note\n");
  return root;
}

function piFor(root) {
  const calls = { active: [] };
  return {
    calls,
    getAllTools: () => ["read", "grep", "find", "ls", "edit", "write", "bash", "request_coding_access", "delegate_readonly_agent", "delegate_managed_writer"].map((name) => ({ name })),
    getActiveTools: () => calls.active.at(-1) ?? [],
    setActiveTools: (names) => calls.active.push([...names]),
    setModel: async () => true,
    setThinkingLevel: () => {},
    sendUserMessage: () => {},
    exec: async (command, args, options = {}) => {
      assert.equal(command, "git");
      return git(options.cwd ?? root, args);
    },
  };
}

function context(root) {
  return {
    cwd: root,
    mode: "tui",
    hasUI: true,
    model: { provider: "fixture", id: "model" },
    scopedModels: [],
    modelRegistry: { getAvailable: () => [] },
    sessionManager: { getEntries: () => [] },
    shutdown: () => {},
    ui: {
      select: async (_title, options) => options[0],
      notify: () => {},
      setStatus: () => {},
      setWidget: () => {},
      setTitle: () => {},
    },
  };
}

test("main Agent coding grant is one-process, project-local, non-destructive and preserves dirty work", async (t) => {
  const root = await repository(t);
  const configRoot = path.join(root, ".private-agent-config");
  await fs.mkdir(configRoot);
  const pi = piFor(root);
  const ctx = context(root);
  const controller = new DirectSessionController({
    pi,
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1", PI_PERMISSION_MODE: "build" },
  });
  await controller.start({ reason: "startup" }, ctx);
  assert.equal(controller.workspaceBaseline.dirty, true);
  assert.ok(controller.workspaceBaseline.paths.some((entry) => entry.path === "notes.txt"));
  assert.equal(controller.state, DIRECT_SESSION_STATES.INSPECT);

  const granted = await controller.requestCodingAccess({
    taskSummary: "adjust the local value",
    complexity: "simple",
    scope: ["src/**"],
    riskFlags: [],
    verification: ["npm test"],
    orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false },
  }, ctx);
  assert.equal(granted.details.status, "CODING_ACCESS_GRANTED");
  assert.equal(controller.blockToolCall({ toolName: "edit", input: { path: "src/app.js" } }), undefined);
  assert.equal(controller.blockToolCall({ toolName: "write", input: { path: "test/new.test.js" } }), undefined);
  assert.match(controller.blockToolCall({ toolName: "write", input: { path: path.join(root, "..", "outside.txt") } }).reason, /PROJECT_PATH_ESCAPE/u);
  assert.equal(controller.blockToolCall({ toolName: "bash", input: { command: "npm test" } }), undefined);
  assert.match(controller.blockToolCall({ toolName: "bash", input: { command: "git reset --hard HEAD" } }).reason, /DESTRUCTIVE_GIT_RESET/u);

  const repeated = await controller.requestCodingAccess({}, ctx);
  assert.equal(repeated.details.status, "CODING_ACCESS_ALREADY_GRANTED");
  await fs.writeFile(path.join(root, "src", "app.js"), "export const value = 2;\n");
  const current = await captureWorkspaceBaseline({ cwd: root, runGit: git });
  const classified = classifyWorkspaceChanges(controller.workspaceBaseline, current);
  assert.ok(classified.preExisting.some((entry) => entry.path === "notes.txt"));
  assert.ok(classified.sessionChanges.some((entry) => entry.path === "src/app.js"));

  controller.shutdown(ctx);
  const nextProcess = new DirectSessionController({
    pi: piFor(root),
    configRoot,
    environment: { ONLY_MY_PI_DIRECT: "1", ONLY_MY_PI_HEADLESS: "0", ONLY_MY_PI_MODEL_EXPLICIT: "1", PI_PERMISSION_MODE: "build" },
  });
  assert.equal(nextProcess.state, DIRECT_SESSION_STATES.INSPECT);
  assert.deepEqual(nextProcess.activeToolCeiling(), INSPECTION_TOOL_NAMES);
});
