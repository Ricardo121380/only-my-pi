import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  gatesForPromotion,
  loadReleaseGatesV2Manifest,
  releaseGatesV2Digest,
  REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS,
  resolveReleaseGateV2,
  resolveReleaseGatesV2,
  validateReleaseGatesV2Manifest,
} from "../scripts/lib/release-gates-v2.mjs";
import {
  inspectSubagentsReleaseGates,
  parseSubagentsReleaseGateArgs,
  runSubagentsReleaseVerification,
  validateSubagentsReleaseReport,
} from "../scripts/subagents-release-gates.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function manifest() {
  return structuredClone(loadReleaseGatesV2Manifest());
}

test("release-gates-v2 digest-pins all v1 gates and adds the exact S5 extension set", () => {
  const checked = manifest();
  const resolved = resolveReleaseGatesV2(checked);
  assert.equal(checked.base.path, "verification/release-gates-v1.json");
  assert.match(checked.base.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(releaseGatesV2Digest(checked), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(resolved.length, 30);
  assert.deepEqual(checked.gates.map((gate) => gate.id), [...REQUIRED_RELEASE_GATES_V2_EXTENSION_IDS]);
  assert.equal(new Set(resolved.map((gate) => gate.id)).size, resolved.length);
});

test("Preview is deterministic while higher promotions expose exact protected evidence gates", () => {
  const checked = manifest();
  const preview = gatesForPromotion(checked, "preview");
  assert.equal(preview.some((gate) => gate.execution === "protected-evidence"), false);
  assert.ok(preview.some((gate) => gate.id === "subagent-security-redteam"));
  assert.ok(preview.some((gate) => gate.id === "license-provenance-check"));

  const alpha = gatesForPromotion(checked, "alpha");
  assert.deepEqual(alpha.filter((gate) => gate.execution === "protected-evidence").map((gate) => gate.id), [
    "pi-subagents-live-readonly-smoke",
  ]);
  const beta = gatesForPromotion(checked, "beta");
  assert.deepEqual(beta.filter((gate) => gate.execution === "protected-evidence").map((gate) => gate.id), [
    "worktree-writer-e2e",
    "pi-subagents-live-readonly-smoke",
    "pi-subagents-live-writer-smoke",
  ]);
});

test("protected gates have no executable command and cannot be mistaken for deterministic PASS", () => {
  const checked = manifest();
  for (const id of ["worktree-writer-e2e", "pi-subagents-live-readonly-smoke", "pi-subagents-live-writer-smoke"]) {
    const gate = resolveReleaseGateV2(checked, id);
    assert.equal(gate.execution, "protected-evidence");
    assert.equal(gate.command, null);
    assert.deepEqual(gate.args, []);
    assert.equal(gate.defaultStatus, "NOT_RUN_BY_POLICY");
  }
});

test("v2 gate validation rejects base drift, command drift, executable protected gates, and promotion widening", () => {
  const baseDrift = manifest();
  baseDrift.base.digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateReleaseGatesV2Manifest(baseDrift), /base release-gates-v1 digest drift/);

  const commandDrift = manifest();
  commandDrift.gates[0].args.push("--unsafe");
  assert.throws(() => validateReleaseGatesV2Manifest(commandDrift), /command\/argv differs/);

  const executableProtected = manifest();
  const protectedGate = executableProtected.gates.find((gate) => gate.id === "pi-subagents-live-readonly-smoke");
  protectedGate.command = "node";
  protectedGate.args = ["unsafe.mjs"];
  assert.throws(() => validateReleaseGatesV2Manifest(executableProtected), /evidence-only/);

  const promotionWidening = manifest();
  promotionWidening.gates.find((gate) => gate.id === "resource-leak-check").channels = ["preview", "stable"];
  assert.throws(() => validateReleaseGatesV2Manifest(promotionWidening), /promotion channels differ/);
});

test("v2 runner has an explicit execution flag but no arbitrary manifest override", () => {
  assert.deepEqual(parseSubagentsReleaseGateArgs(["--run", "--promotion", "preview"]), {
    promotion: "preview",
    gate: null,
    json: false,
    help: false,
    run: true,
    output: null,
  });
  assert.throws(() => parseSubagentsReleaseGateArgs(["--manifest", "package.json"]), /unknown argument/);
  assert.throws(() => parseSubagentsReleaseGateArgs(["--promotion", "stable", "--promotion", "preview"]), /duplicate/);
  const report = inspectSubagentsReleaseGates(["--promotion", "alpha", "--json"]);
  assert.equal(report.executable, false);
  assert.equal(report.protectedDefault, "NOT_RUN_BY_POLICY");
  assert.deepEqual(report.protectedGateIds, ["pi-subagents-live-readonly-smoke"]);
});

function fakeSpawnRecorder(sourceCommit) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 12345;
    if (args.join(" ") === "run test:e2e") {
      const evidence = {
        formatVersion: 1,
        status: "PASS",
        sourceCommit,
        nodeVersion: process.version,
        piVersion: "0.84.1",
        tarball: { sha256: "a".repeat(64), integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
        install: { scripts: "disabled", offline: true, global: false, checkoutRuntime: false, dependencySeed: "repository-lockfile-local-tarball" },
        bootstrap: { dryRun: "PLAN_READY_ZERO_WRITE", firstApply: "COMMITTED", secondApply: "NO_CHANGES", doctor: "PASS", safe: "PASS", rollback: "COMMITTED", finalStatus: "NOT_INSTALLED", piNoModelStartup: "NO_MODEL_STARTUP_PASS" },
        provider: "NOT_RUN_BY_POLICY",
        credentials: "NOT_READ",
        realPiHome: "NOT_TOUCHED",
      };
      queueMicrotask(() => child.stdout.emit("data", `OMP_FRESH_TARBALL_EVIDENCE=${JSON.stringify(evidence)}\n`));
    }
    queueMicrotask(() => child.emit("close", 0, null));
    return child;
  };
  return { calls, spawnImpl };
}

