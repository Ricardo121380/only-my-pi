import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentTemplate,
  digestValue,
} from "../packages/subagents/domain/index.mjs";
import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";
import {
  assertSwarmGoalDefinition,
  budgetLedgerEnvelopeFromV2,
  createHumanGoalAuthorization,
  createSwarmGoalController,
} from "../packages/subagents/swarm-goal/index.mjs";

const digest = (value) => digestValue(value);

function template(id, { writer = false, web = false } = {}) {
  const allow = writer ? ["edit", "read", "write"] : web ? ["read", "web"] : ["read"];
  return createAgentTemplate({
    id,
    version: "1.0.0",
    backendAgentId: `omp-${id}`,
    sourceHash: digest({ id, source: true }),
    promptHash: digest({ id, prompt: true }),
    tools: { allow, deny: writer ? [] : ["bash", "edit", "write"] },
    requiredCapabilities: web ? ["web-access", "workspace-read"] : ["workspace-read"],
    policyCeiling: {
      workspace: writer ? "managed-worktree" : "shared-read-only",
      mutation: writer ? "guarded" : "none",
      approval: writer ? "ask" : "deny",
      egress: {
        web: web ? "allow-listed" : "deny",
        mcp: "deny",
        provider: "inherit",
        extension: "deny",
      },
    },
    modelRole: id === "verifier" ? "fast" : "deep",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    writer,
    continuable: !["synthesizer", "verifier"].includes(id),
    resumable: true,
    timeoutMs: 10_000,
    redaction: { reasoning: "omit" },
  });
}

function goal(overrides = {}) {
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/swarm-goal-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    kind: "swarm-goal",
    id: "research-release-goal",
    version: "1.0.0",
    objective: {
      ref: "objectives/research-release.md",
      digest: digest("research-release-objective"),
    },
    authority: {
      allowedAgentTemplates: ["researcher", "source-verifier", "synthesizer", "verifier"],
      budgetRef: "preview-read-only",
      maxPlanRevisions: 4,
      maxAgentSpecs: 8,
      mutation: "none",
      egress: "allow-listed",
    },
    roles: {
      synthesizerTemplate: "synthesizer",
      verifierTemplate: "verifier",
      minimumDistinctAgentSpecs: 3,
    },
    convergence: {
      coverageTarget: 0.9,
      noProgressWindow: 2,
      freshVerifierRequired: true,
    },
    outputSchemaRef: "research-result",
    ...overrides,
  };
}

function policy({ web = false, writer = false } = {}) {
  return {
    workspace: writer ? "managed-worktree" : "shared-read-only",
    mutation: writer ? "guarded" : "none",
    egress: { web: web ? "allow" : "deny", mcp: "deny", provider: "allow" },
    tools: { allow: writer ? ["edit", "read", "write"] : web ? ["read", "web"] : ["read"], deny: writer ? [] : ["bash", "edit", "write"] },
  };
}

function agentNode(id, specId, { web = false, writer = false } = {}) {
  return {
    kind: "agent",
    id,
    agentTemplateRef: specId,
    assignment: { taskTemplateRef: `task-${id}` },
    outputSchemaRef: "research-result",
    policy: policy({ web, writer }),
    budget: { maxAttempts: 1, timeoutMs: 1_000, maxOutputBytes: 4_096, maxTokens: null, maxCostUsd: null },
    cache: { mode: writer ? "never" : "content-addressed", keyInputs: ["assignment"] },
    idempotency: writer ? "receipt" : "content-addressed",
  };
}

function workflow(id, flow, { web = true, writer = false } = {}) {
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id,
    version: "2.0.0",
    description: `dynamic revision ${id}`,
    policy: policy({ web, writer }),
    budget: {
      maxNodes: 12,
      maxParallel: 4,
      maxDepth: 8,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: 20_000,
      maxOutputBytes: 65_536,
      maxAssignments: 8,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow,
  };
}

function intent(id, templateId) {
  return {
    id,
    templateId,
    specialization: {
      promptDigest: digest({ id, specialization: true }),
      promptRef: `objectives/${id}.md`,
    },
  };
}

