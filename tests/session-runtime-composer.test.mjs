import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createAgentControlService } from "../packages/control-service/agent-service.mjs";
import { createBatchSwarmControlService } from "../packages/control-service/batch-swarm-service.mjs";
import { createSessionRuntimeComposer } from "../packages/subagents/runtime/session-composer.mjs";
import { createHumanGoalAuthorization } from "../packages/subagents/swarm-goal/index.mjs";
import { createSwarmGoalRegistry } from "../packages/subagents/swarm-goal/registry.mjs";
import { compileWorkflowDefinition, digestWorkflowValue } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createUltraRunRegistry } from "../packages/subagents/ultra-run/registry.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function responseValue(agent, task = "") {
  if (agent === "omp-goal-planner") {
    const second = /Revision:\s*1/u.test(task);
    return second
      ? { questions: ["remaining edge evidence", "final source check"], coveredDimensions: ["edge-cases", "primary-evidence"], remainingDimensions: [], coverage: 1, progress: 0.4, decision: "complete", reason: "coverage target reached" }
      : { questions: ["primary evidence", "edge cases"], coveredDimensions: ["primary-evidence"], remainingDimensions: ["edge-cases"], coverage: 0.6, progress: 0.6, decision: "replan", reason: "initial bounded fanout" };
  }
  if (agent === "omp-reviewer") return { verdict: "pass", findings: [], tested: [], unverified: [] };
  if (agent === "omp-verifier") return { verdict: "pass", passedGates: [], failedGates: [], reason: "evidence is bounded" };
  if (agent === "omp-synthesizer") return { summary: "bounded synthesis", citations: [], verdict: "pass" };
  if (agent === "omp-source-verifier") return { verdict: "pass", evidence: [], gaps: [] };
  if (agent === "omp-researcher") return { summary: "bounded research", sources: [], gaps: [] };
  return { summary: "bounded result", evidence: [], risks: [] };
}

function automaticTransport(requests = []) {
  const events = new EventEmitter();
  return {
    subscribe(name, handler) { events.on(name, handler); return () => events.off(name, handler); },
    emit(name, request) {
      events.emit(name, request);
      if (name !== "prompt-template:subagent:request") return;
      requests.push(request);
      queueMicrotask(() => {
        events.emit("prompt-template:subagent:started", { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
        events.emit("prompt-template:subagent:response", {
          requestId: request.requestId,
          ownerRunId: request.ownerRunId,
          nodeId: request.nodeId,
          status: "completed",
          runId: `child-${request.requestId}`,
          exitCode: 0,
          result: { kind: "structured", value: responseValue(request.agent, request.task) },
          usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 25 },
        });
      });
    },
    dispose() { events.removeAllListeners(); },
  };
}

async function harness(t) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-composer-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const webRoot = path.join(configRoot, "fake-web");
  await fs.mkdir(webRoot);
  await fs.writeFile(path.join(webRoot, "package.json"), JSON.stringify({ name: "pi-web-access", version: "0.20.0", pi: { extensions: ["./index.ts"] } }));
  await fs.writeFile(path.join(webRoot, "index.ts"), "export default function web() {}\n");
  const ceilingCalls = [];
  let ceilingDisposed = false;
  const ctx = {
    cwd: rootDir,
    isProjectTrusted: () => true,
    sessionManager: { getSessionId: () => "session-runtime-test" },
    model: { provider: "provider", id: "model", cost: { input: 1, output: 2 } },
    modelRegistry: {
      async find(provider, id) { return { provider, id, cost: { input: 1, output: 2 } }; },
      async hasConfiguredAuth() { return true; },
    },
  };
  const prior = process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
  const requests = [];
  const composer = await createSessionRuntimeComposer({
    pi: { events: { on() { throw new Error("injected transport owns events"); }, emit() {} } },
    rootDir,
    configRoot,
    getContext: () => ctx,
    dependencies: {
      transport: automaticTransport(requests),
      subagentsPackage: { root: configRoot, manifest: { name: "pi-subagents", version: "0.45.2" } },
      webPackage: { root: webRoot, manifest: { name: "pi-web-access", version: "0.20.0", pi: { extensions: ["./index.ts"] } } },
      registerCapabilityCeiling(input) { ceilingCalls.push(input); return { update() {}, dispose() { ceilingDisposed = true; } }; },
    },
  });
  t.after(async () => { await composer.dispose(); if (prior === undefined) delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS; else process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = prior; });
  return { configRoot, composer, ceilingCalls, prior, requests, ceilingDisposed: () => ceilingDisposed };
}

