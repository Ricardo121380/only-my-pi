import {
  buildProtectedLiveEvidenceDocument,
  createProtectedLiveCaptureRecord,
  validateProtectedLiveCaptureRecord,
} from "./live-evidence-capture.mjs";
import {
  validateBackgroundResumeAuthorization,
} from "./background-resume-authorization.mjs";
import { jsonClone } from "../state/codec.mjs";

export const SUBAGENTS_BACKGROUND_RESUME_SCENARIO_SHAPES = Object.freeze({
  "background-resume": Object.freeze({ children: 2, concurrency: 1 }),
});

export class BackgroundResumeCaptureError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents background resume capture: ${message}`);
    this.name = "BackgroundResumeCaptureError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new BackgroundResumeCaptureError(message, code, details);
}

export function validateBackgroundResumeCaptureRecord(record, context = {}) {
  return validateProtectedLiveCaptureRecord(record, {
    ...context,
    authorizationValidator: validateBackgroundResumeAuthorization,
    scenarioShapes: SUBAGENTS_BACKGROUND_RESUME_SCENARIO_SHAPES,
  });
}

export function createBackgroundResumeCapturePlan({
  authorization = null,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  now,
} = {}) {
  const base = {
    formatVersion: 1,
    operation: "protected-background-resume-capture",
    providerRequest: "NOT_STARTED",
    childDispatch: "NOT_STARTED",
    parentProcessCount: 2,
    signerInvocation: "NOT_STARTED",
    realPiHome: "NOT_TOUCHED",
    mutation: "NOT_RUN_BY_POLICY",
  };
  if (authorization === null) {
    return Object.freeze({ ...base, status: "AUTHORIZATION_REQUIRED", runnable: false, evidenceIds: [] });
  }
  try {
    const checked = validateBackgroundResumeAuthorization(authorization, {
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
      evidenceIds: Object.freeze(["background-resume"]),
      limits: Object.freeze(jsonClone(checked.limits)),
    });
  } catch (cause) {
    return Object.freeze({
      ...base,
      status: cause?.code ?? "AUTHORIZATION_INVALID",
      runnable: false,
      evidenceIds: Object.freeze(["background-resume"]),
    });
  }
}

export async function captureProtectedBackgroundResumeEvidence({
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
  const checkedAuthorization = validateBackgroundResumeAuthorization(authorization, {
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
    now,
  });
  const compatibilityRow = matrix.rows.find((row) => row.id === checkedAuthorization.compatibilityRowId);
  if (!compatibilityRow) fail("authorized compatibility row is unavailable", "CAPTURE_COMPATIBILITY_ROW_MISSING");
  const raw = await scenarioRunner({
    id: "background-resume",
    authorization: checkedAuthorization,
    expectedSourceCommit,
    compatibilityRowId: checkedAuthorization.compatibilityRowId,
    environment: jsonClone(compatibilityRow.environment),
    scenarioLimits: Object.freeze(jsonClone(checkedAuthorization.limits)),
  });
  const context = {
    authorization: checkedAuthorization,
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
  };
  const record = validateBackgroundResumeCaptureRecord(raw, context);
  const document = await buildProtectedLiveEvidenceDocument(record, context, signer);
  return Object.freeze({
    formatVersion: 1,
    status: "PROTECTED_LIVE_EVIDENCE_CAPTURED",
    authorizationId: checkedAuthorization.authorizationId,
    authorizationDigest: checkedAuthorization.authorizationDigest,
    sourceCommit: expectedSourceCommit,
    usage: Object.freeze({ ...record.usage }),
    records: Object.freeze({ "background-resume": record }),
    evidence: Object.freeze({ "background-resume": document }),
  });
}

export { createProtectedLiveCaptureRecord };
