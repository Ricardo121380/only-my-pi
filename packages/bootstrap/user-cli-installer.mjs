import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function absoluteNonRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/u.test(value)) fail("CLI_PATH_INVALID", `${label} must be an explicit absolute path`);
  const resolved = path.resolve(value);
  if (resolved === path.parse(resolved).root) fail("CLI_PATH_INVALID", `${label} cannot be a filesystem root`);
  return resolved;
}

function artifactKey(digest) {
  if (typeof digest !== "string" || !SHA256.test(digest)) fail("CLI_ARTIFACT_INVALID", "CLI artifact digest is invalid");
  return digest.slice(7);
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function readJson(target) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("CLI_MANIFEST_INVALID", "CLI install manifest must be a bounded regular file");
  try { return JSON.parse(await fs.readFile(target, "utf8")); } catch (cause) { fail("CLI_MANIFEST_INVALID", "CLI install manifest is invalid JSON", { cause }); }
}

function assertManifest(manifest, expected = {}) {
  if (
    manifest?.formatVersion !== 1
    || manifest.kind !== "only-my-pi-user-cli-artifact"
    || !SHA256.test(manifest.artifactSha256 ?? "")
    || (manifest.sourceCommit !== null && !FULL_SHA.test(manifest.sourceCommit ?? ""))
    || typeof manifest.packageVersion !== "string"
    || manifest.packageVersion.length === 0
    || manifest.packageVersion.length > 64
    || (manifest.installedGenerationId !== null && !SHA256.test(manifest.installedGenerationId ?? ""))
  ) fail("CLI_MANIFEST_INVALID", "CLI install manifest shape is invalid");
  for (const [key, value] of Object.entries(expected)) if (manifest[key] !== value) fail("CLI_ARTIFACT_DRIFT", `CLI artifact ${key} differs from its reviewed identity`);
  return manifest;
}

