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
  const fixture = path.join(root, "failure.mjs");
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
  const progress = receipt.formatGateProgress(failed.gate, failed.diagnostic);
  assert.match(progress, new RegExp(`failure ${entry.id}: exitCode=1 signal=null timedOut=false outputLimitExceeded=false`, "u"));
  assert.ok(progress.includes(failed.diagnostic));
  assert.doesNotMatch(progress, /PRIVATE_DIAGNOSTIC_PAYLOAD|\/private\/fixture/u);
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
