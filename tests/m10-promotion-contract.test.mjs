import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectM10Promotion,
  M10_EXACT_PACKAGE_TARGET,
  M10_P10_ASSERTION_IDS,
  M10_P9_ASSERTION_IDS,
  m10ProtectedEvidenceDigest,
  validateM10PromotionRecord,
  validateM10ProtectedEvidence,
  validateM10StableDecision,
} from "../packages/upstream-migration/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (character) => `sha256:${character.repeat(64)}`;

async function repositoryDocuments() {
  const read = async (relative) => JSON.parse(await fs.readFile(path.join(ROOT, relative), "utf8"));
  return {
    promotion: await read("contracts/compatibility/m10-promotion.json"),
    compatibility: await read("contracts/compatibility/upstream-candidates.json"),
    inventory: await read("inventory/packages.lock.json"),
  };
}

function protectedEvidence(gateId) {
  const p10 = gateId === "P10";
  const value = {
    formatVersion: 1,
    kind: "only-my-pi-m10-protected-evidence",
    gateId,
    evidenceId: p10 ? "m10-promoted-live-model-matrix" : "m10-real-root-migration",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-28T00:00:00.000Z",
    artifacts: { migrationBundleSha256: digest("1"), onlyMyPiArtifactSha256: digest("2"), candidateGraphDigest: digest("3") },
    assertions: (p10 ? M10_P10_ASSERTION_IDS : M10_P9_ASSERTION_IDS).map((id, index) => ({ id, status: "PASS", digest: digest(String((index + 1) % 10)) })),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
    authorization: p10
      ? { realRoots: "AUTH_AND_PRIVATE_RUN_STATE_ONLY", providerRequests: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" }
      : { realRoots: "EXPLICIT", piTermination: "SIGTERM_ONLY", providerRequests: "NOT_RUN_BY_POLICY", writer: "DENIED" },
    ...(p10 ? {
      runtime: { piVersion: "0.84.3", subagentsVersion: "0.57.0", provider: "cc-switch-open-code-go", model: "deepseek-v4-flash" },
      pricing: { mode: "subscription-fixed-fee", inputPerMillion: 0, outputPerMillion: 0, fixedFeeUsd: 10, fixedFeeIncludedInRunCost: false },
      usage: { directlyMeteredTokens: 50000, variableCostUsd: 0, wallSeconds: 1200, toolCalls: 10, meteredTerminals: 8 },
    } : {}),
    evidenceDigest: null,
  };
  value.evidenceDigest = m10ProtectedEvidenceDigest(value);
  return value;
}

test("repository M10 decision and Stable inventory are coherent in HOLD and PROMOTE states", async () => {
  const inspected = await inspectM10Promotion({ rootDir: ROOT });
  assert.ok(["HOLD", "PROMOTE"].includes(inspected.state));
  if (inspected.state === "HOLD") assert.equal(inspected.graph, null);
  else assert.deepEqual(inspected.graph, { candidateGraphDigest: inspected.graph.candidateGraphDigest, stableGraphDigest: inspected.graph.candidateGraphDigest, alignment: "MATCH" });
});

test("pure promotion contract requires exact promoted defaults and nine-package inventory", async () => {
  const value = await repositoryDocuments();
  value.promotion = { formatVersion: 1, kind: "only-my-pi-m10-promotion", state: "PROMOTE", sourceCommit: "a".repeat(40), evidenceCommit: "b".repeat(40), protectedEvidence: { P9: "verification/protected/m10-p9.json", P10: "verification/protected/m10-p10.json" } };
  value.compatibility.decision = { state: "PROMOTE", reasonCode: "M10_REAL_ROOT_AND_LIVE_ACCEPTANCE_PASSED", defaultPiVersion: "0.84.3", defaultSubagentsVersion: "0.57.0" };
  value.inventory.runtime.pi = "0.84.3";
  const packages = new Map(value.inventory.packages.map((entry) => [entry.id, entry]));
  for (const target of M10_EXACT_PACKAGE_TARGET) {
    packages.get(target.id).spec = `npm:${target.name}@${target.toVersion}`;
    packages.get(target.id).audit.integrity = target.toIntegrity;
  }
  assert.equal(validateM10StableDecision(value).state, "PROMOTE");
  value.inventory.packages.find((entry) => entry.id === "subagents").spec = "npm:pi-subagents@0.45.2";
  assert.throws(() => validateM10StableDecision(value), { code: "M10_STABLE_INVENTORY_DRIFT" });
});

test("P9 and P10 evidence validators enforce exact assertions, budget, privacy and digest", () => {
  const p9 = protectedEvidence("P9");
  const p10 = protectedEvidence("P10");
  assert.equal(validateM10ProtectedEvidence(p9, { gateId: "P9", expectedSourceCommit: "a".repeat(40) }).status, "PASS");
  assert.equal(validateM10ProtectedEvidence(p10, { gateId: "P10", expectedSourceCommit: "a".repeat(40) }).usage.variableCostUsd, 0);
  const excessive = structuredClone(p10);
  excessive.usage.directlyMeteredTokens = 100001;
  excessive.evidenceDigest = m10ProtectedEvidenceDigest(excessive);
  assert.throws(() => validateM10ProtectedEvidence(excessive, { gateId: "P10" }), { code: "M10_EVIDENCE_USAGE_INVALID" });
  const sensitive = structuredClone(p9);
  sensitive.authorization.cookie = "forbidden";
  sensitive.evidenceDigest = m10ProtectedEvidenceDigest(sensitive);
  assert.throws(() => validateM10ProtectedEvidence(sensitive, { gateId: "P9" }), { code: "M10_PROMOTION_SCHEMA_INVALID" });
});

test("HOLD promotion record cannot pre-bind future evidence", () => {
  const invalid = { formatVersion: 1, kind: "only-my-pi-m10-promotion", state: "HOLD", sourceCommit: "a".repeat(40), evidenceCommit: null, protectedEvidence: { P9: null, P10: null } };
  assert.throws(() => validateM10PromotionRecord(invalid), { code: "M10_PROMOTION_RECORD_INVALID" });
});

test("protected evidence rejects each authority, identity and budget class independently", () => {
  assert.throws(() => validateM10ProtectedEvidence({}, { gateId: "P8" }), TypeError);
  const cases = [
    ["M10_EVIDENCE_SOURCE_INVALID", "P9", (value) => { value.sourceCommit = "bad"; }],
    ["M10_EVIDENCE_STATUS_INVALID", "P9", (value) => { value.status = "FAIL"; }],
    ["M10_EVIDENCE_ARTIFACT_INVALID", "P9", (value) => { value.artifacts.candidateGraphDigest = "bad"; }],
    ["M10_EVIDENCE_ASSERTIONS_INVALID", "P9", (value) => { value.assertions.pop(); }],
    ["M10_EVIDENCE_ASSERTIONS_INVALID", "P9", (value) => { value.assertions[1].id = value.assertions[0].id; }],
    ["M10_EVIDENCE_PRIVACY_INVALID", "P9", (value) => { value.privacy.sessionsStored = true; }],
    ["M10_EVIDENCE_AUTHORITY_INVALID", "P9", (value) => { value.authorization.piTermination = "SIGKILL"; }],
    ["M10_EVIDENCE_AUTHORITY_INVALID", "P10", (value) => { value.authorization.credentials = "COPIED"; }],
    ["M10_EVIDENCE_RUNTIME_INVALID", "P10", (value) => { value.runtime.piVersion = "0.84.1"; }],
    ["M10_EVIDENCE_PRICING_INVALID", "P10", (value) => { value.pricing.fixedFeeIncludedInRunCost = true; }],
    ["M10_EVIDENCE_DIGEST_INVALID", "P10", (value) => { value.evidenceDigest = digest("9"); }, false],
  ];
  for (const [code, gateId, mutate, refresh = true] of cases) {
    const value = protectedEvidence(gateId);
    mutate(value);
    if (refresh) value.evidenceDigest = m10ProtectedEvidenceDigest(value);
    assert.throws(() => validateM10ProtectedEvidence(value, { gateId }), { code });
  }
});

test("promotion decision rejects state, runtime and record mismatches", async () => {
  const value = await repositoryDocuments();
  const invalidState = structuredClone(value.promotion);
  invalidState.state = "UNKNOWN";
  assert.throws(() => validateM10PromotionRecord(invalidState), { code: "M10_PROMOTION_RECORD_INVALID" });
  const invalidPromote = structuredClone(value.promotion);
  invalidPromote.state = "PROMOTE";
  assert.throws(() => validateM10PromotionRecord(invalidPromote), { code: "M10_PROMOTION_RECORD_INVALID" });

  const decisionMismatch = structuredClone(value);
  decisionMismatch.promotion.state = "PROMOTE";
  decisionMismatch.promotion.sourceCommit = "a".repeat(40);
  decisionMismatch.promotion.evidenceCommit = "b".repeat(40);
  decisionMismatch.promotion.protectedEvidence = { P9: "verification/protected/p9.json", P10: "verification/protected/p10.json" };
  assert.throws(() => validateM10StableDecision(decisionMismatch), { code: "M10_DECISION_DRIFT" });

  const runtimeMismatch = structuredClone(value);
  runtimeMismatch.inventory.runtime.pi = "0.84.3";
  assert.throws(() => validateM10StableDecision(runtimeMismatch), { code: "M10_DECISION_DRIFT" });
});
