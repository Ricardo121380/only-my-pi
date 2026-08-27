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
import { createUltraRunAuthorization } from "../packages/subagents/ultra-run/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

function responseValue(agent, task = "") {
  if (agent === "omp-goal-planner") {
    const second = /Revision:\s*1/u.test(task);
    return second
      ? { questions: ["remaining edge evidence", "final source check"], coveredDimensions: ["edge-cases", "primary-evidence"], remainingDimensions: [], coverage: 1, progress: 0.4, decision: "complete", reason: "coverage target reached" }
      : { questions: ["primary evidence", "edge cases"], coveredDimensions: ["primary-evidence"], remainingDimensions: ["edge-cases"], coverage: 1, progress: 1, decision: "complete", reason: "planner attempted completion before any evidence was executed" };
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

async function harness(t, { withoutWeb = false, inheritedExtraAgentDirs } = {}) {
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
  if (inheritedExtraAgentDirs !== undefined) process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = inheritedExtraAgentDirs;
  const requests = [];
  const dailyConfig = withoutWeb ? {
    async resolve() {
      return {
        base: "core",
        preset: { id: "daily", profileId: "daily" },
        overlays: [{ id: "orchestration-readonly", type: "hard" }],
        hardOverlays: ["orchestration-readonly"],
        softOverlays: [],
        models: { default: { model: "inherit", thinking: "inherit", fallbackModels: [] }, roles: {} },
        pricingOverrides: {},
        budget: { maxConcurrency: 2, maxChildren: 8, maxDepth: 1, maxWallSeconds: 1800, maxTotalTokens: 50000, maxCostUsd: 0.25, maxTurnsPerChild: 8, maxToolCallsPerChild: 16, maxTotalToolCalls: 64, maxOutputBytesPerChild: 65536, maxTotalOutputBytes: 262144, maxGoalRevisions: 4 },
        source: { global: "test", project: "NOT_CONFIGURED", perRun: "none" },
      };
    },
  } : undefined;
  const composer = await createSessionRuntimeComposer({
    pi: { events: { on() { throw new Error("injected transport owns events"); }, emit() {} } },
    rootDir,
    configRoot,
    getContext: () => ctx,
    dependencies: {
      ...(dailyConfig ? { dailyConfig } : {}),
      transport: automaticTransport(requests),
      subagentsPackage: { root: configRoot, manifest: { name: "pi-subagents", version: "0.45.2" } },
      ...(withoutWeb ? {} : {
        webPackage: {
          root: webRoot,
          manifest: { name: "pi-web-access", version: "0.20.0", pi: { extensions: ["./index.ts"] } },
        },
      }),
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
  assert.match(researcher, /subagentOnlyExtensions: .*safe-web-extension\.mjs/u);
  assert.match(researcher, /tools: .*web_search/u);
  assert.doesNotMatch(researcher, /^tools:.*(?:bash|edit|write)/mu);
  const runtimeRoot = path.dirname(extraRoot);
  const webConfig = JSON.parse(await fs.readFile(path.join(runtimeRoot, "web-config", "web-search.json"), "utf8"));
  assert.deepEqual(webConfig, { allowBrowserCookies: false, autoOpenBrowser: false, curatorRemote: false, workflow: "none", ssrf: { allowRanges: [], trustEnvProxy: false } });
  const wrapper = await fs.readFile(path.join(runtimeRoot, "safe-web-extension.mjs"), "utf8");
  assert.match(wrapper, /process\.env\.PI_CODING_AGENT_DIR/u);
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
  const record = await composer.recordStore.require(planned.runId);
  assert.equal(record.status, "completed");
  assert.equal(record.input.task, "Review package metadata without changes.");
  assert.equal(record.artifacts.length, 1);
});

test("dynamic SwarmGoal uses an LLM planner concept but parent-compiles two immutable read-only revisions", async (t) => {
  const { composer } = await harness(t);
  const entry = await createSwarmGoalRegistry({ rootDir }).resolve("research-release-goal");
  const objective = { ref: entry.definition.objective.ref, digest: entry.definition.objective.digest, input: { task: "Research the release evidence." } };
  const authorization = createHumanGoalAuthorization(entry.definition, { objective, nonce: "session-goal-test" });
  const webPlan = await composer.webAuthorizer.plan({ runId: "session-goal-run", roles: ["researcher", "source-verifier"], objectiveDigest: objective.digest, budget: composer.configuration.budget });
  await composer.webAuthorizer.grant(webPlan);
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
  assert.equal((await composer.recordStore.require("session-goal-run")).status, "completed");
  assert.equal((await composer.recordStore.require("session-goal-run:r0")).status, "completed");
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
  assert.equal((await composer.recordStore.require("ultra-agent-test")).status, "completed");

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

test("Ultra dynamic Goal reuses the Goal fresh verifier and stays within eight children", async (t) => {
  const { composer, requests } = await harness(t);
  const strategy = (await createUltraRunRegistry({ rootDir }).resolve("ultra-deep")).definition;
  const request = {
    id: "ultra-goal-test",
    taskDigest: digestWorkflowValue("dynamic goal task"),
    complexity: 90,
    itemCount: 4,
    homogeneous: false,
    dynamicGoal: true,
    mutation: "none",
    risk: "high",
    origin: { kind: "human", requestDigest: digestWorkflowValue("human dynamic goal") },
    preferredGoal: "research-release-goal",
  };
  const plan = composer.ultraRouter.plan(strategy, request);
  const webPlan = await composer.webAuthorizer.plan({ runId: request.id, roles: ["researcher", "source-verifier"], objectiveDigest: request.taskDigest, budget: composer.configuration.budget });
  await composer.webAuthorizer.grant(webPlan);
  const result = await composer.ultraRouter.run(strategy, request, {
    authorization: createUltraRunAuthorization(plan, "ultra-goal-human-1"),
    input: { task: "Research and verify the dynamic goal." },
  });
  assert.equal(result.result.status, "completed", JSON.stringify(result));
  assert.equal(result.result.verification.contextMode, "fresh");
  assert.equal(requests.length, 8);
  assert.equal((await composer.recordStore.require(request.id)).status, "completed");
});

test("Ultra BatchSwarm route leaves one of eight child slots for fresh verification", async (t) => {
  const { composer, requests } = await harness(t);
  const strategy = (await createUltraRunRegistry({ rootDir }).resolve("ultra-deep")).definition;
  assert.equal(strategy.routePolicy.batchMinItems, 7);
  const request = {
    id: "ultra-batch-test",
    taskDigest: digestWorkflowValue("homogeneous seven item task"),
    complexity: 50,
    itemCount: 7,
    homogeneous: true,
    dynamicGoal: false,
    mutation: "none",
    risk: "low",
    origin: { kind: "human", requestDigest: digestWorkflowValue("human homogeneous task") },
    preferredBatch: "review-items",
  };
  const input = { artifacts: { items: Array.from({ length: 7 }, (_, index) => ({ itemId: `item-${index + 1}`, path: `fixture-${index + 1}.txt` })) } };
  const result = await composer.ultraRouter.run(strategy, request, { input });
  assert.equal(result.plan.route, "batch-swarm");
  assert.equal(result.result.status, "completed", JSON.stringify(result));
  assert.equal(result.result.scale.observedAssignments, 8);
  assert.equal(requests.length, 8);
});

test("composer without Web keeps inherited agent directories, truncates oversized raw artifacts, and disposes idempotently", async (t) => {
  const inherited = path.join(os.tmpdir(), "existing-agent-dir");
  const { composer } = await harness(t, { withoutWeb: true, inheritedExtraAgentDirs: inherited });
  assert.deepEqual(composer.configuration.hardOverlays, ["orchestration-readonly"]);
  assert.equal(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS, inherited);
  const ref = await composer.artifactStore.publish({
    id: "truncate-artifact",
    producer: { runId: "truncate-run", revision: 0, nodeId: "truncate-node", attemptId: "truncate-attempt" },
    mediaType: "application/json",
    contents: "x".repeat(composer.configuration.budget.maxTotalOutputBytes + 1),
    provenance: { sourceDigest: SHA_A, policyDigest: SHA_B, redaction: "bounded" },
  });
  const stored = JSON.parse((await composer.artifactStore.read(ref)).toString("utf8"));
  assert.equal(stored.truncated, true);
  assert.equal(stored.originalBytes, composer.configuration.budget.maxTotalOutputBytes + 1);
  assert.equal((await composer.dispose()).status, "DISPOSED");
  assert.equal((await composer.dispose()).status, "DISPOSED");
  assert.equal(process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS, inherited);
});
