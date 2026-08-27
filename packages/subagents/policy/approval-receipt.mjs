import { canonicalJson, jsonClone, sha256 } from "../state/codec.mjs";
import {
  digestWorkflowPolicyEnvelope,
  digestWorkflowValue,
  effectiveWorkflowPolicyEnvelope,
  validateWorkflowPlan,
} from "../workflow/plan-compiler/index.mjs";

const SCHEMA = "https://github.com/Ricardo121380/only-my-pi/schemas/approval-receipt-v1.schema.json";
const SCHEMA_BASENAME = "approval-receipt-v1.schema.json";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const RELATIVE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\u0000]+$/u;
const TOP_LEVEL_KEYS = new Set(["$schema", "formatVersion", "contractStatus", "kind", "planDigest", "parentRevisionDigest", "repo", "effectivePolicyHash", "capabilityEnvelopeHash", "executionEnvelopeDigest", "budgetEnvelopeHash", "scope", "origin", "approvedAt", "approvedPlanRevision", "replanEnvelopeDigest", "receiptId"]);
const REPO_KEYS = new Set(["identity", "baseCommit", "allowedPaths", "writerClaims"]);
const SCOPE_KEYS = new Set(["mutation", "integration", "delivery", "maxAssignments", "maxActiveChildren"]);

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) immutable(child);
  return value;
}

function exactKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

function pathEntries(value) {
  return Array.isArray(value)
    && value.length <= 256
    && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 1024 && RELATIVE_PATH.test(entry));
}

function normalizedPath(value) {
  return value.replace(/\/$/u, "");
}

function pathPrefixOverlap(value) {
  if (!Array.isArray(value)) return null;
  for (let left = 0; left < value.length; left += 1) {
    const a = normalizedPath(value[left]);
    for (let right = left + 1; right < value.length; right += 1) {
      const b = normalizedPath(value[right]);
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return { left, right, paths: [value[left], value[right]] };
    }
  }
  return null;
}

function paths(value) {
  return pathEntries(value)
    && new Set(value).size === value.length
    && pathPrefixOverlap(value) === null;
}

function pathClaimCovered(claim, allowedPaths = []) {
  return allowedPaths.some((allowed) => {
    const prefix = allowed.replace(/\/$/u, "");
    return claim === allowed || claim.startsWith(`${prefix}/`);
  });
}

export function approvalReceiptSemanticFindings(receipt) {
  const findings = [];
  if (receipt?.scope?.maxActiveChildren > receipt?.scope?.maxAssignments) {
    findings.push({
      instancePath: "/scope/maxActiveChildren",
      keyword: "budget-envelope",
      code: "APPROVAL_ACTIVE_CHILDREN_EXCEED_ASSIGNMENTS",
      message: "approved active children exceed approved total assignments",
      params: {},
    });
  }
  for (const [field, code] of [
    ["allowedPaths", "APPROVAL_ALLOWED_PATHS_OVERLAP"],
    ["writerClaims", "APPROVAL_WRITER_CLAIMS_OVERLAP"],
  ]) {
    const overlap = pathPrefixOverlap(receipt?.repo?.[field]);
    if (overlap) {
      findings.push({
        instancePath: `/repo/${field}/${overlap.right}`,
        keyword: "path-overlap",
        code,
        message: `${field} must not contain equal or prefix-overlapping paths: ${overlap.paths.join(", ")}`,
        params: { paths: overlap.paths },
      });
    }
  }
  if (receipt?.scope?.mutation === "guarded" && (receipt?.repo?.allowedPaths?.length ?? 0) === 0) {
    findings.push({
      instancePath: "/repo/allowedPaths",
      keyword: "approval-path-scope",
      code: "APPROVAL_MUTATING_ALLOWED_PATHS_REQUIRED",
      message: "mutation:guarded approval requires at least one allowed path",
      params: {},
    });
  }
  if (receipt?.scope?.mutation === "guarded" && (receipt?.repo?.writerClaims?.length ?? 0) === 0) {
    findings.push({
      instancePath: "/repo/writerClaims",
      keyword: "approval-path-scope",
      code: "APPROVAL_MUTATING_WRITER_CLAIMS_REQUIRED",
      message: "mutation:guarded approval requires at least one writer claim",
      params: {},
    });
  }
  for (const [position, claim] of (receipt?.repo?.writerClaims ?? []).entries()) {
    if (!pathClaimCovered(claim, receipt?.repo?.allowedPaths ?? [])) {
      findings.push({
        instancePath: `/repo/writerClaims/${position}`,
        keyword: "path-claim",
        code: "APPROVAL_WRITER_CLAIM_OUTSIDE_PATHS",
        message: `writer claim is outside approved paths: ${claim}`,
        params: { claim },
      });
    }
  }
  if (receipt?.scope?.mutation === "none" && (receipt?.repo?.writerClaims?.length ?? 0) > 0) {
    findings.push({
      instancePath: "/repo/writerClaims",
      keyword: "approval-scope",
      code: "APPROVAL_READ_ONLY_WRITER_CLAIMS",
      message: "mutation:none approval cannot contain writer claims",
      params: {},
    });
  }
  if (receipt?.scope?.mutation === "none" && receipt?.scope?.delivery !== "local") {
    findings.push({
      instancePath: "/scope/delivery",
      keyword: "approval-scope",
      code: "APPROVAL_READ_ONLY_DELIVERY",
      message: "mutation:none approval cannot authorize commit or push delivery",
      params: {},
    });
  }
  return Object.freeze(findings.map((finding) => Object.freeze(finding)));
}

