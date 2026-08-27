import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDoctorService } from "../packages/bootstrap/doctor-service.mjs";
import { inspectPack, validatePackEntries } from "../scripts/pack-check.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../verification/manifests/pack-content-v1.json", import.meta.url), "utf8"));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pack allowlist rejects receipts, fixtures, tests, traversal, and unlisted files", () => {
  for (const file of [
    "verification/receipts/private.json",
    "extensions/example/fixtures/input.json",
    "extensions/example/index.test.mjs",
    "../outside.txt",
    "docs/research/report.md",
    "node_modules/unlisted-package/index.js",
    "node_modules/ajv/node_modules/unlisted-package/index.js",
  ]) {
    const result = validatePackEntries([...manifest.required, file], manifest);
    assert.equal(result.ok, false, file);
  }
});

test("pack allowlist accepts only the exact bundled runtime dependency roots", () => {
  const result = validatePackEntries([...manifest.required, "node_modules/ajv/dist/ajv.js", "node_modules/minipass/dist/commonjs/index.js"], manifest);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("npm pack content is constrained by the positive allowlist", () => {
  const result = inspectPack();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.files.includes("package.json"));
  assert.ok(!result.files.some((file) => file.startsWith("verification/")));
  assert.ok(!result.files.some((file) => file.startsWith("codex/")));
  assert.ok(result.files.some((file) => file.startsWith("node_modules/ajv/")));
  assert.ok(!result.files.some((file) => file.startsWith("node_modules/@earendil-works/")));
});

test("the packaged static doctor accepts excluded source evidence but requires every packaged resource", async (t) => {
  const packed = inspectPack();
  assert.equal(packed.ok, true);
  const artifactRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-packed-doctor-"));
  t.after(() => fsp.rm(artifactRoot, { recursive: true, force: true }));

  for (const relativePath of packed.files) {
    const source = path.join(root, relativePath);
    const target = path.join(artifactRoot, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
  }

  const passing = createDoctorService({ rootDir: artifactRoot }).static({ profileId: "minimal" });
  assert.equal(passing.ok, true, JSON.stringify(passing.findings));
  assert.equal(passing.scope, "packaged-static-declarations-only");
  assert.equal(await fsp.stat(path.join(artifactRoot, "package-lock.json")).then(() => true, () => false), false);
  assert.equal(await fsp.stat(path.join(artifactRoot, "tests")).then(() => true, () => false), false);

  await fsp.rm(path.join(artifactRoot, "extensions", "context-doctor", "metrics.mjs"));
  const missingRuntime = createDoctorService({ rootDir: artifactRoot }).static({ profileId: "minimal" });
  assert.equal(missingRuntime.ok, false);
  assert.ok(missingRuntime.findings.some((finding) => (
    finding.code === "invalid-resource-path" && finding.resourceId === "context-doctor-runtime"
  )));
});
