import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ArtifactInstaller } from "../packages/bootstrap/artifact-installer.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-artifact-installer-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifact = path.join(root, "only-my-pi.tgz");
  const configRoot = path.join(root, "agent");
  const temporaryRoot = path.join(root, "runtime");
  const npmCache = path.join(root, "npm-cache");
  await fs.writeFile(artifact, "fixture-artifact", { mode: 0o600 });
  await fs.mkdir(temporaryRoot, { mode: 0o700 });
  await fs.mkdir(npmCache, { mode: 0o700 });
  return { root, artifact, configRoot, temporaryRoot, npmCache };
}

async function installFakePackage(argv) {
  const prefixIndex = argv.indexOf("--prefix");
  const installRoot = argv[prefixIndex + 1];
  const packageRoot = path.join(installRoot, "node_modules", "only-my-pi");
  await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: "only-my-pi", version: "0.1.0" })}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(packageRoot, "bin", "omp.mjs"), "// fixture\n", { mode: 0o600 });
}

function successfulRunner(calls) {
  return async (command, argv, options) => {
    calls.push({ command, argv, options });
    if (command === "npm") {
      await installFakePackage(argv);
      return { exitCode: 0, signal: null, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false };
    }
    return {
      exitCode: 0,
      signal: null,
      stdout: `${JSON.stringify({ ok: true, status: "COMMITTED", mutation: true, transactionId: "tx-fixture" })}\n`,
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  };
}

test("artifact install plan verifies identity and digest without writes or subprocesses", async (t) => {
  const paths = await fixture(t);
  let calls = 0;
  const installer = new ArtifactInstaller({
    temporaryRoot: paths.temporaryRoot,
    npmCache: paths.npmCache,
    runCommand: async () => { calls += 1; throw new Error("must not run"); },
  });
  const before = await fs.readdir(paths.temporaryRoot);
  const plan = await installer.plan({ artifact: paths.artifact, profile: "daily", configRoot: paths.configRoot });
  assert.equal(plan.status, "ARTIFACT_INSTALL_PLAN");
  assert.match(plan.artifact.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(plan.artifact.bytes, 16);
  assert.deepEqual(plan.zeroWriteEvidence, { writes: 0, subprocesses: 0, providerRequests: 0 });
  assert.deepEqual(await fs.readdir(paths.temporaryRoot), before);
  assert.equal(calls, 0);
  await assert.rejects(fs.lstat(paths.configRoot), { code: "ENOENT" });
});

test("artifact apply revalidates, extracts with scripts disabled, and runs only the artifact-contained omp", async (t) => {
  const paths = await fixture(t);
  const calls = [];
  const installer = new ArtifactInstaller({
    temporaryRoot: paths.temporaryRoot,
    npmCache: paths.npmCache,
    runCommand: successfulRunner(calls),
  });
  const plan = await installer.plan({ operation: "install", artifact: paths.artifact, profile: "daily", configRoot: paths.configRoot });
  const result = await installer.apply({ operation: "install", artifact: paths.artifact, profile: "daily", configRoot: paths.configRoot, plan });
  assert.equal(result.status, "ARTIFACT_APPLIED");
  assert.equal(result.receipt.transactionId, "tx-fixture");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, "npm");
  assert.deepEqual(calls[0].argv.slice(0, 10), [
    "install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev",
    "--omit=peer", "--legacy-peer-deps", "--package-lock=false", "--no-save", "--offline",
  ]);
  assert.equal(calls[0].options.env.npm_config_ignore_scripts, "true");
  assert.equal(calls[0].options.env.npm_config_cache, paths.npmCache);
  assert.equal(Object.hasOwn(calls[0].options.env, "NPM_TOKEN"), false);
  assert.equal(calls[1].command, process.execPath);
  assert.deepEqual(calls[1].argv.slice(1), ["bootstrap", "--profile", "daily", "--config-root", paths.configRoot, "--apply", "--yes", "--json"]);
  assert.deepEqual(await fs.readdir(paths.temporaryRoot), []);
});

test("artifact apply fails closed when the reviewed artifact changes", async (t) => {
  const paths = await fixture(t);
  const installer = new ArtifactInstaller({ temporaryRoot: paths.temporaryRoot, npmCache: paths.npmCache, runCommand: async () => assert.fail("must not spawn") });
  const plan = await installer.plan({ artifact: paths.artifact, profile: "daily", configRoot: paths.configRoot });
  await fs.writeFile(paths.artifact, "changed-artifact", { mode: 0o600 });
  await assert.rejects(
    installer.apply({ artifact: paths.artifact, profile: "daily", configRoot: paths.configRoot, plan }),
    { code: "ARTIFACT_CHANGED_AFTER_PLAN" },
  );
  assert.deepEqual(await fs.readdir(paths.temporaryRoot), []);
});

test("artifact plan rejects symlinks before hashing", async (t) => {
  const paths = await fixture(t);
  const link = path.join(paths.root, "linked.tgz");
  await fs.symlink(paths.artifact, link);
  const installer = new ArtifactInstaller({ temporaryRoot: paths.temporaryRoot, npmCache: paths.npmCache });
  await assert.rejects(installer.plan({ artifact: link, profile: "daily", configRoot: paths.configRoot }), {
    code: "ARTIFACT_SYMLINK_REJECTED",
  });
});
