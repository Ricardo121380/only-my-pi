import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildArtifactLedger,
  createSpdxSbom,
  hashPackageContentTree,
  renderThirdPartyNotices,
  sbomDigest,
  validateSpdxSbom,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRI = `sha512-${Buffer.alloc(64).toString("base64")}`;

function read(relativePath) {
  return fs.readFile(path.join(ROOT, relativePath), "utf8").then(JSON.parse);
}

async function fixtureTree(t, { integrity = SRI, resolved = "https://registry.npmjs.org/example-package/-/example-package-1.2.3.tgz", license = "MIT" } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-ledger-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "node_modules", "example-package");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "example-package",
    version: "1.2.3",
    license,
    scripts: { postinstall: "node postinstall.js", test: "node test.js" },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(packageRoot, "index.js"), "export default 1;\n");
  await fs.writeFile(path.join(root, "package-lock.json"), `${JSON.stringify({
    name: "fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture", version: "1.0.0", dependencies: { "example-package": "1.2.3" } },
      "node_modules/example-package": { version: "1.2.3", resolved, ...(integrity === null ? {} : { integrity }) },
    },
  }, null, 2)}\n`);
  return root;
}

test("artifact ledger binds lock, disk tree, tarball bytes, lifecycle, and license", async (t) => {
  const npmRoot = await fixtureTree(t);
  const bytes = Buffer.from("fixture-tarball");
  const ledger = await buildArtifactLedger({
    npmRoot,
    sourceCommit: "b".repeat(40),
    artifactBytes: new Map([["example-package@1.2.3", bytes]]),
    topLevelNames: ["example-package"],
  });
  assert.equal(ledger.artifacts.length, 1);
  assert.equal(ledger.artifacts[0].license, "MIT");
  assert.equal(ledger.artifacts[0].topLevel, true);
  assert.deepEqual(ledger.artifacts[0].lifecycleScripts.map((entry) => [entry.name, entry.executed]), [["postinstall", false]]);
  assert.match(ledger.artifacts[0].treeDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("artifact ledger uses verified tarball content identity independent of installed hoisting", async (t) => {
  const npmRoot = await fixtureTree(t);
  const artifactParent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-ledger-artifact-")));
  t.after(() => fs.rm(artifactParent, { recursive: true, force: true }));
  const artifactRoot = path.join(artifactParent, "package");
  await fs.cp(path.join(npmRoot, "node_modules", "example-package"), artifactRoot, { recursive: true });
  await fs.mkdir(path.join(npmRoot, "node_modules", "example-package", "node_modules", "hoisted-difference"), { recursive: true });
  await fs.writeFile(path.join(npmRoot, "node_modules", "example-package", "node_modules", "hoisted-difference", "index.js"), "different install layout\n");
  const ledger = await buildArtifactLedger({
    npmRoot,
    sourceCommit: "b".repeat(40),
    artifactBytes: new Map([["example-package@1.2.3", Buffer.from("fixture-tarball")]]),
    artifactTreeRoots: new Map([["example-package@1.2.3", artifactRoot]]),
  });
  assert.equal(ledger.artifacts[0].treeDigest, await hashPackageContentTree(artifactRoot));
  assert.equal(await hashPackageContentTree(path.join(npmRoot, "node_modules", "example-package")), ledger.artifacts[0].treeDigest);
  await fs.appendFile(path.join(npmRoot, "node_modules", "example-package", "index.js"), "// package drift\n");
  assert.notEqual(await hashPackageContentTree(path.join(npmRoot, "node_modules", "example-package")), ledger.artifacts[0].treeDigest);
});

test("artifact ledger requires complete integrity and verified tarball bytes", async (t) => {
  const npmRoot = await fixtureTree(t, { integrity: null });
  await assert.rejects(buildArtifactLedger({
    npmRoot,
    sourceCommit: "b".repeat(40),
    artifactBytes: { "example-package@1.2.3": Buffer.from("fixture") },
  }), { code: "LEDGER_INTEGRITY_MISSING" });

  const overridden = await buildArtifactLedger({
    npmRoot,
    sourceCommit: "b".repeat(40),
    artifactBytes: { "example-package@1.2.3": Buffer.from("fixture") },
    integrityOverrides: { "example-package@1.2.3": SRI },
  });
  assert.equal(overridden.artifacts[0].integrity, SRI);

  await assert.rejects(buildArtifactLedger({
    npmRoot,
    sourceCommit: "b".repeat(40),
    artifactBytes: {},
    integrityOverrides: { "example-package@1.2.3": SRI },
  }), { code: "LEDGER_ARTIFACT_BYTES_REQUIRED" });
});

test("artifact ledger rejects credentialed registry URLs and unresolved licenses", async (t) => {
  const unsafe = await fixtureTree(t, { resolved: "https://user:pass@registry.npmjs.org/example.tgz" });
  await assert.rejects(buildArtifactLedger({ npmRoot: unsafe, sourceCommit: "b".repeat(40), artifactBytes: {} }), { code: "LEDGER_LOCK_URL_INVALID" });

  const unlicensed = await fixtureTree(t, { license: null });
  await assert.rejects(buildArtifactLedger({
    npmRoot: unlicensed,
    sourceCommit: "b".repeat(40),
    artifactBytes: { "example-package@1.2.3": Buffer.from("fixture") },
  }), { code: "LEDGER_LICENSE_UNRESOLVED" });
});

test("SPDX 2.3 output is deterministic and bound to the canonical stack", async () => {
  const [stackManifest, ledger] = await Promise.all([
    read("contracts/release/stack-manifest.example.json"),
    read("contracts/release/transitive-artifact-ledger.example.json"),
  ]);
  const left = createSpdxSbom({ stackManifest, ledger });
  const right = createSpdxSbom({ stackManifest, ledger });
  assert.deepEqual(left, right);
  assert.equal(left.spdxVersion, "SPDX-2.3");
  assert.equal(left.packages.length, ledger.artifacts.length);
  assert.equal(sbomDigest(left), sbomDigest(right));
  assert.doesNotThrow(() => validateSpdxSbom(left, { stackManifest, ledger }));
});

test("SPDX validation rejects checksum and license drift", async () => {
  const [stackManifest, ledger] = await Promise.all([
    read("contracts/release/stack-manifest.example.json"),
    read("contracts/release/transitive-artifact-ledger.example.json"),
  ]);
  const checksum = structuredClone(createSpdxSbom({ stackManifest, ledger }));
  checksum.packages[0].checksums[0].checksumValue = "0".repeat(64);
  assert.throws(() => validateSpdxSbom(checksum, { stackManifest, ledger }), { code: "SBOM_CHECKSUM_INVALID" });

  const license = structuredClone(createSpdxSbom({ stackManifest, ledger }));
  license.packages[0].licenseConcluded = "NOASSERTION";
  assert.throws(() => validateSpdxSbom(license, { stackManifest, ledger }), { code: "SBOM_PACKAGE_EVIDENCE_INVALID" });
});

test("third-party notices declare independence and exact artifact evidence", async () => {
  const [stackManifest, ledger] = await Promise.all([
    read("contracts/release/stack-manifest.example.json"),
    read("contracts/release/transitive-artifact-ledger.example.json"),
  ]);
  const notices = renderThirdPartyNotices({ stackManifest, ledger });
  assert.match(notices, /independent project/u);
  assert.match(notices, /Lifecycle scripts were not executed/u);
  assert.match(notices, /@earendil-works\/pi-coding-agent@0\.84\.3/u);
  assert.match(notices, new RegExp(stackManifest.stackId, "u"));
});
