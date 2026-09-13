import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { inspectNativeRelease } from "../packages/distribution/release-policy.mjs";
import { awaitPublishedVersion } from "./lib/npm-publication.mjs";

const execFile = promisify(callback);
const [candidateDirectory, evidencePath, sourceCommit, mode] = process.argv.slice(2);
if (!path.isAbsolute(candidateDirectory ?? "") || !path.isAbsolute(evidencePath ?? "") || ![undefined, "--publish"].includes(mode))
  throw new Error("Usage: node scripts/publish-distribution.mjs /candidate /protected-evidence.json SOURCE [--publish]");
const { receipt, evidence, packageOrder } = await inspectNativeRelease({ candidateDirectory, evidencePath, sourceCommit });
if (mode !== "--publish") {
  console.log(JSON.stringify({ status: "PUBLICATION_PLAN", version: receipt.version, sourceCommit, packageOrder, tag: "preview", mutation: false }));
} else {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REPOSITORY !== "Ricardo121380/only-my-pi")
    throw new Error("Product publication must use the protected GitHub Actions OIDC workflow.");
  const journalPath = path.join(candidateDirectory, "npm-publication.json");
  const journal = { formatVersion: 1, status: "PUBLISHING", version: receipt.version, sourceCommit,
    distributionId: receipt.distributionId, protectedEvidenceDigest: evidence.evidenceDigest, submissions: [], completed: [] };
  const save = () => fs.writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  await save();
  try {
    for (const name of packageOrder) {
      const item = receipt.artifacts.find((entry) => entry.name === name);
      const filename = path.join(candidateDirectory, item.filename);
      const integrity = `sha512-${crypto.createHash("sha512").update(await fs.readFile(filename)).digest("base64")}`;
      const remote = async () => {
        const response = await fetch(`https://registry.npmjs.org/${name}/${receipt.version}?publicationCheck=${Date.now()}`, {
          headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30_000) });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`registry inspection failed for ${name}: HTTP ${response.status}`);
        return response.json();
      };
      let published = await remote();
      const reused = published !== null;
      if (!published) {
        const submission = { name, version: receipt.version, integrity, status: "SUBMITTING" };
        journal.submissions.push(submission);
        await save();
        const result = await execFile("npm", ["publish", filename, "--registry", "https://registry.npmjs.org", "--access", "public", "--tag", "preview", "--provenance", "--ignore-scripts",
          "--dry-run=false", "--json=false", "--loglevel=warn"],
          { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
        submission.status = "NPM_EXITED_ZERO_AWAITING_REGISTRY";
        submission.acknowledged = result.stdout.trim() === `+ ${name}@${receipt.version}`;
        submission.stdoutSha256 = crypto.createHash("sha256").update(result.stdout).digest("hex");
        submission.stderrSha256 = crypto.createHash("sha256").update(result.stderr).digest("hex");
        await save();
        console.log(JSON.stringify({ name, npmExitCode: 0, acknowledged: submission.acknowledged }));
      }
      // Retry only registry reads, never the upload. Byte mismatches stop immediately.
      let initial = published;
      await awaitPublishedVersion({ name, version: receipt.version, integrity, inspect: async () => {
        if (initial) { const value = initial; initial = null; return value; }
        return remote();
      } });
      journal.completed.push({ name, version: receipt.version, integrity, reused });
      await save();
    }
    journal.status = "PREVIEW_PUBLISHED_AWAITING_PUBLIC_ACCEPTANCE_AND_DEFAULT_TAGS";
    await save();
    console.log(JSON.stringify(journal));
  } catch (error) {
    journal.status = "PARTIAL_PUBLICATION_REQUIRES_RESUME";
    await save();
    throw error;
  }
}
