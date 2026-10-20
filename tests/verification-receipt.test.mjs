import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  boundedTestFailureDiagnostic,
  repositoryRoot,
  runCheck,
  runReleaseVerification,
} from "../scripts/verification-receipt.mjs";
import { loadReleaseGatesManifest } from "../scripts/lib/release-gates.mjs";

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

test("test-gate diagnostics expose only bounded test names and stable error codes", () => {
  const privatePath = ["", "Users", "example", "private", "file.txt"].join("/");
  const diagnostic = boundedTestFailureDiagnostic([
    `✖ runner keeps ${privatePath} isolated (12.3ms)`,
    "not ok 42 - linux cleanup releases every lock",
    "  actual:",
    "    code: 'NESTED_SECRET'",
    "  code: 'ERR_ASSERTION'",
    "  failureType: 'TEST_CODE_FAILURE'",
    "raw secret=must-not-be-copied",
  ].join("\n"), "");
  assert.match(diagnostic, /^TEST_FAILURE:/u);
  assert.match(diagnostic, /runner keeps <path> isolated/u);
  assert.match(diagnostic, /linux cleanup releases every lock/u);
  assert.match(diagnostic, /ERR_ASSERTION/u);
  assert.equal(diagnostic.includes("must-not-be-copied"), false);
  assert.equal(diagnostic.includes("NESTED_SECRET"), false);
  assert.equal(diagnostic.length <= 1200, true);
});

for (const boundary of ["timeout", "output"]) test(`verification ${boundary} boundary terminates its real child`, { timeout: 15000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-gate-child-"));
  const pidFile = path.join(root, "pid");
  t.after(() => {
    if (fs.existsSync(pidFile)) {
      try { process.kill(Number(fs.readFileSync(pidFile)), "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const result = await runCheck({ id: "bounded-child", command: process.execPath,
    args: ["-e", `require('node:fs').writeFileSync(process.argv[1], String(process.pid)); ${boundary === "output" ? "process.stdout.write('x'.repeat(1024));" : ""} setInterval(() => {}, 1000);`, pidFile],
    timeoutMs: 5000, maxOutputBytes: 64 });
  const pid = Number(fs.readFileSync(pidFile));
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  assert.equal(result.passed, false);
  assert.equal(result.timedOut, boundary === "timeout");
  assert.equal(result.outputLimitExceeded, boundary === "output");
  assert.equal(result.signal, "SIGTERM");
  assert.equal(Object.hasOwn(result, "stdout"), false);
});

const manifest = loadReleaseGatesManifest(path.join(repositoryRoot, "verification/release-gates-v1.json"));
function sourceFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-release-runner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: root, encoding: "utf8" }).trim();
  git(["init", "--quiet"]);
  git(["commit", "--quiet", "--allow-empty", "-m", "fixture"]);
  return { root, git, head: git(["rev-parse", "HEAD"]), output: "verification/receipts/unit-fixture.json" };
}

// Synthetic child results test receipt publication only. They are deliberately
// confined to a disposable repository and are not product acceptance evidence.
function gateResults(sourceCommit, failedGate) {
  const evidence = { formatVersion: 2, status: "PASS", sourceCommit, nodeVersion: process.version, piVersion: "1.3.0",
    platform: process.platform, arch: process.arch,
    tarball: { name: "only-my-pi", version: "0.1.0", sha256: "a".repeat(64), integrity: "sha512-Zml4dHVyZQ==", files: 1 },
    install: { scripts: "disabled", offline: true, global: false, checkoutRuntime: false, dependencySeed: "repository-lockfile-local-tarball" },
    bootstrap: { dryRun: "PLAN_READY_ZERO_WRITE", firstApply: "COMMITTED", secondApply: "NO_CHANGES", doctor: "PASS", safe: "PASS",
      rollback: "COMMITTED", finalStatus: "NOT_INSTALLED", piNoModelStartup: "NO_MODEL_STARTUP_PASS" },
    provider: "NOT_RUN_BY_POLICY", credentials: "NOT_READ", realPiHome: "NOT_TOUCHED" };
  const calls = [];
  return { calls, spawnImpl(command, args, options) {
    const gate = manifest.gates[calls.length];
    calls.push({ command, args, options });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (gate.id === "test-e2e") child.stdout.emit("data", Buffer.from(`OMP_FRESH_TARBALL_EVIDENCE=${JSON.stringify(evidence)}\n`));
      child.emit("close", gate.id === failedGate ? 1 : 0, null);
    });
    return child;
  } };
}

