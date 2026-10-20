import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { installPi } from "../packages/release-stack/release-payload-stager.mjs";
import { applyRuntimePatches } from "../packages/distribution/runtime-patches.mjs";
import { piRuntimeContract, isPrivateStack, PRIVATE_RUNTIME_CONTRACTS } from "../packages/release-stack/contracts.mjs";

test("Pi 1.3.0 has an explicit private contract without replacing historical identities", () => {
  assert.equal(piRuntimeContract("1.3.0").version, "1.3.0");
  assert.equal(PRIVATE_RUNTIME_CONTRACTS["1.3.0"], "pi130-v1");
  assert.equal(isPrivateStack({ runtime: { pi: { version: "1.3.0" } } }), true);
  assert.equal(piRuntimeContract().version, "0.84.3");
  assert.equal(piRuntimeContract("0.85.1").version, "0.85.1");
  assert.equal(piRuntimeContract("1.1.0").version, "1.1.0");
  assert.throws(() => piRuntimeContract("1.3.1"), { code: "STACK_PI_IDENTITY_INVALID" });
});

test("Pi 1.3.0 staging rejects missing and drifted inputs before any download", async t => {
  const rootDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi130-input-")));
  t.after(() => fs.rm(rootDir, { recursive: true, force: true }));
  let downloads = 0;
  const attempt = () => installPi({ rootDir, work: rootDir, resolved: rootDir, piVersion: "1.3.0",
    download: async () => { downloads++; throw new Error("must not download invalid inputs"); } });
  await assert.rejects(attempt, { code: "PI130_INPUT_MISSING" });
  const contract = path.join(rootDir, "contracts/release/pi130");
  await fs.mkdir(contract, { recursive: true });
  await fs.writeFile(path.join(contract, "inputs.json"), "{}\n");
  await assert.rejects(attempt, { code: "PI130_INPUT_DRIFT" });
  assert.equal(downloads, 0);
});

test("Pi 1.3.0 patches require the actual Pi version, platform and extension version", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi130-patch-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "pi"));
  const options = { runtimeRoot: root, version: "0.3.0-preview.1", platform: "darwin-arm64", runtimeContract: "pi130-v1" };
  const writePi = version => fs.writeFile(path.join(root, "pi/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version }));
  await writePi("1.1.0");
  await assert.rejects(() => applyRuntimePatches(options), /purpose, version or platform differs/u);
  await writePi("1.3.0");
  await assert.rejects(() => applyRuntimePatches({ ...options, platform: "linux-arm64" }), /purpose, version or platform differs/u);
  await fs.mkdir(path.join(root, "external-npm/node_modules/pi-web-access"), { recursive: true });
  await fs.writeFile(path.join(root, "external-npm/node_modules/pi-web-access/package.json"), JSON.stringify({ name: "pi-web-access", version: "0.26.0" }));
  await assert.rejects(() => applyRuntimePatches(options), /package version differs/u);
});
