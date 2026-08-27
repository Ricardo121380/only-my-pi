import {
  buildProtectedLiveEvidenceDocument,
  createProtectedLiveCaptureRecord,
  validateProtectedLiveCaptureRecord,
} from "./live-evidence-capture.mjs";
import {
  validateGuardedWriterAuthorization,
} from "./guarded-writer-authorization.mjs";
import { jsonClone } from "../state/codec.mjs";

export const SUBAGENTS_GUARDED_WRITER_SCENARIO_SHAPES = Object.freeze({
  "guarded-writer-integration": Object.freeze({ children: 1, concurrency: 1 }),
});

export class GuardedWriterCaptureError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents guarded writer capture: ${message}`);
    this.name = "GuardedWriterCaptureError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new GuardedWriterCaptureError(message, code, details);
}

export function validateGuardedWriterCaptureRecord(record, context = {}) {
  return validateProtectedLiveCaptureRecord(record, {
    ...context,
    authorizationValidator: validateGuardedWriterAuthorization,
    scenarioShapes: SUBAGENTS_GUARDED_WRITER_SCENARIO_SHAPES,
  });
}

export function createGuardedWriterCapturePlan({
  authorization = null,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  now,
} = {}) {
  const base = {
    formatVersion: 1,
    operation: "protected-guarded-writer-capture",
    providerRequest: "NOT_STARTED",
    childDispatch: "NOT_STARTED",
    signerInvocation: "NOT_STARTED",
    realPiHome: "NOT_TOUCHED",
    sourceRepositoryMutation: "NOT_RUN_BY_POLICY",
    automaticIntegration: false,
    parentDiffVerification: "REQUIRED",
  };
  if (authorization === null) {
    return Object.freeze({ ...base, status: "AUTHORIZATION_REQUIRED", runnable: false, evidenceIds: [] });
  }
  try {
    const checked = validateGuardedWriterAuthorization(authorization, {
      matrix,
      policy,
      trustPolicy,
      expectedSourceCommit,
      now,
    });
    return Object.freeze({
      ...base,
      status: "READY_WITH_EXPLICIT_OPERATOR_AUTHORIZATION",
      runnable: true,
      authorizationId: checked.authorizationId,
      authorizationDigest: checked.authorizationDigest,
      sourceCommit: checked.sourceCommit,
      compatibilityRowId: checked.compatibilityRowId,
      evidenceIds: Object.freeze(["guarded-writer-integration"]),
      limits: Object.freeze(jsonClone(checked.limits)),
      writer: Object.freeze(jsonClone(checked.writer)),
    });
  } catch (cause) {
    return Object.freeze({
      ...base,
      status: cause?.code ?? "AUTHORIZATION_INVALID",
      runnable: false,
      evidenceIds: Object.freeze(["guarded-writer-integration"]),
    });
  }
}

export async function captureProtectedGuardedWriterEvidence({
  authorization,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  scenarioRunner,
  signer,
  now,
} = {}) {
  if (typeof scenarioRunner !== "function") throw new TypeError("scenarioRunner must be a function");
  if (typeof signer !== "function") throw new TypeError("signer must be a function");
  const checkedAuthorization = validateGuardedWriterAuthorization(authorization, {
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
    now,
  });
  const compatibilityRow = matrix.rows.find((row) => row.id === checkedAuthorization.compatibilityRowId);
  if (!compatibilityRow) fail("authorized compatibility row is unavailable", "CAPTURE_COMPATIBILITY_ROW_MISSING");
  const raw = await scenarioRunner({
    id: "guarded-writer-integration",
    authorization: checkedAuthorization,
    expectedSourceCommit,
    compatibilityRowId: checkedAuthorization.compatibilityRowId,
    environment: jsonClone(compatibilityRow.environment),
    scenarioLimits: Object.freeze(jsonClone(checkedAuthorization.limits)),
  });
  const context = { authorization: checkedAuthorization, matrix, policy, trustPolicy, expectedSourceCommit };
  const record = validateGuardedWriterCaptureRecord(raw, context);
  const document = await buildProtectedLiveEvidenceDocument(record, context, signer);
  return Object.freeze({
    formatVersion: 1,
    status: "PROTECTED_LIVE_EVIDENCE_CAPTURED",
    authorizationId: checkedAuthorization.authorizationId,
    authorizationDigest: checkedAuthorization.authorizationDigest,
    sourceCommit: expectedSourceCommit,
    usage: Object.freeze({ ...record.usage }),
    records: Object.freeze({ "guarded-writer-integration": record }),
    evidence: Object.freeze({ "guarded-writer-integration": document }),
  });
}

export { createProtectedLiveCaptureRecord };
