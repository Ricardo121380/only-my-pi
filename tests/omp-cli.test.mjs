import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createProductionControlService,
  createTerminalConfirm,
  exitCodeForResult,
  OMP_EXIT_CODES,
  runOmpCli,
  stringifyOmpJson,
} from "../bin/omp.mjs";
import { ControlService, OMP_USAGE } from "../packages/control-service/service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = "/tmp/only-my-pi-cli-test";

function outputStream({ isTTY = false } = {}) {
  let value = "";
  return {
    isTTY,
    write(chunk) {
      value += String(chunk);
      return true;
    },
    text() {
      return value;
    },
  };
}

async function invoke(argv, options = {}) {
  const stdout = outputStream();
  const stderr = outputStream();
  const code = await runOmpCli({
    argv,
    env: {},
    homedir: () => "/tmp/only-my-pi-never-real-home",
    stdin: { isTTY: false },
    stdout,
    stderr,
    ...options,
  });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

function controlHarness({ confirm, liveResult } = {}) {
  const calls = [];
  const plan = (operation, options) => ({
    formatVersion: 1,
    kind: `only-my-pi-${operation}-plan`,
    operation,
    status: "PLAN_READY",
    mutation: false,
    configRoot: options.configRoot,
    profileId: options.profile ?? "coding",
    zeroWriteEvidence: { writes: 0, subprocesses: 0, providerRequests: 0 },
    changes: [`${operation}-change`],
    planDigest: `sha256:${operation.padEnd(64, "0").slice(0, 64)}`,
  });
  const bootstrap = {
    async planBootstrap(options) {
      calls.push({ method: "planBootstrap", options });
      return plan("bootstrap", options);
    },
    async applyBootstrap(options) {
      calls.push({ method: "applyBootstrap", options });
      return { ok: true, status: "COMMITTED", mutation: true, transactionId: "txn-bootstrap" };
    },
    async planUpdate(options) {
      calls.push({ method: "planUpdate", options });
      return plan("update", options);
    },
    async applyUpdate(options) {
      calls.push({ method: "applyUpdate", options });
      return { ok: true, status: "COMMITTED", mutation: true, transactionId: "txn-update" };
    },
    async planUninstall(options) {
      calls.push({ method: "planUninstall", options });
      return plan("uninstall", options);
    },
    async applyUninstall(options) {
      calls.push({ method: "applyUninstall", options });
      return { ok: true, status: "COMMITTED", mutation: true, transactionId: "txn-uninstall" };
    },
    async planRollback(options) {
      calls.push({ method: "planRollback", options });
      return { ...plan("rollback", options), snapshotId: options.snapshotId ?? "latest-snapshot" };
    },
    async rollback(options) {
      calls.push({ method: "rollback", options });
      return { ok: true, status: "COMMITTED", mutation: true, transactionId: "txn-rollback" };
    },
    async doctor(options) {
      calls.push({ method: "doctor", options });
      return { ok: true, status: "PASS", mutation: false };
    },
    async status(options) {
      calls.push({ method: "status", options });
      return {
        ok: true,
        status: "INSTALLED",
        mutation: false,
        configRoot: options.configRoot,
        incompleteTransactions: [],
      };
    },
    async safe(options) {
      calls.push({ method: "safe", options });
      return {
        ok: true,
        status: "SAFE_START_GUIDANCE",
        mutation: false,
        configRoot: options.configRoot,
        command: ["pi", "--offline", "--tools", "read,grep,find,ls"],
      };
    },
  };
  const doctor = {
    async live(options) {
      calls.push({ method: "live", options });
      return liveResult ?? { ok: false, status: "UNAVAILABLE", mutation: false };
    },
  };
  return {
    calls,
    service: new ControlService({ bootstrap, doctor, confirm }),
  };
}

test("help is side-effect free and does not construct production services", async () => {
  let constructed = false;
  const result = await invoke(["help"], {
    serviceFactory() {
      constructed = true;
      throw new Error("must not construct");
    },
  });
  assert.equal(result.code, OMP_EXIT_CODES.SUCCESS);
  assert.equal(result.stdout, `${OMP_USAGE}\n`);
  assert.equal(result.stderr, "");
  assert.equal(constructed, false);

  const source = await fs.readFile(path.join(repoRoot, "bin", "omp.mjs"), "utf8");
  assert.equal(source.startsWith("#!/usr/bin/env node\n"), true);
});

test("the CLI executes through an npm-style symlink instead of silently importing", async (t) => {
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-symlink-"));
  t.after(() => fs.rm(isolatedRoot, { recursive: true, force: true }));
  const link = path.join(isolatedRoot, "omp");
  await fs.symlink(path.join(repoRoot, "bin", "omp.mjs"), link);

  const result = spawnSync(process.execPath, [link, "help"], {
    cwd: isolatedRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${OMP_USAGE}\n`);
});

test("bootstrap, update, and uninstall default to zero-write plans", async () => {
  for (const command of ["bootstrap", "update", "uninstall"]) {
    const harness = controlHarness();
    const result = await invoke([command, "--config-root", configRoot], { service: harness.service });
    assert.equal(result.code, OMP_EXIT_CODES.SUCCESS, command);
    assert.equal(result.stderr, "", command);
    assert.match(result.stdout, new RegExp(`operation: ${command}`));
    assert.match(result.stdout, /mutation: false/);
    assert.match(result.stdout, /zeroWrite: writes=0 subprocesses=0 providerRequests=0/);
    const capital = command[0].toUpperCase() + command.slice(1);
    assert.deepEqual(harness.calls.map((entry) => entry.method), [`plan${capital}`]);
  }
});

test("noninteractive apply fails closed without --yes and never reaches mutation", async () => {
  for (const command of ["bootstrap", "update", "uninstall"]) {
    const harness = controlHarness();
    const result = await invoke([command, "--apply", "--config-root", configRoot], { service: harness.service });
    const capital = command[0].toUpperCase() + command.slice(1);
    assert.equal(result.code, OMP_EXIT_CODES.CONFIRMATION_REQUIRED, command);
    assert.match(result.stdout, /status: CONFIRMATION_REQUIRED/);
    assert.match(result.stdout, new RegExp(`rerun omp ${command} with --apply --yes`));
    assert.deepEqual(harness.calls.map((entry) => entry.method), [`plan${capital}`]);
  }
});

test("--apply --yes performs plan-first bootstrap, update, and uninstall", async () => {
  for (const command of ["bootstrap", "update", "uninstall"]) {
    const harness = controlHarness();
    const result = await invoke([
      command,
      "--apply",
      "--yes",
      "--config-root",
      configRoot,
      "--json",
    ], { service: harness.service });
    const capital = command[0].toUpperCase() + command.slice(1);
    assert.equal(result.code, OMP_EXIT_CODES.SUCCESS, command);
    assert.equal(JSON.parse(result.stdout).mutation, true);
    assert.deepEqual(harness.calls.map((entry) => entry.method), [`plan${capital}`, `apply${capital}`]);
    assert.equal(harness.calls[1].options.plan.operation, command);
  }
});

test("rollback exposes a reviewable plan unless explicitly approved", async () => {
  const planning = controlHarness();
  const planned = await invoke(["rollback", "snapshot-1", "--config-root", configRoot], { service: planning.service });
  assert.equal(planned.code, OMP_EXIT_CODES.CONFIRMATION_REQUIRED);
  assert.match(planned.stdout, /snapshotId: snapshot-1/);
  assert.match(planned.stdout, /rerun omp rollback with --yes/);
  assert.deepEqual(planning.calls.map((entry) => entry.method), ["planRollback"]);

  const applying = controlHarness();
  const applied = await invoke([
    "rollback",
    "snapshot-1",
    "--yes",
    "--config-root",
    configRoot,
    "--json",
  ], { service: applying.service });
  assert.equal(applied.code, OMP_EXIT_CODES.SUCCESS);
  assert.deepEqual(applying.calls.map((entry) => entry.method), ["planRollback", "rollback"]);
  assert.equal(applying.calls[1].options.plan.snapshotId, "snapshot-1");
});

test("a positive parent confirmation can approve an explicit apply", async () => {
  const confirmations = [];
  const harness = controlHarness({
    confirm: async (request) => {
      confirmations.push(request);
      return true;
    },
  });
  const result = await invoke(["bootstrap", "--apply", "--config-root", configRoot], { service: harness.service });
  assert.equal(result.code, OMP_EXIT_CODES.SUCCESS);
  assert.deepEqual(harness.calls.map((entry) => entry.method), ["planBootstrap", "applyBootstrap"]);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0].plan.operation, "bootstrap");
});

test("status, doctor, live doctor, and safe route through their bounded services", async () => {
  const harness = controlHarness();
  assert.equal((await invoke(["status", "--config-root", configRoot], { service: harness.service })).code, 0);
  assert.equal((await invoke(["doctor", "--config-root", configRoot], { service: harness.service })).code, 0);
  const live = await invoke(["doctor", "--live", "--config-root", configRoot, "--json"], { service: harness.service });
  assert.equal(live.code, OMP_EXIT_CODES.UNAVAILABLE);
  assert.equal(JSON.parse(live.stdout).status, "UNAVAILABLE");
  const safe = await invoke(["safe", "--config-root", configRoot], { service: harness.service });
  assert.equal(safe.code, 0);
  assert.match(safe.stdout, /safeCommand: pi --offline --tools read,grep,find,ls/);
  assert.deepEqual(harness.calls.map((entry) => entry.method), ["status", "doctor", "live", "safe"]);
});

test("production factory wires every runtime dependency without invoking runners", () => {
  const calls = [];
  const npmRunner = async () => ({ exitCode: 0 });
  const smokeRunner = async () => ({ ok: true });
  const fakeSpawn = () => {
    throw new Error("must not spawn during construction");
  };
  class FakeDoctorService {
    constructor(options) {
      this.options = options;
      calls.push({ name: "DoctorService", options, instance: this });
    }
  }
  class FakeTransactionEngine {
    constructor(options) {
      this.options = options;
      calls.push({ name: "TransactionEngine", options, instance: this });
    }
  }
  class FakeBootstrapService {
    constructor(options) {
      this.options = options;
      calls.push({ name: "BootstrapService", options, instance: this });
    }
  }
  class FakeControlService {
    constructor(options) {
      this.options = options;
      calls.push({ name: "ControlService", options, instance: this });
    }
    async dispatch() {
      return { ok: true, status: "PASS" };
    }
  }
  const confirm = async () => false;
  const service = createProductionControlService({
    rootDir: repoRoot,
    configRoot,
    spawnImpl: fakeSpawn,
    confirm,
    dependencies: {
      BootstrapService: FakeBootstrapService,
      ControlService: FakeControlService,
      DoctorService: FakeDoctorService,
      TransactionEngine: FakeTransactionEngine,
      createNpmCommandRunner(options) {
        calls.push({ name: "createNpmCommandRunner", options });
        return npmRunner;
      },
      createNoModelSmokeRunner(options) {
        calls.push({ name: "createNoModelSmokeRunner", options });
        return smokeRunner;
      },
    },
  });

  assert.ok(service instanceof FakeControlService);
  assert.deepEqual(calls.map((entry) => entry.name), [
    "DoctorService",
    "createNpmCommandRunner",
    "createNoModelSmokeRunner",
    "TransactionEngine",
    "BootstrapService",
    "ControlService",
  ]);
  assert.equal(calls[1].options.configRoot, configRoot);
  assert.equal(calls[2].options.spawnImpl, fakeSpawn);
  assert.equal(calls[3].options.runner, npmRunner);
  assert.equal(calls[3].options.smokeRunner, smokeRunner);
  assert.equal(calls[3].options.doctorService, calls[0].instance);
  assert.ok(calls[4].options.transactionEngine instanceof FakeTransactionEngine);
  assert.equal(calls[4].options.transactionEngine, calls[3].instance);
  assert.equal(calls[4].options.doctorService, calls[0].instance);
  assert.equal(service.options.bootstrap, calls[4].instance);
  assert.equal(service.options.doctor, calls[0].instance);
  assert.equal(service.options.confirm, confirm);
});

test("the production bootstrap plan is read-only and never invokes the injected Pi spawn", async (t) => {
  const isolatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-production-plan-"));
  t.after(() => fs.rm(isolatedRoot, { recursive: true, force: true }));
  let spawned = false;
  const result = await invoke([
    "bootstrap",
    "--profile",
    "coding",
    "--config-root",
    isolatedRoot,
    "--json",
  ], {
    rootDir: repoRoot,
    spawnImpl() {
      spawned = true;
      throw new Error("plan must not spawn Pi");
    },
  });
  assert.equal(result.code, OMP_EXIT_CODES.SUCCESS, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.operation, "bootstrap");
  assert.equal(plan.mutation, false);
  assert.deepEqual(plan.zeroWriteEvidence, { providerRequests: 0, subprocesses: 0, writes: 0 });
  assert.equal(spawned, false);
  assert.deepEqual(await fs.readdir(isolatedRoot), []);
});

test("the production BatchSwarm CLI expands offline without Pi, Provider, or config writes", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-batch-plan-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const isolatedConfig = path.join(temporary, "pi-agent");
  const inputFile = path.join(temporary, "items.json");
  await fs.mkdir(isolatedConfig);
  await fs.writeFile(inputFile, JSON.stringify({ artifacts: { items: [{ itemId: "one", path: "src/one.mjs" }, { itemId: "two", path: "src/two.mjs" }] } }));
  let spawned = false;
  const result = await invoke([
    "swarm",
    "batch",
    "plan",
    "review-items",
    "--input-file",
    inputFile,
    "--config-root",
    isolatedConfig,
    "--json",
  ], {
    rootDir: repoRoot,
    spawnImpl() {
      spawned = true;
      throw new Error("offline BatchSwarm plan must not spawn Pi");
    },
  });
  assert.equal(result.code, OMP_EXIT_CODES.SUCCESS, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.status, "BATCH_SWARM_PLAN");
  assert.equal(plan.liveDispatch, "NOT_RUN_BY_POLICY");
  assert.equal(plan.expansion.itemCount, 2);
  assert.equal(plan.expansion.maximumAssignments, 4);
  assert.equal(spawned, false);
  assert.deepEqual(await fs.readdir(isolatedConfig), []);
});

test("runOmpCli passes parsed configRoot, spawn, and confirmation into its service factory", async () => {
  const fakeSpawn = () => {};
  const confirm = async () => false;
  let received;
  const result = await invoke(["status", "--config-root", configRoot], {
    rootDir: repoRoot,
    spawnImpl: fakeSpawn,
    confirm,
    serviceFactory(options) {
      received = options;
      return { dispatch: async () => ({ ok: true, status: "NOT_INSTALLED", mutation: false }) };
    },
  });
  assert.equal(result.code, OMP_EXIT_CODES.SUCCESS);
  assert.equal(received.rootDir, repoRoot);
  assert.equal(received.configRoot, configRoot);
  assert.equal(received.spawnImpl, fakeSpawn);
  assert.equal(received.confirm, confirm);
});

test("JSON serialization and exit mapping are deterministic", () => {
  const value = { z: 1, nested: { b: 2, a: 1, omitted: undefined }, a: [3, undefined] };
  assert.equal(stringifyOmpJson(value), [
    "{",
    "  \"a\": [",
    "    3,",
    "    null",
    "  ],",
    "  \"nested\": {",
    "    \"a\": 1,",
    "    \"b\": 2",
    "  },",
    "  \"z\": 1",
    "}",
    "",
  ].join("\n"));
  assert.equal(exitCodeForResult({ status: "PLAN_READY" }), OMP_EXIT_CODES.SUCCESS);
  assert.equal(exitCodeForResult({ ok: false, status: "FAIL" }), OMP_EXIT_CODES.FAILURE);
  assert.equal(exitCodeForResult({ ok: false, status: "CONFIRMATION_REQUIRED" }), OMP_EXIT_CODES.CONFIRMATION_REQUIRED);
  assert.equal(exitCodeForResult({ ok: false, status: "UNAVAILABLE" }), OMP_EXIT_CODES.UNAVAILABLE);
});

test("argument and service failures use stderr, bounded public errors, and no stack or cause", async () => {
  const usage = await invoke(["status", "--unknown", "--json"], {
    serviceFactory() {
      throw new Error("must not construct after parse failure");
    },
  });
  assert.equal(usage.code, OMP_EXIT_CODES.USAGE);
  assert.equal(usage.stdout, "");
  assert.deepEqual(JSON.parse(usage.stderr), {
    code: "INVALID_ARGUMENT",
    message: "unknown option: --unknown",
    mutation: false,
    ok: false,
    status: "ERROR",
  });

  const causeSecret = "raw-child-output-must-not-appear";
  const error = Object.assign(new Error("operation failed safely"), {
    code: "SAFE_TEST_FAILURE",
    cause: new Error(causeSecret),
  });
  const failure = await invoke(["status", "--config-root", configRoot, "--json"], {
    service: { dispatch: async () => { throw error; } },
  });
  assert.equal(failure.code, OMP_EXIT_CODES.FAILURE);
  assert.equal(failure.stdout, "");
  assert.equal(failure.stderr.includes(causeSecret), false);
  assert.equal(failure.stderr.includes("stack"), false);
  assert.equal(JSON.parse(failure.stderr).code, "SAFE_TEST_FAILURE");

  const unavailable = await invoke(["status", "--config-root", configRoot, "--json"], {
    service: {
      dispatch: async () => {
        throw Object.assign(new Error("package runner is unavailable"), { code: "PACKAGE_RUNNER_UNAVAILABLE" });
      },
    },
  });
  assert.equal(unavailable.code, OMP_EXIT_CODES.UNAVAILABLE);
  assert.equal(JSON.parse(unavailable.stderr).code, "PACKAGE_RUNNER_UNAVAILABLE");
});

test("terminal confirmation rejects every non-TTY caller without reading input", async () => {
  let read = false;
  const confirm = createTerminalConfirm({
    input: {
      isTTY: false,
      on() {
        read = true;
      },
    },
    output: outputStream({ isTTY: true }),
  });
  assert.equal(await confirm({ command: "bootstrap", plan: { planDigest: "sha256:test" } }), false);
  assert.equal(read, false);
});
