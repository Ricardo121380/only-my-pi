import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";
import { createSwarmGoalControlService } from "../packages/control-service/swarm-goal-service.mjs";
import { createSwarmControlService } from "../packages/control-service/swarm-service.mjs";
import { createUltraRunControlService } from "../packages/control-service/ultra-run-service.mjs";
import { digestValue } from "../packages/subagents/domain/index.mjs";
import { createSwarmGoalRegistry } from "../packages/subagents/swarm-goal/registry.mjs";
import { createUltraRunRegistry } from "../packages/subagents/ultra-run/registry.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ultraRequest() {
  return {
    id: "control-request",
    taskDigest: digestValue("control-task"),
    complexity: 95,
    itemCount: 20,
    homogeneous: false,
    dynamicGoal: true,
    mutation: "none",
    risk: "high",
    origin: { kind: "human", requestDigest: digestValue("control-human-request") },
    preferredGoal: "research-release-goal",
  };
}

test("CLI parser exposes strict swarm goal and UltraRun namespaces", () => {
  const goal = parseOmpArgs(["swarm", "goal", "plan", "research-release-goal", "--input-file", "/tmp/goal.json", "--json"], { env: {}, homedir: () => "/tmp/home" });
  assert.equal(goal.command, "swarm");
  assert.equal(goal.options.subcommand, "goal");
  assert.equal(goal.options.goalSubcommand, "plan");
  assert.equal(goal.options.goalId, "research-release-goal");
  assert.equal(goal.mutation, false);
  const ultra = parseOmpArgs(["ultra", "run", "ultra-deep", "--input-file", "/tmp/ultra.json", "--yes"], { env: {}, homedir: () => "/tmp/home" });
  assert.equal(ultra.command, "ultra");
  assert.equal(ultra.options.strategyId, "ultra-deep");
  assert.equal(ultra.mutation, true);
  assert.throws(() => parseOmpArgs(["swarm", "goal", "run", "research-release-goal", "--input-file", "relative.json"], { env: {}, homedir: () => "/tmp/home" }));
  assert.throws(() => parseOmpArgs(["ultra", "plan", "ultra-deep", "--yes"], { env: {}, homedir: () => "/tmp/home" }));
});

test("SwarmGoal control plane lists and plans offline, then fails closed without an injected Pi runtime", async () => {
  const service = createSwarmGoalControlService({ rootDir: root });
  const listed = await service.dispatch({ subcommand: "list" });
  assert.equal(listed.ok, true);
  assert.equal(listed.goals.some((goal) => goal.id === "research-release-goal"), true);
  const planned = await service.dispatch({ subcommand: "plan", goalId: "research-release-goal", runId: "goal-control-run", input: { topic: "runtime safety" } });
  assert.equal(planned.status, "SWARM_GOAL_PLAN");
  assert.equal(planned.liveDispatch, "NOT_RUN_BY_POLICY");
  assert.match(planned.plan.planDigest, /^sha256:/u);
  const stale = await service.dispatch({ subcommand: "run", goalId: "research-release-goal", runId: "goal-control-run", input: planned.input, yes: true, expectedPlanDigest: digestValue("wrong"), expectedAuthorizationDigest: planned.authorization.authorizationDigest });
  assert.equal(stale.code, "SWARM_GOAL_ADMISSION_DRIFT");
  const unavailable = await service.dispatch({ subcommand: "run", goalId: "research-release-goal", runId: "goal-control-run", input: planned.input, yes: true, expectedPlanDigest: planned.plan.planDigest, expectedAuthorizationDigest: planned.authorization.authorizationDigest });
  assert.equal(unavailable.status, "LIVE_SWARM_GOAL_REQUIRES_PI_SESSION");
  assert.equal(unavailable.liveDispatch, "NOT_RUN_BY_POLICY");

  const aggregate = createSwarmControlService({ rootDir: root, goalService: service });
  const nested = await aggregate.dispatch({ subcommand: "goal", goalSubcommand: "show", goalId: "research-release-goal" });
  assert.equal(nested.status, "SWARM_GOAL_SHOW");
});

test("UltraRun control plane exposes exact route, scale, quality, and authorization without dispatching a model", async () => {
  const service = createUltraRunControlService({ rootDir: root });
  const listed = await service.dispatch({ subcommand: "list" });
  assert.equal(listed.strategies.some((strategy) => strategy.id === "ultra-deep"), true);
  const planned = await service.dispatch({ subcommand: "plan", strategyId: "ultra-deep", input: ultraRequest() });
  assert.equal(planned.status, "ULTRA_RUN_PLAN");
  assert.equal(planned.plan.route, "swarm-goal");
  assert.equal(planned.plan.scale.costVisibility, "REQUIRED");
  assert.equal(planned.plan.quality.freshVerifier, true);
  assert.equal(planned.liveDispatch, "NOT_RUN_BY_POLICY");
  const unavailable = await service.dispatch({
    subcommand: "run",
    strategyId: "ultra-deep",
    input: planned.request,
    yes: true,
    expectedPlanDigest: planned.plan.planDigest,
    expectedAuthorizationDigest: planned.authorization.authorizationDigest,
  });
  assert.equal(unavailable.status, "LIVE_ULTRA_RUN_REQUIRES_PI_SESSION");
  assert.equal(unavailable.liveDispatch, "NOT_RUN_BY_POLICY");
});

test("SwarmGoal and UltraRun registries reject symlinked definitions", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-s4-registry-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const outside = path.join(temporary, "outside.json");
  await fs.writeFile(outside, JSON.stringify({ unsafe: true }), "utf8");
  const goals = path.join(temporary, "swarm", "goals");
  const strategies = path.join(temporary, "ultra", "strategies");
  await fs.mkdir(goals, { recursive: true });
  await fs.mkdir(strategies, { recursive: true });
  await fs.symlink(outside, path.join(goals, "linked.json"));
  await fs.symlink(outside, path.join(strategies, "linked.json"));
  await assert.rejects(
    createSwarmGoalRegistry({ rootDir: temporary }).discover(),
    (error) => error?.code === "SWARM_GOAL_RESOURCE_ESCAPE",
  );
  await assert.rejects(
    createUltraRunRegistry({ rootDir: temporary }).discover(),
    (error) => error?.code === "ULTRA_RUN_RESOURCE_ESCAPE",
  );
});

test("SwarmGoal and UltraRun registries reject symlinked ancestor directories", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-s4-registry-parent-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const outside = path.join(temporary, "outside");
  const checkout = path.join(temporary, "checkout");
  await fs.mkdir(path.join(outside, "goals"), { recursive: true });
  await fs.mkdir(path.join(outside, "strategies"), { recursive: true });
  await fs.mkdir(checkout, { recursive: true });
  await fs.symlink(outside, path.join(checkout, "linked"));
  await assert.rejects(
    createSwarmGoalRegistry({ rootDir: checkout, goalRoot: path.join(checkout, "linked", "goals") }).discover(),
    (error) => error?.code === "SWARM_GOAL_RESOURCE_ESCAPE",
  );
  await assert.rejects(
    createUltraRunRegistry({ rootDir: checkout, strategyRoot: path.join(checkout, "linked", "strategies") }).discover(),
    (error) => error?.code === "ULTRA_RUN_RESOURCE_ESCAPE",
  );
});
