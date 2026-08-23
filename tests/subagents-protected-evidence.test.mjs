import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createProtectedEvidenceDocument,
  loadProtectedEvidenceTrustPolicy,
  loadProtectedEvidenceFile,
  loadProtectedEvidenceSet,
  PROTECTED_EVIDENCE_REQUIREMENTS,
  protectedEvidenceDigest,
  protectedEvidenceSigningDigest,
  protectedEvidenceSummary,
  protectedEvidenceTrustPolicyDigest,
  validateProtectedEvidenceDocument,
} from "../packages/subagents/release/protected-evidence.mjs";
import {
  compatibilityMatrixDigest,
  evaluateSubagentsPromotion,
  loadSubagentsReleaseContracts,
} from "../packages/subagents/release/compatibility.mjs";
import { sha256 } from "../packages/subagents/state/codec.mjs";

const repositoryRoot = path.resolve(".");
const sourceCommit = "a".repeat(40);

function contracts() {
  return structuredClone(loadSubagentsReleaseContracts({ rootDir: repositoryRoot }));
}

function signingFixture(evidenceIds = Object.keys(PROTECTED_EVIDENCE_REQUIREMENTS)) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyBytes = publicKey.export({ format: "der", type: "spki" });
  const publicKeySpki = publicKeyBytes.toString("base64");
  const publicKeyFingerprint = sha256(publicKeyBytes);
  const trustPolicy = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/subagents-protected-evidence-trust-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id: "only-my-pi-subagents-protected-evidence-trust",
    algorithm: "ed25519",
    signers: [{
      id: "test-operator",
      status: "active",
      authorizationClass: "local-operator-protected-live",
      publicKeySpki,
      publicKeyFingerprint,
      evidenceIds,
      notBefore: "2026-08-20T00:00:00.000Z",
      notAfter: "2026-08-22T00:00:00.000Z",
    }],
  };
  trustPolicy.policyDigest = protectedEvidenceTrustPolicyDigest(trustPolicy);
  return { privateKey, publicKeyFingerprint, trustPolicy };
}

function evidenceInput(id, { matrix, policy, signing, overrides = {} } = {}) {
  const requirement = PROTECTED_EVIDENCE_REQUIREMENTS[id];
  const row = matrix.rows[0];
  const base = {
    formatVersion: 1,
    contractStatus: "protected-live-evidence",
    id,
    status: "PASS",
    sourceCommit,
    matrixDigest: matrix.matrixDigest,
    policyDigest: policy.policyDigest,
    trustPolicyDigest: signing.trustPolicy.policyDigest,
    compatibilityRowId: row.id,
    observedAt: "2026-08-20T01:02:03.000Z",
    environment: structuredClone(row.environment),
    authorization: {
      providerRequests: "AUTHORIZED",
      liveChildDispatch: "AUTHORIZED",
      liveWriter: requirement.writerAuthorized ? "AUTHORIZED" : "NOT_RUN_BY_POLICY",
      realPiHome: "NOT_TOUCHED",
      disposableRoot: true,
    },
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsStored: false,
      sessionIdsStored: false,
    },
    claims: {
      authoritativeTerminals: requirement.minimumAuthoritativeTerminals,
      batchItemCount: requirement.minimumBatchItems,
      cancelObserved: requirement.claims.cancelObserved,
      backgroundResume: requirement.claims.backgroundResume,
      managedWorktree: requirement.claims.managedWorktree,
      parentDiffVerified: requirement.claims.parentDiffVerified,
      autoIntegrated: false,
    },
    proofs: requirement.requiredProofs.map((kind) => ({ kind, digest: sha256(`proof:${id}:${kind}`) })),
    attestation: {
      class: "operator-authorized-live-import",
      signerId: "test-operator",
      publicKeyFingerprint: signing.publicKeyFingerprint,
      authorizationDigest: sha256(`authorization:${id}`),
      captureDigest: sha256(`capture:${id}`),
      signedPayloadDigest: `sha256:${"0".repeat(64)}`,
      signature: Buffer.alloc(64).toString("base64"),
    },
  };
  return { ...base, ...structuredClone(overrides) };
}

