import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "../config-runtime/index.mjs";
import {
  PREVIEW_VERSION,
  PUBLIC_REPOSITORY,
  validateArtifactLedger,
  validateReleaseIndex,
  validateStackManifest,
} from "./contracts.mjs";
import { hashFile } from "./deterministic-archive.mjs";
import { downloadVerified, fetchReleaseJson } from "./downloader.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function boundedJson(file, maxBytes = 16 * 1024 * 1024) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail("RELEASE_METADATA_PATH_UNSAFE", `release metadata must be a bounded regular file: ${path.basename(file)}`);
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { fail("RELEASE_METADATA_JSON_INVALID", `release metadata is not valid JSON: ${path.basename(file)}`); }
}

function publicInspection({ releaseIndex, stackManifest, payloadMode, asset }) {
  return Object.freeze({
    formatVersion: 1,
    kind: "only-my-pi-stack-source-inspection",
    version: releaseIndex.version,
    channel: releaseIndex.channel,
    tag: releaseIndex.tag,
    sourceCommit: releaseIndex.sourceCommit,
    repository: releaseIndex.repository,
    releaseStatus: releaseIndex.status,
    payloadMode,
    asset: Object.freeze({ name: asset.name, bytes: asset.bytes, sha256: asset.sha256 }),
    stackId: stackManifest.stackId,
    stackManifestSha256: releaseIndex.stackManifestSha256,
    stackManifest,
  });
}

function bindRelease(indexInput, manifestInput, { version = null, requirePublished = false, manifestSha256 } = {}) {
  const releaseIndex = validateReleaseIndex(indexInput);
  const stackManifest = validateStackManifest(manifestInput);
  if (version !== null && releaseIndex.version !== version) fail("RELEASE_VERSION_MISMATCH", "release metadata does not match the requested exact version");
  if (requirePublished && releaseIndex.status !== "PUBLISHED") fail("RELEASE_NOT_PUBLISHED", "the requested release is not published");
  if (releaseIndex.sourceCommit !== stackManifest.sourceCommit) fail("RELEASE_SOURCE_BINDING_INVALID", "release index and stack manifest source commits differ");
  if (releaseIndex.stackManifestSha256 !== manifestSha256) {
    fail("RELEASE_STACK_MANIFEST_DIGEST_INVALID", "standalone stack manifest differs from the release index");
  }
  return { releaseIndex, stackManifest };
}

async function verifyExtractedMetadata(root, expected) {
  const [manifestInput, ledgerInput] = await Promise.all([
    boundedJson(path.join(root, "stack-manifest.json")),
    boundedJson(path.join(root, "transitive-artifact-ledger.json"), 64 * 1024 * 1024),
  ]);
  const manifest = validateStackManifest(manifestInput);
  const ledger = validateArtifactLedger(ledgerInput);
  if (canonicalJson(manifest) !== canonicalJson(expected.stackManifest)) fail("RELEASE_ARCHIVE_MANIFEST_DRIFT", "archive stack manifest differs from the reviewed standalone manifest");
  if (ledger.sourceCommit !== manifest.sourceCommit || ledger.ledgerDigest !== manifest.transitiveLedgerSha256) fail("RELEASE_LEDGER_BINDING_INVALID", "archive artifact ledger is not bound to its stack manifest");
  return { manifest, ledger };
}

async function prepareArchive({ archive, inspection, cacheRoot, thinResolver = null }) {
  await fs.mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const extractionRoot = path.join(cacheRoot, `.payload-${crypto.randomUUID()}`);
  await extractVerifiedTarGzip({ archivePath: archive, destination: extractionRoot, expectedSha256: inspection.asset.sha256 });
  const payloadRoot = path.join(extractionRoot, "only-my-pi");
  try {
    const metadata = await verifyExtractedMetadata(payloadRoot, inspection);
    const resolvedRoot = inspection.payloadMode === "full"
      ? payloadRoot
      : await thinResolver?.({ payloadRoot, cacheRoot, inspection, metadata });
    if (typeof resolvedRoot !== "string" || !path.isAbsolute(resolvedRoot)) fail("THIN_RESOLUTION_UNAVAILABLE", "Thin payload resolution is not available in this installation");
    return Object.freeze({ ...inspection, resolvedRoot, cleanup: async () => fs.rm(extractionRoot, { recursive: true, force: true }) });
  } catch (error) {
    await fs.rm(extractionRoot, { recursive: true, force: true });
    throw error;
  }
}

export class LocalReleasePayloadSource {
  constructor({ cacheRoot, thinResolver = null } = {}) {
    if (typeof cacheRoot !== "string" || !path.isAbsolute(cacheRoot)) throw new TypeError("local release source requires an absolute cacheRoot");
    this.cacheRoot = path.resolve(cacheRoot);
    this.thinResolver = thinResolver;
  }

