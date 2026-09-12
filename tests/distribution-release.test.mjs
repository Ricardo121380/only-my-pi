import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson, sha256 } from "../packages/config-runtime/index.mjs";
import { NATIVE_RELEASE_ASSERTIONS, validateNativeReleaseEvidence } from "../packages/distribution/release-policy.mjs";

function fixture() {
  const receipt = { version: "0.4.0-preview.1", sourceCommit: "a".repeat(40), distributionId: `sha256:${"b".repeat(64)}` };
  const buildReceiptDigest = `sha256:${"c".repeat(64)}`;
  const evidence = { formatVersion: 1, kind: "only-my-pi-native-protected-evidence", status: "PASS",
    ...receipt, platform: "darwin-arm64", buildReceiptSha256: buildReceiptDigest,
    assertions: NATIVE_RELEASE_ASSERTIONS.map((id) => ({ id, status: "PASS", evidenceSha256: `sha256:${"d".repeat(64)}` })) };
  const seal = () => { delete evidence.evidenceDigest; evidence.evidenceDigest = sha256(canonicalJson(evidence)); };
  seal();
  return { receipt, buildReceiptDigest, evidence, seal };
}

test("native release requires new complete evidence for the exact candidate bytes", () => {
  const f = fixture();
  assert.equal(validateNativeReleaseEvidence(f.evidence, f.receipt, f.buildReceiptDigest), f.evidence);
  for (const changes of [{ sourceCommit: "e".repeat(40) }, { version: "0.3.0-preview.1" }, { distributionId: `sha256:${"e".repeat(64)}` }])
    assert.throws(() => validateNativeReleaseEvidence(f.evidence, { ...f.receipt, ...changes }, f.buildReceiptDigest), /identity differs/u);
  assert.throws(() => validateNativeReleaseEvidence(f.evidence, f.receipt, `sha256:${"e".repeat(64)}`), /identity differs/u);
});

test("self-rehashed incomplete or failed product assertions never authorize publication", () => {
  const f = fixture();
  f.evidence.assertions[0].status = "NOT_RUN";
  f.seal();
  assert.throws(() => validateNativeReleaseEvidence(f.evidence, f.receipt, f.buildReceiptDigest), /missing protected assertion/u);
  f.evidence.assertions.pop();
  f.seal();
  assert.throws(() => validateNativeReleaseEvidence(f.evidence, f.receipt, f.buildReceiptDigest), /incomplete/u);
});

test("historical evidence and phase-two platforms are not phase-one release authority", () => {
  const f = fixture();
  f.evidence.kind = "only-my-pi-m12-protected-local-evidence";
  f.seal();
  assert.throws(() => validateNativeReleaseEvidence(f.evidence, f.receipt, f.buildReceiptDigest), /new native protected evidence/u);
  f.evidence.kind = "only-my-pi-native-protected-evidence";
  f.evidence.platform = "linux-arm64";
  f.seal();
  assert.throws(() => validateNativeReleaseEvidence(f.evidence, f.receipt, f.buildReceiptDigest), /phase one/u);
});
