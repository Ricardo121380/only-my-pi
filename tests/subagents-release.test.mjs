import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compatibilityMatrixDigest,
  evaluateSubagentsPromotion,
  loadSubagentsReleaseContracts,
  promotionPolicyDigest,
  validateCompatibilityMatrix,
  validatePromotionPolicy,
} from "../packages/subagents/release/compatibility.mjs";

const root = path.resolve(".");

function contracts() {
  return structuredClone(loadSubagentsReleaseContracts({ rootDir: root }));
}

function previewGates(policy) {
  const preview = policy.channels.find((channel) => channel.id === "preview");
  return Object.fromEntries(preview.requiredDeterministicGates.map((id) => [id, "PASS"]));
}

test("versioned compatibility and promotion contracts validate their exact digests and evidence paths", () => {
  const { matrix, policy } = contracts();
  assert.equal(validateCompatibilityMatrix(matrix, { rootDir: root, verifyEvidencePaths: true }).matrixDigest, matrix.matrixDigest);
  assert.equal(validatePromotionPolicy(policy).policyDigest, policy.policyDigest);
  assert.equal(compatibilityMatrixDigest(matrix), matrix.matrixDigest);
  assert.equal(promotionPolicyDigest(policy), policy.policyDigest);
});

test("Preview can pass deterministic gates while Alpha remains NOT_RUN_BY_POLICY", () => {
  const { matrix, policy } = contracts();
  const deterministicGates = previewGates(policy);
  const preview = evaluateSubagentsPromotion({ requested: "preview", matrix, policy, deterministicGates });
  assert.equal(preview.eligible, true);
  assert.equal(preview.achieved, "preview");

  const alpha = evaluateSubagentsPromotion({ requested: "alpha", matrix, policy, deterministicGates });
  assert.equal(alpha.eligible, false);
  assert.equal(alpha.achieved, "preview");
  const alphaFindings = alpha.evaluations.find((entry) => entry.channel === "alpha").findings;
  assert.ok(alphaFindings.some((entry) => entry.kind === "protected-evidence" && entry.status === "NOT_RUN_BY_POLICY"));
  assert.ok(alphaFindings.some((entry) => entry.kind === "compatibility-scope" && entry.status === "UNAVAILABLE"));
});

test("a schema-shaped protected PASS descriptor is rejected before compatibility evaluation", () => {
  const { matrix, policy } = contracts();
  const evidence = Object.fromEntries([
    "live-agent-cancel",
    "live-agent-terminal",
    "live-batch-terminal",
  ].map((id) => [id, {
    id,
    status: "PASS",
    source: `verification/protected/${id}.json`,
    evidenceDigest: `sha256:${"a".repeat(64)}`,
  }]));
  assert.throws(() => evaluateSubagentsPromotion({
    requested: "alpha",
    matrix,
    policy,
    deterministicGates: previewGates(policy),
    protectedEvidence: evidence,
  }), { code: "EVIDENCE_DESCRIPTOR_FORBIDDEN" });
});

test("matrix and policy drift, floating PASS versions, and forged live evidence fail closed", () => {
  const { matrix, policy } = contracts();

  const driftedMatrix = structuredClone(matrix);
  driftedMatrix.rows[0].environment.node = "25.8.1";
  assert.throws(() => validateCompatibilityMatrix(driftedMatrix), { code: "MATRIX_DIGEST_DRIFT" });

  const floatingPass = structuredClone(matrix);
  floatingPass.rows[2].scopes.repositoryContracts = "PASS";
  floatingPass.matrixDigest = compatibilityMatrixDigest(floatingPass);
  assert.throws(() => validateCompatibilityMatrix(floatingPass), { code: "NONEXACT_NODE_PASS" });

  const forgedLive = structuredClone(matrix);
  forgedLive.rows[0].scopes.liveAgentTerminal = "PASS";
  forgedLive.matrixDigest = compatibilityMatrixDigest(forgedLive);
  assert.throws(() => validateCompatibilityMatrix(forgedLive), { code: "LIVE_EVIDENCE_REQUIRED" });

  const driftedPolicy = structuredClone(policy);
  driftedPolicy.channels[1].rank = 3;
  assert.throws(() => validatePromotionPolicy(driftedPolicy), { code: "POLICY_DIGEST_DRIFT" });
});

test("evidence verification rejects missing and symlink-escaping repository paths", (t) => {
  const { matrix } = contracts();
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-compat-"));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-compat-outside-"));
  t.after(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(temporaryRoot, "contracts", "subagents"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "tests"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "docs", "compatibility"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, ".github", "workflows"), { recursive: true });
  for (const relative of matrix.rows.flatMap((row) => row.evidence)) {
    const target = path.join(temporaryRoot, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, "bounded evidence\n");
  }
  fs.writeFileSync(path.join(outsideRoot, "escape.json"), "{}\n");
  fs.rmSync(path.join(temporaryRoot, "tests", "subagents-topology.test.mjs"));
  fs.symlinkSync(path.join(outsideRoot, "escape.json"), path.join(temporaryRoot, "tests", "subagents-topology.test.mjs"));
  assert.throws(
    () => validateCompatibilityMatrix(matrix, { rootDir: temporaryRoot, verifyEvidencePaths: true }),
    { code: "UNSAFE_EVIDENCE_PATH" },
  );
});