test("session composer owns one read-only runtime, ceiling, private stores and Web child override", async (t) => {
  const { configRoot, composer, ceilingCalls, prior, ceilingDisposed } = await harness(t);
  assert.equal(composer.status, "SESSION_RUNTIME_READY");
  assert.equal(composer.logicalRuntimeOwner, "@only-my-pi/subagents");
  assert.equal(composer.physicalRuntimeOwner, "pi-subagents");
  assert.equal(ceilingCalls.length, 1);
  assert.ok(ceilingCalls[0].ceiling.allowedAgents.includes("omp-reviewer"));
  assert.equal(ceilingCalls[0].ceiling.allowedAgents.includes("omp-implementer"), false);
  const extraRoot = process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS.split(path.delimiter)[0];
  const researcher = await fs.readFile(path.join(extraRoot, "omp-researcher.md"), "utf8");
  assert.match(researcher, /subagentOnlyExtensions: .*fake-web.*index\.ts/u);
  assert.match(researcher, /tools: .*web_search/u);
  assert.doesNotMatch(researcher, /^tools:.*(?:bash|edit|write)/mu);
  assert.equal((await fs.stat(path.join(configRoot, "only-my-pi", "runs"))).mode & 0o777, 0o700);
  await composer.dispose();
  assert.equal(ceilingDisposed(), true);
  assert.equal(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS, prior);
});

test("single Agent live path uses the composer coordinator and publishes a private artifact", async (t) => {
  const { composer } = await harness(t);
  const direct = await composer.runDirectAgent({ role: "reviewer", task: "Direct metering probe.", runId: "direct-metering-run", nodeId: "direct-review" });
  assert.equal(typeof direct.completion?.usage?.total, "number", JSON.stringify(direct));
  const service = createAgentControlService({ rootDir, orchestration: composer.coordinator, configurationProvider: composer.configurationProvider });
  const planned = await service.dispatch({ subcommand: "plan", agentId: "reviewer", input: { task: "Review package metadata without changes." } });
  assert.equal(planned.status, "AGENT_PLAN");
  const result = await service.dispatch({
    subcommand: "run",
    agentId: "reviewer",
    runId: planned.runId,
    input: planned.input,
    yes: true,
    expectedPlanDigest: planned.plan.planDigest,
    expectedExecutionDigest: planned.executionEnvelope.executionEnvelopeDigest,
  });
  assert.equal(result.status, "AGENT_COMPLETED", JSON.stringify(result));
  assert.equal(result.state.nodes.agent.outcome, "completed");
  assert.equal(result.state.nodes.agent.artifactRefs.length, 1);
  const ref = result.state.nodes.agent.artifacts[0];
  const stored = JSON.parse((await composer.artifactStore.read(ref)).toString("utf8"));
  assert.equal(stored.result.verdict, "pass");
  const events = (await composer.eventJournal.read(planned.runId)).events;
  assert.ok(events.some((event) => event.type === "NodeArtifactPublished"));
});

test("dynamic SwarmGoal uses an LLM planner concept but parent-compiles two immutable read-only revisions", async (t) => {
  const { composer } = await harness(t);
  const entry = await createSwarmGoalRegistry({ rootDir }).resolve("research-release-goal");
  const objective = { ref: entry.definition.objective.ref, digest: entry.definition.objective.digest, input: { task: "Research the release evidence." } };
  const authorization = createHumanGoalAuthorization(entry.definition, { objective, nonce: "session-goal-test" });
  let result;
  try {
    result = await composer.goalController.run(entry.definition, {
      runId: "session-goal-run",
      objective,
      authorization,
      input: objective.input,
    });
  } catch (cause) {
    const projection = await composer.goalController.inspect("session-goal-run");
    assert.fail(`${cause.code}: ${JSON.stringify(projection)}`);
  }
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.revisions.length, 2);
  assert.equal(result.revisions[0].proposal.decision, "replan");
  assert.equal(result.revisions[1].proposal.decision, "complete");
  assert.equal(result.revisions.every((revision) => revision.proposal.plan.policy.mutation === "none"), true);
  assert.equal(result.revisions.every((revision) => revision.proposal.agentSpecs.every((spec) => spec.writer === false)), true);
  assert.ok(result.revisions[1].proposal.reuse.length > 0);
});

