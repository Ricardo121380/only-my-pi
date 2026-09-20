import fs from "node:fs/promises";
import path from "node:path";
import { buildGenerationPlan } from "../bootstrap/index.mjs";
import { createDistributionManifest } from "../distribution/manifest-builder.mjs";
import { materializeExecutableLinks } from "../distribution/npm-layout.mjs";
import { applyRuntimePatches } from "../distribution/runtime-patches.mjs";
import { stagePiBranding } from "../distribution/pi-branding.mjs";
import { stageToolchain } from "../distribution/toolchain-builder.mjs";
import { createDistributionSbom } from "../distribution/sbom.mjs";
import { hashFile } from "./deterministic-archive.mjs";
import { extractVerifiedTarGzip } from "./safe-extract.mjs";

// Only operates on a newly staged Full tree. Never accepts user package roots.
export async function preparePrivateRuntime({ rootDir, resolved, sourceCommit, work }) {
  await extractVerifiedTarGzip({ archivePath: path.join(resolved, "only-my-pi.tgz"), destination: path.join(resolved, "only-my-pi"),
    expectedSha256: await hashFile(path.join(resolved, "only-my-pi.tgz")), maxEntries: 100_000, maxExtractedBytes: 512 * 1024 * 1024 });
  await materializeExecutableLinks(resolved);
  await stageToolchain({ rootDir, runtimeRoot: resolved, work, platform: "darwin-arm64" });
  await stagePiBranding(path.join(resolved, "pi"));
  const patches = await applyRuntimePatches({ runtimeRoot: resolved, version: "0.3.0-preview.1", platform: "darwin-arm64", runtimeContract: "phase1-pi0851" });
  if (patches.length !== 2) throw new Error("private runtime is missing its reviewed patch set");
  const graph = await buildGenerationPlan({ rootDir, profileId: "daily", sourceCommit });
  const inventory = JSON.parse(await fs.readFile(path.join(rootDir, "inventory/packages.lock.json"), "utf8"));
  const packageFilters = Object.fromEntries(inventory.packages.filter((entry) => entry.installed === true).map((entry) => [entry.id, entry.resourceFilter ?? []]));
  for (const entry of graph.packages) packageFilters[entry.id] = entry.resourceFilter;
  const manifest = await createDistributionManifest({ root: resolved, version: "0.3.0-preview.1", sourceCommit,
    platform: { os: "darwin", arch: "arm64", minimumMacOS: "14.0" }, packageFilters, runtimeContract: "phase1-pi0851" });
  await fs.writeFile(path.join(resolved, "distribution-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return { manifest, patches };
}

export async function writePrivateRuntimeSbom({ root, manifest, patches, ledger, stack }) {
  const sbom = await createDistributionSbom({ runtimeRoot: root, manifest, dependencyLedger: ledger, runtimePatches: patches });
  const nodeId = `SPDXRef-Node-${stack.runtime.node.version}`;
  sbom.packages.push({ SPDXID: nodeId, name: "node", versionInfo: stack.runtime.node.version, downloadLocation: `https://nodejs.org/download/release/v${stack.runtime.node.version}/${stack.runtime.node.archiveName}`,
    filesAnalyzed: false, licenseDeclared: "MIT", licenseConcluded: "MIT", copyrightText: "NOASSERTION", primaryPackagePurpose: "APPLICATION",
    checksums: [{ algorithm: "SHA256", checksumValue: stack.runtime.node.archiveSha256.slice(7) }] });
  sbom.relationships.push({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: nodeId });
  sbom.annotations[0].comment = `sourceCommit=${stack.sourceCommit}; stackId=${stack.stackId}; privateRuntime=${manifest.distributionId}; embeddedNode=${stack.runtime.node.version}; no protected acceptance evidence is inherited`;
  await fs.writeFile(path.join(root, "runtime-sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}
