import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  atomicWriteJson,
  createOwnedSettingsSnapshot,
  hashFile,
  relativeConfigPath,
  saveSettings,
  settingsDigest,
  writeLastKnownGood,
} from "../packages/config-runtime/index.mjs";
import { createExternalMigrationPlanner, M10_EXACT_PACKAGE_TARGET } from "../packages/upstream-migration/index.mjs";

const sha = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const resolved = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;
const lifecycleCommands = new Map([
  ["pi-memory", "node scripts/postinstall.cjs"],
  ["pi-permission-modes", "echo 'permission-mode: dependencies installed.'"],
]);

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-migration-plan-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "config");
  const npmRoot = path.join(configRoot, "npm");
  const piParent = path.join(root, "pi-packages");
  const piPackageRoot = path.join(piParent, "pi-coding-agent");
  const piBinPath = path.join(root, "bin", "pi");
  await fs.mkdir(path.join(npmRoot, "node_modules"), { recursive: true });
  await fs.mkdir(path.join(piPackageRoot, "dist"), { recursive: true });
  await fs.mkdir(path.dirname(piBinPath), { recursive: true });
  await fs.writeFile(path.join(piPackageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.1" }));
  await fs.writeFile(path.join(piPackageRoot, "dist", "cli.js"), "#!/usr/bin/env node\n");
  await fs.symlink(path.join(piPackageRoot, "dist", "cli.js"), piBinPath);

  const settings = { packages: [], onlyMyPi: { generationId: `sha256:${"1".repeat(64)}`, packageBindings: [] } };
  const lock = { name: "pi-extensions", lockfileVersion: 3, packages: { "": { name: "pi-extensions", dependencies: {} } } };
  const packages = [];
  for (const entry of M10_EXACT_PACKAGE_TARGET) {
    const relative = `node_modules/${entry.name}`;
    const packageRoot = path.join(npmRoot, ...relative.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    const command = lifecycleCommands.get(entry.name);
    const scripts = command ? { postinstall: command } : {};
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: entry.name, version: entry.fromVersion, scripts }));
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(entry.id)};\n`);
    const url = resolved(entry.name, entry.fromVersion);
    lock.packages[relative] = { version: entry.fromVersion, integrity: entry.fromIntegrity, resolved: url };
    lock.packages[""].dependencies[entry.name] = entry.fromVersion;
    settings.packages.push(`npm:${entry.name}@${entry.fromVersion}`);
    packages.push({
      ...entry,
      sourceSpec: `npm:${entry.name}@${entry.toVersion}`,
      fromResolvedUrlDigest: sha(url),
      toResolvedUrlDigest: sha(`target:${entry.name}`),
      fromTreeDigest: `sha256:${await hashResourcePath({ artifactRoot: npmRoot, relativePath: relative, allowContainedSymlinks: true })}`,
      toTreeDigest: sha(`target-tree:${entry.name}`),
      binding: "external",
      owner: "user",
    });
  }
  await fs.writeFile(path.join(npmRoot, "package.json"), JSON.stringify({ name: "pi-extensions", private: true }));
  await fs.writeFile(path.join(npmRoot, "package-lock.json"), JSON.stringify(lock));
  settings.onlyMyPi.packageBindings = packages
    .filter((entry) => !["git-sync", "memory"].includes(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      binding: "external",
      sourceSpec: `npm:${entry.name}@${entry.fromVersion}`,
      resolvedVersion: entry.fromVersion,
      integrity: entry.fromIntegrity,
      resolvedUrlDigest: entry.fromResolvedUrlDigest,
      physicalRootDigest: entry.fromTreeDigest,
      owner: "user",
      resourceFilter: [],
    }));
  const generationId = settings.onlyMyPi.generationId;
  const settingsState = await saveSettings(configRoot, settings);
  const snapshot = await createOwnedSettingsSnapshot(configRoot, { id: "migration-planner-lkg", ownedPaths: ["/onlyMyPi", "/packages"] });
  const generationManifest = path.join(configRoot, "only-my-pi", "generations", "fixture", "manifest.json");
  await atomicWriteJson(configRoot, generationManifest, { formatVersion: 1, graphDigest: generationId });
  await writeLastKnownGood(configRoot, {
    generationId,
    generationManifestRelativePath: relativeConfigPath(configRoot, generationManifest),
    generationManifestDigest: await hashFile(configRoot, generationManifest),
    settingsDigest: settingsState.digest,
    snapshotId: snapshot.snapshotId,
    transactionId: null,
    metadata: { providerSelection: null, initialMode: null },
  });
  const installationInspector = async () => ({
    settingsState,
    metadata: settings.onlyMyPi,
    lkg: { state: { generationId } },
    generation: { ok: true, generation: { status: "VERIFIED" } },
  });
  const planner = createExternalMigrationPlanner({ configRoot, piPackageRoot, piBinPath, installationInspector });
  const defaultPlanner = createExternalMigrationPlanner({
    configRoot,
    piPackageRoot,
    piBinPath,
    bootstrap: { doctor: async () => ({ ok: true, generation: { status: "VERIFIED" } }) },
  });
  const manifest = { from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" }, externalPackages: packages };
  return { planner, defaultPlanner, manifest, npmRoot, configRoot, piPackageRoot, piBinPath, settings };
}

test("external migration planner binds Pi, all nine packages, LKG and privacy evidence", async (t) => {
  const value = await fixture(t);
  const result = await value.planner.inspect({ manifest: value.manifest });
  assert.equal(result.status, "MIGRATION_PREFLIGHT_VERIFIED");
  assert.equal(result.pi.version, "0.84.1");
  assert.equal(result.external.packages.length, 9);
  assert.equal(result.ownership.dailyExternalBindings, 7);
  assert.equal(result.ownership.completeExternalPackages, 9);
  assert.deepEqual(result.privacy, { authRead: false, sessionsRead: false, providerConfigRead: false });
});

test("external migration planner fails closed on a package tree changed after bundle binding", async (t) => {
  const value = await fixture(t);
  await fs.writeFile(path.join(value.npmRoot, "node_modules", "pi-web-access", "drift.txt"), "drift\n");
  await assert.rejects(value.planner.inspect({ manifest: value.manifest }), { code: "MIGRATION_PACKAGE_TREE_DRIFT" });
});

test("external migration planner verifies the recorded installation without a checkout target", async (t) => {
  const value = await fixture(t);
  const result = await value.defaultPlanner.inspect({ manifest: value.manifest });
  assert.equal(result.status, "MIGRATION_PREFLIGHT_VERIFIED");
  assert.equal(result.generation.status, "VERIFIED");
  assert.equal(result.generation.generationId, result.generation.lkgGenerationId);
  assert.equal(result.external.packages.length, 9);
});

test("external migration planner rejects incomplete installation authority", async (t) => {
  const value = await fixture(t);
  await assert.rejects(value.planner.inspect(), TypeError);
  const incomplete = createExternalMigrationPlanner({
    configRoot: value.configRoot,
    piPackageRoot: value.piPackageRoot,
    piBinPath: value.piBinPath,
    installationInspector: async () => ({}),
  });
  await assert.rejects(incomplete.inspect({ manifest: value.manifest }), { code: "MIGRATION_INSTALLATION_INVALID" });

  const badOwnership = structuredClone(value.settings);
  badOwnership.onlyMyPi.packageBindings[0].owner = "only-my-pi";
  await saveSettings(value.configRoot, badOwnership);
  await assert.rejects(value.defaultPlanner.inspect({ manifest: value.manifest }), { code: "MIGRATION_EXTERNAL_OWNERSHIP_DRIFT" });
});

test("external migration planner rejects Pi identity, path and package metadata drift", async (t) => {
  const cases = [
    {
      name: "Pi version",
      code: "MIGRATION_PI_IDENTITY_DRIFT",
      mutate: async (value) => fs.writeFile(path.join(value.piPackageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.0" })),
    },
    {
      name: "Pi binary escape",
      code: "MIGRATION_PI_BINARY_ESCAPE",
      mutate: async (value) => {
        await fs.rm(value.piBinPath);
        await fs.symlink(path.join(value.configRoot, "settings.json"), value.piBinPath);
      },
    },
    {
      name: "settings package type",
      code: "MIGRATION_SETTINGS_PACKAGE_DRIFT",
      mutate: async (value) => { value.settings.packages = {}; },
    },
    {
      name: "lock version",
      code: "MIGRATION_LOCK_DRIFT",
      mutate: async (value) => {
        const lockPath = path.join(value.npmRoot, "package-lock.json");
        const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
        lock.lockfileVersion = 2;
        await fs.writeFile(lockPath, JSON.stringify(lock));
      },
    },
    {
      name: "settings source",
      code: "MIGRATION_SETTINGS_PACKAGE_DRIFT",
      mutate: async (value) => { value.settings.packages[0] = "npm:pi-agent-extensions@9.9.9"; },
    },
    {
      name: "lock identity",
      code: "MIGRATION_LOCK_DRIFT",
      mutate: async (value) => {
        const lockPath = path.join(value.npmRoot, "package-lock.json");
        const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
        lock.packages["node_modules/pi-agent-extensions"].version = "9.9.9";
        await fs.writeFile(lockPath, JSON.stringify(lock));
      },
    },
    {
      name: "resolved URL",
      code: "MIGRATION_LOCK_DRIFT",
      mutate: async (value) => {
        const lockPath = path.join(value.npmRoot, "package-lock.json");
        const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
        lock.packages["node_modules/pi-agent-extensions"].resolved = "http://127.0.0.1/package.tgz";
        await fs.writeFile(lockPath, JSON.stringify(lock));
      },
    },
    {
      name: "package identity",
      code: "MIGRATION_PACKAGE_IDENTITY_DRIFT",
      mutate: async (value) => fs.writeFile(path.join(value.npmRoot, "node_modules", "pi-agent-extensions", "package.json"), JSON.stringify({ name: "pi-agent-extensions", version: "9.9.9" })),
    },
    {
      name: "lifecycle command type",
      code: "MIGRATION_PACKAGE_LIFECYCLE_DRIFT",
      mutate: async (value) => fs.writeFile(path.join(value.npmRoot, "node_modules", "pi-permission-modes", "package.json"), JSON.stringify({ name: "pi-permission-modes", version: "2.2.0", scripts: { postinstall: 42 } })),
    },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const value = await fixture(subtest);
      await scenario.mutate(value);
      const settingsState = { exists: true, settings: value.settings, digest: settingsDigest(value.settings) };
      value.planner.installationInspector = async () => ({
        settingsState,
        metadata: value.settings.onlyMyPi,
        lkg: { state: { generationId: value.settings.onlyMyPi.generationId } },
        generation: { ok: true, generation: { status: "VERIFIED" } },
      });
      await assert.rejects(value.planner.inspect({ manifest: value.manifest }), { code: scenario.code });
    });
  }
});
