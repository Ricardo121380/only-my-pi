import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { installExternal, installPi, collectLicenses, loadLicenseRegistry } from "../release-stack/release-payload-stager.mjs";
import { acquireInstalledArtifacts } from "../release-stack/artifact-acquisition.mjs";
import { buildArtifactLedger } from "../release-stack/artifact-ledger.mjs";
import { mergeLedgers } from "../release-stack/payload-assembler.mjs";
import { downloadVerified } from "../release-stack/downloader.mjs";
import { extractVerifiedTarGzip } from "../release-stack/safe-extract.mjs";
import { CONTROLLED_PI_VERSION, CONTROLLED_PI_INTEGRITY, PUBLIC_STACK_PACKAGES } from "../release-stack/contracts.mjs";
import { hashDistributionTree } from "./runtime.mjs";

const execFile = promisify(callback);
const PI_NAME = "@earendil-works/pi-coding-agent";

/** Native dependency construction from existing immutable locks, never from
 * a macOS installed tree. Third-party lifecycle scripts remain disabled. */
export async function stageLinuxDependencies({ rootDir, work, sourceCommit, npmCli }) {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)
    || !process.report.getReport().header.glibcVersionRuntime || process.versions.node !== "24.19.0")
    throw new Error("Linux candidate builds require native glibc x64/arm64 and Node 24.19.0");
  const platform = `linux-${process.arch}`;
  const lock = JSON.parse(await fs.readFile(path.join(rootDir, `distribution/toolchain-${platform}.json`), "utf8"));
  const seed = path.join(work, "linux-seed");
  await fs.mkdir(seed);
  await fs.mkdir(path.join(work, "downloads"));
  await fs.mkdir(path.join(work, "dependency-home"));
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(work, "dependency-home"),
    npm_config_cache: path.join(work, "dependency-cache"), npm_config_ignore_scripts: "true",
    npm_config_audit: "false", npm_config_fund: "false", npm_config_registry: "https://registry.npmjs.org/" };
  const run = (node, argv, options) => execFile(node, argv, { ...options, timeout: 20 * 60_000, maxBuffer: 16 * 1024 * 1024 });
  const options = { rootDir, resolved: seed, work, node: process.execPath, npm: npmCli, env, run,
    externalContract: path.join(rootDir, "contracts/release/linux-external"),
    download: downloadVerified, extract: extractVerifiedTarGzip };
  process.stderr.write(`Building locked dependencies for ${platform}\n`);
  const external = await installExternal(options);
  const pi = await installPi(options);
  const rootArtifact = { name: PI_NAME, version: CONTROLLED_PI_VERSION,
    tarballUrl: `https://registry.npmjs.org/${PI_NAME}/-/pi-coding-agent-${CONTROLLED_PI_VERSION}.tgz`, integrity: CONTROLLED_PI_INTEGRITY };
  const roots = [{ npmRoot: external, lockPath: path.join(external, "package-lock.json") },
    { npmRoot: pi.pi, lockPath: path.join(pi.pi, "npm-shrinkwrap.json"), rootArtifact }];
  const exceptions = JSON.parse(await fs.readFile(path.join(rootDir, "contracts/release/artifact-extraction-exceptions.json"), "utf8"));
  process.stderr.write("Verifying locked transitive artifact identities and licenses\n");
  const artifacts = await acquireInstalledArtifacts({ roots, outputRoot: path.join(work, "verified-artifacts"),
    duplicateExceptions: exceptions.exceptions });
  const common = { ...artifacts, sourceCommit };
  const ledgers = await Promise.all(roots.map((root, index) => buildArtifactLedger({ ...common, ...root,
    topLevelNames: index === 0 ? PUBLIC_STACK_PACKAGES.map((item) => item.name) : [PI_NAME] })));
  const ledger = mergeLedgers(sourceCommit, ledgers);
  const archive = path.join(work, "downloads", lock.node.archiveName);
  await downloadVerified({ url: `https://nodejs.org/dist/v${lock.node.version}/${lock.node.archiveName}`,
    destination: archive, expectedSha256: lock.node.archiveSha256, maxBytes: 256 * 1024 * 1024, allowedHosts: ["nodejs.org"] });
  const extracted = path.join(work, "node-archive");
  await extractVerifiedTarGzip({ archivePath: archive, destination: extracted, expectedSha256: lock.node.archiveSha256,
    maxEntries: 100_000, maxExtractedBytes: 1024 * 1024 * 1024 });
  await fs.rename(path.join(extracted, lock.node.archiveName.replace(/\.tar\.gz$/u, "")), path.join(seed, "node"));
  const licenseRegistry = await loadLicenseRegistry(rootDir);
  const linuxLicenses = JSON.parse(await fs.readFile(path.join(rootDir, "distribution/linux-license-bindings.json"), "utf8"));
  // The historical registry is unchanged. Project its reviewed bindings onto
  // this platform's actual artifact set and add the pinned Linux counterparts.
  const bindings = { ...licenseRegistry.registry.bindings, ...linuxLicenses.bindings };
  licenseRegistry.registry = { ...licenseRegistry.registry, bindings: Object.fromEntries(
    Object.entries(bindings).filter(([identity]) => artifacts.artifactTreeRoots.has(identity))) };
  await collectLicenses({ resolved: seed, artifacts, output: path.join(seed, "LICENSES"), licenseRegistry });
  await fs.writeFile(path.join(seed, "LICENSES/SOURCE_REGISTRY.json"), `${JSON.stringify(licenseRegistry.registry, null, 2)}\n`);
  await fs.writeFile(path.join(seed, "transitive-artifact-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  return { seed, seedManifest: { runtime: { node: { ...lock.node, treeDigest: await hashDistributionTree(seed, "node") } } },
    dependencySeed: { sourceCommit, ledgerDigest: ledger.ledgerDigest } };
}
