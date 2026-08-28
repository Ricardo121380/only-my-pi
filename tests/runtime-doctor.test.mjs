import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  loadExpectedRuntimeSnapshot,
  reconcileRuntimeMetadata,
  validateRuntimeMetadata,
} from "../scripts/lib/runtime-doctor.mjs";

const expected = loadExpectedRuntimeSnapshot({ profileId: "coding" });
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function safeMetadata() {
  return {
    formatVersion: 1,
    piVersion: "0.84.3",
    loadedResourceIds: [...expected.resourceIds],
    registeredCommandIds: [...expected.commandIds],
    capabilitySnapshots: expected.capabilitySnapshots.map((entry) => ({ ...entry, state: "ACTIVE" })),
    enforcementSurfaces: expected.enforcementSurfaces.map((entry) => ({ ...entry, state: "ACTIVE", reasonCode: "POLICY_ACTIVE" })),
    packageOwnerIds: [...expected.ownerIds],
  };
}

test("live doctor without an injected metadata seam is explicitly unavailable", () => {
  assert.deepEqual(reconcileRuntimeMetadata(undefined), {
    ok: false,
    status: "UNAVAILABLE",
    findings: [{ code: "LIVE_METADATA_UNAVAILABLE", severity: "warning" }],
  });
});

test("public live-doctor CLI rejects arbitrary metadata injection", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/runtime-doctor.mjs", "--live", "--metadata", "verification/fixtures/mcp.safe.json"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown or incomplete argument: --metadata/);
  assert.equal(result.stdout, "");
});

test("live metadata rejects secret-shaped and unknown fields", () => {
  const withSecret = { ...safeMetadata(), apiToken: "must-not-be-read" };
  const result = validateRuntimeMetadata(withSecret);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("unknown metadata field")));
  assert.ok(result.errors.some((message) => message.includes("sensitive metadata field")));
});

test("repository expectation fixes Pi version and all governed runtime sets", () => {
  assert.equal(expected.piVersion, "0.84.3");
  assert.equal(expected.enforcementSurfaces.length, 7);
  assert.ok(expected.resourceIds.includes("context-doctor"));
  assert.ok(expected.resourceIds.includes("permission-modes"));
  assert.ok(expected.commandIds.includes("omp-context"));
  assert.ok(expected.capabilitySnapshots.some((entry) => entry.id === "workspace-read"));
});

test("valid-looking empty metadata cannot pass without the repository expectation", () => {
  const empty = {
    formatVersion: 1,
    piVersion: "99.0.0",
    loadedResourceIds: [],
    registeredCommandIds: [],
    capabilitySnapshots: [],
    enforcementSurfaces: [],
    packageOwnerIds: [],
  };
  const withoutExpected = reconcileRuntimeMetadata(empty);
  assert.equal(withoutExpected.ok, false);
  assert.equal(withoutExpected.status, "INVALID_EXPECTATION");

  const withExpected = reconcileRuntimeMetadata(empty, expected);
  assert.equal(withExpected.ok, false);
  assert.equal(withExpected.status, "FAIL");
  assert.ok(withExpected.findings.some((finding) => finding.code === "PI_VERSION_MISMATCH"));
  assert.ok(withExpected.findings.some((finding) => finding.code === "MISSING_ENFORCEMENT_SURFACE"));
});

test("degraded Bash sandbox never becomes a whole-runtime PASS", () => {
  const metadata = safeMetadata();
  const bash = metadata.enforcementSurfaces.find((surface) => surface.id === "bashSandbox");
  bash.state = "DEGRADED";
  bash.reasonCode = "SANDBOX_NOT_READY";
  const result = reconcileRuntimeMetadata(metadata, expected);
  assert.equal(result.ok, true);
  assert.equal(result.status, "DEGRADED");
  assert.deepEqual(result.findings.find((finding) => finding.id === "bashSandbox"), {
    code: "ENFORCEMENT_NOT_ACTIVE",
    severity: "warning",
    id: "bashSandbox",
    state: "DEGRADED",
    reasonCode: "SANDBOX_NOT_READY",
  });
});

test("missing expected live capability ownership fails closed", () => {
  const metadata = safeMetadata();
  metadata.packageOwnerIds = metadata.packageOwnerIds.filter((id) => id !== "permission");
  const result = reconcileRuntimeMetadata(metadata, expected);
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.code === "MISSING_LIVE_OWNERS"));
});

test("capability hash and enforcement owner drift fail closed", () => {
  const metadata = safeMetadata();
  metadata.capabilitySnapshots[0].hash = `sha256:${"f".repeat(64)}`;
  metadata.enforcementSurfaces[0].owner = "pi-host-runtime";
  const result = reconcileRuntimeMetadata(metadata, expected);
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.ok(result.findings.some((finding) => finding.code === "CAPABILITY_HASH_MISMATCH"));
  assert.ok(result.findings.some((finding) => finding.code === "ENFORCEMENT_OWNER_MISMATCH"));
});
