import crypto from "node:crypto";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BUDGET_FIELDS = Object.freeze(["maxAssignments", "maxCostUsd", "maxDepth", "maxNodes", "maxOutputBytes", "maxParallel", "maxTokens", "maxWallTimeMs"]);

function fail(code, message, details = {}) { const error = new Error(message); error.code = code; Object.assign(error, details); throw error; }
function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])); return value; }
function digest(value) { return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`; }
function idSet(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !ID.test(value))) fail("GOAL_AUTHORITY_INVALID", `${label} must be an array of canonical identifiers`);
  return [...new Set(values)].sort();
}
function normalizeBudget(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("GOAL_AUTHORITY_INVALID", `${label} must be an object`);
  const result = {};
  for (const field of BUDGET_FIELDS) {
    const raw = value[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) fail("GOAL_AUTHORITY_INVALID", `${label}.${field} must be non-negative`);
    result[field] = raw;
  }
  return result;
}

export function createGoalAuthorityGrant(input = {}) {
  if (typeof input.runId !== "string" || !ID.test(input.runId) || typeof input.objectiveDigest !== "string" || !SHA256.test(input.objectiveDigest)) fail("GOAL_AUTHORITY_INVALID", "runId and objectiveDigest are required");
  if (!Number.isSafeInteger(input.maxRevisions) || input.maxRevisions < 1 || input.maxRevisions > 16) fail("GOAL_AUTHORITY_INVALID", "maxRevisions must be 1..16");
  const value = {
    formatVersion: 1,
    kind: "goal-authority-grant",
    runId: input.runId,
    objectiveDigest: input.objectiveDigest,
    allowedRoles: idSet(input.allowedRoles ?? [], "allowedRoles"),
    allowedModels: idSet(input.allowedModels ?? [], "allowedModels"),
    overlays: idSet(input.overlays ?? [], "overlays"),
    scope: idSet(input.scope ?? [], "scope"),
    web: input.web === true,
    mutation: input.mutation === "none" ? "none" : fail("GOAL_AUTHORITY_INVALID", "M8 Goal authority mutation must be none"),
    maxRevisions: input.maxRevisions,
    budget: normalizeBudget(input.budget ?? {}, "budget"),
  };
  return Object.freeze({ ...value, grantDigest: digest(value) });
}

export function projectGoalRevisionAuthority(proposal, options = {}) {
  if (!proposal || typeof proposal !== "object" || !proposal.plan || !Array.isArray(proposal.agentSpecs)) fail("GOAL_REVISION_AUTHORITY_INVALID", "resolved proposal is required");
  return Object.freeze({
    revision: proposal.revision,
    roles: [...new Set(proposal.agentSpecs.map((spec) => spec.templateId))].sort(),
    models: [...new Set(proposal.agentSpecs.map((spec) => spec.model?.provider && spec.model?.id ? `${spec.model.provider}:${spec.model.id}` : `role:${spec.model?.role ?? "inherit"}`))].sort(),
    overlays: idSet(options.overlays ?? [], "proposal overlays"),
    scope: idSet(options.scope ?? [], "proposal scope"),
    web: proposal.plan.policy?.egress?.web !== "deny",
    mutation: proposal.plan.policy?.mutation ?? "none",
    budget: normalizeBudget(proposal.plan.budget ?? {}, "proposal budget"),
  });
}

export function assessGoalRevisionAuthority(grant, projection) {
  const expansions = [];
  const subset = (values, allowed, kind) => values.filter((value) => !allowed.includes(value)).forEach((value) => expansions.push({ kind, value }));
  subset(projection.roles, grant.allowedRoles, "role");
  subset(projection.models, grant.allowedModels, "model");
  subset(projection.overlays, grant.overlays, "overlay");
  subset(projection.scope, grant.scope, "scope");
  if (projection.web && !grant.web) expansions.push({ kind: "web", value: true });
  if (projection.mutation !== "none") expansions.push({ kind: "mutation", value: projection.mutation });
  if (!Number.isSafeInteger(projection.revision) || projection.revision < 0 || projection.revision >= grant.maxRevisions) expansions.push({ kind: "revision", value: projection.revision });
  for (const [field, value] of Object.entries(projection.budget)) {
    const limit = grant.budget[field];
    if (limit === undefined || value > limit) expansions.push({ kind: "budget", value: field, requested: value, allowed: limit ?? null });
  }
  return Object.freeze({ ok: expansions.length === 0, status: expansions.length === 0 ? "GOAL_REVISION_AUTHORIZED" : "GOAL_REVISION_REAPPROVAL_REQUIRED", requiresApproval: expansions.length > 0, expansions: Object.freeze(expansions), projectionDigest: digest(projection), grantDigest: grant.grantDigest });
}

export function createGoalRevisionApproval(grant, projection, nonce) {
  if (typeof nonce !== "string" || !ID.test(nonce)) fail("GOAL_REVISION_APPROVAL_INVALID", "approval nonce is invalid");
  const value = { formatVersion: 1, kind: "goal-revision-approval", priorGrantDigest: grant.grantDigest, projectionDigest: digest(projection), nonce };
  return Object.freeze({ ...value, approvalDigest: digest(value) });
}

export class GoalRevisionAuthorizer {
  constructor(grant) { this.grant = createGoalAuthorityGrant(grant); }
  assess(proposal, options) { const projection = projectGoalRevisionAuthority(proposal, options); return Object.freeze({ projection, ...assessGoalRevisionAuthority(this.grant, projection) }); }
  createApproval(proposal, nonce, options = {}) { return createGoalRevisionApproval(this.grant, projectGoalRevisionAuthority(proposal, options), nonce); }
  approve(proposal, approval, options = {}) {
    const projection = projectGoalRevisionAuthority(proposal, options);
    const expected = createGoalRevisionApproval(this.grant, projection, approval?.nonce);
    if (expected.approvalDigest !== approval?.approvalDigest) fail("GOAL_REVISION_APPROVAL_DRIFT", "Goal revision approval does not match the proposed expansion");
    this.grant = createGoalAuthorityGrant({
      runId: this.grant.runId,
      objectiveDigest: this.grant.objectiveDigest,
      allowedRoles: [...new Set([...this.grant.allowedRoles, ...projection.roles])],
      allowedModels: [...new Set([...this.grant.allowedModels, ...projection.models])],
      overlays: [...new Set([...this.grant.overlays, ...projection.overlays])],
      scope: [...new Set([...this.grant.scope, ...projection.scope])],
      web: this.grant.web || projection.web,
      mutation: "none",
      maxRevisions: this.grant.maxRevisions,
      budget: Object.fromEntries(BUDGET_FIELDS.map((field) => [field, Math.max(this.grant.budget[field] ?? 0, projection.budget[field] ?? 0)])),
    });
    return this.grant;
  }
}

export function createGoalRevisionAuthorizer(grant) { return new GoalRevisionAuthorizer(grant); }
