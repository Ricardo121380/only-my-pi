import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { acquireInstalledArtifacts } from "./artifact-acquisition.mjs";
import {
  CONTROLLED_PI_INTEGRITY,
  CONTROLLED_PI_VERSION,
  EMBEDDED_NODE_ARCHIVE_SHA256,
  EMBEDDED_NODE_VERSION,
  sha256,
} from "./contracts.mjs";
import { createDeterministicTarGzip, hashFile } from "./deterministic-archive.mjs";
import { downloadVerified } from "./downloader.mjs";
import { assembleReleasePayloads } from "./payload-assembler.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";
import { prepareEnvironment, scrubbedEnvironment } from "./thin-resolver.mjs";

const execFile = promisify(execFileCallback);
const COMMIT = /^[a-f0-9]{40}$/u;
const NODE_ARCHIVE = `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64.tar.gz`;
const NODE_URL = `https://nodejs.org/download/release/v${EMBEDDED_NODE_VERSION}/${NODE_ARCHIVE}`;
const PI_NAME = "@earendil-works/pi-coding-agent";
const PI_URL = `https://registry.npmjs.org/${PI_NAME}/-/pi-coding-agent-${CONTROLLED_PI_VERSION}.tgz`;
const MAX_OUTPUT = 16 * 1024 * 1024;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function defaultSourceInspector(rootDir) {
  const [{ stdout: head }, { stdout: status }] = await Promise.all([
    execFile("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8", maxBuffer: MAX_OUTPUT }),
    execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: rootDir, encoding: "utf8", maxBuffer: MAX_OUTPUT }),
  ]);
  return { head: head.trim(), clean: status.trim() === "" };
}

async function runNode(node, argv, options = {}) {
  try {
    return await execFile(node, argv, { cwd: options.cwd, env: options.env, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: MAX_OUTPUT });
  } catch (cause) {
    fail("RELEASE_STAGE_COMMAND_FAILED", "scripts-disabled release staging command failed", { cause });
  }
}

async function realDirectory(target, code) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== path.resolve(target)) fail(code, `release staging directory is unsafe: ${path.basename(target)}`);
  return path.resolve(target);
}

async function outputMissing(target) {
  return await fs.lstat(target).then(() => false, (error) => error?.code === "ENOENT" ? true : Promise.reject(error));
}

function outside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative.startsWith("..") && !path.isAbsolute(relative);
}

async function singleDirectory(root, expectedName) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== expectedName || !entries[0].isDirectory() || entries[0].isSymbolicLink()) fail("RELEASE_NODE_LAYOUT_INVALID", "official Node archive has an unexpected root layout");
  return path.join(root, expectedName);
}

async function boundedFile(target, code, maxBytes = 512 * 1024 * 1024) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail(code, `release staging file is unsafe: ${path.basename(target)}`);
  return target;
}

