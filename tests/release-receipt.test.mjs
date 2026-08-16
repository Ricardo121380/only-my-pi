import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadReleaseGatesManifest, releaseGatesDigest } from "../scripts/lib/release-gates.mjs";
import { parseReceiptCheckArgs } from "../scripts/release-receipt-check.mjs";
import { validateReleaseReceipt } from "../scripts/verification-receipt.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = loadReleaseGatesManifest(path.join(root, "verification", "release-gates-v1.json"));
const sourceCommit = "a".repeat(40);

function evidence() {
  return {
    formatVersion: 1,
    status: "PASS",
    sourceCommit,
    nodeVersion: "v25.8.0",
    piVersion: "0.84.1",
    platform: "darwin",
    arch: "arm64",
    tarball: {
      name: "only-my-pi",
      version: "0.1.0",
      sha256: "b".repeat(64),
      integrity: "sha512-" + Buffer.from("fixture").toString("base64"),
      files: 164,
    },
    install: { scripts: "disabled", offline: true, global: false, checkoutRuntime: false },
    bootstrap: {
      dryRun: "PLAN_READY_ZERO_WRITE",
      firstApply: "COMMITTED",
      secondApply: "NO_CHANGES",
      doctor: "PASS",
      safe: "PASS",
      rollback: "COMMITTED",
      finalStatus: "NOT_INSTALLED",
      piNoModelStartup: "NO_MODEL_STARTUP_PASS",
    },
    provider: "NOT_RUN_BY_POLICY",
    credentials: "NOT_READ",
    realPiHome: "NOT_TOUCHED",
  };
}

function receipt(overrides = {}) {
  const ids = manifest.gates.map((gate) => gate.id);
  const gates = ids.map((id) => ({
    id,
    status: "PASS",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    expectationPassed: true,
    durationMs: 1,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: `sha256:${"c".repeat(64)}`,
    stderrSha256: `sha256:${"d".repeat(64)}`,
    ...(id === "test-e2e" ? { evidence: evidence() } : {}),
  }));
  return {
    schemaVersion: 2,
    kind: "only-my-pi-release-receipt",
    status: "COMPLETE",
    sourceCommit,
    manifest: { id: manifest.id, digest: releaseGatesDigest(manifest), gateIds: ids },
    startedAt: "2026-08-16T00:00:00.000Z",
    completedAt: "2026-08-16T00:00:01.000Z",
    passed: true,
    gates,
    evidence: { freshTarball: evidence(), compatibility: { node: "v25.8.0", pi: "0.84.1", platform: "darwin", arch: "arm64" } },
    privacy: { rawOutputStored: false, hostPathsStored: false, credentialsRead: false, outputFingerprintsMayLeakShortPredictableValues: true, intendedForSensitiveOutput: false },
    authorization: { providerRequests: "NOT_RUN_BY_POLICY", liveChildDispatch: "NOT_RUN_BY_POLICY", realPiHome: "NOT_TOUCHED", publish: "NOT_AUTHORIZED", tag: "NOT_AUTHORIZED", release: "NOT_AUTHORIZED", pullRequest: "NOT_AUTHORIZED" },
    ...overrides,
  };
}

test("release receipt validates exact gate order, digest, e2e evidence, and privacy boundary", () => {
  const result = validateReleaseReceipt(receipt(), manifest, { expectedSourceCommit: sourceCommit });
  assert.equal(result.ok, true);
  assert.equal(result.status, "COMPLETE");
});

test("release receipt rejects missing gates, raw output, host paths, and source drift", () => {
  const missing = receipt({ gates: receipt().gates.slice(0, -1) });
  assert.throws(() => validateReleaseReceipt(missing, manifest, { expectedSourceCommit: sourceCommit }), /gate results are incomplete/);
  const raw = receipt();
  raw.gates[0].stdout = "raw";
  assert.throws(() => validateReleaseReceipt(raw, manifest, { expectedSourceCommit: sourceCommit }), /unknown fields/);
  const hostPath = receipt();
  hostPath.evidence.compatibility.home = "/Users/example/secret";
  assert.throws(() => validateReleaseReceipt(hostPath, manifest, { expectedSourceCommit: sourceCommit }), /forbidden field|host home path/);
  assert.throws(() => validateReleaseReceipt(receipt(), manifest, { expectedSourceCommit: "b".repeat(40) }), /sourceCommit mismatch/);
});

test("receipt checker parser is bounded to the receipts directory", () => {
  const parsed = parseReceiptCheckArgs(["--receipt", "verification/receipts/final.json", "--expect-parent"]);
  assert.equal(parsed.expectParent, true);
  assert.throws(() => parseReceiptCheckArgs(["--receipt", "../outside.json"]), /inside verification\/receipts/);
  assert.throws(() => parseReceiptCheckArgs(["--expect-parent", "--source-commit", sourceCommit]), /mutually exclusive/);
});
