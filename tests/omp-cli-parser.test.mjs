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
  assert.throws(() => parseOmpArgs(["swarm", "run", "research-synthesis", "--apply"], context), /not valid for swarm/);
  assert.throws(() => parseOmpArgs(["swarm", "status"], context), /requires a run id/);
});
