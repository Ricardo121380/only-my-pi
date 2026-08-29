import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  createStackLayout,
  finalizeStackManifest,
  planStackEnvironment,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(t) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-stack-plan-")));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const layout = createStackLayout({ homeDir: home });
  const stack = JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "stack-manifest.example.json"), "utf8"));
  return { home, layout, stack };
}

async function createExternalRoot(layout, stack, { count = 9, extra = null, versionOverride = null } = {}) {
  await fs.mkdir(path.join(layout.npmRoot, "node_modules"), { recursive: true });
  const lock = { name: "pi-packages", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "pi-packages", version: "1.0.0", dependencies: {} } } };
  for (const entry of stack.externalPackages.slice(0, count)) {
    const packageRoot = path.join(layout.npmRoot, "node_modules", ...entry.name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    const version = versionOverride?.name === entry.name ? versionOverride.version : entry.version;
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: entry.name, version, license: "MIT" })}\n`);
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(entry.name)};\n`);
    lock.packages[`node_modules/${entry.name}`] = { version, integrity: entry.integrity, resolved: `https://registry.npmjs.org/${entry.name}/-/${entry.name.split("/").at(-1)}-${version}.tgz` };
    lock.packages[""].dependencies[entry.name] = version;
  }
  if (extra) {
    const packageRoot = path.join(layout.npmRoot, "node_modules", extra);
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: extra, version: "1.0.0", license: "MIT" })}\n`);
    lock.packages[`node_modules/${extra}`] = { version: "1.0.0", integrity: stack.externalPackages[0].integrity, resolved: `https://registry.npmjs.org/${extra}/-/${extra}-1.0.0.tgz` };
    lock.packages[""].dependencies[extra] = "1.0.0";
  }
  await fs.writeFile(path.join(layout.npmRoot, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  if (count === 9 && !extra && !versionOverride) {
    for (const entry of stack.externalPackages) entry.treeDigest = `sha256:${await hashResourcePath({ artifactRoot: layout.npmRoot, relativePath: `node_modules/${entry.name}`, allowContainedSymlinks: true })}`;
    const unsigned = structuredClone(stack); delete unsigned.stackId;
    return finalizeStackManifest(unsigned);
  }
  if (count < 9 && !extra && !versionOverride) {
    for (const entry of stack.externalPackages.slice(0, count)) entry.treeDigest = `sha256:${await hashResourcePath({ artifactRoot: layout.npmRoot, relativePath: `node_modules/${entry.name}`, allowContainedSymlinks: true })}`;
    const unsigned = structuredClone(stack); delete unsigned.stackId;
    return finalizeStackManifest(unsigned);
  }
  return stack;
}

const platform = { os: "darwin", arch: "arm64", minimumMacOSSatisfied: true, rosetta: false };

test("empty environment plans a complete user-owned external tree without touching system roots", async (t) => {
  const { layout, stack } = await fixture(t);
  const plan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "thin", platform, pathValue: "/usr/bin:/bin" });
  assert.equal(plan.external.classification, "EMPTY");
  assert.equal(plan.external.switchRequired, true);
  assert.equal(plan.external.missing.length, 9);
  assert.equal(plan.path.actionRequired, true);
  assert.deepEqual(plan.systemRoots, { homebrewMutation: false, sudo: false });
});

test("exact nine-package environment is borrowed without external tree replacement", async (t) => {
  const { layout, stack: initial } = await fixture(t);
  const stack = await createExternalRoot(layout, initial);
  const plan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "full", platform, pathValue: layout.binRoot });
  assert.equal(plan.external.classification, "EXACT");
  assert.equal(plan.external.switchRequired, false);
  assert.equal(plan.external.existing.length, 9);
  assert.equal(plan.path.actionRequired, false);
});

test("governed partial environment can be completed and preserves exact package identities", async (t) => {
  const { layout, stack: initial } = await fixture(t);
  const stack = await createExternalRoot(layout, initial, { count: 4 });
  const plan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "thin", platform });
  assert.equal(plan.external.classification, "PARTIAL");
  assert.equal(plan.external.existing.length, 4);
  assert.equal(plan.external.missing.length, 5);
  assert.equal(plan.external.switchRequired, true);
});

test("partial roots with unrelated packages and required version conflicts are zero-write failures", async (t) => {
  const first = await fixture(t);
  await createExternalRoot(first.layout, first.stack, { count: 4, extra: "unrelated-package" });
  await assert.rejects(planStackEnvironment({ layout: first.layout, stackManifest: first.stack, payloadMode: "thin", platform }), { code: "PARTIAL_ROOT_UNRELATED_PACKAGE_CONFLICT" });

  const second = await fixture(t);
  await createExternalRoot(second.layout, second.stack, { versionOverride: { name: second.stack.externalPackages[0].name, version: "9.9.9" } });
  await assert.rejects(planStackEnvironment({ layout: second.layout, stackManifest: second.stack, payloadMode: "thin", platform }), { code: "REQUIRED_PACKAGE_CONFLICT" });
});

test("unknown user-local shims and unsupported platforms fail before writes", async (t) => {
  const { layout, stack } = await fixture(t);
  await fs.mkdir(layout.binRoot, { recursive: true });
  await fs.writeFile(layout.ompShim, "unknown\n");
  await assert.rejects(planStackEnvironment({ layout, stackManifest: stack, payloadMode: "thin", platform }), { code: "SHIM_CONFLICT" });

  const clean = await fixture(t);
  for (const unsupported of [
    { os: "linux", arch: "arm64", minimumMacOSSatisfied: false, rosetta: false },
    { os: "darwin", arch: "x64", minimumMacOSSatisfied: true, rosetta: true },
    { os: "darwin", arch: "arm64", minimumMacOSSatisfied: false, rosetta: false },
  ]) await assert.rejects(planStackEnvironment({ layout: clean.layout, stackManifest: clean.stack, payloadMode: "full", platform: unsupported }), { code: "PLATFORM_UNSUPPORTED" });
});

test("symlinked target ancestry is rejected", async (t) => {
  const { home, stack } = await fixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "omp-stack-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, ".local"), { recursive: true });
  await fs.symlink(outside, path.join(home, ".local", "share"));
  const layout = createStackLayout({ homeDir: home });
  await assert.rejects(planStackEnvironment({ layout, stackManifest: stack, payloadMode: "thin", platform }), { code: "STACK_PATH_UNSAFE" });
});
