import { digestValue, immutable } from "../domain/index.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const ROUTES = new Set(["agent", "batch-swarm", "workflow", "swarm-goal"]);

export const ULTRA_PHASE_LIBRARY = Object.freeze([
  Object.freeze({ id: "u0-bind", ordinal: 0, purpose: "bind-request-authority-budget" }),
  Object.freeze({ id: "u1-understand", ordinal: 1, purpose: "understand-and-shard-context" }),
  Object.freeze({ id: "u2-plan", ordinal: 2, purpose: "compile-immutable-execution-plan" }),
  Object.freeze({ id: "u3-change", ordinal: 3, purpose: "execute-bounded-work" }),
  Object.freeze({ id: "u4-verify", ordinal: 4, purpose: "run-deterministic-and-agent-checks" }),
  Object.freeze({ id: "u5-repair", ordinal: 5, purpose: "bounded-fix-and-reverify" }),
  Object.freeze({ id: "u6-final", ordinal: 6, purpose: "fresh-context-final-verifier" }),
]);

const QUALITY_POLICIES = Object.freeze({
  quick: Object.freeze({ maxPhases: 4, maxRepairLoops: 0, verifierLenses: 1, requireIntegrationGate: false }),
  standard: Object.freeze({ maxPhases: 6, maxRepairLoops: 1, verifierLenses: 1, requireIntegrationGate: false }),
  deep: Object.freeze({ maxPhases: 7, maxRepairLoops: 2, verifierLenses: 2, requireIntegrationGate: true }),
  critical: Object.freeze({ maxPhases: 7, maxRepairLoops: 2, verifierLenses: 3, requireIntegrationGate: true }),
});

export class UltraRunError extends Error {
  constructor(message, code = "ULTRA_RUN_ERROR", details = {}) {
    super(`ultra-run: ${message}`);
    this.name = "UltraRunError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new UltraRunError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`, "ULTRA_RUN_INVALID");
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${label} contains unknown fields`, "ULTRA_RUN_INVALID", { unknown });
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} must be a canonical identifier`, "ULTRA_RUN_INVALID", { value });
  return value;
}

function sha(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} must be a canonical sha256 digest`, "ULTRA_RUN_INVALID", { value });
  return value;
}

function integer(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} must be a safe integer in [${minimum}, ${maximum}]`, "ULTRA_RUN_INVALID", { value });
  return value;
}

function idList(value, label, { minimum = 0, maximum = 64 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} has an invalid item count`, "ULTRA_RUN_INVALID");
  const result = value.map((entry, index) => id(entry, `${label}[${index}]`)).sort();
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`, "ULTRA_RUN_INVALID");
  return result;
}

export function assertUltraRunDefinition(input) {
  exact(input, ["$schema", "formatVersion", "contractStatus", "kind", "id", "version", "effort", "routePolicy", "workflowLibrary", "batchLibrary", "goalLibrary", "quality", "budgetRef", "approvalPolicy"], "UltraRun");
  if (!String(input.$schema ?? "").endsWith("ultra-run-v1.schema.json")
    || input.formatVersion !== 1
    || !["contract-preview", "runtime-ready"].includes(input.contractStatus)
    || input.kind !== "ultra-run") fail("UltraRun schema, version, status, or kind is invalid", "ULTRA_RUN_INVALID");
  exact(input.routePolicy, ["singleAgentMaxComplexity", "batchMinItems", "dynamicGoalRequiresExplicitApproval"], "UltraRun.routePolicy");
  exact(input.quality, ["freshVerifier", "testGate", "integrationGate"], "UltraRun.quality");
  if (!Object.hasOwn(QUALITY_POLICIES, input.effort)) fail("UltraRun effort is invalid", "ULTRA_RUN_INVALID");
  if (input.routePolicy.dynamicGoalRequiresExplicitApproval !== true || input.quality.freshVerifier !== true) fail("UltraRun may not disable dynamic-goal approval or fresh verification", "ULTRA_RUN_SAFETY_INVARIANT");
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/ultra-run-v1.schema.json",
    formatVersion: 1,
    contractStatus: input.contractStatus,
    kind: "ultra-run",
    id: id(input.id, "UltraRun.id"),
    version: typeof input.version === "string" && SEMVER.test(input.version) ? input.version : fail("UltraRun.version is invalid", "ULTRA_RUN_INVALID"),
    effort: input.effort,
    routePolicy: {
      singleAgentMaxComplexity: integer(input.routePolicy.singleAgentMaxComplexity, "UltraRun.routePolicy.singleAgentMaxComplexity", 0, 100),
      batchMinItems: integer(input.routePolicy.batchMinItems, "UltraRun.routePolicy.batchMinItems", 2, 1000),
      dynamicGoalRequiresExplicitApproval: true,
    },
    workflowLibrary: idList(input.workflowLibrary, "UltraRun.workflowLibrary", { minimum: 1, maximum: 32 }),
    batchLibrary: idList(input.batchLibrary, "UltraRun.batchLibrary", { minimum: 1, maximum: 32 }),
    goalLibrary: idList(input.goalLibrary, "UltraRun.goalLibrary", { minimum: 1, maximum: 32 }),
    quality: {
      freshVerifier: true,
      testGate: id(input.quality.testGate, "UltraRun.quality.testGate"),
      integrationGate: id(input.quality.integrationGate, "UltraRun.quality.integrationGate"),
    },
    budgetRef: id(input.budgetRef, "UltraRun.budgetRef"),
    approvalPolicy: ["exact-mutating-revision", "always-explicit"].includes(input.approvalPolicy) ? input.approvalPolicy : fail("UltraRun.approvalPolicy is invalid", "ULTRA_RUN_INVALID"),
  };
  return immutable(value);
}

