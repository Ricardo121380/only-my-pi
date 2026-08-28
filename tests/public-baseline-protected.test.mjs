import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_BASELINE_ASSERTION_IDS,
  publicBaselineDigest,
  validatePublicBaselineEvidence,
} from "../packages/release-authority/index.mjs";
import { parsePublicBaselineProtectedArgs } from "../scripts/public-baseline-protected-acceptance.mjs";

function evidence() {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-public-baseline-evidence",
    evidenceId: "public-baseline-live-matrix",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-29T00:00:00.000Z",
    artifacts: {
      sanitizedArtifactSha256: `sha256:${"1".repeat(64)}`,
      priorIdentityDigest: `sha256:${"2".repeat(64)}`,
      stableGraphDigest: `sha256:${"3".repeat(64)}`,
      installedGenerationId: `sha256:${"3".repeat(64)}`,
    },
    runtime: { piVersion: "0.84.3", subagentsVersion: "0.57.0", provider: "cc-switch-open-code-go", model: "deepseek-v4-flash" },
    pricing: { mode: "subscription-fixed-fee", inputPerMillion: 0, outputPerMillion: 0, fixedFeeUsd: 10, fixedFeeIncludedInRunCost: false },
    usage: { directlyMeteredTokens: 100, variableCostUsd: 0, wallSeconds: 10, toolCalls: 5, meteredTerminals: 2 },
    assertions: PUBLIC_BASELINE_ASSERTION_IDS.map((id) => ({ id, status: "PASS", digest: `sha256:${"4".repeat(64)}` })),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false },
    authorization: { realRoots: "EXPLICIT_APPLY_ROLLBACK_REAPPLY", providerRequests: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  document.evidenceDigest = publicBaselineDigest(document);
  return document;
}

test("public baseline evidence validates the complete low-sensitivity matrix", () => {
  const document = evidence();
  assert.equal(validatePublicBaselineEvidence(document, { expectedSourceCommit: document.sourceCommit }).assertions.length, 23);
  const sensitive = structuredClone(document);
  sensitive.authorization.apiKey = "forbidden";
  sensitive.evidenceDigest = publicBaselineDigest(sensitive);
  assert.throws(() => validatePublicBaselineEvidence(sensitive), { code: "PUBLIC_BASELINE_SCHEMA_INVALID" });
});

test("protected baseline CLI requires separate Web and mutation authority", () => {
  const output = pathForTest();
  assert.throws(() => parsePublicBaselineProtectedArgs(["--run", "--yes", "--artifact", "/tmp/a.tgz", "--source-commit", "a".repeat(40), "--output", output]), { code: "PUBLIC_BASELINE_PROTECTED_CONFIRMATION_REQUIRED" });
  const parsed = parsePublicBaselineProtectedArgs(["--run", "--yes", "--authorize-web", "--artifact", "/tmp/a.tgz", "--source-commit", "a".repeat(40), "--output", output]);
  assert.equal(parsed.operation, "run");
});

function pathForTest() {
  return new URL("../verification/protected/baseline-test.json", import.meta.url).pathname;
}
