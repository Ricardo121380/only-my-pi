import crypto from "node:crypto";

import {
  createResolvedAgentSpec,
  digestValue,
  immutable,
} from "../domain/index.mjs";
import {
  compileWorkflowDefinition,
  validateWorkflowPlan,
} from "../workflow/plan-compiler/index.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const MAX_PROPOSAL_BYTES = 256 * 1024;
const TERMINAL_GOAL_STATES = new Set(["completed", "failed", "cancelled", "interrupted", "orphaned"]);
const SUCCESS_NODE_OUTCOMES = new Set(["completed", "succeeded"]);

export class SwarmGoalError extends Error {
  constructor(message, code = "SWARM_GOAL_ERROR", details = {}) {
    super(`swarm-goal: ${message}`);
    this.name = "SwarmGoalError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new SwarmGoalError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`, "INVALID_SWARM_GOAL");
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields`, "INVALID_SWARM_GOAL", { unknown });
}

function canonicalId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} must be a canonical identifier`, "INVALID_SWARM_GOAL", { value });
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical sha256 digest`, "INVALID_SWARM_GOAL", { value });
  return value;
}

function safeInteger(value, label, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be a safe integer in [${minimum}, ${maximum}]`, "INVALID_SWARM_GOAL", { value });
  }
  return value;
}

function boundedNumber(value, label, { minimum = 0, maximum = 1 } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`${label} must be a finite number in [${minimum}, ${maximum}]`, "INVALID_SWARM_GOAL", { value });
  }
  return value;
}

function boundedString(value, label, maximum = 1024) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || /\0/u.test(value)) {
    fail(`${label} must be a bounded non-empty string`, "INVALID_SWARM_GOAL");
  }
  return value;
}

function sortedIds(values, label, { minimum = 0, maximum = 256 } = {}) {
  if (!Array.isArray(values) || values.length < minimum || values.length > maximum) {
    fail(`${label} must contain ${minimum}..${maximum} identifiers`, "INVALID_SWARM_GOAL");
  }
  const result = values.map((value, index) => canonicalId(value, `${label}[${index}]`)).sort();
  if (new Set(result).size !== result.length) fail(`${label} must not contain duplicates`, "INVALID_SWARM_GOAL");
  return result;
}

function finiteIso(clock) {
  const raw = clock();
  const value = raw instanceof Date ? raw : new Date(raw);
  if (!Number.isFinite(value.valueOf())) fail("clock returned an invalid instant", "INVALID_CLOCK");
  return value.toISOString();
}

function jsonBytes(value, label) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (cause) {
    fail(`${label} must be JSON serializable`, "INVALID_SWARM_GOAL", { cause: cause.message });
  }
  const bytes = Buffer.byteLength(encoded);
  if (bytes > MAX_PROPOSAL_BYTES) fail(`${label} exceeds ${MAX_PROPOSAL_BYTES} bytes`, "SWARM_GOAL_PROPOSAL_TOO_LARGE", { bytes });
  return bytes;
}

export function assertSwarmGoalDefinition(input) {
  exactKeys(input, ["$schema", "formatVersion", "contractStatus", "kind", "id", "version", "objective", "authority", "roles", "convergence", "outputSchemaRef"], "SwarmGoal");
  if (!String(input.$schema ?? "").endsWith("swarm-goal-v1.schema.json")
    || input.formatVersion !== 1
    || !["contract-preview", "runtime-ready"].includes(input.contractStatus)
    || input.kind !== "swarm-goal") {
    fail("SwarmGoal version, status, kind, or schema is invalid", "INVALID_SWARM_GOAL");
  }
  exactKeys(input.objective, ["ref", "digest"], "SwarmGoal.objective");
  exactKeys(input.authority, ["allowedAgentTemplates", "budgetRef", "maxPlanRevisions", "maxAgentSpecs", "mutation", "egress"], "SwarmGoal.authority");
  exactKeys(input.roles, ["synthesizerTemplate", "verifierTemplate", "minimumDistinctAgentSpecs"], "SwarmGoal.roles");
  exactKeys(input.convergence, ["coverageTarget", "noProgressWindow", "freshVerifierRequired"], "SwarmGoal.convergence");
  const allowedAgentTemplates = sortedIds(input.authority.allowedAgentTemplates, "SwarmGoal.authority.allowedAgentTemplates", { minimum: 3, maximum: 64 });
  const roles = {
    synthesizerTemplate: canonicalId(input.roles.synthesizerTemplate, "SwarmGoal.roles.synthesizerTemplate"),
    verifierTemplate: canonicalId(input.roles.verifierTemplate, "SwarmGoal.roles.verifierTemplate"),
    minimumDistinctAgentSpecs: safeInteger(input.roles.minimumDistinctAgentSpecs, "SwarmGoal.roles.minimumDistinctAgentSpecs", { minimum: 3, maximum: 64 }),
  };
  for (const [name, templateId] of Object.entries(roles).filter(([name]) => name.endsWith("Template"))) {
    if (!allowedAgentTemplates.includes(templateId)) fail(`${name} is outside allowedAgentTemplates`, "SWARM_GOAL_ROLE_OUTSIDE_AUTHORITY", { templateId });
  }
  if (roles.synthesizerTemplate === roles.verifierTemplate) fail("synthesizer and verifier templates must differ", "SWARM_GOAL_ROLE_CONFLICT");
  const normalized = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/swarm-goal-v1.schema.json",
    formatVersion: 1,
    contractStatus: input.contractStatus,
    kind: "swarm-goal",
    id: canonicalId(input.id, "SwarmGoal.id"),
    version: typeof input.version === "string" && SEMVER.test(input.version)
      ? input.version
      : fail("SwarmGoal.version is invalid", "INVALID_SWARM_GOAL"),
    objective: {
      ref: boundedString(input.objective.ref, "SwarmGoal.objective.ref", 512),
      digest: sha256(input.objective.digest, "SwarmGoal.objective.digest"),
    },
    authority: {
      allowedAgentTemplates,
      budgetRef: canonicalId(input.authority.budgetRef, "SwarmGoal.authority.budgetRef"),
      maxPlanRevisions: safeInteger(input.authority.maxPlanRevisions, "SwarmGoal.authority.maxPlanRevisions", { minimum: 1, maximum: 64 }),
      maxAgentSpecs: safeInteger(input.authority.maxAgentSpecs, "SwarmGoal.authority.maxAgentSpecs", { minimum: roles.minimumDistinctAgentSpecs, maximum: 64 }),
      mutation: ["none", "guarded"].includes(input.authority.mutation) ? input.authority.mutation : fail("invalid mutation authority", "INVALID_SWARM_GOAL"),
      egress: ["deny", "allow-listed"].includes(input.authority.egress) ? input.authority.egress : fail("invalid egress authority", "INVALID_SWARM_GOAL"),
    },
    roles,
    convergence: {
      coverageTarget: boundedNumber(input.convergence.coverageTarget, "SwarmGoal.convergence.coverageTarget", { minimum: Number.EPSILON, maximum: 1 }),
      noProgressWindow: safeInteger(input.convergence.noProgressWindow, "SwarmGoal.convergence.noProgressWindow", { minimum: 1, maximum: 64 }),
      freshVerifierRequired: input.convergence.freshVerifierRequired === true,
    },
    outputSchemaRef: canonicalId(input.outputSchemaRef, "SwarmGoal.outputSchemaRef"),
  };
  if (!normalized.convergence.freshVerifierRequired) fail("fresh verifier is mandatory", "SWARM_GOAL_FRESH_VERIFIER_REQUIRED");
  if (normalized.convergence.noProgressWindow > normalized.authority.maxPlanRevisions) fail("no-progress window exceeds revision limit", "SWARM_GOAL_BUDGET_EXCEEDED");
  return immutable(normalized);
}

