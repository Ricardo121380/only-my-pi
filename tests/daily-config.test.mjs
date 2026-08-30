import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BUDGET,
  defaultPreferences,
  loadDailyCatalog,
  normalizePreferences,
  resetGlobalPreferences,
  readLastInteractiveModel,
  resolveDailyConfiguration,
  saveLastInteractiveModel,
  saveGlobalPreferences,
  validateResolvedModels,
} from "../packages/daily-config/index.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function roots(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-daily-config-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const configRoot = path.join(parent, "agent");
  const projectRoot = path.join(parent, "project");
  await fs.mkdir(path.join(projectRoot, ".pi"), { recursive: true });
  return { parent, configRoot, projectRoot };
}

async function writeProject(projectRoot, value) {
  await fs.writeFile(path.join(projectRoot, ".pi", "only-my-pi.json"), `${JSON.stringify(value, null, 2)}\n`);
}

test("catalog defines Core plus the exact daily hard and soft overlays", async () => {
  const catalog = await loadDailyCatalog({ rootDir });
  assert.equal(catalog.overlays.core.kind, "base");
  assert.equal(catalog.overlays.web.kind, "hard");
  assert.equal(catalog.overlays["orchestration-readonly"].kind, "hard");
  assert.equal(catalog.overlays["ui-terminal"].kind, "soft");
  assert.equal(catalog.overlays.writer.available, true);
  assert.equal(catalog.overlays.writer.kind, "soft");
  assert.deepEqual(catalog.overlays.writer.authority.tools, ["edit", "write", "bash"]);
  assert.deepEqual(catalog.presets.daily.overlays, ["orchestration-readonly", "ui-terminal", "web", "writer"]);
  assert.equal(catalog.presets.daily.profileId, "daily");
});

test("default daily configuration is conservative and source-labelled", async (t) => {
  const { configRoot } = await roots(t);
  const resolved = await resolveDailyConfiguration({ rootDir, configRoot });
  assert.equal(resolved.preset.id, "daily");
  assert.deepEqual(resolved.hardOverlays, ["orchestration-readonly", "web"]);
  assert.deepEqual(resolved.softOverlays, ["ui-terminal", "writer"]);
  assert.deepEqual(resolved.budget, DEFAULT_BUDGET);
  assert.equal(resolved.models.roles.reviewer.model, "inherit");
  assert.equal(resolved.source.global, "defaults");
  assert.equal(resolved.source.generation, "not-installed-or-legacy");
  assert.equal(resolved.profileId, "daily");
});

test("installed generation profile is the hard-overlay ceiling even when preferences request more", async (t) => {
  const { configRoot } = await roots(t);
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, "settings.json"), `${JSON.stringify({ onlyMyPi: { profileId: "coding" } })}\n`);
  await saveGlobalPreferences({ configRoot, preferences: { formatVersion: 1, defaultPreset: "daily" } });
  const resolved = await resolveDailyConfiguration({ rootDir, configRoot });
  assert.equal(resolved.preset.id, "core");
  assert.deepEqual(resolved.hardOverlays, []);
  assert.equal(resolved.source.generation, "installed:coding");
});

test("trusted project and per-run layers can only narrow global overlays and budgets", async (t) => {
  const { configRoot, projectRoot } = await roots(t);
  await saveGlobalPreferences({
    configRoot,
    preferences: {
      formatVersion: 1,
      defaultPreset: "daily",
      models: {
        default: { model: "opencode-go/deepseek-v4-flash", thinking: "medium", fallbackModels: [] },
        roles: { reviewer: { thinking: "high" } },
      },
      budgets: { daily: { maxChildren: 6, maxConcurrency: 2, maxTotalTokens: 40_000 } },
    },
  });
  await writeProject(projectRoot, {
    formatVersion: 1,
    disabledOverlays: ["web"],
    models: { default: { thinking: "low" }, roles: { reviewer: { model: "opencode-go/reviewer" } } },
    budgets: { daily: { maxChildren: 4, maxConcurrency: 1, maxTotalTokens: 20_000 } },
  });
  const resolved = await resolveDailyConfiguration({
    rootDir,
    configRoot,
    projectRoot,
    projectTrusted: true,
    perRun: { budgets: { daily: { maxChildren: 3, maxTotalTokens: 10_000 } } },
  });
  assert.equal(resolved.overlays.some((entry) => entry.id === "web"), false);
  assert.equal(resolved.source.project, "TRUSTED_PROJECT_CONFIG_APPLIED");
  assert.equal(resolved.budget.maxChildren, 3);
  assert.equal(resolved.budget.maxConcurrency, 1);
  assert.equal(resolved.budget.maxTotalTokens, 10_000);
  assert.equal(resolved.models.default.model, "opencode-go/deepseek-v4-flash");
  assert.equal(resolved.models.default.thinking, "low");
  assert.equal(resolved.models.roles.reviewer.model, "opencode-go/reviewer");
  assert.equal(resolved.models.roles.reviewer.thinking, "high");
});

