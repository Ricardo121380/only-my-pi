import { execFile as execFileCallback } from "node:child_process";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { acquireInstalledArtifacts } from "./artifact-acquisition.mjs";
import {
  CONTROLLED_PI_VERSION,
  EMBEDDED_NODE_ARCHIVE_SHA256,
  EMBEDDED_NODE_VERSION,
  piRuntimeContract,
  sha256,
} from "./contracts.mjs";
import { createDeterministicTarGzip, hashFile } from "./deterministic-archive.mjs";
import { downloadVerified } from "./downloader.mjs";
import { assembleReleasePayloads } from "./payload-assembler.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";
import { prepareEnvironment, scrubbedEnvironment } from "./thin-resolver.mjs";
import { loadPi110Inputs, verifyPi110AcquiredTrees, FROZEN_PI_INPUTS } from "./pi110-materials.mjs";

const execFile = promisify(execFileCallback);
const COMMIT = /^[a-f0-9]{40}$/u;
const NODE_ARCHIVE = `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64.tar.gz`;
const NODE_URL = `https://nodejs.org/download/release/v${EMBEDDED_NODE_VERSION}/${NODE_ARCHIVE}`;
const PI_NAME = "@earendil-works/pi-coding-agent";
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
    fail("RELEASE_STAGE_COMMAND_FAILED", "scripts-disabled release staging command failed", { cause, step: argv[1] ?? "unknown" });
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

