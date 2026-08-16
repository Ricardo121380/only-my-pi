import assert from "node:assert/strict";
import test from "node:test";

import { createSwarmControlService } from "../packages/control-service/swarm-service.mjs";

const root = process.cwd();

test("swarm control list/show/validate/plan are read-only and live run fails closed", async () => {
  const service = createSwarmControlService({ rootDir: root });
  const list = await service.dispatch({ subcommand: "list" });
  assert.equal(list.ok, true);
  assert.deepEqual(list.recipes.map((entry) => entry.id), ["coding-guarded", "debug-hypotheses", "research-synthesis", "review-matrix"]);
  const show = await service.dispatch({ subcommand: "show", recipeId: "review-matrix" });
  assert.equal(show.recipe.id, "review-matrix");
  assert.equal((await service.dispatch({ subcommand: "validate", recipeId: "research-synthesis" })).status, "SWARM_RECIPE_VALID");
  const plan = await service.dispatch({ subcommand: "plan", recipeId: "research-synthesis", input: { question: "Pi" } });
  assert.equal(plan.status, "SWARM_PLAN");
  assert.equal(plan.mutation, false);
  assert.equal((await service.dispatch({ subcommand: "run", recipeId: "research-synthesis", yes: true })).status, "LIVE_SWARM_REQUIRES_PI_SESSION");
});

test("swarm control input files are bounded and reject symlinks", async (t) => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-swarm-input-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const input = path.join(dir, "input.json");
  await fs.writeFile(input, JSON.stringify({ question: "bounded" }));
  const service = createSwarmControlService({ rootDir: root });
  const result = await service.dispatch({ subcommand: "plan", recipeId: "research-synthesis", inputFile: input });
  assert.equal(result.status, "SWARM_PLAN");
  const link = path.join(dir, "link.json");
  await fs.symlink(input, link);
  const blocked = await service.dispatch({ subcommand: "plan", recipeId: "research-synthesis", inputFile: link });
  assert.equal(blocked.status, "SWARM_PLAN_BLOCKED");
  assert.equal(blocked.code, "INVALID_INPUT_FILE");
});
