import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import { settingsDigest } from "../packages/config-runtime/index.mjs";
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

  const settings = { packages: [], onlyMyPi: { generationId: `sha256:${"1".repeat(64)}` } };
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
  const generationId = settings.onlyMyPi.generationId;
  const settingsState = { exists: true, settings, digest: settingsDigest(settings) };
  const installationInspector = async () => ({
    settingsState,
    metadata: settings.onlyMyPi,
    lkg: { state: { generationId } },
    generation: { ok: true, generation: { status: "VERIFIED" } },
  });
  const planner = createExternalMigrationPlanner({ configRoot, piPackageRoot, piBinPath, installationInspector });
  const manifest = { from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" }, externalPackages: packages };
  return { planner, manifest, npmRoot };
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
