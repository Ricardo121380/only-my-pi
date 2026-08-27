import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import semver from "semver";

import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "../../..");
const DEFAULT_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-protected-evidence-v1.schema.json");
const DEFAULT_TRUST_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-protected-evidence-trust-v1.schema.json");
const MAX_EVIDENCE_BYTES = 256 * 1024;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const PROTECTED_EVIDENCE_REQUIREMENTS = Object.freeze({
  "live-agent-terminal": Object.freeze({
    scope: "liveAgentTerminal",
    minimumAuthoritativeTerminals: 1,
    minimumBatchItems: 0,
    requiredProofs: Object.freeze(["process-terminal", "terminal-receipt"]),
    claims: Object.freeze({ cancelObserved: false, backgroundResume: false, managedWorktree: false, parentDiffVerified: false }),
    writerAuthorized: false,
  }),
  "live-agent-cancel": Object.freeze({
    scope: "liveAgentCancel",
    minimumAuthoritativeTerminals: 1,
    minimumBatchItems: 0,
    requiredProofs: Object.freeze(["cancel-request", "process-terminal", "terminal-receipt"]),
    claims: Object.freeze({ cancelObserved: true, backgroundResume: false, managedWorktree: false, parentDiffVerified: false }),
    writerAuthorized: false,
  }),
  "live-batch-terminal": Object.freeze({
    scope: "liveBatchTerminal",
    minimumAuthoritativeTerminals: 2,
    minimumBatchItems: 2,
    requiredProofs: Object.freeze(["batch-plan", "batch-terminal-set", "input-order-aggregation", "process-terminal-set"]),
    claims: Object.freeze({ cancelObserved: false, backgroundResume: false, managedWorktree: false, parentDiffVerified: false }),
    writerAuthorized: false,
  }),
  "background-resume": Object.freeze({
    scope: "backgroundResume",
    minimumAuthoritativeTerminals: 2,
    minimumBatchItems: 0,
    requiredProofs: Object.freeze([
      "backend-rebind",
      "background-spawn",
      "parent-session-reload",
      "process-terminal",
      "resume-request",
      "terminal-receipt",
    ]),
    claims: Object.freeze({ cancelObserved: false, backgroundResume: true, managedWorktree: false, parentDiffVerified: false }),
    writerAuthorized: false,
  }),
  "guarded-writer-integration": Object.freeze({
    scope: "guardedWriterIntegration",
    minimumAuthoritativeTerminals: 1,
    minimumBatchItems: 0,
    requiredProofs: Object.freeze([
      "approval-receipt",
      "base-commit",
      "parent-diff-verification",
      "process-terminal",
      "task-assignment",
      "terminal-receipt",
      "worktree-receipt",
    ]),
    claims: Object.freeze({ cancelObserved: false, backgroundResume: false, managedWorktree: true, parentDiffVerified: true }),
    writerAuthorized: true,
  }),
});