function signedEvidence(id, { matrix, policy, signing, overrides = {} }) {
  const input = evidenceInput(id, { matrix, policy, signing, overrides });
  input.attestation.signedPayloadDigest = protectedEvidenceSigningDigest(input);
  input.attestation.signature = crypto.sign(
    null,
    Buffer.from(input.attestation.signedPayloadDigest, "utf8"),
    signing.privateKey,
  ).toString("base64");
  return createProtectedEvidenceDocument(input);
}

function writeEvidence(root, id, document) {
  const relativePath = `verification/protected/${id}.json`;
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  return relativePath;
}

function matrixWithLiveEvidence(matrix, evidencePaths) {
  const output = structuredClone(matrix);
  const row = output.rows[0];
  for (const [id, relativePath] of Object.entries(evidencePaths)) {
    row.scopes[PROTECTED_EVIDENCE_REQUIREMENTS[id].scope] = "PASS";
    if (!row.evidence.includes(relativePath)) row.evidence.push(relativePath);
  }
  row.evidence.sort();
  output.matrixDigest = compatibilityMatrixDigest(output);
  return output;
}

test("all promotion evidence classes bind source, runtime, proof receipts, and low-sensitivity boundaries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-protected-evidence-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = contracts();
  const paths = Object.fromEntries(Object.keys(PROTECTED_EVIDENCE_REQUIREMENTS)
    .map((id) => [id, `verification/protected/${id}.json`]));
  const matrix = matrixWithLiveEvidence(original.matrix, paths);
  const { policy } = original;
  const signing = signingFixture();
  for (const id of Object.keys(PROTECTED_EVIDENCE_REQUIREMENTS)) {
    const document = signedEvidence(id, { matrix, policy, signing });
    writeEvidence(root, id, document);
    const checked = loadProtectedEvidenceFile(paths[id], {
      rootDir: root,
      expectedId: id,
      matrix,
      policy,
      trustPolicy: signing.trustPolicy,
      expectedSourceCommit: sourceCommit,
    });
    assert.equal(checked.id, id);
    assert.equal(checked.scope, PROTECTED_EVIDENCE_REQUIREMENTS[id].scope);
    assert.equal(checked.evidenceDigest, document.evidenceDigest);
    assert.deepEqual(checked.environment, matrix.rows[0].environment);
  }
  const loaded = loadProtectedEvidenceSet(paths, {
    rootDir: root,
    matrix,
    policy,
    trustPolicy: signing.trustPolicy,
    expectedSourceCommit: sourceCommit,
  });
  assert.deepEqual(protectedEvidenceSummary(loaded).map((entry) => entry.id), Object.keys(PROTECTED_EVIDENCE_REQUIREMENTS).sort());
});

test("the checked-in trust policy contains only a bounded public Alpha signer", () => {
  const trustPolicy = loadProtectedEvidenceTrustPolicy({ rootDir: repositoryRoot });
  assert.equal(trustPolicy.contractStatus, "runtime-ready");
  assert.equal(trustPolicy.signers.length, 1);
  assert.deepEqual(trustPolicy.signers[0].evidenceIds, [
    "live-agent-cancel",
    "live-agent-terminal",
    "live-batch-terminal",
  ]);
  assert.equal(Object.keys(trustPolicy.signers[0]).some((key) => /private/iu.test(key)), false);
  const { matrix, policy } = contracts();
  const signing = signingFixture(["live-agent-terminal"]);
  const document = structuredClone(signedEvidence("live-agent-terminal", { matrix, policy, signing }));
  document.trustPolicyDigest = trustPolicy.policyDigest;
  document.attestation.signedPayloadDigest = protectedEvidenceSigningDigest(document);
  document.attestation.signature = crypto.sign(
    null,
    Buffer.from(document.attestation.signedPayloadDigest),
    signing.privateKey,
  ).toString("base64");
  document.evidenceDigest = protectedEvidenceDigest(document);
  assert.throws(
    () => validateProtectedEvidenceDocument(document, {
      expectedId: document.id,
      matrix,
      policy,
      trustPolicy,
      expectedSourceCommit: sourceCommit,
    }),
    { code: "TRUST_SIGNER_UNAVAILABLE" },
  );
});

