import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const FORMAT_VERSION = 1;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const PROFILE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function digestValue(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function digestBytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function assertAbsoluteSafePath(value, label, { tarball = false } = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) {
    fail("ARTIFACT_PATH_INVALID", `${label} must be an explicit absolute path`);
  }
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("ARTIFACT_PATH_INVALID", `${label} cannot be a filesystem root`);
  if (tarball && !resolved.endsWith(".tgz")) fail("ARTIFACT_PATH_INVALID", `${label} must end in .tgz`);
  return resolved;
}

function assertProfileId(value) {
  if (typeof value !== "string" || !PROFILE_ID.test(value)) fail("ARTIFACT_PROFILE_INVALID", "artifact profile id is invalid");
  return value;
}

function fileIdentity(stat) {
  const mtimeNs = stat.mtimeNs ?? BigInt(Math.trunc(Number(stat.mtimeMs) * 1_000_000));
  const ctimeNs = stat.ctimeNs ?? BigInt(Math.trunc(Number(stat.ctimeMs) * 1_000_000));
  return Object.freeze({
    device: String(stat.dev),
    inode: String(stat.ino),
    size: String(stat.size),
    mtimeNs: String(mtimeNs),
    ctimeNs: String(ctimeNs),
  });
}

function sameIdentity(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function readVerifiedArtifact(artifactPath, { maxArtifactBytes = MAX_ARTIFACT_BYTES } = {}) {
  let handle;
  try {
    handle = await fs.open(artifactPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  } catch (cause) {
    if (cause?.code === "ELOOP") fail("ARTIFACT_SYMLINK_REJECTED", "artifact path must not be a symlink");
    fail("ARTIFACT_OPEN_FAILED", "artifact tarball could not be opened", { cause });
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) fail("ARTIFACT_NOT_REGULAR", "artifact tarball must be a regular file");
    if (before.size <= 0n || before.size > BigInt(maxArtifactBytes)) {
      fail("ARTIFACT_SIZE_INVALID", `artifact tarball must be between 1 and ${maxArtifactBytes} bytes`);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const beforeIdentity = fileIdentity(before);
    const afterIdentity = fileIdentity(after);
    if (!sameIdentity(beforeIdentity, afterIdentity) || BigInt(bytes.length) !== after.size) {
      fail("ARTIFACT_CHANGED_DURING_READ", "artifact tarball changed while it was being verified");
    }
    return Object.freeze({
      bytes,
      descriptor: Object.freeze({
        path: artifactPath,
        bytes: bytes.length,
        sha256: digestBytes(bytes),
        identity: afterIdentity,
      }),
    });
  } finally {
    await handle.close();
  }
}

function boundedAppend(state, chunk) {
  const buffer = Buffer.from(chunk);
  if (state.bytes >= MAX_OUTPUT_BYTES) {
    state.truncated = true;
    return;
  }
  const remaining = MAX_OUTPUT_BYTES - state.bytes;
  state.parts.push(buffer.subarray(0, remaining));
  state.bytes += Math.min(buffer.length, remaining);
  if (buffer.length > remaining) state.truncated = true;
}

export function createArtifactProcessRunner({ spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof spawnImpl !== "function") throw new TypeError("spawnImpl must be a function");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30 * 60 * 1000) {
    throw new TypeError("timeoutMs must be between 1000 and 1800000 milliseconds");
  }
  return async function runCommand(command, argv, { cwd, env, label } = {}) {
    if (typeof command !== "string" || command.length === 0 || /[\0\r\n]/u.test(command)) fail("ARTIFACT_COMMAND_INVALID", "artifact subprocess command is invalid");
    if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string" || entry.length > 4096 || /[\0\r\n]/u.test(entry))) {
      fail("ARTIFACT_COMMAND_INVALID", "artifact subprocess argv is invalid");
    }
    if (typeof cwd !== "string" || !path.isAbsolute(cwd)) fail("ARTIFACT_COMMAND_INVALID", "artifact subprocess cwd must be absolute");
    const stdout = { parts: [], bytes: 0, truncated: false };
    const stderr = { parts: [], bytes: 0, truncated: false };
    return await new Promise((resolve, reject) => {
      let settled = false;
      let child;
      let timer;
      const finishError = (cause, code = "ARTIFACT_SUBPROCESS_START_FAILED") => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = new Error(`${label ?? "artifact"} subprocess failed to start`, { cause });
        error.code = code;
        reject(error);
      };
      try {
        child = spawnImpl(command, argv, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      } catch (cause) {
        finishError(cause);
        return;
      }
      timer = setTimeout(() => {
        child.kill?.("SIGTERM");
        finishError(new Error("subprocess timed out"), "ARTIFACT_SUBPROCESS_TIMEOUT");
      }, timeoutMs);
      timer.unref?.();
      child.stdout?.on("data", (chunk) => boundedAppend(stdout, chunk));
      child.stderr?.on("data", (chunk) => boundedAppend(stderr, chunk));
      child.once("error", (cause) => finishError(cause));
      child.once("exit", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(Object.freeze({
          exitCode: exitCode ?? 1,
          signal: signal ?? null,
          stdout: Buffer.concat(stdout.parts).toString("utf8"),
          stderr: Buffer.concat(stderr.parts).toString("utf8"),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
        }));
      });
    });
  };
}