export class ProtectedEvidenceError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents protected evidence: ${message}`);
    this.name = "ProtectedEvidenceError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new ProtectedEvidenceError(message, code, details);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function schemaValidator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath));
}

function exactDigest(document) {
  return sha256(withoutKey(withoutKey(document, "$schema"), "evidenceDigest"));
}

export function protectedEvidenceDigest(document) {
  return exactDigest(document);
}

export function protectedEvidenceTrustPolicyDigest(policy) {
  return sha256(withoutKey(withoutKey(policy, "$schema"), "policyDigest"));
}

export function protectedEvidenceSigningDigest(document) {
  const payload = jsonClone(withoutKey(withoutKey(document, "$schema"), "evidenceDigest"));
  delete payload.attestation.signature;
  delete payload.attestation.signedPayloadDigest;
  return sha256(payload);
}

function exactIso(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function equal(left, right) {
  return sha256(left) === sha256(right);
}

function publicKeyFingerprint(publicKeySpki) {
  let bytes;
  try {
    bytes = Buffer.from(publicKeySpki, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== publicKeySpki) throw new Error("noncanonical base64");
    const key = crypto.createPublicKey({ key: bytes, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("not Ed25519");
  } catch {
    fail("trust signer public key is not canonical Ed25519 SPKI", "TRUST_PUBLIC_KEY_INVALID");
  }
  return sha256(bytes);
}

export function validateProtectedEvidenceTrustPolicy(policy, {
  schemaPath = DEFAULT_TRUST_SCHEMA,
} = {}) {
  const validate = schemaValidator(schemaPath);
  if (!validate(policy)) fail("trust policy JSON schema validation failed", "TRUST_POLICY_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  if (policy.policyDigest !== protectedEvidenceTrustPolicyDigest(policy)) fail("trust policy digest drift", "TRUST_POLICY_DIGEST_MISMATCH");
  if ((policy.contractStatus === "configured-unavailable") !== (policy.signers.length === 0)) {
    fail("trust policy status does not match its signer set", "TRUST_POLICY_STATUS_INVALID");
  }
  const ids = new Set();
  for (const signer of policy.signers) {
    if (ids.has(signer.id)) fail(`duplicate trust signer ${signer.id}`, "DUPLICATE_TRUST_SIGNER");
    ids.add(signer.id);
    if (signer.publicKeyFingerprint !== publicKeyFingerprint(signer.publicKeySpki)) {
      fail(`trust signer fingerprint drift: ${signer.id}`, "TRUST_PUBLIC_KEY_FINGERPRINT_MISMATCH");
    }
    if (!exactIso(signer.notBefore) || !exactIso(signer.notAfter)) fail(`trust signer timestamps are not exact ISO UTC: ${signer.id}`, "TRUST_SIGNER_WINDOW_INVALID");
    if (Date.parse(signer.notAfter) <= Date.parse(signer.notBefore)) fail(`trust signer window is invalid: ${signer.id}`, "TRUST_SIGNER_WINDOW_INVALID");
  }
  return Object.freeze(jsonClone(policy));
}

export function loadProtectedEvidenceTrustPolicy({
  rootDir = DEFAULT_ROOT,
  policyPath = "contracts/subagents/protected-evidence-trust.json",
  schemaPath = DEFAULT_TRUST_SCHEMA,
} = {}) {
  if (policyPath !== "contracts/subagents/protected-evidence-trust.json") fail("trust policy path is fixed", "TRUST_POLICY_PATH_INVALID");
  const root = fs.realpathSync(path.resolve(rootDir));
  const target = path.resolve(root, policyPath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("trust policy escapes repository", "TRUST_POLICY_PATH_INVALID");
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    fail("protected evidence trust policy is unavailable", "TRUST_POLICY_MISSING");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) fail("trust policy must be a bounded regular file", "TRUST_POLICY_PATH_INVALID");
  return validateProtectedEvidenceTrustPolicy(readJson(target), { schemaPath });
}

function validateContractExample(document) {
  if (document.status !== "CONTRACT_ONLY") fail("contract example status must remain CONTRACT_ONLY", "CONTRACT_EXAMPLE_INVALID");
  if (document.authorization.providerRequests !== "NOT_RUN_BY_POLICY"
    || document.authorization.liveChildDispatch !== "NOT_RUN_BY_POLICY"
    || document.authorization.liveWriter !== "NOT_RUN_BY_POLICY") {
    fail("contract example cannot claim live authorization", "CONTRACT_EXAMPLE_INVALID");
  }
  if (Object.values(document.claims).some((value) => value === true || (Number.isSafeInteger(value) && value !== 0))) {
    fail("contract example cannot claim observed live behavior", "CONTRACT_EXAMPLE_INVALID");
  }
  return Object.freeze(jsonClone(document));
}

function validateLiveAttestation(document, trustPolicy) {
  if (!trustPolicy) fail("live evidence requires a source-pinned trust policy", "TRUST_POLICY_REQUIRED");
  const checkedTrust = validateProtectedEvidenceTrustPolicy(trustPolicy);
  if (checkedTrust.contractStatus !== "runtime-ready") fail("protected evidence trust policy is not runtime-ready", "TRUST_POLICY_UNAVAILABLE");
  if (document.trustPolicyDigest !== checkedTrust.policyDigest) fail("evidence trust policy digest drift", "TRUST_POLICY_DIGEST_MISMATCH");
  const signer = checkedTrust.signers.find((candidate) => candidate.id === document.attestation.signerId);
  if (!signer || signer.status !== "active" || !signer.evidenceIds.includes(document.id)) {
    fail("evidence signer is unavailable for this evidence class", "TRUST_SIGNER_UNAVAILABLE");
  }
  const observedAt = Date.parse(document.observedAt);
  if (observedAt < Date.parse(signer.notBefore) || observedAt > Date.parse(signer.notAfter)) {
    fail("evidence was observed outside the signer authorization window", "TRUST_SIGNER_WINDOW_MISMATCH");
  }
  if (document.attestation.publicKeyFingerprint !== signer.publicKeyFingerprint) {
    fail("evidence signer fingerprint differs from the trust policy", "TRUST_SIGNER_FINGERPRINT_MISMATCH");
  }
  const signedPayloadDigest = protectedEvidenceSigningDigest(document);
  if (document.attestation.signedPayloadDigest !== signedPayloadDigest) fail("signed payload digest drift", "SIGNED_PAYLOAD_DIGEST_MISMATCH");
  let signature;
  let publicKey;
  try {
    signature = Buffer.from(document.attestation.signature, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== document.attestation.signature) throw new Error("invalid signature");
    publicKey = crypto.createPublicKey({ key: Buffer.from(signer.publicKeySpki, "base64"), format: "der", type: "spki" });
  } catch {
    fail("evidence signature encoding is invalid", "EVIDENCE_SIGNATURE_INVALID");
  }
  if (!crypto.verify(null, Buffer.from(signedPayloadDigest, "utf8"), publicKey, signature)) {
    fail("evidence signature verification failed", "EVIDENCE_SIGNATURE_INVALID");
  }
  return checkedTrust;
}

function validateLiveSemantics(document, { expectedId, matrix, policy, trustPolicy, expectedSourceCommit }) {
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[document.id];
  if (!requirement) fail(`unknown protected evidence id ${document.id}`, "UNKNOWN_EVIDENCE_ID");
  if (expectedId !== undefined && document.id !== expectedId) {
    fail(`evidence id ${document.id} does not match ${expectedId}`, "EVIDENCE_ID_MISMATCH", { expectedId, actualId: document.id });
  }
  if (document.status !== "PASS") fail("live evidence status must be PASS", "EVIDENCE_STATUS_INVALID");
  validateLiveAttestation(document, trustPolicy);
  if (!FULL_SHA.test(expectedSourceCommit ?? "")) fail("promotion validation requires an exact source commit", "SOURCE_COMMIT_REQUIRED");
  if (document.sourceCommit !== expectedSourceCommit) {
    fail("evidence source commit differs from the promoted source", "SOURCE_COMMIT_MISMATCH", {
      expectedSourceCommit,
      actualSourceCommit: document.sourceCommit,
    });
  }
  if (!matrix || document.matrixDigest !== matrix.matrixDigest) fail("evidence matrix digest drift", "MATRIX_DIGEST_MISMATCH");
  if (!policy || document.policyDigest !== policy.policyDigest) fail("evidence policy digest drift", "POLICY_DIGEST_MISMATCH");

  const row = matrix.rows?.find((candidate) => candidate.id === document.compatibilityRowId);
  if (!row) fail("evidence references an unknown compatibility row", "COMPATIBILITY_ROW_UNKNOWN");
  if (!equal(document.environment, row.environment)) fail("evidence runtime differs from its compatibility row", "ENVIRONMENT_MISMATCH");
  if (semver.valid(document.environment.node) === null || !semver.satisfies(document.environment.node, matrix.policy.nodeRange)) {
    fail("evidence Node version is not an exact supported semver", "NODE_VERSION_INVALID");
  }
  if (document.environment.pi !== matrix.policy.piVersion
    || document.environment.backend !== `${matrix.policy.backend.package}@${matrix.policy.backend.version}`) {
    fail("evidence Pi/backend tuple differs from the pinned runtime", "RUNTIME_PIN_MISMATCH");
  }

  if (document.claims.authoritativeTerminals < requirement.minimumAuthoritativeTerminals
    || document.claims.batchItemCount < requirement.minimumBatchItems) {
    fail("evidence does not meet the required terminal/item count", "EVIDENCE_COUNT_INSUFFICIENT");
  }
  for (const [claim, expected] of Object.entries(requirement.claims)) {
    if (document.claims[claim] !== expected) fail(`evidence claim differs: ${claim}`, "EVIDENCE_CLAIM_MISMATCH", { claim, expected });
  }
  if (document.claims.autoIntegrated !== false) fail("protected evidence may not claim automatic integration", "AUTO_INTEGRATION_FORBIDDEN");
  const proofKinds = document.proofs.map((proof) => proof.kind);
  if (new Set(proofKinds).size !== proofKinds.length) fail("proof kinds must be unique", "DUPLICATE_PROOF_KIND");
  const missingProofs = requirement.requiredProofs.filter((kind) => !proofKinds.includes(kind));
  if (missingProofs.length > 0) fail("evidence is missing required proof receipts", "REQUIRED_PROOF_MISSING", { missingProofs });

  const expectedWriter = requirement.writerAuthorized ? "AUTHORIZED" : "NOT_RUN_BY_POLICY";
  if (document.authorization.providerRequests !== "AUTHORIZED"
    || document.authorization.liveChildDispatch !== "AUTHORIZED"
    || document.authorization.liveWriter !== expectedWriter
    || document.authorization.realPiHome !== "NOT_TOUCHED"
    || document.authorization.disposableRoot !== true) {
    fail("evidence authorization boundary differs from its evidence class", "AUTHORIZATION_BOUNDARY_INVALID");
  }
  if (document.privacy.rawOutputStored !== false
    || document.privacy.hostPathsStored !== false
    || document.privacy.credentialsStored !== false
    || document.privacy.sessionIdsStored !== false) {
    fail("protected evidence contains an unsupported privacy claim", "PRIVACY_BOUNDARY_INVALID");
  }
  if (!exactIso(document.observedAt)) fail("observedAt must be an exact ISO timestamp", "OBSERVED_AT_INVALID");
  return Object.freeze(jsonClone({ ...document, scope: requirement.scope }));
}

export function validateProtectedEvidenceDocument(document, {
  expectedId,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  allowContractExample = false,
  schemaPath = DEFAULT_SCHEMA,
} = {}) {
  const validate = schemaValidator(schemaPath);
  if (!validate(document)) fail("JSON schema validation failed", "EVIDENCE_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  if (document.evidenceDigest !== exactDigest(document)) fail("evidence digest does not match its contents", "EVIDENCE_DIGEST_MISMATCH");
  if (document.contractStatus === "contract-example") {
    if (!allowContractExample) fail("contract examples cannot satisfy protected promotion evidence", "CONTRACT_EXAMPLE_FORBIDDEN");
    return validateContractExample(document);
  }
  return validateLiveSemantics(document, { expectedId, matrix, policy, trustPolicy, expectedSourceCommit });
}

function safeProtectedPath(rootDir, relativePath) {
  if (typeof relativePath !== "string"
    || !relativePath.startsWith("verification/protected/")
    || !relativePath.endsWith(".json")
    || relativePath.includes("\0")
    || relativePath.includes("\\")
    || path.isAbsolute(relativePath)
    || relativePath.split("/").includes("..")) {
    fail(`unsafe protected evidence path: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  }
  const root = fs.realpathSync(path.resolve(rootDir));
  const protectedRoot = path.join(root, "verification", "protected");
  let rootStat;
  try {
    rootStat = fs.lstatSync(protectedRoot);
  } catch {
    fail("verification/protected is unavailable", "EVIDENCE_FILE_MISSING");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("verification/protected must be a regular directory", "UNSAFE_EVIDENCE_PATH");
  let cursor = root;
  for (const segment of relativePath.split("/")) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor);
    } catch {
      fail(`protected evidence file is unavailable: ${relativePath}`, "EVIDENCE_FILE_MISSING");
    }
    if (stat.isSymbolicLink()) fail(`protected evidence path contains a symlink: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  }
  const target = fs.realpathSync(path.resolve(root, relativePath));
  const relative = path.relative(fs.realpathSync(protectedRoot), target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("protected evidence escapes its repository directory", "UNSAFE_EVIDENCE_PATH");
  const stat = fs.statSync(target);
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_EVIDENCE_BYTES) fail("protected evidence must be a bounded regular JSON file", "EVIDENCE_FILE_INVALID");
  return target;
}

export function loadProtectedEvidenceFile(relativePath, {
  rootDir = DEFAULT_ROOT,
  expectedId,
  matrix,
  policy,
  trustPolicy,
  expectedSourceCommit,
  schemaPath = DEFAULT_SCHEMA,
} = {}) {
  const target = safeProtectedPath(rootDir, relativePath);
  let document;
  try {
    document = readJson(target);
  } catch (cause) {
    fail("protected evidence is not valid JSON", "EVIDENCE_JSON_INVALID", { cause: cause.message });
  }
  const checked = validateProtectedEvidenceDocument(document, {
    expectedId,
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit,
    schemaPath,
  });
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[checked.id];
  const row = matrix.rows.find((candidate) => candidate.id === checked.compatibilityRowId);
  if (row?.scopes?.[requirement.scope] !== "PASS") {
    fail(`compatibility row does not prove ${requirement.scope}`, "COMPATIBILITY_SCOPE_NOT_PASS", {
      compatibilityRowId: checked.compatibilityRowId,
      scope: requirement.scope,
      status: row?.scopes?.[requirement.scope] ?? "UNAVAILABLE",
    });
  }
  if (!row.evidence.includes(relativePath)) {
    fail("compatibility row does not cite the protected evidence file", "MATRIX_EVIDENCE_REFERENCE_MISSING", {
      compatibilityRowId: checked.compatibilityRowId,
      source: relativePath,
    });
  }
  return Object.freeze({
    id: checked.id,
    scope: requirement.scope,
    source: relativePath,
    evidenceDigest: checked.evidenceDigest,
    compatibilityRowId: checked.compatibilityRowId,
    environment: checked.environment,
    authorization: checked.authorization,
  });
}

export function loadProtectedEvidenceSet(protectedEvidence = {}, options = {}) {
  if (!protectedEvidence || typeof protectedEvidence !== "object" || Array.isArray(protectedEvidence)) {
    fail("protected evidence input must be an id-to-path object", "EVIDENCE_SET_INVALID");
  }
  const unknown = Object.keys(protectedEvidence).filter((id) => !PROTECTED_EVIDENCE_REQUIREMENTS[id]);
  if (unknown.length > 0) fail(`unknown protected evidence ids: ${unknown.join(", ")}`, "UNKNOWN_EVIDENCE_ID");
  for (const [id, source] of Object.entries(protectedEvidence)) {
    if (typeof source !== "string") fail(`protected evidence ${id} must be a repository-relative file path`, "EVIDENCE_DESCRIPTOR_FORBIDDEN");
  }
  const sourceValues = Object.values(protectedEvidence);
  if (new Set(sourceValues).size !== sourceValues.length) fail("protected evidence sources must be unique", "DUPLICATE_EVIDENCE_SOURCE");
  const loaded = {};
  const trustPolicy = Object.keys(protectedEvidence).length === 0
    ? options.trustPolicy
    : (options.trustPolicy ?? loadProtectedEvidenceTrustPolicy({ rootDir: options.rootDir ?? DEFAULT_ROOT }));
  for (const id of Object.keys(protectedEvidence).sort()) {
    const source = protectedEvidence[id];
    loaded[id] = loadProtectedEvidenceFile(source, { ...options, trustPolicy, expectedId: id });
  }
  return Object.freeze(loaded);
}

export function protectedEvidenceSummary(loaded = {}) {
  return Object.freeze(Object.values(loaded)
    .map(({ id, scope, source, evidenceDigest, compatibilityRowId }) => ({ id, scope, source, evidenceDigest, compatibilityRowId }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function createProtectedEvidenceDocument(input, { schemaPath = DEFAULT_SCHEMA } = {}) {
  const document = jsonClone({
    ...input,
    $schema: input.$schema ?? "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-protected-evidence-v1.schema.json",
  });
  document.evidenceDigest = exactDigest(document);
  const validate = schemaValidator(schemaPath);
  if (!validate(document)) fail("created evidence does not satisfy the JSON schema", "EVIDENCE_SCHEMA_INVALID", { errors: validate.errors ?? [] });
  return Object.freeze(document);
}

export const SUBAGENTS_PROTECTED_EVIDENCE_IDS = Object.freeze(Object.keys(PROTECTED_EVIDENCE_REQUIREMENTS));
export const SUBAGENTS_PROTECTED_EVIDENCE_SCHEMA = DEFAULT_SCHEMA;
export const SUBAGENTS_PROTECTED_EVIDENCE_SHA256 = SHA256;
