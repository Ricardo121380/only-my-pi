import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";

import {
  parsePackageSpec,
  validateSri,
} from "../../scripts/lib/package-source.mjs";
import {
  assertSafeRelativePath,
  canonicalJson,
  computeOwnedGraphDigest,
  generationKeyFromDigest,
  hashResourcePath,
  sha256,
} from "./graph-plan.mjs";

const SAFE_TRANSACTION_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SAFE_NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
const MANIFEST_RELATIVE_PATH = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
export const GENERATION_SCHEMA_ID = "https://github.com/Ricardo121380/only-my-pi/schemas/bootstrap-generation-v1.schema.json";
const RESOURCE_TYPES = new Set(["extension", "skill", "prompt", "theme", "mode", "agent", "workflow", "swarm-recipe", "library"]);
const LIFECYCLE_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "prepack",
  "postpack",
]);
const FORBIDDEN_HOST_PACKAGE_PATHS = new Set([
  "node_modules/@earendil-works/pi-coding-agent",
  "node_modules/@mariozechner/pi-coding-agent",
]);

function fail(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  throw error;
}

function asPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("GENERATION_MANIFEST_INVALID", `${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("GENERATION_MANIFEST_INVALID", `${label} has an unexpected field set`);
  }
}

function assertSortedUniqueStrings(values, label) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
    fail("GENERATION_MANIFEST_INVALID", `${label} must be an array of strings`);
  }
  const sorted = [...values].sort();
  if (new Set(values).size !== values.length || values.some((value, index) => value !== sorted[index])) {
    fail("GENERATION_MANIFEST_INVALID", `${label} must be sorted and unique`);
  }
}

function assertManifestRelativePath(value, label) {
  assertSafeRelativePath(value, label);
  if (value.length > 512 || !MANIFEST_RELATIVE_PATH.test(value)) {
    fail("GENERATION_MANIFEST_INVALID", `${label} is outside the versioned schema path grammar`);
  }
}

/** Runtime shape validation mirrored by schemas/bootstrap-generation-v1. */
export function assertGenerationManifestShape(manifest) {
  assertExactKeys(manifest, [
    "$schema",
    "formatVersion",
    "status",
    "graphDigest",
    "generationKey",
    "profileId",
    "npmTreeSha256",
    "packages",
    "resources",
    "realizedDigest",
    "manifestDigest",
  ], "generation manifest");
  if (manifest.$schema !== GENERATION_SCHEMA_ID || manifest.formatVersion !== 1 || manifest.status !== "VERIFIED") {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest schema, version, or status is invalid");
  }
  if (!SHA256_DIGEST.test(manifest.graphDigest) || manifest.generationKey !== manifest.graphDigest.slice(7)) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest graph identity is invalid");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest.profileId)) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest profile id is invalid");
  }
  if (!HEX_SHA256.test(manifest.npmTreeSha256) || !SHA256_DIGEST.test(manifest.realizedDigest) || !SHA256_DIGEST.test(manifest.manifestDigest)) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest digest field is invalid");
  }
  if (!Array.isArray(manifest.packages) || !Array.isArray(manifest.resources)) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest package/resource sets must be arrays");
  }
  let previousPackageId;
  const installedPaths = new Set();
  const tarballPaths = new Set();
  for (const entry of manifest.packages) {
    assertExactKeys(entry, [
      "id",
      "spec",
      "sourceType",
      "name",
      "version",
      "integrity",
      "tarballPath",
      "installedPath",
      "treeSha256",
      "lifecycleScripts",
      "lifecycleExecution",
    ], "generation package");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || (previousPackageId !== undefined && entry.id <= previousPackageId)) {
      fail("GENERATION_MANIFEST_INVALID", "generation package ids must be canonical, sorted, and unique");
    }
    previousPackageId = entry.id;
    parsePackageSpec(entry.spec);
    if (!["npm", "git"].includes(entry.sourceType) || !SAFE_NPM_NAME.test(entry.name)) {
      fail("GENERATION_MANIFEST_INVALID", `generation package identity is invalid for ${entry.id}`);
    }
    parsePackageSpec(`npm:${entry.name}@${entry.version}`);
    validateSri(entry.integrity);
    assertManifestRelativePath(entry.tarballPath, `package ${entry.id} tarball path`);
    assertManifestRelativePath(entry.installedPath, `package ${entry.id} installed path`);
    if (installedPaths.has(entry.installedPath) || tarballPaths.has(entry.tarballPath)) {
      fail("GENERATION_MANIFEST_INVALID", `generation package paths must be unique for ${entry.id}`);
    }
    installedPaths.add(entry.installedPath);
    tarballPaths.add(entry.tarballPath);
    if (!HEX_SHA256.test(entry.treeSha256) || entry.lifecycleExecution !== "DISABLED") {
      fail("GENERATION_MANIFEST_INVALID", `generation package verification is invalid for ${entry.id}`);
    }
    assertSortedUniqueStrings(entry.lifecycleScripts, `package ${entry.id} lifecycle scripts`);
    if (entry.lifecycleScripts.some((name) => !LIFECYCLE_SCRIPT_NAMES.has(name))) {
      fail("GENERATION_MANIFEST_INVALID", `generation package has an unknown lifecycle script for ${entry.id}`);
    }
  }
  let previousResourceId;
  const resourceSourcePaths = new Set();
  const stagedResourcePaths = new Set();
  for (const entry of manifest.resources) {
    assertExactKeys(entry, ["id", "type", "sourcePath", "stagedPath", "sha256", "defaultLoaded"], "generation resource");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id) || (previousResourceId !== undefined && entry.id <= previousResourceId)) {
      fail("GENERATION_MANIFEST_INVALID", "generation resource ids must be canonical, sorted, and unique");
    }
    previousResourceId = entry.id;
    if (!RESOURCE_TYPES.has(entry.type) || typeof entry.defaultLoaded !== "boolean" || !HEX_SHA256.test(entry.sha256)) {
      fail("GENERATION_MANIFEST_INVALID", `generation resource verification is invalid for ${entry.id}`);
    }
    assertManifestRelativePath(entry.sourcePath, `resource ${entry.id} source path`);
    assertManifestRelativePath(entry.stagedPath, `resource ${entry.id} staged path`);
    if (resourceSourcePaths.has(entry.sourcePath) || stagedResourcePaths.has(entry.stagedPath)) {
      fail("GENERATION_MANIFEST_INVALID", `generation resource paths must be unique for ${entry.id}`);
    }
    resourceSourcePaths.add(entry.sourcePath);
    stagedResourcePaths.add(entry.stagedPath);
  }
  return manifest;
}

function assertPlan(plan) {
  if (plan?.formatVersion !== 1 || plan?.kind !== "only-my-pi-owned-generation") {
    fail("INVALID_GRAPH_PLAN", "owned graph plan is not a supported v1 plan");
  }
  const expected = computeOwnedGraphDigest(plan);
  if (plan.graphDigest !== expected || plan.generationKey !== generationKeyFromDigest(expected)) {
    fail("GRAPH_PLAN_DRIFT", "owned graph plan digest does not match its contents");
  }
}

function isMissing(error) {
  return error?.code === "ENOENT";
}

async function lstatOrUndefined(target) {
  try {
    return await fs.lstat(target);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function assertRegularFile(target, code, label) {
  const stat = await lstatOrUndefined(target);
  if (!stat?.isFile() || stat.isSymbolicLink()) fail(code, `${label} must be a regular file`);
  return stat;
}

async function assertDirectory(target, code, label) {
  const stat = await lstatOrUndefined(target);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) fail(code, `${label} must be a real directory`);
  return stat;
}

async function assertNoBundledPiHost(root) {
  const pending = [{ directory: root, segments: [] }];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await fs.readdir(current.directory, { withFileTypes: true });
    for (const entry of entries) {
      const segments = [...current.segments, entry.name];
      const normalized = segments.join("/");
      for (const suffix of FORBIDDEN_HOST_PACKAGE_PATHS) {
        if (normalized === suffix || normalized.endsWith(`/${suffix}`)) {
          fail("BUNDLED_PI_HOST_FORBIDDEN", `managed generation must use the external Pi host; found ${suffix}`);
        }
      }
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pending.push({ directory: path.join(current.directory, entry.name), segments });
      }
    }
  }
}

function observedLifecycleScripts(packageManifest, entry) {
  const scripts = packageManifest.scripts ?? {};
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) {
    fail("PACKAGE_LIFECYCLE_AUDIT_MISMATCH", `installed package scripts are invalid for ${entry.id}`);
  }
  return Object.keys(scripts)
    .filter((name) => LIFECYCLE_SCRIPT_NAMES.has(name))
    .sort()
    .map((name) => {
      if (typeof scripts[name] !== "string") {
        fail("PACKAGE_LIFECYCLE_AUDIT_MISMATCH", `lifecycle script ${name} is not a string for ${entry.id}`);
      }
      return {
        name,
        commandSha256: `sha256:${sha256(scripts[name])}`,
      };
    });
}

function assertCompatiblePiHostPeer(packageManifest, entry, runtimePi) {
  const peers = packageManifest.peerDependencies ?? {};
  if (peers === null || typeof peers !== "object" || Array.isArray(peers)) {
    fail("PACKAGE_PI_PEER_INVALID", `installed package peerDependencies are invalid for ${entry.id}`);
  }
  if (Object.hasOwn(peers, "@mariozechner/pi-coding-agent")) {
    fail("LEGACY_PI_HOST_PEER_FORBIDDEN", `installed package ${entry.id} declares the retired @mariozechner Pi host peer`);
  }
  const range = peers["@earendil-works/pi-coding-agent"];
  if (range === undefined) return;
  if (
    typeof range !== "string"
    || semver.valid(runtimePi, { loose: false }) !== runtimePi
    || semver.validRange(range, { loose: false }) === null
    || !semver.satisfies(runtimePi, range, { includePrerelease: true, loose: false })
  ) {
    fail("PACKAGE_PI_PEER_INCOMPATIBLE", `installed package ${entry.id} does not accept the governed Pi host ${runtimePi}`);
  }
}

export function createGenerationLayout({ configRoot, graphDigest, transactionId }) {
  if (typeof configRoot !== "string" || configRoot.length === 0) {
    fail("INVALID_CONFIG_ROOT", "configRoot must be an explicit non-empty path");
  }
  if (typeof transactionId !== "string" || !SAFE_TRANSACTION_ID.test(transactionId)) {
    fail("INVALID_TRANSACTION_ID", "transactionId must be a canonical lower-case id");
  }
  const generationKey = generationKeyFromDigest(graphDigest);
  const resolvedConfigRoot = path.resolve(configRoot);
  if (resolvedConfigRoot === path.parse(resolvedConfigRoot).root) {
    fail("INVALID_CONFIG_ROOT", "configRoot must not be a filesystem root");
  }
  const managedRoot = path.join(resolvedConfigRoot, "only-my-pi");
  const generationsRoot = path.join(managedRoot, "generations");
  const generationRoot = path.join(generationsRoot, generationKey);
  const stagingRoot = path.join(generationsRoot, `.staging-${generationKey}-${transactionId}`);
  return Object.freeze({
    configRoot: resolvedConfigRoot,
    managedRoot,
    generationsRoot,
    generationKey,
    generationRoot,
    stagingRoot,
    npmRoot: path.join(stagingRoot, "npm"),
    resourceRoot: path.join(stagingRoot, "resources"),
    tarballRoot: path.join(stagingRoot, "tarballs"),
    manifestName: ".only-my-pi-generation.json",
  });
}

function sriFromBytes(bytes) {
  return validateSri(`sha512-${crypto.createHash("sha512").update(bytes).digest("base64")}`);
}

async function verifyTarball(target, expectedIntegrity) {
  await assertRegularFile(target, "TARBALL_MISSING", `tarball ${target}`);
  const actual = sriFromBytes(await fs.readFile(target));
  if (actual !== expectedIntegrity) {
    fail("TARBALL_INTEGRITY_MISMATCH", `tarball integrity mismatch for ${path.basename(target)}`);
  }
  return actual;
}

function npmInstallRelativePath(packageName) {
  if (!SAFE_NPM_NAME.test(packageName)) fail("INVALID_PACKED_PACKAGE_NAME", `npm pack returned unsafe package name ${packageName}`);
  return `npm/node_modules/${packageName}`;
}

function parsePackRecord(result, expected, tarballNames) {
  if (result === null || typeof result !== "object") fail("COMMAND_RESULT_INVALID", `npm pack for ${expected.id} returned no result`);
  const exitCode = result.exitCode ?? result.code;
  if (exitCode !== 0) fail("NPM_PACK_FAILED", `npm pack failed for ${expected.id} with exit code ${String(exitCode)}`);
  let records;
  try {
    const parsed = JSON.parse(String(result.stdout ?? ""));
    records = Array.isArray(parsed) ? parsed : [parsed];
  } catch (cause) {
    fail("NPM_PACK_OUTPUT_INVALID", `npm pack returned invalid JSON for ${expected.id}`, cause);
  }
  if (records.length !== 1 || records[0] === null || typeof records[0] !== "object") {
    fail("NPM_PACK_OUTPUT_INVALID", `npm pack must return exactly one record for ${expected.id}`);
  }
  const record = records[0];
  if (typeof record.filename !== "string" || path.basename(record.filename) !== record.filename || !tarballNames.includes(record.filename)) {
    fail("NPM_PACK_OUTPUT_INVALID", `npm pack returned an unsafe or unexpected filename for ${expected.id}`);
  }
  if (typeof record.name !== "string" || !SAFE_NPM_NAME.test(record.name)) {
    fail("NPM_PACK_OUTPUT_INVALID", `npm pack returned an unsafe package name for ${expected.id}`);
  }
  if (typeof record.version !== "string") fail("NPM_PACK_OUTPUT_INVALID", `npm pack returned no version for ${expected.id}`);
  try {
    parsePackageSpec(`npm:${record.name}@${record.version}`);
  } catch (cause) {
    fail("NPM_PACK_OUTPUT_INVALID", `npm pack returned a non-canonical version for ${expected.id}`, cause);
  }
  if (record.integrity !== undefined && validateSri(record.integrity) !== expected.integrity) {
    fail("NPM_PACK_REPORTED_INTEGRITY_MISMATCH", `npm pack reported unexpected integrity for ${expected.id}`);
  }
  if (expected.source.type === "npm" && (record.name !== expected.source.name || record.version !== expected.source.version)) {
    fail("NPM_PACK_IDENTITY_MISMATCH", `npm pack identity does not match ${expected.spec}`);
  }
  return {
    filename: record.filename,
    name: record.name,
    version: record.version,
  };
}

const NPM_ENV_OVERLAY = Object.freeze({
  npm_config_ignore_scripts: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
});

async function invokeNpm(runCommand, argv, cwd, label) {
  if (typeof runCommand !== "function") fail("COMMAND_RUNNER_REQUIRED", "package staging requires an injected command runner");
  const request = Object.freeze({
    command: "npm",
    argv: Object.freeze([...argv]),
    cwd,
    envOverlay: NPM_ENV_OVERLAY,
    shell: false,
    stdio: "pipe",
    label,
  });
  return runCommand(request);
}

async function copyTree(source, destination, relativePath = ".") {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink()) fail("RESOURCE_SYMLINK", `staged resources do not admit symlinks: ${relativePath}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: false, mode: stat.mode & 0o777 });
    const names = await fs.readdir(source);
    names.sort();
    for (const name of names) {
      await copyTree(
        path.join(source, name),
        path.join(destination, name),
        relativePath === "." ? name : `${relativePath}/${name}`,
      );
    }
    return;
  }
  if (!stat.isFile()) fail("UNSUPPORTED_RESOURCE_TYPE", `cannot stage non-file resource ${relativePath}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
  await fs.chmod(destination, stat.mode & 0o777);
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.tmp-${process.pid}`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temporary, target);
  try {
    const directory = await fs.open(path.dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  }
}

