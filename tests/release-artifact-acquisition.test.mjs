import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireInstalledArtifacts, sha256 } from "../packages/release-stack/index.mjs";

const SRI_A = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;
const SRI_B = `sha512-${Buffer.alloc(64, 2).toString("base64")}`;

async function temporary(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-artifact-acquisition-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function fixtureRoot(root) {
  const manifests = {
    "package-a@1.0.0": { name: "package-a", version: "1.0.0", license: "MIT" },
    "package-b@2.0.0": { name: "package-b", version: "2.0.0", license: "ISC" },
  };
  for (const manifest of Object.values(manifests)) {
    const target = path.join(root, "node_modules", manifest.name);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "package.json"), `${JSON.stringify(manifest)}\n`);
  }
  await fs.writeFile(path.join(root, "package-lock.json"), `${JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", version: "1.0.0" },
      "node_modules/package-a": { version: "1.0.0", resolved: "https://registry.npmjs.org/package-a/-/package-a-1.0.0.tgz", integrity: SRI_A },
      "node_modules/package-b": { version: "2.0.0", resolved: "https://registry.npmjs.org/package-b/-/package-b-2.0.0.tgz" },
      "node_modules/missing-optional": { version: "3.0.0", resolved: "https://registry.npmjs.org/missing-optional/-/missing-optional-3.0.0.tgz", integrity: SRI_A, optional: true },
    },
  }, null, 2)}\n`);
  return manifests;
}

test("artifact acquisition completes missing SRI from exact metadata and binds downloaded content trees", async (t) => {
  const base = await temporary(t);
  const npmRoot = path.join(base, "npm");
  await fs.mkdir(npmRoot);
  const manifests = await fixtureRoot(npmRoot);
  const downloads = [];
  const metadata = [];
  const result = await acquireInstalledArtifacts({
    roots: [
      { npmRoot, lockPath: path.join(npmRoot, "package-lock.json") },
      { npmRoot, lockPath: path.join(npmRoot, "package-lock.json") },
    ],
    outputRoot: path.join(base, "artifacts"),
    async fetchMetadata(options) {
      metadata.push(options);
      return { document: { dist: { tarball: "https://registry.npmjs.org/package-b/-/package-b-2.0.0.tgz", integrity: SRI_B } } };
    },
    async download(options) {
      downloads.push(options);
      const bytes = Buffer.from(options.url);
      await fs.writeFile(options.destination, bytes);
      return { sha256: sha256(bytes), integrity: options.expectedSri };
    },
    async extract({ destination, archivePath }) {
      const archiveName = (await fs.readFile(archivePath, "utf8")).includes("package-a") ? "package-a@1.0.0" : "package-b@2.0.0";
      const rootName = archiveName.startsWith("package-a") ? "package" : "package-b-content";
      await fs.mkdir(path.join(destination, rootName), { recursive: true });
      await fs.writeFile(path.join(destination, rootName, "package.json"), `${JSON.stringify(manifests[archiveName])}\n`);
    },
  });
  assert.equal(metadata.length, 2);
  assert.equal(metadata[0].url, "https://registry.npmjs.org/package-b/2.0.0");
  assert.deepEqual(downloads.map((entry) => entry.expectedSri).sort(), [SRI_A, SRI_B].sort());
  assert.equal(result.artifacts.length, 2);
  assert.match(result.artifactBytes.get("package-a@1.0.0").sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.integrityOverrides["package-b@2.0.0"], SRI_B);
  assert.equal(JSON.parse(await fs.readFile(path.join(result.artifactTreeRoots.get("package-b@2.0.0"), "package.json"), "utf8")).version, "2.0.0");
});

test("artifact acquisition fails closed on metadata URL drift and missing non-optional packages", async (t) => {
  const base = await temporary(t);
  const npmRoot = path.join(base, "npm");
  await fs.mkdir(npmRoot);
  await fixtureRoot(npmRoot);
  await assert.rejects(acquireInstalledArtifacts({
    roots: [{ npmRoot, lockPath: path.join(npmRoot, "package-lock.json") }],
    outputRoot: path.join(base, "metadata-drift"),
    async fetchMetadata() { return { document: { dist: { tarball: "https://registry.npmjs.org/package-b/-/other.tgz", integrity: SRI_B } } }; },
  }), { code: "RELEASE_ARTIFACT_METADATA_DRIFT" });

  const lockPath = path.join(npmRoot, "package-lock.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.packages["node_modules/missing-required"] = { version: "1.0.0", resolved: "https://registry.npmjs.org/missing-required/-/missing-required-1.0.0.tgz", integrity: SRI_A };
  await fs.writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await assert.rejects(acquireInstalledArtifacts({
    roots: [{ npmRoot, lockPath }],
    outputRoot: path.join(base, "missing-required"),
  }), { code: "ENOENT" });
});

test("artifact acquisition attributes archive failures to the exact package identity", async (t) => {
  const base = await temporary(t);
  const npmRoot = path.join(base, "npm");
  await fs.mkdir(npmRoot);
  await fixtureRoot(npmRoot);
  await assert.rejects(acquireInstalledArtifacts({
    roots: [{ npmRoot, lockPath: path.join(npmRoot, "package-lock.json") }],
    outputRoot: path.join(base, "archive-failure"),
    async fetchMetadata() { return { document: { dist: { tarball: "https://registry.npmjs.org/package-b/-/package-b-2.0.0.tgz", integrity: SRI_B } } }; },
    async download(options) { await fs.writeFile(options.destination, "fixture"); return { sha256: sha256("fixture"), integrity: options.expectedSri }; },
    async extract() { throw Object.assign(new Error("duplicate entry"), { code: "ARCHIVE_DUPLICATE_ENTRY" }); },
  }), (error) => error.code === "ARCHIVE_DUPLICATE_ENTRY" && error.artifactIdentity === "package-a@1.0.0" && /package-a@1\.0\.0/u.test(error.message));
});