function safeEnvironment({ runtimeRoot, npmCache }) {
  const home = path.join(runtimeRoot, "home");
  const tmp = path.join(runtimeRoot, "tmp");
  const userNpmrc = path.join(runtimeRoot, "user.npmrc");
  const globalNpmrc = path.join(runtimeRoot, "global.npmrc");
  return Object.freeze({
    paths: Object.freeze({ home, tmp, userNpmrc, globalNpmrc }),
    env: Object.freeze({
      PATH: process.env.PATH ?? "",
      HOME: home,
      TMPDIR: tmp,
      XDG_CACHE_HOME: path.join(runtimeRoot, "xdg-cache"),
      XDG_CONFIG_HOME: path.join(runtimeRoot, "xdg-config"),
      XDG_DATA_HOME: path.join(runtimeRoot, "xdg-data"),
      NO_COLOR: "1",
      TERM: "dumb",
      npm_config_userconfig: userNpmrc,
      npm_config_globalconfig: globalNpmrc,
      npm_config_cache: npmCache,
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    }),
  });
}

async function prepareRuntime(runtimeRoot, paths) {
  await Promise.all([
    paths.home,
    paths.tmp,
    path.join(runtimeRoot, "xdg-cache"),
    path.join(runtimeRoot, "xdg-config"),
    path.join(runtimeRoot, "xdg-data"),
  ].map((target) => fs.mkdir(target, { recursive: true, mode: 0o700 })));
  const npmrc = "audit=false\nfund=false\nignore-scripts=true\nupdate-notifier=false\n";
  await Promise.all([
    fs.writeFile(paths.userNpmrc, npmrc, { mode: 0o600, flag: "wx" }),
    fs.writeFile(paths.globalNpmrc, npmrc, { mode: 0o600, flag: "wx" }),
  ]);
}

async function assertInstalledPackage(installRoot) {
  const packageRoot = path.join(installRoot, "node_modules", "only-my-pi");
  const manifestPath = path.join(packageRoot, "package.json");
  const binPath = path.join(packageRoot, "bin", "omp.mjs");
  const installRootReal = await fs.realpath(installRoot);
  for (const [target, kind] of [[packageRoot, "directory"], [manifestPath, "file"], [binPath, "file"]]) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) {
      fail("ARTIFACT_PACKAGE_INVALID", `installed artifact ${kind} is unsafe`);
    }
    const real = await fs.realpath(target);
    const relative = path.relative(installRootReal, real);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("ARTIFACT_PACKAGE_ESCAPE", "installed artifact escapes its isolated root");
  }
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (cause) {
    fail("ARTIFACT_PACKAGE_INVALID", "installed artifact manifest is invalid", { cause });
  }
  if (manifest?.name !== "only-my-pi" || typeof manifest?.version !== "string" || manifest.version.length > 64) {
    fail("ARTIFACT_PACKAGE_INVALID", "artifact must install package only-my-pi with a bounded version");
  }
  return Object.freeze({ packageRoot, binPath, name: manifest.name, version: manifest.version });
}