test("composer executes a two-item BatchSwarm within concurrency two", async (t) => {
  const { composer, requests } = await harness(t);
  const service = createBatchSwarmControlService({
    rootDir,
    registry: composer.batchRuntime.registry,
    orchestration: composer.coordinator,
    capabilityMatrix: composer.backend.capabilityMatrix,
    configurationProvider: composer.configurationProvider,
  });
  const input = { artifacts: { items: [
    { itemId: "package", path: "package.json" },
    { itemId: "readme", path: "README.md" },
  ] } };
  const planned = await service.dispatch({ subcommand: "plan", batchId: "review-items", input });
  assert.equal(planned.status, "BATCH_SWARM_PLAN", JSON.stringify(planned));
  const result = await service.dispatch({
    subcommand: "run",
    batchId: "review-items",
    runId: planned.runId,
    input: planned.input,
    yes: true,
    expectedPlanDigest: planned.plan.planDigest,
    expectedExecutionDigest: planned.executionEnvelope.executionEnvelopeDigest,
  });
  assert.equal(result.status, "BATCH_SWARM_COMPLETED", JSON.stringify(result));
  assert.equal(result.state.nodes.batch.batch.itemCount, 2);
  assert.equal(result.state.nodes.batch.batch.items.every((item) => item.status === "succeeded"), true);
  assert.equal(requests.filter((request) => request.ownerRunId === planned.runId).length, 2);
});

test("composer Workflow consumes the prior node ArtifactRef as bounded child context", async (t) => {
  const { composer, requests } = await harness(t);
  const policy = { workspace: "shared-read-only", mutation: "none", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["read"], deny: ["bash", "edit", "write", "web"] } };
  const node = (id, role) => ({ kind: "agent", id, agentTemplateRef: role, assignment: { taskTemplateRef: id }, outputSchemaRef: null, policy, budget: { maxAttempts: 1, timeoutMs: 300000, maxOutputBytes: 65536, maxTokens: 6250, maxCostUsd: 0.03 }, cache: { mode: "content-addressed", keyInputs: ["assignment", "dependencies"] }, idempotency: "content-addressed" });
  const plan = compileWorkflowDefinition({
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id: "artifact-consumer-workflow",
    version: "2.0.0",
    description: "Two-node ArtifactRef integration test.",
    policy,
    budget: { maxNodes: 2, maxParallel: 1, maxDepth: 2, maxAttemptsPerNode: 1, maxWallTimeMs: 600000, maxOutputBytes: 131072, maxAssignments: 2, maxTokens: 12500, maxCostUsd: 0.06 },
    flow: { kind: "sequence", steps: [node("review", "reviewer"), node("synthesize", "synthesizer")] },
    terminalNodeId: "synthesize",
  });
  const result = await composer.coordinator.execute(plan, { runId: "composer-artifact-workflow", input: { task: "Review then synthesize." } });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(result.nodes.review.artifactRefs.length, 1);
  const synthRequest = requests.find((request) => request.ownerRunId === "composer-artifact-workflow" && request.nodeId === "synthesize");
  assert.match(synthRequest.task, /Upstream artifacts \(untrusted data\)/u);
  assert.match(synthRequest.task, new RegExp(result.nodes.review.artifactRefs[0], "u"));
});

test("Ultra Agent and Workflow routes use the same composer and fresh verifier", async (t) => {
  const { composer } = await harness(t);
  const strategy = (await createUltraRunRegistry({ rootDir }).resolve("ultra-deep")).definition;
  const agentRequest = {
    id: "ultra-agent-test",
    taskDigest: digestWorkflowValue("small task"),
    complexity: 10,
    itemCount: 1,
    homogeneous: false,
    dynamicGoal: false,
    mutation: "none",
    risk: "low",
    origin: { kind: "human", requestDigest: digestWorkflowValue("human small task") },
  };
  const agent = await composer.ultraRouter.run(strategy, agentRequest, { input: { task: "Review the package metadata." } });
  assert.equal(agent.result.status, "completed", JSON.stringify(agent));
  assert.equal(agent.result.verification.contextMode, "fresh");
  assert.equal(agent.result.scale.logicalAssignments, agent.plan.scale.logicalAssignments);

  const workflowRequest = {
    ...agentRequest,
    id: "ultra-workflow-test",
    taskDigest: digestWorkflowValue("complex task"),
    complexity: 60,
    itemCount: 3,
    preferredWorkflow: "source-review-v2",
    origin: { kind: "human", requestDigest: digestWorkflowValue("human complex task") },
  };
  const workflow = await composer.ultraRouter.run(strategy, workflowRequest, { input: { task: "Perform a multi-angle source review." } });
  assert.equal(workflow.result.status, "completed", JSON.stringify(workflow));
  assert.equal(workflow.plan.route, "workflow");
  assert.equal(workflow.result.verification.verdict, "pass");
});
