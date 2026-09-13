import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { canonicalJson, sha256 } from "../packages/config-runtime/index.mjs";
import { MULTIPLATFORM_ASSERTIONS, RELEASE_PLATFORMS, validateMultiplatformEvidence, inspectMultiplatformRelease } from "../packages/distribution/multiplatform-release-policy.mjs";
import { homebrewFormula } from "../packages/distribution/homebrew.mjs";
import { validatePublicPlatformAcceptance } from "../packages/distribution/public-acceptance.mjs";

function fixture() {
  const receipt = { status: "MULTIPLATFORM_CANDIDATE_NOT_PUBLISHED", version: "0.4.0-preview.2", sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    platforms: Object.fromEntries(RELEASE_PLATFORMS.map((platform, i) => [platform, { name: `only-my-pi-runtime-${platform}`, distributionId: `sha256:${String(i).repeat(64)}` }])) };
  const buildReceiptDigest = `sha256:${"c".repeat(64)}`;
  const evidence = { formatVersion: 1, kind: "only-my-pi-multiplatform-protected-evidence", status: "PASS",
    version: receipt.version, sourceCommit: receipt.sourceCommit, buildReceiptSha256: buildReceiptDigest,
    platforms: Object.fromEntries(RELEASE_PLATFORMS.map((platform) => [platform, {
      distributionId: receipt.platforms[platform].distributionId,
      assertions: [...MULTIPLATFORM_ASSERTIONS, platform === "darwin-arm64" ? "homebrew-lifecycle" : "strong-sandbox-isolation"]
        .map((id) => ({ id, status: "PASS", evidenceSha256: `sha256:${"d".repeat(64)}` })),
    }])) };
  const seal = () => { delete evidence.evidenceDigest; evidence.evidenceDigest = sha256(canonicalJson(evidence)); };
  seal();
  return { receipt, evidence, buildReceiptDigest, seal };
}

test("phase two requires every platform's source-bound protected assertions", () => {
  const f = fixture();
  assert.equal(validateMultiplatformEvidence(f.evidence, f.receipt, f.buildReceiptDigest), f.evidence);
  for (const alter of [
    (g) => { delete g.evidence.platforms["linux-arm64"]; },
    (g) => { g.evidence.platforms["linux-x64"].distributionId = g.evidence.platforms["linux-arm64"].distributionId; },
    (g) => { g.evidence.sourceCommit = "b".repeat(40); },
    (g) => { g.evidence.platforms["linux-x64"].assertions[0].status = "NOT_RUN"; },
    (g) => { g.evidence.platforms["darwin-arm64"].assertions.pop(); },
    (g) => { g.evidence.kind = "only-my-pi-native-protected-evidence"; },
    (g) => { g.evidence.status = "NATIVE_LIVE_SUBSET_PASS"; },
    (g) => { g.receipt.status = "PLATFORM_CANDIDATE_NOT_PUBLISHABLE"; },
  ]) {
    const g = fixture(); alter(g); g.seal();
    assert.throws(() => validateMultiplatformEvidence(g.evidence, g.receipt, g.buildReceiptDigest), /release refused/u);
  }
});

test("default tags require exact public acceptance for the selected platform and Node", () => {
  const { receipt } = fixture();
  const platform = "linux-x64";
  const buildReceiptDigest = sha256(JSON.stringify(receipt));
  const acceptance = { status: "PUBLIC_INSTALL_ACCEPTANCE_PASS", version: receipt.version,
    buildReceiptSha256: buildReceiptDigest,
    platform, node: "24.19.0", selector: `only-my-pi@${receipt.version}`, publicRegistryVerified: true,
    sourceCommit: receipt.sourceCommit, distributionId: receipt.platforms[platform].distributionId,
    checks: ["global-install", "verify-offline", "version-offline", "doctor-offline", "raw-pi-offline", "npx-fresh-cache", "global-uninstall", "global-reinstall", "reinstall-verify-offline"].map((label) => ({ label, exitCode: 0 })) };
  assert.equal(validatePublicPlatformAcceptance(acceptance, receipt, "24.19.0", platform, buildReceiptDigest), acceptance);
  for (const changed of [{ node: "22.19.0" }, { platform: "linux-arm64" }, { selector: "only-my-pi" },
    { publicRegistryVerified: false }, { buildReceiptSha256: sha256("provisional CLI") }, { checks: Array(9).fill({ label: "global-install", exitCode: 0 }) }])
    assert.throws(() => validatePublicPlatformAcceptance({ ...acceptance, ...changed }, receipt, "24.19.0", platform, buildReceiptDigest), /public acceptance missing/u);
});

