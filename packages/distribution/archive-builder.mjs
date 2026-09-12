import fs from "node:fs/promises";
import path from "node:path";
import { createDeterministicTarGzip, hashFile } from "../release-stack/deterministic-archive.mjs";
import { hashDistributionTree } from "./runtime.mjs";

export async function buildDistributionArchives({ rootDir, outputRoot, work, seed, seedManifest, receipt }) {
  if (await hashDistributionTree(seed, "node") !== seedManifest.runtime.node.treeDigest)
    throw new Error("Full archive Node seed differs from the verified identity");
  const archives = [];
  for (const mode of ["full", "thin"]) {
    const root = path.join(work, `fallback-${mode}`);
    await fs.mkdir(path.join(root, "packages/distribution"), { recursive: true });
    await fs.mkdir(path.join(root, "packages/bootstrap"), { recursive: true });
    for (const item of receipt.artifacts) await fs.copyFile(path.join(outputRoot, item.filename), path.join(root, item.filename));
    for (const relative of ["packages/distribution/archive-installer.mjs", "packages/bootstrap/resource-hash.mjs", "LICENSE"])
      await fs.copyFile(path.join(rootDir, relative), path.join(root, relative));
    if (mode === "full") await fs.cp(path.join(seed, "node"), path.join(root, "node"), { recursive: true, verbatimSymlinks: true });
    const manifest = { formatVersion: 1, kind: "only-my-pi-native-archive", mode, platform: "darwin-arm64",
      version: receipt.version, sourceCommit: receipt.sourceCommit, distributionId: receipt.distributionId,
      node: seedManifest.runtime.node, packages: receipt.artifacts };
    await fs.writeFile(path.join(root, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.writeFile(path.join(root, "install.mjs"), `import {installDistributionArchive} from './packages/distribution/archive-installer.mjs';
import {fileURLToPath} from 'node:url';
const [flag,prefix,nodeRoot,...extra]=process.argv.slice(2);
if(flag!=='--prefix'||!prefix||!nodeRoot||extra.length)throw new Error('Usage: ./install.sh --prefix /absolute/new/directory');
console.log(JSON.stringify(await installDistributionArchive({archiveRoot:fileURLToPath(new URL('.',import.meta.url)),prefix,nodeRoot}),null,2));
`);
    const bootstrap = mode === "full" ? 'exec "$OMP_ROOT/node/bin/node" "$OMP_ROOT/install.mjs" "$@" "$OMP_ROOT/node"' : `OMP_TEMP=$(mktemp -d)
trap 'rm -rf "$OMP_TEMP"' EXIT HUP INT TERM
curl --fail --location --proto '=https' --proto-redir '=https' --max-time 120 --output "$OMP_TEMP/node.tar.gz" 'https://nodejs.org/dist/v${manifest.node.version}/${manifest.node.archiveName}'
printf '%s  %s\\n' '${manifest.node.archiveSha256.slice(7)}' "$OMP_TEMP/node.tar.gz" | shasum -a 256 -c -
tar -xzf "$OMP_TEMP/node.tar.gz" -C "$OMP_TEMP"
OMP_NODE="$OMP_TEMP/node-v${manifest.node.version}-darwin-arm64"
"$OMP_NODE/bin/node" "$OMP_ROOT/install.mjs" "$@" "$OMP_NODE"`;
    await fs.writeFile(path.join(root, "install.sh"), `#!/bin/sh
set -eu
if [ "$#" -ne 2 ] || [ "$1" != '--prefix' ]; then printf '%s\\n' 'Usage: ./install.sh --prefix /absolute/new/directory' >&2; exit 2; fi
OMP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
${bootstrap}
`, { mode: 0o755 });
    await fs.writeFile(path.join(root, "README.txt"), `OMP ${receipt.version} Public Preview — ${mode} fallback\nRun ./install.sh --prefix /absolute/new/directory, then /absolute/new/directory/bin/omp.\nThe installer leaves existing commands, Pi configuration and sessions untouched.\nFull installs offline; Thin downloads only the checksum-pinned Node runtime during installation.\nUpgrade into a new directory and select its omp command explicitly. Retain the prior directory for rollback.\n`);
    const filename = `only-my-pi-${receipt.version}-darwin-arm64-${mode}.tar.gz`;
    await createDeterministicTarGzip({ rootDir: root, outputPath: path.join(outputRoot, filename), rootName: "only-my-pi" });
    archives.push({ mode, filename, sha256: await hashFile(path.join(outputRoot, filename)), distributionId: receipt.distributionId });
  }
  return archives;
}
