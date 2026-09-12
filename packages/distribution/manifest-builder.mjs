import fs from "node:fs/promises";
import path from "node:path";
import { PUBLIC_STACK_PACKAGES } from "../release-stack/contracts.mjs";
import { PACKAGE_IDS, NODE_RANGE, manifestDigest, validateDistributionManifest, hashDistributionTree } from "./runtime.mjs";

export async function createDistributionManifest({ root, version, sourceCommit, platform, packageFilters }) {
  const components = {};
  for (const [id, relative] of Object.entries({ app: "only-my-pi/package", pi: "pi", external: "external-npm" })) {
    components[id] = { path: relative, treeDigest: await hashDistributionTree(root, relative) };
  }
  const packages = [];
  for (const [id, name] of Object.entries(PACKAGE_IDS)) {
    const relative = `external-npm/node_modules/${name}`;
    const expected = PUBLIC_STACK_PACKAGES.find((item) => item.name === name);
    const actual = JSON.parse(await fs.readFile(path.join(root, relative, "package.json"), "utf8"));
    if (actual.name !== name || actual.version !== expected.version) throw new Error(`unexpected dependency identity: ${name}`);
    if (!Array.isArray(packageFilters?.[id])) throw new Error(`missing audited resource filter: ${id}`);
    packages.push({ id, name, version: expected.version, path: relative,
      treeDigest: await hashDistributionTree(root, relative), resourceFilter: packageFilters[id] });
  }
  const manifest = { formatVersion: 1, kind: "only-my-pi-distribution", version, sourceCommit,
    platform, nodeRange: NODE_RANGE, components, packages };
  manifest.distributionId = manifestDigest(manifest);
  return validateDistributionManifest(manifest);
}
