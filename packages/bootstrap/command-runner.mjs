import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  assertSafeContainedPath,
  atomicWriteText,
  ensureConfigDirectory,
  relativeConfigPath,
} from "../config-runtime/index.mjs";
import { parsePackageSpec } from "../../scripts/lib/package-source.mjs";

const MAX_OUTPUT = 2 * 1024 * 1024;
const MAX_ARGS = 256;
const REQUIRED_ENV_OVERLAY = Object.freeze({
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_ignore_scripts: "true",
  npm_config_update_notifier: "false",
});
const SAFE_NPMRC = [
  "audit=false",
  "fund=false",
  "ignore-scripts=true",
  "registry=https://registry.npmjs.org/",
  "update-notifier=false",
  "",
].join("\n");
const SAFE_WORKSPACE_PACKAGE = `${JSON.stringify({
  name: "only-my-pi-npm-workspace",
  private: true,
  version: "0.0.0",
}, null, 2)}\n`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertContained(root, target, label) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("COMMAND_PATH_ESCAPE", `${label} escapes configRoot`);
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function parseExactPackTarget(target, configRoot) {
  if (path.isAbsolute(target)) {
    assertContained(configRoot, target, "local npm pack target");
    return { kind: "local", path: path.resolve(target) };
  }
  try {
    const source = target.startsWith("git+")
      ? parsePackageSpec(target)
      : parsePackageSpec(`npm:${target}`);
    return { kind: source.type, source };
  } catch (cause) {
    const error = new Error("npm pack target must be an exact governed source or a contained local fixture", { cause });
    error.code = "COMMAND_TARGET_NOT_ALLOWLISTED";
    throw error;
  }
}

function validateNpmArgv(argv, configRoot, cwd) {
  if (argv[0] === "pack") {
    if (
      argv.length !== 7
      || argv[1] !== "--ignore-scripts"
      || argv[2] !== "--json"
      || argv[3] !== "--pack-destination"
      || argv[5] !== "--"
      || !path.isAbsolute(argv[4])
      || !samePath(argv[4], cwd)
    ) {
      fail("COMMAND_ARGV_NOT_ALLOWLISTED", "npm pack request does not match the fixed staging command shape");
    }
    assertContained(configRoot, argv[4], "npm pack destination");
    const target = parseExactPackTarget(argv[6], configRoot);
    return Object.freeze({ operation: "pack", outputDirectory: path.resolve(argv[4]), target });
  }

  const installPrefix = [
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
  ];
  if (
    argv.length < 13
    || installPrefix.some((value, index) => argv[index] !== value)
    || argv[11] !== "--"
    || !path.isAbsolute(argv[10])
    || !samePath(argv[10], cwd)
  ) {
    fail("COMMAND_ARGV_NOT_ALLOWLISTED", "npm install request does not match the fixed staging command shape");
  }
  assertContained(configRoot, argv[10], "npm install prefix");
  const tarballs = argv.slice(12).map((target) => {
    if (!path.isAbsolute(target) || !target.endsWith(".tgz")) {
      fail("COMMAND_ARGV_NOT_ALLOWLISTED", "npm install accepts only absolute contained .tgz inputs");
    }
    assertContained(configRoot, target, "npm install tarball");
    return path.resolve(target);
  });
  return Object.freeze({ operation: "install", outputDirectory: path.resolve(argv[10]), tarballs: Object.freeze(tarballs) });
}

function validateEnvironmentOverlay(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("COMMAND_ENV_NOT_ALLOWLISTED", "npm environment overlay must be the fixed scripts-disabled policy");
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(REQUIRED_ENV_OVERLAY).sort();
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
    || expectedKeys.some((key) => value[key] !== REQUIRED_ENV_OVERLAY[key])
  ) {
    fail("COMMAND_ENV_NOT_ALLOWLISTED", "npm environment overlay cannot widen lifecycle, config, or credential access");
  }
}

function validateRequest(request, configRoot) {
  if (request?.command !== "npm" || request.shell !== false || request.stdio !== "pipe") {
    fail("COMMAND_NOT_ALLOWLISTED", "bootstrap command runner accepts only shell:false npm requests with piped output");
  }
  if (!Array.isArray(request.argv) || request.argv.length === 0 || request.argv.length > MAX_ARGS) fail("INVALID_COMMAND_ARGV", "npm argv is invalid");
  for (const arg of request.argv) {
    if (typeof arg !== "string" || arg.length > 4096 || /\0|[\r\n]/.test(arg)) fail("INVALID_COMMAND_ARGV", "npm argv contains an invalid value");
  }
  if (typeof request.cwd !== "string" || !path.isAbsolute(request.cwd)) fail("INVALID_COMMAND_CWD", "npm cwd must be absolute");
  assertContained(configRoot, request.cwd, "npm cwd");
  validateEnvironmentOverlay(request.envOverlay);
  return validateNpmArgv(request.argv, configRoot, request.cwd);
}

async function lstatOrNull(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function ensureContainedDirectory(configRoot, target) {
  const relative = relativeConfigPath(configRoot, target);
  await ensureConfigDirectory(configRoot, relative, 0o700);
  await assertSafeContainedPath(configRoot, target, { leafType: "directory" });
  return target;
}

async function ensureExactContainedFile(configRoot, target, contents) {
  await assertSafeContainedPath(configRoot, target);
  const existing = await lstatOrNull(target);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      fail("UNSAFE_NPM_RUNTIME_PATH", "isolated npm configuration must be a real file");
    }
    if (await fs.readFile(target, "utf8") !== contents) {
      fail("NPM_RUNTIME_CONFIG_DRIFT", "isolated npm configuration differs from the fixed policy");
    }
  } else {
    await atomicWriteText(configRoot, target, contents, { mode: 0o600, directoryMode: 0o700 });
  }
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
}

