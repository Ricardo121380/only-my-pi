import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createProjectGateService, validateProjectGateManifest } from "../packages/project-gates/index.mjs";

const head = "0123456789abcdef0123456789abcdef01234567";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-project-gates-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const configRoot = path.join(root, "agent");
  const binRoot = path.join(root, "bin");
  await Promise.all([
    fs.mkdir(path.join(projectRoot, ".pi"), { recursive: true }),
    fs.mkdir(configRoot, { recursive: true }),
    fs.mkdir(binRoot, { recursive: true }),
  ]);
  const executable = path.join(binRoot, "fixture-test");
  await fs.writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.chmod(executable, 0o755);
  const manifest = {
    $schema: "../../schemas/project-gates-v1.schema.json",
    formatVersion: 1,
    id: "default",
    gates: [{
      id: "unit-tests",
      description: "Run fixture tests.",
      command: "fixture-test",
      args: ["--literal", "$(touch must-not-run)", "a;b"],
      cwd: ".",
      timeoutSeconds: 30,
      env: { CI: "1", FIXTURE: "safe" },
    }],
  };
  await fs.writeFile(path.join(projectRoot, ".pi", "only-my-pi-gates.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const calls = [];
  const exec = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === "git" && args.includes("--show-toplevel")) return { code: 0, stdout: `${projectRoot}\n`, stderr: "", killed: false };
    if (command === "git" && args.at(-1) === "HEAD") return { code: 0, stdout: `${head}\n`, stderr: "", killed: false };
    if (command === "/usr/bin/env") return { code: 0, stdout: "tests passed\n", stderr: "", killed: false };
    throw new Error(`unexpected exec: ${command}`);
  };
  const context = { cwd: projectRoot, isProjectTrusted: () => true, sessionManager: { getSessionId: () => "project-gate-session" } };
  const service = createProjectGateService({ configRoot, getContext: () => context, exec, environmentPath: binRoot });
  return { root, projectRoot, configRoot, binRoot, executable, manifest, calls, exec, context, service };
}

