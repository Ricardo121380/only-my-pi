import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { createDeterministicTarGzip, hashFile } from "../release-stack/deterministic-archive.mjs";
import { extractVerifiedTarGzip } from "../release-stack/safe-extract.mjs";
import { validateStackManifest } from "../release-stack/contracts.mjs";
import { createDistributionManifest } from "./manifest-builder.mjs";
import { createDistributionSbom, distributionNotices } from "./sbom.mjs";
import { DISTRIBUTION_VERSION, hashDistributionTree, distributionError } from "./runtime.mjs";

const execFile = promisify(execFileCallback);
const SEED_SHA256 = "sha256:9990fb9dd81b5ecaab9b31d5344fb8aab3715fd89b61f07ed5fefc7191d60b0d";
const SEED_SOURCE = "aaf22c968c9defeb9106680a30504e4ca6949052";

async function json(filename, value) {
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644, flag: "wx" });
}

/** Build the first native release using only the verified immutable dependency
 * seed. The old first-party artifact and old protected receipts are NOT reused.
 */
export async function buildNativePackages({ rootDir, outputRoot, seedBundle, sourceCommit,
  version = DISTRIBUTION_VERSION, npmCli = path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js") }) {
  for (const value of [rootDir, outputRoot, seedBundle, npmCli]) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError("native build paths must be absolute");
  }
  if (version !== DISTRIBUTION_VERSION || process.platform !== "darwin" || process.arch !== "arm64")
    throw distributionError("DISTRIBUTION_BUILD_PLATFORM_UNSUPPORTED", "the first native release must be built on macOS arm64");
  const run = (argv) => execFile("git", argv, { cwd: rootDir, encoding: "utf8" });
  const [head, status] = await Promise.all([run(["rev-parse", "HEAD"]), run(["status", "--porcelain", "--untracked-files=all"])]);
  if (head.stdout.trim() !== sourceCommit || status.stdout.trim())
    throw distributionError("DISTRIBUTION_SOURCE_DIRTY", "build requires the exact clean source commit");
  const output = path.resolve(outputRoot);
  const realSource = await fs.realpath(rootDir);
  if (output === realSource || output.startsWith(`${realSource}${path.sep}`))
    throw distributionError("DISTRIBUTION_OUTPUT_UNSAFE", "distribution output must be outside the source checkout");
  await fs.mkdir(output, { recursive: false });
  const work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-build-")));
  try {
    await extractVerifiedTarGzip({ archivePath: seedBundle, destination: path.join(work, "seed"), expectedSha256: SEED_SHA256,
      maxEntries: 200_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 });
    const seed = path.join(work, "seed/only-my-pi");
    const seedManifest = validateStackManifest(JSON.parse(await fs.readFile(path.join(seed, "stack-manifest.json"), "utf8")));
    if (seedManifest.sourceCommit !== SEED_SOURCE || seedManifest.onlyMyPi.version !== "0.3.0-preview.1"
      || await hashDistributionTree(seed, "pi") !== seedManifest.runtime.pi.treeDigest
      || await hashDistributionTree(seed, "external-npm") !== seedManifest.externalTreeDigest)
      throw distributionError("DISTRIBUTION_SEED_INVALID", "dependency seed differs from the immutable reviewed release");

    const runtimeName = "only-my-pi-runtime-darwin-arm64";
    const runtimePackage = path.join(output, runtimeName);
    const runtime = path.join(runtimePackage, "runtime");
    await fs.mkdir(runtime, { recursive: true });
    for (const name of ["pi", "external-npm"]) await fs.cp(path.join(seed, name), path.join(runtime, name), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await fs.mkdir(path.join(work, "home"));
    const packed = await execFile(process.execPath, [npmCli, "pack", ".", "--ignore-scripts", "--json", "--pack-destination", work], {
      cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: path.join(work, "home"),
        npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_cache: path.join(work, "cache") },
    });
    const descriptor = JSON.parse(packed.stdout);
    if (descriptor.length !== 1 || path.basename(descriptor[0].filename) !== descriptor[0].filename) throw new Error("invalid npm pack result");
    const sourceTarball = path.join(work, descriptor[0].filename);
    await extractVerifiedTarGzip({ archivePath: sourceTarball, destination: path.join(runtime, "only-my-pi"),
      expectedSha256: await hashFile(sourceTarball), maxEntries: 100_000, maxExtractedBytes: 512 * 1024 * 1024 });
    const app = path.join(runtime, "only-my-pi/package");
    const appManifestPath = path.join(app, "package.json");
    const appManifest = JSON.parse(await fs.readFile(appManifestPath, "utf8"));
    appManifest.version = version;
    await fs.writeFile(appManifestPath, `${JSON.stringify(appManifest, null, 2)}\n`);
    await json(path.join(app, "artifact-identity.json"), { formatVersion: 1, kind: "only-my-pi-source-identity", sourceCommit });

    const graph = await buildGenerationPlan({ rootDir, profileId: "daily", sourceCommit });
    const inventory = JSON.parse(await fs.readFile(path.join(rootDir, "inventory/packages.lock.json"), "utf8"));
    const packageFilters = Object.fromEntries(inventory.packages.filter((entry) => entry.installed === true)
      .map((entry) => [entry.id, entry.resourceFilter ?? []]));
    for (const entry of graph.packages) packageFilters[entry.id] = entry.resourceFilter;
    const manifest = await createDistributionManifest({ root: runtime, version, sourceCommit,
      platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" }, packageFilters });
    await json(path.join(runtime, "distribution-manifest.json"), manifest);
    await json(path.join(runtimePackage, "package.json"), { name: runtimeName, version, private: false,
      description: "Prebuilt only-my-pi runtime for macOS Apple Silicon", license: "MIT", os: ["darwin"], cpu: ["arm64"],
      repository: { type: "git", url: "git+https://github.com/Ricardo121380/only-my-pi.git" }, files: ["runtime/", "LICENSE", "distribution-installation.json"] });
    await json(path.join(runtimePackage, "distribution-installation.json"), { formatVersion: 1, channel: "npm", version });
    await fs.copyFile(path.join(rootDir, "LICENSE"), path.join(runtimePackage, "LICENSE"));
    await fs.cp(path.join(seed, "LICENSES"), path.join(runtime, "LICENSES"), { recursive: true });
    const dependencyLedger = JSON.parse(await fs.readFile(path.join(seed, "transitive-artifact-ledger.json"), "utf8"));
    await json(path.join(runtime, "dependency-seed-ledger.json"), dependencyLedger);
    const sbom = await createDistributionSbom({ runtimeRoot: runtime, manifest, dependencyLedger });
    await json(path.join(runtime, "sbom.spdx.json"), sbom);
    await fs.writeFile(path.join(runtime, "THIRD_PARTY_NOTICES.txt"), distributionNotices(sbom));

    const cli = path.join(output, "only-my-pi");
    await fs.mkdir(cli);
    await json(path.join(cli, "package.json"), { name: "only-my-pi", version, private: false, type: "module", license: "MIT",
      description: "Guarded terminal coding agent built on Pi (Public Preview)", bin: { omp: "loader.mjs" },
      engines: { node: ">=22.19.0" }, os: ["darwin"], cpu: ["arm64"],
      optionalDependencies: { [runtimeName]: version }, scripts: { postinstall: "node loader.mjs --verify-install" },
      repository: { type: "git", url: "git+https://github.com/Ricardo121380/only-my-pi.git" },
      homepage: "https://github.com/Ricardo121380/only-my-pi", files: ["loader.mjs", "resource-hash.mjs", "runtime-packages.json", "README.md", "LICENSE"] });
    await json(path.join(cli, "runtime-packages.json"), { formatVersion: 1, version, sourceCommit,
      platforms: { "darwin-arm64": { name: runtimeName, distributionId: manifest.distributionId } } });
    for (const [source, target] of [["distribution/npm/loader.mjs", "loader.mjs"], ["packages/bootstrap/resource-hash.mjs", "resource-hash.mjs"], ["LICENSE", "LICENSE"]])
      await fs.copyFile(path.join(rootDir, source), path.join(cli, target));
    await fs.chmod(path.join(cli, "loader.mjs"), 0o755);
    await fs.writeFile(path.join(cli, "README.md"), `# only-my-pi ${version}\n\nPublic Preview for macOS 14+ Apple Silicon.\n\nRun \`omp\` after installation. Configure model authentication with \`omp admin pi\`.\n\n[Full documentation](https://github.com/Ricardo121380/only-my-pi)\n`);

    const artifacts = [];
    for (const [name, directory] of [[runtimeName, runtimePackage], ["only-my-pi", cli]]) {
      const filename = `${name}-${version}.tgz`;
      await createDeterministicTarGzip({ rootDir: directory, outputPath: path.join(output, filename), rootName: "package" });
      artifacts.push({ name, version, filename, sha256: await hashFile(path.join(output, filename)) });
    }
    const receipt = { formatVersion: 1, status: "CANDIDATE_NOT_PUBLISHED", version, sourceCommit,
      distributionId: manifest.distributionId, dependencySeed: { sourceCommit: SEED_SOURCE, sha256: SEED_SHA256 }, artifacts };
    await json(path.join(output, "build-receipt.json"), receipt);
    return receipt;
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}
