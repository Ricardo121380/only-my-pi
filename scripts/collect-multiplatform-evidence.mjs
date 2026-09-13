import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "../packages/config-runtime/index.mjs";
import { hashFile } from "../packages/release-stack/deterministic-archive.mjs";
import { RELEASE_PLATFORMS, MULTIPLATFORM_ASSERTIONS, inspectMultiplatformRelease } from "../packages/distribution/multiplatform-release-policy.mjs";

const [candidateDirectory, proofsDirectory, output] = process.argv.slice(2);
if (![candidateDirectory, proofsDirectory, output].every((value) => path.isAbsolute(value ?? "")))
  throw new Error("Usage: collect-multiplatform-evidence.mjs /candidate /downloaded-proof-jsons /new-evidence.json");
const receipt = JSON.parse(await fs.readFile(path.join(candidateDirectory, "build-receipt.json")));
const buildReceiptDigest = await hashFile(path.join(candidateDirectory, "build-receipt.json"));
assert.match(receipt.sourceCommit, /^[a-f0-9]{40}$/u);
const harness = await promisify(callback)("git", ["show", `${receipt.sourceCommit}:scripts/verify-native-live.py`],
  { cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "buffer", maxBuffer: 1024 * 1024 });
const harnessDigest = sha256(harness.stdout);
const records = [];
async function scan(directory, depth = 0) {
  assert.ok(depth < 8, "unexpected proof directory nesting");
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(file, depth + 1);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const bytes = await fs.readFile(file);
      assert.ok(bytes.length < 4 * 1024 * 1024, "unexpectedly large proof");
      records.push({ value: JSON.parse(bytes), digest: sha256(bytes) });
    }
  }
}
await scan(proofsDirectory);
const evidence = { formatVersion: 1, kind: "only-my-pi-multiplatform-protected-evidence", status: "PASS",
  version: receipt.version, sourceCommit: receipt.sourceCommit, buildReceiptSha256: buildReceiptDigest, platforms: {} };
const labels = ["global-install", "verify-offline", "version-offline", "doctor-offline", "raw-pi-offline", "npx-fresh-cache", "global-uninstall", "global-reinstall", "reinstall-verify-offline"].sort();
for (const platform of RELEASE_PLATFORMS) {
  const distributionId = receipt.platforms?.[platform]?.distributionId;
  const select = (status, predicate = () => true) => {
    const match = records.find(({ value }) => value.status === status && value.sourceCommit === receipt.sourceCommit
      && value.distributionId === distributionId && value.buildReceiptSha256 === buildReceiptDigest && predicate(value));
    assert.ok(match, `${platform}: missing accepted ${status}`);
    return match;
  };
  const bindings = {};
  for (const node of ["22.19.0", "24.19.0"]) {
    const proof = select("LOCAL_INSTALL_ACCEPTANCE_PASS", (v) => v.node === node);
    assert.equal(proof.value.publicRegistryVerified, false);
    assert.deepEqual(proof.value.checks.map((c) => c.label).sort(),
      [...labels, ...(platform === "darwin-arm64" ? ["global-install-previous", "upgrade-version-offline"] : [])].sort());
    if (platform === "darwin-arm64") assert.equal(proof.value.productUpgrade, true);
    assert.ok(proof.value.checks.every((c) => c.exitCode === 0));
    bindings[`npm-node${node.split(".")[0]}-lifecycle`] = proof.digest;
    if (node.startsWith("24.")) bindings["dependency-complete-startup"] = proof.digest;
  }
  const archive = select("LOCAL_ARCHIVE_ACCEPTANCE_PASS");
  assert.ok(archive.value.fullInstalledOffline && archive.value.thinInstalledFromPinnedNode && archive.value.unknownFilesPreserved);
  assert.equal(archive.value.identities.length, 2);
  assert.ok(archive.value.identities.every((v) => v.sourceCommit === receipt.sourceCommit && v.distributionId === distributionId && v.installation.channel === "archive"));
  bindings["full-thin-identity"] = archive.digest;
  const migration = select("INSTALLED_MIGRATION_ACCEPTANCE_PASS");
  for (const id of ["legacy-migration", "path-shadow-detection", "unknown-files-preserved"]) assert.equal(migration.value.assertions[id], true);
  bindings["legacy-migration"] = bindings["path-shadow-detection"] = migration.digest;
  const live = select("NATIVE_LIVE_ACCEPTANCE_PASS", (v) => `${v.platform.os}-${v.platform.arch}` === platform);
  assert.equal(live.value.harnessSha256, harnessDigest, "live harness differs from the collector source");
  assert.equal(live.value.model, "cc-switch-kimi-for-coding/kimi-for-coding");
  assert.equal(live.value.version, receipt.version);
  for (const id of ["models-and-inspect", "coding-approval", "resume-reapproval", "readonly-headless", "readonly-subagents", "managed-clone-writer", "project-gates-and-review", "cancel-and-cleanup", "unknown-files-preserved"]) {
    assert.equal(live.value.assertions[id], true, `${platform} missing live ${id}`);
    bindings[id] = live.digest;
  }
  if (platform === "darwin-arm64") {
    const brew = select("HOMEBREW_CANDIDATE_LIFECYCLE_PASS");
    assert.equal(brew.value.buildReceiptSha256, buildReceiptDigest);
    assert.equal(brew.value.previousVersion, "0.4.0-preview.1");
    for (const key of ["productUpgrade", "formulaTest", "uninstall", "reinstall", "userDataPreserved"]) assert.equal(brew.value[key], true);
    bindings["homebrew-lifecycle"] = brew.digest;
  } else {
    const probe = records.find(({ value: v }) => v.status === "LINUX_SANDBOX_PREFLIGHT_PASS" && v.sourceCommit === receipt.sourceCommit
      && `${v.platform}-${v.arch}` === platform);
    assert.ok(probe, `${platform}: missing environment isolation proof`);
    for (const key of ["nonRoot", "dependencies", "glibc", "freshProc", "pidNamespace", "networkNamespace", "realNetworkDenied", "privateReadDenied", "outsideWriteDenied", "allowedWrite"])
      assert.ok(probe.value.checks.includes(key));
    bindings["strong-sandbox-isolation"] = probe.digest;
  }
  const ids = [...MULTIPLATFORM_ASSERTIONS, platform === "darwin-arm64" ? "homebrew-lifecycle" : "strong-sandbox-isolation"];
  evidence.platforms[platform] = { distributionId, assertions: ids.map((id) => ({ id, status: "PASS", evidenceSha256: bindings[id] })) };
}
evidence.evidenceDigest = sha256(canonicalJson(evidence));
await inspectMultiplatformRelease({ candidateDirectory, receipt, evidence, buildReceiptDigest });
await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: "PROTECTED_EVIDENCE_COLLECTED", sourceCommit: receipt.sourceCommit, output }));
