import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createBootstrapService } from "../packages/bootstrap/bootstrap-service.mjs";
import { saveSettings } from "../packages/config-runtime/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function isolatedConfigRoot(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "only-my-pi-bootstrap-service-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  return path.join(parent, "agent");
}

test("bootstrap planning is a zero-write repository/config reconciliation", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const service = createBootstrapService({ rootDir });
  const plan = await service.planBootstrap({
    configRoot,
    profile: "coding",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    initialMode: "coding",
    scope: "global",
  });
  assert.equal(plan.operation, "bootstrap");
  assert.equal(plan.status, "PLAN_READY");
  assert.equal(plan.zeroWriteEvidence.writes, 0);
  assert.match(plan.planDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(plan.desired.metadata.providerSelection.status, "CONFIGURED_UNVERIFIED");
  assert.equal(plan.desired.metadata.initialMode.status, "PENDING_M3_RESOLUTION");
  await assert.rejects(fs.lstat(configRoot), { code: "ENOENT" });
});

test("model metadata never implies Provider verification and requires a provider id", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const service = createBootstrapService({ rootDir });
  await assert.rejects(
    service.planBootstrap({ configRoot, profile: "coding", provider: null, model: "deepseek-v4-pro" }),
    (error) => error.code === "PROVIDER_REQUIRED",
  );
  await assert.rejects(
    service.planBootstrap({ configRoot, profile: "coding", provider: "deepseek", model: "secret\nvalue" }),
    (error) => error.code === "INVALID_MODEL_ID",
  );
});

test("update requires an installed profile while uninstall of an empty root is a no-op plan", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const service = createBootstrapService({ rootDir });
  await assert.rejects(service.planUpdate({ configRoot }), (error) => error.code === "NOT_INSTALLED");
  const uninstall = await service.planUninstall({ configRoot });
  assert.equal(uninstall.status, "NO_CHANGES");
  assert.equal(uninstall.mutation, false);
  await assert.rejects(fs.lstat(configRoot), { code: "ENOENT" });
});

test("status and safe guidance remain read-only and do not claim network isolation", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  const service = createBootstrapService({ rootDir });
  assert.equal((await service.status({ configRoot })).status, "NOT_INSTALLED");
  const safe = await service.safe({ configRoot });
  assert.equal(safe.status, "SAFE_START_GUIDANCE");
  assert.ok(safe.command.includes("--no-extensions"));
  assert.match(safe.note, /OS or container network policy/u);
  await assert.rejects(fs.lstat(configRoot), { code: "ENOENT" });
});

test("uninstall planning preserves user settings and removes only recorded ownership", async (t) => {
  const configRoot = await isolatedConfigRoot(t);
  await saveSettings(configRoot, {
    custom: { keep: true },
    packages: ["npm:user-package@1.0.0", "./only-my-pi/generations/old/npm/node_modules/owned"],
    extensions: ["/user/ext.ts"],
    skills: [],
    prompts: [],
    themes: [],
    onlyMyPi: {
      formatVersion: 1,
      profileId: "coding",
      generationId: `sha256:${"a".repeat(64)}`,
      graphDigest: `sha256:${"a".repeat(64)}`,
      providerSelection: null,
      initialMode: null,
      managedSettings: {
        packages: ["./only-my-pi/generations/old/npm/node_modules/owned"],
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      },
    },
  });
  const service = createBootstrapService({ rootDir });
  const plan = await service.planUninstall({ configRoot });
  assert.equal(plan.status, "PLAN_READY");
  assert.equal(plan.current.metadata.profileId, "coding");
  assert.deepEqual(plan.changes, [
    "remove-only-recorded-owned-settings",
    "retain-immutable-generation-for-reviewed-rollback",
  ]);
  assert.deepEqual(plan.desired.resourceDisposition, {
    policy: "RETAIN_IMMUTABLE_FOR_ROLLBACK",
    generationId: `sha256:${"a".repeat(64)}`,
    deletionAttempted: false,
  });
});
