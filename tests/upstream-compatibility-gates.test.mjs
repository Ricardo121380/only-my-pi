import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  loadUpstreamCompatibilityGatesManifest,
  resolveUpstreamCompatibilityGate,
  UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS,
  UPSTREAM_COMPATIBILITY_GATE_IDS,
  upstreamCompatibilityGatesDigest,
  validateUpstreamCompatibilityGatesManifest,
} from "../scripts/lib/upstream-compatibility-gates.mjs";
import {
  inspectUpstreamCompatibilityGates,
  parseUpstreamCompatibilityGateArgs,
  runUpstreamCompatibilityVerification,
} from "../scripts/upstream-compatibility-gates.mjs";

function successfulSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => child.emit("close", 0, null));
  return child;
}

test("M9 manifest fixes U1-U9 and keeps U9 protected evidence-only", () => {
  const manifest = loadUpstreamCompatibilityGatesManifest();
  assert.deepEqual(manifest.gates.map((gate) => gate.id), [...UPSTREAM_COMPATIBILITY_GATE_IDS]);
  assert.equal(UPSTREAM_COMPATIBILITY_DETERMINISTIC_IDS.length, 8);
  assert.match(upstreamCompatibilityGatesDigest(manifest), /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(manifest.baseline, { piVersion: "0.84.1", subagentsVersion: "0.45.2" });
  assert.deepEqual(manifest.candidate, { piVersion: "0.84.3", subagentsVersion: "0.57.0" });
  const protectedGate = resolveUpstreamCompatibilityGate(manifest, "U9");
  assert.equal(protectedGate.command, null);
  assert.deepEqual(protectedGate.args, []);
  assert.equal(protectedGate.defaultStatus, "NOT_RUN_BY_POLICY");
});

test("M9 manifest rejects executable protected gates, candidate drift, and deterministic argv drift", () => {
  const executable = structuredClone(loadUpstreamCompatibilityGatesManifest());
  executable.gates[8].command = "node";
  executable.gates[8].args = ["unsafe.mjs"];
  assert.throws(() => validateUpstreamCompatibilityGatesManifest(executable), /evidence-only/u);

  const candidateDrift = structuredClone(loadUpstreamCompatibilityGatesManifest());
  candidateDrift.candidate.subagentsVersion = "0.57.1";
  assert.throws(() => validateUpstreamCompatibilityGatesManifest(candidateDrift), /identity drifted/u);

  const argvDrift = structuredClone(loadUpstreamCompatibilityGatesManifest());
  argvDrift.gates[0].args.push("tests/unsafe.test.mjs");
  assert.throws(() => validateUpstreamCompatibilityGatesManifest(argvDrift), /contract drifted/u);
});

test("M9 runner defaults to inspection and never exposes a protected execution flag", () => {
  const inspection = inspectUpstreamCompatibilityGates(["--json"]);
  assert.equal(inspection.executable, false);
  assert.deepEqual(inspection.protectedGateIds, ["U9"]);
  assert.equal(inspection.decision.state, "HOLD");
  assert.equal(parseUpstreamCompatibilityGateArgs(["--run", "--json"]).run, true);
  assert.throws(() => parseUpstreamCompatibilityGateArgs(["--protected-evidence", "U9=file.json"]), /unknown argument/u);
  assert.throws(() => parseUpstreamCompatibilityGateArgs(["--run", "--gate", "U1"]), /cannot be combined/u);
});

test("deterministic M9 execution uses shell false and cannot spawn U9", async () => {
  const calls = [];
  const result = await runUpstreamCompatibilityVerification({
    rootDir: process.cwd(),
    requireCleanSource: false,
    sourceCommit: "UNCOMMITTED_TEST_ONLY",
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return successfulSpawn();
    },
  });
  assert.equal(calls.length, 8);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(calls.some((call) => call.args.includes("m9-candidate-live-readonly-matrix")), false);
  assert.equal(result.report.status, "HOLD_PROTECTED_EVIDENCE");
  assert.equal(result.report.deterministicPassed, true);
  assert.equal(result.report.passed, false);
  assert.equal(result.report.summary.protectedNotRunByPolicy, 1);
  assert.equal(result.report.authorization.providerRequests, "NOT_RUN_BY_POLICY");
});