function parseNestedReceipt(result) {
  if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated) {
    fail("ARTIFACT_APPLY_FAILED", "artifact-contained omp process did not complete successfully", {
      exitCode: result.exitCode,
      signal: result.signal,
      stdoutSha256: digestBytes(result.stdout),
      stderrSha256: digestBytes(result.stderr),
      outputTruncated: result.stdoutTruncated || result.stderrTruncated,
    });
  }
  let receipt;
  try {
    receipt = JSON.parse(result.stdout.trim());
  } catch (cause) {
    fail("ARTIFACT_RECEIPT_INVALID", "artifact-contained omp process did not return one JSON receipt", { cause });
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || receipt.ok === false) {
    fail("ARTIFACT_RECEIPT_INVALID", "artifact-contained omp returned an unsuccessful receipt");
  }
  return receipt;
}

function assertPlanShape(plan, expected) {
  if (
    plan?.formatVersion !== FORMAT_VERSION
    || plan?.kind !== "only-my-pi-artifact-install-plan"
    || plan?.operation !== expected.operation
    || plan?.profileId !== expected.profileId
    || plan?.configRoot !== expected.configRoot
    || !SHA256.test(plan?.artifact?.sha256 ?? "")
  ) {
    fail("ARTIFACT_PLAN_INVALID", "artifact install plan is malformed or belongs to another request");
  }
  const unsigned = { ...plan };
  delete unsigned.planDigest;
  if (plan.planDigest !== digestValue(unsigned)) fail("ARTIFACT_PLAN_DRIFT", "artifact install plan digest is invalid");
}

export class ArtifactInstaller {
  constructor({
    runCommand = createArtifactProcessRunner(),
    npmCommand = "npm",
    nodeCommand = process.execPath,
    temporaryRoot = os.tmpdir(),
    npmCache = process.env.npm_config_cache ?? path.join(os.homedir(), ".npm"),
    maxArtifactBytes = MAX_ARTIFACT_BYTES,
  } = {}) {
    if (typeof runCommand !== "function") throw new TypeError("runCommand must be a function");
    if (![npmCommand, nodeCommand].every((value) => typeof value === "string" && value.length > 0 && !/[\0\r\n]/u.test(value))) {
      throw new TypeError("artifact installer commands must be bounded strings");
    }
    this.runCommand = runCommand;
    this.npmCommand = npmCommand;
    this.nodeCommand = nodeCommand;
    this.temporaryRoot = assertAbsoluteSafePath(temporaryRoot, "temporaryRoot");
    this.npmCache = assertAbsoluteSafePath(npmCache, "npmCache");
    this.maxArtifactBytes = maxArtifactBytes;
  }

  async plan({ operation = "install", artifact, profile = "daily", configRoot } = {}) {
    if (!new Set(["install", "update"]).has(operation)) fail("ARTIFACT_OPERATION_INVALID", "artifact operation must be install or update");
    const artifactPath = assertAbsoluteSafePath(artifact, "artifact", { tarball: true });
    const resolvedConfigRoot = assertAbsoluteSafePath(configRoot, "configRoot");
    const profileId = assertProfileId(profile ?? "daily");
    const verified = await readVerifiedArtifact(artifactPath, { maxArtifactBytes: this.maxArtifactBytes });
    const plan = {
      formatVersion: FORMAT_VERSION,
      kind: "only-my-pi-artifact-install-plan",
      ok: true,
      status: "ARTIFACT_INSTALL_PLAN",
      mutation: false,
      operation,
      artifact: verified.descriptor,
      profileId,
      configRoot: resolvedConfigRoot,
      execution: Object.freeze({ lifecycleScripts: "DISABLED", network: "OFFLINE_CACHE_ONLY", nestedCommand: "bootstrap" }),
      zeroWriteEvidence: Object.freeze({ writes: 0, subprocesses: 0, providerRequests: 0 }),
    };
    return Object.freeze({ ...plan, planDigest: digestValue(plan) });
  }

