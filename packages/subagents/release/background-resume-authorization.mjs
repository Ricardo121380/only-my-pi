import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";
import {
  PROTECTED_EVIDENCE_REQUIREMENTS,
  validateProtectedEvidenceTrustPolicy,
} from "./protected-evidence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "../../..");
const DEFAULT_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-background-resume-authorization-v1.schema.json");
const MAX_AUTHORIZATION_BYTES = 128 * 1024;
const MAX_AUTHORIZATION_WINDOW_MS = 24 * 60 * 60 * 1000;

export class BackgroundResumeAuthorizationError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents background resume authorization: ${message}`);
    this.name = "BackgroundResumeAuthorizationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new BackgroundResumeAuthorizationError(message, code, details);
}

function validator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));
}

function exactIso(value) {
  return typeof value === "string"
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function canonical(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function backgroundResumeAuthorizationDigest(document) {
  return sha256(withoutKey(withoutKey(document, "$schema"), "authorizationDigest"));
}

function validateSemantics(document) {
  if (document.authorizationDigest !== backgroundResumeAuthorizationDigest(document)) {
    fail("authorization digest does not match its contents", "AUTHORIZATION_DIGEST_MISMATCH");
  }
  for (const values of [document.provider.credentialEnvironment, document.provider.declaredEndpointHosts]) {
    if (JSON.stringify(values) !== JSON.stringify(canonical(values))) {
      fail("authorization sets must use canonical lexical order", "AUTHORIZATION_NONCANONICAL_SET");
    }
  }
  if (!exactIso(document.approvedAt) || !exactIso(document.expiresAt)) {
    fail("authorization timestamps must be exact ISO UTC values", "AUTHORIZATION_TIME_INVALID");
  }
  const approvedAt = Date.parse(document.approvedAt);
  const expiresAt = Date.parse(document.expiresAt);
  if (expiresAt <= approvedAt || expiresAt - approvedAt > MAX_AUTHORIZATION_WINDOW_MS) {
    fail("authorization window must be positive and no longer than 24 hours", "AUTHORIZATION_WINDOW_INVALID");
  }
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS["background-resume"];
  if (!requirement || requirement.writerAuthorized) {
    fail("background-resume evidence contract is unavailable", "AUTHORIZATION_EVIDENCE_UNSUPPORTED");
  }
}

function validateRuntime(document, { matrix, policy, trustPolicy, expectedSourceCommit, now } = {}) {
  if (document.contractStatus !== "operator-authorized-live") {
    fail("operator templates cannot start a live capture", "AUTHORIZATION_TEMPLATE_ONLY");
  }
  if (!matrix || !policy || !trustPolicy) {
    fail("live authorization requires matrix, promotion policy, and trust policy", "AUTHORIZATION_CONTEXT_REQUIRED");
  }
  if (document.sourceCommit !== expectedSourceCommit) {
    fail("authorization source commit differs from the checked source", "AUTHORIZATION_SOURCE_DRIFT");
  }
  if (document.matrixDigest !== matrix.matrixDigest
    || document.policyDigest !== policy.policyDigest
    || document.trustPolicyDigest !== trustPolicy.policyDigest) {
    fail("authorization release contract digests have drifted", "AUTHORIZATION_CONTRACT_DRIFT");
  }
  if (!matrix.rows?.some((row) => row.id === document.compatibilityRowId)) {
    fail("authorization references an unknown compatibility row", "AUTHORIZATION_ROW_UNKNOWN");
  }
  const checkedTrust = validateProtectedEvidenceTrustPolicy(trustPolicy);
  if (checkedTrust.contractStatus !== "runtime-ready") {
    fail("protected evidence trust policy is not runtime-ready", "AUTHORIZATION_TRUST_UNAVAILABLE");
  }
  const signer = checkedTrust.signers.find((candidate) => candidate.id === document.signer.signerId);
  if (!signer || signer.status !== "active") {
    fail("authorization signer is not active in the trust policy", "AUTHORIZATION_SIGNER_UNAVAILABLE");
  }
  if (signer.publicKeyFingerprint !== document.signer.publicKeyFingerprint
    || !signer.evidenceIds.includes("background-resume")) {
    fail("authorization signer scope differs from the trust policy", "AUTHORIZATION_SIGNER_SCOPE_MISMATCH");
  }
  if (Date.parse(document.approvedAt) < Date.parse(signer.notBefore)
    || Date.parse(document.expiresAt) > Date.parse(signer.notAfter)) {
    fail("authorization window is outside the trusted signer window", "AUTHORIZATION_SIGNER_WINDOW_MISMATCH");
  }
  const observedNow = now instanceof Date ? now.getTime() : Number(now ?? Date.now());
  if (!Number.isFinite(observedNow)
    || observedNow < Date.parse(document.approvedAt)
    || observedNow > Date.parse(document.expiresAt)) {
    fail("authorization is not active at the capture time", "AUTHORIZATION_EXPIRED");
  }
}

export function validateBackgroundResumeAuthorization(document, {
  allowTemplate = false,
  schemaPath = DEFAULT_SCHEMA,
  ...runtime
} = {}) {
  const validate = validator(schemaPath);
  if (!validate(document)) {
    fail("authorization JSON schema validation failed", "AUTHORIZATION_SCHEMA_INVALID", {
      errors: validate.errors ?? [],
    });
  }
  validateSemantics(document);
  if (document.contractStatus === "operator-template") {
    if (!allowTemplate) fail("operator templates cannot start a live capture", "AUTHORIZATION_TEMPLATE_ONLY");
  } else {
    validateRuntime(document, runtime);
  }
  return Object.freeze(jsonClone(document));
}

export function loadBackgroundResumeAuthorization(file, options = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) {
    fail("authorization file must be an explicit absolute path", "AUTHORIZATION_PATH_INVALID");
  }
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch {
    fail("authorization file is unavailable", "AUTHORIZATION_FILE_MISSING");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_AUTHORIZATION_BYTES) {
    fail("authorization must be a bounded regular non-symlink file", "AUTHORIZATION_PATH_INVALID");
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    fail("authorization file is not valid JSON", "AUTHORIZATION_JSON_INVALID");
  }
  return validateBackgroundResumeAuthorization(document, options);
}

export const SUBAGENTS_BACKGROUND_RESUME_AUTHORIZATION_SCHEMA = DEFAULT_SCHEMA;
