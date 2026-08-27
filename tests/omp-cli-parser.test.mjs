import assert from "node:assert/strict";
import test from "node:test";

import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";

const context = { env: {}, homedir: () => "/tmp/omp-home" };

test("bootstrap defaults to a zero-write plan with explicit isolated config root", () => {
  const parsed = parseOmpArgs(["bootstrap", "--profile", "coding", "--config-root", "/tmp/pi-test"], context);
  assert.equal(parsed.command, "bootstrap");
  assert.equal(parsed.mutation, false);
  assert.equal(parsed.options.apply, false);
  assert.equal(parsed.options.dryRun, true);
  assert.equal(parsed.options.configRoot, "/tmp/pi-test");
});

test("bootstrap preserves provider selection as metadata only", () => {
  const parsed = parseOmpArgs([
    "bootstrap",
    "--apply",
    "--yes",
    "--provider",
    "deepseek",
    "--model",
    "deepseek-v4-pro",
  ], context);
  assert.equal(parsed.mutation, true);
  assert.equal(parsed.options.provider, "deepseek");
  assert.equal(parsed.options.model, "deepseek-v4-pro");
  assert.equal(Object.hasOwn(parsed.options, "apiKey"), false);
});

test("update and uninstall are plans unless apply is explicit", () => {
  for (const command of ["update", "uninstall"]) {
    const plan = parseOmpArgs([command], context);
    assert.equal(plan.mutation, false);
    assert.equal(plan.options.plan, true);
    const apply = parseOmpArgs([command, "--apply", "--yes"], context);
    assert.equal(apply.mutation, true);
  }
});

test("doctor defaults to static and live is explicit", () => {
  assert.equal(parseOmpArgs(["doctor"], context).options.live, false);
  assert.equal(parseOmpArgs(["doctor", "--live"], context).options.live, true);
  assert.throws(() => parseOmpArgs(["doctor", "--static", "--live"], context), /mutually exclusive/);
});

test("rollback accepts only a canonical snapshot id", () => {
  assert.equal(parseOmpArgs(["rollback", "snap-1", "--yes"], context).options.snapshotId, "snap-1");
  assert.throws(() => parseOmpArgs(["rollback", "../escape"], context), /invalid snapshot/);
  assert.throws(() => parseOmpArgs(["rollback", "a", "b"], context), /at most one/);
});

test("parser rejects ambiguity, injection, duplicates, and unsafe config roots", () => {
  const cases = [
    ["bootstrap", "--apply", "--dry-run"],
    ["bootstrap", "--profile", "coding", "--profile", "research"],
    ["bootstrap", "--apply", "--", "touch", "/tmp/pwn"],
    ["bootstrap", "--profile=research"],
    ["bootstrap", "--config-root", "relative/path"],
    ["update", "--apply", "--plan"],
    ["update", "--yes"],
    ["status", "--provider", "deepseek"],
    ["unknown"],
  ];
  for (const argv of cases) assert.throws(() => parseOmpArgs(argv, context), { name: "Error" }, argv.join(" "));
});

test("PI_CODING_AGENT_DIR is the only environment config-root override", () => {
  const parsed = parseOmpArgs(["status"], { env: { PI_CODING_AGENT_DIR: "/tmp/isolated-pi" }, homedir: () => "/real-home" });
  assert.equal(parsed.options.configRoot, "/tmp/isolated-pi");
});

test("M3 read-only control command matrix has strict positional contracts", () => {
  assert.deepEqual(parseOmpArgs(["profile", "list", "--json"], context).options, {
    configRoot: "/tmp/omp-home/.pi/agent",
    subcommand: "list",
    profileId: null,
    toProfileId: null,
    json: true,
  });
  assert.equal(parseOmpArgs(["profile", "diff", "coding", "research"], context).options.toProfileId, "research");
  for (const command of ["tools", "packages", "context", "verify"]) {
    assert.equal(parseOmpArgs([command, "--json"], context).command, command);
    assert.throws(() => parseOmpArgs([command, "unexpected"], context), /accepts no positional/);
  }
  assert.throws(() => parseOmpArgs(["profile", "show"], context), /requires a profile id/);
  assert.throws(() => parseOmpArgs(["profile", "diff", "coding"], context), /requires from and to/);
});

test("M5 swarm parser keeps planning offline and requires explicit yes only for run", () => {
  const plan = parseOmpArgs(["swarm", "plan", "research-synthesis", "--input-file", "/tmp/question.json", "--json"], context);
  assert.equal(plan.command, "swarm");
  assert.equal(plan.mutation, false);
  assert.equal(plan.options.recipeId, "research-synthesis");
  assert.equal(plan.options.inputFile, "/tmp/question.json");
  assert.throws(() => parseOmpArgs(["swarm", "plan", "research-synthesis", "--yes"], context), /only valid for swarm run/);
  assert.equal(parseOmpArgs(["swarm", "run", "research-synthesis", "--yes"], context).mutation, true);
  assert.equal(parseOmpArgs(["swarm", "resume", "swarm-run-1"], context).mutation, true);
  assert.equal(parseOmpArgs(["swarm", "resume", "swarm-run-1"], context).options.runId, "swarm-run-1");
  assert.equal(parseOmpArgs(["swarm", "cancel", "swarm-run-1"], context).mutation, true);
  assert.throws(() => parseOmpArgs(["swarm", "run", "research-synthesis", "--apply"], context), /not valid for swarm/);
  assert.throws(() => parseOmpArgs(["swarm", "status"], context), /requires a run id/);
});

