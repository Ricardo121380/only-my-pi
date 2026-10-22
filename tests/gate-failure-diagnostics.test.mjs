import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runDailyHarnessVerification } from "../scripts/daily-harness-gates.mjs";
import { runUpstreamCompatibilityVerification } from "../scripts/upstream-compatibility-gates.mjs";
import { runM11ReleaseVerification } from "../scripts/m11-release-gates.mjs";
import { runM12Verification } from "../scripts/m12-direct-coding-gates.mjs";
import * as receipt from "../scripts/verification-receipt.mjs";

const CASES = [
  { id: "D15", run: runDailyHarnessVerification, selected: (args) => args.includes("scripts/m8-deterministic-acceptance.mjs") },
  { id: "U8", run: runUpstreamCompatibilityVerification, selected: (args) => args.length === 1 && args[0] === "test" },
  { id: "Q1", run: runM11ReleaseVerification, selected: (args) => args.includes("tests/public-baseline.test.mjs") },
  { id: "C10", run: runM12Verification, selected: (args) => args.includes("scripts/m12-deterministic-acceptance.mjs") },
];

for (const entry of CASES) test(`${entry.id} preserves bounded actual child failure diagnostics outside its report`, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gate-diagnostic-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "tests"));
  const fixture = path.join(root, "tests/failure.test.mjs");
  await fs.writeFile(fixture, `
import assert from "node:assert/strict";
import test from "node:test";
process.stderr.write("PRIVATE_DIAGNOSTIC_PAYLOAD /private/fixture/output\\n");
test("controlled gate regression /private/fixture/test", () => assert.equal(1, 2));
`);
  const observed = [];
  let failures = 0;
  const spawnImpl = (_command, args, options) => {
    const failed = entry.selected(args);
    if (failed) failures += 1;
    return spawn(process.execPath, failed ? ["--test", "--test-reporter=tap", fixture] : ["-e", "process.exit(0)"], options);
  };
  const { report } = await entry.run({
    requireCleanSource: false,
    spawnImpl,
    runCheckImpl: (gate, options) => receipt.runCheck(gate, { ...options, spawnImpl }),
    onGate: (gate, diagnostic) => observed.push({ gate, diagnostic }),
  });
  assert.equal(failures, 1);
  assert.equal(report.deterministicPassed, false);
  const failed = observed.find(({ gate }) => gate.id === entry.id);
  assert.equal(failed.gate.status, "FAIL");
  assert.equal(failed.gate.exitCode, 1);
  assert.equal(failed.gate.timedOut, false);
  assert.equal(failed.gate.outputLimitExceeded, false);
  assert.match(failed.diagnostic, /TEST_FAILURE:tests=controlled gate regression <path>/u);
  assert.match(failed.diagnostic, /codes=ERR_ASSERTION/u);
  assert.match(failed.diagnostic, /frames=tests\/failure\.test\.mjs:5:\d+/u);
  assert.match(failed.diagnostic, /operators=strictEqual/u);
  const progress = receipt.formatGateProgress(failed.gate, failed.diagnostic);
  assert.match(progress, new RegExp(`failure ${entry.id}: exitCode=1 signal=null timedOut=false outputLimitExceeded=false`, "u"));
  assert.ok(progress.includes(failed.diagnostic));
  assert.doesNotMatch(progress, /PRIVATE_DIAGNOSTIC_PAYLOAD|\/private\/fixture/u);
  assert.ok(!progress.includes(root));
  assert.doesNotMatch(JSON.stringify(report), /diagnostic|PRIVATE_DIAGNOSTIC_PAYLOAD|controlled gate regression|\/private\/fixture/u);
  assert.ok(observed.filter(({ gate }) => gate.id !== entry.id).every(({ diagnostic }) => diagnostic === undefined));
});

