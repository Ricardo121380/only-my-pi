import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildLegacyAuthorityRegistry,
  inspectLegacyAuthority,
  LEGACY_SNAPSHOT_COMMIT,
  validateLegacyAuthorityRegistry,
} from "../packages/release-authority/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legacy registry retires every snapshot evidence file without changing bytes", () => {
  const result = inspectLegacyAuthority({ rootDir: ROOT });
  assert.equal(result.status, "LEGACY_PASS_NOT_CURRENT_AUTHORITY");
  assert.equal(result.currentReleaseAuthority, false);
  assert.equal(result.entryCount, 38);
  assert.equal(result.internalDigestPassed, 21);
  assert.equal(result.internalDigestNotApplicable, 17);
});

test("legacy registry is deterministic for the sanitized snapshot", () => {
  const generated = buildLegacyAuthorityRegistry({ rootDir: ROOT });
  const stored = JSON.parse(fs.readFileSync(path.join(ROOT, "verification", "legacy-authority-v1.json"), "utf8"));
  assert.deepEqual(generated, stored);
  assert.equal(stored.legacySnapshotCommit, LEGACY_SNAPSHOT_COMMIT);
  assert.equal(stored.entries.every((entry) => entry.currentReleaseAuthority === false), true);
  assert.equal(stored.entries.every((entry) => entry.gitAuthority.directChildStatus === "UNAVAILABLE_AFTER_REWRITE"), true);
});

test("legacy registry rejects file and authority drift", () => {
  const stored = JSON.parse(fs.readFileSync(path.join(ROOT, "verification", "legacy-authority-v1.json"), "utf8"));
  const authority = structuredClone(stored);
  authority.currentReleaseAuthority = true;
  assert.throws(() => validateLegacyAuthorityRegistry(authority, { rootDir: ROOT }), { code: "LEGACY_REGISTRY_IDENTITY_INVALID" });
  const bytes = structuredClone(stored);
  bytes.entries[0].fileSha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateLegacyAuthorityRegistry(bytes, { rootDir: ROOT }), { code: "LEGACY_REGISTRY_IDENTITY_INVALID" });
});