function proposalZero() {
  return {
    revision: 0,
    reason: "initial evidence fan-out",
    agentIntents: [
      intent("research-a", "researcher"),
      intent("source-check-a", "source-verifier"),
      intent("synthesize-a", "synthesizer"),
      intent("verify-a", "verifier"),
    ],
    workflowDefinition: workflow("goal-revision-zero", {
      kind: "sequence",
      steps: [
        { kind: "parallel", branches: [agentNode("discover", "research-a", { web: true }), agentNode("source-check", "source-check-a", { web: true })] },
        agentNode("synthesize", "synthesize-a"),
        agentNode("verify", "verify-a"),
      ],
    }),
    reuse: [],
    metrics: {
      coverage: 0.6,
      progress: 0.6,
      criticalPathMs: 3_000,
      coveredDimensions: ["primary-sources"],
      remainingDimensions: ["edge-cases"],
    },
    quality: {
      synthesizerAgentSpecId: "synthesize-a",
      verifierAgentSpecId: "verify-a",
      makerAgentSpecIds: ["research-a", "source-check-a"],
      verifierContextMode: "fresh",
    },
    decision: "replan",
  };
}

function proposalOne(firstResultDigest) {
  return {
    revision: 1,
    reason: "close remaining edge-case coverage",
    agentIntents: [
      intent("research-b", "researcher"),
      intent("synthesize-b", "synthesizer"),
      intent("verify-b", "verifier"),
    ],
    workflowDefinition: workflow("goal-revision-one", {
      kind: "sequence",
      steps: [
        agentNode("edge-case", "research-b", { web: true }),
        agentNode("synthesize-next", "synthesize-b"),
        agentNode("verify-next", "verify-b"),
      ],
    }),
    reuse: [{ nodeId: "discover", sourceRevision: 0, resultDigest: firstResultDigest, artifactRefs: [] }],
    metrics: {
      coverage: 1,
      progress: 0.4,
      criticalPathMs: 3_000,
      coveredDimensions: ["edge-cases", "primary-sources"],
      remainingDimensions: [],
    },
    quality: {
      synthesizerAgentSpecId: "synthesize-b",
      verifierAgentSpecId: "verify-b",
      makerAgentSpecIds: ["research-b"],
      verifierContextMode: "fresh",
    },
    decision: "complete",
  };
}

function budgetEnvelope() {
  const limits = {
    maxWorkflowRuns: 4,
    maxPhases: 8,
    maxPlanRevisions: 4,
    maxActiveChildren: 8,
    maxQueuedAssignments: 32,
    maxTotalAssignments: 32,
    maxPlanExpansionDepth: 4,
    maxIterations: 8,
    noProgressWindow: 2,
    maxRetries: 2,
    maxElapsedMs: 80_000,
    maxTurns: 100,
    maxToolCalls: 100,
    maxTokens: null,
    maxCost: null,
    maxRawOutputBytes: 262_144,
    maxArtifactBytes: 1_048_576,
    maxWriterWorktrees: 0,
  };
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/budget-envelope-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    kind: "budget-envelope",
    id: "preview-read-only",
    hard: limits,
    soft: limits,
    metering: { tokens: "UNAVAILABLE", cost: "UNAVAILABLE" },
    budgetHash: digest(limits),
  };
}

async function harness(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-swarm-goal-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 19);
  let sequence = 0;
  const clock = () => new Date(now += 5);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const storedEventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock, idFactory });
  const eventJournal = options.wrapEventJournal?.(storedEventJournal) ?? storedEventJournal;
  const budgetLedger = createBudgetLedger({
    eventJournal,
    envelope: budgetLedgerEnvelopeFromV2(budgetEnvelope()),
    metering: { tokens: false, cost: false },
  });
  const templates = new Map([
    ["researcher", template("researcher", { web: true })],
    ["source-verifier", template("source-verifier", { web: true })],
    ["synthesizer", template("synthesizer")],
    ["verifier", template("verifier")],
    ["implementer", template("implementer", { writer: true })],
  ]);
  const controller = createSwarmGoalController({
    eventJournal,
    budgetLedger,
    planner: options.planner,
    executeRevision: options.executeRevision,
    async resolveAgentTemplate(id) { return templates.get(id); },
    clock,
    idFactory,
  });
  return { controller, eventJournal: storedEventJournal, budgetLedger, templates };
}