function defaultScope(plan) {
  const envelope = effectiveWorkflowPolicyEnvelope(plan);
  const mutation = envelope.nodes.some((node) => node.policy.mutation === "guarded") ? "guarded" : "none";
  return {
    mutation,
    integration: mutation === "guarded" ? "serial" : "none",
    delivery: "local",
    maxAssignments: plan.budget.maxAssignments,
    maxActiveChildren: Math.min(plan.budget.maxParallel, plan.budget.maxAssignments),
  };
}

function planScopeFinding(plan, scope) {
  const required = defaultScope(plan);
  for (const key of ["mutation", "integration", "maxAssignments", "maxActiveChildren"]) {
    if (scope?.[key] !== required[key]) {
      return {
        code: "APPROVAL_SCOPE_PLAN_DRIFT",
        message: `approval scope ${key} does not match the complete effective plan envelope`,
      };
    }
  }
  return null;
}

function receiptPayload(receipt) {
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "receiptId"));
}

function approvalError(code, message) {
  return Object.freeze({ ok: false, code, message });
}

function validSchemaReference(value) {
  return value === SCHEMA || value === SCHEMA_BASENAME;
}

function validApprovedAt(value) {
  return typeof value === "string"
    && RFC3339_DATE_TIME.test(value)
    && Number.isFinite(Date.parse(value));
}

export function approvalReceiptId(receipt) {
  return sha256(canonicalJson(receiptPayload(receipt)));
}

export function createApprovalReceipt({ plan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, scope, origin = "interactive-user", approvedAt = new Date().toISOString(), replanEnvelopeDigest = null } = {}) {
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) throw new TypeError(`approval plan is invalid: ${checked.errors[0].message}`);
  if (!exactKeys(repo, REPO_KEYS) || typeof repo.identity !== "string" || repo.identity.length === 0 || repo.identity.length > 512 || !COMMIT.test(repo.baseCommit ?? "") || !pathEntries(repo.allowedPaths) || !pathEntries(repo.writerClaims)) {
    throw new TypeError("approval repo evidence is invalid");
  }
  if (!SHA256.test(capabilityEnvelopeHash ?? "")) throw new TypeError("capabilityEnvelopeHash must be sha256");
  if (!SHA256.test(executionEnvelopeDigest ?? "")) throw new TypeError("executionEnvelopeDigest must be sha256");
  const resolvedScope = scope ?? defaultScope(plan);
  if (!exactKeys(resolvedScope, SCOPE_KEYS)) throw new TypeError("approval scope is invalid");
  const receipt = {
    $schema: SCHEMA,
    formatVersion: 1,
    contractStatus: "contract-preview",
    kind: "approval-receipt",
    planDigest: plan.planDigest,
    parentRevisionDigest: plan.revision.parentPlanDigest,
    repo: jsonClone(repo),
    effectivePolicyHash: digestWorkflowPolicyEnvelope(plan),
    capabilityEnvelopeHash,
    executionEnvelopeDigest,
    budgetEnvelopeHash: digestWorkflowValue(plan.budget),
    scope: jsonClone(resolvedScope),
    origin,
    approvedAt,
    approvedPlanRevision: plan.revision.number,
    replanEnvelopeDigest,
  };
  receipt.receiptId = approvalReceiptId(receipt);
  const verdict = validateApprovalReceipt(receipt, { plan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest, expectedScope: resolvedScope });
  if (!verdict.ok) throw new TypeError(`created approval receipt is invalid: ${verdict.code}`);
  return immutable(receipt);
}