test("schema-shaped descriptors, contract examples, tampering, source replay, and incomplete proofs fail closed", () => {
  const { matrix, policy } = contracts();
  const signing = signingFixture();
  const valid = signedEvidence("live-agent-terminal", { matrix, policy, signing });

  assert.throws(
    () => loadProtectedEvidenceSet({ "live-agent-terminal": {
      id: "live-agent-terminal",
      status: "PASS",
      source: "verification/protected/live-agent-terminal.json",
      evidenceDigest: valid.evidenceDigest,
    } }, { matrix, policy, expectedSourceCommit: sourceCommit }),
    { code: "EVIDENCE_DESCRIPTOR_FORBIDDEN" },
  );

  const tampered = structuredClone(valid);
  tampered.claims.authoritativeTerminals = 2;
  assert.throws(
    () => validateProtectedEvidenceDocument(tampered, { expectedId: valid.id, matrix, policy, expectedSourceCommit: sourceCommit }),
    { code: "EVIDENCE_DIGEST_MISMATCH" },
  );
  tampered.evidenceDigest = protectedEvidenceDigest(tampered);
  assert.throws(
    () => validateProtectedEvidenceDocument(tampered, {
      expectedId: valid.id,
      matrix,
      policy,
      trustPolicy: signing.trustPolicy,
      expectedSourceCommit: sourceCommit,
    }),
    { code: "SIGNED_PAYLOAD_DIGEST_MISMATCH" },
  );

  const forgedSignature = structuredClone(valid);
  forgedSignature.attestation.signature = Buffer.alloc(64).toString("base64");
  forgedSignature.evidenceDigest = protectedEvidenceDigest(forgedSignature);
  assert.throws(
    () => validateProtectedEvidenceDocument(forgedSignature, {
      expectedId: valid.id,
      matrix,
      policy,
      trustPolicy: signing.trustPolicy,
      expectedSourceCommit: sourceCommit,
    }),
    { code: "EVIDENCE_SIGNATURE_INVALID" },
  );

  const replayed = signedEvidence("live-agent-terminal", {
    matrix,
    policy,
    signing,
    overrides: { sourceCommit: "b".repeat(40) },
  });
  assert.throws(
    () => validateProtectedEvidenceDocument(replayed, { expectedId: replayed.id, matrix, policy, trustPolicy: signing.trustPolicy, expectedSourceCommit: sourceCommit }),
    { code: "SOURCE_COMMIT_MISMATCH" },
  );

  const incompleteInput = evidenceInput("live-agent-cancel", { matrix, policy, signing });
  incompleteInput.proofs = incompleteInput.proofs.filter((proof) => proof.kind !== "cancel-request");
  incompleteInput.attestation.signedPayloadDigest = protectedEvidenceSigningDigest(incompleteInput);
  incompleteInput.attestation.signature = crypto.sign(null, Buffer.from(incompleteInput.attestation.signedPayloadDigest), signing.privateKey).toString("base64");
  const incomplete = createProtectedEvidenceDocument(incompleteInput);
  assert.throws(
    () => validateProtectedEvidenceDocument(incomplete, { expectedId: incomplete.id, matrix, policy, trustPolicy: signing.trustPolicy, expectedSourceCommit: sourceCommit }),
    { code: "REQUIRED_PROOF_MISSING" },
  );

  const example = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "contracts/subagents/protected-evidence.example.json"), "utf8"));
  assert.throws(() => validateProtectedEvidenceDocument(example), { code: "CONTRACT_EXAMPLE_FORBIDDEN" });
  assert.equal(validateProtectedEvidenceDocument(example, { allowContractExample: true }).status, "CONTRACT_ONLY");
});

