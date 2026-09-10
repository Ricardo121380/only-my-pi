import crypto from "node:crypto";

import { canonicalJson } from "../config-runtime/index.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EVIDENCE_PATH = /^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u;
const RECEIPT_PATH = /^verification\/receipts\/[a-z0-9][a-z0-9._-]*\.json$/u;

export const PUBLIC_BASELINE_ASSERTION_IDS = Object.freeze([
  "agent-terminal",
  "batch-swarm",
  "workflow-artifact-flow",
  "swarm-goal-replan",
  "ultra-agent-route",
  "ultra-workflow-route",
  "public-web",
  "cancellation",
  "cross-session-resume",
  "budget-denial",
  "writer-denial",
  "runtime-identity",
  "installed-generation-identity",
  "cli-generation-artifact-identity",
  "external-ownership-preservation",
  "usage-metering",
  "no-duplicate-runtime-ownership",
  "sanitized-artifact-apply",
  "no-model-smoke",
  "private-baseline-rollback",
  "private-baseline-exact-identity",
  "sanitized-artifact-reapply",
  "legacy-authority-retired",
].sort());

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, expected, label) {
  if (!plain(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail("PUBLIC_BASELINE_SCHEMA_INVALID", `${label} has an unexpected field set`);
  }
}

function rejectSensitiveShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!plain(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:api.?key|token|secret|password|cookie|authorization.?header|raw.?prompt|raw.?output|reasoning|host.?path|pid|command.?line)$/iu.test(key)) {
      fail("PUBLIC_BASELINE_SENSITIVE_FIELD", `public baseline document contains forbidden field ${pointer}.${key}`);
    }
    rejectSensitiveShape(child, `${pointer}.${key}`);
  }
}

export function publicBaselineDigest(value) {
  const unsigned = structuredClone(value);
  delete unsigned.evidenceDigest;
  delete unsigned.receiptDigest;
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex")}`;
}

export function validatePublicBaselineRecord(input) {
  exactKeys(input, [
    "formatVersion", "kind", "state", "legacyAuthority", "stable", "sourceCommit",
    "evidenceCommit", "protectedEvidence", "completionReceipt",
  ], "public baseline record");
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-public-baseline") {
    fail("PUBLIC_BASELINE_IDENTITY_INVALID", "public baseline record identity is invalid");
  }
  exactKeys(input.legacyAuthority, ["path", "registryDigest", "currentReleaseAuthority"], "legacy authority binding");
  if (input.legacyAuthority.path !== "verification/legacy-authority-v1.json"
    || !SHA256.test(input.legacyAuthority.registryDigest ?? "")
    || input.legacyAuthority.currentReleaseAuthority !== false) {
    fail("PUBLIC_BASELINE_LEGACY_AUTHORITY_INVALID", "legacy authority must remain retired");
  }
  exactKeys(input.stable, ["piVersion", "subagentsVersion", "graphDigest", "profile", "capability"], "stable binding");
  if (input.stable.piVersion !== "0.84.3" || input.stable.subagentsVersion !== "0.57.0"
    || !SHA256.test(input.stable.graphDigest ?? "") || input.stable.profile !== "daily"
    || input.stable.capability !== "READ_ONLY") {
    fail("PUBLIC_BASELINE_STABLE_INVALID", "public baseline Stable binding drifted");
  }
  if (input.state === "PUBLIC_BASELINE_PENDING") {
    if ([input.sourceCommit, input.evidenceCommit, input.protectedEvidence, input.completionReceipt].some((value) => value !== null)) {
      fail("PUBLIC_BASELINE_PENDING_INVALID", "pending public baseline cannot claim protected authority");
    }
  } else if (input.state === "PUBLIC_BASELINE_VERIFIED") {
    if (!FULL_SHA.test(input.sourceCommit ?? "") || !FULL_SHA.test(input.evidenceCommit ?? "")
      || !EVIDENCE_PATH.test(input.protectedEvidence ?? "") || !RECEIPT_PATH.test(input.completionReceipt ?? "")) {
      fail("PUBLIC_BASELINE_VERIFIED_INVALID", "verified public baseline requires exact source, evidence, and receipt bindings");
    }
  } else {
    fail("PUBLIC_BASELINE_STATE_INVALID", "public baseline state is invalid");
  }
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}