export function digestSwarmGoalDefinition(input) {
  return digestValue(assertSwarmGoalDefinition(input));
}

function normalizeObjective(goal, input) {
  if (!object(input)) fail("goal objective input must be an object", "SWARM_GOAL_OBJECTIVE_INVALID");
  const objective = {
    ref: boundedString(input.ref ?? goal.objective.ref, "objective.ref", 512),
    digest: sha256(input.digest ?? goal.objective.digest, "objective.digest"),
    inputDigest: sha256(input.inputDigest ?? digestValue(input.input ?? {}), "objective.inputDigest"),
  };
  if (objective.ref !== goal.objective.ref || objective.digest !== goal.objective.digest) {
    fail("runtime objective differs from the governed goal", "SWARM_GOAL_OBJECTIVE_DRIFT");
  }
  return objective;
}

export function createHumanGoalAuthorization(goalInput, { objective, nonce }) {
  const goal = assertSwarmGoalDefinition(goalInput);
  const normalizedObjective = normalizeObjective(goal, objective);
  const normalizedNonce = canonicalId(nonce, "authorization nonce");
  const value = {
    formatVersion: 1,
    kind: "human-swarm-goal-authorization",
    goalId: goal.id,
    goalDigest: digestValue(goal),
    objectiveDigest: normalizedObjective.digest,
    inputDigest: normalizedObjective.inputDigest,
    nonce: normalizedNonce,
  };
  return immutable({ ...value, authorizationDigest: digestValue(value) });
}

function assertAuthorization(goal, objective, authorization) {
  if (!object(authorization)) fail("dynamic SwarmGoal requires explicit human-origin authorization", "SWARM_GOAL_HUMAN_AUTHORIZATION_REQUIRED");
  exactKeys(authorization, ["formatVersion", "kind", "goalId", "goalDigest", "objectiveDigest", "inputDigest", "nonce", "authorizationDigest"], "human authorization");
  const expected = createHumanGoalAuthorization(goal, { objective, nonce: authorization.nonce });
  if (digestValue(expected) !== digestValue(authorization)) fail("human authorization is invalid or drifted", "SWARM_GOAL_HUMAN_AUTHORIZATION_DRIFT");
  return expected;
}

function normalizeAgentIntent(raw, goal, index) {
  exactKeys(raw, ["id", "templateId", "specialization"], `proposal.agentIntents[${index}]`);
  exactKeys(raw.specialization, ["promptDigest", "promptRef"], `proposal.agentIntents[${index}].specialization`);
  const templateId = canonicalId(raw.templateId, `proposal.agentIntents[${index}].templateId`);
  if (!goal.authority.allowedAgentTemplates.includes(templateId)) fail(`agent template ${templateId} is outside goal authority`, "SWARM_GOAL_AGENT_OUTSIDE_AUTHORITY", { templateId });
  return {
    id: canonicalId(raw.id, `proposal.agentIntents[${index}].id`),
    templateId,
    specialization: {
      promptDigest: sha256(raw.specialization.promptDigest, `proposal.agentIntents[${index}].specialization.promptDigest`),
      ...(raw.specialization.promptRef === undefined ? {} : { promptRef: boundedString(raw.specialization.promptRef, `proposal.agentIntents[${index}].specialization.promptRef`, 512) }),
    },
  };
}

function normalizeReuse(raw, index) {
  exactKeys(raw, ["nodeId", "sourceRevision", "resultDigest", "artifactRefs"], `proposal.reuse[${index}]`);
  return {
    nodeId: canonicalId(raw.nodeId, `proposal.reuse[${index}].nodeId`),
    sourceRevision: safeInteger(raw.sourceRevision, `proposal.reuse[${index}].sourceRevision`, { maximum: 63 }),
    resultDigest: sha256(raw.resultDigest, `proposal.reuse[${index}].resultDigest`),
    artifactRefs: sortedIds(raw.artifactRefs ?? [], `proposal.reuse[${index}].artifactRefs`, { maximum: 256 }),
  };
}