test("publication verifies all four npm packages, six archives and generated formula bytes", async (t) => {
  const f = fixture();
  const candidateDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-multi-release-"));
  t.after(() => fs.rm(candidateDirectory, { recursive: true, force: true }));
  async function artifact(filename) {
    await fs.writeFile(path.join(candidateDirectory, filename), filename);
    return { filename, sha256: sha256(filename) };
  }
  f.receipt.artifacts = [];
  for (const name of [...RELEASE_PLATFORMS.map((platform) => `only-my-pi-runtime-${platform}`), "only-my-pi"])
    f.receipt.artifacts.push({ name, version: f.receipt.version, ...await artifact(`${name}-${f.receipt.version}.tgz`) });
  f.receipt.archives = [];
  for (const platform of RELEASE_PLATFORMS) for (const mode of ["full", "thin"])
    f.receipt.archives.push({ platform, mode, distributionId: f.receipt.platforms[platform].distributionId,
      ...await artifact(`only-my-pi-${f.receipt.version}-${platform}-${mode}.tar.gz`) });
  const formula = homebrewFormula(f.receipt);
  await fs.writeFile(path.join(candidateDirectory, "only-my-pi.rb"), formula);
  f.receipt.homebrew = { filename: "only-my-pi.rb", sha256: sha256(formula) };
  await fs.writeFile(path.join(candidateDirectory, "build-receipt.json"), JSON.stringify(f.receipt));
  const inspect = () => inspectMultiplatformRelease({ ...f, candidateDirectory });
  assert.equal((await inspect()).packageOrder.length, 4);
  const proofs = path.join(candidateDirectory, "proofs");
  await fs.mkdir(proofs);
  let index = 0;
  const write = async (value) => {
    const file = path.join(proofs, `${index++}.json`);
    await fs.writeFile(file, JSON.stringify(value));
    return file;
  };
  const harnessSha256 = sha256(execFileSync("git", ["show", `${f.receipt.sourceCommit}:scripts/verify-native-live.py`]));
  let lastLive;
  for (const platform of RELEASE_PLATFORMS) {
    const common = { sourceCommit: f.receipt.sourceCommit, distributionId: f.receipt.platforms[platform].distributionId,
      buildReceiptSha256: sha256(JSON.stringify(f.receipt)) };
    for (const node of ["22.19.0", "24.19.0"])
      await write({ ...common, status: "LOCAL_INSTALL_ACCEPTANCE_PASS", node, publicRegistryVerified: false, productUpgrade: platform === "darwin-arm64",
        checks: ["global-install", "verify-offline", "version-offline", "doctor-offline", "raw-pi-offline", "npx-fresh-cache", "global-uninstall", "global-reinstall", "reinstall-verify-offline",
          ...(platform === "darwin-arm64" ? ["global-install-previous", "upgrade-version-offline"] : [])].map((label) => ({ label, exitCode: 0 })) });
    await write({ ...common, status: "LOCAL_ARCHIVE_ACCEPTANCE_PASS", fullInstalledOffline: true, thinInstalledFromPinnedNode: true,
      unknownFilesPreserved: true, identities: Array.from({ length: 2 }, () => ({ ...common, installation: { channel: "archive" } })) });
    await write({ ...common, status: "INSTALLED_MIGRATION_ACCEPTANCE_PASS", assertions: { "legacy-migration": true, "path-shadow-detection": true, "unknown-files-preserved": true } });
    lastLive = await write({ ...common, status: "NATIVE_LIVE_ACCEPTANCE_PASS", version: f.receipt.version, harnessSha256,
      model: "cc-switch-kimi-for-coding/kimi-for-coding", platform: { os: platform.split("-")[0], arch: platform.split("-")[1] },
      assertions: Object.fromEntries(MULTIPLATFORM_ASSERTIONS.map((id) => [id, true])) });
    if (platform === "darwin-arm64") await write({ ...common, status: "HOMEBREW_CANDIDATE_LIFECYCLE_PASS",
      buildReceiptSha256: sha256(JSON.stringify(f.receipt)), previousVersion: "0.4.0-preview.1", productUpgrade: true,
      formulaTest: true, uninstall: true, reinstall: true, userDataPreserved: true });
    else await write({ sourceCommit: f.receipt.sourceCommit, status: "LINUX_SANDBOX_PREFLIGHT_PASS", platform: "linux", arch: platform.split("-")[1],
      checks: ["nonRoot", "dependencies", "glibc", "freshProc", "pidNamespace", "networkNamespace", "realNetworkDenied", "privateReadDenied", "outsideWriteDenied", "allowedWrite"] });
  }
  const collect = (output) => execFileSync(process.execPath, ["scripts/collect-multiplatform-evidence.mjs", candidateDirectory, proofs, output], { stdio: "pipe" });
  collect(path.join(candidateDirectory, "evidence.json"));
  const evidence = JSON.parse(await fs.readFile(path.join(candidateDirectory, "evidence.json")));
  assert.equal(evidence.platforms["linux-x64"].assertions.length, 16);
  const stale = JSON.parse(await fs.readFile(lastLive)); stale.status = "NATIVE_LIVE_SUBSET_PASS";
  await fs.writeFile(lastLive, JSON.stringify(stale));
  assert.throws(() => collect(path.join(candidateDirectory, "refused-evidence.json")), /missing accepted NATIVE_LIVE_ACCEPTANCE_PASS/u);
  await assert.rejects(fs.stat(path.join(candidateDirectory, "refused-evidence.json")), { code: "ENOENT" });
  stale.status = "NATIVE_LIVE_ACCEPTANCE_PASS";
  stale.buildReceiptSha256 = sha256("provisional CLI with the same core");
  await fs.writeFile(lastLive, JSON.stringify(stale));
  assert.throws(() => collect(path.join(candidateDirectory, "refused-provisional.json")), /missing accepted NATIVE_LIVE_ACCEPTANCE_PASS/u);
  await fs.appendFile(path.join(candidateDirectory, f.receipt.artifacts[1].filename), "tampered");
  await assert.rejects(inspect(), /npm artifact bytes differ/u);
  await fs.writeFile(path.join(candidateDirectory, f.receipt.artifacts[1].filename), f.receipt.artifacts[1].filename);
  const removed = f.receipt.archives.pop();
  await assert.rejects(inspect(), /six Full\/Thin/u);
  f.receipt.archives.push(removed);
  await fs.appendFile(path.join(candidateDirectory, "only-my-pi.rb"), "# changed\n");
  f.receipt.homebrew.sha256 = sha256(formula + "# changed\n");
  await assert.rejects(inspect(), /Homebrew formula differs/u);
});
