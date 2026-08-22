import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCheck } from "../scripts/verification-receipt.mjs";

function spawnRecorder() {
  const calls = [];
  return {
    calls,
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.pid = 12345;
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    },
  };
}

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

test("only test-e2e receives an explicitly bounded npm cache", async (t) => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-release-cache-"));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));
  const inherited = { ...process.env, npm_config_cache: cacheRoot };
  const e2e = spawnRecorder();
  const result = await runCheck({
    id: "test-e2e",
    command: "npm",
    args: ["run", "test:e2e"],
    timeoutMs: 5000,
  }, { env: inherited, spawnImpl: e2e.spawnImpl });
  assert.equal(result.exitCode, 0);
  assert.equal(e2e.calls[0].options.env.npm_config_cache, fs.realpathSync(cacheRoot));

  const other = spawnRecorder();
  await runCheck({
    id: "test-unit",
    command: "npm",
    args: ["run", "test:unit"],
    timeoutMs: 5000,
  }, { env: inherited, spawnImpl: other.spawnImpl });
  assert.equal(Object.hasOwn(other.calls[0].options.env, "npm_config_cache"), false);
});

test("test-e2e rejects an npm cache outside the bounded roots before spawn", async () => {
  const recorder = spawnRecorder();
  const result = await runCheck({
    id: "test-e2e",
    command: "npm",
    args: ["run", "test:e2e"],
    timeoutMs: 5000,
  }, {
    env: { ...process.env, npm_config_cache: os.homedir() },
    spawnImpl: recorder.spawnImpl,
  });
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, null);
  assert.equal(recorder.calls.length, 0);
});
