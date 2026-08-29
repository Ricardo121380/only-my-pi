import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { finalizeArtifactLedger, sha256 } from "./contracts.mjs";
import { hashPackageContentTree } from "./package-content-identity.mjs";

const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "prepack", "postpack"]);
const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const LICENSE = /^[A-Za-z0-9][A-Za-z0-9.()+ -]{0,127}$/u;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function normalizeUrl(raw) {
  let url;
  try { url = new URL(raw); }
  catch { fail("LEDGER_LOCK_URL_INVALID", "package lock contains an invalid URL"); }
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith(".tgz")) {
    fail("LEDGER_LOCK_URL_INVALID", "package lock URL must be credential-free registry.npmjs.org HTTPS");
  }
  return url.href;
}

function packageIdentity(manifest) {
  if (typeof manifest?.name !== "string" || typeof manifest?.version !== "string") fail("LEDGER_PACKAGE_MANIFEST_INVALID", "installed package manifest has no exact identity");
  return `${manifest.name}@${manifest.version}`;
}

function licenseConclusion(manifest, overrides) {
  const override = overrides?.[packageIdentity(manifest)] ?? overrides?.[manifest.name];
  const value = override ?? (typeof manifest.license === "string" ? manifest.license : null);
  if (typeof value !== "string" || !LICENSE.test(value) || value === "NOASSERTION") fail("LEDGER_LICENSE_UNRESOLVED", `license is unresolved for ${packageIdentity(manifest)}`);
  return value;
}