function normalizeMetrics(raw) {
  exactKeys(raw, ["coverage", "progress", "criticalPathMs", "coveredDimensions", "remainingDimensions"], "proposal.metrics");
  return {
    coverage: boundedNumber(raw.coverage, "proposal.metrics.coverage"),
    progress: boundedNumber(raw.progress, "proposal.metrics.progress"),
    criticalPathMs: safeInteger(raw.criticalPathMs, "proposal.metrics.criticalPathMs"),
    coveredDimensions: sortedIds(raw.coveredDimensions, "proposal.metrics.coveredDimensions", { maximum: 256 }),
    remainingDimensions: sortedIds(raw.remainingDimensions, "proposal.metrics.remainingDimensions", { maximum: 256 }),
  };
}

function transitiveNeeds(plan, nodeId, seen = new Set()) {
  if (seen.has(nodeId)) return seen;
  seen.add(nodeId);
  const node = plan.nodes.find((entry) => entry.id === nodeId);
  for (const dependency of node?.needs ?? []) transitiveNeeds(plan, dependency, seen);
  return seen;
}

async function resolveProposal(raw, context) {
  exactKeys(raw, ["revision", "reason", "agentIntents", "workflowDefinition", "reuse", "metrics", "quality", "decision"], "SwarmGoal proposal");
  jsonBytes(raw, "SwarmGoal proposal");
  if (raw.revision !== context.revision) fail("planner returned the wrong revision", "SWARM_GOAL_REVISION_DRIFT", { expected: context.revision, actual: raw.revision });
  if (!Array.isArray(raw.agentIntents)) fail("proposal.agentIntents must be an array", "SWARM_GOAL_AGENT_COUNT_OUTSIDE_AUTHORITY");
  if (!Array.isArray(raw.reuse)) fail("proposal.reuse must be an array", "SWARM_GOAL_REUSE_INVALID");
  const intents = raw.agentIntents.map((intent, index) => normalizeAgentIntent(intent, context.goal, index));
  if (intents.length < context.goal.roles.minimumDistinctAgentSpecs || intents.length > context.goal.authority.maxAgentSpecs) {
    fail("proposal AgentSpec count is outside the governed envelope", "SWARM_GOAL_AGENT_COUNT_OUTSIDE_AUTHORITY", { count: intents.length });
  }
  if (new Set(intents.map((intent) => intent.id)).size !== intents.length) fail("proposal AgentSpec ids must be unique", "SWARM_GOAL_AGENT_ID_CONFLICT");
  if (new Set(intents.map((intent) => intent.templateId)).size < context.goal.roles.minimumDistinctAgentSpecs) {
    fail("dynamic goal requires heterogeneous agent templates", "SWARM_GOAL_HETEROGENEITY_REQUIRED");
  }
  const agentSpecs = [];
  for (const intent of intents) {
    const template = await context.resolveAgentTemplate(intent.templateId);
    if (template?.id !== intent.templateId || template?.kind !== "agent-template") fail(`resolver returned the wrong AgentTemplate for ${intent.templateId}`, "SWARM_GOAL_AGENT_TEMPLATE_DRIFT");
    agentSpecs.push(createResolvedAgentSpec({
      template,
      id: intent.id,
      specialization: intent.specialization,
      runtimeMode: "REGISTERED_ROLES_ONLY",
    }));
  }
  exactKeys(raw.quality, ["synthesizerAgentSpecId", "verifierAgentSpecId", "makerAgentSpecIds", "verifierContextMode"], "proposal.quality");
  const quality = {
    synthesizerAgentSpecId: canonicalId(raw.quality.synthesizerAgentSpecId, "proposal.quality.synthesizerAgentSpecId"),
    verifierAgentSpecId: canonicalId(raw.quality.verifierAgentSpecId, "proposal.quality.verifierAgentSpecId"),
    makerAgentSpecIds: sortedIds(raw.quality.makerAgentSpecIds, "proposal.quality.makerAgentSpecIds", { minimum: 1, maximum: 64 }),
    verifierContextMode: raw.quality.verifierContextMode,
  };
  const bySpecId = new Map(agentSpecs.map((spec) => [spec.id, spec]));
  for (const id of [quality.synthesizerAgentSpecId, quality.verifierAgentSpecId, ...quality.makerAgentSpecIds]) {
    if (!bySpecId.has(id)) fail(`quality role references unknown AgentSpec ${id}`, "SWARM_GOAL_QUALITY_AGENT_UNKNOWN", { id });
  }
  if (quality.verifierContextMode !== "fresh") fail("final verifier must use fresh context", "SWARM_GOAL_FRESH_VERIFIER_REQUIRED");
  if (quality.synthesizerAgentSpecId === quality.verifierAgentSpecId
    || quality.makerAgentSpecIds.includes(quality.verifierAgentSpecId)
    || quality.makerAgentSpecIds.includes(quality.synthesizerAgentSpecId)) {
    fail("verifier must be independent from makers and synthesizer", "SWARM_GOAL_VERIFIER_INDEPENDENCE_REQUIRED");
  }
  if (bySpecId.get(quality.synthesizerAgentSpecId).templateId !== context.goal.roles.synthesizerTemplate
    || bySpecId.get(quality.verifierAgentSpecId).templateId !== context.goal.roles.verifierTemplate) {
    fail("proposal quality roles drifted from goal role bindings", "SWARM_GOAL_ROLE_DRIFT");
  }
  if (!object(raw.workflowDefinition) || raw.workflowDefinition.formatVersion !== 2) fail("proposal requires WorkflowDefinition v2", "SWARM_GOAL_WORKFLOW_INVALID");
  const parentPlanDigest = context.previousPlan?.planDigest ?? null;
  const plan = context.compileWorkflow(raw.workflowDefinition, {
    revision: {
      number: context.revision,
      parentPlanDigest,
      reason: boundedString(raw.reason, "proposal.reason", 1000),
      activationPolicy: "drain",
    },
    resolveBatch: context.resolveBatch,
    resolveWorkflow: context.resolveWorkflow,
  });
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
  const specIds = new Set(agentSpecs.map((spec) => spec.id));
  const agentNodes = plan.nodes.filter((node) => node.kind === "agent");
  for (const node of agentNodes) if (!specIds.has(node.agentTemplateRef)) fail(`workflow node ${node.id} references an ungoverned AgentSpec`, "SWARM_GOAL_WORKFLOW_AGENT_UNKNOWN", { nodeId: node.id });
  for (const specId of specIds) if (!agentNodes.some((node) => node.agentTemplateRef === specId)) fail(`AgentSpec ${specId} is not used by the workflow`, "SWARM_GOAL_UNUSED_AGENT_SPEC", { specId });
  const terminal = plan.nodes.find((node) => node.id === plan.terminalNodeId);
  if (terminal?.kind !== "agent" || terminal.agentTemplateRef !== quality.verifierAgentSpecId) fail("workflow terminal must be the declared fresh verifier", "SWARM_GOAL_VERIFIER_TERMINAL_REQUIRED");
  const terminalChain = transitiveNeeds(plan, plan.terminalNodeId);
  if (!plan.nodes.some((node) => terminalChain.has(node.id) && node.kind === "agent" && node.agentTemplateRef === quality.synthesizerAgentSpecId)) {
    fail("fresh verifier must depend on the declared synthesizer", "SWARM_GOAL_SYNTHESIS_CHAIN_REQUIRED");
  }
  if (context.goal.authority.mutation === "none" && plan.policy.mutation !== "none") fail("plan widens mutation authority", "SWARM_GOAL_AUTHORITY_ESCALATION");
  if (context.goal.authority.egress === "deny" && (plan.policy.egress.web !== "deny" || plan.policy.egress.mcp !== "deny")) fail("plan widens egress authority", "SWARM_GOAL_AUTHORITY_ESCALATION");
  const reuse = raw.reuse.map(normalizeReuse).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (new Set(reuse.map((entry) => entry.nodeId)).size !== reuse.length) fail("proposal reuse entries must be unique", "SWARM_GOAL_REUSE_CONFLICT");
  if (context.revision === 0 && reuse.length > 0) fail("initial revision cannot reuse prior work", "SWARM_GOAL_REUSE_INVALID");
  for (const entry of reuse) {
    const prior = context.settledNodes.get(entry.nodeId);
    if (!prior
      || prior.revision !== entry.sourceRevision
      || prior.resultDigest !== entry.resultDigest
      || prior.reusable !== true
      || digestValue(prior.artifactRefs ?? []) !== digestValue(entry.artifactRefs)) {
      fail(`reuse entry ${entry.nodeId} has no matching settled read-only evidence`, "SWARM_GOAL_REUSE_UNPROVEN", { nodeId: entry.nodeId });
    }
    if (plan.nodes.some((node) => node.id === entry.nodeId)) fail(`reused node ${entry.nodeId} remains in the new plan`, "SWARM_GOAL_REUSE_WOULD_RERUN", { nodeId: entry.nodeId });
  }
  const metrics = normalizeMetrics(raw.metrics);
  if (new Set(metrics.coveredDimensions.filter((id) => metrics.remainingDimensions.includes(id))).size > 0) fail("coverage dimensions overlap", "SWARM_GOAL_COVERAGE_CONFLICT");
  if (!["replan", "complete", "blocked"].includes(raw.decision)) fail("proposal decision is invalid", "SWARM_GOAL_DECISION_INVALID");
  if (raw.decision === "complete" && metrics.coverage < context.goal.convergence.coverageTarget) fail("complete decision is below coverage target", "SWARM_GOAL_COVERAGE_INCOMPLETE");
  return immutable({
    formatVersion: 1,
    revision: context.revision,
    reason: raw.reason,
    parentPlanDigest,
    agentSpecs,
    plan,
    reuse,
    metrics,
    quality,
    decision: raw.decision,
    proposalDigest: digestValue({ revision: context.revision, agentSpecs, plan, reuse, metrics, quality, decision: raw.decision }),
  });
}