test("v2 runner executes deterministic gates only and reports preview complete", async () => {
  const sourceCommit = "a".repeat(40);
  const fake = fakeSpawnRecorder(sourceCommit);
  const result = await runSubagentsReleaseVerification({
    promotion: "preview",
    rootDir: root,
    requireCleanSource: false,
    sourceCommit,
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.report.status, "COMPLETE");
  assert.equal(result.report.passed, true);
  assert.equal(result.report.summary.protected, 0);
  assert.equal(fake.calls.length, result.report.summary.deterministic);
  assert.ok(fake.calls.every((call) => call.options.shell === false));
  assert.equal(validateSubagentsReleaseReport(result.report, { rootDir: root, expectedSourceCommit: sourceCommit }).ok, true);
  const tampered = structuredClone(result.report);
  tampered.gates[0].status = "FAIL";
  assert.throws(() => validateSubagentsReleaseReport(tampered, { rootDir: root }), /gate .*failed status|summary mismatch|aggregate status|promotion evaluation drift/);
});

test("v2 runner never spawns protected gates and blocks higher promotion without evidence", async () => {
  const sourceCommit = "b".repeat(40);
  const fake = fakeSpawnRecorder(sourceCommit);
  const result = await runSubagentsReleaseVerification({
    promotion: "alpha",
    rootDir: root,
    requireCleanSource: false,
    sourceCommit,
    spawnImpl: fake.spawnImpl,
  });
  assert.equal(result.report.status, "BLOCKED_PROTECTED_EVIDENCE");
  assert.equal(result.report.passed, false);
  assert.ok(result.report.gates.some((gate) => gate.id === "pi-subagents-live-readonly-smoke" && gate.status === "NOT_RUN_BY_POLICY"));
  assert.ok(fake.calls.every((call) => !call.args.includes("pi-subagents-live-readonly-smoke")));
});
