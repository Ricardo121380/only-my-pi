import test from "node:test";
import assert from "node:assert/strict";
import { validatePlatformSet } from "../packages/distribution/cli-assembler.mjs";
const receipts = ["darwin-arm64", "linux-arm64", "linux-x64"].map((platform) => ({ platform,
  status: "PLATFORM_CANDIDATE_NOT_PUBLISHABLE", version: "0.4.0-preview.2", sourceCommit: "a".repeat(40), distributionId: `sha256:${"b".repeat(64)}` }));
test("multi-platform CLI requires macOS alongside both Linux architectures", () => {
  assert.equal(validatePlatformSet(receipts).version, "0.4.0-preview.2");
  assert.throws(() => validatePlatformSet(receipts.slice(1)), /exactly macOS/);
  assert.throws(() => validatePlatformSet([receipts[1], receipts[1], receipts[2]]), /exactly macOS/);
});
test("mixed source, stale versions and unverified status cannot enter the CLI", () => {
  for (const change of [{ sourceCommit: "c".repeat(40) }, { version: "0.4.0-preview.1" }, { status: "PASS" }])
    assert.throws(() => validatePlatformSet([{ ...receipts[0], ...change }, ...receipts.slice(1)]), /same exact source/);
});
