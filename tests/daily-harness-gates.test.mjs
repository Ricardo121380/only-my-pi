import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  DAILY_HARNESS_DETERMINISTIC_IDS,
  DAILY_HARNESS_GATE_IDS,
  dailyHarnessGatesDigest,
  loadDailyHarnessGatesManifest,
  protectedEvidenceDigest,
  resolveDailyHarnessGate,
  validateDailyHarnessGatesManifest,
  validateDailyHarnessProtectedEvidence,
} from "../scripts/lib/daily-harness-gates.mjs";
import {
  inspectDailyHarnessGates,
  parseDailyHarnessGateArgs,
  runDailyHarnessVerification,
} from "../scripts/daily-harness-gates.mjs";
import { M8_DETERMINISTIC_CHECKS, runM8AcceptanceCheck } from "../scripts/m8-deterministic-acceptance.mjs";

function successfulSpawn() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => child.emit("close", 0, null));
  return child;
}

test("M8 manifest fixes D1-D15 and leaves D13/D14 evidence-only", () => {
  const manifest = loadDailyHarnessGatesManifest();
  assert.deepEqual(manifest.gates.map((gate) => gate.id), [...DAILY_HARNESS_GATE_IDS]);
  assert.match(dailyHarnessGatesDigest(manifest), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(DAILY_HARNESS_DETERMINISTIC_IDS.length, 13);
  for (const id of ["D13", "D14"]) {
    const gate = resolveDailyHarnessGate(manifest, id);
    assert.equal(gate.command, null);
    assert.deepEqual(gate.args, []);
    assert.equal(gate.execution, "protected-evidence");
    assert.equal(gate.defaultStatus, "NOT_RUN_BY_POLICY");
  }
});

test("M8 manifest rejects executable protected gates and deterministic argv drift", () => {
  const executable = structuredClone(loadDailyHarnessGatesManifest());
  executable.gates[12].command = "node";
  executable.gates[12].args = ["unsafe.mjs"];
  assert.throws(() => validateDailyHarnessGatesManifest(executable), /evidence-only/u);
  const drift = structuredClone(loadDailyHarnessGatesManifest());
  drift.gates[0].args.push("tests/unsafe.test.mjs");
  assert.throws(() => validateDailyHarnessGatesManifest(drift), /contract drifted/u);
});

test("M8 runner defaults to inspection and protected completion requires exact evidence", () => {
  const inspection = inspectDailyHarnessGates(["--json"]);
  assert.equal(inspection.executable, false);
  assert.deepEqual(inspection.protectedGateIds, ["D13", "D14"]);
  assert.equal(parseDailyHarnessGateArgs(["--run", "--json"]).run, true);
  assert.throws(() => parseDailyHarnessGateArgs(["--protected-evidence", "D13=verification/protected/d13.json"]), /requires --run/u);
  assert.throws(() => parseDailyHarnessGateArgs(["--run", "--source-commit", "a".repeat(40), "--protected-evidence", "D13=verification/protected/d13.json"]), /exact D13 and D14/u);
  assert.throws(() => parseDailyHarnessGateArgs(["--manifest", "package.json"]), /unknown argument/u);
});

test("protected evidence is source-bound, digest-bound, privacy-safe, and gate-specific", () => {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-daily-harness-protected-evidence",
    gateId: "D13",
    evidenceId: "m8-live-model-matrix",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-27T00:00:00.000Z",
    assertions: [{ id: "agent-terminal", status: "PASS", digest: `sha256:${"1".repeat(64)}` }],
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: "AUTHORIZED", realPiHome: "NOT_TOUCHED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  document.evidenceDigest = protectedEvidenceDigest(document);
  assert.equal(validateDailyHarnessProtectedEvidence(document, { gateId: "D13", expectedSourceCommit: "a".repeat(40) }).status, "PASS");
  const drift = structuredClone(document);
  drift.assertions[0].status = "FAIL";
  assert.throws(() => validateDailyHarnessProtectedEvidence(drift, { gateId: "D13" }), /assertion is invalid/u);
});

test("deterministic M8 execution never spawns protected gates", async () => {
  const calls = [];
  const result = await runDailyHarnessVerification({
    rootDir: process.cwd(),
    requireCleanSource: false,
    sourceCommit: "UNCOMMITTED_TEST_ONLY",
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return successfulSpawn();
    },
  });
  assert.equal(calls.length, 13);
  assert.equal(calls.every((call) => call.options.shell === false), true);
  assert.equal(result.report.status, "BLOCKED_PROTECTED_EVIDENCE");
  assert.equal(result.report.deterministicPassed, true);
  assert.equal(result.report.summary.protectedNotRunByPolicy, 2);
});

test("D15 enforces global and per-runtime coverage through fixed shell-free argv", async () => {
  const composer = M8_DETERMINISTIC_CHECKS.find((check) => check.id === "session-composer-coverage");
  const control = M8_DETERMINISTIC_CHECKS.find((check) => check.id === "omp-control-coverage");
  assert.ok(composer.args.includes("--test-coverage-lines=90"));
  assert.ok(composer.args.includes("--test-coverage-branches=80"));
  assert.ok(composer.args.includes("--test-coverage-functions=90"));
  assert.ok(control.args.includes("--test-coverage-lines=85"));
  assert.ok(control.args.includes("--test-coverage-branches=70"));
  assert.ok(control.args.includes("--test-coverage-functions=85"));
  let invocation;
  const result = await runM8AcceptanceCheck(composer, {
    spawnImpl(command, args, options) {
      invocation = { command, args, options };
      return successfulSpawn();
    },
    env: { PATH: "/usr/bin", API_KEY: "must-not-pass" },
  });
  assert.equal(result.status, "PASS");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.API_KEY, undefined);
  assert.deepEqual(invocation.args, composer.args);
});