  async inspect({ bundle } = {}) {
    if (typeof bundle !== "string" || !path.isAbsolute(bundle)) fail("RELEASE_BUNDLE_PATH_INVALID", "release bundle must be an explicit absolute path");
    const requestedArchive = path.resolve(bundle);
    const stat = await fs.lstat(requestedArchive).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 2_147_483_648) fail("RELEASE_BUNDLE_PATH_UNSAFE", "release bundle must be a bounded regular file");
    const archive = await fs.realpath(requestedArchive);
    const directory = path.dirname(archive);
    const [indexInput, manifestInput, manifestSha256] = await Promise.all([
      boundedJson(path.join(directory, "release-index.json")),
      boundedJson(path.join(directory, "stack-manifest.json")),
      hashFile(path.join(directory, "stack-manifest.json")),
    ]);
    const { releaseIndex, stackManifest } = bindRelease(indexInput, manifestInput, { manifestSha256 });
    const pair = Object.entries({ full: releaseIndex.assets.full, thin: releaseIndex.assets.thin }).find(([, asset]) => asset.name === path.basename(archive));
    if (!pair) fail("RELEASE_BUNDLE_NOT_INDEXED", "local bundle name is not present in its sibling release index");
    const [payloadMode, asset] = pair;
    if (stat.size !== asset.bytes || await hashFile(archive) !== asset.sha256) fail("RELEASE_BUNDLE_DIGEST_MISMATCH", "local bundle bytes differ from the release index");
    return publicInspection({ releaseIndex, stackManifest, payloadMode, asset });
  }

  async prepare(options = {}) {
    const inspection = await this.inspect(options);
    return prepareArchive({ archive: path.resolve(options.bundle), inspection, cacheRoot: this.cacheRoot, thinResolver: this.thinResolver });
  }
}

function releaseAssetUrl(version, asset) {
  const tag = `v${version}`;
  return `https://github.com/${PUBLIC_REPOSITORY}/releases/download/${tag}/${asset}`;
}

export class GitHubReleasePayloadSource {
  constructor({ cacheRoot, fetchImpl = globalThis.fetch, thinResolver = null } = {}) {
    if (typeof cacheRoot !== "string" || !path.isAbsolute(cacheRoot)) throw new TypeError("GitHub release source requires an absolute cacheRoot");
    this.cacheRoot = path.resolve(cacheRoot);
    this.fetchImpl = fetchImpl;
    this.thinResolver = thinResolver;
  }

  async check({ channel = "preview", currentVersion = PREVIEW_VERSION } = {}) {
    if (channel !== "preview") fail("RELEASE_CHANNEL_UNSUPPORTED", "only the preview channel is supported");
    const url = `https://api.github.com/repos/${PUBLIC_REPOSITORY}/releases?per_page=100`;
    const { document } = await fetchReleaseJson({ url, fetchImpl: this.fetchImpl });
    if (!Array.isArray(document)) fail("RELEASE_DISCOVERY_INVALID", "GitHub release discovery response is invalid");
    const versions = document
      .filter((entry) => entry && entry.draft === false && entry.prerelease === true)
      .map((entry) => /^v(0\.2\.0-preview\.([1-9][0-9]*))$/u.exec(entry.tag_name ?? ""))
      .filter(Boolean)
      .map((match) => ({ version: match[1], sequence: Number(match[2]) }))
      .sort((left, right) => right.sequence - left.sequence);
    const current = /^0\.2\.0-preview\.([1-9][0-9]*)$/u.exec(currentVersion);
    if (!current) fail("RELEASE_VERSION_INVALID", "installed Preview version is invalid");
    const latest = versions[0]?.version ?? null;
    const update = versions.find((entry) => entry.sequence > Number(current[1]))?.version ?? null;
    return Object.freeze({
      formatVersion: 1,
      ok: true,
      status: update ? "UPDATE_AVAILABLE" : "CURRENT",
      code: update ? "UPDATE_AVAILABLE" : "CURRENT",
      message: update ? `Preview ${update} is available` : "No newer Preview release is available",
      next: update ? `omp stack update --release ${update}` : null,
      mutation: false,
      channel,
      currentVersion,
      latestVersion: latest,
      updateVersion: update,
      cacheWritten: false,
    });
  }

  async inspect({ release, payload = "thin" } = {}) {
    if (release !== PREVIEW_VERSION) fail("RELEASE_VERSION_UNSUPPORTED", `this installer supports exact release ${PREVIEW_VERSION}`);
    if (!["full", "thin"].includes(payload)) fail("PAYLOAD_MODE_INVALID", "payload must be full or thin");
    const [indexResponse, manifestResponse] = await Promise.all([
      fetchReleaseJson({ url: releaseAssetUrl(release, "release-index.json"), fetchImpl: this.fetchImpl }),
      fetchReleaseJson({ url: releaseAssetUrl(release, "stack-manifest.json"), fetchImpl: this.fetchImpl }),
    ]);
    const { releaseIndex, stackManifest } = bindRelease(indexResponse.document, manifestResponse.document, { version: release, requirePublished: true, manifestSha256: manifestResponse.sha256 });
    return publicInspection({ releaseIndex, stackManifest, payloadMode: payload, asset: releaseIndex.assets[payload] });
  }

  async prepare(options = {}) {
    const inspection = await this.inspect(options);
    await fs.mkdir(this.cacheRoot, { recursive: true, mode: 0o700 });
    const archive = path.join(this.cacheRoot, `.download-${crypto.randomUUID()}.tar.gz`);
    try {
      const downloaded = await downloadVerified({
        url: releaseAssetUrl(options.release, inspection.asset.name),
        destination: archive,
        expectedSha256: inspection.asset.sha256,
        maxBytes: inspection.asset.bytes,
        fetchImpl: this.fetchImpl,
      });
      if (downloaded.bytes !== inspection.asset.bytes) fail("RELEASE_ASSET_SIZE_MISMATCH", "downloaded release asset size differs from the release index");
      const prepared = await prepareArchive({ archive, inspection, cacheRoot: this.cacheRoot, thinResolver: this.thinResolver });
      return Object.freeze({ ...prepared, cleanup: async () => { await prepared.cleanup(); await fs.rm(archive, { force: true }); } });
    } catch (error) {
      await fs.rm(archive, { force: true });
      throw error;
    }
  }
}

export function createLocalReleasePayloadSource(options) {
  return new LocalReleasePayloadSource(options);
}

export function createGitHubReleasePayloadSource(options) {
  return new GitHubReleasePayloadSource(options);
}
