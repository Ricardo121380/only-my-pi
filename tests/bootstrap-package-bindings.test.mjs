import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bindExistingPackages } from "../packages/bootstrap/package-bindings.mjs";
import { compilePublishedSettings, compileUninstalledSettings } from "../packages/bootstrap/settings-merge.mjs";

const integrity = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
const spec = "npm:fixture-package@1.2.3";

function basePlan() {
  return {
    formatVersion: 1,
    kind: "only-my-pi-owned-generation",
    profileId: "orchestration",
    runtime: { pi: "0.84.1", node: "25.8.0", platform: "darwin-arm64" },
    packages: [{
      id: "fixture-package",
      spec,
      source: { type: "npm", name: "fixture-package", version: "1.2.3" },
      integrity,
      resourceFilter: ["extensions/b.ts", "extensions/a.ts"],
      lifecycle: { execution: "disabled", scripts: [] },
      owners: ["fixture"],
    }],
    resources: [],
  };
}

async function fixture(t) {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-package-bindings-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const packageRoot = path.join(configRoot, "npm", "node_modules", "fixture-package");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "fixture-package",
    version: "1.2.3",
    scripts: { test: "node test.mjs" },
  })}\n`);
  await fs.writeFile(path.join(packageRoot, "index.mjs"), "export const fixture = true;\n");
  await fs.writeFile(path.join(configRoot, "npm", "package-lock.json"), `${JSON.stringify({
    name: "pi-extensions",
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { "fixture-package": "^1.2.3" } },
      "node_modules/fixture-package": {
        version: "1.2.3",
        resolved: "https://registry.npmjs.org/fixture-package/-/fixture-package-1.2.3.tgz",
        integrity,
      },
    },
  })}\n`);
  const externalSetting = {
    source: spec,
    extensions: ["extensions/a.ts", "extensions/b.ts"],
    skills: [],
    prompts: [],
    themes: [],
  };
  return { configRoot, packageRoot, externalSetting };
}

test("exact pre-existing package is borrowed and uninstall preserves it", async (t) => {
  const { configRoot, externalSetting } = await fixture(t);
  const rebound = await bindExistingPackages({
    configRoot,
    settings: { packages: [externalSetting] },
    plan: basePlan(),
  });
  assert.deepEqual(rebound.packages, []);
  assert.equal(rebound.packageBindings.length, 1);
  assert.equal(rebound.packageBindings[0].binding, "external");
  assert.equal(rebound.packageBindings[0].owner, "user");
  assert.match(rebound.packageBindings[0].physicalRootDigest, /^sha256:[a-f0-9]{64}$/u);

  const generation = {
    packages: ["./only-my-pi/generations/x/resources/bundles/only-my-pi-agent-bundle"],
    extensions: [],
    skills: [],
    prompts: [],
    themes: [],
  };
  const metadata = {
    profileId: "orchestration",
    generationId: rebound.graphDigest,
    graphDigest: rebound.graphDigest,
    providerSelection: null,
    initialMode: null,
    packageBindings: rebound.packageBindings,
  };
  const installed = compilePublishedSettings({ packages: [externalSetting] }, generation, metadata);
  assert.equal(installed.onlyMyPi.formatVersion, 2);
  assert.deepEqual(installed.onlyMyPi.managedSettings.packages, generation.packages);
  assert.deepEqual(installed.packages, [externalSetting, ...generation.packages]);
  const uninstalled = compileUninstalledSettings(installed);
  assert.deepEqual(uninstalled.packages, [externalSetting]);
});

test("lock, physical tree, prior binding, and selected-version drift fail closed", async (t) => {
  const { configRoot, packageRoot, externalSetting } = await fixture(t);
  const first = await bindExistingPackages({ configRoot, settings: { packages: [externalSetting] }, plan: basePlan() });
  await fs.writeFile(path.join(packageRoot, "drift.txt"), "drift\n");
  await assert.rejects(
    bindExistingPackages({ configRoot, settings: { packages: [externalSetting] }, plan: basePlan(), priorBindings: first.packageBindings }),
    (error) => error.code === "EXTERNAL_PACKAGE_BINDING_DRIFT",
  );
  await assert.rejects(
    bindExistingPackages({ configRoot, settings: { packages: ["npm:fixture-package@9.9.9"] }, plan: basePlan() }),
    (error) => error.code === "EXTERNAL_PACKAGE_VERSION_CONFLICT",
  );
  const lockPath = path.join(configRoot, "npm", "package-lock.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  lock.packages["node_modules/fixture-package"].integrity = "sha512-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB==";
  await fs.writeFile(lockPath, `${JSON.stringify(lock)}\n`);
  await assert.rejects(
    bindExistingPackages({ configRoot, settings: { packages: [externalSetting] }, plan: basePlan() }),
    (error) => error.code === "EXTERNAL_PACKAGE_LOCK_DRIFT",
  );
});

test("package absent from settings remains managed without reading a Pi npm tree", async (t) => {
  const configRoot = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "omp-package-managed-")), "agent");
  t.after(() => fs.rm(path.dirname(configRoot), { recursive: true, force: true }));
  const rebound = await bindExistingPackages({ configRoot, settings: {}, plan: basePlan() });
  assert.equal(rebound.packages.length, 1);
  assert.equal(rebound.packageBindings[0].binding, "managed");
  assert.equal(rebound.packageBindings[0].owner, "only-my-pi");
});
