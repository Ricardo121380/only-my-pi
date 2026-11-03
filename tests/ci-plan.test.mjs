import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { changedFiles, classifyChanges, isNodeTest, nodeTestFiles, requiredFailures, testLane } from "../scripts/ci-plan.mjs";
import { checksForLane, runLane } from "../scripts/ci-run.mjs";

test("documentation routing is explicit; runtime Markdown and unknown paths select all regressions", () => {
  assert.deepEqual(classifyChanges(["README.md", "AGENTS.md", "docs/plans/current.md"]),
    { docs: true, web: false, cli: false, packaging: false });
  for (const file of ["skills/demo/SKILL.md", "prompts/code.md", "agents/generated/a.md", "modes/prompts/a.md",
    "new-runtime/module.mjs", "packages/host/tasks.mjs", "package-lock.json", "docs/evidence/result.json",
    ".github/workflows/ci.yml", "scripts/ci-plan.mjs", "tests/ci-plan.test.mjs"]) {
    assert.deepEqual(classifyChanges([file]), { docs: true, web: true, cli: true, packaging: true }, file);
  }
  assert.deepEqual(classifyChanges(["webui/src/MinimalApp.tsx"]), { docs: true, web: true, cli: false, packaging: false });
  assert.deepEqual(classifyChanges(["tests/omp-cli.test.mjs"]), { docs: true, web: false, cli: true, packaging: false });
  assert.equal(classifyChanges(["tests/host-pi110-runtime.test.mjs"]).web, true);
});

test("every discovered Node test is assigned exactly once, including focused coverage and package tests", () => {
  const files = nodeTestFiles();
  assert.ok(files.length > 270);
  const selected = ["docs", "web", "cli"].flatMap(lane => checksForLane(lane, files))
    .filter(check => check.args.includes("--test"))
    .flatMap(check => check.args.filter(isNodeTest));
  assert.deepEqual(selected.toSorted(), files);
  assert.equal(new Set(selected).size, files.length);
  for (const file of ["packages/acp-v1/acp-v1.test.mjs", "packages/deepseek-conformance/test.mjs",
    "packages/workspace-checkpoint/test.mjs", "extensions/context-doctor/test.mjs",
    "extensions/session-ledger/extension.test.mjs", "extensions/session-ledger/test.mjs"])
    assert.ok(selected.includes(file), file);
  assert.equal(testLane("tests/new-future-module.test.mjs"), "cli");
  assert.equal(testLane("tests/direct-minimal-runtime.test.mjs"), "web");
  for (const file of ["test/new.js", "test-new.mjs", "tests/new.test.js", "tests/new_test.mjs", "test.mjs"]) assert.ok(isNodeTest(file));
  assert.equal(isNodeTest("webui/src/App.test.tsx"), false);
  assert.equal(isNodeTest("tests/fixtures/host.mjs"), false);
});

test("the required check rejects a failed, cancelled, missing or unexpectedly skipped lane", () => {
  const plan = classifyChanges(["webui/src/MinimalApp.tsx"]);
  const good = { docs: { result: "success" }, static: { result: "success" }, web: { result: "success" },
    cli: { result: "skipped" }, packaging: { result: "skipped" } };
  assert.deepEqual(requiredFailures(plan, good), []);
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    assert.deepEqual(requiredFailures(plan, { ...good, web: { result } }), ["web"]);
  }
  assert.deepEqual(requiredFailures(plan, { ...good, cli: { result: "success" } }), ["cli"]);
});

test("renames cannot hide runtime deletion and first pushes request all checks", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-ci-diff-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.name", "CI fixture");
  git("config", "user.email", "ci@example.invalid");
  fs.mkdirSync(path.join(dir, "prompts"));
  fs.writeFileSync(path.join(dir, "prompts/task.md"), "runtime prompt\n");
  git("add", "."); git("commit", "-qm", "base");
  const before = git("rev-parse", "HEAD");
  fs.mkdirSync(path.join(dir, "docs"));
  git("mv", "prompts/task.md", "docs/task.md"); git("commit", "-qm", "rename");
  const after = git("rev-parse", "HEAD");
  const files = changedFiles({ before, after }, "push", dir);
  assert.deepEqual(files, ["docs/task.md", "prompts/task.md"]);
  assert.equal(classifyChanges(files).cli, true);
  git("checkout", "-qb", "base-moved", before);
  fs.writeFileSync(path.join(dir, "README.md"), "base-only change\n");
  git("add", "."); git("commit", "-qm", "base moved");
  const base = git("rev-parse", "HEAD");
  assert.deepEqual(changedFiles({ pull_request: { base: { sha: base }, head: { sha: after } } }, "pull_request", dir), files);
  assert.equal(changedFiles({ before: "0".repeat(40), after }, "push", dir), null);
  assert.equal(changedFiles({}, "workflow_dispatch", dir), null);
});

test("failure reports preserve diagnostics and unfinished checks without raw output", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-ci-report-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "report.json");
  const checks = [{ id: "first", command: "node", args: [] }, { id: "second", command: "node", args: [] }];
  const report = await runLane("fixture", { checks, output, execute: async () => ({
    status: "FAIL", passed: false, exitCode: 1, signal: null, timedOut: false, outputLimitExceeded: false,
    durationMs: 5, diagnostic: "TEST_FAILURE:tests=fixture;kinds=testCodeFailure",
  }) });
  assert.equal(report.status, "FAIL");
  assert.equal(report.results[0].status, "FAIL");
  assert.equal(report.results[1].status, "NOT_RUN");
  assert.equal(report.rawOutputStored, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), report);
});
