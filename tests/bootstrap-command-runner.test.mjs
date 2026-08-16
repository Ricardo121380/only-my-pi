import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createNpmCommandRunner,
  validateNpmCommandRequest,
} from "../packages/bootstrap/command-runner.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const maliciousFixture = path.join(repoRoot, "verification", "fixtures", "bootstrap", "staging", "malicious-lifecycle");
const execFileAsync = promisify(execFile);

const fixedOverlay = Object.freeze({
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_ignore_scripts: "true",
  npm_config_update_notifier: "false",
});

const configRoot = "/tmp/isolated-pi-agent";
const safeCwd = "/tmp/isolated-pi-agent/only-my-pi/generations/staging";
const safe = {
  command: "npm",
  argv: [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--omit=peer",
    "--legacy-peer-deps",
    "--package-lock=false",
    "--no-save",
    "--prefix",
    safeCwd,
    "--",
    "/tmp/isolated-pi-agent/pkg.tgz",
  ],
  cwd: safeCwd,
  envOverlay: fixedOverlay,
  shell: false,
  stdio: "pipe",
};

async function temporaryRoot(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function request(argv, cwd) {
  return {
    command: "npm",
    argv,
    cwd,
    envOverlay: fixedOverlay,
    shell: false,
    stdio: "pipe",
  };
}

function packRequest(cwd, target = "fixture-package@1.0.0") {
  return request([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    cwd,
    "--",
    target,
  ], cwd);
}

async function requireSupportedLocalNpm(t) {
  let version;
  try {
    version = await execFileAsync("npm", ["--version"], {
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
      timeout: 10_000,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("UNAVAILABLE: npm executable is not installed");
      return false;
    }
    throw error;
  }
  const major = Number.parseInt(version.stdout.trim().split(".")[0], 10);
  if (!Number.isSafeInteger(major) || major < 9 || major > 11) {
    t.skip(`UNAVAILABLE: deterministic lifecycle regression supports npm majors 9-11, found ${version.stdout.trim()}`);
    return false;
  }
  return true;
}

test("npm runner contract requires scripts-disabled shell:false requests", () => {
  assert.equal(validateNpmCommandRequest(safe, { configRoot }), true);
  for (const candidate of [
    { ...safe, command: "sh" },
    { ...safe, shell: true },
    { ...safe, stdio: "inherit" },
    { ...safe, envOverlay: {} },
    { ...safe, envOverlay: { ...fixedOverlay, npm_config_userconfig: "/tmp/real-home/.npmrc" } },
    { ...safe, envOverlay: { ...fixedOverlay, npm_config_ignore_scripts: "false" } },
    { ...safe, cwd: "/tmp/outside" },
    { ...safe, argv: ["install\ntouch /tmp/pwn"] },
    { ...safe, argv: ["exec", "--", "touch", "/tmp/pwn"] },
    { ...safe, argv: ["run-script", "postinstall"] },
    { ...safe, argv: ["config", "get", "registry"] },
    {
      ...safe,
      argv: ["pack", "--ignore-scripts", "--json", "--pack-destination", "/tmp/outside", "--", "fixture-package@1.0.0"],
    },
    {
      ...safe,
      argv: [
        "install", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps", "--package-lock=false", "--no-save",
        "--prefix", "/tmp/outside", "--", "/tmp/isolated-pi-agent/pkg.tgz",
      ],
    },
    { ...safe, argv: [...safe.argv.slice(0, -1), "/tmp/outside.tgz"] },
  ]) assert.throws(() => validateNpmCommandRequest(candidate, { configRoot }));
});

test("request contract contains no shell, lifecycle, credential, or real-home widening", () => {
  assert.equal(safe.argv.includes("--ignore-scripts"), true);
  assert.equal(Object.keys(safe.envOverlay).some((key) => /token|auth|key|cookie/i.test(key)), false);
  assert.throws(() => createNpmCommandRunner({ configRoot: path.parse(configRoot).root }), /filesystem root/);
});

test("production npm runner rejects symlinked runtime directories and cwd before spawning", async (t) => {
  for (const leaf of ["npm-home", "npm-cache", "npm-tmp", "npm-prefix", "npm-workspace"]) {
    await t.test(leaf, async (t) => {
      const root = await temporaryRoot(t, `omp-npm-${leaf}-`);
      const currentConfigRoot = path.join(root, "config");
      const managedRoot = path.join(currentConfigRoot, "only-my-pi");
      const cwd = path.join(currentConfigRoot, "request-cwd");
      const outside = path.join(root, "outside");
      await fs.mkdir(managedRoot, { recursive: true });
      await fs.mkdir(cwd, { recursive: true });
      await fs.mkdir(outside);
      await fs.symlink(outside, path.join(managedRoot, leaf));

      await assert.rejects(
        createNpmCommandRunner({ configRoot: currentConfigRoot })(packRequest(cwd)),
        (error) => ["SYMLINK_ESCAPE", "UNSAFE_CONFIG_PATH"].includes(error?.code),
      );
      assert.deepEqual(await fs.readdir(outside), []);
    });
  }

  await t.test("request cwd", async (t) => {
    const root = await temporaryRoot(t, "omp-npm-cwd-");
    const currentConfigRoot = path.join(root, "config");
    const outside = path.join(root, "outside");
    await fs.mkdir(currentConfigRoot, { recursive: true });
    await fs.mkdir(outside);
    const cwd = path.join(currentConfigRoot, "symlink-cwd");
    await fs.symlink(outside, cwd);
    await assert.rejects(
      createNpmCommandRunner({ configRoot: currentConfigRoot })(packRequest(cwd)),
      (error) => error?.code === "SYMLINK_ESCAPE",
    );
    assert.deepEqual(await fs.readdir(outside), []);
  });
});

test("production npm runner fixes isolated project, user, global, cache, and tmp config", async (t) => {
  const root = await temporaryRoot(t, "omp-npmrc-isolation-");
  const currentConfigRoot = path.join(root, "config");
  const cwd = path.join(currentConfigRoot, "request-project");
  await fs.mkdir(cwd, { recursive: true });
  await fs.writeFile(path.join(currentConfigRoot, ".npmrc"), "registry=https://ancestor.audit.invalid/\n", "utf8");
  await fs.writeFile(path.join(cwd, "package.json"), "{\"name\":\"request-project\",\"version\":\"1.0.0\"}\n", "utf8");
  await fs.writeFile(path.join(cwd, ".npmrc"), "registry=https://project.audit.invalid/\n", "utf8");

  let invocation;
  const spawnImpl = (command, argv, options) => {
    invocation = { command, argv, options };
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => child.emit("exit", null, "SIGTERM");
    queueMicrotask(() => child.emit("exit", 0, null));
    return child;
  };
  const run = createNpmCommandRunner({ configRoot: currentConfigRoot, spawnImpl });
  const result = await run(packRequest(cwd));
  assert.equal(result.exitCode, 0);
  assert.equal(invocation.options.cwd, path.join(currentConfigRoot, "only-my-pi", "npm-workspace"));
  assert.equal(invocation.options.env.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(invocation.options.env.TMPDIR, path.join(currentConfigRoot, "only-my-pi", "npm-tmp"));
  assert.equal(invocation.options.env.npm_config_userconfig, path.join(currentConfigRoot, "only-my-pi", "npm-home", "user.npmrc"));
  assert.equal(invocation.options.env.npm_config_globalconfig, path.join(currentConfigRoot, "only-my-pi", "npm-home", "global.npmrc"));
  assert.equal(Object.values(invocation.options.env).some((value) => typeof value === "string" && value.includes("audit.invalid")), false);
  assert.equal((await fs.readFile(path.join(invocation.options.cwd, ".npmrc"), "utf8")).includes("audit.invalid"), false);

  for (const relative of [
    "only-my-pi/npm-home",
    "only-my-pi/npm-cache",
    "only-my-pi/npm-tmp",
    "only-my-pi/npm-prefix",
    "only-my-pi/npm-workspace",
  ]) {
    const stat = await fs.lstat(path.join(currentConfigRoot, relative));
    assert.equal(stat.isDirectory(), true);
    assert.equal(stat.isSymbolicLink(), false);
  }
});

test("real local npm pack/install keeps lifecycle scripts disabled", async (t) => {
  const root = await temporaryRoot(t, "omp-npm-lifecycle-");
  const currentConfigRoot = path.join(root, "config");
  const localFixture = path.join(currentConfigRoot, "local-fixture");
  const packDestination = path.join(currentConfigRoot, "tarballs");
  const installRoot = path.join(currentConfigRoot, "install-root");
  const outside = path.join(root, "outside");
  await fs.mkdir(currentConfigRoot, { recursive: true });
  await fs.mkdir(packDestination, { recursive: true });
  await fs.mkdir(installRoot, { recursive: true });
  await fs.mkdir(outside);
  await fs.cp(maliciousFixture, localFixture, { recursive: true });
  const hostileNpmrc = [
    `cache=${path.join(outside, "cache")}`,
    "ignore-scripts=false",
    "registry=https://ancestor.audit.invalid/",
    "",
  ].join("\n");
  await fs.writeFile(path.join(currentConfigRoot, ".npmrc"), hostileNpmrc, "utf8");
  await fs.writeFile(path.join(packDestination, ".npmrc"), hostileNpmrc, "utf8");
  await fs.writeFile(path.join(installRoot, ".npmrc"), hostileNpmrc, "utf8");

  const run = createNpmCommandRunner({ configRoot: currentConfigRoot });
  if (!(await requireSupportedLocalNpm(t))) return;
  const packed = await run(request([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packDestination,
    "--",
    localFixture,
  ], packDestination));
  assert.equal(packed.exitCode, 0, packed.stderr);
  const records = JSON.parse(packed.stdout);
  assert.equal(Array.isArray(records), true);
  assert.equal(records.length, 1);
  const tarball = path.join(packDestination, records[0].filename);

  const installed = await run(request([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--omit=dev",
    "--omit=peer",
    "--legacy-peer-deps",
    "--package-lock=false",
    "--no-save",
    "--prefix",
    installRoot,
    "--",
    tarball,
  ], installRoot));
  assert.equal(installed.exitCode, 0, installed.stderr);
  const packageRoot = path.join(installRoot, "node_modules", "omp-malicious-lifecycle");
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  assert.equal(typeof manifest.scripts.postinstall, "string");
  await assert.rejects(fs.access(path.join(packageRoot, "LIFECYCLE_RAN")), { code: "ENOENT" });
  assert.deepEqual(await fs.readdir(outside), []);
});
