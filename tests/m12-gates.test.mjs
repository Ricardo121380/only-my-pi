import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import { canonicalJson } from "../packages/config-runtime/index.mjs";
import {
  M12_PROTECTED_ASSERTIONS,
  inspectM12Gates,
  parseM12GateArgs,
  runM12Verification,
  validateM12GateManifest,
  validateM12ProtectedEvidence,
} from "../scripts/m12-direct-coding-gates.mjs";

function sha(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function evidence(sourceCommit = "a".repeat(40)) {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-m12-protected-local-evidence",
    status: "PASS",
    sourceCommit,
    productVersion: "0.3.0-preview.1",
    stackId: sha("stack"),
    installedGenerationId: sha("generation"),
    artifactSha256: sha("artifact"),
    usage: { directlyMeteredTokens: 42, variableCostUsd: 0, wallSeconds: 12, toolCalls: 3, meteredTerminals: 1 },
    assertions: Object.entries(M12_PROTECTED_ASSERTIONS).flatMap(([gateId, ids]) => ids.map((id) => ({ gateId, id, status: "PASS", evidenceSha256: sha(`${gateId}:${id}`) }))),
    privacy: { rawPromptsStored: false, rawOutputsStored: false, reasoningStored: false, hostPathsStored: false, secretsStored: false, sessionsStored: false, credentialsRead: false },
  };
  document.evidenceDigest = sha(canonicalJson(document));
  return document;
}

test("M12 gate manifest exposes ten deterministic and two protected gates", () => {
  const inspected = inspectM12Gates([], { rootDir: process.cwd() });
  assert.deepEqual(inspected.deterministicGateIds, ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10"]);
  assert.deepEqual(inspected.protectedGateIds, ["C11", "C12"]);
  const c11 = inspectM12Gates(["--gate", "C11"], { rootDir: process.cwd() });
  assert.equal(c11.gate.defaultStatus, "NOT_RUN_BY_POLICY");
  const manifest = structuredClone(JSON.parse(requireText("verification/m12-direct-coding-gates-v1.json")));
  manifest.gates[0].args.push("--experimental");
  assert.throws(() => validateM12GateManifest(manifest), { code: "M12_GATE_MANIFEST_INVALID" });
});

function requireText(relative) {
  return fs.readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

test("M12 gate CLI binds protected evidence to an explicit source commit", () => {
  const parsed = parseM12GateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "verification/protected/m12.json", "--json"]);
  assert.equal(parsed.run, true);
  assert.equal(parsed.protectedEvidence, "verification/protected/m12.json");
  assert.throws(() => parseM12GateArgs(["--protected-evidence", "verification/protected/m12.json"]), { code: "M12_GATE_ARGUMENT_INVALID" });
  assert.throws(() => parseM12GateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "../m12.json"]), { code: "M12_GATE_ARGUMENT_INVALID" });
});

test("protected evidence requires the exact C11/C12 matrix and bounded privacy", () => {
  const value = evidence();
  assert.equal(validateM12ProtectedEvidence(value, value.sourceCommit).status, "PASS");
  const missing = structuredClone(value);
  missing.assertions.pop();
  delete missing.evidenceDigest;
  missing.evidenceDigest = sha(canonicalJson(missing));
  assert.throws(() => validateM12ProtectedEvidence(missing, missing.sourceCommit), { code: "M12_PROTECTED_EVIDENCE_INVALID" });
  const leaked = structuredClone(value);
  leaked.privacy.credentialsRead = true;
  const unsigned = structuredClone(leaked);
  delete unsigned.evidenceDigest;
  leaked.evidenceDigest = sha(canonicalJson(unsigned));
  assert.throws(() => validateM12ProtectedEvidence(leaked, leaked.sourceCommit), { code: "M12_PROTECTED_EVIDENCE_INVALID" });
});

test("matrix token totals remain metered without an aggregate ceiling", () => {
  for (const tokens of [100_001, 1_000_000, Number.MAX_SAFE_INTEGER]) {
    const value = evidence();
    value.usage.directlyMeteredTokens = tokens;
    delete value.evidenceDigest;
    value.evidenceDigest = sha(canonicalJson(value));
    assert.equal(validateM12ProtectedEvidence(value, value.sourceCommit).usage.directlyMeteredTokens, tokens);
  }
  for (const tokens of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const value = evidence();
    value.usage.directlyMeteredTokens = tokens;
    assert.throws(() => validateM12ProtectedEvidence(value, value.sourceCommit), { code: "M12_PROTECTED_EVIDENCE_INVALID" });
  }
});

test("deterministic M12 run reports protected work as pending instead of fabricating PASS", async () => {
  const result = await runM12Verification({
    rootDir: process.cwd(),
    requireCleanSource: false,
    verifyGit: false,
    runCheckImpl: async (gate) => ({ id: gate.id, status: "PASS", passed: true, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false, durationMs: 1, stdoutBytes: 0, stderrBytes: 0, stdoutSha256: "0".repeat(64), stderrSha256: "0".repeat(64) }),
  });
  assert.equal(result.report.ok, true);
  assert.equal(result.report.complete, false);
  assert.equal(result.report.status, "DETERMINISTIC_PASS_PROTECTED_PENDING");
  assert.equal(result.report.results.find((entry) => entry.id === "C11").status, "NOT_RUN_BY_POLICY");
  assert.equal(result.report.privacy.github, "NOT_USED");
});
