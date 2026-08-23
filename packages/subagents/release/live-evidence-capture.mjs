import { spawn } from "node:child_process";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import {
  createProtectedEvidenceDocument,
  PROTECTED_EVIDENCE_REQUIREMENTS,
  protectedEvidenceSigningDigest,
  validateProtectedEvidenceDocument,
} from "./protected-evidence.mjs";
import {
  SUBAGENTS_LIVE_EVIDENCE_SCENARIO_SHAPES,
  validateLiveEvidenceAuthorization,
} from "./live-evidence-authorization.mjs";
import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";

export const SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE = "omp_subagents_protected_capture_v1";

const MAX_CAPTURE_RECORD_BYTES = 64 * 1024;
const MAX_SIGNER_STDOUT_BYTES = 1024;
const MAX_SIGNER_STDERR_BYTES = 4096;
const CAPTURE_KEYS = Object.freeze([
  "authorizationDigest",
  "captureDigest",
  "claims",
  "compatibilityRowId",
  "environment",
  "formatVersion",
  "id",
  "matrixDigest",
  "observedAt",
  "policyDigest",
  "privacy",
  "proofs",
  "sourceCommit",
  "status",
  "trustPolicyDigest",
  "type",
  "usage",
]);
const CLAIM_KEYS = Object.freeze([
  "authoritativeTerminals",
  "autoIntegrated",
  "backgroundResume",
  "batchItemCount",
  "cancelObserved",
  "managedWorktree",
  "parentDiffVerified",
]);
const USAGE_KEYS = Object.freeze([
  "children",
  "concurrency",
  "costUsd",
  "elapsedMs",
  "rawOutputBytes",
  "tokens",
]);
const PRIVACY_KEYS = Object.freeze([
  "credentialsStored",
  "hostPathsStored",
  "rawOutputStored",
  "sessionIdsStored",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/u;

export class LiveEvidenceCaptureError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents live evidence capture: ${message}`);
    this.name = "LiveEvidenceCaptureError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new LiveEvidenceCaptureError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return object(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactIso(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function exactEnvironment(left, right) {
  return sha256(left) === sha256(right);
}

function captureDigest(record) {
  return sha256(withoutKey(record, "captureDigest"));
}

function boundedNumber(value, { integer = false } = {}) {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && (!integer || Number.isSafeInteger(value));
}

function assertCaptureProofs(record, requirement) {
  if (!Array.isArray(record.proofs) || record.proofs.length < 1 || record.proofs.length > 16) {
    fail("capture proofs must be a bounded array", "CAPTURE_PROOFS_INVALID");
  }
  const kinds = [];
  for (const proof of record.proofs) {
    if (!exactKeys(proof, ["digest", "kind"])
      || typeof proof.kind !== "string"
      || !SHA256.test(proof.digest ?? "")) {
      fail("capture proof must contain only a kind and sha256 digest", "CAPTURE_PROOFS_INVALID");
    }
    kinds.push(proof.kind);
  }
  if (new Set(kinds).size !== kinds.length
    || JSON.stringify(kinds) !== JSON.stringify([...kinds].sort())) {
    fail("capture proof kinds must be unique and canonical", "CAPTURE_PROOFS_INVALID");
  }
  const missing = requirement.requiredProofs.filter((kind) => !kinds.includes(kind));
  if (missing.length > 0) fail("capture is missing required proof receipts", "CAPTURE_PROOF_MISSING", { missing });
}

export function validateProtectedLiveCaptureRecord(record, {
  authorization,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  authorizationValidator = validateLiveEvidenceAuthorization,
  scenarioShapes = SUBAGENTS_LIVE_EVIDENCE_SCENARIO_SHAPES,
} = {}) {
  const encoded = Buffer.from(JSON.stringify(record));
  if (encoded.byteLength > MAX_CAPTURE_RECORD_BYTES) fail("capture record exceeds 64 KiB", "CAPTURE_RECORD_TOO_LARGE");
  if (!exactKeys(record, CAPTURE_KEYS)
    || record.formatVersion !== 1
    || record.type !== SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE
    || record.status !== "PASS") {
    fail("capture record has missing or unknown fields", "CAPTURE_RECORD_INVALID");
  }
  if (typeof authorizationValidator !== "function") throw new TypeError("authorizationValidator must be a function");
  const checkedAuthorization = authorizationValidator(authorization, {
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
    now: Date.parse(record.observedAt),
  });
  if (!checkedAuthorization.evidenceIds.includes(record.id)) fail("capture id was not authorized", "CAPTURE_ID_UNAUTHORIZED");
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[record.id];
  if (!requirement) fail("capture id is not a supported live evidence class", "CAPTURE_ID_UNSUPPORTED");
  for (const [field, expected] of [
    ["authorizationDigest", checkedAuthorization.authorizationDigest],
    ["sourceCommit", expectedSourceCommit],
    ["matrixDigest", matrix.matrixDigest],
    ["policyDigest", policy.policyDigest],
    ["trustPolicyDigest", trustPolicy.policyDigest],
    ["compatibilityRowId", checkedAuthorization.compatibilityRowId],
  ]) {
    if (record[field] !== expected) fail(`capture ${field} drifted from authorization`, "CAPTURE_CONTEXT_DRIFT", { field });
  }
  const row = matrix.rows.find((candidate) => candidate.id === record.compatibilityRowId);
  if (!row || !exactEnvironment(record.environment, row.environment)) {
    fail("capture runtime differs from its compatibility row", "CAPTURE_ENVIRONMENT_DRIFT");
  }
  if (!exactIso(record.observedAt)) fail("capture observedAt is not an exact ISO timestamp", "CAPTURE_TIME_INVALID");
  if (!exactKeys(record.claims, CLAIM_KEYS)) fail("capture claims are malformed", "CAPTURE_CLAIMS_INVALID");
  if (!Number.isSafeInteger(record.claims.authoritativeTerminals)
    || record.claims.authoritativeTerminals < requirement.minimumAuthoritativeTerminals
    || !Number.isSafeInteger(record.claims.batchItemCount)
    || record.claims.batchItemCount < requirement.minimumBatchItems) {
    fail("capture terminal or item counts are insufficient", "CAPTURE_COUNTS_INSUFFICIENT");
  }
  for (const [claim, expected] of Object.entries(requirement.claims)) {
    if (record.claims[claim] !== expected) fail(`capture claim differs: ${claim}`, "CAPTURE_CLAIMS_INVALID", { claim });
  }
  if (record.claims.autoIntegrated !== false) fail("capture cannot claim automatic integration", "CAPTURE_CLAIMS_INVALID");
  assertCaptureProofs(record, requirement);
  if (!exactKeys(record.usage, USAGE_KEYS)
    || !boundedNumber(record.usage.children, { integer: true })
    || !boundedNumber(record.usage.concurrency, { integer: true })
    || !boundedNumber(record.usage.elapsedMs, { integer: true })
    || !boundedNumber(record.usage.rawOutputBytes, { integer: true })
    || !boundedNumber(record.usage.tokens, { integer: true })
    || !boundedNumber(record.usage.costUsd)) {
    fail("capture usage is malformed", "CAPTURE_USAGE_INVALID");
  }
  const expectedShape = scenarioShapes[record.id];
  if (!expectedShape
    || record.usage.children !== expectedShape.children
    || record.usage.concurrency !== expectedShape.concurrency) {
    fail("capture child count or concurrency differs from the fixed protected scenario", "CAPTURE_SCENARIO_SHAPE_INVALID");
  }
  if (record.usage.children > checkedAuthorization.limits.maxChildren
    || record.usage.concurrency > checkedAuthorization.limits.maxConcurrency
    || record.usage.elapsedMs > checkedAuthorization.limits.maxWallTimeMs
    || record.usage.rawOutputBytes > checkedAuthorization.limits.maxOutputBytes
    || (checkedAuthorization.limits.maxTokens !== null && record.usage.tokens > checkedAuthorization.limits.maxTokens)
    || (checkedAuthorization.limits.maxCostUsd !== null && record.usage.costUsd > checkedAuthorization.limits.maxCostUsd)) {
    fail("capture exceeded an authorized usage ceiling", "CAPTURE_BUDGET_EXCEEDED");
  }
  if (!exactKeys(record.privacy, PRIVACY_KEYS)
    || Object.values(record.privacy).some((value) => value !== false)) {
    fail("capture privacy boundary is invalid", "CAPTURE_PRIVACY_INVALID");
  }
  if (record.captureDigest !== captureDigest(record)) fail("capture digest does not match its contents", "CAPTURE_DIGEST_MISMATCH");
  return Object.freeze(jsonClone(record));
}

function normalizeSignature(value) {
  const signature = typeof value === "string" ? value : value?.signature;
  if (typeof signature !== "string" || !SIGNATURE.test(signature)) {
    fail("signer did not return a canonical Ed25519 signature", "SIGNER_SIGNATURE_INVALID");
  }
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature) {
    fail("signer returned a noncanonical signature", "SIGNER_SIGNATURE_INVALID");
  }
  return signature;
}

export async function buildProtectedLiveEvidenceDocument(record, context, signer) {
  const { authorization, matrix, policy, trustPolicy, expectedSourceCommit } = context;
  const provisional = createProtectedEvidenceDocument({
    contractStatus: "protected-live-evidence",
    formatVersion: 1,
    id: record.id,
    status: "PASS",
    sourceCommit: expectedSourceCommit,
    matrixDigest: matrix.matrixDigest,
    policyDigest: policy.policyDigest,
    trustPolicyDigest: trustPolicy.policyDigest,
    compatibilityRowId: record.compatibilityRowId,
    observedAt: record.observedAt,
    environment: record.environment,
    authorization: {
      providerRequests: "AUTHORIZED",
      liveChildDispatch: "AUTHORIZED",
      liveWriter: PROTECTED_EVIDENCE_REQUIREMENTS[record.id]?.writerAuthorized
        ? "AUTHORIZED"
        : "NOT_RUN_BY_POLICY",
      realPiHome: "NOT_TOUCHED",
      disposableRoot: true,
    },
    privacy: record.privacy,
    claims: record.claims,
    proofs: record.proofs,
    attestation: {
      class: "operator-authorized-live-import",
      signerId: authorization.signer.signerId,
      publicKeyFingerprint: authorization.signer.publicKeyFingerprint,
      authorizationDigest: authorization.authorizationDigest,
      captureDigest: record.captureDigest,
      signedPayloadDigest: `sha256:${"0".repeat(64)}`,
      signature: Buffer.alloc(64).toString("base64"),
    },
  });
  const signedPayloadDigest = protectedEvidenceSigningDigest(provisional);
  const signature = normalizeSignature(await signer({
    signerId: authorization.signer.signerId,
    digest: signedPayloadDigest,
    authorizationDigest: authorization.authorizationDigest,
    evidenceId: record.id,
  }));
  const document = createProtectedEvidenceDocument({
    ...provisional,
    attestation: {
      ...provisional.attestation,
      signedPayloadDigest,
      signature,
    },
  });
  validateProtectedEvidenceDocument(document, {
    expectedId: record.id,
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
  });
  // The validator returns a caller-facing projection with a derived `scope`.
  // Persist only the exact signed schema document; adding the projection field
  // would invalidate both the strict schema and the document digest on disk.
  return Object.freeze(jsonClone(document));
}

export function createProtectedLiveEvidenceCapturePlan({
  authorization = null,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  now,
} = {}) {
  const base = {
    formatVersion: 1,
    operation: "protected-live-evidence-capture",
    providerRequest: "NOT_STARTED",
    childDispatch: "NOT_STARTED",
    signerInvocation: "NOT_STARTED",
    realPiHome: "NOT_TOUCHED",
    mutation: "NOT_RUN_BY_POLICY",
  };
  if (authorization === null) return Object.freeze({ ...base, status: "AUTHORIZATION_REQUIRED", runnable: false, evidenceIds: [] });
  try {
    const checked = validateLiveEvidenceAuthorization(authorization, {
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
      evidenceIds: Object.freeze([...checked.evidenceIds]),
      limits: Object.freeze(jsonClone(checked.limits)),
    });
  } catch (cause) {
    return Object.freeze({
      ...base,
      status: cause?.code ?? "AUTHORIZATION_INVALID",
      runnable: false,
      evidenceIds: Object.freeze(Array.isArray(authorization?.evidenceIds) ? [...authorization.evidenceIds] : []),
    });
  }
}

export async function captureProtectedLiveEvidenceSet({
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
  const checkedAuthorization = validateLiveEvidenceAuthorization(authorization, {
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
    now,
  });
  const compatibilityRow = matrix.rows.find((row) => row.id === checkedAuthorization.compatibilityRowId);
  if (!compatibilityRow) fail("authorized compatibility row is unavailable", "CAPTURE_COMPATIBILITY_ROW_MISSING");
  const context = { authorization: checkedAuthorization, matrix, policy, trustPolicy, expectedSourceCommit };
  const documents = {};
  const records = {};
  const aggregate = {
    children: 0,
    elapsedMs: 0,
    rawOutputBytes: 0,
    tokens: 0,
    costUsd: 0,
  };
  for (const id of checkedAuthorization.evidenceIds) {
    const shape = SUBAGENTS_LIVE_EVIDENCE_SCENARIO_SHAPES[id];
    const scenarioLimits = Object.freeze({
      maxChildren: shape.children,
      maxConcurrency: shape.concurrency,
      maxWallTimeMs: checkedAuthorization.limits.maxWallTimeMs - aggregate.elapsedMs,
      maxOutputBytes: checkedAuthorization.limits.maxOutputBytes - aggregate.rawOutputBytes,
      maxTokens: checkedAuthorization.limits.maxTokens === null
        ? null
        : checkedAuthorization.limits.maxTokens - aggregate.tokens,
      maxCostUsd: checkedAuthorization.limits.maxCostUsd === null
        ? null
        : checkedAuthorization.limits.maxCostUsd - aggregate.costUsd,
    });
    if (aggregate.children + shape.children > checkedAuthorization.limits.maxChildren
      || scenarioLimits.maxWallTimeMs < 1
      || scenarioLimits.maxOutputBytes < 1
      || (scenarioLimits.maxTokens !== null && scenarioLimits.maxTokens < 1)
      || (scenarioLimits.maxCostUsd !== null && scenarioLimits.maxCostUsd <= 0)) {
      fail("capture set exhausted its aggregate authorization before dispatch", "CAPTURE_BUDGET_EXCEEDED");
    }
    const raw = await scenarioRunner({
      id,
      authorization: checkedAuthorization,
      expectedSourceCommit,
      compatibilityRowId: checkedAuthorization.compatibilityRowId,
      environment: jsonClone(compatibilityRow.environment),
      scenarioLimits,
    });
    const record = validateProtectedLiveCaptureRecord(raw, context);
    aggregate.children += record.usage.children;
    aggregate.elapsedMs += record.usage.elapsedMs;
    aggregate.rawOutputBytes += record.usage.rawOutputBytes;
    aggregate.tokens += record.usage.tokens;
    aggregate.costUsd += record.usage.costUsd;
    if (aggregate.children > checkedAuthorization.limits.maxChildren
      || aggregate.elapsedMs > checkedAuthorization.limits.maxWallTimeMs
      || aggregate.rawOutputBytes > checkedAuthorization.limits.maxOutputBytes
      || (checkedAuthorization.limits.maxTokens !== null && aggregate.tokens > checkedAuthorization.limits.maxTokens)
      || (checkedAuthorization.limits.maxCostUsd !== null && aggregate.costUsd > checkedAuthorization.limits.maxCostUsd)) {
      fail("capture set exceeded its aggregate authorization", "CAPTURE_BUDGET_EXCEEDED");
    }
    records[id] = record;
    documents[id] = await buildProtectedLiveEvidenceDocument(record, context, signer);
  }
  return Object.freeze({
    formatVersion: 1,
    status: "PROTECTED_LIVE_EVIDENCE_CAPTURED",
    authorizationId: checkedAuthorization.authorizationId,
    authorizationDigest: checkedAuthorization.authorizationDigest,
    sourceCommit: expectedSourceCommit,
    usage: Object.freeze({ ...aggregate }),
    records: Object.freeze(Object.fromEntries(Object.entries(records).map(([id, record]) => [id, Object.freeze(record)]))),
    evidence: Object.freeze(Object.fromEntries(Object.entries(documents).map(([id, document]) => [id, Object.freeze(document)]))),
  });
}

function boundedAppend(state, chunk, maximum) {
  const input = Buffer.from(chunk);
  const remaining = maximum - state.bytes;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }
  state.parts.push(input.subarray(0, remaining));
  state.bytes += Math.min(input.length, remaining);
  if (input.length > remaining) state.truncated = true;
}

export function createExternalDigestSigner({
  command,
  spawnImpl = spawn,
  timeoutMs = 10_000,
} = {}) {
  if (typeof command !== "string" || !path.isAbsolute(command) || command.includes("\0")) {
    throw new TypeError("signer command must be an explicit absolute path");
  }
  const stat = fs.lstatSync(command);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o111) === 0) {
    throw new TypeError("signer command must be an executable regular non-symlink file");
  }
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new TypeError("signer timeout is invalid");
  const env = {
    PATH: process.env.PATH ?? "",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
  };
  return async function externalDigestSigner({ digest }) {
    if (!SHA256.test(digest ?? "")) throw new TypeError("signer digest must be sha256");
    return await new Promise((resolve, reject) => {
      const stdout = { parts: [], bytes: 0, truncated: false };
      const stderr = { parts: [], bytes: 0, truncated: false };
      let settled = false;
      let child;
      let timer;
      const finish = (callback) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      try {
        child = spawnImpl(command, [], { env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        fail("external signer could not start", "SIGNER_START_FAILED");
      }
      child.stdout?.on?.("data", (chunk) => boundedAppend(stdout, chunk, MAX_SIGNER_STDOUT_BYTES));
      child.stderr?.on?.("data", (chunk) => boundedAppend(stderr, chunk, MAX_SIGNER_STDERR_BYTES));
      child.on?.("error", () => finish(() => reject(new LiveEvidenceCaptureError("external signer failed", "SIGNER_PROCESS_ERROR"))));
      child.on?.("exit", (code, signal) => finish(() => {
        if (code !== 0 || signal !== null || stdout.truncated || stderr.truncated) {
          reject(new LiveEvidenceCaptureError("external signer exited unsuccessfully", "SIGNER_PROCESS_ERROR", {
            exitCode: code,
            signal: signal ?? null,
            stderrDigest: sha256(Buffer.concat(stderr.parts)),
          }));
          return;
        }
        try {
          resolve(normalizeSignature(Buffer.concat(stdout.parts).toString("utf8").trim()));
        } catch (cause) {
          reject(cause);
        }
      }));
      child.stdin?.end?.(`${digest}\n`);
      timer = setTimeout(() => {
        child.kill?.("SIGTERM");
        finish(() => reject(new LiveEvidenceCaptureError("external signer timed out", "SIGNER_TIMEOUT")));
      }, timeoutMs);
      timer.unref?.();
    });
  };
}

export async function writeProtectedLiveEvidenceStaging(capture, { outputDir } = {}) {
  if (typeof outputDir !== "string" || !path.isAbsolute(outputDir) || path.resolve(outputDir) === path.parse(path.resolve(outputDir)).root) {
    fail("staging output directory must be an explicit absolute non-root path", "CAPTURE_OUTPUT_PATH_INVALID");
  }
  const stat = await fsPromises.lstat(outputDir).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail("staging output must be an existing regular directory", "CAPTURE_OUTPUT_PATH_INVALID");
  if ((await fsPromises.readdir(outputDir)).length !== 0) fail("staging output directory must be empty", "CAPTURE_OUTPUT_NOT_EMPTY");
  const realRoot = await fsPromises.realpath(outputDir);
  const written = [];
  for (const id of Object.keys(capture.evidence).sort()) {
    const target = path.join(realRoot, `${id}.json`);
    const relative = path.relative(realRoot, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("staging evidence path escaped its root", "CAPTURE_OUTPUT_PATH_INVALID");
    const handle = await fsPromises.open(target, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(capture.evidence[id], null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    written.push(path.basename(target));
  }
  const manifest = {
    formatVersion: 1,
    status: capture.status,
    authorizationId: capture.authorizationId,
    authorizationDigest: capture.authorizationDigest,
    sourceCommit: capture.sourceCommit,
    usage: capture.usage,
    captureRecords: capture.records,
    evidence: Object.fromEntries(Object.entries(capture.evidence).map(([id, document]) => [id, document.evidenceDigest])),
  };
  const manifestHandle = await fsPromises.open(path.join(realRoot, "capture-manifest.json"), "wx", 0o600);
  try {
    await manifestHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await manifestHandle.sync();
  } finally {
    await manifestHandle.close();
  }
  return Object.freeze({
    status: "PROTECTED_LIVE_EVIDENCE_STAGED",
    authorizationId: capture.authorizationId,
    sourceCommit: capture.sourceCommit,
    files: Object.freeze([...written, "capture-manifest.json"]),
  });
}

export function createProtectedLiveCaptureRecord(input = {}) {
  const record = jsonClone({
    ...input,
    formatVersion: 1,
    type: SUBAGENTS_LIVE_CAPTURE_RECORD_TYPE,
  });
  record.captureDigest = captureDigest(record);
  return Object.freeze(record);
}
