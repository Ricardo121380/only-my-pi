import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBootstrapService } from "../packages/bootstrap/bootstrap-service.mjs";
import { buildGenerationPlan, compileOwnedSettings, stageGeneration } from "../packages/bootstrap/index.mjs";
import { compilePublishedSettings, MANAGED_SETTING_FIELDS } from "../packages/bootstrap/settings-merge.mjs";
import {
  createOwnedSettingsSnapshot,
  hashFile,
  loadSettings,
  relativeConfigPath,
  saveSettings,
  writeLastKnownGood,
} from "../packages/config-runtime/index.mjs";

async function fixture(t, { alternativeTargetResolver } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-historical-doctor-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const rootDir = path.join(parent, "artifact");
  const configRoot = path.join(parent, "agent");
  await fs.mkdir(path.join(rootDir, "inventory"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "profiles"), { recursive: true });
  await fs.mkdir(path.join(rootDir, "prompts"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "prompts", "fixture.md"), "historical\n", "utf8");
  await fs.writeFile(path.join(rootDir, "inventory", "packages.lock.json"), `${JSON.stringify({
    formatVersion: 1,
    runtime: { pi: "0.84.1", node: ">=22.19.0", platform: "darwin-arm64" },
    packages: [],
    candidates: [],
  })}\n`);
  await fs.writeFile(path.join(rootDir, "inventory", "resources.lock.json"), `${JSON.stringify({
    formatVersion: 1,
    resources: [{
      id: "fixture-prompt",
      type: "prompt",
      path: "prompts/fixture.md",
      version: "1.0.0",
      owners: ["only-my-pi"],
      defaultLoaded: true,
      profileEligibility: ["minimal"],
      lifecycle: "stable",
      packaged: true,
    }],
  })}\n`);
  await fs.writeFile(path.join(rootDir, "profiles", "minimal.json"), `${JSON.stringify({
    formatVersion: 1,
    id: "minimal",
    packageIds: [],
  })}\n`);

  const plan = await buildGenerationPlan({ rootDir, profileId: "minimal" });
  const generation = await stageGeneration(plan, {
    configRoot,
    transactionId: "historical-doctor",
    artifactRoot: rootDir,
    runner: async () => assert.fail("package-free fixture must not invoke npm"),
  });
  const compiled = await compileOwnedSettings(plan, generation, { configRoot, transactionId: "historical-settings" });
  const metadata = {
    profileId: "minimal",
    generationId: plan.graphDigest,
    graphDigest: plan.graphDigest,
    providerSelection: null,
    initialMode: null,
    packageBindings: [],
  };
  const saved = await saveSettings(configRoot, compilePublishedSettings({}, compiled.ownedSettings, metadata));
  const snapshot = await createOwnedSettingsSnapshot(configRoot, {
    id: "historical-doctor-lkg",
    ownedPaths: ["/onlyMyPi", ...MANAGED_SETTING_FIELDS.map((field) => `/${field}`)],
  });
  const manifestPath = path.join(generation.layout.generationRoot, generation.layout.manifestName);
  await writeLastKnownGood(configRoot, {
    generationId: plan.graphDigest,
    generationManifestRelativePath: relativeConfigPath(configRoot, manifestPath),
    generationManifestDigest: await hashFile(configRoot, manifestPath),
    settingsDigest: saved.digest,
    snapshotId: snapshot.snapshotId,
    transactionId: null,
    metadata: { providerSelection: null, initialMode: null },
  });
  const service = createBootstrapService({
    rootDir,
    profileService: { resolve() {}, list() { return []; } },
    doctorService: { static() { return { ok: true, errors: 0, warnings: 0 }; } },
    alternativeTargetResolver,
  });
  return { rootDir, configRoot, generation, service };
}

test("doctor verifies a historical generation before reporting target alignment", async (t) => {
  const { rootDir, configRoot, generation, service } = await fixture(t);
  await fs.writeFile(path.join(rootDir, "prompts", "fixture.md"), "current target\n", "utf8");
  const result = await service.doctor({ configRoot });
  assert.equal(result.ok, true);
  assert.equal(result.status, "PASS_WITH_UPDATE_AVAILABLE");
  assert.deepEqual(result.generation, {
    status: "VERIFIED",
    verificationBasis: "installed-generation-manifest",
    installedGenerationId: generation.manifest.graphDigest,
    targetGenerationId: result.generation.targetGenerationId,
    alignment: "UPDATE_AVAILABLE",
    errorCode: null,
  });
  assert.match(result.generation.targetGenerationId, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(result.generation.targetGenerationId, result.generation.installedGenerationId);
});

test("doctor accepts an exact governed alternative target without hiding other drift", async (t) => {
  let installedGenerationId;
  const { rootDir, configRoot, generation, service } = await fixture(t, {
    alternativeTargetResolver: async () => ({ graphDigest: installedGenerationId }),
  });
  installedGenerationId = generation.manifest.graphDigest;
  await fs.writeFile(path.join(rootDir, "prompts", "fixture.md"), "new stable target\n", "utf8");
  const result = await service.doctor({ configRoot });
  assert.equal(result.status, "PASS");
  assert.equal(result.generation.alignment, "MATCH");
  assert.equal(result.generation.targetGenerationId, installedGenerationId);

  assert.throws(() => createBootstrapService({ rootDir, alternativeTargetResolver: true }), TypeError);
});

test("doctor fails when an installed historical resource drifts", async (t) => {
  const { configRoot, generation, service } = await fixture(t);
  const staged = generation.manifest.resources[0];
  await fs.writeFile(path.join(generation.layout.generationRoot, ...staged.stagedPath.split("/")), "tampered\n", "utf8");
  const result = await service.doctor({ configRoot });
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.equal(result.generation.status, "UNAVAILABLE_OR_DRIFTED");
  assert.equal(result.generation.errorCode, "STAGED_RESOURCE_DRIFT");
});

test("doctor reports a missing generation referenced by settings", async (t) => {
  const { configRoot, service } = await fixture(t);
  const current = await loadSettings(configRoot);
  const missing = `sha256:${"f".repeat(64)}`;
  current.settings.onlyMyPi.generationId = missing;
  current.settings.onlyMyPi.graphDigest = missing;
  await saveSettings(configRoot, current.settings);
  const result = await service.doctor({ configRoot });
  assert.equal(result.ok, false);
  assert.equal(result.generation.errorCode, "GENERATION_NOT_PROMOTED");
});

test("doctor accepts unowned Pi settings changes after the last-known-good state", async (t) => {
  const { configRoot, service } = await fixture(t);
  const current = await loadSettings(configRoot);
  current.settings.userPreference = "concurrent-change";
  await saveSettings(configRoot, current.settings);
  const result = await service.doctor({ configRoot });
  assert.equal(result.ok, true);
  assert.equal(result.generation.status, "VERIFIED");
});

test("doctor rejects owned settings that no longer match the last-known-good state", async (t) => {
  const { configRoot, service } = await fixture(t);
  const current = await loadSettings(configRoot);
  current.settings.onlyMyPi.profileId = "coding";
  await saveSettings(configRoot, current.settings);
  const result = await service.doctor({ configRoot });
  assert.equal(result.ok, false);
  assert.equal(result.generation.errorCode, "CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD");
});