test("S3 swarm batch parser has a distinct homogeneous command grammar", () => {
  const plan = parseOmpArgs(["swarm", "batch", "plan", "review-items", "--input-file", "/tmp/items.json", "--json"], context);
  assert.equal(plan.command, "swarm");
  assert.equal(plan.mutation, false);
  assert.equal(plan.options.subcommand, "batch");
  assert.equal(plan.options.batchSubcommand, "plan");
  assert.equal(plan.options.batchId, "review-items");
  assert.equal(plan.options.runId, null);
  assert.equal(plan.options.inputFile, "/tmp/items.json");
  const run = parseOmpArgs(["swarm", "batch", "run", "review-items", "--yes"], context);
  assert.equal(run.mutation, true);
  assert.equal(run.options.batchSubcommand, "run");
  assert.equal(parseOmpArgs(["swarm", "batch", "resume", "batch-run-1"], context).options.runId, "batch-run-1");
  assert.throws(() => parseOmpArgs(["swarm", "batch", "plan"], context), /requires a batch id/);
  assert.throws(() => parseOmpArgs(["swarm", "batch", "status"], context), /requires a run id/);
  assert.throws(() => parseOmpArgs(["swarm", "batch", "show", "review-items", "extra"], context), /at most one id/);
  assert.throws(() => parseOmpArgs(["swarm", "batch", "list", "--yes"], context), /only valid for swarm batch run/);
});

test("workflow resume is classified as a mutation and binds the run id", () => {
  const parsed = parseOmpArgs(["workflow", "resume", "workflow-run-1", "--input-file", "/tmp/workflow-input.json"], context);
  assert.equal(parsed.mutation, true);
  assert.equal(parsed.options.runId, "workflow-run-1");
  assert.equal(parsed.options.workflowId, "workflow-run-1");
  assert.equal(parsed.options.inputFile, "/tmp/workflow-input.json");
  assert.equal(parseOmpArgs(["workflow", "cancel", "workflow-run-1"], context).mutation, true);
  assert.equal(parseOmpArgs(["workflow", "run", "single-agent-safe", "--input-file", "/tmp/input.json"], context).options.inputFile, "/tmp/input.json");
  assert.throws(() => parseOmpArgs(["workflow", "status", "workflow-run-1", "--input-file", "/tmp/input.json"], context), /only valid for workflow run or resume/);
  assert.throws(() => parseOmpArgs(["workflow", "resume", "workflow-run-1", "--input-file", "relative.json"], context), /absolute path/);
});

test("M6 theme parser separates read-only inspection from explicit apply", () => {
  const list = parseOmpArgs(["theme", "list", "--json"], context);
  assert.equal(list.mutation, false);
  assert.equal(list.options.themeId, null);
  const preview = parseOmpArgs(["theme", "preview", "only-my-pi-dark"], context);
  assert.equal(preview.options.subcommand, "preview");
  const plan = parseOmpArgs(["theme", "use", "only-my-pi-dark"], context);
  assert.equal(plan.mutation, false);
  assert.equal(plan.options.apply, false);
  const apply = parseOmpArgs(["theme", "use", "only-my-pi-dark", "--apply", "--yes"], context);
  assert.equal(apply.mutation, true);
  assert.equal(apply.options.yes, true);
  assert.equal(parseOmpArgs(["theme", "reset", "--apply", "--yes"], context).mutation, true);
  for (const argv of [
    ["theme", "show"],
    ["theme", "list", "only-my-pi-dark"],
    ["theme", "use", "only-my-pi-dark", "--yes"],
    ["theme", "doctor", "--apply"],
    ["theme", "use", "only-my-pi-dark", "--profile", "coding"],
  ]) assert.throws(() => parseOmpArgs(argv, context), Error, argv.join(" "));
});

test("M8 profiles and models grammar separates plans, apply, and explicit project inspection", () => {
  const configRoot = "/tmp/pi-test";
  const list = parseOmpArgs(["profiles", "list", "--config-root", configRoot]);
  assert.equal(list.command, "profiles");
  assert.equal(list.mutation, false);
  assert.equal(list.options.subcommand, "list");

  const plan = parseOmpArgs(["profiles", "plan", "daily", "--config-root", configRoot]);
  assert.equal(plan.mutation, false);
  assert.equal(plan.options.presetId, "daily");

  const apply = parseOmpArgs(["profiles", "apply", "daily", "--yes", "--config-root", configRoot]);
  assert.equal(apply.mutation, true);
  assert.equal(apply.options.yes, true);

  const models = parseOmpArgs(["models", "validate", "--project", "/tmp/project", "--config-root", configRoot]);
  assert.equal(models.command, "models");
  assert.equal(models.options.projectRoot, "/tmp/project");

  assert.throws(() => parseOmpArgs(["profiles", "plan", "daily", "--yes"]), /--yes is only valid/u);
  assert.throws(() => parseOmpArgs(["models", "validate", "--project", "relative"]), /absolute/u);
  assert.throws(() => parseOmpArgs(["status", "--project", "/tmp/project"]), /only valid for models/u);
});
