import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { M11_PROTECTED_ASSERTION_IDS, inspectM11Gates, parseM11GateArgs, runM11ReleaseVerification, validateM11GateManifest } from "../scripts/m11-release-gates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeResult(gate) {
  return { id: gate.id, status: "PASS", passed: true, exitCode: 0, signal: null, timedOut: false, outputLimitExceeded: false, durationMs: 1, stdoutBytes: 0, stderrBytes: 0, stdoutSha256: "0".repeat(64), stderrSha256: "0".repeat(64) };
}

test("M11 manifest fixes ten deterministic gates, one explicit platform gate and one protected gate", () => {
  const inspected = inspectM11Gates(["--json"], { rootDir: ROOT });
  assert.equal(inspected.deterministicGateIds.length, 10);
  assert.deepEqual(inspected.platformGateIds, ["Q10"]);
  assert.deepEqual(inspected.protectedGateIds, ["Q11"]);
  assert.equal(M11_PROTECTED_ASSERTION_IDS.length, 20);
  assert.equal(inspectM11Gates(["--gate", "Q11"], { rootDir: ROOT }).gate.command, null);
  assert.throws(() => validateM11GateManifest({}), { code: "M11_GATE_MANIFEST_INVALID" });
});

test("M11 arguments keep platform execution explicit and Q11 evidence source-bound", () => {
  assert.throws(() => parseM11GateArgs(["--include-platform"]), { code: "M11_GATE_ARGUMENT_INVALID" });
  assert.throws(() => parseM11GateArgs(["--run", "--protected-evidence", "Q11=verification/protected/q11.json"]), { code: "M11_GATE_ARGUMENT_INVALID" });
  const parsed = parseM11GateArgs(["--run", "--include-platform", "--source-commit", "a".repeat(40), "--protected-evidence", "Q11=verification/protected/q11.json"]);
  assert.equal(parsed.includePlatform, true);
  assert.equal(parsed.evidence, "verification/protected/q11.json");
});

test("ordinary M11 verification executes only deterministic gates", async () => {
  const executed = [];
  const { report } = await runM11ReleaseVerification({ rootDir: ROOT, requireCleanSource: false, verifyGit: false, runCheckImpl: async (gate) => { executed.push(gate.id); return fakeResult(gate); } });
  assert.deepEqual(executed, ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q12"]);
  assert.equal(report.status, "HOLD_PLATFORM_AND_PROTECTED");
  assert.equal(report.deterministicPassed, true);
  assert.equal(report.summary.platformNotRun, 1);
  assert.equal(report.summary.protectedNotRunByPolicy, 1);
  assert.equal(report.authorization.release, "NOT_AUTHORIZED");
});

test("explicit platform mode adds Q10 without executing Q11", async () => {
  const executed = [];
  const { report } = await runM11ReleaseVerification({ rootDir: ROOT, includePlatform: true, requireCleanSource: false, verifyGit: false, runCheckImpl: async (gate) => { executed.push(gate.id); return fakeResult(gate); } });
  assert.deepEqual(executed, ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q12"]);
  assert.equal(report.status, "HOLD_PROTECTED_EVIDENCE");
  assert.equal(report.summary.platformPassed, 1);
  assert.equal(report.summary.protectedNotRunByPolicy, 1);
});
