import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { inspectPack, validatePackEntries } from "../scripts/pack-check.mjs";

const manifest = JSON.parse(fs.readFileSync(new URL("../verification/manifests/pack-content-v1.json", import.meta.url), "utf8"));

test("pack allowlist rejects receipts, fixtures, tests, traversal, and unlisted files", () => {
  for (const file of [
    "verification/receipts/private.json",
    "extensions/example/fixtures/input.json",
    "extensions/example/index.test.mjs",
    "../outside.txt",
    "docs/research/report.md",
  ]) {
    const result = validatePackEntries([...manifest.required, file], manifest);
    assert.equal(result.ok, false, file);
  }
});

test("npm pack content is constrained by the positive allowlist", () => {
  const result = inspectPack();
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.files.includes("package.json"));
  assert.ok(!result.files.some((file) => file.startsWith("verification/")));
  assert.ok(!result.files.some((file) => file.startsWith("codex/")));
});
