import fs from "node:fs/promises";
import path from "node:path";
import { validateArtifactLedger } from "../release-stack/contracts.mjs";
import { readRegularJson } from "./runtime.mjs";

function identifier(name, version) { return `SPDXRef-Package-${name}-${version}`.replaceAll(/[^A-Za-z0-9.-]/gu, "-"); }
function packageRecord(name, version, license, downloadLocation = "NOASSERTION") {
  return { SPDXID: identifier(name, version), name, versionInfo: version, downloadLocation,
    filesAnalyzed: false, licenseConcluded: license, licenseDeclared: license,
    copyrightText: "NOASSERTION", primaryPackagePurpose: "LIBRARY" };
}

export async function createDistributionSbom({ runtimeRoot, manifest, dependencyLedger }) {
  const ledger = validateArtifactLedger(dependencyLedger);
  const packages = new Map();
  for (const entry of ledger.artifacts) {
    const item = packageRecord(entry.name, entry.version, entry.license, entry.tarballUrl);
    item.checksums = [{ algorithm: "SHA256", checksumValue: entry.sha256.slice(7) },
      { algorithm: "SHA512", checksumValue: Buffer.from(entry.integrity.slice(7), "base64").toString("hex") }];
    item.comment = `Verified dependency seed content; treeDigest=${entry.treeDigest}; lifecycleScriptsExecuted=false`;
    packages.set(`${entry.name}@${entry.version}`, item);
  }
  const appRoot = path.join(runtimeRoot, manifest.components.app.path);
  async function addApplicationPackage(root) {
    const item = await readRegularJson(path.join(root, "package.json"));
    if (!item.name || !item.version || typeof item.license !== "string") throw new Error("application dependency lacks a declared license");
    const key = `${item.name}@${item.version}`;
    if (!packages.has(key)) packages.set(key, packageRecord(item.name, item.version, item.license));
    const modules = path.join(root, "node_modules");
    const children = await fs.readdir(modules, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const child of children) {
      if (child.name.startsWith(".") || !child.isDirectory()) continue;
      if (child.name.startsWith("@")) {
        for (const scoped of await fs.readdir(path.join(modules, child.name), { withFileTypes: true }))
          if (scoped.isDirectory()) await addApplicationPackage(path.join(modules, child.name, scoped.name));
      } else await addApplicationPackage(path.join(modules, child.name));
    }
  }
  await addApplicationPackage(appRoot);
  const app = packages.get(`only-my-pi@${manifest.version}`);
  app.primaryPackagePurpose = "APPLICATION";
  app.downloadLocation = `https://github.com/Ricardo121380/only-my-pi/tree/${manifest.sourceCommit}`;
  const records = [...packages.values()].sort((a, b) => a.SPDXID.localeCompare(b.SPDXID));
  const date = "1970-01-01T00:00:00.000Z";
  return { spdxVersion: "SPDX-2.3", dataLicense: "CC0-1.0", SPDXID: "SPDXRef-DOCUMENT",
    name: `only-my-pi-${manifest.version}-${manifest.platform.os}-${manifest.platform.arch}`,
    documentNamespace: `https://github.com/Ricardo121380/only-my-pi/releases/download/v${manifest.version}/sbom-${manifest.distributionId.slice(7)}`,
    creationInfo: { created: date, creators: ["Tool: only-my-pi-native-sbom-1"] },
    documentDescribes: [app.SPDXID], packages: records,
    relationships: records.map((item) => ({ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: item.SPDXID })),
    annotations: [{ annotationDate: date, annotationType: "OTHER", annotator: "Tool: only-my-pi-native-sbom-1",
      comment: `sourceCommit=${manifest.sourceCommit}; distributionId=${manifest.distributionId}; Node is supplied externally; dependencySeedSource=${ledger.sourceCommit}; no protected acceptance evidence is inherited` }] };
}

export function distributionNotices(sbom) {
  return [`${sbom.name} third-party notices`, "",
    "OMP is independent of the Pi and extension authors. Dependencies retain their own licenses.",
    "The runtime package does not include Node. Corresponding license texts are included in LICENSES and the dependency packages.",
    "Third-party lifecycle scripts were not executed while building the runtime.", "",
    ...sbom.packages.map((entry) => `${entry.name}@${entry.version} — ${entry.licenseDeclared}`), ""].join("\n");
}