  async apply({ operation = "install", artifact, profile = "daily", configRoot, plan } = {}) {
    const artifactPath = assertAbsoluteSafePath(artifact, "artifact", { tarball: true });
    const resolvedConfigRoot = assertAbsoluteSafePath(configRoot, "configRoot");
    const profileId = assertProfileId(profile ?? "daily");
    assertPlanShape(plan, { operation, profileId, configRoot: resolvedConfigRoot });
    const verified = await readVerifiedArtifact(artifactPath, { maxArtifactBytes: this.maxArtifactBytes });
    if (verified.descriptor.sha256 !== plan.artifact.sha256 || !sameIdentity(verified.descriptor.identity, plan.artifact.identity)) {
      fail("ARTIFACT_CHANGED_AFTER_PLAN", "artifact tarball changed after the reviewed plan was created");
    }
    const runtimeRoot = await fs.mkdtemp(path.join(this.temporaryRoot, "only-my-pi-artifact-"));
    await fs.chmod(runtimeRoot, 0o700);
    try {
      const artifactCopy = path.join(runtimeRoot, "only-my-pi.tgz");
      const installRoot = path.join(runtimeRoot, "install");
      await fs.writeFile(artifactCopy, verified.bytes, { mode: 0o600, flag: "wx" });
      await fs.mkdir(installRoot, { mode: 0o700 });
      const runtime = safeEnvironment({ runtimeRoot, npmCache: this.npmCache });
      await prepareRuntime(runtimeRoot, runtime.paths);
      const npmResult = await this.runCommand(this.npmCommand, [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--omit=dev",
        "--omit=peer",
        "--legacy-peer-deps",
        "--package-lock=false",
        "--no-save",
        "--offline",
        "--prefix",
        installRoot,
        "--",
        artifactCopy,
      ], { cwd: runtimeRoot, env: runtime.env, label: "artifact extraction" });
      if (npmResult.exitCode !== 0 || npmResult.stdoutTruncated || npmResult.stderrTruncated) {
        fail("ARTIFACT_EXTRACTION_FAILED", "scripts-disabled offline artifact extraction failed", {
          exitCode: npmResult.exitCode,
          signal: npmResult.signal,
          stdoutSha256: digestBytes(npmResult.stdout),
          stderrSha256: digestBytes(npmResult.stderr),
          outputTruncated: npmResult.stdoutTruncated || npmResult.stderrTruncated,
        });
      }
      const installed = await assertInstalledPackage(installRoot);
      const nestedArgs = [installed.binPath, "bootstrap", "--profile", profileId];
      nestedArgs.push("--config-root", resolvedConfigRoot, "--apply", "--yes", "--json");
      const nestedResult = await this.runCommand(this.nodeCommand, nestedArgs, {
        cwd: installed.packageRoot,
        env: runtime.env,
        label: "artifact-contained omp",
      });
      const receipt = parseNestedReceipt(nestedResult);
      return Object.freeze({
        ok: true,
        status: "ARTIFACT_APPLIED",
        mutation: true,
        operation,
        configRoot: resolvedConfigRoot,
        profileId,
        artifact: Object.freeze({ path: artifactPath, bytes: verified.descriptor.bytes, sha256: verified.descriptor.sha256, packageName: installed.name, packageVersion: installed.version }),
        planDigest: plan.planDigest,
        receipt,
      });
    } finally {
      await fs.rm(runtimeRoot, { recursive: true, force: true });
    }
  }
}

export function createArtifactInstaller(options = {}) {
  return new ArtifactInstaller(options);
}
