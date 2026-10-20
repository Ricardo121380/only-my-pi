#!/usr/bin/env node
// Offline acceptance only: creates candidate archives, never a release receipt.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createDeterministicTarGzip } from "../packages/release-stack/deterministic-archive.mjs";
import { downloadVerified } from "../packages/release-stack/downloader.mjs";
import { extractVerifiedTarGzip } from "../packages/release-stack/safe-extract.mjs";
import { inspectResolvedStack } from "../packages/release-stack/release-builder.mjs";
import { validateStackManifest } from "../packages/release-stack/contracts.mjs";

const [candidate, output] = process.argv.slice(2);
if (![candidate, output].every((value) => path.isAbsolute(value ?? ""))) {
  throw new Error("Usage: measure-stack-transfer.mjs /staged-candidate /fresh-output");
}
const full = path.join(candidate, "payloads/full"), thin = path.join(candidate, "payloads/thin");
const stack = validateStackManifest(JSON.parse(await fs.readFile(path.join(full, "stack-manifest.json"), "utf8")));
await fs.mkdir(output); // Refuse to replace an earlier measurement.
const expected = await inspectResolvedStack({ resolvedRoot: full, stackManifest: stack });
const archives = {};
for (const [mode, rootDir] of [["full", full], ["thin", thin]]) {
  // Same writer, compression settings and archive root as release-builder.mjs.
  archives[mode] = await createDeterministicTarGzip({ rootDir,
    outputPath: path.join(output, `candidate-${stack.sourceCommit.slice(0, 7)}-${mode}.tar.gz`), rootName: "only-my-pi" });
}
const scratch = await fs.mkdtemp(path.join(output, ".roundtrip-"));
let transfer, extraction;
try {
  transfer = await downloadVerified({
    url: "https://github.com/offline-measurement/full.tar.gz",
    destination: path.join(scratch, "full.tar.gz"),
    expectedSha256: archives.full.sha256, maxBytes: archives.full.bytes,
    // Exercise the production body/hash path with local bytes; no HTTP request.
    fetchImpl: async () => ({ ok: true, status: 200, body: createReadStream(archives.full.path) }),
  });
  assert.equal(transfer.bytes, archives.full.bytes);
  extraction = await extractVerifiedTarGzip({ archivePath: transfer.path,
    destination: path.join(scratch, "extracted"), expectedSha256: archives.full.sha256,
    maxEntries: 100_000, maxExtractedBytes: 2 * 1024 ** 3 });
  const actual = await inspectResolvedStack({ resolvedRoot: path.join(extraction.destination, "only-my-pi"), stackManifest: stack });
  assert.deepEqual(actual, expected);
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
const report = {
  status: "MEASURED", measuredAt: new Date().toISOString(), sourceCommit: stack.sourceCommit, stackId: stack.stackId,
  runtime: { node: process.version, pi: stack.runtime.pi.version, platform: process.platform, arch: process.arch },
  archives,
  fullRoundtrip: { status: "PASS", streamedBodyBytes: transfer.bytes, sha256: transfer.sha256,
    entries: extraction.entries, extractedFileBytes: extraction.extractedBytes, componentIdentitiesMatch: true },
  update: { route: "local Full stack transaction", localPromotionNetworkBytes: 0,
    fullArtifactBodyBytes: archives.full.bytes, deltaUpdate: false,
    thinScope: "archive only; private-runtime reconstruction and total Thin downloads NOT_VERIFIED",
    exclusions: ["release metadata", "HTTP/TLS overhead", "retries", "published CDN transfer"] },
  networkRequests: 0, modelRequests: 0, publication: "NOT_RUN",
};
await fs.writeFile(path.join(output, "transfer.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify(report));