function manifestPayload(manifest) {
  const { manifestDigest: _manifestDigest, ...payload } = manifest;
  return payload;
}

function computeManifestDigest(manifest) {
  return `sha256:${sha256(canonicalJson(manifestPayload(manifest)))}`;
}

function realizedPayload(manifest) {
  return {
    graphDigest: manifest.graphDigest,
    npmTreeSha256: manifest.npmTreeSha256,
    packages: manifest.packages.map((entry) => ({
      id: entry.id,
      integrity: entry.integrity,
      installedPath: entry.installedPath,
      treeSha256: entry.treeSha256,
    })),
    resources: manifest.resources.map((entry) => ({
      id: entry.id,
      stagedPath: entry.stagedPath,
      sha256: entry.sha256,
    })),
  };
}

function computeRealizedDigest(manifest) {
  return `sha256:${sha256(canonicalJson(realizedPayload(manifest)))}`;
}

function promotionReceipt(layout, manifest, { created, reused }) {
  return Object.freeze({
    formatVersion: 1,
    status: "VERIFIED_PROMOTED",
    graphDigest: manifest.graphDigest,
    generationKey: layout.generationKey,
    generationRoot: layout.generationRoot,
    manifestDigest: manifest.manifestDigest,
    realizedDigest: manifest.realizedDigest,
    created,
    reused,
  });
}

