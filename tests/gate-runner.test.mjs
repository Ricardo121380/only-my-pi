import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { GateRunnerError, createGateRunner } from "../packages/gate-runner/index.mjs";

const root = process.cwd();

function fakeProcess({ code = 0, output = "ok\n", delay = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  setTimeout(() => {
    child.stdout.emit("data", output);
    child.emit("close", code, null);
  }, delay);
  return child;
}

test("gate runner exposes only fixed manifest command tuples", async () => {
  const calls = [];
  const runner = createGateRunner({ rootDir: root, spawnImpl: (command, args, options) => { calls.push({ command, args, options }); return fakeProcess(); } });
  const plan = runner.plan("typecheck");
  assert.deepEqual(plan.args, ["run", "typecheck"]);
  assert.equal(plan.shell, false);
  assert.equal(plan.cwd, root);
  const receipt = await runner.run("typecheck");
  assert.equal(receipt.status, "PASS");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal("output" in receipt, false);
});

test("gate runner rejects arbitrary IDs and supports no-spawn dry runs", async () => {
  let spawned = false;
  const runner = createGateRunner({ rootDir: root, spawnImpl: () => { spawned = true; return fakeProcess(); } });
  assert.throws(() => runner.plan("npm-exec"), /unknown gate ID/);
  const receipt = await runner.run("schema-check", { dryRun: true });
  assert.equal(receipt.status, "PLANNED");
  assert.equal(spawned, false);
});

test("gate runner bounds output and maps nonzero exits to FAIL", async () => {
  const failRunner = createGateRunner({ rootDir: root, spawnImpl: () => fakeProcess({ code: 3, output: "bad" }) });
  const failed = await failRunner.run("diff-check");
  assert.equal(failed.status, "FAIL");
  const noisyRunner = createGateRunner({ rootDir: root, maxOutputBytes: 16, spawnImpl: () => fakeProcess({ output: "this output is intentionally too large" }) });
  await assert.rejects(() => noisyRunner.run("diff-check"), (error) => error instanceof GateRunnerError && error.code === "OUTPUT_LIMIT");
});

test("gate runner cancellation kills the child and fails closed", async () => {
  let child;
  const runner = createGateRunner({ rootDir: root, spawnImpl: () => { child = fakeProcess({ delay: 1000 }); return child; } });
  const controller = new AbortController();
  const pending = runner.run("full-tests", { signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (error) => error instanceof GateRunnerError && error.code === "CANCELLED");
  assert.equal(child.killed, true);
});
