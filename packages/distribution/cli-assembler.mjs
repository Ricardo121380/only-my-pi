import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { createDeterministicTarGzip, hashFile } from "../release-stack/deterministic-archive.mjs";
import { extractVerifiedTarGzip } from "../release-stack/safe-extract.mjs";
import { validateDistributionManifest, hashDistributionTree } from "./runtime.mjs";
import { homebrewFormula } from "./homebrew.mjs";

const PLATFORMS = ["darwin-arm64", "linux-arm64", "linux-x64"];
const execFile = promisify(callback);
export function validatePlatformSet(receipts) {
  if (!Array.isArray(receipts) || receipts.length !== PLATFORMS.length
    || receipts.map((item) => item.platform).sort().join() !== PLATFORMS.join())
    throw new Error("the public CLI requires exactly macOS arm64 and both Linux platforms");
  const sourceCommit = receipts[0].sourceCommit;
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? "")) throw new Error("invalid source identity");
  for (const receipt of receipts) {
    if (receipt.version !== "0.4.0-preview.2" || receipt.sourceCommit !== sourceCommit
      || receipt.status !== "PLATFORM_CANDIDATE_NOT_PUBLISHABLE" || !/^sha256:[a-f0-9]{64}$/u.test(receipt.distributionId ?? ""))
      throw new Error("platform candidates must have the same exact source and version");
  }
  return { version: "0.4.0-preview.2", sourceCommit };
}