test("receipt runner rejects unsafe outputs, existing receipts and dirty sources before spawning", async (t) => {
  const f = sourceFixture(t), recorder = spawnRecorder();
  const run = output => runReleaseVerification({ manifest, rootDir: f.root, output, env: {}, spawnImpl: recorder.spawnImpl });
  for (const output of ["outside.json", "verification/receipts", "verification/receipts/../outside.json", "verification/receipts/result.txt"])
    await assert.rejects(run(output), /JSON file inside verification\/receipts/u);
  const target = path.join(f.root, f.output);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "original");
  await assert.rejects(run(f.output), /already exists/u);
  assert.equal(fs.readFileSync(target, "utf8"), "original"); fs.unlinkSync(target);
  fs.writeFileSync(path.join(f.root, "untracked"), "keep");
  await assert.rejects(run(f.output), /completely clean source/u);
  assert.equal(fs.existsSync(target), false);
  assert.equal(recorder.calls.length, 0);
});

for (const failedGate of [undefined, "lint"]) test(`receipt runner publishes ${failedGate ? "FAILED" : "COMPLETE"} only after every fixed gate`, async (t) => {
  const f = sourceFixture(t), recorder = gateResults(f.head, failedGate), observed = [];
  const result = await runReleaseVerification({ manifest, rootDir: f.root, output: f.output, env: {},
    spawnImpl: recorder.spawnImpl, onGate: gate => observed.push(gate.id) });
  assert.deepEqual(observed, manifest.gates.map(gate => gate.id));
  assert.deepEqual(recorder.calls.map(({ command, args }) => ({ command, args })), manifest.gates.map(({ command, args }) => ({ command, args })));
  assert.equal(result.receipt.sourceCommit, f.head);
  assert.equal(result.receipt.status, failedGate ? "FAILED" : "COMPLETE");
  assert.equal(result.receipt.passed, !failedGate);
  assert.equal(result.receipt.gates.filter(gate => gate.status === "FAIL").length, failedGate ? 1 : 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.target, "utf8")), result.receipt);
  assert.equal(result.receipt.privacy.rawOutputStored, false);
  assert.equal(JSON.stringify(result.receipt).includes(f.root), false);
  const bytes = fs.readFileSync(result.target);
  await assert.rejects(runReleaseVerification({ manifest, rootDir: f.root, output: f.output, env: {}, spawnImpl: recorder.spawnImpl }), /already exists/u);
  assert.deepEqual(fs.readFileSync(result.target), bytes);
});

for (const mutation of ["dirty", "commit"]) test(`receipt runner refuses ${mutation} drift without publishing a receipt`, async (t) => {
  const f = sourceFixture(t), recorder = gateResults(f.head);
  await assert.rejects(runReleaseVerification({ manifest, rootDir: f.root, output: f.output, env: {}, spawnImpl: recorder.spawnImpl,
    onGate: gate => {
      if (gate.id !== manifest.gates[0].id) return;
      if (mutation === "dirty") fs.writeFileSync(path.join(f.root, "new-file"), "preserve");
      else f.git(["commit", "--quiet", "--allow-empty", "-m", "concurrent change"]);
    } }), mutation === "dirty" ? /completely clean source/u : /source commit changed/u);
  assert.equal(recorder.calls.length, manifest.gates.length);
  assert.equal(fs.existsSync(path.join(f.root, f.output)), false);
  if (mutation === "dirty") assert.equal(fs.readFileSync(path.join(f.root, "new-file"), "utf8"), "preserve");
});
