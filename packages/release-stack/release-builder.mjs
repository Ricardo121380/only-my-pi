import fs from "node:fs/promises";
import path from "node:path";

import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { canonicalJson } from "../config-runtime/index.mjs";
import {
  EMBEDDED_NODE_VERSION,
  PREVIEW_TAG,
  PREVIEW_VERSION,
  PUBLIC_REPOSITORY,
  packageTupleDigest,
  sha256,
  validateArtifactLedger,
  validateReleaseIndex,
  validateStackManifest,
} from "./contracts.mjs";
import { createDeterministicTarGzip, hashFile } from "./deterministic-archive.mjs";
import { validateSpdxSbom } from "./sbom.mjs";

const REQUIRED_METADATA = Object.freeze([
  "stack-manifest.json",
  "transitive-artifact-ledger.json",
  "sbom.spdx.json",
  "THIRD_PARTY_NOTICES.txt",
  "install.sh",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realDirectory(target, code) {
  const real = await fs.realpath(target).catch(() => null);
  const sourceStat = await fs.lstat(target).catch(() => null);
  if (!real || !sourceStat?.isDirectory() || sourceStat.isSymbolicLink()) fail(code, `directory is missing or a symlink: ${path.basename(target)}`);
  const stat = await fs.lstat(real);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, `expected a real directory: ${path.basename(target)}`);
  return real;
}

async function boundedFile(root, relative, { maxBytes = 64 * 1024 * 1024 } = {}) {
  const target = path.resolve(root, ...relative.split("/"));
  if (!inside(root, target)) fail("RELEASE_METADATA_PATH_UNSAFE", `release metadata escapes payload root: ${relative}`);
  const real = await fs.realpath(target).catch(() => null);
  if (real !== target || !inside(root, real)) fail("RELEASE_METADATA_PATH_UNSAFE", `release metadata is missing or a symlink: ${relative}`);
  const stat = await fs.lstat(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail("RELEASE_METADATA_PATH_UNSAFE", `release metadata is not a bounded regular file: ${relative}`);
  return target;
}

async function jsonFile(root, relative, options) {
  const target = await boundedFile(root, relative, options);
  try { return JSON.parse(await fs.readFile(target, "utf8")); }
  catch { fail("RELEASE_METADATA_JSON_INVALID", `release metadata is not JSON: ${relative}`); }
}

async function treeDigest(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

export async function inspectResolvedStack({ resolvedRoot, stackManifest } = {}) {
  if (typeof resolvedRoot !== "string" || !path.isAbsolute(resolvedRoot)) throw new TypeError("inspectResolvedStack requires an absolute resolvedRoot");
  const root = await realDirectory(path.resolve(resolvedRoot), "RESOLVED_STACK_ROOT_UNSAFE");
  const stack = validateStackManifest(stackManifest);
  for (const directory of ["node", "pi", "external-npm"]) await realDirectory(path.join(root, directory), "RESOLVED_STACK_ROOT_UNSAFE");
  const onlyMyPi = await boundedFile(root, "only-my-pi.tgz", { maxBytes: 512 * 1024 * 1024 });
  const identities = {
    nodeTreeDigest: await treeDigest(root, "node"),
    piTreeDigest: await treeDigest(root, "pi"),
    externalTreeDigest: await treeDigest(root, "external-npm"),
    onlyMyPiArtifactSha256: await hashFile(onlyMyPi),
    externalPackages: {},
  };
  for (const entry of stack.externalPackages) {
    const relative = path.posix.join("external-npm", "node_modules", entry.name);
    identities.externalPackages[entry.name] = await treeDigest(root, relative);
  }
  if (identities.nodeTreeDigest !== stack.runtime.node.treeDigest
    || identities.piTreeDigest !== stack.runtime.pi.treeDigest
    || identities.externalTreeDigest !== stack.externalTreeDigest
    || identities.onlyMyPiArtifactSha256 !== stack.onlyMyPi.artifactSha256) {
    fail("RESOLVED_STACK_IDENTITY_MISMATCH", "resolved stack tree differs from its canonical manifest", { identities });
  }
  for (const entry of stack.externalPackages) if (identities.externalPackages[entry.name] !== entry.treeDigest) fail("RESOLVED_STACK_PACKAGE_MISMATCH", `resolved external package differs: ${entry.name}`);
  return Object.freeze({ stackId: stack.stackId, ...identities });
}

export async function assertPayloadConvergence({ fullResolvedRoot, thinResolvedRoot, stackManifest } = {}) {
  const [full, thin] = await Promise.all([
    inspectResolvedStack({ resolvedRoot: fullResolvedRoot, stackManifest }),
    inspectResolvedStack({ resolvedRoot: thinResolvedRoot, stackManifest }),
  ]);
  if (canonicalJson(full) !== canonicalJson(thin)) fail("PAYLOAD_CONVERGENCE_FAILED", "Full and Thin resolved to different stack identities", { full, thin });
  return Object.freeze({ ok: true, status: "PAYLOADS_CONVERGED", stackId: full.stackId, identities: full });
}

export async function inspectFullThinPayloadInputs({ fullPayloadRoot, thinPayloadRoot, thinResolvedRoot } = {}) {
  if (![fullPayloadRoot, thinPayloadRoot, thinResolvedRoot].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("release payload input paths must be absolute");
  const [fullMetadata, thinMetadata] = await Promise.all([
    validatePayloadMetadata(fullPayloadRoot),
    validatePayloadMetadata(thinPayloadRoot),
  ]);
  if (canonicalJson(fullMetadata.stackManifest) !== canonicalJson(thinMetadata.stackManifest)
    || canonicalJson(fullMetadata.ledger) !== canonicalJson(thinMetadata.ledger)
    || canonicalJson(fullMetadata.sbom) !== canonicalJson(thinMetadata.sbom)) {
    fail("PAYLOAD_METADATA_DIVERGENCE", "Full and Thin metadata differs");
  }
  await validateThinResolutionInputs(thinMetadata.root, fullMetadata.stackManifest, thinMetadata.ledger);
  const convergence = await assertPayloadConvergence({ fullResolvedRoot: fullMetadata.root, thinResolvedRoot, stackManifest: fullMetadata.stackManifest });
  return Object.freeze({ fullMetadata, thinMetadata, convergence });
}

async function validatePayloadMetadata(payloadRoot) {
  const root = await realDirectory(path.resolve(payloadRoot), "RELEASE_PAYLOAD_ROOT_UNSAFE");
  for (const relative of REQUIRED_METADATA) await boundedFile(root, relative);
  await realDirectory(path.join(root, "LICENSES"), "RELEASE_LICENSES_MISSING");
  const [stackManifest, ledger, sbom] = await Promise.all([
    jsonFile(root, "stack-manifest.json"),
    jsonFile(root, "transitive-artifact-ledger.json"),
    jsonFile(root, "sbom.spdx.json"),
  ]);
  const stack = validateStackManifest(stackManifest);
  const artifacts = validateArtifactLedger(ledger);
  if (artifacts.sourceCommit !== stack.sourceCommit || artifacts.ledgerDigest !== stack.transitiveLedgerSha256) fail("RELEASE_LEDGER_BINDING_INVALID", "artifact ledger is not bound to the stack manifest");
  validateSpdxSbom(sbom, { stackManifest: stack, ledger: artifacts });
  return Object.freeze({ root, stackManifest: stack, ledger: artifacts, sbom });
}

async function validateThinResolutionInputs(root, stack, ledger) {
  const [artifact, packageDocument, lock] = await Promise.all([
    boundedFile(root, "only-my-pi.tgz", { maxBytes: 512 * 1024 * 1024 }),
    jsonFile(root, "resolution/external/package.json", { maxBytes: 1024 * 1024 }),
    jsonFile(root, "resolution/external/package-lock.json", { maxBytes: 64 * 1024 * 1024 }),
  ]);
  if (await hashFile(artifact) !== stack.onlyMyPi.artifactSha256) fail("THIN_OMP_ARTIFACT_MISMATCH", "Thin only-my-pi artifact differs from the stack manifest");
  const expectedDependencies = Object.fromEntries(stack.externalPackages.map((entry) => [entry.name, entry.version]).sort(([left], [right]) => left.localeCompare(right)));
  if (packageDocument?.private !== true || packageDocument.name !== "only-my-pi-external-stack" || canonicalJson(packageDocument.dependencies) !== canonicalJson(expectedDependencies)) fail("THIN_PACKAGE_MANIFEST_INVALID", "Thin external package manifest does not select the exact nine-package tuple");
  if (lock?.lockfileVersion !== 3 || !lock.packages || canonicalJson(lock.packages[""]?.dependencies) !== canonicalJson(expectedDependencies)) fail("THIN_PACKAGE_LOCK_INVALID", "Thin external package lock is invalid or not bound to the exact direct tuple");
  const artifacts = new Map(ledger.artifacts.map((entry) => [`${entry.name}@${entry.version}`, entry]));
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (relative === "") continue;
    if (!relative.startsWith("node_modules/") || entry?.link === true || typeof entry?.version !== "string" || typeof entry?.integrity !== "string") fail("THIN_PACKAGE_LOCK_INVALID", "Thin lock contains an unsupported package entry");
    const pieces = relative.split("node_modules/").at(-1).split("/");
    const name = pieces[0].startsWith("@") ? `${pieces[0]}/${pieces[1]}` : pieces[0];
    const artifactEntry = artifacts.get(`${name}@${entry.version}`);
    if (!artifactEntry || artifactEntry.integrity !== entry.integrity || artifactEntry.tarballUrl !== entry.resolved) fail("THIN_LEDGER_LOCK_MISMATCH", `Thin lock entry is not bound to its artifact ledger: ${name}`);
  }
  for (const direct of stack.externalPackages) {
    const locked = lock.packages[`node_modules/${direct.name}`];
    if (!locked || locked.version !== direct.version || locked.integrity !== direct.integrity) fail("THIN_PACKAGE_LOCK_INVALID", `Thin lock is missing direct package evidence: ${direct.name}`);
  }
  return Object.freeze({ artifact, packageDocument, lock });
}

async function copyAsset(source, outputRoot, name, mode = 0o600) {
  const target = path.join(outputRoot, name);
  await fs.copyFile(source, target);
  await fs.chmod(target, mode);
  const stat = await fs.lstat(target);
  return Object.freeze({ name, bytes: stat.size, sha256: await hashFile(target), path: target });
}

async function boundedExternalFile(file, { maxBytes = 16 * 1024 * 1024 } = {}) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new TypeError("release asset path must be absolute");
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes || await fs.realpath(file) !== path.resolve(file)) {
    fail("RELEASE_EXTERNAL_ASSET_UNSAFE", `release asset is not a bounded regular file: ${path.basename(file)}`);
  }
  return file;
}

function publicAsset(asset) {
  return { name: asset.name, bytes: asset.bytes, sha256: asset.sha256 };
}

export async function buildFullThinPayloads({
  fullPayloadRoot,
  thinPayloadRoot,
  thinResolvedRoot,
  outputRoot,
  protectedReceiptPath,
  protectedEvidenceDigest,
  status = "RC",
} = {}) {
  if (![fullPayloadRoot, thinPayloadRoot, thinResolvedRoot, outputRoot, protectedReceiptPath].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("release builder paths must be absolute");
  const { fullMetadata, thinMetadata, convergence } = await inspectFullThinPayloadInputs({ fullPayloadRoot, thinPayloadRoot, thinResolvedRoot });
  const stack = fullMetadata.stackManifest;
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const fullName = `only-my-pi-${PREVIEW_VERSION}-darwin-arm64-full.tar.gz`;
  const thinName = `only-my-pi-${PREVIEW_VERSION}-darwin-arm64-thin.tar.gz`;
  const [fullArchive, thinArchive] = await Promise.all([
    createDeterministicTarGzip({ rootDir: fullMetadata.root, outputPath: path.join(outputRoot, fullName), rootName: "only-my-pi" }),
    createDeterministicTarGzip({ rootDir: thinMetadata.root, outputPath: path.join(outputRoot, thinName), rootName: "only-my-pi" }),
  ]);
  const install = await copyAsset(path.join(thinMetadata.root, "install.sh"), outputRoot, "install.sh", 0o700);
  const sbom = await copyAsset(path.join(thinMetadata.root, "sbom.spdx.json"), outputRoot, `only-my-pi-${PREVIEW_VERSION}.spdx.json`);
  const notices = await copyAsset(path.join(thinMetadata.root, "THIRD_PARTY_NOTICES.txt"), outputRoot, "THIRD_PARTY_NOTICES.txt");
  const receiptSource = await boundedExternalFile(protectedReceiptPath);
  if (await hashFile(receiptSource) !== protectedEvidenceDigest) fail("PROTECTED_EVIDENCE_DIGEST_MISMATCH", "protected receipt bytes differ from the release evidence digest");
  const receipt = await copyAsset(receiptSource, outputRoot, `only-my-pi-${PREVIEW_VERSION}-protected-receipt.json`);
  const standaloneManifest = await copyAsset(path.join(thinMetadata.root, "stack-manifest.json"), outputRoot, "stack-manifest.json");
  const ledger = await copyAsset(path.join(thinMetadata.root, "transitive-artifact-ledger.json"), outputRoot, "transitive-artifact-ledger.json");
  const archiveAssets = [
    { ...fullArchive, name: fullName },
    { ...thinArchive, name: thinName },
  ];
  const checksumInputs = [...archiveAssets, install, sbom, notices, receipt, standaloneManifest, ledger].sort((left, right) => left.name.localeCompare(right.name));
  const checksumsPath = path.join(outputRoot, "SHA256SUMS");
  await fs.writeFile(checksumsPath, checksumInputs.map((entry) => `${entry.sha256.slice("sha256:".length)}  ${entry.name}`).join("\n") + "\n", { mode: 0o600 });
  const checksumsStat = await fs.lstat(checksumsPath);
  const checksums = { name: "SHA256SUMS", bytes: checksumsStat.size, sha256: await hashFile(checksumsPath), path: checksumsPath };
  const releaseIndex = validateReleaseIndex({
    $schema: "../../schemas/release-index-v1.schema.json",
    formatVersion: 1,
    kind: "only-my-pi-release-index",
    version: PREVIEW_VERSION,
    channel: "preview",
    tag: PREVIEW_TAG,
    sourceCommit: stack.sourceCommit,
    repository: PUBLIC_REPOSITORY,
    platform: stack.platform,
    stackManifestSha256: standaloneManifest.sha256,
    bootstrap: { asset: install.name, sha256: install.sha256 },
    assets: {
      full: publicAsset({ ...fullArchive, name: fullName }),
      thin: publicAsset({ ...thinArchive, name: thinName }),
      sbom: publicAsset(sbom),
      notices: publicAsset(notices),
      checksums: publicAsset(checksums),
      receipt: publicAsset(receipt),
    },
    protectedEvidenceDigest,
    supportedStack: { nodeVersion: EMBEDDED_NODE_VERSION, piVersion: stack.runtime.pi.version, packageTupleDigest: packageTupleDigest() },
    status,
  });
  const releaseIndexPath = path.join(outputRoot, "release-index.json");
  await fs.writeFile(releaseIndexPath, `${JSON.stringify(releaseIndex, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({
    ok: true,
    status: "RELEASE_PAYLOADS_BUILT",
    stackId: stack.stackId,
    convergence,
    releaseIndex,
    assets: Object.freeze({ full: archiveAssets[0], thin: archiveAssets[1], install, sbom, notices, receipt, checksums, standaloneManifest, ledger, releaseIndex: { name: "release-index.json", path: releaseIndexPath, sha256: await hashFile(releaseIndexPath) } }),
  });
}