async function readManifest(generationRoot, manifestName) {
  const target = path.join(generationRoot, manifestName);
  await assertRegularFile(target, "GENERATION_MANIFEST_MISSING", "generation manifest");
  try {
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (cause) {
    fail("GENERATION_MANIFEST_INVALID", "generation manifest is not valid JSON", cause);
  }
}

/**
 * Verify an immutable historical generation solely from its versioned
 * self-describing manifest. Rollback/LKG callers do not need the current repo
 * inventory, which may legitimately have advanced since this generation.
 */
export async function verifyGenerationByManifest({ layout, expectedManifestDigest } = {}) {
  await assertManagedPathComponents(layout);
  if (expectedManifestDigest !== undefined && !SHA256_DIGEST.test(expectedManifestDigest)) {
    fail("INVALID_EXPECTED_MANIFEST_DIGEST", "expectedManifestDigest must be a canonical sha256 digest");
  }
  await assertDirectory(layout.generationRoot, "GENERATION_NOT_PROMOTED", "promoted generation root");
  const manifest = await readManifest(layout.generationRoot, layout.manifestName);
  assertGenerationManifestShape(manifest);
  if (
    manifest.graphDigest !== `sha256:${layout.generationKey}`
    || manifest.generationKey !== layout.generationKey
  ) {
    fail("GENERATION_MANIFEST_MISMATCH", "generation manifest does not match its immutable path");
  }
  if (manifest.manifestDigest !== computeManifestDigest(manifest)) {
    fail("GENERATION_MANIFEST_DIGEST_MISMATCH", "generation manifest digest is invalid");
  }
  if (expectedManifestDigest !== undefined && manifest.manifestDigest !== expectedManifestDigest) {
    fail("GENERATION_MANIFEST_DIGEST_MISMATCH", "generation manifest does not match the expected historical digest");
  }

  for (const installed of manifest.packages) {
    const source = parsePackageSpec(installed.spec);
    if (
      source.type !== installed.sourceType
      || (source.type === "npm" && (source.name !== installed.name || source.version !== installed.version))
    ) {
      fail("GENERATION_PACKAGE_IDENTITY_MISMATCH", `generation package source identity is inconsistent for ${installed.id}`);
    }
    if (
      !installed.tarballPath.startsWith(`tarballs/${installed.id}/`)
      || installed.installedPath !== npmInstallRelativePath(installed.name)
    ) {
      fail("GENERATION_PACKAGE_LAYOUT_MISMATCH", `generation package layout is invalid for ${installed.id}`);
    }
    const tarball = path.join(layout.generationRoot, ...installed.tarballPath.split("/"));
    await verifyTarball(tarball, installed.integrity);
    const packageRoot = path.join(layout.generationRoot, ...installed.installedPath.split("/"));
    await assertDirectory(packageRoot, "INSTALLED_PACKAGE_MISSING", `installed package ${installed.id}`);
    const packageManifestPath = path.join(packageRoot, "package.json");
    await assertRegularFile(packageManifestPath, "INSTALLED_PACKAGE_MANIFEST_MISSING", `installed package manifest ${installed.id}`);
    let packageManifest;
    try {
      packageManifest = JSON.parse(await fs.readFile(packageManifestPath, "utf8"));
    } catch (cause) {
      fail("INSTALLED_PACKAGE_MANIFEST_INVALID", `installed package manifest is invalid for ${installed.id}`, cause);
    }
    if (packageManifest.name !== installed.name || packageManifest.version !== installed.version) {
      fail("INSTALLED_PACKAGE_IDENTITY_MISMATCH", `installed package identity drifted for ${installed.id}`);
    }
    const treeSha256 = await hashResourcePath({ artifactRoot: layout.generationRoot, relativePath: installed.installedPath });
    if (treeSha256 !== installed.treeSha256) fail("INSTALLED_PACKAGE_DRIFT", `installed package content drifted for ${installed.id}`);
  }
  const npmTreeSha256 = await hashResourcePath({
    artifactRoot: path.join(layout.generationRoot, "npm"),
    relativePath: "node_modules",
    allowContainedSymlinks: true,
  });
  if (npmTreeSha256 !== manifest.npmTreeSha256) fail("NPM_TREE_DRIFT", "managed npm tree content drifted");

  for (const staged of manifest.resources) {
    if (staged.stagedPath !== `resources/${staged.sourcePath}`) {
      fail("GENERATION_RESOURCE_LAYOUT_MISMATCH", `generation resource layout is invalid for ${staged.id}`);
    }
    const actual = await hashResourcePath({ artifactRoot: layout.generationRoot, relativePath: staged.stagedPath });
    if (actual !== staged.sha256) fail("STAGED_RESOURCE_DRIFT", `staged resource content drifted for ${staged.id}`);
  }
  if (manifest.realizedDigest !== computeRealizedDigest(manifest)) {
    fail("REALIZED_GRAPH_DIGEST_MISMATCH", "generation realized graph digest is invalid");
  }
  return { manifest, receipt: promotionReceipt(layout, manifest, { created: false, reused: true }) };
}

/** Verify a generation against the current desired graph after self-verification. */
export async function verifyPromotedGeneration({ plan, layout }) {
  assertPlan(plan);
  if (layout.generationKey !== plan.generationKey || layout.generationRoot !== path.join(layout.generationsRoot, plan.generationKey)) {
    fail("GENERATION_LAYOUT_MISMATCH", "generation layout does not match the owned graph plan");
  }
  const verified = await verifyGenerationByManifest({ layout });
  const { manifest } = verified;
  if (manifest.profileId !== plan.profileId || manifest.graphDigest !== plan.graphDigest) {
    fail("GENERATION_MANIFEST_MISMATCH", "generation manifest does not match the requested graph");
  }

  const expectedPackages = new Map(plan.packages.map((entry) => [entry.id, entry]));
  if (manifest.packages.length !== expectedPackages.size) {
    fail("GENERATION_PACKAGE_SET_MISMATCH", "generation package set does not match the plan");
  }
  for (const installed of manifest.packages) {
    const expected = expectedPackages.get(installed.id);
    if (
      !expected
      || installed.spec !== expected.spec
      || installed.sourceType !== expected.source.type
      || installed.integrity !== expected.integrity
      || (expected.source.type === "npm" && (installed.name !== expected.source.name || installed.version !== expected.source.version))
    ) {
      fail("GENERATION_PACKAGE_SET_MISMATCH", `generation contains unexpected package ${installed.id}`);
    }
    const packageRoot = path.join(layout.generationRoot, ...installed.installedPath.split("/"));
    for (const relativeFilter of expected.resourceFilter) {
      assertSafeRelativePath(relativeFilter, `package ${installed.id} resource filter`);
      await assertRegularFile(path.join(packageRoot, ...relativeFilter.split("/")), "PACKAGE_RESOURCE_MISSING", `filtered package resource ${relativeFilter}`);
    }
  }

  const expectedResources = new Map(plan.resources.map((entry) => [entry.id, entry]));
  if (manifest.resources.length !== expectedResources.size) {
    fail("GENERATION_RESOURCE_SET_MISMATCH", "generation resource set does not match the plan");
  }
  for (const staged of manifest.resources) {
    const expected = expectedResources.get(staged.id);
    if (
      !expected
      || staged.type !== expected.type
      || staged.sourcePath !== expected.path
      || staged.defaultLoaded !== expected.defaultLoaded
      || staged.sha256 !== expected.sha256
    ) {
      fail("GENERATION_RESOURCE_SET_MISMATCH", `generation contains unexpected resource ${staged.id}`);
    }
  }
  return verified;
}

/** Default atomic promotion seam. Transaction orchestration owns recovery. */
export async function atomicPromoteGeneration({ stagingRoot, generationRoot, graphDigest }) {
  const generationKey = generationKeyFromDigest(graphDigest);
  const stagingPrefix = `.staging-${generationKey}-`;
  const stagingName = path.basename(stagingRoot);
  if (
    path.dirname(stagingRoot) !== path.dirname(generationRoot)
    || path.basename(generationRoot) !== generationKey
    || !stagingName.startsWith(stagingPrefix)
    || !SAFE_TRANSACTION_ID.test(stagingName.slice(stagingPrefix.length))
  ) {
    fail("UNSAFE_GENERATION_PROMOTION", "promotion paths do not match the requested immutable generation");
  }
  await assertDirectory(stagingRoot, "GENERATION_NOT_STAGED", "staging generation root");
  if (await lstatOrUndefined(generationRoot)) {
    fail("GENERATION_ALREADY_EXISTS", "atomic promotion never overwrites an existing generation");
  }
  await fs.rename(stagingRoot, generationRoot);
  try {
    const directory = await fs.open(path.dirname(generationRoot), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(error?.code)) throw error;
  }
}

function assertManagedLayout(layout) {
  const configRoot = path.resolve(layout?.configRoot ?? "");
  const expectedManagedRoot = path.join(configRoot, "only-my-pi");
  const expectedGenerationsRoot = path.join(expectedManagedRoot, "generations");
  if (
    configRoot === path.parse(configRoot).root
    || !/^[a-f0-9]{64}$/.test(layout?.generationKey ?? "")
    || layout.managedRoot !== expectedManagedRoot
    || layout.generationsRoot !== expectedGenerationsRoot
    || layout.generationRoot !== path.join(expectedGenerationsRoot, layout.generationKey)
  ) {
    fail("UNSAFE_GENERATION_LAYOUT", "managed generation layout is not derived from configRoot and a canonical graph digest");
  }
  return expectedGenerationsRoot;
}

async function assertManagedPathComponents(layout) {
  assertManagedLayout(layout);
  for (const [target, label] of [
    [layout.configRoot, "configRoot"],
    [layout.managedRoot, "managed root"],
    [layout.generationsRoot, "generations root"],
  ]) {
    const stat = await lstatOrUndefined(target);
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) {
      fail("UNSAFE_MANAGED_PATH", `${label} must be a real directory when it exists`);
    }
  }
}

