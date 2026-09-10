import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { EMBEDDED_NODE_ARCHIVE_SHA256, EMBEDDED_NODE_VERSION } from "./contracts.mjs";
import { downloadVerified } from "./downloader.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";
import { inspectResolvedStack } from "./release-builder.mjs";

const NODE_ARCHIVE = `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64.tar.gz`;
const NODE_URL = `https://nodejs.org/download/release/v${EMBEDDED_NODE_VERSION}/${NODE_ARCHIVE}`;
const MAX_OUTPUT = 2 * 1024 * 1024;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function boundedFile(file, maxBytes) {
  const stat = await fs.lstat(file).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail("THIN_INPUT_UNSAFE", `Thin resolution input is unsafe: ${path.basename(file)}`);
  return file;
}

export async function runNode(node, argv, { cwd, env, spawnImpl = spawn } = {}) {
  if (!Array.isArray(argv) || argv.some((entry) => typeof entry !== "string" || /[\0\r\n]/u.test(entry))) fail("THIN_COMMAND_INVALID", "Thin resolver command arguments are invalid");
  return await new Promise((resolve, reject) => {
    const child = spawnImpl(node, argv, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const output = [];
    let bytes = 0;
    const append = (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) { child.kill("SIGTERM"); return; }
      output.push(Buffer.from(chunk));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (bytes > MAX_OUTPUT) return reject(Object.assign(new Error("Thin resolver command output exceeded its bound"), { code: "THIN_COMMAND_OUTPUT_LIMIT" }));
      if (code !== 0) return reject(Object.assign(new Error("Thin resolver scripts-disabled offline command failed"), { code: "THIN_COMMAND_FAILED", exitCode: code, signal, outputDigest: crypto.createHash("sha256").update(Buffer.concat(output)).digest("hex") }));
      resolve(Object.freeze({ ok: true, exitCode: 0 }));
    });
  });
}

async function singleDirectory(root, expectedName) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== expectedName || !entries[0].isDirectory() || entries[0].isSymbolicLink()) fail("NODE_ARCHIVE_LAYOUT_INVALID", "official Node archive has an unexpected root layout");
  return path.join(root, expectedName);
}

function lockPackageName(relativePath) {
  const tail = relativePath.slice(relativePath.lastIndexOf("node_modules/") + "node_modules/".length);
  const segments = tail.split("/");
  return segments[0].startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
}