function objective(goalDefinition) {
  return { ref: goalDefinition.objective.ref, digest: goalDefinition.objective.digest, input: { task: "research" } };
}

function authorization(goalDefinition, nonce = "human-request-1") {
  return createHumanGoalAuthorization(goalDefinition, { objective: objective(goalDefinition), nonce });
}

function completedExecution(plan, proposal, options = {}) {
  const nodes = Object.fromEntries(plan.nodes.map((node) => [node.id, {
    nodeId: node.id,
    outcome: "completed",
    resultDigest: digest({ plan: plan.planDigest, node: node.id }),
  }]));
  return {
    projection: {
      runId: options.childRunId,
      planDigest: plan.planDigest,
      activeRevision: plan.revision.number,
      status: "completed",
      approval: options.approval ?? null,
      nodes,
    },
    verification: {
      verdict: options.verdict ?? "pass",
      agentSpecId: proposal.quality.verifierAgentSpecId,
      contextMode: "fresh",
      receiptDigest: digest({ plan: plan.planDigest, verifier: proposal.quality.verifierAgentSpecId }),
    },
    usage: { workflowRuns: 1, planRevisions: 1, assignments: plan.nodes.length, elapsedMs: 100, rawOutputBytes: 512 },
  };
}

test("SwarmGoal runs immutable heterogeneous revisions and reuses settled read-only work without rerunning it", async (t) => {
  const goalDefinition = goal();
  let firstResultDigest;
  let plannerCalls = 0;
  const executedPlans = [];
  const childRunIds = [];
  const { controller, eventJournal, budgetLedger } = await harness(t, {
    async planner({ revision }) {
      plannerCalls += 1;
      return revision === 0 ? proposalZero() : proposalOne(firstResultDigest);
    },
    async executeRevision({ childRunId, plan, proposal }) {
      executedPlans.push(plan);
      childRunIds.push(childRunId);
      const result = completedExecution(plan, proposal, { childRunId });
      if (plan.revision.number === 0) firstResultDigest = result.projection.nodes.discover.resultDigest;
      return result;
    },
  });

  const result = await controller.run(goalDefinition, {
    runId: "goal-run-replan",
    objective: objective(goalDefinition),
    authorization: authorization(goalDefinition),
    input: { task: "research" },
  });
  assert.equal(result.status, "completed");
  assert.equal(result.revisions.length, 2);
  assert.equal(plannerCalls, 2);
  assert.deepEqual(childRunIds, ["goal-run-replan:r0", "goal-run-replan:r1"]);
  assert.equal(executedPlans[0].revision.number, 0);
  assert.equal(executedPlans[1].revision.number, 1);
  assert.equal(executedPlans[1].revision.parentPlanDigest, executedPlans[0].planDigest);
  assert.ok(result.revisions[0].proposal.agentSpecs.length >= 3);
  assert.ok(new Set(result.revisions[0].proposal.agentSpecs.map((spec) => spec.templateId)).size >= 3);
  assert.equal(executedPlans[1].nodes.some((node) => node.id === "discover"), false);
  assert.equal(result.revisions[1].proposal.reuse[0].resultDigest, firstResultDigest);
  assert.equal((await eventJournal.verify("goal-run-replan")).ok, true);
  const budget = await budgetLedger.snapshot("goal-run-replan");
  assert.equal(budget.committed.workflowRuns, 2);
  assert.equal(budget.committed.planRevisions, 2);
});