async function atomicSymlink(directory, name, target) {
  const temporary = path.join(directory, `.${name}.${crypto.randomUUID()}.tmp`);
  await fs.symlink(target, temporary);
  try {
    await fs.rename(temporary, path.join(directory, name));
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function pointer(target) {
  const stat = await lstatOrNull(target);
  if (stat === null) return Object.freeze({ exists: false, target: null });
  if (!stat.isSymbolicLink()) fail("CLI_POINTER_UNSAFE", `${path.basename(target)} must be a symlink`);
  return Object.freeze({ exists: true, target: await fs.readlink(target) });
}

export class UserCliInstaller {
  constructor({ cliRoot, binPath } = {}) {
    this.cliRoot = absoluteNonRoot(cliRoot, "cliRoot");
    this.binPath = absoluteNonRoot(binPath, "binPath");
    this.artifactsRoot = path.join(this.cliRoot, "artifacts");
    this.currentPath = path.join(this.cliRoot, "current");
    this.lkgPath = path.join(this.cliRoot, "lkg");
    this.transactionsRoot = path.join(this.cliRoot, "transactions");
  }

  describe(artifactSha256) {
    const key = artifactKey(artifactSha256);
    return Object.freeze({
      rootType: "USER_LOCAL_IMMUTABLE_ARTIFACT",
      artifactSha256,
      artifactKey: key,
      binType: "USER_LOCAL_STABLE_ENTRY",
    });
  }

  async stage({ packageRoot, artifactSha256, sourceCommit = null, packageVersion } = {}) {
    const source = absoluteNonRoot(packageRoot, "packageRoot");
    if (sourceCommit !== null && !FULL_SHA.test(sourceCommit)) fail("CLI_SOURCE_COMMIT_INVALID", "source commit must be a full lowercase Git SHA or null");
    const key = artifactKey(artifactSha256);
    const artifactRoot = path.join(this.artifactsRoot, key);
    const packageTarget = path.join(artifactRoot, "package");
    const manifestPath = path.join(artifactRoot, "install-manifest.json");
    const existing = await lstatOrNull(artifactRoot);
    if (existing !== null) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) fail("CLI_ARTIFACT_UNSAFE", "existing CLI artifact root is unsafe");
      const manifest = assertManifest(await readJson(manifestPath), { artifactSha256, sourceCommit, packageVersion });
      const bin = await fs.lstat(path.join(packageTarget, "bin", "omp.mjs"));
      if (!bin.isFile() || bin.isSymbolicLink()) fail("CLI_ARTIFACT_DRIFT", "existing CLI artifact executable is unsafe");
      return Object.freeze({ artifactRoot, packageRoot: packageTarget, manifestPath, manifest, reused: true });
    }
    await fs.mkdir(this.artifactsRoot, { recursive: true, mode: 0o700 });
    const stagingRoot = path.join(this.artifactsRoot, `.staging-${key}-${crypto.randomUUID()}`);
    await fs.mkdir(stagingRoot, { mode: 0o700 });
    try {
      await fs.cp(source, path.join(stagingRoot, "package"), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
      const stagedBin = path.join(stagingRoot, "package", "bin", "omp.mjs");
      const bin = await fs.lstat(stagedBin);
      if (!bin.isFile() || bin.isSymbolicLink()) fail("CLI_ARTIFACT_INVALID", "staged CLI executable is unsafe");
      await fs.chmod(stagedBin, 0o755);
      const manifest = assertManifest({
        formatVersion: 1,
        kind: "only-my-pi-user-cli-artifact",
        artifactSha256,
        sourceCommit,
        packageVersion,
        installedGenerationId: null,
      });
      await fs.writeFile(path.join(stagingRoot, "install-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(stagingRoot, artifactRoot);
      return Object.freeze({ artifactRoot, packageRoot: packageTarget, manifestPath, manifest, reused: false });
    } catch (error) {
      await fs.rm(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async bindGeneration(staged, generationId) {
    if (!SHA256.test(generationId ?? "")) fail("CLI_GENERATION_INVALID", "CLI activation requires a canonical generation id");
    const manifest = assertManifest(await readJson(staged.manifestPath), { artifactSha256: staged.manifest.artifactSha256 });
    if (manifest.installedGenerationId !== null && manifest.installedGenerationId !== generationId) {
      fail("CLI_GENERATION_DRIFT", "CLI artifact is already bound to a different generation");
    }
    if (manifest.installedGenerationId === generationId) return Object.freeze({ ...staged, manifest });
    const updated = Object.freeze({ ...manifest, installedGenerationId: generationId });
    const temporary = `${staged.manifestPath}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, staged.manifestPath);
    return Object.freeze({ ...staged, manifest: updated });
  }

  async snapshot() {
    return Object.freeze({
      current: await pointer(this.currentPath),
      lkg: await pointer(this.lkgPath),
      bin: await pointer(this.binPath),
    });
  }

  async restore(snapshot) {
    await fs.mkdir(this.cliRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.dirname(this.binPath), { recursive: true, mode: 0o700 });
    for (const [target, prior] of [[this.currentPath, snapshot.current], [this.lkgPath, snapshot.lkg], [this.binPath, snapshot.bin]]) {
      if (prior.exists) await atomicSymlink(path.dirname(target), path.basename(target), prior.target);
      else await fs.rm(target, { force: true });
    }
  }

  async recordTransactionSnapshot(transactionId, snapshot) {
    if (typeof transactionId !== "string" || !/^[0-9a-f-]{36}$/u.test(transactionId)) fail("CLI_TRANSACTION_INVALID", "CLI transaction id is invalid");
    await fs.mkdir(this.transactionsRoot, { recursive: true, mode: 0o700 });
    const target = path.join(this.transactionsRoot, `${transactionId}.json`);
    const existing = await lstatOrNull(target);
    if (existing !== null) {
      const recorded = await readJson(target);
      if (JSON.stringify(recorded) !== JSON.stringify(snapshot)) fail("CLI_TRANSACTION_DRIFT", "CLI transaction snapshot differs from the recorded state");
      return recorded;
    }
    await fs.writeFile(target, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return snapshot;
  }

  async restoreTransaction(transactionId) {
    if (typeof transactionId !== "string" || !/^[0-9a-f-]{36}$/u.test(transactionId)) fail("CLI_TRANSACTION_INVALID", "CLI transaction id is invalid");
    const target = path.join(this.transactionsRoot, `${transactionId}.json`);
    const stat = await lstatOrNull(target);
    if (stat === null) return Object.freeze({ restored: false, status: "CLI_TRANSACTION_SNAPSHOT_NOT_FOUND" });
    const snapshot = await readJson(target);
    await this.restore(snapshot);
    return Object.freeze({ restored: true, status: "CLI_POINTERS_RESTORED" });
  }

  async deactivate() {
    const snapshot = await this.snapshot();
    try {
      await fs.rm(this.binPath, { force: true });
      await fs.rm(this.currentPath, { force: true });
      await fs.rm(this.lkgPath, { force: true });
      return Object.freeze({ status: "CLI_DEACTIVATED", snapshot });
    } catch (cause) {
      await this.restore(snapshot);
      fail("CLI_DEACTIVATION_FAILED", "user CLI deactivation failed and its prior pointers were restored", { cause });
    }
  }

  async activate(staged) {
    const manifest = assertManifest(await readJson(staged.manifestPath), { artifactSha256: staged.manifest.artifactSha256 });
    if (manifest.installedGenerationId === null) fail("CLI_GENERATION_INVALID", "CLI artifact must be generation-bound before activation");
    const snapshot = await this.snapshot();
    await fs.mkdir(this.cliRoot, { recursive: true, mode: 0o700 });
    await fs.mkdir(path.dirname(this.binPath), { recursive: true, mode: 0o700 });
    const artifactTarget = path.relative(this.cliRoot, staged.artifactRoot);
    const binTarget = path.relative(path.dirname(this.binPath), path.join(this.currentPath, "package", "bin", "omp.mjs"));
    try {
      if (snapshot.current.exists && snapshot.current.target !== artifactTarget) {
        await atomicSymlink(this.cliRoot, "lkg", snapshot.current.target);
      }
      await atomicSymlink(this.cliRoot, "current", artifactTarget);
      await atomicSymlink(path.dirname(this.binPath), path.basename(this.binPath), binTarget);
      return Object.freeze({
        status: snapshot.current.exists && snapshot.current.target === artifactTarget ? "CLI_ALREADY_ACTIVE" : "CLI_ACTIVATED",
        artifactSha256: manifest.artifactSha256,
        sourceCommit: manifest.sourceCommit,
        installedGenerationId: manifest.installedGenerationId,
        rootType: "USER_LOCAL_IMMUTABLE_ARTIFACT",
        snapshot,
      });
    } catch (cause) {
      await this.restore(snapshot);
      fail("CLI_ACTIVATION_FAILED", "user CLI activation failed and its prior pointers were restored", { cause });
    }
  }

  async inspectActive() {
    const current = await pointer(this.currentPath);
    if (!current.exists) return null;
    const artifactRoot = path.resolve(this.cliRoot, current.target);
    const relative = path.relative(this.artifactsRoot, artifactRoot);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) fail("CLI_POINTER_UNSAFE", "current CLI pointer escapes the artifact store");
    const manifest = assertManifest(await readJson(path.join(artifactRoot, "install-manifest.json")));
    if (relative !== artifactKey(manifest.artifactSha256)) fail("CLI_ARTIFACT_DRIFT", "current CLI pointer does not match the artifact digest");
    return Object.freeze({ artifactRoot, packageRoot: path.join(artifactRoot, "package"), manifest });
  }
}

export function createUserCliInstaller(options) {
  return new UserCliInstaller(options);
}
