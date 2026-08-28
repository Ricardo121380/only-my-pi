import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../scripts/m10-build-migration-bundle.mjs";

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
