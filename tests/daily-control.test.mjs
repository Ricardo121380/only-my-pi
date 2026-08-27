import assert from "node:assert/strict";
import test from "node:test";

import { createControlService } from "../packages/control-service/service.mjs";

function harness({ confirm = async () => false } = {}) {
  const calls = [];
  const preset = { id: "daily", profileId: "daily", base: "core", overlays: ["web", "orchestration-readonly", "ui-terminal"] };
  const bootstrap = {
    async planBootstrap(options) {
      calls.push({ method: "planBootstrap", options });
      return { ok: true, status: "PLAN_READY", operation: "bootstrap", mutation: false, planDigest: `sha256:${"a".repeat(64)}`, configRoot: options.configRoot, profileId: options.profile };
    },
    async applyBootstrap(options) {
      calls.push({ method: "applyBootstrap", options });
      return { ok: true, status: "COMMITTED", mutation: true, generationId: `sha256:${"b".repeat(64)}` };
    },
  };
  const dailyConfig = {
    async list() { calls.push({ method: "list" }); return { ok: true, status: "PRESET_LIST", presets: [preset], overlays: [] }; },
    async show(id) { calls.push({ method: "show", id }); return id === "daily" ? { ok: true, status: "PRESET_SHOW", item: preset } : { ok: false, status: "CONFIG_ITEM_NOT_FOUND", code: "CONFIG_ITEM_NOT_FOUND" }; },
    async resolve(options) { calls.push({ method: "resolve", options }); return { status: "RESOLVED", profileId: "daily", models: {}, budget: {} }; },
  };
  const service = createControlService({ bootstrap, doctor: {}, dailyConfig, confirm });
  return { service, calls, preset };
}

test("profiles list/show/plan are read-only and apply reuses the reviewed bootstrap plan", async () => {
  const { service, calls } = harness({ confirm: async () => true });
  assert.equal((await service.dispatch({ command: "profiles", options: { subcommand: "list" } })).status, "PRESET_LIST");
  assert.equal((await service.dispatch({ command: "profiles", options: { subcommand: "show", presetId: "daily" } })).status, "PRESET_SHOW");
  const plan = await service.dispatch({ command: "profiles", options: { subcommand: "plan", presetId: "daily", configRoot: "/tmp/pi" } });
  assert.equal(plan.status, "PROFILE_APPLY_PLAN");
  assert.equal(plan.profileId, "daily");
  assert.equal(plan.restartRequired, true);
  const applied = await service.dispatch({ command: "profiles", options: { subcommand: "apply", presetId: "daily", configRoot: "/tmp/pi", yes: false } });
  assert.equal(applied.status, "COMMITTED");
  assert.equal(applied.restartRequired, true);
  assert.deepEqual(calls.filter((entry) => entry.method === "applyBootstrap").map((entry) => entry.options.plan.status), ["PLAN_READY"]);
});

test("profiles apply fails closed without approval and an overlay cannot masquerade as a preset", async () => {
  const { service } = harness();
  const blocked = await service.dispatch({ command: "profiles", options: { subcommand: "apply", presetId: "daily", configRoot: "/tmp/pi", yes: false } });
  assert.equal(blocked.status, "CONFIRMATION_REQUIRED");
  const invalid = await service.dispatch({ command: "profiles", options: { subcommand: "apply", presetId: "missing", configRoot: "/tmp/pi", yes: true } });
  assert.equal(invalid.code, "CONFIG_ITEM_NOT_FOUND");
});

test("standalone models validate is structural and never claims Pi auth verification", async () => {
  const { service, calls } = harness();
  const result = await service.dispatch({ command: "models", options: { subcommand: "validate", projectRoot: "/tmp/project" } });
  assert.equal(result.ok, true);
  assert.equal(result.status, "MODEL_CONFIGURATION_VALID_STATIC");
  assert.equal(result.runtimeAuthValidation, "UNAVAILABLE_OUTSIDE_PI_SESSION");
  assert.equal(result.projectTrust, "EXPLICIT_PATH_VALIDATION_ONLY");
  assert.deepEqual(calls.find((entry) => entry.method === "resolve").options, { projectRoot: "/tmp/project", projectTrusted: true });
});