async function installNode({ work, resolved, download, extract }) {
  const downloads = path.join(work, "downloads");
  const archive = path.join(downloads, NODE_ARCHIVE);
  const extracted = path.join(work, "node-archive");
  await download({ url: NODE_URL, destination: archive, expectedSha256: EMBEDDED_NODE_ARCHIVE_SHA256, maxBytes: 256 * 1024 * 1024, allowedHosts: ["nodejs.org"] });
  await extract({ archivePath: archive, destination: extracted, expectedSha256: EMBEDDED_NODE_ARCHIVE_SHA256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  await fs.rename(await singleDirectory(extracted, `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64`), path.join(resolved, "node"));
  const node = await boundedFile(path.join(resolved, "node", "bin", "node"), "RELEASE_NODE_BINARY_INVALID");
  const npm = await boundedFile(path.join(resolved, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js"), "RELEASE_NPM_CLI_INVALID", 32 * 1024 * 1024);
  return { node, npm, archive };
}

async function installExternal({ rootDir, resolved, node, npm, env, run }) {
  const external = path.join(resolved, "external-npm");
  await fs.mkdir(external, { mode: 0o700 });
  const contract = path.join(rootDir, "contracts", "release", "external");
  await Promise.all([
    fs.copyFile(await boundedFile(path.join(contract, "package.json"), "RELEASE_EXTERNAL_CONTRACT_INVALID", 1024 * 1024), path.join(external, "package.json")),
    fs.copyFile(await boundedFile(path.join(contract, "package-lock.json"), "RELEASE_EXTERNAL_CONTRACT_INVALID", 64 * 1024 * 1024), path.join(external, "package-lock.json")),
  ]);
  await run(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps"], { cwd: external, env });
  return external;
}

async function installPi({ work, resolved, node, npm, env, run, download, extract }) {
  const archive = path.join(work, "downloads", "pi-coding-agent.tgz");
  const extracted = path.join(work, "pi-artifact");
  const verified = await download({ url: PI_URL, destination: archive, expectedSri: CONTROLLED_PI_INTEGRITY, maxBytes: 512 * 1024 * 1024, allowedHosts: ["registry.npmjs.org"] });
  await extract({ archivePath: archive, destination: extracted, expectedSha256: verified.sha256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  const packageRoot = await singleDirectory(extracted, "package");
  const pi = path.join(resolved, "pi");
  await fs.cp(packageRoot, pi, { recursive: true, errorOnExist: true, force: false });
  const lock = await fs.lstat(path.join(pi, "npm-shrinkwrap.json")).then(() => true, () => false);
  if (!lock) fail("RELEASE_PI_LOCK_MISSING", "controlled Pi package does not contain its exact npm shrinkwrap");
  await run(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer"], { cwd: pi, env });
  return { pi, archive, artifactRoot: packageRoot, verified };
}

async function buildOnlyMyPi({ rootDir, sourceCommit, work, resolved, node, npm, env, run, extract }) {
  const packed = await run(node, [npm, "pack", ".", "--ignore-scripts", "--json", "--pack-destination", path.join(work, "downloads")], { cwd: rootDir, env });
  let descriptor;
  try { descriptor = JSON.parse(packed.stdout); }
  catch { fail("RELEASE_OMP_PACK_INVALID", "npm pack did not return JSON"); }
  if (!Array.isArray(descriptor) || descriptor.length !== 1 || typeof descriptor[0].filename !== "string" || path.basename(descriptor[0].filename) !== descriptor[0].filename) fail("RELEASE_OMP_PACK_INVALID", "npm pack returned an invalid artifact descriptor");
  const raw = await boundedFile(path.join(work, "downloads", descriptor[0].filename), "RELEASE_OMP_PACK_INVALID");
  const extracted = path.join(work, "only-my-pi-artifact");
  await extract({ archivePath: raw, destination: extracted, expectedSha256: await hashFile(raw), maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  const packageRoot = await singleDirectory(extracted, "package");
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (manifest.name !== "only-my-pi") fail("RELEASE_OMP_PACK_INVALID", "source artifact is not only-my-pi");
  await fs.writeFile(path.join(packageRoot, "artifact-identity.json"), `${JSON.stringify({ formatVersion: 1, kind: "only-my-pi-source-identity", sourceCommit }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  const output = path.join(resolved, "only-my-pi.tgz");
  await createDeterministicTarGzip({ rootDir: packageRoot, outputPath: output, rootName: "package" });
  return output;
}

async function copyLicense(source, destination) {
  const stat = await fs.lstat(source).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > 4 * 1024 * 1024) fail("RELEASE_LICENSE_TEXT_MISSING", `license text is unsafe: ${path.basename(source)}`);
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
}

async function collectLicenses({ resolved, artifacts, output }) {
  await fs.mkdir(output, { mode: 0o700 });
  await copyLicense(path.join(resolved, "node", "LICENSE"), path.join(output, `Node-${EMBEDDED_NODE_VERSION}-LICENSE.txt`));
  for (const [identity, root] of [...artifacts.artifactTreeRoots].sort(([left], [right]) => left.localeCompare(right))) {
    const names = await fs.readdir(root);
    const candidate = names.sort().find((name) => /^(licen[cs]e|copying)(\.[A-Za-z0-9._-]+)?$/iu.test(name));
    if (!candidate) fail("RELEASE_LICENSE_TEXT_MISSING", `registry artifact has no root license text: ${identity}`);
    const filename = `${sha256(identity).slice("sha256:".length, "sha256:".length + 16)}-${identity.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}-LICENSE.txt`;
    await copyLicense(path.join(root, candidate), path.join(output, filename));
  }
  return output;
}

async function defaultPrepare({ rootDir, sourceCommit, outputRoot, download, extract, run, acquire, assemble }) {
  const work = outputRoot;
  const resolved = path.join(work, "resolved");
  await fs.mkdir(path.join(work, "downloads"), { recursive: true, mode: 0o700 });
  await fs.mkdir(resolved, { mode: 0o700 });
  const runtime = await installNode({ work, resolved, download, extract });
  const environment = scrubbedEnvironment(path.join(work, "environment"), path.dirname(runtime.node), { offline: false });
  await prepareEnvironment(environment);
  const external = await installExternal({ rootDir, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run });
  const pi = await installPi({ work, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run, download, extract });
  await buildOnlyMyPi({ rootDir, sourceCommit, work, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run, extract });
  const artifacts = await acquire({
    roots: [
      { npmRoot: external, lockPath: path.join(external, "package-lock.json") },
      { npmRoot: pi.pi, lockPath: path.join(pi.pi, "npm-shrinkwrap.json"), rootArtifact: { name: PI_NAME, version: CONTROLLED_PI_VERSION, tarballUrl: PI_URL, integrity: CONTROLLED_PI_INTEGRITY } },
    ],
    outputRoot: path.join(work, "artifacts"),
    download,
    extract,
  });
  const licenses = await collectLicenses({ resolved, artifacts, output: path.join(work, "licenses") });
  const generation = await buildGenerationPlan({ rootDir, profileId: "daily", sourceCommit });
  return await assemble({
    resolvedRoot: resolved,
    outputRoot: path.join(work, "payloads"),
    sourceCommit,
    generationTargetGraphDigest: generation.graphDigest,
    piIntegrity: CONTROLLED_PI_INTEGRITY,
    artifactBytes: artifacts.artifactBytes,
    artifactTreeRoots: artifacts.artifactTreeRoots,
    integrityOverrides: artifacts.integrityOverrides,
    installScriptPath: path.join(rootDir, "distribution", "install.sh"),
    licensesRoot: licenses,
  });
}

export class ReleasePayloadStager {
  constructor({ rootDir, sourceInspector = defaultSourceInspector, prepare = defaultPrepare, download = downloadVerified, extract = extractVerifiedTarGzip, run = runNode, acquire = acquireInstalledArtifacts, assemble = assembleReleasePayloads } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("release payload stager requires an absolute rootDir");
    this.rootDir = path.resolve(rootDir);
    Object.assign(this, { sourceInspector, prepare, download, extract, run, acquire, assemble });
  }

  async plan({ sourceCommit, outputRoot } = {}) {
    if (!COMMIT.test(sourceCommit ?? "") || typeof outputRoot !== "string" || !path.isAbsolute(outputRoot) || !outside(this.rootDir, outputRoot)) fail("RELEASE_STAGE_ARGUMENT_INVALID", "release stage requires an exact source and a non-repository absolute output root");
    const parent = await realDirectory(path.dirname(outputRoot), "RELEASE_STAGE_PARENT_UNSAFE");
    if (parent !== path.dirname(path.resolve(outputRoot)) || !(await outputMissing(outputRoot))) fail("RELEASE_STAGE_OUTPUT_EXISTS", "release stage output must not exist");
    const source = await this.sourceInspector(this.rootDir);
    if (source.head !== sourceCommit || source.clean !== true) fail("RELEASE_STAGE_SOURCE_NOT_CLEAN", "release stage requires a clean checkout at the exact source commit");
    const plan = { formatVersion: 1, kind: "only-my-pi-release-stage-plan", mutation: false, status: "RELEASE_STAGE_PLANNED", sourceCommit, outputClass: "EXPLICIT_NON_REPOSITORY_DIRECTORY", networkHosts: ["nodejs.org", "registry.npmjs.org"], lifecycleScriptsDisabled: true };
    return Object.freeze({ ...plan, planDigest: sha256(JSON.stringify(plan)) });
  }

  async apply(options, reviewedPlan) {
    const plan = await this.plan(options);
    if (plan.planDigest !== reviewedPlan?.planDigest) fail("RELEASE_STAGE_PLAN_DRIFT", "release stage inputs changed after review");
    const output = path.resolve(options.outputRoot);
    await fs.mkdir(output, { mode: 0o700 });
    try {
      const staged = await this.prepare({ rootDir: this.rootDir, sourceCommit: options.sourceCommit, outputRoot: output, download: this.download, extract: this.extract, run: this.run, acquire: this.acquire, assemble: this.assemble });
      return Object.freeze({ ok: true, status: "RELEASE_PAYLOADS_STAGED", mutation: true, sourceCommit: options.sourceCommit, stackId: staged.stackId, outputClass: plan.outputClass, fullPayloadRoot: staged.fullPayloadRoot, thinPayloadRoot: staged.thinPayloadRoot, thinResolvedRoot: staged.thinResolvedRoot });
    } catch (error) {
      await fs.rm(output, { recursive: true, force: true });
      throw error;
    }
  }
}

export function createReleasePayloadStager(options) {
  return new ReleasePayloadStager(options);
}
