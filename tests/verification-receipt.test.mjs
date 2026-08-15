import assert from "node:assert/strict";
import test from "node:test";
import { runCheck } from "../scripts/verification-receipt.mjs";

test("verification check records bounded metadata without raw output", async () => {
  const result = await runCheck({
    id: "sample",
    command: process.execPath,
    args: ["-e", "process.stdout.write('evidence'); process.stderr.write('note')"],
    timeoutMs: 5000,
  });
  assert.equal(result.passed, true);
  assert.equal(result.stdoutBytes, 8);
  assert.equal(result.stderrBytes, 4);
  assert.equal(Object.hasOwn(result, "stdout"), false);
  assert.match(result.stdoutSha256, /^[a-f0-9]{64}$/);
});

test("empty-output expectation fails closed", async () => {
  const result = await runCheck({
    id: "unexpected-output",
    command: process.execPath,
    args: ["-e", "process.stdout.write('dirty')"],
    timeoutMs: 5000,
    expectStdout: "empty",
  });
  assert.equal(result.passed, false);
  assert.equal(result.expectationPassed, false);
});
