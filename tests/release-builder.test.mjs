import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  buildFullThinPayloads,
  createSpdxSbom,
  finalizeArtifactLedger,
  finalizeStackManifest,
  inspectResolvedStack,
  renderThirdPartyNotices,
  sha256,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "c".repeat(40);

async function temporary(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function read(relativePath) {
  return JSON.parse(await fs.readFile(path.join(ROOT, relativePath), "utf8"));
}

async function digestTree(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

async function createResolvedRoot(root, packageEntries) {
  await fs.mkdir(path.join(root, "node", "bin"), { recursive: true });
  await fs.writeFile(path.join(root, "node", "bin", "node"), "fixture node\n", { mode: 0o755 });
  await fs.mkdir(path.join(root, "pi", "dist", "bundle"), { recursive: true });
  await fs.writeFile(path.join(root, "pi", "dist", "bundle", "cli.js"), "fixture pi\n", { mode: 0o755 });
  for (const entry of packageEntries) {
    const packageRoot = path.join(root, "external-npm", "node_modules", ...entry.name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: entry.name, version: entry.version, license: "MIT" })}\n`);
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(entry.name)};\n`);
  }
  await fs.writeFile(path.join(root, "external-npm", "package-lock.json"), "{}\n");
  await fs.writeFile(path.join(root, "only-my-pi.tgz"), "fixture only-my-pi artifact\n");
}