export function validateApprovalReceipt(receipt, { plan, expectedRepo, expectedCapabilityEnvelopeHash, expectedExecutionEnvelopeDigest, expectedScope } = {}) {
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) return approvalError("APPROVAL_PLAN_INVALID", checked.errors[0].message);
  if (!exactKeys(receipt, TOP_LEVEL_KEYS) || !validSchemaReference(receipt.$schema) || receipt.formatVersion !== 1 || receipt.contractStatus !== "contract-preview" || receipt.kind !== "approval-receipt") {
    return approvalError("APPROVAL_SHAPE_INVALID", "approval receipt has an unknown or missing field");
  }
  if (!exactKeys(receipt.repo, REPO_KEYS) || typeof receipt.repo.identity !== "string" || receipt.repo.identity.length === 0 || receipt.repo.identity.length > 512 || !COMMIT.test(receipt.repo.baseCommit ?? "") || !pathEntries(receipt.repo.allowedPaths) || !pathEntries(receipt.repo.writerClaims)) {
    return approvalError("APPROVAL_REPO_INVALID", "approval repository evidence is invalid");
  }
  if (!exactKeys(receipt.scope, SCOPE_KEYS)
    || !["none", "guarded"].includes(receipt.scope.mutation)
    || !["none", "serial"].includes(receipt.scope.integration)
    || !["local", "commit", "push"].includes(receipt.scope.delivery)
    || !Number.isSafeInteger(receipt.scope.maxAssignments) || receipt.scope.maxAssignments < 0
    || !Number.isSafeInteger(receipt.scope.maxActiveChildren) || receipt.scope.maxActiveChildren < 0) {
    return approvalError("APPROVAL_SCOPE_INVALID", "approval scope is invalid");
  }
  const semanticFindings = approvalReceiptSemanticFindings(receipt);
  if (semanticFindings.length > 0) return approvalError(semanticFindings[0].code, semanticFindings[0].message);
  if (!paths(receipt.repo.allowedPaths) || !paths(receipt.repo.writerClaims)) return approvalError("APPROVAL_REPO_INVALID", "approval repository paths must be unique and non-overlapping");
  const planScope = planScopeFinding(plan, receipt.scope);
  if (planScope) return approvalError(planScope.code, planScope.message);
  for (const value of [receipt.planDigest, receipt.effectivePolicyHash, receipt.capabilityEnvelopeHash, receipt.executionEnvelopeDigest, receipt.budgetEnvelopeHash, receipt.receiptId]) {
    if (!SHA256.test(value ?? "")) return approvalError("APPROVAL_DIGEST_INVALID", "approval digest is invalid");
  }
  if (receipt.parentRevisionDigest !== null && !SHA256.test(receipt.parentRevisionDigest ?? "")) return approvalError("APPROVAL_DIGEST_INVALID", "parent revision digest is invalid");
  if (receipt.replanEnvelopeDigest !== null && !SHA256.test(receipt.replanEnvelopeDigest ?? "")) return approvalError("APPROVAL_DIGEST_INVALID", "replan envelope digest is invalid");
  if (!["interactive-user", "explicit-cli-yes"].includes(receipt.origin) || !validApprovedAt(receipt.approvedAt)) return approvalError("APPROVAL_ORIGIN_INVALID", "approval origin or timestamp is invalid");
  if (approvalReceiptId(receipt) !== receipt.receiptId) return approvalError("APPROVAL_RECEIPT_TAMPERED", "approval receipt digest does not match its content");
  if (receipt.planDigest !== plan.planDigest) return approvalError("APPROVAL_PLAN_DRIFT", "approval plan digest differs");
  if (receipt.parentRevisionDigest !== plan.revision.parentPlanDigest || receipt.approvedPlanRevision !== plan.revision.number) return approvalError("APPROVAL_REVISION_DRIFT", "approval revision differs");
  if (receipt.effectivePolicyHash !== digestWorkflowPolicyEnvelope(plan)) return approvalError("APPROVAL_POLICY_DRIFT", "approval effective node policy envelope differs");
  if (receipt.budgetEnvelopeHash !== digestWorkflowValue(plan.budget)) return approvalError("APPROVAL_BUDGET_DRIFT", "approval budget digest differs");
  if (expectedRepo === undefined || expectedCapabilityEnvelopeHash === undefined || expectedExecutionEnvelopeDigest === undefined) return approvalError("APPROVAL_CONTEXT_UNAVAILABLE", "runtime repository, capability, and execution evidence are required");
  if (canonicalJson(receipt.repo) !== canonicalJson(expectedRepo)) return approvalError("APPROVAL_REPO_DRIFT", "approval repository evidence differs");
  if (receipt.capabilityEnvelopeHash !== expectedCapabilityEnvelopeHash) return approvalError("APPROVAL_CAPABILITY_DRIFT", "approval capability envelope differs");
  if (receipt.executionEnvelopeDigest !== expectedExecutionEnvelopeDigest) return approvalError("APPROVAL_EXECUTION_DRIFT", "approval execution envelope differs");
  const resolvedScope = expectedScope ?? defaultScope(plan);
  if (canonicalJson(receipt.scope) !== canonicalJson(resolvedScope)) return approvalError("APPROVAL_SCOPE_DRIFT", "approval scope differs");
  return Object.freeze({ ok: true, receiptDigest: receipt.receiptId });
}

