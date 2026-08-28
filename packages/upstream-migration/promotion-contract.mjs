import fs from "node:fs/promises";
import path from "node:path";

import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { canonicalJson, sha256 } from "../config-runtime/index.mjs";
import { loadUpstreamCompatibility } from "../upstream-compatibility/index.mjs";
import { buildCandidateGenerationPlan } from "./candidate-target.mjs";
import { M10_EXACT_PACKAGE_TARGET } from "./contract.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EVIDENCE_PATH = /^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u;

export const M10_P9_ASSERTION_IDS = Object.freeze([
  "bundle-provenance",
  "preflight-old-stack",
  "pi-process-policy",
  "candidate-apply",
  "no-model-smoke",
  "rollback-pi",
  "rollback-external-tree",
  "rollback-settings",
  "rollback-generation-lkg",
  "rollback-cli-absence",
  "candidate-reapply",
  "transaction-terminal",
]);

export const M10_P10_ASSERTION_IDS = Object.freeze([
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
  "candidate-runtime-identity",
  "installed-generation-identity",
  "cli-generation-artifact-identity",
  "external-ownership-preservation",
  "usage-metering",
  "no-duplicate-runtime-ownership",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, expected, label) {
  if (!plain(value) || canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expected].sort())) {
    fail("M10_PROMOTION_SCHEMA_INVALID", `${label} has an unexpected field set`);
  }
}

function evidenceDigest(document) {
  const unsigned = { ...document };
  delete unsigned.evidenceDigest;
  return sha256(canonicalJson(unsigned));
}

function validateAssertions(assertions, expectedIds) {
  if (!Array.isArray(assertions) || assertions.length !== expectedIds.length) fail("M10_EVIDENCE_ASSERTIONS_INVALID", "protected evidence assertion count is invalid");
  const ids = [];
  for (const assertion of assertions) {
    exactKeys(assertion, ["id", "status", "digest"], "protected assertion");
    if (typeof assertion.id !== "string" || assertion.status !== "PASS" || !SHA256.test(assertion.digest)) fail("M10_EVIDENCE_ASSERTIONS_INVALID", "protected evidence assertion is invalid");
    ids.push(assertion.id);
  }
  if (canonicalJson([...ids].sort()) !== canonicalJson([...expectedIds].sort()) || new Set(ids).size !== ids.length) fail("M10_EVIDENCE_ASSERTIONS_INVALID", "protected evidence assertion set is invalid");
}

function rejectSensitiveShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!plain(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:api.?key|secret|password|cookie|authorization.?header|raw.?prompt|raw.?output|reasoning|host.?path|pid|command.?line)$/iu.test(key)) fail("M10_EVIDENCE_SENSITIVE_FIELD", `protected evidence contains forbidden field ${pointer}.${key}`);
    rejectSensitiveShape(child, `${pointer}.${key}`);
  }
}