/**
 * Remove only the exact transaction-scoped staging path. Failures intentionally
 * leave staging in place until transaction recovery explicitly calls this.
 */
export async function removeStagingGeneration({ layout }) {
  const expectedPrefix = `.staging-${layout.generationKey}-`;
  const expectedGenerationsRoot = assertManagedLayout(layout);
  await assertManagedPathComponents(layout);
  const stagingName = path.basename(layout.stagingRoot ?? "");
  if (
    path.dirname(layout.stagingRoot) !== expectedGenerationsRoot
    || !stagingName.startsWith(expectedPrefix)
    || !SAFE_TRANSACTION_ID.test(stagingName.slice(expectedPrefix.length))
  ) {
    fail("UNSAFE_STAGING_CLEANUP", "refusing to remove a path outside the exact generation staging namespace");
  }
  const stat = await lstatOrUndefined(layout.stagingRoot);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("UNSAFE_STAGING_CLEANUP", "refusing to remove a non-directory or symlink staging path");
  }
  const manifestPath = path.join(layout.stagingRoot, layout.manifestName);
  if (await lstatOrUndefined(manifestPath)) {
    const manifest = await readManifest(layout.stagingRoot, layout.manifestName);
    assertGenerationManifestShape(manifest);
    if (manifest.graphDigest !== `sha256:${layout.generationKey}`) {
      fail("UNSAFE_STAGING_CLEANUP", "staging manifest belongs to another graph");
    }
  }
  await fs.rm(layout.stagingRoot, { recursive: true, force: false });
  return true;
}