function lifecycleScripts(manifest) {
  return Object.entries(manifest.scripts ?? {})
    .filter(([name]) => LIFECYCLE_NAMES.has(name))
    .map(([name, command]) => ({ name, commandSha256: sha256(String(command)), executed: false }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parentPackagePath(relativePath) {
  const marker = "/node_modules/";
  const index = relativePath.lastIndexOf(marker);
  return index < 0 ? "" : relativePath.slice(0, index);
}

function dependencyCandidates(packagePath, dependencyName) {
  const results = [];
  let current = packagePath;
  while (true) {
    results.push(path.posix.join(current, "node_modules", dependencyName));
    if (current === "") break;
    current = parentPackagePath(current);
  }
  return results;
}

function resolveDependencyIdentity({ packagePath, dependencyName, entriesByPath }) {
  for (const candidate of dependencyCandidates(packagePath, dependencyName)) {
    const target = entriesByPath.get(candidate);
    if (target) return target.identity;
  }
  return null;
}

function shaFor(artifactBytes, identity, url) {
  const value = artifactBytes instanceof Map
    ? artifactBytes.get(identity) ?? artifactBytes.get(url)
    : artifactBytes?.[identity] ?? artifactBytes?.[url];
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return sha256(Buffer.from(value));
  if (value && typeof value === "object" && /^sha256:[a-f0-9]{64}$/u.test(value.sha256 ?? "")) return value.sha256;
  fail("LEDGER_ARTIFACT_BYTES_REQUIRED", `verified tarball evidence is required for ${identity}`);
}

async function artifactTreeDigest(artifactTreeRoots, identity, installedManifest, fallback) {
  const selected = artifactTreeRoots instanceof Map ? artifactTreeRoots.get(identity) : artifactTreeRoots?.[identity];
  if (selected === undefined) return fallback();
  if (typeof selected !== "string" || !path.isAbsolute(selected)) fail("LEDGER_ARTIFACT_TREE_INVALID", `artifact content root is invalid for ${identity}`);
  const real = await fs.realpath(selected).catch(() => null);
  const stat = real ? await fs.lstat(real) : null;
  if (real !== path.resolve(selected) || !stat?.isDirectory() || stat.isSymbolicLink()) fail("LEDGER_ARTIFACT_TREE_INVALID", `artifact content root is unsafe for ${identity}`);
  const manifest = JSON.parse(await fs.readFile(path.join(real, "package.json"), "utf8"));
  if (manifest.name !== installedManifest.name || manifest.version !== installedManifest.version || canonicalJson(manifest) !== canonicalJson(installedManifest)) {
    fail("LEDGER_ARTIFACT_TREE_MANIFEST_DRIFT", `artifact and installed package manifests differ for ${identity}`);
  }
  return hashPackageContentTree(real);
}

export async function buildArtifactLedger({
  npmRoot,
  lockPath = path.join(npmRoot ?? "", "package-lock.json"),
  sourceCommit,
  artifactBytes,
  artifactTreeRoots = null,
  integrityOverrides = {},
  licenseOverrides = {},
  topLevelNames = [],
  rootArtifact = null,
} = {}) {
  if (typeof npmRoot !== "string" || !path.isAbsolute(npmRoot)) throw new TypeError("buildArtifactLedger requires an absolute npmRoot");
  const root = await fs.realpath(npmRoot);
  const lockReal = await fs.realpath(lockPath);
  if (lockReal !== root && !lockReal.startsWith(`${root}${path.sep}`)) fail("LEDGER_LOCK_PATH_UNSAFE", "package lock escapes npm root");
  const lockStat = await fs.lstat(lockReal);
  if (!lockStat.isFile() || lockStat.isSymbolicLink() || lockStat.size > 64 * 1024 * 1024) fail("LEDGER_LOCK_PATH_UNSAFE", "package lock must be a bounded regular file");
  const lock = JSON.parse(await fs.readFile(lockReal, "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") fail("LEDGER_LOCK_INVALID", "package lock must use lockfileVersion 3");

  const entries = [];
  const entriesByPath = new Map();
  for (const [relativePath, locked] of Object.entries(lock.packages)) {
    if (relativePath === "" || !relativePath.includes("node_modules/")) continue;
    const absolute = path.resolve(root, ...relativePath.split("/"));
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) fail("LEDGER_PACKAGE_PATH_UNSAFE", `package path escapes npm root: ${relativePath}`);
    const real = await fs.realpath(absolute).catch((error) => {
      if (error?.code === "ENOENT" && locked.optional === true) return null;
      throw error;
    });
    if (real === null) continue;
    if (real !== absolute || (real !== root && !real.startsWith(`${root}${path.sep}`))) fail("LEDGER_PACKAGE_PATH_UNSAFE", `package path is a symlink or escape: ${relativePath}`);
    const stat = await fs.lstat(path.join(real, "package.json"));
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) fail("LEDGER_PACKAGE_PATH_UNSAFE", `package manifest is unsafe: ${relativePath}`);
    const manifest = JSON.parse(await fs.readFile(path.join(real, "package.json"), "utf8"));
    const identity = packageIdentity(manifest);
    if (locked.version !== manifest.version) fail("LEDGER_LOCK_MANIFEST_DRIFT", `lock and disk version differ for ${identity}`);
    const url = normalizeUrl(locked.resolved);
    const integrity = locked.integrity ?? integrityOverrides[identity] ?? integrityOverrides[url];
    if (!SRI.test(integrity ?? "")) fail("LEDGER_INTEGRITY_MISSING", `complete SHA-512 SRI is required for ${identity}`);
    const entry = { relativePath, locked, manifest, identity, url, integrity, real };
    entries.push(entry);
    entriesByPath.set(relativePath, entry);
  }
  if (rootArtifact !== null) {
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const identity = packageIdentity(manifest);
    if (rootArtifact?.version !== manifest.version || typeof rootArtifact?.tarballUrl !== "string" || typeof rootArtifact?.integrity !== "string") fail("LEDGER_ROOT_ARTIFACT_INVALID", "root artifact evidence is incomplete");
    const entry = { relativePath: "", locked: { version: manifest.version }, manifest, identity, url: normalizeUrl(rootArtifact.tarballUrl), integrity: rootArtifact.integrity, real: root };
    entries.push(entry);
    entriesByPath.set("", entry);
  }
  if (entries.length === 0) fail("LEDGER_EMPTY", "installed package tree is empty");

  const topLevel = new Set(topLevelNames);
  const artifactsByIdentity = new Map();
  for (const entry of entries) {
    const dependencies = [];
    for (const dependencyName of Object.keys(entry.manifest.dependencies ?? {}).sort()) {
      const resolved = resolveDependencyIdentity({ packagePath: entry.relativePath, dependencyName, entriesByPath });
      if (!resolved) fail("LEDGER_DEPENDENCY_UNRESOLVED", `installed dependency is missing: ${entry.identity} -> ${dependencyName}`);
      dependencies.push(resolved);
    }
    const artifact = {
      name: entry.manifest.name,
      version: entry.manifest.version,
      tarballUrl: entry.url,
      integrity: entry.integrity,
      sha256: shaFor(artifactBytes, entry.identity, entry.url),
      license: licenseConclusion(entry.manifest, licenseOverrides),
      packageManifestDigest: sha256(canonicalJson(entry.manifest)),
      lifecycleScripts: lifecycleScripts(entry.manifest),
      dependencies: [...new Set(dependencies)].sort(),
      treeDigest: await artifactTreeDigest(
        artifactTreeRoots,
        entry.identity,
        entry.manifest,
        async () => hashPackageContentTree(entry.real),
      ),
      topLevel: topLevel.has(entry.manifest.name),
    };
    const existing = artifactsByIdentity.get(entry.identity);
    if (existing) {
      const left = { ...existing, dependencies: [], topLevel: false };
      const right = { ...artifact, dependencies: [], topLevel: false };
      if (canonicalJson(left) !== canonicalJson(right)) fail("LEDGER_DUPLICATE_IDENTITY_DRIFT", `same package identity has different evidence: ${entry.identity}`);
      existing.dependencies = [...new Set([...existing.dependencies, ...artifact.dependencies])].sort();
      existing.topLevel ||= artifact.topLevel;
    } else artifactsByIdentity.set(entry.identity, artifact);
  }

  return finalizeArtifactLedger({
    $schema: "../../schemas/transitive-artifact-ledger-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-transitive-artifact-ledger",
    sourceCommit,
    artifacts: [...artifactsByIdentity.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)),
  });
}
