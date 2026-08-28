import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectM10Promotion } from "../packages/upstream-migration/index.mjs";
import { inspectLegacyAuthority } from "../packages/release-authority/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("rewritten M9/M10 evidence is retained only as legacy inspection material", async () => {
  const legacy = inspectLegacyAuthority({ rootDir: ROOT });
  assert.equal(legacy.status, "LEGACY_PASS_NOT_CURRENT_AUTHORITY");
  assert.equal(legacy.currentReleaseAuthority, false);
  const promotion = await inspectM10Promotion({ rootDir: ROOT });
  assert.equal(promotion.state, "PROMOTE");
  assert.equal(promotion.decision.defaultPiVersion, "0.84.3");
  assert.equal(promotion.decision.defaultSubagentsVersion, "0.57.0");
});