/**
 * Delete exactly one verified immutable generation after the transaction
 * orchestrator has proved that settings and last-known-good state do not
 * reference it. This function does not make that external reference decision.
 */
export async function removeUnreferencedGeneration({ layout, expectedManifestDigest } = {}) {
  const generationsRoot = assertManagedLayout(layout);
  await assertManagedPathComponents(layout);
  if (path.dirname(layout.generationRoot) !== generationsRoot || path.basename(layout.generationRoot) !== layout.generationKey) {
    fail("UNSAFE_GENERATION_CLEANUP", "refusing to remove a non-generation path");
  }
  if (expectedManifestDigest !== undefined && !SHA256_DIGEST.test(expectedManifestDigest)) {
    fail("UNSAFE_GENERATION_CLEANUP", "expectedManifestDigest must be a canonical sha256 digest");
  }
  const stat = await lstatOrUndefined(layout.generationRoot);
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("UNSAFE_GENERATION_CLEANUP", "refusing to remove a non-directory or symlink generation path");
  }
  const manifest = await readManifest(layout.generationRoot, layout.manifestName);
  assertGenerationManifestShape(manifest);
  if (
    manifest.graphDigest !== `sha256:${layout.generationKey}`
    || manifest.generationKey !== layout.generationKey
    || manifest.manifestDigest !== computeManifestDigest(manifest)
  ) {
    fail("UNSAFE_GENERATION_CLEANUP", "generation manifest identity or self-digest is invalid");
  }
  if (expectedManifestDigest !== undefined && manifest.manifestDigest !== expectedManifestDigest) {
    fail("GENERATION_CLEANUP_DIGEST_MISMATCH", "generation manifest does not match the caller's expected digest");
  }
  await fs.rm(layout.generationRoot, { recursive: true, force: false });
  return true;
}

