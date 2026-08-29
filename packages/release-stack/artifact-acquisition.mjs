import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import { sha256 } from "./contracts.mjs";
import { downloadVerified, fetchReleaseJson, validateDownloadUrl } from "./downloader.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";

const SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function identity(manifest) {
  if (typeof manifest?.name !== "string" || typeof manifest?.version !== "string") fail("RELEASE_ARTIFACT_MANIFEST_INVALID", "package manifest has no exact identity");
  return `${manifest.name}@${manifest.version}`;
}

function registryMetadataUrl(name, version) {
  return `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

function validateTarballUrl(raw) {
  const url = validateDownloadUrl(raw, { allowedHosts: ["registry.npmjs.org"] });
  if (url.search || !url.pathname.endsWith(".tgz")) fail("RELEASE_ARTIFACT_URL_INVALID", "registry artifact URL must be an exact credential-free tarball URL");
  return url.href;
}

async function readJsonFile(target, code) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 64 * 1024 * 1024) fail(code, `release artifact input is unsafe: ${path.basename(target)}`);
  try { return JSON.parse(await fs.readFile(target, "utf8")); }
  catch { fail(code, `release artifact input is invalid JSON: ${path.basename(target)}`); }
}

async function installedEntries({ npmRoot, lockPath, rootArtifact = null }) {
  const root = await fs.realpath(npmRoot);
  if (root !== path.resolve(npmRoot)) fail("RELEASE_ARTIFACT_ROOT_UNSAFE", "installed package root must be canonical");
  const lock = await readJsonFile(lockPath, "RELEASE_ARTIFACT_LOCK_INVALID");
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") fail("RELEASE_ARTIFACT_LOCK_INVALID", "package lock must use lockfileVersion 3");
  const entries = [];
  for (const [relativePath, locked] of Object.entries(lock.packages)) {
    if (relativePath === "" || !relativePath.includes("node_modules/")) continue;
    const absolute = path.resolve(root, ...relativePath.split("/"));
    if (absolute === root || !absolute.startsWith(`${root}${path.sep}`)) fail("RELEASE_ARTIFACT_PATH_UNSAFE", "package lock path escapes its installed root");
    const real = await fs.realpath(absolute).catch((error) => error?.code === "ENOENT" && locked.optional === true ? null : Promise.reject(error));
    if (real === null) continue;
    if (real !== absolute) fail("RELEASE_ARTIFACT_PATH_UNSAFE", "installed package path is a symlink");
    const manifest = await readJsonFile(path.join(real, "package.json"), "RELEASE_ARTIFACT_MANIFEST_INVALID");
    if (manifest.version !== locked.version) fail("RELEASE_ARTIFACT_LOCK_DRIFT", `installed package differs from lock: ${identity(manifest)}`);
    entries.push({ identity: identity(manifest), name: manifest.name, version: manifest.version, manifest, tarballUrl: validateTarballUrl(locked.resolved), integrity: locked.integrity ?? null });
  }
  if (rootArtifact !== null) {
    const manifest = await readJsonFile(path.join(root, "package.json"), "RELEASE_ARTIFACT_MANIFEST_INVALID");
    if (manifest.name !== rootArtifact.name || manifest.version !== rootArtifact.version || !SRI.test(rootArtifact.integrity ?? "")) fail("RELEASE_ROOT_ARTIFACT_INVALID", "root package artifact evidence is incomplete");
    entries.push({ identity: identity(manifest), name: manifest.name, version: manifest.version, manifest, tarballUrl: validateTarballUrl(rootArtifact.tarballUrl), integrity: rootArtifact.integrity });
  }
  return entries;
}

async function completeIntegrity(entry, metadata) {
  if (SRI.test(entry.integrity ?? "")) return entry;
  const result = await metadata({ url: registryMetadataUrl(entry.name, entry.version), maxBytes: 4 * 1024 * 1024, allowedHosts: ["registry.npmjs.org"] });
  const tarballUrl = validateTarballUrl(result.document?.dist?.tarball);
  const integrity = result.document?.dist?.integrity;
  if (tarballUrl !== entry.tarballUrl || !SRI.test(integrity ?? "")) fail("RELEASE_ARTIFACT_METADATA_DRIFT", `registry metadata does not bind the locked artifact: ${entry.identity}`);
  return { ...entry, integrity };
}

function resolutionEvidence(entry) {
  return { identity: entry.identity, name: entry.name, version: entry.version, tarballUrl: entry.tarballUrl, integrity: entry.integrity };
}

async function packageRoot(extracted, expected) {
  const entries = await fs.readdir(extracted, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].isSymbolicLink()) fail("RELEASE_ARTIFACT_LAYOUT_INVALID", `registry artifact has an unexpected layout: ${expected.identity}`);
  const root = path.join(extracted, entries[0].name);
  const manifest = await readJsonFile(path.join(root, "package.json"), "RELEASE_ARTIFACT_MANIFEST_INVALID");
  if (identity(manifest) !== expected.identity || canonicalJson(manifest) !== canonicalJson(expected.manifest)) fail("RELEASE_ARTIFACT_CONTENT_DRIFT", `registry artifact content differs from installed package: ${expected.identity}`);
  return root;
}

export async function acquireInstalledArtifacts({
  roots,
  outputRoot,
  download = downloadVerified,
  fetchMetadata = fetchReleaseJson,
  extract = extractVerifiedTarGzip,
} = {}) {
  if (!Array.isArray(roots) || roots.length === 0 || typeof outputRoot !== "string" || !path.isAbsolute(outputRoot)) throw new TypeError("artifact acquisition requires installed roots and an absolute outputRoot");
  if (await fs.lstat(outputRoot).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("RELEASE_ARTIFACT_OUTPUT_EXISTS", "artifact acquisition output must not exist");
  await fs.mkdir(path.join(outputRoot, "downloads"), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(outputRoot, "trees"), { recursive: true, mode: 0o700 });
  const rawEntries = (await Promise.all(roots.map(installedEntries))).flat();
  const byIdentity = new Map();
  for (const raw of rawEntries) {
    const entry = await completeIntegrity(raw, fetchMetadata);
    const prior = byIdentity.get(entry.identity);
    if (prior && canonicalJson(resolutionEvidence(prior)) !== canonicalJson(resolutionEvidence(entry))) fail("RELEASE_ARTIFACT_IDENTITY_DRIFT", `same package identity resolves to different artifacts: ${entry.identity}`);
    byIdentity.set(entry.identity, prior ?? entry);
  }
  const artifactBytes = new Map();
  const artifactTreeRoots = new Map();
  const integrityOverrides = {};
  const artifacts = [];
  for (const entry of [...byIdentity.values()].sort((left, right) => left.identity.localeCompare(right.identity))) {
    const key = sha256(entry.identity).slice("sha256:".length);
    const archive = path.join(outputRoot, "downloads", `${key}.tgz`);
    const verified = await download({ url: entry.tarballUrl, destination: archive, expectedSri: entry.integrity, maxBytes: MAX_PACKAGE_BYTES, allowedHosts: ["registry.npmjs.org"] });
    const extracted = path.join(outputRoot, "trees", key);
    await extract({ archivePath: archive, destination: extracted, expectedSha256: verified.sha256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
    const tree = await packageRoot(extracted, entry);
    artifactBytes.set(entry.identity, { sha256: verified.sha256 });
    artifactTreeRoots.set(entry.identity, tree);
    integrityOverrides[entry.identity] = entry.integrity;
    artifacts.push({ identity: entry.identity, sha256: verified.sha256, integrity: entry.integrity, tarballUrl: entry.tarballUrl, treeRoot: tree });
  }
  return Object.freeze({ artifactBytes, artifactTreeRoots, integrityOverrides: Object.freeze(integrityOverrides), artifacts: Object.freeze(artifacts) });
}