function normalizeRequest(raw) {
  exact(raw, ["id", "taskDigest", "complexity", "itemCount", "homogeneous", "dynamicGoal", "mutation", "risk", "origin", "preferredWorkflow", "preferredBatch", "preferredGoal"], "UltraRun request");
  exact(raw.origin, ["kind", "requestDigest"], "UltraRun request.origin");
  if (!["human", "automation"].includes(raw.origin.kind)) fail("request origin is invalid", "ULTRA_RUN_INVALID");
  if (!["none", "guarded"].includes(raw.mutation)) fail("request mutation is invalid", "ULTRA_RUN_INVALID");
  if (!["low", "medium", "high", "critical"].includes(raw.risk)) fail("request risk is invalid", "ULTRA_RUN_INVALID");
  if (typeof raw.homogeneous !== "boolean" || typeof raw.dynamicGoal !== "boolean") fail("request routing flags must be booleans", "ULTRA_RUN_INVALID");
  return immutable({
    id: id(raw.id, "request.id"),
    taskDigest: sha(raw.taskDigest, "request.taskDigest"),
    complexity: integer(raw.complexity, "request.complexity", 0, 100),
    itemCount: integer(raw.itemCount, "request.itemCount", 0, 1000),
    homogeneous: raw.homogeneous,
    dynamicGoal: raw.dynamicGoal,
    mutation: raw.mutation,
    risk: raw.risk,
    origin: { kind: raw.origin.kind, requestDigest: sha(raw.origin.requestDigest, "request.origin.requestDigest") },
    ...(raw.preferredWorkflow === undefined ? {} : { preferredWorkflow: id(raw.preferredWorkflow, "request.preferredWorkflow") }),
    ...(raw.preferredBatch === undefined ? {} : { preferredBatch: id(raw.preferredBatch, "request.preferredBatch") }),
    ...(raw.preferredGoal === undefined ? {} : { preferredGoal: id(raw.preferredGoal, "request.preferredGoal") }),
  });
}

function selectAllowed(preferred, library, label) {
  const selected = preferred ?? library[0];
  if (!library.includes(selected)) fail(`${label} is outside the UltraRun library`, "ULTRA_RUN_ROUTE_OUTSIDE_LIBRARY", { selected });
  return selected;
}

function routeFor(definition, request) {
  if (request.dynamicGoal) return "swarm-goal";
  if (request.homogeneous && request.itemCount >= definition.routePolicy.batchMinItems) return "batch-swarm";
  if (request.complexity <= definition.routePolicy.singleAgentMaxComplexity && request.itemCount <= 1) return "agent";
  return "workflow";
}

function phasesFor(route, quality) {
  const ids = route === "agent"
    ? ["u0-bind", "u1-understand", "u4-verify", "u6-final"]
    : route === "batch-swarm"
      ? ["u0-bind", "u1-understand", "u2-plan", "u3-change", "u4-verify", "u6-final"]
      : route === "workflow"
        ? ["u0-bind", "u1-understand", "u2-plan", "u3-change", "u4-verify", "u5-repair", "u6-final"]
        : ULTRA_PHASE_LIBRARY.map((phase) => phase.id);
  const beforeFinal = ids.filter((phase) => phase !== "u6-final");
  return beforeFinal.slice(0, Math.max(0, quality.maxPhases - 1)).concat("u6-final");
}

function scaleFor(route, request, definition) {
  const logicalAssignments = route === "agent" ? 2
    : route === "batch-swarm" ? request.itemCount + 1
      : route === "workflow" ? Math.max(3, Math.ceil(request.complexity / 20))
        : Math.max(3, Math.ceil(request.complexity / 10));
  return {
    logicalAssignments,
    maximumPlanRevisions: route === "swarm-goal" ? 4 : 1,
    workflowRuns: route === "agent" ? 0 : route === "swarm-goal" ? 4 : 1,
    estimatedParallelism: route === "batch-swarm" ? Math.min(request.itemCount, 16) : route === "swarm-goal" ? Math.min(logicalAssignments, 8) : 1,
    budgetRef: definition.budgetRef,
    costVisibility: "REQUIRED",
  };
}