test("project Gate Manifest binds session, HEAD, manifest, argv, cwd, env and executable", async (t) => {
  const { service, projectRoot, executable } = await fixture(t);
  const plan = await service.plan(["unit-tests"]);
  assert.equal(plan.status, "PROJECT_GATE_PLAN");
  assert.equal(plan.binding.sessionId, "project-gate-session");
  assert.equal(plan.binding.head, head);
  assert.equal(plan.binding.gateIds[0], "unit-tests");
  assert.equal(plan.gates[0].executableRealpath, await fs.realpath(executable));
  assert.equal(plan.gates[0].cwd, await fs.realpath(projectRoot));
  assert.match(plan.binding.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.match(plan.warning, /not filesystem-sandboxed/u);
});

test("session grant is reusable only for the exact tuple and execution remains shell-free argv", async (t) => {
  const { service, calls, projectRoot, executable } = await fixture(t);
  const plan = await service.plan(["unit-tests"]);
  assert.equal((await service.grant(plan)).status, "PROJECT_GATE_TRUSTED_SESSION");
  assert.equal(service.status().status, "PROJECT_GATE_TRUSTED_SESSION");
  const receipt = await service.run("unit-tests");
  assert.equal(receipt.status, "PASS");
  assert.equal(receipt.shell, false);
  const run = calls.find((call) => call.command === "/usr/bin/env");
  assert.ok(run);
  assert.deepEqual(run.args.slice(-4), [await fs.realpath(executable), "--literal", "$(touch must-not-run)", "a;b"]);
  assert.equal(run.args.includes("$(touch must-not-run)"), true);
  assert.equal(run.options.cwd, await fs.realpath(projectRoot));
  assert.equal(Object.hasOwn(run.options, "shell"), false);
  assert.equal((await service.run("unit-tests", { dryRun: true })).status, "PLANNED");
  assert.equal(service.reset().status, "PROJECT_GATE_TRUST_RESET");
  await assert.rejects(service.run("unit-tests"), { code: "PROJECT_GATE_AUTHORIZATION_REQUIRED" });
});

test("manifest or HEAD drift revokes a session grant", async (t) => {
  const { service, projectRoot, manifest } = await fixture(t);
  const plan = await service.plan(["unit-tests"]);
  await service.grant(plan);
  manifest.gates[0].args.push("--changed");
  await fs.writeFile(path.join(projectRoot, ".pi", "only-my-pi-gates.json"), `${JSON.stringify(manifest)}\n`);
  await assert.rejects(service.run("unit-tests"), { code: "PROJECT_GATE_GRANT_DRIFT" });
  assert.equal(service.status().status, "PROJECT_GATE_UNTRUSTED");
});

test("reset cancels an in-flight gate and a killed zero exit is never PASS", async (t) => {
  const data = await fixture(t);
  const originalExec = data.service.exec;
  const plan = await data.service.plan(["unit-tests"]);
  await data.service.grant(plan);
  let started;
  const admitted = new Promise((resolve) => { started = resolve; });
  data.service.exec = (command, args, options) => command === "/usr/bin/env"
    ? new Promise((resolve) => {
      started();
      options.signal.addEventListener("abort", () => resolve({ code: 0, stdout: "", stderr: "", killed: true }), { once: true });
    })
    : originalExec(command, args, options);
  const running = data.service.run("unit-tests");
  await admitted;
  assert.equal(data.service.reset().status, "PROJECT_GATE_TRUST_RESET");
  const receipt = await running;
  assert.equal(receipt.status, "FAIL");
  assert.equal(receipt.killed, true);
});

test("a gate plan captured before reset cannot be approved afterward", async (t) => {
  const { service } = await fixture(t);
  const oldPlan = await service.plan(["unit-tests"]);
  service.reset();
  await assert.rejects(service.grant(oldPlan), { code: "PROJECT_GATE_PLAN_STALE" });
  const fresh = await service.plan(["unit-tests"]);
  assert.equal((await service.grant(fresh)).status, "PROJECT_GATE_TRUSTED_SESSION");
});

test("dispose preserves an unconfirmed process termination result", async (t) => {
  const data = await fixture(t);
  const originalExec = data.service.exec;
  await data.service.grant(await data.service.plan(["unit-tests"]));
  let started;
  const admitted = new Promise((resolve) => { started = resolve; });
  data.service.exec = (command, args, options) => command === "/usr/bin/env"
    ? new Promise((resolve) => {
      started();
      options.signal.addEventListener("abort", () => resolve({ code: 1, stdout: "", stderr: "", killed: true, terminationUnconfirmed: true }), { once: true });
    })
    : originalExec(command, args, options);
  const running = data.service.run("unit-tests");
  await admitted;
  const disposed = data.service.dispose();
  assert.equal((await running).status, "FAIL");
  assert.equal((await disposed).terminationUnconfirmed, true);
});

test("untrusted project, secret env, path escape, duplicate gate and shell-shaped command fail closed", async (t) => {
  const fixtureData = await fixture(t);
  fixtureData.context.isProjectTrusted = () => false;
  await assert.rejects(fixtureData.service.plan(), { code: "PROJECT_TRUST_REQUIRED" });
  assert.throws(() => validateProjectGateManifest({ ...fixtureData.manifest, gates: [{ ...fixtureData.manifest.gates[0], env: { API_KEY: "forbidden" } }] }), { code: "PROJECT_GATE_SECRET_ENV_FORBIDDEN" });
  assert.throws(() => validateProjectGateManifest({ ...fixtureData.manifest, gates: [{ ...fixtureData.manifest.gates[0], cwd: "../escape" }] }), { code: "PROJECT_GATE_MANIFEST_INVALID" });
  assert.throws(() => validateProjectGateManifest({ ...fixtureData.manifest, gates: [fixtureData.manifest.gates[0], fixtureData.manifest.gates[0]] }), { code: "PROJECT_GATE_MANIFEST_INVALID" });
  assert.throws(() => validateProjectGateManifest({ ...fixtureData.manifest, gates: [{ ...fixtureData.manifest.gates[0], command: "npm test" }] }), { code: "PROJECT_GATE_MANIFEST_INVALID" });
});