function goalProjection(events, runId) {
  const projection = {
    formatVersion: 1,
    runId,
    status: "new",
    goalId: null,
    goalDigest: null,
    objectiveDigest: null,
    inputDigest: null,
    authorizationDigest: null,
    revisions: [],
    terminal: null,
  };
  for (const event of events) {
    if (event.runId !== runId) fail("goal journal contains a foreign event", "SWARM_GOAL_EVENT_CORRELATION_MISMATCH");
    if (event.type === "GoalAdmitted") {
      projection.status = "planning";
      Object.assign(projection, {
        goalId: event.payload.goalId,
        goalDigest: event.payload.goalDigest,
        objectiveDigest: event.payload.objectiveDigest,
        inputDigest: event.payload.inputDigest,
        authorizationDigest: event.payload.authorizationDigest,
      });
    } else if (event.type === "GoalRevisionProposed") {
      projection.status = "planned";
      projection.revisions[event.revision] = {
        revision: event.revision,
        proposal: event.payload.proposal,
        childRunId: event.payload.childRunId,
        status: "proposed",
        execution: null,
      };
    } else if (event.type === "GoalRevisionStarted") {
      projection.status = "running";
      projection.revisions[event.revision].status = "running";
    } else if (event.type === "GoalRevisionAwaitingApproval") {
      projection.status = "awaiting-approval";
      projection.revisions[event.revision].status = "awaiting-approval";
    } else if (event.type === "GoalRevisionSettled") {
      projection.status = "planning";
      projection.revisions[event.revision].status = "settled";
      projection.revisions[event.revision].execution = event.payload;
    } else if (["RunCompleted", "RunFailed", "RunCancelled", "RunInterrupted", "RunOrphaned"].includes(event.type)) {
      projection.status = event.payload.status;
      projection.terminal = event.payload;
    }
  }
  projection.revisions = projection.revisions.filter(Boolean);
  return immutable(projection);
}