export function planUltraRun(definitionInput, requestInput) {
  const definition = assertUltraRunDefinition(definitionInput);
  const request = normalizeRequest(requestInput);
  const route = routeFor(definition, request);
  if (!ROUTES.has(route)) fail("UltraRun selected an unknown route", "ULTRA_RUN_ROUTE_INVALID");
  const routeRef = route === "agent" ? null
    : route === "batch-swarm" ? selectAllowed(request.preferredBatch, definition.batchLibrary, "BatchSwarm")
      : route === "workflow" ? selectAllowed(request.preferredWorkflow, definition.workflowLibrary, "Workflow")
        : selectAllowed(request.preferredGoal, definition.goalLibrary, "SwarmGoal");
  const qualityPolicy = QUALITY_POLICIES[definition.effort];
  const highRisk = route === "swarm-goal" || request.mutation === "guarded" || ["high", "critical"].includes(request.risk);
  const plan = {
    formatVersion: 1,
    kind: "ultra-run-plan",
    id: `${definition.id}:${request.id}`,
    strategyId: definition.id,
    effort: definition.effort,
    request,
    route,
    routeRef,
    phases: phasesFor(route, qualityPolicy),
    quality: {
      ...qualityPolicy,
      freshVerifier: true,
      testGate: definition.quality.testGate,
      integrationGate: definition.quality.integrationGate,
    },
    scale: scaleFor(route, request, definition),
    approval: {
      policy: definition.approvalPolicy,
      required: highRisk || definition.approvalPolicy === "always-explicit",
      humanOriginRequired: route === "swarm-goal",
    },
  };
  return immutable({ ...plan, planDigest: digestValue(plan) });
}

export function createUltraRunAuthorization(plan, nonce) {
  if (plan?.kind !== "ultra-run-plan" || !SHA256.test(plan.planDigest ?? "")) throw new TypeError("UltraRunPlan is required");
  const value = {
    formatVersion: 1,
    kind: "human-ultra-run-authorization",
    planDigest: plan.planDigest,
    requestDigest: plan.request.origin.requestDigest,
    nonce: id(nonce, "authorization nonce"),
  };
  return immutable({ ...value, authorizationDigest: digestValue(value) });
}

function assertAuthorization(plan, authorization) {
  if (!plan.approval.required) return null;
  if (!object(authorization)) fail("UltraRun route requires explicit authorization", "ULTRA_RUN_AUTHORIZATION_REQUIRED");
  exact(authorization, ["formatVersion", "kind", "planDigest", "requestDigest", "nonce", "authorizationDigest"], "UltraRun authorization");
  const expected = createUltraRunAuthorization(plan, authorization.nonce);
  if (digestValue(expected) !== digestValue(authorization)) fail("UltraRun authorization drifted from the exact route plan", "ULTRA_RUN_AUTHORIZATION_DRIFT");
  if (plan.approval.humanOriginRequired && plan.request.origin.kind !== "human") fail("dynamic SwarmGoal routes require human origin", "ULTRA_RUN_HUMAN_ORIGIN_REQUIRED");
  return expected;
}

export function createUltraRunRouter(options = {}) {
  const executors = options.executors ?? {};

  async function run(definition, request, runOptions = {}) {
    const plan = planUltraRun(definition, request);
    const authorization = assertAuthorization(plan, runOptions.authorization);
    const execute = executors[plan.route];
    if (typeof execute !== "function") fail(`UltraRun route ${plan.route} is unavailable`, "ULTRA_RUN_ROUTE_UNAVAILABLE", { route: plan.route });
    const result = await execute({ runId: plan.request.id, plan, authorization, input: runOptions.input ?? {}, signal: runOptions.signal });
    if (!object(result) || !["completed", "failed", "interrupted", "awaiting-approval"].includes(result.status)) fail("UltraRun executor returned an invalid result", "ULTRA_RUN_EXECUTION_INVALID");
    if (result.status !== "completed") return immutable({ plan, result });
    if (!object(result.verification)
      || result.verification.contextMode !== "fresh"
      || result.verification.verdict !== "pass"
      || !SHA256.test(result.verification.receiptDigest ?? "")) {
      fail("UltraRun cannot complete without a passing fresh verifier", "ULTRA_RUN_FINAL_VERIFIER_FAILED");
    }
    if (!object(result.scale)
      || !Number.isSafeInteger(result.scale.logicalAssignments)
      || result.scale.logicalAssignments !== plan.scale.logicalAssignments
      || result.scale.costVisibility !== "VISIBLE") {
      fail("UltraRun executor omitted scale/cost evidence", "ULTRA_RUN_SCALE_EVIDENCE_REQUIRED");
    }
    return immutable({ plan, result });
  }

  return Object.freeze({ plan: planUltraRun, run });
}

export function ultraQualityPolicy(effort) {
  if (!Object.hasOwn(QUALITY_POLICIES, effort)) throw new TypeError("unknown UltraRun effort");
  return QUALITY_POLICIES[effort];
}