test("D15 identifies an actual coverage threshold failure without copying child output", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gate-coverage-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const module = path.join(root, "subject.mjs");
  const fixture = path.join(root, "check.mjs");
  await fs.writeFile(module, "export function covered() { return 1; }\nexport function uncovered() { return 2; }\n");
  await fs.writeFile(fixture, 'import test from "node:test";\nimport { covered } from "./subject.mjs";\ntest("passing assertion", () => covered());\n');
  const result = await receipt.runCheck({
    id: "D15", command: process.execPath,
    args: ["--test", "--test-reporter=tap", "--experimental-test-coverage", `--test-coverage-include=${module}`, "--test-coverage-functions=100", fixture],
    timeoutMs: 10000, env: {},
  });
  assert.equal(result.status, "FAIL");
  assert.equal(result.exitCode, 1);
  assert.match(result.diagnostic, /coverage=function:50\.00<100/u);
  assert.doesNotMatch(result.diagnostic, /subject\.mjs|passing assertion/u);
});

for (const reporter of ["tap", "spec"]) test(`D15 retains timeout classification among long ${reporter} test labels`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-gate-timeout-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = path.join(root, "timeout.mjs");
  await fs.writeFile(fixture, `
import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
for (let i = 0; i < 8; i++) test("long assertion " + i + " " + "x".repeat(160), () => i === 0 ? assert.deepEqual({ code: "PRIVATE_ASSERTION" }, { code: "other" }) : assert.equal("PRIVATE_ASSERTION", "other"));
test("controlled timeout", { timeout: 10 }, () => delay(100));
`);
  const result = await receipt.runCheck({ id: "D15", command: process.execPath,
    args: ["--test", `--test-reporter=${reporter}`, fixture], timeoutMs: 10000, env: {} });
  assert.equal(result.status, "FAIL");
  assert.equal(result.timedOut, false, "the child test timed out, not the outer gate");
  assert.match(result.diagnostic, /codes=ERR_ASSERTION/u);
  if (reporter === "tap") {
    assert.match(result.diagnostic, /codes=ERR_ASSERTION,ERR_TEST_FAILURE/u);
    assert.match(result.diagnostic, /kinds=[^;]*testTimeoutFailure/u);
  }
  assert.match(result.diagnostic, /timeouts=10ms/u);
  assert.ok(result.diagnostic.length <= 1200);
  assert.doesNotMatch(result.diagnostic, /PRIVATE_ASSERTION/u);
  assert.ok(!result.diagnostic.includes(root));
});

test("D15 retains fixed phases when its real child is terminated at the gate deadline", { timeout: 10000 }, async () => {
  const result = await receipt.runCheck({ id: "D15", command: process.execPath,
    args: ["-e", `
process.stderr.write("M8_CHECK_START agents\\nM8_CHECK_PASS agents 12ms\\nM8_CHECK_START global-coverage\\n");
process.stderr.write("OMP_STDIO_READ_PHASE setup-start 0ms\\nOMP_STDIO_READ_PHASE cleanup-start 100ms\\n");
process.stderr.write("M8_CHECK_START PRIVATE_PHASE\\nOMP_STDIO_READ_PHASE PRIVATE_PHASE 101ms\\nOMP_STDIO_READ_PHASE cleanup-pass 102ms PRIVATE_PAYLOAD\\n");
setInterval(() => {}, 1000);
`], timeoutMs: 1000, env: {} });
  assert.equal(result.status, "FAIL");
  assert.equal(result.timedOut, true);
  assert.equal(result.signal, "SIGTERM");
  assert.match(result.diagnostic, /m8=global-coverage;lastM8Pass=agents@12ms/u);
  assert.match(result.diagnostic, /stdio=setup-start@0ms;stdioCleanup=cleanup-start@100ms/u);
  assert.doesNotMatch(result.diagnostic, /PRIVATE_PHASE|PRIVATE_PAYLOAD|cleanup-pass/u);
  assert.ok(result.diagnostic.length <= 1200);
});