async function localizeLock(lockPath, downloadedArtifacts) {
  const original = await fs.readFile(lockPath);
  const lock = JSON.parse(original.toString("utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== "object") fail("THIN_LOCK_INVALID", "Thin package lock must use lockfileVersion 3");
  for (const [relativePath, entry] of Object.entries(lock.packages)) {
    if (!relativePath.includes("node_modules/")) continue;
    const identity = `${lockPackageName(relativePath)}@${entry.version}`;
    const artifact = downloadedArtifacts.get(identity);
    if (!artifact) {
      if (entry.optional === true) continue;
      fail("THIN_ARTIFACT_MISSING_FOR_LOCK", `Thin ledger is missing a non-optional lock artifact: ${identity}`);
    }
    entry.resolved = pathToFileURL(artifact.target).href;
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  return original;
}

async function restoreCanonicalInstalledLock(installedLockPath, sourceLockBytes) {
  const installed = JSON.parse(await fs.readFile(installedLockPath, "utf8"));
  const source = JSON.parse(sourceLockBytes.toString("utf8"));
  if (installed.lockfileVersion !== 3 || source.lockfileVersion !== 3 || !installed.packages || !source.packages) fail("THIN_INSTALLED_LOCK_INVALID", "Thin npm install did not produce a canonical lockfileVersion 3 installed lock");
  for (const [relativePath, entry] of Object.entries(installed.packages)) {
    const canonical = source.packages[relativePath];
    if (!canonical || canonical.version !== entry.version || canonical.integrity !== entry.integrity) fail("THIN_INSTALLED_LOCK_DRIFT", `Thin installed lock differs from its verified source lock: ${relativePath}`);
    if (canonical.resolved === undefined) delete entry.resolved;
    else entry.resolved = canonical.resolved;
  }
  await fs.writeFile(installedLockPath, `${JSON.stringify(installed, null, 2)}\n`);
}

export function scrubbedEnvironment(root, nodeBin, { offline = true } = {}) {
  const home = path.join(root, "home");
  const tmp = path.join(root, "tmp");
  const cache = path.join(root, "npm-cache");
  const userConfig = path.join(root, "user.npmrc");
  const globalConfig = path.join(root, "global.npmrc");
  return {
    directories: [home, tmp, cache],
    configFiles: [userConfig, globalConfig],
    cache,
    env: {
      PATH: `${nodeBin}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: tmp,
      XDG_CACHE_HOME: path.join(root, "xdg-cache"),
      XDG_CONFIG_HOME: path.join(root, "xdg-config"),
      XDG_DATA_HOME: path.join(root, "xdg-data"),
      NO_COLOR: "1",
      TERM: "dumb",
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: globalConfig,
      npm_config_cache: cache,
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_ignore_scripts: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
      npm_config_offline: String(offline),
    },
  };
}

export async function prepareEnvironment(environment) {
  await Promise.all([...environment.directories, environment.env.XDG_CACHE_HOME, environment.env.XDG_CONFIG_HOME, environment.env.XDG_DATA_HOME].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
  const npmrc = `audit=false\nfund=false\nignore-scripts=true\noffline=${environment.env.npm_config_offline}\nregistry=https://registry.npmjs.org/\nupdate-notifier=false\n`;
  await Promise.all(environment.configFiles.map((file) => fs.writeFile(file, npmrc, { mode: 0o600, flag: "wx" })));
}

export class ThinPayloadResolver {
  constructor({ download = downloadVerified, extract = extractVerifiedTarGzip, run = runNode, spawnImpl = spawn } = {}) {
    this.download = download;
    this.extract = extract;
    this.run = run;
    this.spawnImpl = spawnImpl;
  }

  async resolve({ payloadRoot, cacheRoot, inspection, metadata } = {}) {
    if (![payloadRoot, cacheRoot].every((value) => typeof value === "string" && path.isAbsolute(value))) throw new TypeError("Thin resolver requires absolute payload and cache roots");
    const work = path.join(path.dirname(payloadRoot), `.thin-${crypto.randomUUID()}`);
    const downloads = path.join(work, "downloads");
    const nodeArchiveRoot = path.join(work, "node-archive");
    const resolved = path.join(work, "resolved");
    await fs.mkdir(downloads, { recursive: true, mode: 0o700 });
    try {
      const nodeArchive = path.join(downloads, NODE_ARCHIVE);
      await this.download({ url: NODE_URL, destination: nodeArchive, expectedSha256: EMBEDDED_NODE_ARCHIVE_SHA256, maxBytes: 256 * 1024 * 1024 });
      await this.extract({ archivePath: nodeArchive, destination: nodeArchiveRoot, expectedSha256: EMBEDDED_NODE_ARCHIVE_SHA256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
      await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
      await fs.rename(await singleDirectory(nodeArchiveRoot, `node-v${EMBEDDED_NODE_VERSION}-darwin-arm64`), path.join(resolved, "node"));
      const node = path.join(resolved, "node", "bin", "node");
      const npm = path.join(resolved, "node", "lib", "node_modules", "npm", "bin", "npm-cli.js");
      await Promise.all([boundedFile(node, 512 * 1024 * 1024), boundedFile(npm, 16 * 1024 * 1024)]);
      const environment = scrubbedEnvironment(work, path.dirname(node));
      await prepareEnvironment(environment);

      const downloadedArtifacts = new Map();
      for (const artifact of metadata.ledger.artifacts) {
        const target = path.join(downloads, `${artifact.sha256.slice("sha256:".length)}.tgz`);
        await this.download({ url: artifact.tarballUrl, destination: target, expectedSha256: artifact.sha256, expectedSri: artifact.integrity, maxBytes: 512 * 1024 * 1024 });
        downloadedArtifacts.set(`${artifact.name}@${artifact.version}`, { target, artifact });
      }

      const external = path.join(resolved, "external-npm");
      await fs.mkdir(external, { recursive: true, mode: 0o700 });
      await Promise.all([
        fs.copyFile(await boundedFile(path.join(payloadRoot, "resolution", "external", "package.json"), 1024 * 1024), path.join(external, "package.json")),
        fs.copyFile(await boundedFile(path.join(payloadRoot, "resolution", "external", "package-lock.json"), 64 * 1024 * 1024), path.join(external, "package-lock.json")),
      ]);
      const externalLockPath = path.join(external, "package-lock.json");
      const externalLockBytes = await localizeLock(externalLockPath, downloadedArtifacts);
      try {
        await this.run(node, [npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps"], { cwd: external, env: environment.env, spawnImpl: this.spawnImpl });
        await restoreCanonicalInstalledLock(path.join(external, "node_modules", ".package-lock.json"), externalLockBytes);
      } finally {
        await fs.writeFile(externalLockPath, externalLockBytes, { mode: 0o600 });
      }

      const piIdentity = `${inspection.stackManifest.runtime.pi.name}@${inspection.stackManifest.runtime.pi.version}`;
      const piArtifact = downloadedArtifacts.get(piIdentity);
      if (!piArtifact) fail("THIN_PI_ARTIFACT_MISSING", "Thin artifact ledger does not contain the controlled Pi package");
      const piArchiveRoot = path.join(work, "pi-artifact");
      await this.extract({ archivePath: piArtifact.target, destination: piArchiveRoot, expectedSha256: piArtifact.artifact.sha256, maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
      const piPackage = await singleDirectory(piArchiveRoot, "package");
      const pi = path.join(resolved, "pi");
      await fs.rename(piPackage, pi);
      const manifestPath = path.join(pi, "package.json");
      const piLockPath = path.join(pi, "npm-shrinkwrap.json");
      const manifestBytes = await fs.readFile(manifestPath);
      const piLockBytes = await localizeLock(piLockPath, downloadedArtifacts);
      const productionManifest = JSON.parse(manifestBytes.toString("utf8"));
      delete productionManifest.devDependencies;
      await fs.writeFile(manifestPath, `${JSON.stringify(productionManifest, null, 2)}\n`, { mode: 0o600 });
      try {
        await this.run(node, [npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer"], { cwd: pi, env: environment.env, spawnImpl: this.spawnImpl });
        await restoreCanonicalInstalledLock(path.join(pi, "node_modules", ".package-lock.json"), piLockBytes);
      } finally {
        await Promise.all([
          fs.writeFile(manifestPath, manifestBytes, { mode: 0o600 }),
          fs.writeFile(piLockPath, piLockBytes, { mode: 0o600 }),
        ]);
      }
      await fs.copyFile(await boundedFile(path.join(payloadRoot, "only-my-pi.tgz"), 512 * 1024 * 1024), path.join(resolved, "only-my-pi.tgz"));
      await inspectResolvedStack({ resolvedRoot: resolved, stackManifest: inspection.stackManifest });
      return resolved;
    } catch (error) {
      await fs.rm(work, { recursive: true, force: true });
      throw error;
    }
  }
}

export function createThinPayloadResolver(options) {
  const resolver = new ThinPayloadResolver(options);
  return resolver.resolve.bind(resolver);
}