async function stagePackages({ plan, layout, runCommand }) {
  await fs.mkdir(layout.npmRoot, { recursive: true });
  await fs.mkdir(path.join(layout.npmRoot, "node_modules"), { recursive: true });
  await fs.mkdir(layout.tarballRoot, { recursive: true });
  await writeJsonAtomic(path.join(layout.npmRoot, "package.json"), {
    name: "only-my-pi-owned-generation",
    private: true,
    version: "0.0.0",
  });

  const packed = [];
  for (const entry of plan.packages) {
    const packDirectory = path.join(layout.tarballRoot, entry.id);
    await fs.mkdir(packDirectory, { recursive: false });
    const target = entry.source.type === "npm"
      ? `${entry.source.name}@${entry.source.version}`
      : `${entry.source.repository}#${entry.source.commit}`;
    const result = await invokeNpm(runCommand, [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      packDirectory,
      "--",
      target,
    ], packDirectory, `pack:${entry.id}`);
    const names = (await fs.readdir(packDirectory)).filter((name) => name.endsWith(".tgz")).sort();
    if (names.length !== 1) fail("TARBALL_SET_INVALID", `npm pack must create exactly one tarball for ${entry.id}`);
    const record = parsePackRecord(result, entry, names);
    if (packed.some((existing) => existing.name === record.name)) {
      fail("PACKED_PACKAGE_NAME_COLLISION", `multiple governed packages resolve to npm package name ${record.name}`);
    }
    const tarballAbsolutePath = path.join(packDirectory, record.filename);
    await verifyTarball(tarballAbsolutePath, entry.integrity);
    packed.push({
      ...entry,
      name: record.name,
      version: record.version,
      tarballAbsolutePath,
      tarballPath: asPosix(path.relative(layout.stagingRoot, tarballAbsolutePath)),
      installedPath: npmInstallRelativePath(record.name),
    });
  }

  if (packed.length > 0) {
    const result = await invokeNpm(runCommand, [
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
      layout.npmRoot,
      "--",
      ...packed.map((entry) => entry.tarballAbsolutePath),
    ], layout.npmRoot, "install:owned-graph");
    const exitCode = result?.exitCode ?? result?.code;
    if (exitCode !== 0) fail("NPM_INSTALL_FAILED", `npm install failed with exit code ${String(exitCode)}`);
  }

  await assertNoBundledPiHost(layout.npmRoot);

  const manifestPackages = [];
  for (const entry of packed) {
    const packageRoot = path.join(layout.stagingRoot, ...entry.installedPath.split("/"));
    await assertDirectory(packageRoot, "INSTALLED_PACKAGE_MISSING", `installed package ${entry.id}`);
    const packageJsonPath = path.join(packageRoot, "package.json");
    await assertRegularFile(packageJsonPath, "INSTALLED_PACKAGE_MANIFEST_MISSING", `installed package manifest ${entry.id}`);
    let packageManifest;
    try {
      packageManifest = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    } catch (cause) {
      fail("INSTALLED_PACKAGE_MANIFEST_INVALID", `installed package manifest is invalid for ${entry.id}`, cause);
    }
    if (packageManifest.name !== entry.name || packageManifest.version !== entry.version) {
      fail("INSTALLED_PACKAGE_IDENTITY_MISMATCH", `installed package identity does not match packed artifact for ${entry.id}`);
    }
    if (entry.source.type === "npm" && (entry.name !== entry.source.name || entry.version !== entry.source.version)) {
      fail("INSTALLED_PACKAGE_IDENTITY_MISMATCH", `installed package identity does not match inventory for ${entry.id}`);
    }
    assertCompatiblePiHostPeer(packageManifest, entry, plan.runtime.pi);
    for (const relativeFilter of entry.resourceFilter) {
      assertSafeRelativePath(relativeFilter, `package ${entry.id} resource filter`);
      await assertRegularFile(path.join(packageRoot, ...relativeFilter.split("/")), "PACKAGE_RESOURCE_MISSING", `filtered package resource ${relativeFilter}`);
    }
    const observedLifecycle = observedLifecycleScripts(packageManifest, entry);
    const expectedLifecycle = entry.lifecycle?.scripts?.map(({ name, commandSha256 }) => ({ name, commandSha256 }));
    if (
      entry.lifecycle?.execution !== "disabled"
      || canonicalJson(observedLifecycle) !== canonicalJson(expectedLifecycle)
    ) {
      fail("PACKAGE_LIFECYCLE_AUDIT_MISMATCH", `installed lifecycle scripts differ from inventory for ${entry.id}`);
    }
    const lifecycleScripts = observedLifecycle.map((script) => script.name);
    manifestPackages.push({
      id: entry.id,
      spec: entry.spec,
      sourceType: entry.source.type,
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      tarballPath: entry.tarballPath,
      installedPath: entry.installedPath,
      treeSha256: await hashResourcePath({ artifactRoot: layout.stagingRoot, relativePath: entry.installedPath }),
      lifecycleScripts,
      lifecycleExecution: "DISABLED",
    });
  }
  return manifestPackages;
}

