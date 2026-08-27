import assert from "node:assert/strict";
import test from "node:test";

import { parseM8RealRootArgs } from "../scripts/m8-real-root-rehearsal.mjs";
import { protectedEvidenceDigest, validateDailyHarnessProtectedEvidence } from "../scripts/lib/daily-harness-gates.mjs";

const D14_ASSERTIONS = ["artifact-applied", "external-packages-preserved", "final-installed", "no-model-smoke", "reapplied", "rollback-restored"];

test("real-root rehearsal is plan-first and requires exact baseline/output authority", () => {
  assert.equal(parseM8RealRootArgs(["--plan"]).operation, "plan");
  assert.throws(() => parseM8RealRootArgs(["--run"]), /requires --yes/u);
  const run = parseM8RealRootArgs([
    "--run", "--yes",
    "--artifact", "/tmp/only-my-pi.tgz",
    "--baseline-raw-sha256", "a".repeat(64),
    "--baseline-semantic-sha256", "b".repeat(64),
    "--baseline-snapshot-id", "before-first-install",
    "--output", "/tmp/evidence.json",
  ]);
  assert.equal(run.operation, "run");
  assert.equal(run.artifact, "/tmp/only-my-pi.tgz");
  assert.equal(run.baselineSnapshotId, "before-first-install");
  assert.throws(() => parseM8RealRootArgs([
    "--run", "--yes",
    "--artifact", "/tmp/only-my-pi.tgz",
    "--baseline-raw-sha256", "a".repeat(64),
    "--baseline-semantic-sha256", "b".repeat(64),
    "--output", "/tmp/evidence.json",
  ]), /baseline snapshot id/u);
});

test("D14 evidence binds the complete no-model apply rollback preservation reapply set", () => {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-daily-harness-protected-evidence",
    gateId: "D14",
    evidenceId: "m8-real-root-rehearsal",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-27T00:00:00.000Z",
    assertions: D14_ASSERTIONS.map((id, index) => ({ id, status: "PASS", digest: `sha256:${String(index + 1).repeat(64)}` })),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: "NOT_RUN_BY_POLICY", realPiHome: "AUTHORIZED", credentials: "NOT_READ", writer: "NOT_RUN_BY_POLICY" },
  };
  document.evidenceDigest = protectedEvidenceDigest(document);
  assert.equal(validateDailyHarnessProtectedEvidence(document, { gateId: "D14", expectedSourceCommit: "a".repeat(40) }).status, "PASS");
  const extra = structuredClone(document);
  extra.assertions.push({ id: "unexpected", status: "PASS", digest: `sha256:${"9".repeat(64)}` });
  extra.evidenceDigest = protectedEvidenceDigest(extra);
  assert.throws(() => validateDailyHarnessProtectedEvidence(extra, { gateId: "D14" }), /assertion set/u);
});