export function validateM10ProtectedEvidence(input, { gateId, expectedSourceCommit } = {}) {
  const expectedAssertions = gateId === "P9" ? M10_P9_ASSERTION_IDS : gateId === "P10" ? M10_P10_ASSERTION_IDS : null;
  if (expectedAssertions === null) throw new TypeError("gateId must be P9 or P10");
  const common = ["formatVersion", "kind", "gateId", "evidenceId", "sourceCommit", "status", "createdAt", "artifacts", "assertions", "privacy", "authorization", "evidenceDigest"];
  const expectedKeys = gateId === "P10" ? [...common, "runtime", "pricing", "usage"] : common;
  exactKeys(input, expectedKeys, "protected evidence");
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-m10-protected-evidence" || input.gateId !== gateId || input.evidenceId !== (gateId === "P9" ? "m10-real-root-migration" : "m10-promoted-live-model-matrix")) fail("M10_EVIDENCE_IDENTITY_INVALID", "protected evidence identity is invalid");
  if (!FULL_SHA.test(input.sourceCommit ?? "") || (expectedSourceCommit !== undefined && input.sourceCommit !== expectedSourceCommit)) fail("M10_EVIDENCE_SOURCE_INVALID", "protected evidence source commit is invalid");
  if (input.status !== "PASS" || !Number.isFinite(Date.parse(input.createdAt))) fail("M10_EVIDENCE_STATUS_INVALID", "protected evidence status or timestamp is invalid");
  exactKeys(input.artifacts, ["migrationBundleSha256", "onlyMyPiArtifactSha256", "candidateGraphDigest"], "protected evidence artifacts");
  if (Object.values(input.artifacts).some((value) => !SHA256.test(value))) fail("M10_EVIDENCE_ARTIFACT_INVALID", "protected evidence artifact identity is invalid");
  validateAssertions(input.assertions, expectedAssertions);
  exactKeys(input.privacy, ["rawOutputStored", "hostPathsStored", "secretsStored", "sessionsStored"], "protected evidence privacy");
  if (Object.values(input.privacy).some((value) => value !== false)) fail("M10_EVIDENCE_PRIVACY_INVALID", "protected evidence privacy boundary is invalid");
  if (gateId === "P9") {
    exactKeys(input.authorization, ["realRoots", "piTermination", "providerRequests", "writer"], "P9 authorization");
    if (input.authorization.realRoots !== "EXPLICIT" || input.authorization.piTermination !== "SIGTERM_ONLY" || input.authorization.providerRequests !== "NOT_RUN_BY_POLICY" || input.authorization.writer !== "DENIED") fail("M10_EVIDENCE_AUTHORITY_INVALID", "P9 authorization boundary is invalid");
  } else {
    exactKeys(input.authorization, ["realRoots", "providerRequests", "credentials", "writer"], "P10 authorization");
    if (input.authorization.realRoots !== "AUTH_AND_PRIVATE_RUN_STATE_ONLY" || input.authorization.providerRequests !== "AUTHORIZED" || input.authorization.credentials !== "PI_RUNTIME_ONLY" || input.authorization.writer !== "DENIED") fail("M10_EVIDENCE_AUTHORITY_INVALID", "P10 authorization boundary is invalid");
    exactKeys(input.runtime, ["piVersion", "subagentsVersion", "provider", "model"], "P10 runtime");
    if (input.runtime.piVersion !== "0.84.3" || input.runtime.subagentsVersion !== "0.57.0" || input.runtime.provider !== "cc-switch-open-code-go" || input.runtime.model !== "deepseek-v4-flash") fail("M10_EVIDENCE_RUNTIME_INVALID", "P10 runtime identity is invalid");
    exactKeys(input.pricing, ["mode", "inputPerMillion", "outputPerMillion", "fixedFeeUsd", "fixedFeeIncludedInRunCost"], "P10 pricing");
    if (input.pricing.mode !== "subscription-fixed-fee" || input.pricing.inputPerMillion !== 0 || input.pricing.outputPerMillion !== 0 || input.pricing.fixedFeeUsd !== 10 || input.pricing.fixedFeeIncludedInRunCost !== false) fail("M10_EVIDENCE_PRICING_INVALID", "P10 pricing authority is invalid");
    exactKeys(input.usage, ["directlyMeteredTokens", "variableCostUsd", "wallSeconds", "toolCalls", "meteredTerminals"], "P10 usage");
    if (!Number.isSafeInteger(input.usage.directlyMeteredTokens) || input.usage.directlyMeteredTokens < 0 || input.usage.directlyMeteredTokens > 100_000
      || input.usage.variableCostUsd !== 0 || !Number.isSafeInteger(input.usage.wallSeconds) || input.usage.wallSeconds < 0 || input.usage.wallSeconds > 5_400
      || !Number.isSafeInteger(input.usage.toolCalls) || input.usage.toolCalls < 0 || !Number.isSafeInteger(input.usage.meteredTerminals) || input.usage.meteredTerminals < 0) fail("M10_EVIDENCE_USAGE_INVALID", "P10 usage is invalid");
  }
  if (!SHA256.test(input.evidenceDigest ?? "") || input.evidenceDigest !== evidenceDigest(input)) fail("M10_EVIDENCE_DIGEST_INVALID", "protected evidence digest is invalid");
  rejectSensitiveShape(input);
  const serialized = JSON.stringify(input);
  if (/\/(?:Users|home)\/[^/\s]+\//u.test(serialized)) fail("M10_EVIDENCE_HOST_PATH", "protected evidence contains a host home path");
  return Object.freeze(structuredClone(input));
}

export function m10ProtectedEvidenceDigest(input) {
  return evidenceDigest(input);
}

export function validateM10PromotionRecord(input) {
  exactKeys(input, ["formatVersion", "kind", "state", "sourceCommit", "evidenceCommit", "protectedEvidence"], "M10 promotion record");
  if (input.formatVersion !== 1 || input.kind !== "only-my-pi-m10-promotion") fail("M10_PROMOTION_RECORD_INVALID", "M10 promotion record identity is invalid");
  exactKeys(input.protectedEvidence, ["P9", "P10"], "M10 protected evidence bindings");
  if (input.state === "HOLD") {
    if (input.sourceCommit !== null || input.evidenceCommit !== null || input.protectedEvidence.P9 !== null || input.protectedEvidence.P10 !== null) fail("M10_PROMOTION_RECORD_INVALID", "HOLD record cannot bind protected promotion evidence");
  } else if (input.state === "PROMOTE") {
    if (!FULL_SHA.test(input.sourceCommit ?? "") || !FULL_SHA.test(input.evidenceCommit ?? "") || !EVIDENCE_PATH.test(input.protectedEvidence.P9 ?? "") || !EVIDENCE_PATH.test(input.protectedEvidence.P10 ?? "")) fail("M10_PROMOTION_RECORD_INVALID", "PROMOTE record requires exact source/evidence bindings");
  } else fail("M10_PROMOTION_RECORD_INVALID", "M10 promotion state must be HOLD or PROMOTE");
  return Object.freeze(structuredClone(input));
}

function expectedStableTarget(state) {
  return new Map(M10_EXACT_PACKAGE_TARGET.map((entry) => [entry.id, {
    name: entry.name,
    version: state === "PROMOTE" ? entry.toVersion : entry.fromVersion,
    integrity: state === "PROMOTE" ? entry.toIntegrity : entry.fromIntegrity,
  }]));
}

export function validateM10StableDecision({ promotion, compatibility, inventory }) {
  const record = validateM10PromotionRecord(promotion);
  if (record.state !== compatibility.decision.state) fail("M10_DECISION_DRIFT", "promotion record and machine decision differ");
  const promoted = record.state === "PROMOTE";
  const expectedDecision = promoted
    ? { reasonCode: "M10_REAL_ROOT_AND_LIVE_ACCEPTANCE_PASSED", pi: "0.84.3", subagents: "0.57.0" }
    : { reasonCode: "CANDIDATE_PROMOTION_REVIEW_PENDING", pi: "0.84.1", subagents: "0.45.2" };
  if (compatibility.baseline.piVersion !== "0.84.1" || compatibility.baseline.subagentsVersion !== "0.45.2"
    || compatibility.decision.reasonCode !== expectedDecision.reasonCode
    || compatibility.decision.defaultPiVersion !== expectedDecision.pi
    || compatibility.decision.defaultSubagentsVersion !== expectedDecision.subagents
    || inventory.runtime?.pi !== expectedDecision.pi) fail("M10_DECISION_DRIFT", "Stable runtime defaults differ from the governed M10 state");
  const expected = expectedStableTarget(record.state);
  const byId = new Map(inventory.packages.map((entry) => [entry.id, entry]));
  for (const [id, target] of expected) {
    const actual = byId.get(id);
    if (actual?.spec !== `npm:${target.name}@${target.version}` || actual?.audit?.integrity !== target.integrity) fail("M10_STABLE_INVENTORY_DRIFT", `Stable package inventory drifted for ${id}`);
  }
  return record;
}

async function readJson(rootDir, relative) {
  const target = path.resolve(rootDir, relative);
  const root = await fs.realpath(rootDir);
  const real = await fs.realpath(target);
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) fail("M10_PROMOTION_PATH_UNSAFE", `${relative} escapes the repository`);
  return JSON.parse(await fs.readFile(real, "utf8"));
}

