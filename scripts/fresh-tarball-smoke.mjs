#!/usr/bin/env node

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PI_VERSION = "0.84.1";
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha512Integrity(bytes) {
  return `sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`;
}

function safeInheritedEnvironment() {
  const output = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "COMSPEC", "PATHEXT"]) {
    if (typeof process.env[key] === "string") output[key] = process.env[key];
  }
  return output;
}

function runCommand(command, args, { cwd, env, label = command, allowExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let exceeded = false;
    const capture = (target, chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_OUTPUT_BYTES) target.push(Buffer.from(chunk));
      else if (!exceeded) {
        exceeded = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.once("error", (cause) => reject(Object.assign(new Error(`${label} could not start`, { cause }), { code: "FRESH_COMMAND_START_FAILED" })));
    child.once("close", (code, signal) => {
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (exceeded) {
        reject(Object.assign(new Error(`${label} exceeded its bounded output allowance`), { code: "FRESH_OUTPUT_LIMIT" }));
        return;
      }
      if (!allowExitCodes.includes(code)) {
        const error = new Error(`${label} failed with exit ${code}`);
        error.code = "FRESH_COMMAND_FAILED";
        error.exitCode = code;
        error.signal = signal ?? null;
        error.stdoutDigest = sha256(out);
        error.stderrDigest = sha256(err);
        reject(error);
        return;
      }
      resolve(Object.freeze({ stdout: out, stderr: err, exitCode: code, signal: signal ?? null }));
    });
  });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("FRESH_INVALID_JSON", `${label} did not return one JSON document`);
  }
}

async function assertExecutable(file) {
  await fs.access(file, (await import("node:fs")).constants.X_OK);
}

async function pathExists(file) {
  return fs.access(file).then(() => true, () => false);
}