async function writeMetadata(root, { stackManifest, ledger, sbom, notices }) {
  await fs.writeFile(path.join(root, "stack-manifest.json"), `${JSON.stringify(stackManifest, null, 2)}\n`);
  await fs.writeFile(path.join(root, "transitive-artifact-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  await fs.writeFile(path.join(root, "sbom.spdx.json"), `${JSON.stringify(sbom, null, 2)}\n`);
  await fs.writeFile(path.join(root, "THIRD_PARTY_NOTICES.txt"), notices);
  await fs.writeFile(path.join(root, "install.sh"), "#!/bin/sh\nset -eu\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(path.join(root, "protected-receipt.json"), `${JSON.stringify({ formatVersion: 1, status: "FIXTURE_PASS", digest: sha256("fixture-receipt") })}\n`);
  await fs.mkdir(path.join(root, "LICENSES"));
  await fs.writeFile(path.join(root, "LICENSES", "MIT.txt"), "MIT fixture license\n");
}

async function releaseFixture(t) {
  const full = await temporary(t, "omp-release-full-");
  const thin = await temporary(t, "omp-release-thin-");
  const thinResolved = await temporary(t, "omp-release-thin-resolved-");
  const base = await read("contracts/release/stack-manifest.example.json");
  await createResolvedRoot(full, base.externalPackages);
  await fs.cp(path.join(full, "node"), path.join(thinResolved, "node"), { recursive: true });
  await fs.cp(path.join(full, "pi"), path.join(thinResolved, "pi"), { recursive: true });
  await fs.cp(path.join(full, "external-npm"), path.join(thinResolved, "external-npm"), { recursive: true });
  await fs.copyFile(path.join(full, "only-my-pi.tgz"), path.join(thinResolved, "only-my-pi.tgz"));

  const ledgerBase = await read("contracts/release/transitive-artifact-ledger.example.json");
  ledgerBase.sourceCommit = SOURCE;
  delete ledgerBase.ledgerDigest;
  const ledger = finalizeArtifactLedger(ledgerBase);
  const manifestBase = structuredClone(base);
  manifestBase.sourceCommit = SOURCE;
  manifestBase.transitiveLedgerSha256 = ledger.ledgerDigest;
  manifestBase.onlyMyPi.artifactSha256 = sha256(await fs.readFile(path.join(full, "only-my-pi.tgz")));
  manifestBase.runtime.node.treeDigest = await digestTree(full, "node");
  manifestBase.runtime.pi.treeDigest = await digestTree(full, "pi");
  manifestBase.externalTreeDigest = await digestTree(full, "external-npm");
  for (const entry of manifestBase.externalPackages) entry.treeDigest = await digestTree(full, path.posix.join("external-npm", "node_modules", entry.name));
  delete manifestBase.stackId;
  const stackManifest = finalizeStackManifest(manifestBase);
  const sbom = createSpdxSbom({ stackManifest, ledger });
  const notices = renderThirdPartyNotices({ stackManifest, ledger });
  await writeMetadata(full, { stackManifest, ledger, sbom, notices });
  await writeMetadata(thin, { stackManifest, ledger, sbom, notices });
  return { full, thin, thinResolved, stackManifest, ledger };
}

test("release builder creates reproducible Full and Thin assets with one stack identity", async (t) => {
  const fixture = await releaseFixture(t);
  const leftOutput = await temporary(t, "omp-release-output-left-");
  const rightOutput = await temporary(t, "omp-release-output-right-");
  const options = {
    fullPayloadRoot: fixture.full,
    thinPayloadRoot: fixture.thin,
    thinResolvedRoot: fixture.thinResolved,
    protectedEvidenceDigest: sha256("protected-evidence"),
  };
  const left = await buildFullThinPayloads({ ...options, outputRoot: leftOutput });
  const right = await buildFullThinPayloads({ ...options, outputRoot: rightOutput });
  assert.equal(left.stackId, fixture.stackManifest.stackId);
  assert.equal(left.releaseIndex.assets.full.sha256, right.releaseIndex.assets.full.sha256);
  assert.equal(left.releaseIndex.assets.thin.sha256, right.releaseIndex.assets.thin.sha256);
  assert.equal(left.releaseIndex.stackManifestSha256, right.releaseIndex.stackManifestSha256);
  assert.equal(left.convergence.status, "PAYLOADS_CONVERGED");
  assert.equal(left.releaseIndex.status, "RC");
});

test("resolved stack inspection binds all four trees and every external package", async (t) => {
  const fixture = await releaseFixture(t);
  const result = await inspectResolvedStack({ resolvedRoot: fixture.full, stackManifest: fixture.stackManifest });
  assert.equal(result.stackId, fixture.stackManifest.stackId);
  assert.equal(Object.keys(result.externalPackages).length, 9);
  assert.equal(result.externalTreeDigest, fixture.stackManifest.externalTreeDigest);
});

test("Full/Thin convergence fails closed on one changed staged package", async (t) => {
  const fixture = await releaseFixture(t);
  const output = await temporary(t, "omp-release-output-drift-");
  const target = path.join(fixture.thinResolved, "external-npm", "node_modules", "pi-subagents", "index.js");
  await fs.appendFile(target, "// drift\n");
  await assert.rejects(buildFullThinPayloads({
    fullPayloadRoot: fixture.full,
    thinPayloadRoot: fixture.thin,
    thinResolvedRoot: fixture.thinResolved,
    outputRoot: output,
    protectedEvidenceDigest: sha256("protected-evidence"),
  }), { code: "RESOLVED_STACK_IDENTITY_MISMATCH" });
});

test("Full/Thin metadata divergence is rejected before archive publication", async (t) => {
  const fixture = await releaseFixture(t);
  const output = await temporary(t, "omp-release-output-metadata-");
  const ledger = JSON.parse(await fs.readFile(path.join(fixture.thin, "transitive-artifact-ledger.json"), "utf8"));
  ledger.artifacts.reverse();
  await fs.writeFile(path.join(fixture.thin, "transitive-artifact-ledger.json"), `${JSON.stringify(ledger, null, 2)}\n`);
  await assert.rejects(buildFullThinPayloads({
    fullPayloadRoot: fixture.full,
    thinPayloadRoot: fixture.thin,
    thinResolvedRoot: fixture.thinResolved,
    outputRoot: output,
    protectedEvidenceDigest: sha256("protected-evidence"),
  }), { code: "LEDGER_DIGEST_INVALID" });
});