export async function installExternal({ rootDir, resolved, node, npm, env, run, externalContract }) {
  const external = path.join(resolved, "external-npm");
  await fs.mkdir(external, { mode: 0o700 });
  const contract = externalContract ?? path.join(rootDir, "contracts", "release", "external");
  await Promise.all([
    fs.copyFile(await boundedFile(path.join(contract, "package.json"), "RELEASE_EXTERNAL_CONTRACT_INVALID", 1024 * 1024), path.join(external, "package.json")),
    fs.copyFile(await boundedFile(path.join(contract, "package-lock.json"), "RELEASE_EXTERNAL_CONTRACT_INVALID", 64 * 1024 * 1024), path.join(external, "package-lock.json")),
  ]);
  await run(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps"], { cwd: external, env });
  return external;
}

export async function installPi({ rootDir, work, resolved, node, npm, env, run, download, extract, piVersion = CONTROLLED_PI_VERSION }) {
  const contract = piRuntimeContract(piVersion);
  const fixed = FROZEN_PI_INPUTS[piVersion] ? await loadPi110Inputs(rootDir, piVersion) : null;
  const archive = path.join(work, "downloads", "pi-coding-agent.tgz");
  const extracted = path.join(work, "pi-artifact");
  const verified = await download({ url: `https://registry.npmjs.org/${PI_NAME}/-/pi-coding-agent-${contract.version}.tgz`, destination: archive, expectedSri: contract.integrity, maxBytes: 512 * 1024 * 1024, allowedHosts: ["registry.npmjs.org"] });
  if (fixed && verified.sha256 !== fixed.inputs.package.sha256) fail(`${FROZEN_PI_INPUTS[piVersion].id.toUpperCase()}_INPUT_DRIFT`, "Pi runtime archive digest differs");
  await extract({ archivePath: archive, destination: extracted, expectedSha256: verified.sha256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  const packageRoot = await singleDirectory(extracted, "package");
  const pi = path.join(resolved, "pi");
  await fs.cp(packageRoot, pi, { recursive: true, errorOnExist: true, force: false });
  const lock = await fs.lstat(path.join(pi, "npm-shrinkwrap.json")).then(() => true, () => false);
  if (!lock && !fixed) fail("RELEASE_PI_LOCK_MISSING", "controlled Pi package does not contain its exact npm shrinkwrap");
  const manifestPath = path.join(pi, "package.json");
  const manifestBytes = await fs.readFile(manifestPath);
  if (fixed && sha256(manifestBytes) !== fixed.inputs.package.manifestSha256) fail(`${FROZEN_PI_INPUTS[piVersion].id.toUpperCase()}_INPUT_DRIFT`, "official Pi runtime metadata differs");
  const productionManifest = JSON.parse((fixed?.files["package.json"] ?? manifestBytes).toString("utf8"));
  if (productionManifest.name !== PI_NAME || productionManifest.version !== contract.version) fail("STACK_PI_IDENTITY_INVALID", "downloaded Pi package does not match the requested runtime");
  delete productionManifest.devDependencies;
  if (fixed) {
    if (lock) fail(`${FROZEN_PI_INPUTS[piVersion].id.toUpperCase()}_INPUT_DRIFT`, "official Pi runtime unexpectedly contains a shrinkwrap");
    await fs.writeFile(path.join(pi, "npm-shrinkwrap.json"), fixed.files["package-lock.json"], { flag: "wx", mode: 0o600 });
    await fs.writeFile(path.join(pi, "omp-runtime-inputs.json"), fixed.bytes, { flag: "wx", mode: 0o600 });
  }
  await fs.writeFile(manifestPath, `${JSON.stringify(productionManifest, null, 2)}\n`, { mode: 0o600 });
  try {
    await run(node, [npm, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer"], { cwd: pi, env });
  } finally {
    await fs.writeFile(manifestPath, manifestBytes, { mode: 0o600 });
  }
  if (fixed && sha256(await fs.readFile(path.join(pi, "npm-shrinkwrap.json"))) !== fixed.inputs.files["package-lock.json"]) fail(`${FROZEN_PI_INPUTS[piVersion].id.toUpperCase()}_INPUT_DRIFT`, "npm changed the frozen Pi lock");
  return { pi, archive, artifactRoot: packageRoot, verified };
}

export async function prepareBundledPty(packageRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (!manifest.dependencies?.["node-pty"]) return;
  // The scripts-disabled, darwin-arm64 release must not rely on postinstall
  // chmod. Normalize only the staged artifact, before hashing and repacking it.
  const dependency = path.join(packageRoot, "node_modules/node-pty");
  const helper = path.join(dependency, "prebuilds/darwin-arm64/spawn-helper");
  const metadata = path.join(dependency, "package.json");
  for (const file of [metadata, helper]) {
    if (await fs.realpath(file) !== path.resolve(file)) fail("RELEASE_PTY_LAYOUT_INVALID", "PTY artifact contains a redirected path");
    await boundedFile(file, "RELEASE_PTY_LAYOUT_INVALID", 4 * 1024 * 1024);
  }
  const installed = JSON.parse(await fs.readFile(metadata, "utf8"));
  if (manifest.dependencies["node-pty"] !== "1.1.0" || installed.name !== "node-pty" || installed.version !== "1.1.0") fail("RELEASE_PTY_VERSION_INVALID", "PTY version must match the reviewed native dependency");
  await fs.chmod(helper, 0o755);
}

export async function verifyBundledRuntime({ packageRoot, node, env, run = runNode }) {
  // Exercise the extracted artifact, never the checkout's dependency graph.
  await run(node, ["--input-type=module", "-e", `
    import { createRequire } from "node:module";
    import path from "node:path";
    const root = process.cwd();
    const require = createRequire(path.join(root, "package.json"));
    const manifest = require("./package.json");
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const relative = path.relative(root, require.resolve(name));
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Bundled dependency escaped artifact");
      require(name);
    }
    if (manifest.dependencies?.["node-pty"]) {
      const pty = require("node-pty");
      await new Promise((resolve, reject) => {
        const child = pty.spawn("/bin/sh", ["-c", "printf OMP_PTY_READY"], {
          name: "xterm-256color", cols: 80, rows: 24, cwd: root,
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }
        });
        let output = "";
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("PTY smoke timed out")); }, 5000);
        child.onData(data => { output = (output + data).slice(-1024); });
        child.onExit(({ exitCode, signal }) => {
          clearTimeout(timeout);
          if (exitCode !== 0 || signal || !output.includes("OMP_PTY_READY")) reject(new Error("PTY smoke failed"));
          else resolve();
        });
      });
    }
  `], { cwd: packageRoot, env });
}

async function buildOnlyMyPi({ rootDir, sourceCommit, work, resolved, node, npm, env, run, extract }) {
  // Build ignored assets explicitly from this clean source before packaging.
  // No dependency lifecycle scripts or implicit npm hooks are executed.
  if (await fs.lstat(path.join(rootDir, "webui/vite.config.ts")).then(() => true, () => false)) {
    await run(node, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "build", "--config", "webui/vite.config.ts"], { cwd: rootDir, env });
    await boundedFile(path.join(rootDir, "webui/dist/index.html"), "RELEASE_WEB_BUILD_MISSING");
    await boundedFile(path.join(rootDir, "webui/dist/dependencies.json"), "RELEASE_WEB_BUILD_MISSING");
  }
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
  await prepareBundledPty(packageRoot);
  await verifyBundledRuntime({ packageRoot, node, env, run });
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

export async function loadLicenseRegistry(rootDir, piVersion = CONTROLLED_PI_VERSION) {
  piRuntimeContract(piVersion);
  const contractRoot = path.join(rootDir, "contracts", "release");
  const registryPath = path.join(contractRoot, piVersion === "1.3.0" ? "license-source-registry-pi130.json" : piVersion === "1.1.0" ? "license-source-registry-pi110.json" : piVersion === "0.85.1" ? "license-source-registry-pi0851.json" : "license-source-registry.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  if (registry?.formatVersion !== 1 || registry.kind !== "only-my-pi-license-source-registry" || !Array.isArray(registry.sources) || !registry.bindings || typeof registry.bindings !== "object" || Array.isArray(registry.bindings)) fail("RELEASE_LICENSE_REGISTRY_INVALID", "license source registry is invalid");
  const sources = new Map();
  for (const entry of registry.sources) {
    if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(entry?.id ?? "") || !/^(MIT|ISC|Apache-2\.0)$/u.test(entry.declaredLicense ?? "") || typeof entry.file !== "string" || path.basename(entry.file) !== entry.file || !/^sha256:[a-f0-9]{64}$/u.test(entry.contentSha256 ?? "") || !/^https:\/\/raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-f0-9]{40}\//u.test(entry.sourceUrl ?? "") || !["EXACT", "ENSURE_TRAILING_NEWLINE", "EXTRACT_LINES_64_87_ENSURE_TRAILING_NEWLINE"].includes(entry.normalization)) fail("RELEASE_LICENSE_REGISTRY_INVALID", "license source entry is invalid");
    if (sources.has(entry.id)) fail("RELEASE_LICENSE_REGISTRY_INVALID", "license source IDs must be unique");
    const file = path.join(contractRoot, "licenses", entry.file);
    if (await hashFile(file) !== entry.contentSha256) fail("RELEASE_LICENSE_SOURCE_DRIFT", `reviewed license text differs from its digest: ${entry.id}`);
    sources.set(entry.id, { ...entry, file });
  }
  for (const [identity, sourceId] of Object.entries(registry.bindings)) if (!/^(@[^/]+\/)?[^@/]+@[^@]+$/u.test(identity) || !sources.has(sourceId)) fail("RELEASE_LICENSE_REGISTRY_INVALID", "license source binding is invalid");
  return { registry, registryPath, sources };
}

export async function collectLicenses({ resolved, artifacts, output, licenseRegistry }) {
  await fs.mkdir(output, { mode: 0o700 });
  await copyLicense(path.join(resolved, "node", "LICENSE"), path.join(output, `Node-${EMBEDDED_NODE_VERSION}-LICENSE.txt`));
  const missingIdentities = [];
  const usedBindings = new Set();
  for (const [identity, root] of [...artifacts.artifactTreeRoots].sort(([left], [right]) => left.localeCompare(right))) {
    const names = await fs.readdir(root);
    const supplementalLicenses = Boolean(FROZEN_PI_INPUTS[licenseRegistry.registry.piVersion]);
    const candidate = names.sort().find((name) => (supplementalLicenses ? /^(licen[cs]e|copying)([.-][A-Za-z0-9._-]+)?$/iu : /^(licen[cs]e|copying)(\.[A-Za-z0-9._-]+)?$/iu).test(name));
    const filename = `${sha256(identity).slice("sha256:".length, "sha256:".length + 16)}-${identity.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}-LICENSE.txt`;
    if (supplementalLicenses) {
      async function supplement(source, target) {
        const stat = await fs.lstat(source);
        if (stat.isDirectory() && !stat.isSymbolicLink()) {
          await fs.mkdir(target, { recursive: true, mode: 0o700 });
          for (const name of (await fs.readdir(source)).sort()) await supplement(path.join(source, name), path.join(target, name));
        } else {
          await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
          await copyLicense(source, target);
        }
      }
      for (const name of names.filter(name => name !== candidate && /license|licence|notice|copying/iu.test(name))) {
        await supplement(path.join(root, name), path.join(output, "SUPPLEMENTAL", filename, name));
      }
    }
    if (candidate) {
      if (licenseRegistry.registry.bindings[identity] !== undefined) fail("RELEASE_LICENSE_BINDING_UNEXPECTED", `license source binding is no longer required: ${identity}`);
      await copyLicense(path.join(root, candidate), path.join(output, filename));
      continue;
    }
    const sourceId = licenseRegistry.registry.bindings[identity];
    const source = licenseRegistry.sources.get(sourceId);
    const manifest = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    if (!source || manifest.license !== source.declaredLicense) { missingIdentities.push(identity); continue; }
    await copyLicense(source.file, path.join(output, filename));
    usedBindings.add(identity);
  }
  if (missingIdentities.length > 0) fail("RELEASE_LICENSE_TEXTS_MISSING", "registry artifacts without root license texts require exact reviewed license sources", { missingIdentities: Object.freeze(missingIdentities) });
  const unusedBindings = Object.keys(licenseRegistry.registry.bindings).filter((identity) => !usedBindings.has(identity)).sort();
  if (unusedBindings.length > 0) fail("RELEASE_LICENSE_BINDINGS_UNUSED", "reviewed license bindings must match the exact resolved artifact set", { unusedBindings: Object.freeze(unusedBindings) });
  await fs.copyFile(licenseRegistry.registryPath, path.join(output, "SOURCE_REGISTRY.json"));
  return output;
}

async function defaultPrepare({ rootDir, sourceCommit, outputRoot, download, extract, run, acquire, assemble, piVersion = CONTROLLED_PI_VERSION }) {
  const piContract = piRuntimeContract(piVersion);
  const work = outputRoot;
  const resolved = path.join(work, "resolved");
  await fs.mkdir(path.join(work, "downloads"), { recursive: true, mode: 0o700 });
  await fs.mkdir(resolved, { mode: 0o700 });
  const runtime = await installNode({ work, resolved, download, extract });
  const environment = scrubbedEnvironment(path.join(work, "environment"), path.dirname(runtime.node), { offline: false });
  await prepareEnvironment(environment);
  const external = await installExternal({ rootDir, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run });
  const pi = await installPi({ rootDir, work, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run, download, extract, piVersion });
  await buildOnlyMyPi({ rootDir, sourceCommit, work, resolved, node: runtime.node, npm: runtime.npm, env: environment.env, run, extract });
  const exceptionDocument = JSON.parse(await fs.readFile(path.join(rootDir, "contracts", "release", "artifact-extraction-exceptions.json"), "utf8"));
  if (exceptionDocument?.formatVersion !== 1 || exceptionDocument.kind !== "only-my-pi-artifact-extraction-exceptions" || !Array.isArray(exceptionDocument.exceptions)) fail("RELEASE_ARTIFACT_EXCEPTION_INVALID", "artifact extraction exception contract is invalid");
  const artifacts = await acquire({
    roots: [
      { npmRoot: external, lockPath: path.join(external, "package-lock.json") },
      { npmRoot: pi.pi, lockPath: path.join(pi.pi, "npm-shrinkwrap.json"), rootArtifact: { name: PI_NAME, version: piVersion, tarballUrl: `https://registry.npmjs.org/${PI_NAME}/-/pi-coding-agent-${piVersion}.tgz`, integrity: piContract.integrity } },
    ],
    outputRoot: path.join(work, "artifacts"),
    duplicateExceptions: exceptionDocument.exceptions,
    download,
    extract,
  });
  const licenseRegistry = await loadLicenseRegistry(rootDir, piVersion);
  if (FROZEN_PI_INPUTS[piVersion]) await verifyPi110AcquiredTrees({ resolved, artifactTreeRoots: artifacts.artifactTreeRoots });
  const licenses = await collectLicenses({ resolved, artifacts, output: path.join(work, "licenses"), licenseRegistry });
  const generation = await buildGenerationPlan({ rootDir, profileId: "daily", sourceCommit });
  return await assemble({
    rootDir,
    resolvedRoot: resolved,
    outputRoot: path.join(work, "payloads"),
    sourceCommit,
    generationTargetGraphDigest: generation.graphDigest,
    piVersion,
    piIntegrity: piContract.integrity,
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

  async plan({ sourceCommit, outputRoot, piVersion = CONTROLLED_PI_VERSION } = {}) {
    const piContract = piRuntimeContract(piVersion);
    if (!COMMIT.test(sourceCommit ?? "") || typeof outputRoot !== "string" || !path.isAbsolute(outputRoot) || !outside(this.rootDir, outputRoot)) fail("RELEASE_STAGE_ARGUMENT_INVALID", "release stage requires an exact source and a non-repository absolute output root");
    const parent = await realDirectory(path.dirname(outputRoot), "RELEASE_STAGE_PARENT_UNSAFE");
    if (parent !== path.dirname(path.resolve(outputRoot)) || !(await outputMissing(outputRoot))) fail("RELEASE_STAGE_OUTPUT_EXISTS", "release stage output must not exist");
    const source = await this.sourceInspector(this.rootDir);
    if (source.head !== sourceCommit || source.clean !== true) fail("RELEASE_STAGE_SOURCE_NOT_CLEAN", "release stage requires a clean checkout at the exact source commit");
    const fixed = FROZEN_PI_INPUTS[piVersion] ? await loadPi110Inputs(this.rootDir, piVersion) : null;
    if (fixed && `${process.platform}-${process.arch}` !== fixed.inputs.platform) fail(`${FROZEN_PI_INPUTS[piVersion].id.toUpperCase()}_PLATFORM_UNSUPPORTED`, "Pi runtime private preparation requires darwin-arm64");
    const plan = { formatVersion: 1, kind: "only-my-pi-release-stage-plan", mutation: false, status: "RELEASE_STAGE_PLANNED", sourceCommit, piRuntime: piContract,
      ...(fixed ? { piInputSha256: sha256(fixed.bytes), purpose: fixed.inputs.purpose } : {}), outputClass: "EXPLICIT_NON_REPOSITORY_DIRECTORY", networkHosts: ["nodejs.org", "registry.npmjs.org", ...(fixed ? ["github.com"] : [])], lifecycleScriptsDisabled: true };
    return Object.freeze({ ...plan, planDigest: sha256(JSON.stringify(plan)) });
  }

  async apply(options, reviewedPlan) {
    const plan = await this.plan(options);
    if (plan.planDigest !== reviewedPlan?.planDigest) fail("RELEASE_STAGE_PLAN_DRIFT", "release stage inputs changed after review");
    const output = path.resolve(options.outputRoot);
    await fs.mkdir(output, { mode: 0o700 });
    try {
      const staged = await this.prepare({ rootDir: this.rootDir, sourceCommit: options.sourceCommit, outputRoot: output, piVersion: plan.piRuntime.version, download: this.download, extract: this.extract, run: this.run, acquire: this.acquire, assemble: this.assemble });
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