test("untrusted project configuration is ignored without parsing its contents", async (t) => {
  const { configRoot, projectRoot } = await roots(t);
  await fs.writeFile(path.join(projectRoot, ".pi", "only-my-pi.json"), "not json and must not be parsed\n");
  const resolved = await resolveDailyConfiguration({ rootDir, configRoot, projectRoot, projectTrusted: false });
  assert.equal(resolved.source.project, "IGNORED_UNTRUSTED_PROJECT_CONFIG");
  assert.ok(resolved.hardOverlays.includes("web"));
});

test("project overlay widening, project pricing, and secret-shaped fields fail closed", () => {
  assert.throws(
    () => normalizePreferences({ formatVersion: 1, enabledOverlays: ["web"] }, { scope: "project" }),
    { code: "PROJECT_OVERLAY_WIDENING" },
  );
  assert.throws(
    () => normalizePreferences({ formatVersion: 1, pricingOverrides: { "p/m": { inputPerMillion: 1, outputPerMillion: 2 } } }, { scope: "project" }),
    { code: "PROJECT_PRICE_OVERRIDE_FORBIDDEN" },
  );
  assert.throws(
    () => normalizePreferences({ formatVersion: 1, apiKey: "forbidden" }),
    { code: "PREFERENCES_SECRET_FIELD" },
  );
});

test("model validation resolves ordered candidates, auth and explicit pricing", async (t) => {
  const { configRoot } = await roots(t);
  const preferences = defaultPreferences();
  await saveGlobalPreferences({
    configRoot,
    preferences: {
      ...preferences,
      models: {
        default: { model: "provider/missing", thinking: "medium", fallbackModels: ["provider/ready"] },
        roles: {},
      },
      pricingOverrides: { "provider/ready": { inputPerMillion: 0.1, outputPerMillion: 0.2 } },
    },
  });
  const configuration = await resolveDailyConfiguration({ rootDir, configRoot });
  const registry = {
    async find(provider, id) { return id === "ready" ? { provider, id } : null; },
    async hasConfiguredAuth(model) { return model.id === "ready"; },
  };
  const result = await validateResolvedModels(configuration, { modelRegistry: registry });
  assert.equal(result.ok, true);
  assert.ok(result.roles.every((entry) => entry.selected === "provider/ready"));
  assert.equal((await validateResolvedModels(configuration)).code, "MODEL_REGISTRY_UNAVAILABLE");
});

test("implicit Pi 0/0 pricing is unknown until an explicit override names the billing policy", async (t) => {
  const { configRoot } = await roots(t);
  const preferences = defaultPreferences();
  const configuration = await resolveDailyConfiguration({ rootDir, configRoot });
  const registry = {
    async find() { return null; },
    async hasConfiguredAuth() { return true; },
  };
  const currentModel = { provider: "subscription", id: "model", cost: { input: 0, output: 0 } };
  const blocked = await validateResolvedModels(configuration, { modelRegistry: registry, currentModel });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.roles.every((entry) => entry.status === "PRICING_UNAVAILABLE"));

  const explicit = {
    ...preferences,
    pricingOverrides: { "subscription/model": { inputPerMillion: 0, outputPerMillion: 0 } },
  };
  await saveGlobalPreferences({ configRoot, preferences: explicit });
  const allowed = await validateResolvedModels(await resolveDailyConfiguration({ rootDir, configRoot }), { modelRegistry: registry, currentModel });
  assert.equal(allowed.ok, true);
});

test("global preferences are mode-protected, atomically replaceable and explicitly reset", async (t) => {
  const { configRoot } = await roots(t);
  const saved = await saveGlobalPreferences({ configRoot, preferences: defaultPreferences() });
  assert.equal(saved.status, "PREFERENCES_SAVED");
  const target = path.join(configRoot, "only-my-pi", "preferences.json");
  assert.equal((await fs.stat(path.dirname(target))).mode & 0o777, 0o700);
  assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
  assert.equal((await resetGlobalPreferences({ configRoot })).status, "PREFERENCES_RESET");
  assert.equal((await resetGlobalPreferences({ configRoot })).status, "NO_CHANGES");
});

test("last interactive model is a bounded global preference without authentication data", async (t) => {
  const { configRoot } = await roots(t);
  assert.equal(await readLastInteractiveModel({ configRoot }), null);
  const saved = await saveLastInteractiveModel({
    configRoot,
    model: "opencode-go/deepseek-v4-flash",
    selectedAt: "2026-08-30T06:00:00.000Z",
  });
  assert.equal(saved.status, "LAST_INTERACTIVE_MODEL_SAVED");
  assert.deepEqual(await readLastInteractiveModel({ configRoot }), {
    model: "opencode-go/deepseek-v4-flash",
    selectedAt: "2026-08-30T06:00:00.000Z",
  });
  assert.throws(
    () => normalizePreferences({ formatVersion: 1, ui: { lastModel: saved.lastModel } }, { scope: "project" }),
    { code: "NON_GLOBAL_UI_PREFERENCE_FORBIDDEN" },
  );
  assert.throws(
    () => normalizePreferences({ formatVersion: 1, ui: { lastModel: { model: "inherit", selectedAt: "2026-08-30T06:00:00.000Z" } } }),
    { code: "MODEL_CONFIGURATION_INVALID" },
  );
});
