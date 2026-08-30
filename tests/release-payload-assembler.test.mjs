import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CONTROLLED_PI_VERSION,
  CONTROLLED_PI_INTEGRITY,
  PUBLIC_STACK_PACKAGES,
  assembleReleasePayloads,
  buildFullThinPayloads,
  inspectFullThinPayloadInputs,
  sha256,
} from "../packages/release-stack/index.mjs";

const SOURCE = "e".repeat(40);
const SRI = `sha512-${Buffer.alloc(64).toString("base64")}`;

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function tarball(name, version) {
  return `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
}

test("payload assembler derives one canonical manifest, ledger, SBOM, and Full/Thin pair", async (t) => {
  const root = await temporary(t, "omp-payload-assembler-");
  const resolved = path.join(root, "resolved");
  const external = path.join(resolved, "external-npm");
  await fs.mkdir(path.join(resolved, "node", "bin"), { recursive: true });
  await fs.writeFile(path.join(resolved, "node", "bin", "node"), "fixture node\n", { mode: 0o755 });
  await fs.symlink("node", path.join(resolved, "node", "bin", "node-alias"));
  await fs.mkdir(path.join(resolved, "pi", "dist", "bundle"), { recursive: true });
  const piManifest = { name: "@earendil-works/pi-coding-agent", version: CONTROLLED_PI_VERSION, license: "MIT", scripts: {} };
  await fs.writeFile(path.join(resolved, "pi", "package.json"), `${JSON.stringify(piManifest, null, 2)}\n`);
  await fs.writeFile(path.join(resolved, "pi", "package-lock.json"), `${JSON.stringify({ name: piManifest.name, version: piManifest.version, lockfileVersion: 3, packages: { "": piManifest } }, null, 2)}\n`);
  await fs.writeFile(path.join(resolved, "pi", "dist", "bundle", "cli.js"), "fixture pi\n");
  await fs.mkdir(path.join(external, "node_modules"), { recursive: true });
  const dependencies = Object.fromEntries(PUBLIC_STACK_PACKAGES.map(({ name, version }) => [name, version]).sort(([left], [right]) => left.localeCompare(right)));
  const externalDocument = { name: "only-my-pi-external-stack", version: "0.0.0", private: true, dependencies };
  const lock = { ...externalDocument, lockfileVersion: 3, requires: true, packages: { "": externalDocument } };
  const artifactBytes = new Map();
  const artifactTreeRoots = new Map();
  for (const { name, version } of PUBLIC_STACK_PACKAGES) {
    const packageRoot = path.join(external, "node_modules", ...name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    const manifest = { name, version, license: "MIT", scripts: name === "pi-memory" ? { postinstall: "node install.js" } : {} };
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(name)};\n`);
    lock.packages[`node_modules/${name}`] = { version, resolved: tarball(name, version), integrity: SRI, license: "MIT" };
    artifactBytes.set(`${name}@${version}`, Buffer.from(`artifact:${name}@${version}`));
    artifactTreeRoots.set(`${name}@${version}`, packageRoot);
  }
  await fs.writeFile(path.join(external, "package.json"), `${JSON.stringify(externalDocument, null, 2)}\n`);
  await fs.writeFile(path.join(external, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await fs.writeFile(path.join(resolved, "only-my-pi.tgz"), "fixture only-my-pi\n");
  const piIdentity = `${piManifest.name}@${piManifest.version}`;
  artifactBytes.set(piIdentity, Buffer.from(`artifact:${piIdentity}`));
  artifactTreeRoots.set(piIdentity, path.join(resolved, "pi"));
  const licenses = path.join(root, "licenses");
  await fs.mkdir(licenses);
  await fs.writeFile(path.join(licenses, "MIT.txt"), "MIT fixture\n");
  const install = path.join(root, "install.sh");
  await fs.writeFile(install, "#!/bin/sh\nset -eu\n", { mode: 0o755 });
  const assembled = await assembleReleasePayloads({
    resolvedRoot: resolved,
    outputRoot: path.join(root, "payloads"),
    sourceCommit: SOURCE,
    generationTargetGraphDigest: sha256("generation"),
    piIntegrity: CONTROLLED_PI_INTEGRITY,
    artifactBytes,
    artifactTreeRoots,
    installScriptPath: install,
    licensesRoot: licenses,
  });
  assert.equal(assembled.status, "RELEASE_PAYLOADS_ASSEMBLED");
  const currentManifest = JSON.parse(await fs.readFile(path.join(assembled.fullPayloadRoot, "stack-manifest.json"), "utf8"));
  assert.equal(currentManifest.onlyMyPi.version, "0.3.0-preview.1");
  assert.equal(currentManifest.capabilityCeiling.mode, "GUARDED_PROJECT_CODING");
  assert.equal(currentManifest.capabilityCeiling.writer, true);
  assert.ok(currentManifest.overlays.enabled.includes("writer"));
  assert.equal(await fs.readlink(path.join(assembled.fullPayloadRoot, "node", "bin", "node-alias")), "node");
  const inspected = await inspectFullThinPayloadInputs({ fullPayloadRoot: assembled.fullPayloadRoot, thinPayloadRoot: assembled.thinPayloadRoot, thinResolvedRoot: assembled.thinResolvedRoot });
  assert.equal(inspected.convergence.status, "PAYLOADS_CONVERGED");
  assert.equal(inspected.fullMetadata.ledger.artifacts.length, 10);
  assert.deepEqual(inspected.fullMetadata.stackManifest.externalPackages.find((entry) => entry.name === "pi-memory").lifecycleScripts.map((entry) => entry.executed), [false]);

  const receipt = path.join(root, "protected.json");
  await fs.writeFile(receipt, `${JSON.stringify({ status: "FIXTURE_PASS" })}\n`);
  const built = await buildFullThinPayloads({
    fullPayloadRoot: assembled.fullPayloadRoot,
    thinPayloadRoot: assembled.thinPayloadRoot,
    thinResolvedRoot: assembled.thinResolvedRoot,
    outputRoot: path.join(root, "release"),
    protectedReceiptPath: receipt,
    protectedEvidenceDigest: sha256(await fs.readFile(receipt)),
  });
  assert.equal(built.stackId, assembled.stackId);
});