test("SwarmGoal persists a proposal before execution and resumes the same child run without replanning", async (t) => {
  const goalDefinition = goal({
    authority: { ...goal().authority, maxPlanRevisions: 1 },
    convergence: { ...goal().convergence, noProgressWindow: 1 },
  });
  const single = proposalZero();
  single.metrics.coverage = 1;
  single.metrics.remainingDimensions = [];
  single.decision = "complete";
  let plannerCalls = 0;
  let executions = 0;
  const { controller } = await harness(t, {
    async planner() { plannerCalls += 1; return single; },
    async executeRevision({ childRunId, plan, proposal }) {
      executions += 1;
      if (executions === 1) return { projection: { runId: childRunId, planDigest: plan.planDigest, activeRevision: 0, status: "awaiting-approval", nodes: {} } };
      return completedExecution(plan, proposal, { childRunId });
    },
  });
  const options = {
    runId: "goal-run-resume",
    objective: objective(goalDefinition),
    authorization: authorization(goalDefinition, "human-request-resume"),
  };
  const waiting = await controller.run(goalDefinition, options);
  assert.equal(waiting.status, "awaiting-approval");
  const completed = await controller.run(goalDefinition, options);
  assert.equal(completed.status, "completed");
  assert.equal(plannerCalls, 1);
  assert.equal(executions, 2);
  assert.equal(completed.revisions[0].childRunId, "goal-run-resume:r0");
});

test("SwarmGoal reconstructs a terminal decision after a crash between revision settlement and root settlement", async (t) => {
  const goalDefinition = goal({
    authority: { ...goal().authority, maxPlanRevisions: 1 },
    convergence: { ...goal().convergence, noProgressWindow: 1 },
  });
  const single = proposalZero();
  single.metrics.coverage = 1;
  single.metrics.remainingDimensions = [];
  single.decision = "complete";
  let plannerCalls = 0;
  let executionCalls = 0;
  let crashOnce = true;
  const { controller } = await harness(t, {
    wrapEventJournal(journal) {
      return Object.freeze({
        ...journal,
        async append(runId, event, options) {
          if (event.type === "RunCompleted" && crashOnce) {
            crashOnce = false;
            const error = new Error("simulated root-settlement crash");
            error.code = "SIMULATED_CRASH";
            throw error;
          }
          return journal.append(runId, event, options);
        },
      });
    },
    async planner() { plannerCalls += 1; return single; },
    async executeRevision({ childRunId, plan, proposal }) {
      executionCalls += 1;
      return completedExecution(plan, proposal, { childRunId });
    },
  });
  const options = {
    runId: "goal-root-settlement-crash",
    objective: objective(goalDefinition),
    authorization: authorization(goalDefinition, "human-request-root-crash"),
  };
  await assert.rejects(controller.run(goalDefinition, options), (error) => error?.code === "SIMULATED_CRASH");
  const recovered = await controller.run(goalDefinition, options);
  assert.equal(recovered.status, "completed");
  assert.equal(plannerCalls, 1);
  assert.equal(executionCalls, 1);
  assert.equal(recovered.revisions[0].status, "settled");
});

test("SwarmGoal charges worst-case and fails durably when a revision exceeds its reservation", async (t) => {
  const goalDefinition = goal({
    authority: { ...goal().authority, maxPlanRevisions: 1 },
    convergence: { ...goal().convergence, noProgressWindow: 1 },
  });
  const single = proposalZero();
  single.metrics.coverage = 1;
  single.metrics.remainingDimensions = [];
  single.decision = "complete";
  const { controller, budgetLedger } = await harness(t, {
    async planner() { return single; },
    async executeRevision({ childRunId, plan, proposal }) {
      const result = completedExecution(plan, proposal, { childRunId });
      result.usage.rawOutputBytes = plan.budget.maxOutputBytes + 1;
      return result;
    },
  });
  const options = {
    runId: "goal-budget-overrun",
    objective: objective(goalDefinition),
    authorization: authorization(goalDefinition, "human-request-overrun"),
  };
  await assert.rejects(controller.run(goalDefinition, options), (error) => error?.code === "SWARM_GOAL_BUDGET_OVERRUN");
  const recovered = await controller.inspect(options.runId);
  assert.equal(recovered.status, "failed");
  assert.equal(recovered.terminal.code, "SWARM_GOAL_BUDGET_OVERRUN");
  const budget = await budgetLedger.snapshot(options.runId);
  assert.equal(budget.committed.rawOutputBytes, single.workflowDefinition.budget.maxOutputBytes);
});

