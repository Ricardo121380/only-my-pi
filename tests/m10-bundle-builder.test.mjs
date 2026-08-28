import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main, validateM10PiRuntimeLayout } from "../scripts/m10-build-migration-bundle.mjs";

const piDependencies = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-client",
  "@earendil-works/pi-protocol",
  "@earendil-works/pi-tui",
];

test("M10 bundle builder defaults to a zero-write reviewable plan", async () => {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (value) => { writes.push(String(value)); return true; };
  try {
    const result = await main(["--json"]);
    assert.equal(result.status, "M10_MIGRATION_BUNDLE_PLAN");
    assert.equal(result.mutation, false);
    assert.equal(result.writes, 0);
    assert.equal(result.networkDuringApply, false);
    assert.equal(result.target.packages.length, 9);
  } finally {
    process.stdout.write = original;
  }
  assert.equal(writes.length, 1);
});

test("M10 bundle builder requires explicit build authority, absolute output and source SHA", async () => {
  await assert.rejects(main(["--build", "--output", "/tmp/bundle.json", "--source-commit", "a".repeat(40)]), { code: "M10_BUILD_CONFIRMATION_REQUIRED" });
  await assert.rejects(main(["--build", "--yes", "--output", "relative.json", "--source-commit", "a".repeat(40)]), { code: "M10_BUILD_CONFIRMATION_REQUIRED" });
});

test("M10 Pi candidate runtime requires a complete exact dependency lock and physical tree", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m10-pi-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const dependencies = Object.fromEntries(piDependencies.map((name) => [name, "^0.84.3"]));
  const lock = {
    name: "@earendil-works/pi-coding-agent",
    version: "0.84.3",
    lockfileVersion: 3,
    packages: { "": { name: "@earendil-works/pi-coding-agent", version: "0.84.3", dependencies } },
  };
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3", dependencies }));
  for (const name of piDependencies) {
    const packageRoot = path.join(root, "node_modules", ...name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name, version: "0.84.3" }));
    lock.packages[`node_modules/${name}`] = {
      version: "0.84.3",
      integrity: `sha512-${Buffer.from(name).toString("base64")}`,
      resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-0.84.3.tgz`,
    };
  }
  await fs.writeFile(path.join(root, "package-lock.json"), JSON.stringify(lock));
  const verified = await validateM10PiRuntimeLayout(root);
  assert.equal(verified.directDependencyCount, 5);
  assert.match(verified.lockDigest, /^sha256:[a-f0-9]{64}$/u);
  await fs.rm(path.join(root, "node_modules", ...piDependencies[0].split("/")), { recursive: true });
  await assert.rejects(validateM10PiRuntimeLayout(root), { code: "M10_BUILD_PI_RUNTIME_DEPENDENCY_DRIFT" });
});
