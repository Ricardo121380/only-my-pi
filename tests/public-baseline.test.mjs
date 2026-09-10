import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildGenerationPlan } from "../packages/bootstrap/index.mjs";
import { inspectLegacyAuthority } from "../packages/release-authority/legacy-authority.mjs";
import { validatePublicBaselineRecord } from "../packages/release-authority/public-baseline.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public baseline record binds retired history and its historical Stable graph", async () => {
  const record = validatePublicBaselineRecord(JSON.parse(await fs.readFile(path.join(ROOT, "contracts/release/public-baseline.json"), "utf8")));
  const receipt = JSON.parse(await fs.readFile(path.join(ROOT, "verification/receipts/public-baseline-v1-completion.json"), "utf8"));
  const legacy = inspectLegacyAuthority({ rootDir: ROOT });
  const graph = await buildGenerationPlan({ rootDir: ROOT, profileId: "daily" });
  assert.equal(["PUBLIC_BASELINE_PENDING", "PUBLIC_BASELINE_VERIFIED"].includes(record.state), true);
  assert.equal(record.legacyAuthority.registryDigest, legacy.registryDigest);
  assert.equal(record.stable.graphDigest, receipt.stableGraphDigest);
  assert.notEqual(record.stable.graphDigest, graph.graphDigest, "M12 guarded coding must not rewrite the retired M11 read-only graph identity");
  assert.equal(record.legacyAuthority.currentReleaseAuthority, false);
  if (record.state === "PUBLIC_BASELINE_PENDING") {
    assert.equal(record.sourceCommit, null);
    assert.equal(record.evidenceCommit, null);
  } else {
    assert.match(record.sourceCommit, /^[a-f0-9]{40}$/u);
    assert.match(record.evidenceCommit, /^[a-f0-9]{40}$/u);
  }
});

test("pending public baseline cannot claim a protected source or evidence", async () => {
  const fixture = JSON.parse(await fs.readFile(path.join(ROOT, "verification/fixtures/contracts/public-baseline/negative-pending-claims-evidence.json"), "utf8"));
  assert.throws(() => validatePublicBaselineRecord(fixture), { code: "PUBLIC_BASELINE_PENDING_INVALID" });
});