test("protected evidence path traversal, missing files, symlinks, and source reuse are rejected", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-protected-path-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "omp-protected-outside-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const original = contracts();
  const source = "verification/protected/live-agent-terminal.json";
  const matrix = matrixWithLiveEvidence(original.matrix, { "live-agent-terminal": source });
  const { policy } = original;
  const signing = signingFixture();
  const document = signedEvidence("live-agent-terminal", { matrix, policy, signing });
  writeEvidence(root, "live-agent-terminal", document);
  const outsideFile = path.join(outside, "evidence.json");
  fs.writeFileSync(outsideFile, `${JSON.stringify(document)}\n`);
  fs.symlinkSync(outsideFile, path.join(root, "verification", "protected", "escape.json"));

  const options = { rootDir: root, matrix, policy, trustPolicy: signing.trustPolicy, expectedSourceCommit: sourceCommit };
  assert.throws(() => loadProtectedEvidenceFile("../escape.json", options), { code: "UNSAFE_EVIDENCE_PATH" });
  assert.throws(() => loadProtectedEvidenceFile("verification/protected/missing.json", options), { code: "EVIDENCE_FILE_MISSING" });
  assert.throws(() => loadProtectedEvidenceFile("verification/protected/escape.json", options), { code: "UNSAFE_EVIDENCE_PATH" });
  assert.throws(
    () => loadProtectedEvidenceSet({ "live-agent-terminal": source, "live-agent-cancel": source }, options),
    { code: "DUPLICATE_EVIDENCE_SOURCE" },
  );
});

test("Alpha becomes eligible only when all three source-bound files and their same-row live scopes agree", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-protected-alpha-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = contracts();
  const paths = Object.fromEntries([
    "live-agent-cancel",
    "live-agent-terminal",
    "live-batch-terminal",
  ].map((id) => [id, `verification/protected/${id}.json`]));
  const matrix = matrixWithLiveEvidence(original.matrix, paths);
  const signing = signingFixture(Object.keys(paths));
  for (const id of Object.keys(paths)) {
    writeEvidence(root, id, signedEvidence(id, { matrix, policy: original.policy, signing }));
  }
  const preview = original.policy.channels.find((channel) => channel.id === "preview");
  const deterministicGates = Object.fromEntries(preview.requiredDeterministicGates.map((id) => [id, "PASS"]));
  const result = evaluateSubagentsPromotion({
    requested: "alpha",
    matrix,
    policy: original.policy,
    deterministicGates,
    protectedEvidence: paths,
    expectedSourceCommit: sourceCommit,
    trustPolicy: signing.trustPolicy,
    rootDir: root,
  });
  assert.equal(result.eligible, true);
  assert.equal(result.achieved, "alpha");
  assert.deepEqual(result.protectedEvidence.map((entry) => entry.id), Object.keys(paths).sort());

  const missingReference = structuredClone(matrix);
  missingReference.rows[0].evidence = missingReference.rows[0].evidence.filter((entry) => entry !== paths["live-agent-terminal"]);
  missingReference.matrixDigest = compatibilityMatrixDigest(missingReference);
  assert.throws(() => evaluateSubagentsPromotion({
    requested: "alpha",
    matrix: missingReference,
    policy: original.policy,
    deterministicGates,
    protectedEvidence: paths,
    expectedSourceCommit: sourceCommit,
    trustPolicy: signing.trustPolicy,
    rootDir: root,
  }), { code: "MATRIX_EVIDENCE_REFERENCE_MISSING" });
});