function rebuiltSettledNodes(projection) {
  const result = new Map();
  for (const revision of projection.revisions) {
    for (const node of revision.execution?.reusableSettledNodes ?? []) result.set(node.nodeId, node);
  }
  return result;
}

function validateExecution(result, proposal) {
  if (!object(result) || !object(result.projection)) fail("revision executor returned an invalid result", "SWARM_GOAL_EXECUTION_INVALID");
  const projection = result.projection;
  if (projection.planDigest !== proposal.plan.planDigest || projection.activeRevision !== proposal.revision) fail("revision execution drifted from its plan", "SWARM_GOAL_EXECUTION_DRIFT");
  if (projection.status === "awaiting-approval") return { awaitingApproval: true, projection };
  if (!object(result.verification)) fail("revision executor returned no verifier evidence", "SWARM_GOAL_EXECUTION_INVALID");
  if (projection.status !== "completed") fail(`revision ended ${projection.status}`, "SWARM_GOAL_REVISION_FAILED", { status: projection.status });
  const mutating = proposal.plan.policy.mutation !== "none" || proposal.plan.nodes.some((node) => node.policy.mutation !== "none");
  if (mutating && (projection.approval?.planDigest !== proposal.plan.planDigest
    || projection.approval?.revision !== proposal.revision
    || !SHA256.test(projection.approval?.receiptDigest ?? ""))) {
    fail("mutating revision lacks exact approval evidence", "SWARM_GOAL_REVISION_APPROVAL_REQUIRED");
  }
  const verification = result.verification;
  if (verification.agentSpecId !== proposal.quality.verifierAgentSpecId
    || verification.contextMode !== "fresh"
    || !SHA256.test(verification.receiptDigest ?? "")) {
    fail("final verifier evidence is missing, stale, or uncorrelated", "SWARM_GOAL_VERIFIER_EVIDENCE_INVALID");
  }
  if (!["pass", "fail", "blocked"].includes(verification.verdict)) fail("final verifier verdict is invalid", "SWARM_GOAL_VERIFIER_EVIDENCE_INVALID");
  const usage = object(result.usage) ? result.usage : {};
  for (const [key, value] of Object.entries(usage)) if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`usage.${key} is invalid`, "SWARM_GOAL_USAGE_INVALID");
  return { awaitingApproval: false, projection, verification, usage };
}

function revisionReservation(proposal) {
  const vector = {
    workflowRuns: 1,
    planRevisions: 1,
    assignments: proposal.plan.budget.maxAssignments,
    elapsedMs: proposal.plan.budget.maxWallTimeMs,
    rawOutputBytes: proposal.plan.budget.maxOutputBytes,
  };
  if (proposal.plan.budget.maxTokens !== null) vector.tokens = proposal.plan.budget.maxTokens;
  if (proposal.plan.budget.maxCostUsd !== null) vector.cost = proposal.plan.budget.maxCostUsd;
  return vector;
}

function actualRevisionUsage(result, reserved) {
  const actual = {};
  const unknown = Object.keys(result.usage ?? {}).filter((key) => !Object.hasOwn(reserved, key));
  if (unknown.length > 0) fail("revision reported unknown usage dimensions", "SWARM_GOAL_USAGE_INVALID", { unknown });
  for (const key of Object.keys(reserved)) {
    const reported = result.usage?.[key] ?? reserved[key];
    if (reported > reserved[key]) {
      fail(`revision exceeded its reserved ${key} budget`, "SWARM_GOAL_BUDGET_OVERRUN", {
        dimension: key,
        reserved: reserved[key],
        reported,
      });
    }
    actual[key] = reported;
  }
  return actual;
}

function reusableNodes(proposal, execution) {
  return proposal.plan.nodes.flatMap((node) => {
    const projected = execution.projection.nodes?.[node.id];
    const reusable = node.policy.mutation === "none" && node.idempotency === "content-addressed" && node.cache.mode === "content-addressed";
    if (!reusable || !SUCCESS_NODE_OUTCOMES.has(projected?.outcome) || !SHA256.test(projected.resultDigest ?? "")) return [];
    const artifactRefs = sortedIds(projected.artifactRefs ?? [], `execution.projection.nodes.${node.id}.artifactRefs`, { maximum: 256 });
    return [{ nodeId: node.id, revision: proposal.revision, resultDigest: projected.resultDigest, artifactRefs, reusable: true }];
  }).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
}

