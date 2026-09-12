import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { inspectNativeRelease } from "../packages/distribution/release-policy.mjs";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";

const execFile = promisify(callback);
const [candidateDirectory, evidencePath, sourceCommit, mode] = process.argv.slice(2);
if (!path.isAbsolute(candidateDirectory ?? "") || !path.isAbsolute(evidencePath ?? "") || mode !== "--publish")
  throw new Error("Usage: node scripts/publish-distribution-release.mjs /candidate /evidence SOURCE --publish");
if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "Ricardo121380/only-my-pi")
  throw new Error("GitHub publication must run after the protected native release approval.");
const { receipt } = await inspectNativeRelease({ candidateDirectory, evidencePath, sourceCommit });
const repo = "Ricardo121380/only-my-pi";
const tag = `v${receipt.version}`;
const gh = (args) => execFile("gh", args, { encoding: "utf8", timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "omp-release-"));
const journal = { formatVersion: 1, version: receipt.version, sourceCommit, distributionId: receipt.distributionId,
  status: "PREPARING_GITHUB_RELEASE", completedAssets: [] };
const save = () => fs.writeFile(path.join(candidateDirectory, "github-publication.json"), `${JSON.stringify(journal, null, 2)}\n`);
try {
  await fs.copyFile(evidencePath, path.join(staging, "native-protected-evidence.json"));
  const files = [...receipt.artifacts, ...receipt.archives].map((entry) => path.join(candidateDirectory, entry.filename));
  files.push(path.join(candidateDirectory, "build-receipt.json"), path.join(candidateDirectory, "only-my-pi.rb"), path.join(staging, "native-protected-evidence.json"));
  let release;
  const inspect = async () => JSON.parse((await gh(["api", `repos/${repo}/releases/tags/${tag}`])).stdout);
  try { release = await inspect(); }
  catch (error) { if (!error.stderr?.includes("HTTP 404")) throw error; }
  if (!release) {
    const notes = path.join(staging, "notes.md");
    await fs.writeFile(notes, `OMP ${receipt.version} Public Preview for macOS 14+ Apple Silicon.\n\nSource: ${sourceCommit}\n\nThe npm/Homebrew core and Full/Thin fallbacks share distribution identity \`${receipt.distributionId}\`. Linux and Docker are not part of this phase-one release.\n`);
    await gh(["release", "create", tag, "--repo", repo, "--target", sourceCommit, "--draft", "--prerelease",
      "--title", `OMP ${receipt.version} (Preview)`, "--notes-file", notes]);
    release = await inspect();
  }
  if (release.target_commitish !== sourceCommit || !release.prerelease)
    throw new Error("Existing release belongs to a different source or channel; it was not modified.");
  const expectedNames = new Set(files.map((file) => path.basename(file)));
  if (release.assets.some((asset) => !expectedNames.has(asset.name)))
    throw new Error("Existing release has unexpected assets; inspect it before resuming.");
  const downloads = path.join(staging, "downloaded");
  await fs.mkdir(downloads);
  await save();
  for (const file of files) {
    const name = path.basename(file);
    const present = release.assets.some((asset) => asset.name === name);
    if (!present) {
      if (!release.draft) throw new Error(`Published release is missing ${name}; it will not be overwritten.`);
      await gh(["release", "upload", tag, file, "--repo", repo]);
    }
    await gh(["release", "download", tag, "--repo", repo, "--pattern", name, "--dir", downloads]);
    const sha256 = await hashFile(file);
    if (await hashFile(path.join(downloads, name)) !== sha256)
      throw new Error(`Existing release asset differs: ${name}; it will not be replaced.`);
    journal.completedAssets.push({ name, sha256, reused: present });
    await save();
  }
  if (release.draft) await gh(["release", "edit", tag, "--repo", repo, "--draft=false", "--prerelease"]);
  release = await inspect();
  if (release.draft || !release.prerelease) throw new Error("GitHub release publication was not confirmed");
  journal.status = "GITHUB_PREVIEW_PUBLISHED";
  journal.url = release.html_url;
  await save();
  console.log(JSON.stringify(journal));
} catch (error) {
  journal.status = "PARTIAL_GITHUB_PUBLICATION_REQUIRES_RESUME";
  await save();
  throw error;
} finally { await fs.rm(staging, { recursive: true, force: true }); }
