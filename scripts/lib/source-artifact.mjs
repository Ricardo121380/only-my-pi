import crypto from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function absoluteNonRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) fail("SOURCE_ARTIFACT_PATH_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("SOURCE_ARTIFACT_PATH_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (cause) {
    fail("SOURCE_ARTIFACT_COMMAND_FAILED", `${path.basename(command)} failed while building the source artifact`, { cause });
  }
}

async function privateEnvironment(temporaryRoot) {
  const cache = path.join(temporaryRoot, "npm-cache");
  const userconfig = path.join(temporaryRoot, "user.npmrc");
  const globalconfig = path.join(temporaryRoot, "global.npmrc");
  await fs.mkdir(cache, { mode: 0o700 });
  const npmrc = "audit=false\nfund=false\nignore-scripts=true\nupdate-notifier=false\n";
  await Promise.all([
    fs.writeFile(userconfig, npmrc, { mode: 0o600, flag: "wx" }),
    fs.writeFile(globalconfig, npmrc, { mode: 0o600, flag: "wx" }),
  ]);
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: temporaryRoot,
    TMPDIR: temporaryRoot,
    LC_ALL: "C",
    NO_COLOR: "1",
    npm_config_cache: cache,
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

export async function buildCommitPinnedSourceArtifact({ rootDir, sourceCommit, output } = {}) {
  const root = absoluteNonRoot(rootDir, "rootDir");
  const target = absoluteNonRoot(output, "output");
  if (!FULL_SHA.test(sourceCommit ?? "")) fail("SOURCE_ARTIFACT_COMMIT_INVALID", "sourceCommit must be a full lowercase Git SHA");
  const outputState = await fs.lstat(target).then(() => "exists", (error) => error?.code === "ENOENT" ? "missing" : Promise.reject(error));
  if (outputState !== "missing") fail("SOURCE_ARTIFACT_OUTPUT_EXISTS", "source artifact output must not already exist");
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-source-artifact-"));
  await fs.chmod(temporaryRoot, 0o700);
  try {
    const env = await privateEnvironment(temporaryRoot);
    const packed = await run("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot], { cwd: root, env });
    let result;
    try { result = JSON.parse(packed.stdout); }
    catch { fail("SOURCE_ARTIFACT_PACK_INVALID", "npm pack did not return JSON"); }
    if (!Array.isArray(result) || result.length !== 1 || typeof result[0].filename !== "string") fail("SOURCE_ARTIFACT_PACK_INVALID", "npm pack returned an invalid artifact descriptor");
    const raw = path.join(temporaryRoot, result[0].filename);
    const extracted = path.join(temporaryRoot, "extracted");
    await fs.mkdir(extracted, { mode: 0o700 });
    await run("tar", ["-xzf", raw, "-C", extracted], { cwd: temporaryRoot, env });
    const packageRoot = path.join(extracted, "package");
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== "only-my-pi" || typeof manifest.version !== "string") fail("SOURCE_ARTIFACT_PACKAGE_INVALID", "packed artifact does not contain only-my-pi");
    await fs.writeFile(path.join(packageRoot, "artifact-identity.json"), `${JSON.stringify({
      formatVersion: 1,
      kind: "only-my-pi-source-identity",
      sourceCommit,
    }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    const temporaryOutput = path.join(temporaryRoot, "only-my-pi-commit-pinned.tgz");
    await run("tar", ["-czf", temporaryOutput, "-C", extracted, "package"], { cwd: temporaryRoot, env });
    const bytes = await fs.readFile(temporaryOutput);
    const sha256 = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
    await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
    return Object.freeze({
      formatVersion: 1,
      kind: "only-my-pi-commit-pinned-source-artifact",
      sourceCommit,
      packageVersion: manifest.version,
      bytes: bytes.length,
      sha256,
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}
