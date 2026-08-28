import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import { canonicalJson, loadSettings, verifyLastKnownGood } from "../config-runtime/index.mjs";
import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { verifyRecordedExternalBindings } from "../bootstrap/package-bindings.mjs";
import { parsePackageSpec } from "../../scripts/lib/package-source.mjs";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "prepack", "postpack"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("MIGRATION_LOCK_DRIFT", "package lock resolved URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("MIGRATION_LOCK_DRIFT", "package lock resolved URL must be credential-free HTTPS");
  }
  return digestBytes(Buffer.from(url.href));
}

function lifecycleEvidence(packageManifest) {
  const scripts = packageManifest?.scripts ?? {};
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) fail("MIGRATION_PACKAGE_LIFECYCLE_DRIFT", "package scripts must be an object");
  return Object.entries(scripts)
    .filter(([name]) => LIFECYCLE_NAMES.has(name))
    .map(([name, command]) => {
      if (typeof command !== "string") fail("MIGRATION_PACKAGE_LIFECYCLE_DRIFT", `lifecycle script ${name} must be a string`);
      return { name, commandSha256: digestBytes(Buffer.from(command)), necessity: "not-required" };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function readRegularJson(filename, label) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_JSON_BYTES)) fail("MIGRATION_EVIDENCE_INVALID", `${label} must be a bounded regular file`);
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || BigInt(bytes.length) !== after.size) {
      fail("MIGRATION_EVIDENCE_DRIFT", `${label} changed while being read`);
    }
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("MIGRATION_EVIDENCE_INVALID", `${label} is not valid JSON`); }
    return { value, digest: digestBytes(bytes) };
  } catch (error) {
    if (error?.code === "ELOOP") fail("MIGRATION_PATH_UNSAFE", `${label} may not be a symlink`);
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertRealDirectory(target, label) {
  let stat;
  try { stat = await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT") fail("MIGRATION_PATH_MISSING", `${label} is missing`); throw error; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("MIGRATION_PATH_UNSAFE", `${label} must be a real directory`);
  return path.resolve(target);
}

function sourceFromSetting(setting) {
  return typeof setting === "string" ? setting : setting?.source;
}

function settingForPackage(settings, packageName) {
  const matches = (settings.packages ?? []).filter((setting) => {
    const source = sourceFromSetting(setting);
    if (typeof source !== "string") return false;
    try {
      const parsed = parsePackageSpec(source);
      return parsed.type === "npm" && parsed.name === packageName;
    } catch { return false; }
  });
  if (matches.length !== 1) fail("MIGRATION_SETTINGS_PACKAGE_DRIFT", `settings must select external package ${packageName} exactly once`);
  return matches[0];
}

function packageRelativePath(name) {
  if (!PACKAGE_NAME.test(name)) fail("MIGRATION_PACKAGE_IDENTITY_INVALID", `invalid npm package name: ${name}`);
  return `node_modules/${name}`;
}

async function inspectPi({ piPackageRoot, piBinPath, expectedVersion }) {
  const root = await assertRealDirectory(piPackageRoot, "Pi package root");
  const parent = await assertRealDirectory(path.dirname(root), "Pi package parent");
  const manifest = await readRegularJson(path.join(root, "package.json"), "Pi package manifest");
  if (manifest.value?.name !== "@earendil-works/pi-coding-agent" || manifest.value?.version !== expectedVersion) {
    fail("MIGRATION_PI_IDENTITY_DRIFT", `installed Pi must be @earendil-works/pi-coding-agent@${expectedVersion}`);
  }
  const binaryTarget = await fs.realpath(piBinPath).catch((error) => { if (error?.code === "ENOENT") fail("MIGRATION_PI_BINARY_MISSING", "Pi binary is missing"); throw error; });
  const realRoot = await fs.realpath(root);
  if (binaryTarget !== realRoot && !binaryTarget.startsWith(`${realRoot}${path.sep}`)) fail("MIGRATION_PI_BINARY_ESCAPE", "Pi binary does not resolve inside the installed Pi package root");
  const treeDigest = `sha256:${await hashResourcePath({ artifactRoot: parent, relativePath: path.basename(root), allowContainedSymlinks: true })}`;
  return Object.freeze({
    packageName: manifest.value.name,
    version: manifest.value.version,
    packageManifestDigest: manifest.digest,
    treeDigest,
    binaryTargetDigest: digestBytes(Buffer.from(path.relative(realRoot, binaryTarget).split(path.sep).join("/"))),
  });
}

async function inspectExternalTree({ configRoot, settingsState, manifest }) {
  const npmRoot = await assertRealDirectory(path.join(configRoot, "npm"), "Pi external npm root");
  await assertRealDirectory(path.join(npmRoot, "node_modules"), "Pi external node_modules root");
  if (settingsState.settings.packages !== undefined && !Array.isArray(settingsState.settings.packages)) fail("MIGRATION_SETTINGS_PACKAGE_DRIFT", "settings packages must be an array");
  const lock = await readRegularJson(path.join(npmRoot, "package-lock.json"), "external package lock");
  if (lock.value?.lockfileVersion !== 3 || lock.value.packages === null || typeof lock.value.packages !== "object") {
    fail("MIGRATION_LOCK_DRIFT", "external package-lock.json v3 is required");
  }
  const packages = [];
  for (const expected of manifest.externalPackages) {
    const setting = settingForPackage(settingsState.settings, expected.name);
    if (sourceFromSetting(setting) !== `npm:${expected.name}@${expected.fromVersion}`) fail("MIGRATION_SETTINGS_PACKAGE_DRIFT", `settings source drifted for ${expected.id}`);
    const relative = packageRelativePath(expected.name);
    const locked = lock.value.packages[relative];
    if (!locked || locked.version !== expected.fromVersion || locked.integrity !== expected.fromIntegrity || typeof locked.resolved !== "string") {
      fail("MIGRATION_LOCK_DRIFT", `package lock identity drifted for ${expected.id}`);
    }
    if (digestUrl(locked.resolved) !== expected.fromResolvedUrlDigest) fail("MIGRATION_LOCK_DRIFT", `package lock URL drifted for ${expected.id}`);
    const physicalRoot = await assertRealDirectory(path.join(npmRoot, ...relative.split("/")), `external package ${expected.id}`);
    const packageManifest = await readRegularJson(path.join(physicalRoot, "package.json"), `external package manifest ${expected.id}`);
    if (packageManifest.value?.name !== expected.name || packageManifest.value?.version !== expected.fromVersion) fail("MIGRATION_PACKAGE_IDENTITY_DRIFT", `external package identity drifted for ${expected.id}`);
    if (canonicalJson(lifecycleEvidence(packageManifest.value)) !== canonicalJson(expected.fromLifecycleScripts)) fail("MIGRATION_PACKAGE_LIFECYCLE_DRIFT", `external package lifecycle drifted for ${expected.id}`);
    const treeDigest = `sha256:${await hashResourcePath({ artifactRoot: npmRoot, relativePath: relative, allowContainedSymlinks: true })}`;
    if (treeDigest !== expected.fromTreeDigest) fail("MIGRATION_PACKAGE_TREE_DRIFT", `external package tree drifted for ${expected.id}`);
    packages.push(Object.freeze({ id: expected.id, name: expected.name, version: expected.fromVersion, treeDigest, binding: "external", owner: "user" }));
  }
  const npmTreeDigest = `sha256:${await hashResourcePath({ artifactRoot: configRoot, relativePath: "npm", allowContainedSymlinks: true })}`;
  return Object.freeze({ lockDigest: lock.digest, npmTreeDigest, packages: Object.freeze(packages) });
}

export class ExternalMigrationPlanner {
  constructor({ configRoot, piPackageRoot, piBinPath, bootstrap, installationInspector } = {}) {
    for (const [label, value] of Object.entries({ configRoot, piPackageRoot, piBinPath })) {
      if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
    }
    this.configRoot = path.resolve(configRoot);
    this.piPackageRoot = path.resolve(piPackageRoot);
    this.piBinPath = path.resolve(piBinPath);
    this.bootstrap = bootstrap ?? null;
    this.installationInspector = installationInspector ?? null;
  }

  async inspect({ manifest } = {}) {
    if (!manifest || !Array.isArray(manifest.externalPackages)) throw new TypeError("validated migration manifest is required");
    let installation;
    if (this.installationInspector) {
      installation = await this.installationInspector({ configRoot: this.configRoot, bootstrap: this.bootstrap });
    } else {
      const settingsState = await loadSettings(this.configRoot);
      const metadata = settingsState.settings.onlyMyPi;
      if (!metadata || !Array.isArray(metadata.packageBindings)) fail("MIGRATION_INSTALLATION_INVALID", "only-my-pi package binding metadata is required");
      const externalBindings = metadata.packageBindings.filter((entry) => entry.binding === "external");
      if (externalBindings.length !== 7 || externalBindings.some((entry) => entry.owner !== "user")) fail("MIGRATION_EXTERNAL_OWNERSHIP_DRIFT", "seven daily bindings must remain external and user-owned");
      await verifyRecordedExternalBindings({ configRoot: this.configRoot, settings: settingsState.settings, bindings: metadata.packageBindings });
      const lkg = await verifyLastKnownGood(this.configRoot);
      const generation = this.bootstrap?.doctor ? await this.bootstrap.doctor({ configRoot: this.configRoot }) : null;
      if (generation && generation.ok !== true) fail("MIGRATION_GENERATION_INVALID", "installed only-my-pi generation failed historical verification", { generation });
      installation = { settingsState, metadata, lkg, generation };
    }
    const { settingsState, metadata, lkg, generation } = installation;
    if (!settingsState?.settings || !metadata || typeof lkg?.state?.generationId !== "string") fail("MIGRATION_INSTALLATION_INVALID", "installation inspector returned incomplete evidence");
    const [pi, external] = await Promise.all([
      inspectPi({ piPackageRoot: this.piPackageRoot, piBinPath: this.piBinPath, expectedVersion: manifest.from.piVersion }),
      inspectExternalTree({ configRoot: this.configRoot, settingsState, manifest }),
    ]);
    return Object.freeze({
      status: "MIGRATION_PREFLIGHT_VERIFIED",
      mutation: false,
      settings: Object.freeze({ exists: settingsState.exists, digest: settingsState.digest }),
      generation: Object.freeze({ generationId: metadata.generationId, status: generation?.generation?.status ?? "RECORDED", lkgGenerationId: lkg.state.generationId }),
      pi,
      external,
      ownership: Object.freeze({ dailyExternalBindings: 7, completeExternalPackages: 9, owner: "user" }),
      privacy: Object.freeze({ authRead: false, sessionsRead: false, providerConfigRead: false }),
    });
  }
}

export function createExternalMigrationPlanner(options) {
  return new ExternalMigrationPlanner(options);
}
