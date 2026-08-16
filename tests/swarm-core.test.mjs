import assert from "node:assert/strict";
import test from "node:test";

import {
  SwarmError,
  aggregateSwarmResults,
  compileSwarmRequest,
  createSwarmRecipeRegistry,
  intersectBudgets,
  validateSwarmRecipe,
  createSwarmRunController,
} from "../packages/swarm-core/index.mjs";

const root = process.cwd();

function fakeAgentRegistry({ writer = false } = {}) {
  return {
    async resolve(id) {
      return { id, rawId: id, sourceHash: `sha256:${id.padEnd(64, "0").slice(0, 64)}`, manifest: {
        id,
        writer,
        tools: { allow: writer ? ["read", "grep", "find", "ls", "edit", "write", "bash"] : ["read", "grep", "find", "ls"], deny: [] },
      }, receipt: { agentId: id } };
    },
  };
}

test("recipe registry discovers the four runtime Swarm recipes", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root, agentRegistry: fakeAgentRegistry() });
  const result = await registry.discover();
  assert.deepEqual(result.recipes.map((entry) => entry.id), ["coding-guarded", "debug-hypotheses", "research-synthesis", "review-matrix"]);
  assert.equal((await registry.doctor()).ok, true);
});

test("budget intersection is restrictive and never widens nested policy", () => {
  const result = intersectBudgets(
    { maxConcurrency: 4, maxChildren: 8, maxDepth: 2, nestedSwarm: false },
    { maxConcurrency: 2, maxChildren: 5, maxDepth: 1, nestedSwarm: true },
    { maxConcurrency: 3, maxChildren: 3, maxDepth: 1, nestedSwarm: true },
  );
  assert.equal(result.maxConcurrency, 2);
  assert.equal(result.maxChildren, 3);
  assert.equal(result.maxDepth, 1);
  assert.equal(result.nestedSwarm, false);
});

test("compileSwarmRequest uses a JSON-safe compiler payload and no raw task source", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root, agentRegistry: fakeAgentRegistry() });
  const entry = await registry.resolve("research-synthesis");
  const admission = {
    policyHash: `sha256:${"a".repeat(64)}`,
    effectiveBudget: entry.manifest.budget,
  };
  const compiled = compileSwarmRequest(entry, admission, { input: { question: "line\n${danger}" } });
  assert.equal(compiled.method, "spawn");
  assert.equal(compiled.source.schemaValidated, true);
  assert.equal(compiled.params.async, true);
  assert.match(compiled.params.workflowScript, /^export default async function run\(ctx\)/);
  assert.doesNotMatch(compiled.params.workflowScript, /line\n\$\{danger\}/);
  assert.equal(compiled.plan.nodes.length, 4);
});

test("read-only recipe admission rejects an agent that exposes bash", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root });
  const entry = await registry.resolve("research-synthesis");
  await assert.rejects(
    () => import("../packages/swarm-core/index.mjs").then(({ admitSwarm }) => admitSwarm(entry, { agentRegistry: fakeAgentRegistry({ writer: true }) })),
    (error) => error instanceof SwarmError && error.code === "CAPABILITY_ESCALATION",
  );
});

test("writer admission requires a negotiated worktree capability", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root });
  const entry = await registry.resolve("coding-guarded");
  const { admitSwarm } = await import("../packages/swarm-core/index.mjs");
  await assert.rejects(
    () => admitSwarm(entry, { agentRegistry: fakeAgentRegistry({ writer: true }), runtimeCapabilities: { worktree: false } }),
    (error) => error instanceof SwarmError && error.code === "WORKTREE_CAPABILITY_UNAVAILABLE",
  );
});

test("aggregation is stable, partial failures fail closed, and verifier failure controls verdict", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root, agentRegistry: fakeAgentRegistry() });
  const entry = await registry.resolve("research-synthesis");
  const aggregate = aggregateSwarmResults(entry, [
    { nodeId: "synthesize", status: "completed", result: { verdict: "pass" } },
    { nodeId: "research-b", status: "completed", result: { answer: "b" } },
    { nodeId: "research-a", status: "completed", result: { answer: "a" } },
    { nodeId: "verify-sources", status: "failed", result: { verdict: "fail" } },
  ]);
  assert.equal(aggregate.verdict, "fail");
  assert.deepEqual(aggregate.order, ["research-a", "research-b", "verify-sources", "synthesize"]);
  assert.equal(aggregate.partial, true);
});

test("run controller keeps live execution unavailable without an injected Pi runtime", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root, agentRegistry: fakeAgentRegistry() });
  const controller = createSwarmRunController({ registry, agentRegistry: fakeAgentRegistry() });
  const result = await controller.run("research-synthesis", { runId: "swarm-unavailable" });
  assert.equal(result.verdict, "blocked");
  assert.equal(result.reason, "LIVE_SWARM_REQUIRES_PI_SESSION");
});

test("fake runtime proves cancellation closes admission and verifier failure prevents success", async () => {
  const registry = createSwarmRecipeRegistry({ rootDir: root, agentRegistry: fakeAgentRegistry() });
  let stopped = 0;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const adapter = {
    async execute(_compiled, { signal }) {
      startedResolve();
      await new Promise((resolve, reject) => {
        if (signal.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        else signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      });
    },
    async stop() { stopped += 1; },
  };
  const controller = createSwarmRunController({ registry, agentRegistry: fakeAgentRegistry(), adapter });
  const pending = controller.run("research-synthesis", { runId: "swarm-cancel" });
  await started;
  const request = await controller.cancel("swarm-cancel");
  const state = await pending;
  assert.equal(request.admissionClosed, true);
  assert.equal(state.status, "cancelled");
  assert.equal(state.verdict, "cancelled");
  assert.equal(stopped, 1);
});

test("recipe shape rejects nested swarm and shared writer widening", () => {
  const base = {
    $schema: "swarm-recipe-v1.schema.json", formatVersion: 1, contractStatus: "runtime-ready", id: "x", version: "1.0.0", description: "x", readOnly: false,
    budget: { maxDepth: 1, maxConcurrency: 1, maxChildren: 1, childTimeoutSeconds: 1, runTimeoutSeconds: 1, retry: 0, nestedSwarm: false, childOutputBytes: 1024, parentSummaryBytes: 1024 },
    writerPolicy: { sharedCwdMaxWriters: 1, parallelWriters: "managed-worktree-only", onConflict: "reject" },
    nodes: [{ id: "one", agent: "scout", taskTemplate: "task", needs: [], workspace: "shared-read-only", writer: false, timeoutSeconds: 1, retry: 0 }],
    aggregation: { strategy: "stable-array", order: "topological-then-node-id", includePartial: false, maxOutputBytes: 1024 }, verifier: "one",
    cancellation: { stopAdmission: true, cancelRunning: true, disableRetry: true, waitForTerminalProof: true },
  };
  assert.equal(validateSwarmRecipe({ ...base, budget: { ...base.budget, nestedSwarm: true } }).valid, false);
  assert.equal(validateSwarmRecipe({ ...base, nodes: [{ ...base.nodes[0], writer: true, workspace: "shared-read-only" }] }).valid, false);
});