export function createSwarmGoalController(options = {}) {
  const { eventJournal, budgetLedger, planner, resolveAgentTemplate, executeRevision } = options;
  if (!eventJournal || typeof eventJournal.acquireWriter !== "function" || typeof eventJournal.append !== "function" || typeof eventJournal.read !== "function") throw new TypeError("createSwarmGoalController requires an EventJournal manager");
  if (!budgetLedger || typeof budgetLedger.reserve !== "function" || typeof budgetLedger.settle !== "function") throw new TypeError("createSwarmGoalController requires a parent BudgetLedger");
  if (typeof planner !== "function") throw new TypeError("createSwarmGoalController requires an injected planner");
  if (typeof resolveAgentTemplate !== "function") throw new TypeError("createSwarmGoalController requires resolveAgentTemplate()");
  if (typeof executeRevision !== "function") throw new TypeError("createSwarmGoalController requires executeRevision()");
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
  const compileWorkflow = options.compileWorkflow ?? compileWorkflowDefinition;
  const leaseTtlMs = options.leaseTtlMs ?? 60_000;
  const leaseRenewalIntervalMs = options.leaseRenewalIntervalMs ?? Math.floor(leaseTtlMs / 3);
  const scheduler = options.scheduler ?? { setTimeout, clearTimeout };
  const revisionAuthorizer = options.revisionAuthorizer ?? null;
  const allowVerifiedReuseCompletion = options.allowVerifiedReuseCompletion === true;
  if (revisionAuthorizer !== null && typeof revisionAuthorizer !== "function" && (typeof revisionAuthorizer.assess !== "function" || typeof revisionAuthorizer.approve !== "function")) throw new TypeError("revisionAuthorizer must be a factory or implement assess() and approve()");
  if (!Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < 1 || !Number.isSafeInteger(leaseRenewalIntervalMs) || leaseRenewalIntervalMs < 1 || leaseRenewalIntervalMs >= leaseTtlMs) throw new TypeError("SwarmGoal lease heartbeat must be positive and shorter than the lease TTL");

  async function append(runId, leaseRef, event) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await eventJournal.read(runId, { repairTrailingPartial: true, lease: leaseRef.current });
      try {
        const result = await eventJournal.append(runId, event, {
          lease: leaseRef.current,
          expectedSeq: current.lastSeq,
          expectedDigest: current.lastEventDigest,
        });
        if (result.status === "LATE_EVENT") fail("goal event arrived after terminal settlement", "SWARM_GOAL_EVENT_LATE", { eventId: event.eventId });
        return result;
      } catch (cause) {
        if (cause?.code === "JOURNAL_CAS_MISMATCH" && attempt < 7) continue;
        throw cause;
      }
    }
    fail("goal event append retry exhausted", "SWARM_GOAL_EVENT_APPEND_EXHAUSTED");
  }

  function heartbeat(runId, leaseRef) {
    let stopped = false;
    let handle = null;
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    failure.catch(() => {});
    const tick = async () => {
      if (stopped) return;
      try {
        leaseRef.current = await eventJournal.renewWriter(runId, { lease: leaseRef.current, ttlMs: leaseTtlMs });
        if (!stopped) handle = scheduler.setTimeout(tick, leaseRenewalIntervalMs);
        handle?.unref?.();
      } catch (cause) {
        rejectFailure(cause);
      }
    };
    handle = scheduler.setTimeout(tick, leaseRenewalIntervalMs);
    handle?.unref?.();
    return {
      failure,
      async stop() {
        stopped = true;
        if (handle !== null) scheduler.clearTimeout(handle);
      },
    };
  }

  async function inspect(runId) {
    canonicalId(runId, "goal runId");
    const recovered = await eventJournal.read(runId);
    return goalProjection(recovered.events, runId);
  }

  async function terminalizeSettledRevision(runId, leaseRef, goal, revisionState, noProgress) {
    const { proposal, execution, revision } = revisionState;
    if (execution.verification?.verdict !== "pass") {
      await append(runId, leaseRef, {
        eventId: `goal-verification-failed:${revision}`,
        type: "RunFailed",
        revision,
        payload: {
          status: "failed",
          code: "SWARM_GOAL_FINAL_VERIFIER_FAILED",
          revision,
          verifierReceiptDigest: execution.verification?.receiptDigest ?? null,
        },
      });
      return inspect(runId);
    }
    if (noProgress >= goal.convergence.noProgressWindow) {
      await append(runId, leaseRef, {
        eventId: `goal-no-progress:${revision}`,
        type: "RunFailed",
        revision,
        payload: { status: "failed", code: "SWARM_GOAL_NO_PROGRESS", revision, noProgress },
      });
      return inspect(runId);
    }
    if (proposal.decision === "blocked") {
      await append(runId, leaseRef, {
        eventId: `goal-blocked:${revision}`,
        type: "RunInterrupted",
        revision,
        payload: { status: "interrupted", code: "SWARM_GOAL_BLOCKED", revision },
      });
      return inspect(runId);
    }
    if (proposal.decision === "complete") {
      await append(runId, leaseRef, {
        eventId: `goal-completed:${revision}`,
        type: "RunCompleted",
        revision,
        payload: {
          status: "completed",
          revision,
          planDigest: proposal.plan.planDigest,
          coverage: proposal.metrics.coverage,
          verifierReceiptDigest: execution.verification.receiptDigest,
          outputSchemaRef: goal.outputSchemaRef,
        },
      });
      return inspect(runId);
    }
    return null;
  }

  async function run(goalInput, runOptions = {}) {
    const goal = assertSwarmGoalDefinition(goalInput);
    const runId = canonicalId(runOptions.runId ?? idFactory("swarm-goal"), "goal runId");
    const objective = normalizeObjective(goal, runOptions.objective ?? {});
    const authorization = assertAuthorization(goal, objective, runOptions.authorization);
    const activeRevisionAuthorizer = typeof revisionAuthorizer === "function"
      ? await revisionAuthorizer({ goal, objective, authorization, runId })
      : revisionAuthorizer;
    if (activeRevisionAuthorizer !== null && (typeof activeRevisionAuthorizer?.assess !== "function" || typeof activeRevisionAuthorizer?.approve !== "function")) throw new TypeError("revisionAuthorizer factory returned an invalid authorizer");
    const leaseRef = { current: await eventJournal.acquireWriter(runId, { writerId: idFactory("goal-writer"), ttlMs: leaseTtlMs }) };
    const leaseHeartbeat = heartbeat(runId, leaseRef);
    try {
      let recovered = await eventJournal.read(runId, { repairTrailingPartial: true, lease: leaseRef.current });
      let projection = goalProjection(recovered.events, runId);
      const goalDigest = digestValue(goal);
      if (recovered.events.length === 0) {
        await append(runId, leaseRef, {
          eventId: "goal-admitted",
          type: "GoalAdmitted",
          revision: 0,
          payload: {
            goalId: goal.id,
            goalDigest,
            objectiveDigest: objective.digest,
            inputDigest: objective.inputDigest,
            authorizationDigest: authorization.authorizationDigest,
            admittedAt: finiteIso(clock),
          },
        });
        projection = await inspect(runId);
      } else if (projection.goalDigest !== goalDigest
        || projection.objectiveDigest !== objective.digest
        || projection.inputDigest !== objective.inputDigest
        || projection.authorizationDigest !== authorization.authorizationDigest) {
        fail("durable goal binding differs from the requested run", "SWARM_GOAL_RUN_DRIFT");
      }
      if (TERMINAL_GOAL_STATES.has(projection.status)) return projection;
      const settledNodes = rebuiltSettledNodes(projection);
      let previousPlan = projection.revisions.at(-1)?.proposal?.plan ?? null;
      let noProgress = 0;
      let priorCoverage = 0;
      for (const revisionState of projection.revisions.filter((entry) => entry.status === "settled")) {
        const coverage = revisionState.proposal.metrics.coverage;
        noProgress = coverage > priorCoverage ? 0 : noProgress + 1;
        priorCoverage = Math.max(priorCoverage, coverage);
      }

      for (let revision = projection.revisions.length === 0 ? 0 : projection.revisions.at(-1).revision; revision < goal.authority.maxPlanRevisions; revision += 1) {
        projection = await inspect(runId);
        let revisionState = projection.revisions.find((entry) => entry.revision === revision);
        let proposal;
        if (!revisionState) {
          const rawProposal = await Promise.race([
            planner({
              runId,
              goal,
              objective,
              revision,
              previousPlan,
              settledNodes: immutable([...settledNodes.values()]),
              priorCoverage,
              noProgress,
            }),
            leaseHeartbeat.failure,
          ]);
          proposal = await resolveProposal(rawProposal, {
            goal,
            revision,
            previousPlan,
            settledNodes,
            resolveAgentTemplate,
            compileWorkflow,
            resolveBatch: options.resolveBatch,
            resolveWorkflow: options.resolveWorkflow,
          });
          const childRunId = canonicalId(`${runId}:r${revision}`, "revision child runId");
          await append(runId, leaseRef, {
            eventId: `goal-revision-proposed:${revision}`,
            type: "GoalRevisionProposed",
            revision,
            payload: { proposal, childRunId },
          });
          revisionState = { revision, proposal, childRunId, status: "proposed", execution: null };
        } else proposal = revisionState.proposal;

        if (activeRevisionAuthorizer) {
          let assessment = activeRevisionAuthorizer.assess(proposal);
          if (assessment.requiresApproval) {
            let approval = await runOptions.approveRevisionExpansion?.(revision, proposal, assessment);
            if (approval === true && typeof activeRevisionAuthorizer.createApproval === "function") {
              approval = activeRevisionAuthorizer.createApproval(proposal, `${runId}:revision-${revision}`);
            }
            if (approval) {
              activeRevisionAuthorizer.approve(proposal, approval);
              assessment = activeRevisionAuthorizer.assess(proposal);
            }
            if (assessment.requiresApproval) {
              await append(runId, leaseRef, {
                eventId: `goal-revision-awaiting-authority:${revision}`,
                type: "GoalRevisionAwaitingApproval",
                revision,
                payload: { childRunId: revisionState.childRunId, planDigest: proposal.plan.planDigest, authorityProjectionDigest: assessment.projectionDigest, code: "GOAL_REVISION_REAPPROVAL_REQUIRED" },
              });
              return inspect(runId);
            }
          }
        }

        if (allowVerifiedReuseCompletion && proposal.decision === "complete" && revision > 0) {
          const priorVerifiedRevision = projection.revisions
            .filter((entry) => entry.status === "settled" && entry.execution?.verification?.verdict === "pass" && entry.execution.verification.contextMode === "fresh" && SHA256.test(entry.execution.verification.receiptDigest ?? ""))
            .at(-1);
          const settledIds = [...settledNodes.keys()].sort();
          const reuseIds = proposal.reuse.map((entry) => entry.nodeId).sort();
          const exactVerifiedReuse = priorVerifiedRevision
            && settledIds.length > 0
            && JSON.stringify(reuseIds) === JSON.stringify(settledIds)
            && proposal.reuse.every((entry) => entry.artifactRefs.length > 0)
            && goal.authority.mutation === "none"
            && proposal.plan.policy.mutation === "none"
            && proposal.plan.nodes.every((node) => node.policy.mutation === "none");
          if (exactVerifiedReuse) {
            const reusableSettledNodes = immutable([...settledNodes.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)));
            const verification = priorVerifiedRevision.execution.verification;
            await append(runId, leaseRef, {
              eventId: `goal-revision-reused:${revision}`,
              type: "GoalRevisionSettled",
              revision,
              payload: {
                childRunId: revisionState.childRunId,
                planDigest: proposal.plan.planDigest,
                status: "completed-from-verified-reuse",
                verification,
                usage: {},
                reusableSettledNodes,
                reusedFromRevision: priorVerifiedRevision.revision,
              },
            });
            revisionState = { ...revisionState, status: "settled", execution: { childRunId: revisionState.childRunId, planDigest: proposal.plan.planDigest, status: "completed-from-verified-reuse", verification, usage: {}, reusableSettledNodes, reusedFromRevision: priorVerifiedRevision.revision } };
            return await terminalizeSettledRevision(runId, leaseRef, goal, revisionState, 0);
          }
        }

        if (revisionState.status === "settled") {
          const terminal = await terminalizeSettledRevision(runId, leaseRef, goal, revisionState, noProgress);
          if (terminal) return terminal;
          previousPlan = proposal.plan;
          continue;
        }
        const reservationId = canonicalId(`goal-revision-${revision}`, "revision reservation id");
        const worstCase = revisionReservation(proposal);
        await budgetLedger.reserve(runId, {
          reservationId,
          ownerId: runId,
          worstCase,
        }, { lease: leaseRef.current, revision });
        if (revisionState.status !== "running") {
          await append(runId, leaseRef, {
            eventId: `goal-revision-started:${revision}`,
            type: "GoalRevisionStarted",
            revision,
            payload: { childRunId: revisionState.childRunId, planDigest: proposal.plan.planDigest, reservationId },
          });
        }
        let rawExecution;
        try {
          rawExecution = await Promise.race([
            executeRevision({
              goalRunId: runId,
              childRunId: revisionState.childRunId,
              goal,
              objective,
              proposal,
              plan: proposal.plan,
              agentSpecs: proposal.agentSpecs,
              reuse: proposal.reuse,
              authorization,
              approval: runOptions.approvalForRevision?.(revision, proposal) ?? null,
              input: runOptions.input ?? {},
              signal: runOptions.signal,
            }),
            leaseHeartbeat.failure,
          ]);
        } catch (cause) {
          await budgetLedger.settle(runId, reservationId, { consumed: worstCase, revision }, { lease: leaseRef.current });
          await append(runId, leaseRef, {
            eventId: `goal-revision-failed:${revision}`,
            type: "RunFailed",
            revision,
            payload: { status: "failed", code: cause.code ?? "SWARM_GOAL_REVISION_EXECUTION_FAILED", revision },
          });
          return inspect(runId);
        }
        let execution;
        let actualUsage;
        try {
          execution = validateExecution(rawExecution, proposal);
          if (!execution.awaitingApproval) actualUsage = actualRevisionUsage(execution, worstCase);
        } catch (cause) {
          await budgetLedger.settle(runId, reservationId, { consumed: worstCase, revision }, { lease: leaseRef.current });
          await append(runId, leaseRef, {
            eventId: `goal-revision-invalid:${revision}`,
            type: "RunFailed",
            revision,
            payload: { status: "failed", code: cause.code ?? "SWARM_GOAL_EXECUTION_INVALID", revision },
          });
          throw cause;
        }
        if (execution.awaitingApproval) {
          await append(runId, leaseRef, {
            eventId: `goal-revision-awaiting-approval:${revision}`,
            type: "GoalRevisionAwaitingApproval",
            revision,
            payload: { childRunId: revisionState.childRunId, planDigest: proposal.plan.planDigest },
          });
          return inspect(runId);
        }
        await budgetLedger.settle(runId, reservationId, {
          consumed: actualUsage,
          revision,
        }, { lease: leaseRef.current });
        const reusableSettledNodes = reusableNodes(proposal, execution);
        for (const node of reusableSettledNodes) settledNodes.set(node.nodeId, node);
        await append(runId, leaseRef, {
          eventId: `goal-revision-settled:${revision}`,
          type: "GoalRevisionSettled",
          revision,
          payload: {
            childRunId: revisionState.childRunId,
            planDigest: proposal.plan.planDigest,
            status: execution.projection.status,
            verification: execution.verification,
            usage: execution.usage,
            reusableSettledNodes,
          },
        });
        noProgress = proposal.metrics.coverage > priorCoverage ? 0 : noProgress + 1;
        priorCoverage = Math.max(priorCoverage, proposal.metrics.coverage);
        revisionState = { ...revisionState, status: "settled", execution: {
          childRunId: revisionState.childRunId,
          planDigest: proposal.plan.planDigest,
          status: execution.projection.status,
          verification: execution.verification,
          usage: execution.usage,
          reusableSettledNodes,
        } };
        const terminal = await terminalizeSettledRevision(runId, leaseRef, goal, revisionState, noProgress);
        if (terminal) return terminal;
        previousPlan = proposal.plan;
      }
      projection = await inspect(runId);
      const lastRevision = projection.revisions.at(-1)?.revision ?? 0;
      await append(runId, leaseRef, {
        eventId: "goal-revision-limit",
        type: "RunFailed",
        revision: lastRevision,
        payload: { status: "failed", code: "SWARM_GOAL_REVISION_LIMIT", revision: lastRevision },
      });
      return inspect(runId);
    } finally {
      await leaseHeartbeat.stop();
      await eventJournal.releaseWriter(runId, { lease: leaseRef.current }).catch(() => {});
    }
  }

  return Object.freeze({ run, inspect });
}

export function budgetLedgerEnvelopeFromV2(envelope) {
  if (!object(envelope) || envelope.formatVersion !== 2 || envelope.kind !== "budget-envelope" || !object(envelope.hard)) throw new TypeError("BudgetEnvelope v2 is required");
  return immutable({
    maxWorkflowRuns: envelope.hard.maxWorkflowRuns,
    maxPlanRevisions: envelope.hard.maxPlanRevisions,
    maxAssignments: envelope.hard.maxTotalAssignments,
    maxElapsedMs: envelope.hard.maxElapsedMs,
    maxOutputBytes: envelope.hard.maxRawOutputBytes,
    maxTokens: envelope.hard.maxTokens,
    maxCost: envelope.hard.maxCost,
  });
}