export function validatePublicBaselineEvidence(input, { expectedSourceCommit } = {}) {
  exactKeys(input, [
    "formatVersion", "kind", "evidenceId", "sourceCommit", "status", "createdAt",
    "artifacts", "runtime", "pricing", "usage", "assertions", "privacy",
    "authorization", "evidenceDigest",
  ], "public baseline evidence");
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-public-baseline-evidence"
    || input.evidenceId !== "public-baseline-live-matrix" || input.status !== "PASS"
    || !FULL_SHA.test(input.sourceCommit ?? "")
    || (expectedSourceCommit !== undefined && input.sourceCommit !== expectedSourceCommit)
    || !Number.isFinite(Date.parse(input.createdAt))) {
    fail("PUBLIC_BASELINE_EVIDENCE_IDENTITY_INVALID", "public baseline evidence identity is invalid");
  }
  exactKeys(input.artifacts, ["sanitizedArtifactSha256", "priorIdentityDigest", "stableGraphDigest", "installedGenerationId"], "evidence artifacts");
  if (Object.values(input.artifacts).some((value) => !SHA256.test(value))) fail("PUBLIC_BASELINE_EVIDENCE_ARTIFACT_INVALID", "public baseline artifact identity is invalid");
  exactKeys(input.runtime, ["piVersion", "subagentsVersion", "provider", "model"], "evidence runtime");
  if (input.runtime.piVersion !== "0.84.3" || input.runtime.subagentsVersion !== "0.57.0"
    || input.runtime.provider !== "cc-switch-open-code-go" || input.runtime.model !== "deepseek-v4-flash") {
    fail("PUBLIC_BASELINE_EVIDENCE_RUNTIME_INVALID", "public baseline runtime identity is invalid");
  }
  exactKeys(input.pricing, ["mode", "inputPerMillion", "outputPerMillion", "fixedFeeUsd", "fixedFeeIncludedInRunCost"], "evidence pricing");
  if (input.pricing.mode !== "subscription-fixed-fee" || input.pricing.inputPerMillion !== 0
    || input.pricing.outputPerMillion !== 0 || input.pricing.fixedFeeUsd !== 10
    || input.pricing.fixedFeeIncludedInRunCost !== false) {
    fail("PUBLIC_BASELINE_EVIDENCE_PRICING_INVALID", "public baseline pricing authority is invalid");
  }
  exactKeys(input.usage, ["directlyMeteredTokens", "variableCostUsd", "wallSeconds", "toolCalls", "meteredTerminals"], "evidence usage");
  if (!Number.isSafeInteger(input.usage.directlyMeteredTokens) || input.usage.directlyMeteredTokens < 0 || input.usage.directlyMeteredTokens > 100_000
    || input.usage.variableCostUsd !== 0 || !Number.isSafeInteger(input.usage.wallSeconds) || input.usage.wallSeconds < 0 || input.usage.wallSeconds > 5_400
    || !Number.isSafeInteger(input.usage.toolCalls) || input.usage.toolCalls < 0
    || !Number.isSafeInteger(input.usage.meteredTerminals) || input.usage.meteredTerminals < 0) {
    fail("PUBLIC_BASELINE_EVIDENCE_USAGE_INVALID", "public baseline usage is invalid");
  }
  if (!Array.isArray(input.assertions) || input.assertions.length !== PUBLIC_BASELINE_ASSERTION_IDS.length) {
    fail("PUBLIC_BASELINE_EVIDENCE_ASSERTIONS_INVALID", "public baseline assertion count is invalid");
  }
  const ids = [];
  for (const assertion of input.assertions) {
    exactKeys(assertion, ["id", "status", "digest"], "public baseline assertion");
    if (assertion.status !== "PASS" || typeof assertion.id !== "string" || !SHA256.test(assertion.digest ?? "")) {
      fail("PUBLIC_BASELINE_EVIDENCE_ASSERTIONS_INVALID", "public baseline assertion is invalid");
    }
    ids.push(assertion.id);
  }
  if (new Set(ids).size !== ids.length || canonicalJson([...ids].sort()) !== canonicalJson(PUBLIC_BASELINE_ASSERTION_IDS)) {
    fail("PUBLIC_BASELINE_EVIDENCE_ASSERTIONS_INVALID", "public baseline assertion set is invalid");
  }
  exactKeys(input.privacy, ["rawOutputStored", "hostPathsStored", "secretsStored", "sessionsStored"], "evidence privacy");
  if (Object.values(input.privacy).some((value) => value !== false)) fail("PUBLIC_BASELINE_EVIDENCE_PRIVACY_INVALID", "public baseline evidence privacy boundary is invalid");
  exactKeys(input.authorization, ["realRoots", "providerRequests", "credentials", "writer"], "evidence authorization");
  if (input.authorization.realRoots !== "EXPLICIT_APPLY_ROLLBACK_REAPPLY"
    || input.authorization.providerRequests !== "AUTHORIZED"
    || input.authorization.credentials !== "PI_RUNTIME_ONLY" || input.authorization.writer !== "DENIED") {
    fail("PUBLIC_BASELINE_EVIDENCE_AUTHORITY_INVALID", "public baseline evidence authority is invalid");
  }
  if (!SHA256.test(input.evidenceDigest ?? "") || input.evidenceDigest !== publicBaselineDigest(input)) {
    fail("PUBLIC_BASELINE_EVIDENCE_DIGEST_INVALID", "public baseline evidence digest is invalid");
  }
  rejectSensitiveShape(input);
  if (/\/(?:Users|home)\/[^/\s]+\//u.test(JSON.stringify(input))) fail("PUBLIC_BASELINE_EVIDENCE_HOST_PATH", "public baseline evidence contains a host path");
  return Object.freeze(structuredClone(input));
}

export function validatePublicBaselineReceipt(input) {
  exactKeys(input, [
    "formatVersion", "kind", "status", "sourceCommit", "evidenceCommit", "evidencePath",
    "evidenceDigest", "stableGraphDigest", "legacyRegistryDigest", "gateResults", "receiptDigest",
  ], "public baseline receipt");
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-public-baseline-receipt" || input.status !== "PUBLIC_BASELINE_VERIFIED"
    || !FULL_SHA.test(input.sourceCommit ?? "") || !FULL_SHA.test(input.evidenceCommit ?? "")
    || !EVIDENCE_PATH.test(input.evidencePath ?? "")
    || ![input.evidenceDigest, input.stableGraphDigest, input.legacyRegistryDigest, input.receiptDigest].every((value) => SHA256.test(value ?? ""))) {
    fail("PUBLIC_BASELINE_RECEIPT_INVALID", "public baseline receipt identity is invalid");
  }
  if (!Array.isArray(input.gateResults) || input.gateResults.length !== 5
    || input.gateResults.some((entry, index) => entry?.id !== `PB${index + 1}` || entry.status !== "PASS")) {
    fail("PUBLIC_BASELINE_RECEIPT_INVALID", "public baseline receipt gates are incomplete");
  }
  if (input.receiptDigest !== publicBaselineDigest(input)) fail("PUBLIC_BASELINE_RECEIPT_INVALID", "public baseline receipt digest is invalid");
  rejectSensitiveShape(input);
  return Object.freeze(structuredClone(input));
}