async function prepareIsolatedNpmRuntime(configRoot, paths) {
  for (const directory of [
    paths.managedRoot,
    paths.home,
    paths.cache,
    paths.tmp,
    paths.prefix,
    paths.workspace,
  ]) {
    await ensureContainedDirectory(configRoot, directory);
  }
  const files = [
    [paths.userConfig, SAFE_NPMRC],
    [paths.globalConfig, SAFE_NPMRC],
    [paths.projectConfig, SAFE_NPMRC],
    [paths.workspacePackage, SAFE_WORKSPACE_PACKAGE],
  ];
  for (const [target, contents] of files) await ensureExactContainedFile(configRoot, target, contents);
  for (const directory of [
    paths.managedRoot,
    paths.home,
    paths.cache,
    paths.tmp,
    paths.prefix,
    paths.workspace,
  ]) {
    await assertSafeContainedPath(configRoot, directory, { leafType: "directory" });
  }
  for (const [target, contents] of files) await ensureExactContainedFile(configRoot, target, contents);
}

async function assertRegularContainedFile(configRoot, target, label) {
  await assertSafeContainedPath(configRoot, target, { leafType: "file" });
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("UNSAFE_NPM_INPUT_PATH", `${label} must be a real contained file`);
}

async function verifyRequestPaths(configRoot, validation) {
  await assertSafeContainedPath(configRoot, validation.outputDirectory, { leafType: "directory" });
  if (validation.operation === "pack" && validation.target.kind === "local") {
    await assertSafeContainedPath(configRoot, validation.target.path);
    const stat = await fs.lstat(validation.target.path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      fail("UNSAFE_NPM_INPUT_PATH", "local npm pack target must be a real file or directory");
    }
  }
  if (validation.operation === "install") {
    for (const tarball of validation.tarballs) {
      await assertRegularContainedFile(configRoot, tarball, "npm install tarball");
    }
  }
}

function boundedAppend(chunks, chunk, state) {
  if (state.bytes >= MAX_OUTPUT) return;
  const buffer = Buffer.from(chunk);
  const remaining = MAX_OUTPUT - state.bytes;
  chunks.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
  if (buffer.length > remaining) state.truncated = true;
}

/**
 * Create the only production subprocess seam used by package staging. HOME,
 * npm cache, and npmrc are redirected below configRoot so real user npm
 * credentials/config are neither read nor inherited.
 */
export function createNpmCommandRunner({
  configRoot,
  npmCommand = "npm",
  timeoutMs = 120_000,
  spawnImpl = spawn,
} = {}) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("an absolute configRoot is required");
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
  if (typeof npmCommand !== "string" || npmCommand.length === 0 || /[\0\r\n]/u.test(npmCommand)) {
    throw new TypeError("npmCommand must be a bounded executable name or path");
  }
  configRoot = path.resolve(configRoot);
  if (configRoot === path.parse(configRoot).root) throw new TypeError("configRoot must not be a filesystem root");
  const managedRoot = path.join(configRoot, "only-my-pi");
  const runtimePaths = Object.freeze({
    managedRoot,
    home: path.join(managedRoot, "npm-home"),
    cache: path.join(managedRoot, "npm-cache"),
    tmp: path.join(managedRoot, "npm-tmp"),
    prefix: path.join(managedRoot, "npm-prefix"),
    workspace: path.join(managedRoot, "npm-workspace"),
    userConfig: path.join(managedRoot, "npm-home", "user.npmrc"),
    globalConfig: path.join(managedRoot, "npm-home", "global.npmrc"),
    projectConfig: path.join(managedRoot, "npm-workspace", ".npmrc"),
    workspacePackage: path.join(managedRoot, "npm-workspace", "package.json"),
  });

  return async function runNpm(request) {
    const validation = validateRequest(request, configRoot);
    await assertSafeContainedPath(configRoot, request.cwd, { leafType: "directory" });
    await verifyRequestPaths(configRoot, validation);
    await prepareIsolatedNpmRuntime(configRoot, runtimePaths);
    await assertSafeContainedPath(configRoot, request.cwd, { leafType: "directory" });
    await verifyRequestPaths(configRoot, validation);
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: runtimePaths.home,
      TMPDIR: runtimePaths.tmp,
      npm_config_userconfig: runtimePaths.userConfig,
      npm_config_globalconfig: runtimePaths.globalConfig,
      npm_config_cache: runtimePaths.cache,
      npm_config_prefix: runtimePaths.prefix,
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      ...request.envOverlay,
    };
    const stdout = [];
    const stderr = [];
    const stdoutState = { bytes: 0, truncated: false };
    const stderrState = { bytes: 0, truncated: false };
    return await new Promise((resolve, reject) => {
      const child = spawnImpl(npmCommand, request.argv, {
        cwd: runtimePaths.workspace,
        env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      timer.unref?.();
      child.stdout.on("data", (chunk) => boundedAppend(stdout, chunk, stdoutState));
      child.stderr.on("data", (chunk) => boundedAppend(stderr, chunk, stderrState));
      child.once("error", (cause) => {
        clearTimeout(timer);
        const error = new Error("npm staging subprocess could not start", { cause });
        error.code = "NPM_SUBPROCESS_START_FAILED";
        reject(error);
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({
          exitCode: code ?? 1,
          signal: signal ?? null,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          stdoutTruncated: stdoutState.truncated,
          stderrTruncated: stderrState.truncated,
        });
      });
    });
  };
}

export function validateNpmCommandRequest(request, { configRoot }) {
  validateRequest(request, configRoot);
  return true;
}
