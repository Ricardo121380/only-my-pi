import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import semver from "semver";

import { jsonClone, sha256, withoutKey } from "../state/codec.mjs";
import { loadProtectedEvidenceSet, protectedEvidenceSummary } from "./protected-evidence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "../../..");
const COMPATIBILITY_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-compatibility-v1.schema.json");
const PROMOTION_SCHEMA = path.join(DEFAULT_ROOT, "schemas", "subagents-promotion-policy-v1.schema.json");
const CHANNELS = Object.freeze(["preview", "alpha", "beta", "stable"]);
const LIVE_SCOPES = new Set([
  "liveAgentTerminal",
  "liveAgentCancel",
  "liveBatchTerminal",
  "backgroundResume",
  "guardedWriterIntegration",
]);
const STATUS_VALUES = new Set([
  "PASS",
  "CONFIGURED_UNVERIFIED",
  "NOT_RUN_BY_POLICY",
  "NOT_RUN_ENVIRONMENT",
  "UNAVAILABLE",
]);

export class SubagentsReleaseContractError extends Error {
  constructor(message, code, details = {}) {
    super(`subagents release contract: ${message}`);
    this.name = "SubagentsReleaseContractError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new SubagentsReleaseContractError(message, code, details);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function schemaValidator(schemaPath) {
  const schema = readJson(schemaPath);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(schema);
}

function assertSchema(document, schemaPath, code) {
  const validate = schemaValidator(schemaPath);
  if (!validate(document)) fail("JSON schema validation failed", code, { errors: validate.errors ?? [] });
}

function exactDigest(document, digestKey) {
  return sha256(withoutKey(withoutKey(document, "$schema"), digestKey));
}

export function compatibilityMatrixDigest(matrix) {
  const base = jsonClone(withoutKey(withoutKey(matrix, "$schema"), "matrixDigest"));
  for (const row of base.rows ?? []) {
    for (const scope of LIVE_SCOPES) {
      if (Object.hasOwn(row.scopes ?? {}, scope)) row.scopes[scope] = "NOT_RUN_BY_POLICY";
    }
    if (Array.isArray(row.evidence)) {
      row.evidence = row.evidence.filter((entry) => !entry.startsWith("verification/protected/"));
    }
  }
  return sha256(base);
}

export function promotionPolicyDigest(policy) {
  return exactDigest(policy, "policyDigest");
}

function ensureEvidencePath(rootDir, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || path.isAbsolute(relativePath) || relativePath.includes("\0") || relativePath.split("/").includes("..")) {
    fail(`unsafe evidence path: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  }
  const root = fs.realpathSync(rootDir);
  const target = fs.realpathSync(path.resolve(root, relativePath));
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`evidence path escapes repository: ${relativePath}`, "UNSAFE_EVIDENCE_PATH");
  return target;
}

function evidenceIncludes(row, expected) {
  return row.evidence.some((entry) => entry === expected);
}

function assertCompatibilitySemantics(matrix, { rootDir, verifyEvidencePaths }) {
  if (matrix.matrixDigest !== compatibilityMatrixDigest(matrix)) fail("matrix digest drift detected", "MATRIX_DIGEST_DRIFT");
  const ids = matrix.rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) fail("matrix row ids must be unique", "DUPLICATE_MATRIX_ROW");

  let noModelPass = false;
  let topologyPass = false;
  for (const row of matrix.rows) {
    if (row.environment.pi !== matrix.policy.piVersion
      || row.environment.backend !== `${matrix.policy.backend.package}@${matrix.policy.backend.version}`) {
      fail(`row ${row.id} drifts from the pinned runtime policy`, "PINNED_RUNTIME_DRIFT", { rowId: row.id });
    }
    const exactNode = semver.valid(row.environment.node);
    if (exactNode !== null && !semver.satisfies(exactNode, matrix.policy.nodeRange)) {
      fail(`row ${row.id} is outside the supported Node range`, "NODE_RANGE_MISMATCH", { rowId: row.id });
    }
    if (exactNode === null && Object.values(row.scopes).includes("PASS")) {
      fail(`row ${row.id} cannot claim PASS with a non-exact Node version`, "NONEXACT_NODE_PASS", { rowId: row.id });
    }
    for (const [scope, status] of Object.entries(row.scopes)) {
      if (!STATUS_VALUES.has(status)) fail(`row ${row.id} has an unknown scope status`, "UNKNOWN_COMPATIBILITY_STATUS", { rowId: row.id, scope, status });
      if (LIVE_SCOPES.has(scope) && status === "PASS" && !row.evidence.some((entry) => entry.startsWith("verification/protected/"))) {
        fail(`live scope ${scope} lacks protected evidence`, "LIVE_EVIDENCE_REQUIRED", { rowId: row.id, scope });
      }
    }
    if (row.scopes.noModelRpc === "PASS") {
      noModelPass = true;
      if (!evidenceIncludes(row, "contracts/subagents/pi-subagents-live-no-model-evidence.json")) {
        fail("no-model RPC PASS lacks the digest-bound capability receipt", "NO_MODEL_EVIDENCE_REQUIRED", { rowId: row.id });
      }
    }
    if (row.scopes.singleOwnerTopology === "PASS") {
      topologyPass = true;
      if (!evidenceIncludes(row, "tests/subagents-topology.test.mjs")) {
        fail("single-owner topology PASS lacks its contract test", "TOPOLOGY_EVIDENCE_REQUIRED", { rowId: row.id });
      }
    }
    if (row.scopes.migrationRollback === "PASS" && !evidenceIncludes(row, "tests/subagents-migration.test.mjs")) {
      fail("migration/rollback PASS lacks its contract test", "MIGRATION_EVIDENCE_REQUIRED", { rowId: row.id });
    }
    if (verifyEvidencePaths) for (const evidence of row.evidence) ensureEvidencePath(rootDir, evidence);
  }
  if (!noModelPass || !topologyPass) fail("matrix needs at least one proved no-model RPC and single-owner row", "MISSING_PREVIEW_COMPATIBILITY_EVIDENCE");
}

export function validateCompatibilityMatrix(matrix, {
  rootDir = DEFAULT_ROOT,
  verifyEvidencePaths = false,
  schemaPath = COMPATIBILITY_SCHEMA,
} = {}) {
  assertSchema(matrix, schemaPath, "COMPATIBILITY_SCHEMA_INVALID");
  assertCompatibilitySemantics(matrix, { rootDir: path.resolve(rootDir), verifyEvidencePaths });
  return Object.freeze(jsonClone(matrix));
}

function assertPromotionSemantics(policy) {
  if (policy.policyDigest !== promotionPolicyDigest(policy)) fail("promotion policy digest drift detected", "POLICY_DIGEST_DRIFT");
  const ids = policy.channels.map((channel) => channel.id);
  if (JSON.stringify(ids) !== JSON.stringify(CHANNELS)) fail("promotion channels must be ordered preview, alpha, beta, stable", "PROMOTION_CHANNEL_ORDER");
  for (const [index, channel] of policy.channels.entries()) {
    const expectedParent = index === 0 ? null : CHANNELS[index - 1];
    if (channel.rank !== index || channel.inherits !== expectedParent) {
      fail(`promotion channel ${channel.id} has an invalid rank or inheritance edge`, "PROMOTION_INHERITANCE_INVALID", { channel: channel.id });
    }
    for (const field of ["requiredDeterministicGates", "requiredCompatibilityScopes", "requiredProtectedEvidence"]) {
      if (new Set(channel[field]).size !== channel[field].length) fail(`${channel.id}.${field} contains duplicates`, "DUPLICATE_PROMOTION_REQUIREMENT");
      const sorted = [...channel[field]].sort();
      if (JSON.stringify(sorted) !== JSON.stringify(channel[field])) fail(`${channel.id}.${field} must use canonical order`, "NONCANONICAL_PROMOTION_REQUIREMENTS");
    }
  }
}

export function validatePromotionPolicy(policy, { schemaPath = PROMOTION_SCHEMA } = {}) {
  assertSchema(policy, schemaPath, "PROMOTION_SCHEMA_INVALID");
  assertPromotionSemantics(policy);
  return Object.freeze(jsonClone(policy));
}

function cumulativeRequirements(policy, requested) {
  const requestedRank = CHANNELS.indexOf(requested);
  if (requestedRank < 0) fail(`unknown requested promotion: ${requested}`, "UNKNOWN_PROMOTION");
  const channels = policy.channels.slice(0, requestedRank + 1);
  const collect = (key) => [...new Set(channels.flatMap((channel) => channel[key]))].sort();
  return {
    deterministicGates: collect("requiredDeterministicGates"),
    compatibilityScopes: collect("requiredCompatibilityScopes"),
    protectedEvidence: collect("requiredProtectedEvidence"),
  };
}

function scopeStatus(matrix, scope) {
  return matrix.rows.some((row) => row.scopes[scope] === "PASS") ? "PASS" : "UNAVAILABLE";
}

function protectedStatus(value, expectedId) {
  if (value === undefined || value === null) return "NOT_RUN_BY_POLICY";
  if (typeof value !== "object" || Array.isArray(value)) return "INVALID";
  if (value.id !== expectedId || !/^sha256:[a-f0-9]{64}$/u.test(value.evidenceDigest ?? "")) return "INVALID";
  return "PASS";
}

function evaluateChannel(channel, policy, matrix, deterministicGates, protectedEvidence) {
  const requirements = cumulativeRequirements(policy, channel);
  const findings = [];
  for (const id of requirements.deterministicGates) {
    const status = deterministicGates[id] ?? "UNAVAILABLE";
    if (status !== "PASS") findings.push({ kind: "deterministic-gate", id, status });
  }
  for (const scope of requirements.compatibilityScopes) {
    const status = scopeStatus(matrix, scope);
    if (status !== "PASS") findings.push({ kind: "compatibility-scope", id: scope, status });
  }
  for (const id of requirements.protectedEvidence) {
    const status = protectedStatus(protectedEvidence[id], id);
    if (status !== "PASS") findings.push({ kind: "protected-evidence", id, status });
  }
  return { channel, eligible: findings.length === 0, requirements, findings };
}

export function evaluateSubagentsPromotion({
  requested = "preview",
  matrix,
  policy,
  deterministicGates = {},
  protectedEvidence = {},
  trustPolicy,
  expectedSourceCommit,
  rootDir = DEFAULT_ROOT,
  verifyEvidencePaths = false,
} = {}) {
  const checkedMatrix = validateCompatibilityMatrix(matrix, { rootDir, verifyEvidencePaths });
  const checkedPolicy = validatePromotionPolicy(policy);
  const loadedProtectedEvidence = Object.keys(protectedEvidence).length === 0
    ? Object.freeze({})
    : loadProtectedEvidenceSet(protectedEvidence, {
      rootDir,
      matrix: checkedMatrix,
      policy: checkedPolicy,
      trustPolicy,
      expectedSourceCommit,
    });
  const requestedRank = CHANNELS.indexOf(requested);
  if (requestedRank < 0) fail(`unknown requested promotion: ${requested}`, "UNKNOWN_PROMOTION");
  const evaluations = CHANNELS.slice(0, requestedRank + 1).map((channel) => evaluateChannel(
    channel,
    checkedPolicy,
    checkedMatrix,
    deterministicGates,
    loadedProtectedEvidence,
  ));
  let achieved = null;
  for (const evaluation of evaluations) {
    if (!evaluation.eligible) break;
    achieved = evaluation.channel;
  }
  const result = {
    formatVersion: 1,
    requested,
    achieved,
    eligible: achieved === requested,
    matrixDigest: checkedMatrix.matrixDigest,
    policyDigest: checkedPolicy.policyDigest,
    evaluations,
    ...(Object.keys(loadedProtectedEvidence).length > 0
      ? { protectedEvidence: protectedEvidenceSummary(loadedProtectedEvidence) }
      : {}),
  };
  return Object.freeze({ ...result, evaluationDigest: sha256(result) });
}

export function loadSubagentsReleaseContracts({ rootDir = DEFAULT_ROOT } = {}) {
  const root = path.resolve(rootDir);
  return Object.freeze({
    matrix: readJson(path.join(root, "contracts", "subagents", "compatibility-matrix.json")),
    policy: readJson(path.join(root, "contracts", "subagents", "promotion-policy.json")),
  });
}

export const SUBAGENTS_PROMOTION_CHANNELS = CHANNELS;
