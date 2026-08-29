import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadLicenseRegistry } from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("reviewed license registry binds every fallback identity to pinned source bytes", async () => {
  const result = await loadLicenseRegistry(ROOT);
  assert.equal(result.sources.size, 7);
  assert.equal(Object.keys(result.registry.bindings).length, 18);
  assert.equal(result.registry.bindings["@earendil-works/pi-coding-agent@0.84.3"], "mario-zechner-mit");
  assert.equal(result.registry.bindings["@aws-sdk/nested-clients@3.997.9"], "aws-sdk-js-v3-apache-2.0");
  assert.ok(result.registry.sources.every((entry) => /\/[a-f0-9]{40}\//u.test(entry.sourceUrl)));
});

test("reviewed license registry rejects content drift", async (t) => {
  const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-license-registry-")));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  await fs.mkdir(path.join(temporary, "contracts", "release"), { recursive: true });
  await fs.cp(path.join(ROOT, "contracts", "release", "license-source-registry.json"), path.join(temporary, "contracts", "release", "license-source-registry.json"));
  await fs.cp(path.join(ROOT, "contracts", "release", "licenses"), path.join(temporary, "contracts", "release", "licenses"), { recursive: true });
  await fs.appendFile(path.join(temporary, "contracts", "release", "licenses", "mario-zechner-mit.txt"), "drift\n");
  await assert.rejects(loadLicenseRegistry(temporary), { code: "RELEASE_LICENSE_SOURCE_DRIFT" });
});
