import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

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

async function runNode(node, argv, { cwd, env, spawnImpl = spawn } = {}) {
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

function scrubbedEnvironment(root, nodeBin) {
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
      npm_config_offline: "true",
    },
  };
}

async function prepareEnvironment(environment) {
  await Promise.all([...environment.directories, environment.env.XDG_CACHE_HOME, environment.env.XDG_CONFIG_HOME, environment.env.XDG_DATA_HOME].map((directory) => fs.mkdir(directory, { recursive: true, mode: 0o700 })));
  const npmrc = "audit=false\nfund=false\nignore-scripts=true\noffline=true\nregistry=https://registry.npmjs.org/\nupdate-notifier=false\n";
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
        downloadedArtifacts.set(`${artifact.name}@${artifact.version}`, target);
        await this.run(node, [npm, "cache", "add", target, "--cache", environment.cache, "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: work, env: environment.env, spawnImpl: this.spawnImpl });
      }

      const external = path.join(resolved, "external-npm");
      await fs.mkdir(external, { recursive: true, mode: 0o700 });
      await Promise.all([
        fs.copyFile(await boundedFile(path.join(payloadRoot, "resolution", "external", "package.json"), 1024 * 1024), path.join(external, "package.json")),
        fs.copyFile(await boundedFile(path.join(payloadRoot, "resolution", "external", "package-lock.json"), 64 * 1024 * 1024), path.join(external, "package-lock.json")),
      ]);
      await this.run(node, [npm, "ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--legacy-peer-deps"], { cwd: external, env: environment.env, spawnImpl: this.spawnImpl });

      const piIdentity = `${inspection.stackManifest.runtime.pi.name}@${inspection.stackManifest.runtime.pi.version}`;
      const piTarball = downloadedArtifacts.get(piIdentity);
      if (!piTarball) fail("THIN_PI_ARTIFACT_MISSING", "Thin artifact ledger does not contain the controlled Pi package");
      const piPrefix = path.join(work, "pi-prefix");
      await fs.mkdir(piPrefix, { recursive: true, mode: 0o700 });
      await this.run(node, [npm, "install", "--global", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--omit=dev", "--omit=peer", "--prefix", piPrefix, "--", piTarball], { cwd: work, env: environment.env, spawnImpl: this.spawnImpl });
      const piPackage = path.join(piPrefix, "lib", "node_modules", ...inspection.stackManifest.runtime.pi.name.split("/"));
      await fs.rename(piPackage, path.join(resolved, "pi"));
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