async function stageResources({ plan, layout, artifactRoot }) {
  await fs.mkdir(layout.resourceRoot, { recursive: true });
  const root = path.resolve(artifactRoot);
  const manifestResources = [];
  for (const resource of plan.resources) {
    const currentDigest = await hashResourcePath({ artifactRoot: root, relativePath: resource.path });
    if (currentDigest !== resource.sha256) fail("RESOURCE_SOURCE_DRIFT", `resource ${resource.id} changed after graph planning`);
    const source = path.join(root, ...resource.path.split("/"));
    const stagedPath = `resources/${resource.path}`;
    const destination = path.join(layout.stagingRoot, ...stagedPath.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await copyTree(source, destination);
    const stagedDigest = await hashResourcePath({ artifactRoot: layout.stagingRoot, relativePath: stagedPath });
    if (stagedDigest !== resource.sha256) fail("STAGED_RESOURCE_MISMATCH", `staged resource ${resource.id} failed digest verification`);
    manifestResources.push({
      id: resource.id,
      type: resource.type,
      sourcePath: resource.path,
      stagedPath,
      sha256: stagedDigest,
      defaultLoaded: resource.defaultLoaded,
    });
  }
  return manifestResources;
}

/**
 * Materialize and atomically promote one immutable generation. No npm command
 * is executed unless the caller explicitly supplies a command runner.
 */
export async function stageAndPromoteGeneration({
  plan,
  configRoot,
  transactionId,
  artifactRoot,
  runCommand,
  promote = atomicPromoteGeneration,
}) {
  assertPlan(plan);
  const layout = createGenerationLayout({ configRoot, graphDigest: plan.graphDigest, transactionId });
  await assertManagedPathComponents(layout);
  if (await lstatOrUndefined(layout.generationRoot)) {
    const verified = await verifyPromotedGeneration({ plan, layout });
    return { layout, manifest: verified.manifest, receipt: verified.receipt };
  }
  await fs.mkdir(layout.generationsRoot, { recursive: true });
  if (await lstatOrUndefined(layout.stagingRoot)) {
    fail("STAGING_GENERATION_EXISTS", `staging generation already exists for transaction ${transactionId}`);
  }
  await fs.mkdir(layout.stagingRoot, { recursive: false, mode: 0o700 });

  const packages = await stagePackages({ plan, layout, runCommand });
  const resources = await stageResources({ plan, layout, artifactRoot });
  const npmTreeSha256 = await hashResourcePath({
    artifactRoot: layout.npmRoot,
    relativePath: "node_modules",
    allowContainedSymlinks: true,
  });
  const manifest = {
    $schema: GENERATION_SCHEMA_ID,
    formatVersion: 1,
    status: "VERIFIED",
    graphDigest: plan.graphDigest,
    generationKey: plan.generationKey,
    profileId: plan.profileId,
    npmTreeSha256,
    packages,
    resources,
    realizedDigest: "",
  };
  manifest.realizedDigest = computeRealizedDigest(manifest);
  manifest.manifestDigest = computeManifestDigest(manifest);
  assertGenerationManifestShape(manifest);
  await writeJsonAtomic(path.join(layout.stagingRoot, layout.manifestName), manifest);

  if (typeof promote !== "function") fail("PROMOTION_SEAM_REQUIRED", "promote must be a function");
  await promote({
    stagingRoot: layout.stagingRoot,
    generationRoot: layout.generationRoot,
    graphDigest: plan.graphDigest,
    manifestDigest: manifest.manifestDigest,
  });
  if (await lstatOrUndefined(layout.stagingRoot)) {
    fail("PROMOTION_NOT_ATOMIC", "promotion seam left the staging generation visible");
  }
  const verified = await verifyPromotedGeneration({ plan, layout });
  return {
    layout,
    manifest: verified.manifest,
    receipt: promotionReceipt(layout, verified.manifest, { created: true, reused: false }),
  };
}
