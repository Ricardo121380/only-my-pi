import fs from "node:fs";
import path from "node:path";

import { createAgentControlService } from "../../control-service/agent-service.mjs";
import { createDailyConfigService } from "../../daily-config/index.mjs";
import {
  agentTemplateFromRegistryEntry,
  createAgentRunHandle,
  createResolvedAgentSpec,
  createTaskAssignment,
  digestValue,
} from "../domain/index.mjs";
import { createHumanGoalAuthorization } from "../swarm-goal/index.mjs";
import { createSwarmGoalRegistry } from "../swarm-goal/registry.mjs";
import { createUltraRunAuthorization } from "../ultra-run/index.mjs";
import { createUltraRunRegistry } from "../ultra-run/registry.mjs";
import { compileWorkflowDefinition } from "../workflow/plan-compiler/index.mjs";
import { createSessionRuntimeComposer } from "../runtime/session-composer.mjs";

export const M8_LIVE_REQUEST_ENV = "OMP_M8_LIVE_ACCEPTANCE_REQUEST";
export const M8_LIVE_RECORD_TYPE = "omp_m8_live_acceptance_record_v1";
export const M8_LIVE_ERROR_TYPE = "omp_m8_live_acceptance_error_v1";

const MAX_REQUEST_BYTES = 64 * 1024;
const SOURCE_COMMIT = /^[a-f0-9]{40}$/u;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const EXPECTED_REQUEST_KEYS = Object.freeze(["configRoot", "formatVersion", "model", "phase", "repositoryRoot", "runNonce", "sourceCommit", "webAuthorized"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readRequest() {
  const requestPath = process.env[M8_LIVE_REQUEST_ENV];
  if (typeof requestPath !== "string" || !path.isAbsolute(requestPath)) fail("M8_LIVE_REQUEST_UNAVAILABLE", "M8 live request path is unavailable");
  const stat = fs.lstatSync(requestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_REQUEST_BYTES) fail("M8_LIVE_REQUEST_INVALID", "M8 live request must be a bounded regular file");
  const request = JSON.parse(fs.readFileSync(requestPath, "utf8"));
  if (!exactKeys(request, EXPECTED_REQUEST_KEYS)
    || request.formatVersion !== 1
    || !["main", "resume"].includes(request.phase)
    || !SOURCE_COMMIT.test(request.sourceCommit ?? "")
    || !SAFE_ID.test(request.runNonce ?? "")
    || request.webAuthorized !== true
    || !plain(request.model)
    || JSON.stringify(Object.keys(request.model).sort()) !== JSON.stringify(["id", "provider"])) {
    fail("M8_LIVE_REQUEST_INVALID", "M8 live request shape is invalid");
  }
  for (const field of ["repositoryRoot", "configRoot"]) {
    if (typeof request[field] !== "string" || !path.isAbsolute(request[field])) fail("M8_LIVE_REQUEST_INVALID", `${field} is invalid`);
    const real = fs.realpathSync(request[field]);
    const rootStat = fs.lstatSync(real);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("M8_LIVE_REQUEST_INVALID", `${field} must be a real directory`);
    request[field] = real;
  }
  if (process.env.PI_CODING_AGENT_DIR !== request.configRoot) fail("M8_LIVE_CONFIG_DRIFT", "Pi config root differs from the acceptance request");
  if (!contained(request.configRoot, request.configRoot)) fail("M8_LIVE_CONFIG_DRIFT", "Pi config root is invalid");
  return Object.freeze(request);
}

function publicCode(cause) {
  return /^[A-Z][A-Z0-9_]{1,127}$/u.test(cause?.code ?? "") ? cause.code : "M8_LIVE_ACCEPTANCE_FAILED";
}

export function m8ProtectedToolCallLimit({ agentSpec, handle } = {}) {
  if (handle?.local?.runId?.startsWith("m8-goal-")) return 0;
  return ["researcher", "source-verifier"].includes(agentSpec?.templateId) ? 4 : 0;
}

export function m8ProtectedTurnLimit({ agentSpec, handle } = {}) {
  if (handle?.local?.runId?.startsWith("m8-goal-")) return 2;
  return ["researcher", "source-verifier"].includes(agentSpec?.templateId) ? 4 : 2;
}

function assertion(id, value) {
  return Object.freeze({ id, status: "PASS", digest: digestValue(value) });
}

function ensure(condition, code, message) {
  if (!condition) fail(code, message);
}

function taskNode(id, role, needs = []) {
  const policy = {
    workspace: "shared-read-only",
    mutation: "none",
    egress: { web: "deny", mcp: "deny", provider: "allow" },
    tools: { allow: ["read"], deny: ["bash", "edit", "write", "web"] },
  };
  return {
    kind: "agent",
    id,
    agentTemplateRef: role,
    assignment: { taskTemplateRef: `m8-${id}` },
    outputSchemaRef: null,
    policy,
    budget: { maxAttempts: 1, timeoutMs: 300_000, maxOutputBytes: 65_536, maxTokens: 6_000, maxCostUsd: 0.03 },
    cache: { mode: "content-addressed", keyInputs: ["assignment", "dependencies"] },
    idempotency: "content-addressed",
    ...(needs.length ? { needs } : {}),
  };
}

function sequentialPlan(id, roles) {
  const policy = {
    workspace: "shared-read-only",
    mutation: "none",
    egress: { web: "deny", mcp: "deny", provider: "allow" },
    tools: { allow: ["read"], deny: ["bash", "edit", "write", "web"] },
  };
  return compileWorkflowDefinition({
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id,
    version: "2.0.0",
    description: "M8 protected live read-only acceptance workflow.",
    policy,
    budget: { maxNodes: roles.length, maxParallel: 1, maxDepth: roles.length, maxAttemptsPerNode: 1, maxWallTimeMs: 900_000, maxOutputBytes: 65_536 * roles.length, maxAssignments: roles.length, maxTokens: 6_000 * roles.length, maxCostUsd: 0.03 * roles.length },
    flow: { kind: "sequence", steps: roles.map((role, index) => taskNode(`node-${index + 1}`, role)) },
    terminalNodeId: `node-${roles.length}`,
  });
}

function usageAccumulator() {
  const totals = { tokens: 0, costUsd: 0, toolCalls: 0, meteredTerminals: 0 };
  return {
    charge(terminal) {
      const usage = terminal?.completion?.usage;
      ensure(Number.isSafeInteger(usage?.tokens) && usage.tokens >= 0, "M8_USAGE_UNAVAILABLE", "terminal token usage is unavailable");
      ensure(Number.isFinite(usage?.costUsd) && usage.costUsd >= 0, "M8_USAGE_UNAVAILABLE", "terminal cost usage is unavailable");
      totals.tokens += usage.tokens;
      totals.costUsd += usage.costUsd;
      totals.toolCalls += Number.isSafeInteger(usage.toolCalls) ? usage.toolCalls : 0;
      totals.meteredTerminals += 1;
      return usage;
    },
    value() { return Object.freeze({ ...totals, costUsd: Number(totals.costUsd.toFixed(12)) }); },
  };
}

async function runAgent(composer, request) {
  const service = createAgentControlService({ rootDir: request.repositoryRoot, orchestration: composer.coordinator, configurationProvider: composer.configurationProvider });
  const runId = `m8-agent-${request.runNonce}`;
  const input = { task: "Lifecycle-only protected probe. Do not call file, network, shell, or delegation tools. Fixture facts supplied by the parent: package name only-my-pi-m8-live-fixture, private=true, version=0.0.0, README describes a bounded read-only lifecycle fixture. Return a concise structured verdict using only these facts and make no unsupported claims.", scope: ["package.json", "README.md"], acceptance: ["structured verdict", "no mutation", "no external tool calls"] };
  const plan = await service.dispatch({ subcommand: "plan", agentId: "reviewer", runId, input });
  ensure(plan.ok === true, plan.code ?? "M8_AGENT_PLAN_FAILED", "M8 Agent plan failed");
  const result = await service.dispatch({ subcommand: "run", agentId: "reviewer", runId, input: plan.input, yes: true, expectedPlanDigest: plan.plan.planDigest, expectedExecutionDigest: plan.executionEnvelope.executionEnvelopeDigest });
  ensure(result.status === "AGENT_COMPLETED", result.code ?? "M8_AGENT_FAILED", "M8 Agent did not complete");
  const node = result.state.nodes.agent;
  ensure(node.outcome === "completed" && node.artifactRefs.length === 1, "M8_AGENT_ARTIFACT_MISSING", "M8 Agent artifact is missing");
  await composer.artifactStore.read(node.artifacts[0]);
  return assertion("agent-terminal", { runId, planDigest: plan.plan.planDigest, resultDigest: node.resultDigest, artifact: node.artifacts[0].digest });
}

async function runBatch(composer, request) {
  const runId = `m8-batch-${request.runNonce}`;
  const input = { artifacts: { items: [{ itemId: "package", path: "package.json" }, { itemId: "readme", path: "README.md" }] } };
  const plan = await composer.batchControl.dispatch({ subcommand: "plan", batchId: "review-items", runId, input });
  ensure(plan.ok === true && plan.expansion.itemCount === 2, plan.code ?? "M8_BATCH_PLAN_FAILED", "M8 BatchSwarm plan failed");
  const result = await composer.batchControl.dispatch({ subcommand: "run", batchId: "review-items", runId, input: plan.input, yes: true, expectedPlanDigest: plan.plan.planDigest, expectedExecutionDigest: plan.executionEnvelope.executionEnvelopeDigest });
  ensure(result.status === "BATCH_SWARM_COMPLETED", result.code ?? "M8_BATCH_FAILED", "M8 BatchSwarm did not complete");
  const batch = result.state.nodes.batch.batch;
  ensure(batch.itemCount === 2 && batch.items.every((item) => item.status === "succeeded"), "M8_BATCH_TERMINALS_MISSING", "M8 BatchSwarm terminal set is incomplete");
  return assertion("batch-swarm-terminal", { runId, planDigest: plan.plan.planDigest, items: batch.items.map(({ index, itemId, status }) => ({ index, itemId, status })) });
}

async function runWorkflow(composer, request) {
  const runId = `m8-workflow-${request.runNonce}`;
  const plan = sequentialPlan("m8-live-artifact-flow", ["reviewer", "synthesizer", "verifier"]);
  const state = await composer.coordinator.execute(plan, { runId, input: { task: "Review, synthesize, and independently verify repository release metadata without mutation." } });
  ensure(state.status === "completed", "M8_WORKFLOW_FAILED", "M8 Workflow did not complete");
  const first = state.nodes["node-1"];
  ensure(first.artifactRefs.length === 1 && state.nodes["node-2"].outcome === "completed" && state.nodes["node-3"].outcome === "completed", "M8_WORKFLOW_ARTIFACT_FLOW_MISSING", "M8 Workflow ArtifactRef flow is incomplete");
  const events = (await composer.eventJournal.read(runId)).events;
  const published = events.findIndex((event) => event.type === "NodeArtifactPublished" && event.nodeId === "node-1");
  const downstream = events.findIndex((event) => event.type === "NodeAdmitted" && event.nodeId === "node-2");
  ensure(published >= 0 && downstream > published, "M8_WORKFLOW_ARTIFACT_ORDER_INVALID", "M8 Workflow downstream admission preceded artifact publication");
  return assertion("workflow-artifact-flow", { runId, planDigest: plan.planDigest, firstArtifact: first.artifacts[0].digest, published, downstream, terminal: state.terminal });
}

async function grantWeb(composer, { runId, roles, objectiveDigest }) {
  const plan = await composer.webAuthorizer.plan({ runId, roles, objectiveDigest, budget: composer.configuration.budget, providerIds: [] });
  await composer.webAuthorizer.grant(plan);
  return plan;
}

async function runGoal(composer, request) {
  const runId = `m8-goal-${request.runNonce}`;
  const entry = await createSwarmGoalRegistry({ rootDir: request.repositoryRoot }).resolve("research-release-goal");
  const objective = { ref: entry.definition.objective.ref, digest: entry.definition.objective.digest, input: { task: "Research and verify the public release surface of only-my-pi using bounded public sources." } };
  await grantWeb(composer, { runId, roles: ["researcher", "source-verifier"], objectiveDigest: objective.digest });
  const authorization = createHumanGoalAuthorization(entry.definition, { objective, nonce: `m8-goal-${request.runNonce}` });
  const result = await composer.goalController.run(entry.definition, { runId, objective, authorization, input: objective.input });
  ensure(result.status === "completed" && result.revisions.length >= 2, "M8_GOAL_REPLAN_MISSING", "M8 SwarmGoal did not complete after a replan");
  ensure(result.revisions[0].proposal.decision === "replan" && result.revisions.at(-1).proposal.decision === "complete", "M8_GOAL_REPLAN_MISSING", "M8 SwarmGoal replan/complete sequence is invalid");
  return assertion("swarm-goal-replan", { runId, revisions: result.revisions.map((revision) => ({ revision: revision.revision, decision: revision.proposal.decision, planDigest: revision.proposal.plan.planDigest })), terminal: result.terminal });
}

async function runUltra(composer, request) {
  const strategy = (await createUltraRunRegistry({ rootDir: request.repositoryRoot }).resolve("ultra-deep")).definition;
  const lightRequest = { id: `m8-ultra-light-${request.runNonce}`, taskDigest: digestValue("M8 light review"), complexity: 10, itemCount: 1, homogeneous: false, dynamicGoal: false, mutation: "none", risk: "low", origin: { kind: "human", requestDigest: digestValue("M8 human light") } };
  const light = await composer.ultraRouter.run(strategy, lightRequest, { input: { task: "Perform a short read-only package metadata review." } });
  ensure(light.plan.route === "agent" && light.result.status === "completed" && light.result.verification?.contextMode === "fresh", "M8_ULTRA_LIGHT_FAILED", "M8 Ultra light route failed");
  const complexRequest = { ...lightRequest, id: `m8-ultra-complex-${request.runNonce}`, taskDigest: digestValue("M8 complex review"), complexity: 60, itemCount: 3, preferredWorkflow: "source-review-v2", origin: { kind: "human", requestDigest: digestValue("M8 human complex") } };
  const complex = await composer.ultraRouter.run(strategy, complexRequest, { input: { task: "Perform a multi-angle read-only release review and fresh verification." } });
  ensure(complex.plan.route === "workflow" && complex.result.status === "completed" && complex.result.verification?.contextMode === "fresh", "M8_ULTRA_COMPLEX_FAILED", "M8 Ultra complex route failed");
  return [
    assertion("ultra-agent-route", { planDigest: light.plan.planDigest, route: light.plan.route, verification: light.result.verification, scale: light.result.scale }),
    assertion("ultra-workflow-route", { planDigest: complex.plan.planDigest, route: complex.plan.route, verification: complex.result.verification, scale: complex.result.scale }),
  ];
}

async function runPublicWeb(composer, request, usage) {
  const runId = `m8-web-${request.runNonce}`;
  const objectiveDigest = digestValue("M8 official Pi project source lookup");
  await grantWeb(composer, { runId, roles: ["researcher"], objectiveDigest });
  const terminal = await composer.runDirectAgent({ role: "researcher", runId, nodeId: "web-research", task: "Use public Web search at least once. Find one official source for the Pi coding agent project, then return the required structured research result with source URL and gaps. Do not use browser cookies or private destinations." });
  const metering = usage.charge(terminal);
  ensure(metering.toolCalls >= 1, "M8_WEB_TOOL_NOT_OBSERVED", "M8 Web research completed without an observed tool call");
  return assertion("public-web", { runId, receiptId: terminal.receiptId, resultDigest: digestValue(terminal.result), toolCalls: metering.toolCalls });
}

async function runCancellation(composer, request, usage) {
  const entry = await composer.agentRegistry.resolve("reviewer");
  const agentSpec = createResolvedAgentSpec({ template: agentTemplateFromRegistryEntry(entry), runtimeMode: "REGISTERED_ROLES_ONLY" });
  const runId = `m8-cancel-${request.runNonce}`;
  const assignment = createTaskAssignment({
    assignmentId: `${runId}-assignment`,
    agentSpec,
    task: "Perform a detailed read-only review of all declared package metadata and return structured findings. Do not mutate files.",
    ownership: { writer: false, workspace: "shared-read-only", allowedPaths: [] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: [] },
    budget: { maxElapsedMs: 300_000, maxOutputBytes: 65_536, maxTokens: 6_000, maxCostUsd: 0.03 },
  });
  const handle = createAgentRunHandle({ runId, nodeId: "cancel-node", attemptId: "cancel-attempt", assignment, agentSpec });
  const launched = await composer.backend.launch({ handle, agentSpec, assignment, mode: "background" });
  let visible = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { const status = await composer.backend.status(launched.handle); if (status?.data?.runId) { visible = true; break; } } catch { /* child not visible yet */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  ensure(visible, "M8_CANCEL_NOT_VISIBLE", "M8 cancellation child did not become visible");
  const stopped = await composer.backend.stop(launched.handle);
  ensure(stopped?.terminal?.authoritative === true && stopped.terminal.outcome === "cancelled", "M8_CANCEL_UNPROVEN", "M8 cancellation lacks an authoritative cancelled terminal");
  usage.charge(stopped.terminal);
  return assertion("cancellation", { runId, receiptId: stopped.terminal.receiptId, outcome: stopped.terminal.outcome, processState: stopped.terminal.processTerminal?.state });
}

async function runAdmissionDenials(composer, request) {
  const items = Array.from({ length: 9 }, (_, index) => ({ itemId: `over-${index + 1}`, path: `over-${index + 1}.txt` }));
  const budget = await composer.batchControl.dispatch({ subcommand: "plan", batchId: "review-items", runId: `m8-budget-${request.runNonce}`, input: { artifacts: { items } } });
  ensure(budget.ok === false && budget.code === "BATCH_CHILD_BUDGET_EXCEEDED", "M8_BUDGET_BOUNDARY_MISSING", "M8 child budget did not fail closed before dispatch");
  let writerCode = null;
  try { await composer.runDirectAgent({ role: "implementer", runId: `m8-writer-${request.runNonce}`, nodeId: "writer", task: "Do not run." }); }
  catch (cause) { writerCode = cause?.code; }
  ensure(writerCode === "WRITER_UNAVAILABLE_IN_READONLY_MILESTONE", "M8_WRITER_DENIAL_MISSING", "M8 writer route was not denied");
  return [assertion("budget-boundary", { code: budget.code, itemCount: items.length }), assertion("writer-denial", { code: writerCode })];
}

async function prepareResume(composer, request) {
  const runId = `m8-resume-${request.runNonce}`;
  const plan = sequentialPlan("m8-live-resume", ["reviewer", "verifier"]);
  const input = { task: "Run a two-stage read-only review, pause after the first active child, and resume in a new Pi session." };
  const execution = composer.coordinator.execute(plan, { runId, input });
  let childStarted = false;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const events = (await composer.eventJournal.read(runId)).events;
      if (events.some((event) => event.type === "ChildStarted")) { childStarted = true; break; }
    } catch { /* journal not yet created */ }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  ensure(childStarted, "M8_RESUME_PREPARE_TIMEOUT", "M8 resume fixture child did not start");
  const pause = await composer.coordinator.pause(runId);
  ensure(pause.status === "PAUSE_REQUESTED", "M8_RESUME_PAUSE_FAILED", "M8 resume fixture could not request pause");
  const projection = await execution;
  ensure(projection.status === "paused", "M8_RESUME_PAUSE_FAILED", "M8 resume fixture did not reach paused state");
  return assertion("resume-prepared", { runId, planDigest: plan.planDigest, completedNodes: Object.values(projection.nodes).filter((node) => node.outcome === "completed").map((node) => node.nodeId).sort() });
}

export async function executeM8LiveMain(composer, request) {
  ensure(composer.enabled === true && composer.status === "SESSION_RUNTIME_READY", "M8_RUNTIME_UNAVAILABLE", "M8 session runtime is unavailable");
  const usage = usageAccumulator();
  const assertions = [];
  assertions.push(await runGoal(composer, request));
  assertions.push(await runAgent(composer, request));
  assertions.push(await runBatch(composer, request));
  assertions.push(await runWorkflow(composer, request));
  assertions.push(...await runUltra(composer, request));
  assertions.push(await runPublicWeb(composer, request, usage));
  assertions.push(await runCancellation(composer, request, usage));
  assertions.push(...await runAdmissionDenials(composer, request));
  assertions.push(await prepareResume(composer, request));
  const metering = usage.value();
  assertions.push(assertion("usage-metering", metering));
  return Object.freeze({ assertions: Object.freeze(assertions), usage: metering });
}

export async function executeM8LiveResume(composer, request) {
  ensure(composer.enabled === true && composer.status === "SESSION_RUNTIME_READY", "M8_RUNTIME_UNAVAILABLE", "M8 session runtime is unavailable");
  const runId = `m8-resume-${request.runNonce}`;
  const result = await composer.runManagement.resume(runId);
  ensure(result.status === "RUN_COMPLETED" && result.projection?.status === "completed", result.code ?? "M8_RESUME_FAILED", "M8 run did not resume to completion in the new Pi session");
  return Object.freeze({ assertions: Object.freeze([assertion("resume-across-session", { runId, terminal: result.projection.terminal, artifactDigests: Object.values(result.projection.nodes).flatMap((node) => node.artifacts ?? []).map((ref) => ref.digest).sort() })]), usage: { tokens: 0, costUsd: 0, toolCalls: 0, meteredTerminals: 0 } });
}

export default function m8LiveAcceptanceExtension(pi) {
  let started = false;
  pi.on("session_start", async (_event, ctx) => {
    if (started) return;
    started = true;
    let composer;
    try {
      const request = readRequest();
      ensure(ctx?.model?.provider === request.model.provider && ctx?.model?.id === request.model.id, "M8_LIVE_MODEL_DRIFT", "active Pi model differs from the acceptance request");
      const dailyConfig = createDailyConfigService({ rootDir: request.repositoryRoot, configRoot: request.configRoot });
      const protectedDailyConfig = {
        async resolve(options) {
          const configuration = await dailyConfig.resolve(options);
          return Object.freeze({
            ...configuration,
            budget: Object.freeze({
              ...configuration.budget,
              maxTurnsPerChild: Math.min(4, configuration.budget.maxTurnsPerChild),
              maxToolCallsPerChild: Math.min(4, configuration.budget.maxToolCallsPerChild),
              maxTotalToolCalls: Math.min(16, configuration.budget.maxTotalToolCalls),
              maxGoalRevisions: Math.min(2, configuration.budget.maxGoalRevisions),
            }),
          });
        },
      };
      composer = await createSessionRuntimeComposer({
        pi,
        rootDir: request.repositoryRoot,
        configRoot: request.configRoot,
        getContext: () => ctx,
        dependencies: {
          dailyConfig: protectedDailyConfig,
          goalMakerTemplateSelector: () => "source-verifier",
          toolCallLimitResolver: m8ProtectedToolCallLimit,
          turnLimitResolver: m8ProtectedTurnLimit,
        },
      });
      const result = request.phase === "main" ? await executeM8LiveMain(composer, request) : await executeM8LiveResume(composer, request);
      process.stdout.write(`${JSON.stringify({ formatVersion: 1, type: M8_LIVE_RECORD_TYPE, phase: request.phase, status: "PASS", sourceCommit: request.sourceCommit, model: request.model, assertions: result.assertions, usage: result.usage })}\n`);
    } catch (cause) {
      process.stdout.write(`${JSON.stringify({ formatVersion: 1, type: M8_LIVE_ERROR_TYPE, status: "FAIL", code: publicCode(cause) })}\n`);
    } finally {
      await composer?.dispose?.().catch(() => {});
    }
  });
}