test("SwarmGoal fails closed without human-origin authorization and when the fresh verifier fails", async (t) => {
  const goalDefinition = goal({
    authority: { ...goal().authority, maxPlanRevisions: 1 },
    convergence: { ...goal().convergence, noProgressWindow: 1 },
  });
  const single = proposalZero();
  single.metrics.coverage = 1;
  single.metrics.remainingDimensions = [];
  single.decision = "complete";
  const { controller } = await harness(t, {
    async planner() { return single; },
    async executeRevision({ childRunId, plan, proposal }) { return completedExecution(plan, proposal, { childRunId, verdict: "fail" }); },
  });
  await assert.rejects(
    controller.run(goalDefinition, { runId: "goal-no-human", objective: objective(goalDefinition) }),
    (error) => error?.code === "SWARM_GOAL_HUMAN_AUTHORIZATION_REQUIRED",
  );
  const result = await controller.run(goalDefinition, {
    runId: "goal-verifier-fails",
    objective: objective(goalDefinition),
    authorization: authorization(goalDefinition, "human-request-verifier"),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.terminal.code, "SWARM_GOAL_FINAL_VERIFIER_FAILED");
});

test("SwarmGoal definition and proposal reject weak roles, reuse forgery, and mutating execution without exact approval", async (t) => {
  assert.throws(
    () => assertSwarmGoalDefinition(goal({ roles: { synthesizerTemplate: "synthesizer", verifierTemplate: "synthesizer", minimumDistinctAgentSpecs: 3 } })),
    (error) => error?.code === "SWARM_GOAL_ROLE_CONFLICT",
  );
  assert.throws(
    () => assertSwarmGoalDefinition(goal({ version: "latest" })),
    (error) => error?.code === "INVALID_SWARM_GOAL",
  );

  const guardedGoal = goal({
    authority: {
      allowedAgentTemplates: ["implementer", "synthesizer", "verifier"],
      budgetRef: "preview-read-only",
      maxPlanRevisions: 1,
      maxAgentSpecs: 3,
      mutation: "guarded",
      egress: "deny",
    },
    convergence: { coverageTarget: 1, noProgressWindow: 1, freshVerifierRequired: true },
  });
  const guardedProposal = {
    revision: 0,
    reason: "guarded writer with fresh verification",
    agentIntents: [intent("writer-a", "implementer"), intent("synth-a", "synthesizer"), intent("verify-a", "verifier")],
    workflowDefinition: workflow("guarded-revision", {
      kind: "sequence",
      steps: [agentNode("implement", "writer-a", { writer: true }), agentNode("synthesize", "synth-a"), agentNode("verify", "verify-a")],
    }, { web: false, writer: true }),
    reuse: [],
    metrics: { coverage: 1, progress: 1, criticalPathMs: 3_000, coveredDimensions: ["implementation"], remainingDimensions: [] },
    quality: { synthesizerAgentSpecId: "synth-a", verifierAgentSpecId: "verify-a", makerAgentSpecIds: ["writer-a"], verifierContextMode: "fresh" },
    decision: "complete",
  };
  const { controller } = await harness(t, {
    async planner() { return guardedProposal; },
    async executeRevision({ childRunId, plan, proposal }) { return completedExecution(plan, proposal, { childRunId }); },
  });
  await assert.rejects(
    controller.run(guardedGoal, {
      runId: "goal-mutating-unapproved",
      objective: objective(guardedGoal),
      authorization: authorization(guardedGoal, "human-request-writer"),
    }),
    (error) => error?.code === "SWARM_GOAL_REVISION_APPROVAL_REQUIRED",
  );

  let firstResultDigest;
  const { controller: reuseController } = await harness(t, {
    async planner({ revision }) {
      if (revision === 0) return proposalZero();
      const forged = proposalOne(firstResultDigest);
      forged.reuse[0].artifactRefs = ["forged-artifact"];
      return forged;
    },
    async executeRevision({ childRunId, plan, proposal }) {
      const result = completedExecution(plan, proposal, { childRunId });
      firstResultDigest = result.projection.nodes.discover?.resultDigest ?? firstResultDigest;
      return result;
    },
  });
  await assert.rejects(
    reuseController.run(goal(), {
      runId: "goal-reuse-forgery",
      objective: objective(goal()),
      authorization: authorization(goal(), "human-request-reuse-forgery"),
    }),
    (error) => error?.code === "SWARM_GOAL_REUSE_UNPROVEN",
  );
});
