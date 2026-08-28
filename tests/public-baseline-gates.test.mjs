import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectPublicBaseline, runPublicBaselineGates, validatePublicBaselineGateManifest } from "../scripts/public-baseline-gates.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("public baseline gate manifest keeps protected execution evidence-only", async () => {
  const inspected = await inspectPublicBaseline({ rootDir: ROOT });
  assert.equal(inspected.manifest.gates.length, 5);
  assert.equal(inspected.manifest.gates[3].command, null);
  assert.equal(inspected.manifest.gates[4].execution, "authority-receipt");
  assert.throws(() => validatePublicBaselineGateManifest({}), { code: "PUBLIC_BASELINE_GATE_MANIFEST_INVALID" });
});

test("pending source gates pass deterministic checks without claiming protected authority", async () => {
  const report = await runPublicBaselineGates({ rootDir: ROOT });
  if (report.state === "PUBLIC_BASELINE_PENDING") {
    assert.equal(report.status, "PUBLIC_BASELINE_PENDING");
    assert.equal(report.results.slice(0, 3).every((entry) => entry.passed), true);
    assert.equal(report.results[3].status, "NOT_RUN_BY_POLICY");
    assert.equal(report.results[4].status, "PUBLIC_BASELINE_PENDING");
  } else {
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.passed, true);
  }
});
