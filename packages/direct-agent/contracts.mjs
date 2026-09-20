// @ts-check

const stages = new Set(["PREPARING", "PATCH_CAPTURED", "CLONE_VERIFIED", "REVIEWED", "APPLYING", "APPLICATION_UNKNOWN", "APPLIED_PENDING_VERIFICATION", "VERIFYING", "VERIFIED", "BLOCKED"]);
const applications = new Set(["NOT_STARTED", "UNKNOWN", "APPLIED"]);
const verifications = new Set(["NOT_RUN", "PENDING", "RUNNING", "PASS", "FAIL", "BLOCKED"]);
const digest = /^sha256:[a-f0-9]{64}$/u;
/** @param {string} code @param {string} message */
function invalid(code, message) { throw Object.assign(new Error(message), { code }); }

/** @param {unknown} value @param {unknown} [previous] */
export function validateDirectWriter(value, previous = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer state must be an object");
  const state = /** @type {Record<string, unknown>} */ (value);
  const allowed = ["stage", "application", "verification", "patchDigest", "patch", "receiptDigest", "failureCode", "updatedAt"];
  if (Object.keys(state).some((key) => !allowed.includes(key)) || typeof state.stage !== "string" || !stages.has(state.stage) || typeof state.application !== "string" || !applications.has(state.application) || typeof state.verification !== "string" || !verifications.has(state.verification)) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer state contains invalid fields");
  if (state.patchDigest !== null && (typeof state.patchDigest !== "string" || !digest.test(state.patchDigest))) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer patch digest is invalid");
  if (state.receiptDigest !== null && (typeof state.receiptDigest !== "string" || !digest.test(state.receiptDigest))) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer receipt digest is invalid");
  if (state.failureCode !== null && (typeof state.failureCode !== "string" || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(state.failureCode))) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer failure code is invalid");
  if (typeof state.updatedAt !== "string" || !Number.isFinite(Date.parse(state.updatedAt))) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer timestamp is invalid");
  if ((state.patch === null) !== (state.patchDigest === null) || (state.application !== "NOT_STARTED" && state.patch === null)) invalid("RUN_DIRECT_WRITER_INVALID", "application facts require a paired patch identity and reference");
  if (state.patch !== null) {
    if (!state.patch || typeof state.patch !== "object" || Array.isArray(state.patch)) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer patch reference is invalid");
    const patch = /** @type {Record<string, unknown>} */ (state.patch);
    if (Object.keys(patch).some((key) => !["relativePath", "byteLength", "digest"].includes(key)) || typeof patch.relativePath !== "string" || !/^runs\/[a-z0-9][a-z0-9._:-]{0,127}\/artifacts\/[a-z0-9][a-z0-9._:-]{0,127}\.patch$/u.test(patch.relativePath) || typeof patch.byteLength !== "number" || !Number.isSafeInteger(patch.byteLength) || patch.byteLength < 0 || typeof patch.digest !== "string" || !digest.test(patch.digest) || patch.digest !== state.patchDigest) invalid("RUN_DIRECT_WRITER_INVALID", "direct writer patch reference is invalid");
  }
  if (state.stage === "VERIFIED" && (state.application !== "APPLIED" || state.verification !== "PASS" || !state.receiptDigest)) invalid("RUN_DIRECT_WRITER_INVALID", "verified writer requires applied patch and passing real-workspace receipt");
  if (["PREPARING", "PATCH_CAPTURED", "CLONE_VERIFIED", "REVIEWED", "APPLYING", "BLOCKED"].includes(/** @type {string} */ (state.stage)) && (state.application !== "NOT_STARTED" || state.verification !== "NOT_RUN")) invalid("RUN_DIRECT_WRITER_INVALID", "pre-apply writer state cannot report application or verification");
  if (state.stage === "APPLICATION_UNKNOWN" && (state.application !== "UNKNOWN" || state.verification !== "NOT_RUN")) invalid("RUN_DIRECT_WRITER_INVALID", "unknown application must remain explicit");
  if (state.stage === "APPLIED_PENDING_VERIFICATION" && (state.application !== "APPLIED" || !["PENDING", "FAIL", "BLOCKED"].includes(/** @type {string} */ (state.verification)))) invalid("RUN_DIRECT_WRITER_INVALID", "pending writer cannot report passing verification");
  if (state.stage === "VERIFYING" && (state.application !== "APPLIED" || state.verification !== "RUNNING")) invalid("RUN_DIRECT_WRITER_INVALID", "verifying writer must have an applied patch and active verification");
  if (previous && typeof previous === "object" && !Array.isArray(previous)) {
    const prior = /** @type {Record<string, unknown>} */ (previous);
    if ((prior.application === "APPLIED" && state.application !== "APPLIED") || (prior.application === "UNKNOWN" && state.application !== "UNKNOWN") || (prior.stage === "VERIFIED" && state.stage !== "VERIFIED")) invalid("RUN_DIRECT_WRITER_DRIFT", "direct writer state cannot discard an application or verification fact");
  }
}

/** @param {import("./contracts.d.ts").RunRecordForProjection} record */
export function projectRunRecord(record) {
  const writer = record.directWriter;
  return {
    runId: record.runId, status: record.status, createdAt: record.createdAt, updatedAt: record.updatedAt,
    terminalAt: record.terminalAt, inputRetained: record.inputRetained, artifactsRetained: record.artifactsRetained,
    artifactCount: record.artifacts.length, receiptDigest: record.receiptDigest,
    ...(writer ? { directWriter: { stage: writer.stage, application: writer.application, verification: writer.verification,
      patchDigest: writer.patchDigest, receiptDigest: writer.receiptDigest, failureCode: writer.failureCode,
      updatedAt: writer.updatedAt, needsReconciliation: ["APPLYING", "APPLICATION_UNKNOWN", "VERIFYING"].includes(writer.stage) } } : {}),
  };
}

/**
 * @param {Partial<import("./contracts.d.ts").RealWorkspaceReceipt> | null | undefined} receipt
 * @param {import("./contracts.d.ts").ExpectedRealWorkspaceReceipt} expected
 */
export function isValidRealWorkspaceReceipt(receipt, expected) {
  const sha256 = /^sha256:[a-f0-9]{64}$/u;
  return receipt?.kind === "omp-real-workspace-verification"
    && receipt.phase === "real-workspace" && receipt.status === "PASS"
    && receipt.runId === expected.runId && receipt.patchDigest === expected.patchDigest
    && receipt.head === expected.head && receipt.manifestDigest === expected.manifestDigest
    && receipt.repositoryRootDigest === expected.repositoryRootDigest
    && receipt.receiptDigest === expected.receiptDigest
    && typeof receipt.sourceDigest === "string" && sha256.test(receipt.sourceDigest)
    && typeof receipt.sourceScopeDigest === "string" && sha256.test(receipt.sourceScopeDigest)
    && typeof receipt.bindingDigest === "string" && sha256.test(receipt.bindingDigest)
    && Array.isArray(receipt.results) && receipt.results.length > 0
    && receipt.results.every((result) => result.status === "PASS" && result.exitCode === 0
      && result.killed === false && result.terminationUnconfirmed !== true
      && result.bindingDigest === receipt.bindingDigest);
}
