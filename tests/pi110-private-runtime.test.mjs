import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPi } from "../packages/release-stack/release-payload-stager.mjs";
import { piRuntimeContract, isPrivateStack } from "../packages/release-stack/contracts.mjs";
import { loadPi110Inputs, verifyPi110AcquiredTrees } from "../packages/release-stack/pi110-materials.mjs";
import { applyRuntimePatches } from "../packages/distribution/runtime-patches.mjs";

test("Pi 1.1.0 is an explicit private input while historical runtime identities remain", () => {
  assert.deepEqual(piRuntimeContract("1.1.0"), {
    version: "1.1.0",
    integrity: "sha512-SeEi/4hdcHNgA9UWlefZl7ZZpm3dzi2OoxNjDHsBJ9o298LNOtbL4DGKgitlEj6uCTccvtw6f2hlCkTPVJ2RXg==",
  });
  assert.equal(isPrivateStack({ runtime: { pi: { version: "1.1.0" } } }), true);
  assert.equal(piRuntimeContract().version, "0.84.3");
  assert.equal(piRuntimeContract("0.85.1").version, "0.85.1");
  assert.throws(() => piRuntimeContract("1.1.1"), { code: "STACK_PI_IDENTITY_INVALID" });
});

test("missing or byte-drifted frozen inputs reject before download", async t => {
  const rootDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-input-")));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let downloads = 0;
  const attempt = () => installPi({ rootDir, work: rootDir, resolved: rootDir, piVersion: "1.1.0", download: async () => { downloads++; } });
  await assert.rejects(attempt, { code: "PI110_INPUT_MISSING" });
  const contract = path.join(rootDir, "contracts/release/pi110");
  await fs.mkdir(contract, { recursive: true });
  await fs.writeFile(path.join(contract, "inputs.json"), "{}\n");
  await assert.rejects(attempt, { code: "PI110_INPUT_DRIFT" });
  assert.equal(downloads, 0);
  assert.equal((await loadPi110Inputs(fileURLToPath(new URL("../", import.meta.url)))).inputs.purpose, "GP110-04_PI_INPUT");
});

test("acquisition verifies bytes and only npm's declared bin execute-bit normalization", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-acquire-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resolved = path.join(root, "resolved");
  const pi = path.join(resolved, "pi");
  const external = path.join(resolved, "external-npm");
  const rawPi = path.join(root, "raw-pi");
  const rawBin = path.join(root, "raw-bin");
  const installed = path.join(pi, "node_modules/fixture-bin");
  for (const dir of [pi, external, rawPi, rawBin, installed]) await fs.mkdir(dir, { recursive: true });
  const piManifest = JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.1.0" });
  for (const dir of [pi, rawPi]) await fs.writeFile(path.join(dir, "package.json"), piManifest);
  for (const dir of [installed, rawBin]) {
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "fixture-bin", version: "1.0.0", bin: { fixture: "cli.js" } }));
    await fs.writeFile(path.join(dir, "cli.js"), "#!/usr/bin/env node\n", { mode: 0o644 });
  }
  await fs.chmod(path.join(installed, "cli.js"), 0o755);
  await fs.writeFile(path.join(pi, "npm-shrinkwrap.json"), JSON.stringify({ packages: { "": {}, "node_modules/fixture-bin": { version: "1.0.0" } } }));
  await fs.writeFile(path.join(pi, "omp-runtime-inputs.json"), "{}\n");
  await fs.writeFile(path.join(external, "package-lock.json"), JSON.stringify({ packages: { "": {} } }));
  const options = { resolved, artifactTreeRoots: new Map([["@earendil-works/pi-coding-agent@1.1.0", rawPi], ["fixture-bin@1.0.0", rawBin]]) };
  assert.deepEqual(await verifyPi110AcquiredTrees(options), { packages: 2 });
  await fs.appendFile(path.join(installed, "cli.js"), "// drift\n");
  await assert.rejects(() => verifyPi110AcquiredTrees(options), { code: "PI110_ACQUISITION_DRIFT" });
  await fs.writeFile(path.join(installed, "cli.js"), "#!/usr/bin/env node\n");
  await fs.chmod(path.join(installed, "cli.js"), 0o744);
  await assert.rejects(() => verifyPi110AcquiredTrees(options), { code: "PI110_ACQUISITION_DRIFT" });
});

test("Pi 1.1.0 patches reject actual Pi, platform and target package version mismatches", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-patch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "pi"));
  const options = { runtimeRoot: root, version: "0.3.0-preview.1", platform: "darwin-arm64", runtimeContract: "pi110-v1" };
  const writePi = version => fs.writeFile(path.join(root, "pi/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }));
  await writePi("0.85.1");
  await assert.rejects(() => applyRuntimePatches(options), /purpose, version or platform differs/u);
  await writePi("1.1.0");
  await assert.rejects(() => applyRuntimePatches({ ...options, platform: "linux-arm64" }), /purpose, version or platform differs/u);
  await fs.mkdir(path.join(root, "external-npm/node_modules/pi-web-access"), { recursive: true });
  await fs.writeFile(path.join(root, "external-npm/node_modules/pi-web-access/package.json"), JSON.stringify({ name: "pi-web-access", version: "0.26.0" }));
  await assert.rejects(() => applyRuntimePatches(options), /package version differs/u);
});

test("official Pi without shrinkwrap consumes the frozen OMP lock and restores upstream metadata", async t => {
  const rootDir = fileURLToPath(new URL("../", import.meta.url));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-stage-"));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  const resolved = path.join(work, "resolved");
  await fs.mkdir(resolved);
  const upstream = await fs.readFile(path.join(rootDir, "contracts/release/pi110/upstream-package.json"));
  let installs = 0;
  const result = await installPi({ rootDir, work, resolved, piVersion: "1.1.0", node: "/fixture/node", npm: "/fixture/npm", env: {},
    download: async () => ({ sha256: "sha256:09cd8a0a43dbb1d81a67346b09400b439ce71d818caba4e963ea958846a1aed4" }),
    extract: async ({ destination }) => {
      await fs.mkdir(path.join(destination, "package"), { recursive: true });
      await fs.writeFile(path.join(destination, "package/package.json"), upstream);
    },
    run: async (_, argv, { cwd }) => {
      installs++;
      assert.ok(argv.includes("--ignore-scripts"));
      const lock = JSON.parse(await fs.readFile(path.join(cwd, "npm-shrinkwrap.json")));
      assert.equal(lock.packages["node_modules/@earendil-works/pi-codemode"].version, "1.1.0");
      assert.equal(lock.packages["node_modules/quickjs-wasi"].version, "3.6.2");
    },
  });
  assert.equal(installs, 1);
  assert.deepEqual(await fs.readFile(path.join(result.pi, "package.json")), upstream);
});