export async function inspectM10Promotion({ rootDir } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("inspectM10Promotion requires an absolute rootDir");
  const [promotion, inventory] = await Promise.all([
    readJson(rootDir, "contracts/compatibility/m10-promotion.json"),
    readJson(rootDir, "inventory/packages.lock.json"),
  ]);
  const compatibility = loadUpstreamCompatibility({ rootDir });
  const record = validateM10StableDecision({ promotion, compatibility, inventory });
  let graph = null;
  if (record.state === "PROMOTE") {
    const [candidate, stable] = await Promise.all([
      buildCandidateGenerationPlan({ rootDir }),
      buildGenerationPlan({ rootDir, profileId: "daily" }),
    ]);
    if (candidate.graphDigest !== stable.graphDigest) fail("M10_PROMOTED_GRAPH_DRIFT", "candidate target and promoted Stable graph differ");
    graph = Object.freeze({ candidateGraphDigest: candidate.graphDigest, stableGraphDigest: stable.graphDigest, alignment: "MATCH" });
  }
  return Object.freeze({ state: record.state, record, decision: compatibility.decision, graph });
}

export async function loadM10ProtectedEvidence({ rootDir, relativePath, gateId, expectedSourceCommit }) {
  if (!EVIDENCE_PATH.test(relativePath ?? "")) fail("M10_EVIDENCE_PATH_INVALID", "protected evidence path is invalid");
  return validateM10ProtectedEvidence(await readJson(rootDir, relativePath), { gateId, expectedSourceCommit });
}