export async function assemblePublicCli({ rootDir, platformDirectories, outputRoot }) {
  if (![rootDir, outputRoot, ...platformDirectories].every((item) => path.isAbsolute(item))) throw new Error("absolute paths required");
  const receipts = await Promise.all(platformDirectories.map(async (directory) => JSON.parse(await fs.readFile(path.join(directory, "build-receipt.json"), "utf8"))));
  const { version, sourceCommit } = validatePlatformSet(receipts);
  const realSource = await fs.realpath(rootDir);
  const assertSource = async () => {
    const head = await execFile("git", ["rev-parse", "HEAD"], { cwd: realSource });
    const status = await execFile("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: realSource });
    if (head.stdout.trim() !== sourceCommit || status.stdout.trim()) throw new Error("CLI assembly requires the exact clean candidate source");
  };
  await assertSource();
  if (path.resolve(outputRoot) === realSource || path.resolve(outputRoot).startsWith(`${realSource}${path.sep}`)) throw new Error("output must be outside source");
  await fs.mkdir(outputRoot, { recursive: false });
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-assembly-"));
  const platforms = {};
  const artifacts = [];
  try {
    for (const platform of PLATFORMS) {
      const index = receipts.findIndex((item) => item.platform === platform);
      const receipt = receipts[index];
      const name = `only-my-pi-runtime-${platform}`;
      const matches = receipt.artifacts.filter((item) => item.name === name);
      const artifact = matches[0];
      if (matches.length !== 1 || artifact.filename !== `${name}-${version}.tgz` || artifact.version !== version)
        throw new Error("platform runtime artifact is missing or ambiguous");
      const archive = path.join(platformDirectories[index], artifact.filename);
      const extracted = path.join(work, platform);
      await extractVerifiedTarGzip({ archivePath: archive, destination: extracted, expectedSha256: artifact.sha256,
        maxEntries: 200_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 });
      const runtime = path.join(extracted, "package/runtime");
      const manifest = validateDistributionManifest(JSON.parse(await fs.readFile(path.join(runtime, "distribution-manifest.json"), "utf8")));
      if (manifest.sourceCommit !== sourceCommit || manifest.version !== version || manifest.distributionId !== receipt.distributionId
        || `${manifest.platform.os}-${manifest.platform.arch}` !== platform) throw new Error("platform manifest differs from receipt");
      for (const component of Object.values(manifest.components))
        if (await hashDistributionTree(runtime, component.path) !== component.treeDigest) throw new Error("platform component content differs");
      const metadata = JSON.parse(await fs.readFile(path.join(extracted, "package/package.json"), "utf8"));
      if (metadata.name !== name || metadata.version !== version || metadata.os?.join() !== manifest.platform.os
        || metadata.cpu?.join() !== manifest.platform.arch) throw new Error("npm platform metadata differs");
      platforms[platform] = { name, distributionId: manifest.distributionId };
      await fs.copyFile(archive, path.join(outputRoot, artifact.filename), fs.constants.COPYFILE_EXCL);
      artifacts.push(artifact);
      await fs.rm(extracted, { recursive: true, force: true });
    }
    const cli = path.join(outputRoot, "only-my-pi");
    await fs.mkdir(cli);
    const metadata = { name: "only-my-pi", version, private: false, type: "module", license: "MIT",
      description: "Guarded terminal coding agent built on Pi (Public Preview)", bin: { omp: "loader.mjs" },
      engines: { node: ">=22.19.0" }, os: ["darwin", "linux"], cpu: ["arm64", "x64"],
      optionalDependencies: Object.fromEntries(Object.values(platforms).map(({ name }) => [name, version])),
      scripts: { postinstall: "node loader.mjs --verify-install" },
      repository: { type: "git", url: "git+https://github.com/Ricardo121380/only-my-pi.git" },
      files: ["loader.mjs", "resource-hash.mjs", "runtime-packages.json", "README.md", "LICENSE"] };
    await fs.writeFile(path.join(cli, "package.json"), `${JSON.stringify(metadata, null, 2)}\n`);
    await fs.writeFile(path.join(cli, "runtime-packages.json"), `${JSON.stringify({ formatVersion: 1, version, sourceCommit, platforms }, null, 2)}\n`);
    for (const [source, target] of [["distribution/npm/loader.mjs", "loader.mjs"], ["packages/bootstrap/resource-hash.mjs", "resource-hash.mjs"], ["LICENSE", "LICENSE"]])
      await fs.copyFile(path.join(rootDir, source), path.join(cli, target));
    await fs.chmod(path.join(cli, "loader.mjs"), 0o755);
    await fs.writeFile(path.join(cli, "README.md"), `# only-my-pi ${version} Public Preview\n\nmacOS 14+ Apple Silicon and Linux glibc x64/arm64. Requires Node >=22.19.0 and Git; Linux also requires bubblewrap, socat, ripgrep and a system policy permitting the strong sandbox.\n\n支持 macOS 14+ Apple Silicon 与 Linux glibc x64/arm64。需准备 Node >=22.19.0 和 Git；Linux 还需 bubblewrap、socat、ripgrep 及允许强沙箱的系统策略。\n\nConfigure models with \`omp admin pi\`, then run \`omp\` inside your project.\n\n[English](https://github.com/Ricardo121380/only-my-pi) · [中文](https://github.com/Ricardo121380/only-my-pi/blob/main/README.zh-CN.md)\n`);
    const filename = `only-my-pi-${version}.tgz`;
    await createDeterministicTarGzip({ rootDir: cli, outputPath: path.join(outputRoot, filename), rootName: "package" });
    const cliArtifact = { name: "only-my-pi", version, filename, sha256: await hashFile(path.join(outputRoot, filename)) };
    artifacts.push(cliArtifact);
    const archives = [];
    // Reuse the candidate core/Node bytes, replacing only each provisional CLI
    // with the one public CLI. Final archives must be reverified before signing.
    for (const platform of PLATFORMS) {
      const index = receipts.findIndex((item) => item.platform === platform);
      const runtimeArtifact = artifacts.find((item) => item.name === platforms[platform].name);
      for (const mode of ["full", "thin"]) {
        const original = receipts[index].archives.find((item) => item.mode === mode);
        const name = `only-my-pi-${version}-${platform}-${mode}.tar.gz`;
        if (original?.filename !== name || original.distributionId !== platforms[platform].distributionId)
          throw new Error("platform fallback identity is missing");
        const stage = path.join(work, `${platform}-${mode}`);
        await extractVerifiedTarGzip({ archivePath: path.join(platformDirectories[index], name), destination: stage,
          expectedSha256: original.sha256, maxEntries: 200_000, maxExtractedBytes: 2 * 1024 * 1024 * 1024 });
        const root = path.join(stage, "only-my-pi");
        const archiveManifest = JSON.parse(await fs.readFile(path.join(root, "archive-manifest.json"), "utf8"));
        if (archiveManifest.sourceCommit !== sourceCommit || archiveManifest.version !== version
          || archiveManifest.platform !== platform || archiveManifest.mode !== mode
          || archiveManifest.distributionId !== platforms[platform].distributionId
          || archiveManifest.packages.length !== 2
          || await hashFile(path.join(root, runtimeArtifact.filename)) !== runtimeArtifact.sha256)
          throw new Error("fallback core differs from the shared runtime");
        if (mode === "full" && await hashDistributionTree(root, "node") !== archiveManifest.node.treeDigest)
          throw new Error("fallback Node content differs");
        await fs.copyFile(path.join(outputRoot, cliArtifact.filename), path.join(root, cliArtifact.filename));
        archiveManifest.packages = [runtimeArtifact, cliArtifact];
        await fs.writeFile(path.join(root, "archive-manifest.json"), `${JSON.stringify(archiveManifest, null, 2)}\n`);
        await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(outputRoot, name), rootName: "only-my-pi" });
        archives.push({ platform, mode, filename: name, sha256: await hashFile(path.join(outputRoot, name)), distributionId: platforms[platform].distributionId });
        await fs.rm(stage, { recursive: true, force: true });
      }
    }
    await assertSource();
    const result = { formatVersion: 1, status: "MULTIPLATFORM_CANDIDATE_NOT_PUBLISHED", version, sourceCommit, platforms, artifacts, archives };
    await fs.writeFile(path.join(outputRoot, "only-my-pi.rb"), homebrewFormula(result));
    result.homebrew = { filename: "only-my-pi.rb", sha256: await hashFile(path.join(outputRoot, "only-my-pi.rb")) };
    await fs.writeFile(path.join(outputRoot, "build-receipt.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally { await fs.rm(work, { recursive: true, force: true }); }
}