export function createApprovalVerifier({ repo, capabilityEnvelopeHash, executionEnvelopeDigest, expectedExecutionEnvelopeDigest, scope } = {}) {
  const configuredExecutionDigest = expectedExecutionEnvelopeDigest ?? executionEnvelopeDigest;
  const context = (runtime = {}) => ({
    expectedRepo: runtime.expectedRepo ?? runtime.repo ?? repo,
    expectedCapabilityEnvelopeHash: runtime.expectedCapabilityEnvelopeHash ?? runtime.capabilityEnvelopeHash ?? capabilityEnvelopeHash,
    expectedExecutionEnvelopeDigest: runtime.expectedExecutionEnvelopeDigest ?? runtime.executionEnvelopeDigest ?? configuredExecutionDigest,
    expectedScope: runtime.expectedScope ?? runtime.scope ?? scope,
  });
  return Object.freeze({
    verify(receipt, plan, runtime = {}) {
      const expected = context(runtime);
      return validateApprovalReceipt(receipt, { plan, ...expected, expectedScope: expected.expectedScope ?? (plan ? defaultScope(plan) : undefined) });
    },
    verifyNode(receipt, approval, plan, runtime = {}) {
      const expected = context(runtime);
      const root = validateApprovalReceipt(receipt, { plan, ...expected, expectedScope: expected.expectedScope ?? (plan ? defaultScope(plan) : undefined) });
      if (!root.ok) return root;
      const bound = plan.nodes.some((node) => node.kind === "approval" && node.approval?.scopeDigest === approval?.scopeDigest);
      return bound ? root : approvalError("NODE_APPROVAL_SCOPE_DRIFT", "approval node is not bound by the approved plan");
    },
  });
}

export const APPROVAL_RECEIPT_SCHEMA = SCHEMA;