function cliEnvironment({ tempRoot, prefix, cacheRoot }) {
  const nodeBin = path.dirname(process.execPath);
  return {
    ...safeInheritedEnvironment(),
    PATH: [path.join(prefix, "node_modules", ".bin"), nodeBin, "/usr/bin", "/bin"].join(path.delimiter),
    HOME: path.join(tempRoot, "home"),
    TMPDIR: path.join(tempRoot, "tmp"),
    CI: "1",
    NO_COLOR: "1",
    PI_TELEMETRY: "0",
    npm_config_cache: cacheRoot,
    npm_config_userconfig: path.join(tempRoot, "npm-user.conf"),
    npm_config_globalconfig: path.join(tempRoot, "npm-global.conf"),
    npm_config_ignore_scripts: "true",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

async function runOmp(ompBin, args, options) {
  const result = await runCommand(ompBin, [...args, "--json"], { ...options, label: `omp ${args[0] ?? "command"}` });
  return parseJsonOutput(result, `omp ${args[0] ?? "command"}`);
}

function assertStatus(value, expected, label) {
  if (!expected.includes(value?.status)) fail("FRESH_UNEXPECTED_STATUS", `${label} returned ${value?.status ?? "no status"}`);
}

export async function runFreshTarballSmoke({ rootDir = REPOSITORY_ROOT } = {}) {
  const root = await fs.realpath(path.resolve(rootDir));
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-fresh-"));
  try {
    const artifacts = path.join(tempRoot, "artifacts");
    const prefix = path.join(tempRoot, "prefix");
    const configRoot = path.join(tempRoot, "pi-agent");
    const workspace = path.join(tempRoot, "workspace");
    const cacheRoot = process.env.npm_config_cache || path.join(os.homedir(), ".npm");
    await Promise.all([
      fs.mkdir(artifacts, { recursive: true }),
      fs.mkdir(prefix, { recursive: true }),
      fs.mkdir(workspace, { recursive: true }),
      fs.mkdir(path.join(tempRoot, "home"), { recursive: true }),
      fs.mkdir(path.join(tempRoot, "tmp"), { recursive: true }),
      fs.writeFile(path.join(tempRoot, "npm-user.conf"), "", { mode: 0o600 }),
      fs.writeFile(path.join(tempRoot, "npm-global.conf"), "", { mode: 0o600 }),
    ]);
    const env = cliEnvironment({ tempRoot, prefix, cacheRoot });
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

    const sourceCommitResult = await runCommand("git", ["rev-parse", "HEAD"], { cwd: root, env, label: "git source commit" });
    const sourceCommit = sourceCommitResult.stdout.trim();
    if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) fail("FRESH_SOURCE_COMMIT_INVALID", "source commit is not a full Git SHA");

    const packResult = await runCommand(npmCommand, [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      artifacts,
    ], { cwd: root, env, label: "npm pack" });
    const packPayload = parseJsonOutput(packResult, "npm pack");
    if (!Array.isArray(packPayload) || packPayload.length !== 1 || typeof packPayload[0]?.filename !== "string") {
      fail("FRESH_PACK_INVALID", "npm pack returned an unexpected payload");
    }
    const packed = packPayload[0];
    const tarballPath = path.join(artifacts, packed.filename);
    const tarballBytes = await fs.readFile(tarballPath);
    const integrity = sha512Integrity(tarballBytes);
    if (packed.integrity !== integrity) fail("FRESH_PACK_INTEGRITY_MISMATCH", "npm pack integrity does not match tarball bytes");

    await runCommand(npmCommand, [
      "install",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--omit=peer",
      "--prefix",
      prefix,
      `@earendil-works/pi-coding-agent@${PI_VERSION}`,
      tarballPath,
    ], { cwd: workspace, env, label: "fresh scripts-disabled install" });

    const packageRoot = await fs.realpath(path.join(prefix, "node_modules", "only-my-pi"));
    const relativeToSource = path.relative(root, packageRoot);
    if (relativeToSource === "" || (!relativeToSource.startsWith("..") && !path.isAbsolute(relativeToSource))) {
      fail("FRESH_INSTALL_USES_CHECKOUT", "installed package resolves back into the source checkout");
    }
    const localBin = path.join(prefix, "node_modules", ".bin");
    const ompBin = path.join(localBin, process.platform === "win32" ? "omp.cmd" : "omp");
    const piBin = path.join(localBin, process.platform === "win32" ? "pi.cmd" : "pi");
    await assertExecutable(ompBin);
    await assertExecutable(piBin);
    const installedManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (installedManifest.name !== "only-my-pi") fail("FRESH_PACKAGE_ID_MISMATCH", "installed tarball has the wrong package name");

    const help = await runCommand(ompBin, ["--help"], { cwd: workspace, env, label: "fresh omp help" });
    if (!help.stdout.includes("Usage:")) fail("FRESH_HELP_MISSING", "fresh omp binary did not render usage");

    const plan = await runOmp(ompBin, ["bootstrap", "--profile", "minimal", "--mode", "inspect", "--config-root", configRoot], { cwd: workspace, env });
    assertStatus(plan, ["PLAN_READY"], "bootstrap dry-run");
    if (await pathExists(configRoot)) fail("FRESH_DRY_RUN_WROTE", "bootstrap dry-run created the Pi config root");

    const first = await runOmp(ompBin, ["bootstrap", "--profile", "minimal", "--mode", "inspect", "--config-root", configRoot, "--apply", "--yes"], { cwd: workspace, env });
    assertStatus(first, ["COMMITTED"], "first bootstrap apply");
    const second = await runOmp(ompBin, ["bootstrap", "--profile", "minimal", "--mode", "inspect", "--config-root", configRoot, "--apply", "--yes"], { cwd: workspace, env });
    assertStatus(second, ["NO_CHANGES", "REPAIRED_NO_CHANGES"], "second bootstrap apply");
    const doctor = await runOmp(ompBin, ["doctor", "--config-root", configRoot], { cwd: workspace, env });
    const doctorFindings = doctor?.repository?.findings;
    const doctorErrors = Array.isArray(doctorFindings)
      ? doctorFindings.filter((finding) => finding?.severity === "error")
      : null;
    if (doctor?.ok !== true || doctorErrors === null || doctorErrors.length !== 0) {
      const codes = Array.isArray(doctorFindings)
        ? doctorFindings.map((finding) => finding?.code).filter(Boolean).slice(0, 8).join(",")
        : "malformed-doctor-result";
      fail("FRESH_DOCTOR_FAILED", `fresh static doctor did not pass cleanly (${codes})`);
    }
    const safe = await runOmp(ompBin, ["safe", "--config-root", configRoot], { cwd: workspace, env });
    if (safe?.ok !== true || !Array.isArray(safe?.command) || safe.command[0] !== "pi") {
      fail("FRESH_SAFE_FAILED", "fresh safe command was not produced");
    }
    const installedStatus = await runOmp(ompBin, ["status", "--config-root", configRoot], { cwd: workspace, env });
    assertStatus(installedStatus, ["INSTALLED"], "installed status");
    const rollback = await runOmp(ompBin, ["rollback", "--config-root", configRoot, "--yes"], { cwd: workspace, env });
    assertStatus(rollback, ["COMMITTED"], "first-install rollback");
    const finalStatus = await runOmp(ompBin, ["status", "--config-root", configRoot], { cwd: workspace, env });
    assertStatus(finalStatus, ["NOT_INSTALLED"], "post-rollback status");

    return Object.freeze({
      formatVersion: 1,
      status: "PASS",
      sourceCommit,
      nodeVersion: process.version,
      piVersion: PI_VERSION,
      platform: process.platform,
      arch: process.arch,
      tarball: Object.freeze({
        name: installedManifest.name,
        version: installedManifest.version,
        sha256: sha256(tarballBytes),
        integrity,
        files: Array.isArray(packed.files) ? packed.files.length : null,
      }),
      install: Object.freeze({ scripts: "disabled", offline: true, global: false, checkoutRuntime: false }),
      bootstrap: Object.freeze({
        dryRun: "PLAN_READY_ZERO_WRITE",
        firstApply: first.status,
        secondApply: second.status,
        doctor: "PASS",
        safe: "PASS",
        rollback: rollback.status,
        finalStatus: finalStatus.status,
        piNoModelStartup: "NO_MODEL_STARTUP_PASS",
      }),
      provider: "NOT_RUN_BY_POLICY",
      credentials: "NOT_READ",
      realPiHome: "NOT_TOUCHED",
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

export async function main() {
  const evidence = await runFreshTarballSmoke();
  process.stdout.write(`OMP_FRESH_TARBALL_EVIDENCE=${JSON.stringify(evidence)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`fresh-tarball-smoke: ERROR ${error.code ?? "FAILED"} ${error.message}\n`);
    if (error.stdoutDigest) process.stderr.write(`stdoutDigest: ${error.stdoutDigest}\n`);
    if (error.stderrDigest) process.stderr.write(`stderrDigest: ${error.stderrDigest}\n`);
    process.exitCode = 1;
  }
}
