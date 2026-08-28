import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  inspectM10Gates,
  parseM10GateArgs,
  runM10PromotionVerification,
  validateM10GateManifest,
} from "../scripts/m10-promotion-gates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fakeResult(gate) {
  return {
    id: gate.id,
    status: "PASS",
    passed: true,
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    durationMs: 1,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: "0".repeat(64),
    stderrSha256: "0".repeat(64),
  };
}

test("M10 gate manifest fixes ten deterministic gates and two protected gates", async () => {
  const inspected = inspectM10Gates(["--json"], { rootDir: ROOT });
  assert.equal(inspected.deterministicGateIds.length, 10);
  assert.deepEqual(inspected.protectedGateIds, ["P9", "P10"]);
  assert.equal(inspectM10Gates(["--gate", "P9"], { rootDir: ROOT }).gate.command, null);
  assert.throws(() => validateM10GateManifest({}), { code: "M10_GATE_MANIFEST_INVALID" });
});

test("M10 gate arguments require both protected evidence files and an exact source", () => {
  assert.throws(() => parseM10GateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "P9=verification/protected/p9.json"]), { code: "M10_GATE_ARGUMENT_INVALID" });
  const parsed = parseM10GateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "P9=verification/protected/p9.json", "--protected-evidence", "P10=verification/protected/p10.json"]);
  assert.equal(parsed.evidence.size, 2);
  assert.throws(() => parseM10GateArgs(["--run", "--gate", "P1"]), { code: "M10_GATE_ARGUMENT_INVALID" });
});

test("ordinary M10 verification never executes protected gates", async () => {
  const executed = [];
  const { report } = await runM10PromotionVerification({
    rootDir: ROOT,
    requireCleanSource: false,
    verifyGit: false,
    runCheckImpl: async (gate) => { executed.push(gate.id); assert.equal(gate.sensitiveOutput, false); return fakeResult(gate); },
  });
  assert.deepEqual(executed, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P11", "P12"]);
  assert.equal(report.status, "HOLD_PROTECTED_EVIDENCE");
  assert.equal(report.deterministicPassed, true);
  assert.equal(report.summary.protectedNotRunByPolicy, 2);
  assert.equal(report.authorization.providerRequests, "NOT_RUN_BY_POLICY");
});
