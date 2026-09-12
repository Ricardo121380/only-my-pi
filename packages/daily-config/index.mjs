import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadIntrinsicDistribution } from "../distribution/intrinsic.mjs";

const ID = /^[a-z][a-z0-9-]{0,63}$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/u;
const THINKING = new Set(["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const SECRET_KEY = /(?:^|[-_])(api[-_]?key|auth|cookie|credential|password|secret|token)(?:$|[-_])/iu;
const ROLE_IDS = Object.freeze([
  "scout",
  "explorer",
  "researcher",
  "source-verifier",
  "tester",
  "planner",
  "reviewer",
  "security-reviewer",
  "synthesizer",
  "verifier",
  "goal-planner",
]);
const ROLE_SET = new Set(ROLE_IDS);
const BUDGET_BOUNDS = Object.freeze({
  maxConcurrency: [1, 16, true],
  maxChildren: [1, 64, true],
  maxDepth: [0, 4, true],
  maxWallSeconds: [1, 86_400, true],
  maxTotalTokens: [1, Number.MAX_SAFE_INTEGER, true],
  maxCostUsd: [Number.MIN_VALUE, Number.MAX_VALUE, false],
  maxTurnsPerChild: [1, 128, true],
  maxToolCallsPerChild: [1, 512, true],
  maxTotalToolCalls: [1, 4_096, true],
  maxOutputBytesPerChild: [1_024, 2_097_152, true],
  maxTotalOutputBytes: [1_024, 16_777_216, true],
  maxGoalRevisions: [1, 16, true],
});
const DEFAULT_BUDGET = Object.freeze({
  maxConcurrency: 2,
  maxChildren: 8,
  maxDepth: 1,
  maxWallSeconds: 1_800,
  maxTotalTokens: 50_000,
  maxCostUsd: 0.25,
  maxTurnsPerChild: 8,
  maxToolCallsPerChild: 16,
  maxTotalToolCalls: 64,
  maxOutputBytesPerChild: 65_536,
  maxTotalOutputBytes: 262_144,
  maxGoalRevisions: 4,
});
const DEFAULT_MODEL = Object.freeze({ model: "inherit", thinking: "inherit", fallbackModels: Object.freeze([]) });
const PREFERENCES_SCHEMA = "../../schemas/preferences-v1.schema.json";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) immutable(child);
  return value;
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("PREFERENCES_INVALID", `${label} must be an object`);
  return value;
}

function exactKeys(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail("PREFERENCES_INVALID", `${label} contains unknown fields`, { unknown });
}

function assertNoSecretFields(value, location = "preferences") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretFields(entry, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) fail("PREFERENCES_SECRET_FIELD", `${location}.${key} is a forbidden secret-bearing field`);
    assertNoSecretFields(child, `${location}.${key}`);
  }
}

function normalizeIdSet(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) fail("PREFERENCES_INVALID", `${label} must be a bounded array`);
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !ID.test(entry)) fail("PREFERENCES_INVALID", `${label} contains an invalid id`);
    return entry;
  });
  if (new Set(result).size !== result.length) fail("PREFERENCES_INVALID", `${label} must be unique`);
  return result.sort();
}

function normalizeModelId(value, label, { allowInherit = true } = {}) {
  if (value === undefined) return undefined;
  if (allowInherit && value === "inherit") return value;
  if (typeof value !== "string" || !MODEL_ID.test(value)) fail("MODEL_CONFIGURATION_INVALID", `${label} must be inherit or provider/model`);
  return value;
}

function normalizeModelSelection(value, label) {
  if (value === undefined) return {};
  exactKeys(value, new Set(["model", "thinking", "fallbackModels"]), label);
  const model = normalizeModelId(value.model, `${label}.model`);
  const thinking = value.thinking;
  if (thinking !== undefined && !THINKING.has(thinking)) fail("MODEL_CONFIGURATION_INVALID", `${label}.thinking is invalid`);
  let fallbackModels = [];
  if (value.fallbackModels !== undefined) {
    if (!Array.isArray(value.fallbackModels) || value.fallbackModels.length > 4) fail("MODEL_CONFIGURATION_INVALID", `${label}.fallbackModels exceeds four entries`);
    fallbackModels = value.fallbackModels.map((entry, index) => normalizeModelId(entry, `${label}.fallbackModels[${index}]`, { allowInherit: false }));
    if (new Set(fallbackModels).size !== fallbackModels.length) fail("MODEL_CONFIGURATION_INVALID", `${label}.fallbackModels must be unique`);
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(value.fallbackModels === undefined ? {} : { fallbackModels }),
  };
}

function normalizeModels(value, label = "models") {
  if (value === undefined) return {};
  exactKeys(value, new Set(["default", "roles"]), label);
  const roles = {};
  if (value.roles !== undefined) {
    object(value.roles, `${label}.roles`);
    for (const [role, selection] of Object.entries(value.roles)) {
      if (!ROLE_SET.has(role)) fail("MODEL_CONFIGURATION_INVALID", `${label}.roles contains unknown role ${role}`);
      roles[role] = normalizeModelSelection(selection, `${label}.roles.${role}`);
    }
  }
  return {
    ...(value.default === undefined ? {} : { default: normalizeModelSelection(value.default, `${label}.default`) }),
    ...(value.roles === undefined ? {} : { roles }),
  };
}

function normalizeBudget(value, label) {
  object(value, label);
  exactKeys(value, new Set(Object.keys(BUDGET_BOUNDS)), label);
  if (Object.keys(value).length === 0) fail("BUDGET_CONFIGURATION_INVALID", `${label} must contain at least one limit`);
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const [minimum, maximum, integer] = BUDGET_BOUNDS[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < minimum || raw > maximum || (integer && !Number.isSafeInteger(raw))) {
      fail("BUDGET_CONFIGURATION_INVALID", `${label}.${key} is outside its supported bound`);
    }
    result[key] = raw;
  }
  return result;
}

function normalizeBudgets(value, label = "budgets") {
  if (value === undefined) return {};
  object(value, label);
  const result = {};
  for (const [id, budget] of Object.entries(value)) {
    if (!ID.test(id)) fail("BUDGET_CONFIGURATION_INVALID", `${label} contains invalid preset id ${id}`);
    result[id] = normalizeBudget(budget, `${label}.${id}`);
  }
  return result;
}

function normalizePricing(value, { scope }) {
  if (value === undefined) return {};
  if (scope !== "global") fail("PROJECT_PRICE_OVERRIDE_FORBIDDEN", "project and per-run configuration cannot define pricingOverrides");
  object(value, "pricingOverrides");
  const output = {};
  for (const [modelId, prices] of Object.entries(value)) {
    normalizeModelId(modelId, "pricingOverrides model", { allowInherit: false });
    exactKeys(prices, new Set(["inputPerMillion", "outputPerMillion"]), `pricingOverrides.${modelId}`);
    for (const key of ["inputPerMillion", "outputPerMillion"]) {
      if (typeof prices[key] !== "number" || !Number.isFinite(prices[key]) || prices[key] < 0) fail("MODEL_PRICE_INVALID", `pricingOverrides.${modelId}.${key} must be non-negative`);
    }
    output[modelId] = { inputPerMillion: prices.inputPerMillion, outputPerMillion: prices.outputPerMillion };
  }
  return output;
}

function normalizeUiPreferences(value, { scope }) {
  if (value === undefined) return {};
  if (scope !== "global") fail("NON_GLOBAL_UI_PREFERENCE_FORBIDDEN", "project and per-run configuration cannot define UI preferences");
  exactKeys(value, new Set(["lastModel"]), "ui");
  if (value.lastModel === undefined) return {};
  exactKeys(value.lastModel, new Set(["model", "selectedAt"]), "ui.lastModel");
  const model = normalizeModelId(value.lastModel.model, "ui.lastModel.model", { allowInherit: false });
  if (typeof value.lastModel.selectedAt !== "string"
    || !Number.isFinite(Date.parse(value.lastModel.selectedAt))
    || new Date(value.lastModel.selectedAt).toISOString() !== value.lastModel.selectedAt) {
    fail("PREFERENCES_INVALID", "ui.lastModel.selectedAt must be a canonical ISO timestamp");
  }
  return { lastModel: { model, selectedAt: value.lastModel.selectedAt } };
}

export function normalizePreferences(input, { scope = "global" } = {}) {
  object(input, `${scope} preferences`);
  assertNoSecretFields(input, `${scope} preferences`);
  exactKeys(input, new Set(["$schema", "formatVersion", "defaultPreset", "enabledOverlays", "disabledOverlays", "models", "pricingOverrides", "budgets", "ui"]), `${scope} preferences`);
  if (input.formatVersion !== 1) fail("PREFERENCES_VERSION_UNSUPPORTED", `${scope} preferences formatVersion must be 1`);
  if (input.$schema !== undefined && (typeof input.$schema !== "string" || !input.$schema.endsWith("preferences-v1.schema.json"))) fail("PREFERENCES_INVALID", `${scope} preferences schema is invalid`);
  if (input.defaultPreset !== undefined && (typeof input.defaultPreset !== "string" || !ID.test(input.defaultPreset))) fail("PREFERENCES_INVALID", `${scope} defaultPreset is invalid`);
  const enabledOverlays = normalizeIdSet(input.enabledOverlays, `${scope}.enabledOverlays`);
  const disabledOverlays = normalizeIdSet(input.disabledOverlays, `${scope}.disabledOverlays`);
  if (enabledOverlays.some((id) => disabledOverlays.includes(id))) fail("OVERLAY_CONFIGURATION_CONFLICT", `${scope} enables and disables the same overlay`);
  if (scope === "project" && enabledOverlays.length > 0) fail("PROJECT_OVERLAY_WIDENING", "project configuration may disable overlays but may not enable them");
  return immutable({
    $schema: input.$schema ?? PREFERENCES_SCHEMA,
    formatVersion: 1,
    ...(input.defaultPreset === undefined ? {} : { defaultPreset: input.defaultPreset }),
    enabledOverlays,
    disabledOverlays,
    models: normalizeModels(input.models, `${scope}.models`),
    pricingOverrides: normalizePricing(input.pricingOverrides, { scope }),
    budgets: normalizeBudgets(input.budgets, `${scope}.budgets`),
    ui: normalizeUiPreferences(input.ui, { scope }),
  });
}

export function defaultPreferences() {
  return normalizePreferences({
    $schema: PREFERENCES_SCHEMA,
    formatVersion: 1,
    defaultPreset: "daily",
    enabledOverlays: [],
    disabledOverlays: [],
    models: { default: DEFAULT_MODEL, roles: {} },
    pricingOverrides: {},
    budgets: { daily: DEFAULT_BUDGET },
    ui: {},
  });
}

async function readJsonNoFollow(filename, label, { missing = null } = {}) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) fail("PREFERENCES_FILE_INVALID", `${label} must be a bounded regular file`);
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return missing;
    if (cause instanceof SyntaxError) fail("PREFERENCES_FILE_INVALID", `${label} is not valid JSON`);
    if (["ELOOP", "EMLINK"].includes(cause?.code)) fail("PREFERENCES_FILE_UNSAFE", `${label} may not be a symlink`);
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function listJsonDocuments(directory, label) {
  const directoryStat = await fs.lstat(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) fail("DAILY_CONFIG_CATALOG_INVALID", `${label} root must be a real directory`);
  const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const documents = [];
  for (const name of names) {
    if (!/^[a-z][a-z0-9-]{0,63}\.json$/u.test(name)) fail("DAILY_CONFIG_CATALOG_INVALID", `${label} contains an unsafe filename`);
    const document = await readJsonNoFollow(path.join(directory, name), `${label} ${name}`);
    if (document?.id !== name.slice(0, -5)) fail("DAILY_CONFIG_CATALOG_INVALID", `${label} filename and id differ`);
    documents.push(document);
  }
  return documents;
}

function normalizeOverlay(document) {
  exactKeys(document, new Set(["$schema", "formatVersion", "id", "kind", "description", "packageIds", "capabilityIds", "authority", "defaultEnabled", "available"]), "overlay");
  if (document.formatVersion !== 1 || !ID.test(document.id) || !["base", "hard", "soft", "reserved", "labs"].includes(document.kind)) fail("OVERLAY_INVALID", `overlay ${document.id ?? "unknown"} is invalid`);
  if (typeof document.description !== "string" || document.description.length < 1 || document.description.length > 500) fail("OVERLAY_INVALID", `overlay ${document.id} description is invalid`);
  const packageIds = normalizeIdSet(document.packageIds, `overlay ${document.id}.packageIds`);
  const capabilityIds = normalizeIdSet(document.capabilityIds, `overlay ${document.id}.capabilityIds`);
  exactKeys(document.authority, new Set(["network", "persistence", "tools", "webConfirmation", "browserCookies"]), `overlay ${document.id}.authority`);
  if (!["deny", "inherit", "public-ssrf-guarded"].includes(document.authority.network) || document.authority.browserCookies !== false || typeof document.authority.webConfirmation !== "boolean") fail("OVERLAY_INVALID", `overlay ${document.id} authority is invalid`);
  if (typeof document.defaultEnabled !== "boolean" || typeof document.available !== "boolean") fail("OVERLAY_INVALID", `overlay ${document.id} state is invalid`);
  if (!document.available && document.defaultEnabled) fail("OVERLAY_INVALID", `unavailable overlay ${document.id} cannot be enabled by default`);
  return immutable({ ...clone(document), packageIds, capabilityIds });
}

function normalizePreset(document, overlays) {
  exactKeys(document, new Set(["$schema", "formatVersion", "id", "description", "base", "overlays", "profileId"]), "preset");
  if (document.formatVersion !== 1 || !ID.test(document.id) || !ID.test(document.base) || !ID.test(document.profileId)) fail("PRESET_INVALID", `preset ${document.id ?? "unknown"} is invalid`);
  const overlayIds = normalizeIdSet(document.overlays, `preset ${document.id}.overlays`);
  const base = overlays.get(document.base);
  if (!base || base.kind !== "base") fail("PRESET_INVALID", `preset ${document.id} references an unknown base`);
  for (const id of overlayIds) {
    const overlay = overlays.get(id);
    if (!overlay || overlay.kind === "base") fail("PRESET_INVALID", `preset ${document.id} references unknown overlay ${id}`);
    if (!overlay.available) fail("PRESET_INVALID", `preset ${document.id} enables unavailable overlay ${id}`);
  }
  return immutable({ ...clone(document), overlays: overlayIds });
}

export async function loadDailyCatalog({ rootDir } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("loadDailyCatalog requires an absolute rootDir");
  const root = await fs.realpath(path.resolve(rootDir));
  const overlayDocuments = await listJsonDocuments(path.join(root, "overlays"), "overlay catalog");
  const overlays = new Map(overlayDocuments.map((entry) => {
    const normalized = normalizeOverlay(entry);
    return [normalized.id, normalized];
  }));
  if (overlays.size !== overlayDocuments.length || !overlays.has("core") || overlays.get("core").kind !== "base") fail("DAILY_CONFIG_CATALOG_INVALID", "overlay catalog requires one unique core base");
  const presetDocuments = await listJsonDocuments(path.join(root, "presets"), "preset catalog");
  const presets = new Map(presetDocuments.map((entry) => {
    const normalized = normalizePreset(entry, overlays);
    return [normalized.id, normalized];
  }));
  if (presets.size !== presetDocuments.length || !presets.has("daily")) fail("DAILY_CONFIG_CATALOG_INVALID", "preset catalog requires one unique daily preset");
  return immutable({ overlays: Object.fromEntries(overlays), presets: Object.fromEntries(presets) });
}

function catalogMaps(catalog) {
  return { overlays: new Map(Object.entries(catalog.overlays)), presets: new Map(Object.entries(catalog.presets)) };
}

function mergeModelSelection(base, override = {}) {
  return {
    model: override.model ?? base.model,
    thinking: override.thinking ?? base.thinking,
    fallbackModels: override.fallbackModels ?? base.fallbackModels,
  };
}

function mergeModels(...layers) {
  let defaultSelection = clone(DEFAULT_MODEL);
  for (const layer of layers) {
    if (!layer) continue;
    defaultSelection = mergeModelSelection(defaultSelection, layer.default);
  }
  const roles = {};
  for (const role of ROLE_IDS) {
    let selection = clone(defaultSelection);
    for (const layer of layers) selection = mergeModelSelection(selection, layer?.roles?.[role]);
    roles[role] = selection;
  }
  return { default: defaultSelection, roles };
}

function minimumBudget(...layers) {
  const output = clone(DEFAULT_BUDGET);
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) output[key] = Math.min(output[key], value);
  }
  if (output.maxConcurrency > output.maxChildren) output.maxConcurrency = output.maxChildren;
  if (output.maxOutputBytesPerChild > output.maxTotalOutputBytes) output.maxOutputBytesPerChild = output.maxTotalOutputBytes;
  if (output.maxToolCallsPerChild > output.maxTotalToolCalls) output.maxToolCallsPerChild = output.maxTotalToolCalls;
  return output;
}

function resolveOverlaySet({ catalog, presetId, global, project, perRun, allowGlobalEnable = true }) {
  const { overlays, presets } = catalogMaps(catalog);
  const preset = presets.get(presetId);
  if (!preset) fail("PRESET_NOT_FOUND", `unknown preset ${presetId}`);
  const globalSet = new Set([preset.base, ...preset.overlays]);
  for (const id of global.enabledOverlays) {
    if (!allowGlobalEnable && !globalSet.has(id)) fail("GENERATION_OVERLAY_MISMATCH", `active generation does not contain globally enabled overlay ${id}`);
    globalSet.add(id);
  }
  for (const id of global.disabledOverlays) globalSet.delete(id);
  globalSet.add(preset.base);
  for (const id of globalSet) {
    const overlay = overlays.get(id);
    if (!overlay) fail("OVERLAY_NOT_FOUND", `unknown overlay ${id}`);
    if (!overlay.available) fail("OVERLAY_UNAVAILABLE", `overlay ${id} is unavailable`);
  }
  let effective = new Set(globalSet);
  if (project) {
    if (project.defaultPreset && project.defaultPreset !== presetId) {
      const projectPreset = presets.get(project.defaultPreset);
      if (!projectPreset) fail("PRESET_NOT_FOUND", `unknown project preset ${project.defaultPreset}`);
      const requested = new Set([projectPreset.base, ...projectPreset.overlays]);
      for (const id of requested) if (!globalSet.has(id) && overlays.get(id)?.kind === "hard") fail("PROJECT_OVERLAY_WIDENING", `project preset would enable hard overlay ${id}`);
      effective = requested;
    }
    for (const id of project.disabledOverlays) effective.delete(id);
  }
  if (perRun) {
    for (const id of perRun.enabledOverlays) if (!effective.has(id)) fail("PER_RUN_OVERLAY_WIDENING", `per-run configuration cannot enable ${id} outside the active generation`);
    for (const id of perRun.disabledOverlays) effective.delete(id);
  }
  effective.add(preset.base);
  const resolved = [...effective].map((id) => overlays.get(id)).sort((left, right) => left.id.localeCompare(right.id));
  const hard = resolved.filter((entry) => entry.kind === "hard").map((entry) => entry.id);
  const soft = resolved.filter((entry) => entry.kind === "soft").map((entry) => entry.id);
  return { preset, resolved, hard, soft };
}

function preferencePath(configRoot) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("configRoot must be absolute");
  return path.join(path.resolve(configRoot), "only-my-pi", "preferences.json");
}

export async function resolveDailyConfiguration({ rootDir, configRoot, projectRoot = null, projectTrusted = false, perRun = null } = {}) {
  const catalog = await loadDailyCatalog({ rootDir });
  const defaults = defaultPreferences();
  const settingsDocument = await readJsonNoFollow(path.join(path.resolve(configRoot), "settings.json"), "Pi settings", { missing: null });
  // Native distributions carry the audited daily graph themselves. A prior
  // legacy generation is user history, not authority over the running package.
  const distribution = await loadIntrinsicDistribution();
  const installedProfileId = distribution ? "daily" : settingsDocument?.onlyMyPi?.profileId ?? null;
  const installedPresetId = ({ daily: "daily", coding: "core", minimal: "core" })[installedProfileId] ?? null;
  const globalDocument = await readJsonNoFollow(preferencePath(configRoot), "global preferences", { missing: null });
  const global = globalDocument === null ? defaults : normalizePreferences(globalDocument, { scope: "global" });
  let project = null;
  let projectStatus = "NOT_CONFIGURED";
  if (projectRoot !== null) {
    if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) throw new TypeError("projectRoot must be absolute");
    const projectFile = path.join(path.resolve(projectRoot), ".pi", "only-my-pi.json");
    if (projectTrusted === true) {
      const projectDocument = await readJsonNoFollow(projectFile, "project preferences", { missing: null });
      if (projectDocument !== null) {
        project = normalizePreferences(projectDocument, { scope: "project" });
        projectStatus = "TRUSTED_PROJECT_CONFIG_APPLIED";
      }
    } else {
      const present = await fs.lstat(projectFile).then(() => true, (cause) => cause?.code === "ENOENT" ? false : Promise.reject(cause));
      if (present) projectStatus = "IGNORED_UNTRUSTED_PROJECT_CONFIG";
    }
  }
  const run = perRun === null ? null : normalizePreferences({ formatVersion: 1, ...perRun }, { scope: "per-run" });
  const presetId = installedPresetId ?? global.defaultPreset ?? defaults.defaultPreset;
  const overlayResolution = resolveOverlaySet({ catalog, presetId, global, project, perRun: run, allowGlobalEnable: installedPresetId === null });
  const models = mergeModels(defaults.models, global.models, project?.models, run?.models);
  const budget = minimumBudget(DEFAULT_BUDGET, global.budgets?.daily, project?.budgets?.daily, run?.budgets?.daily);
  return immutable({
    formatVersion: 1,
    status: "RESOLVED",
    source: {
      global: globalDocument === null ? "defaults" : "global",
      generation: distribution ? `distribution:${distribution.distribution.version}`
        : installedPresetId === null ? "not-installed-or-legacy" : `installed:${installedProfileId}`,
      project: projectStatus,
      perRun: run === null ? "none" : "per-run",
    },
    preset: overlayResolution.preset,
    base: overlayResolution.preset.base,
    overlays: overlayResolution.resolved,
    hardOverlays: overlayResolution.hard,
    softOverlays: overlayResolution.soft,
    restartRequired: false,
    models,
    pricingOverrides: global.pricingOverrides,
    budget,
    profileId: overlayResolution.preset.profileId,
  });
}

function modelTuple(modelId) {
  const index = modelId.indexOf("/");
  return { provider: modelId.slice(0, index), id: modelId.slice(index + 1) };
}

function modelHasPricing(model, override) {
  if (override && Number.isFinite(override.inputPerMillion) && Number.isFinite(override.outputPerMillion)) return true;
  const input = model?.cost?.input ?? model?.pricing?.input ?? model?.inputCostPerMillion;
  const output = model?.cost?.output ?? model?.pricing?.output ?? model?.outputCostPerMillion;
  // Pi normalizes missing custom-provider prices to zero. Treating that
  // synthetic 0/0 pair as authoritative would disguise unknown pricing as a
  // free model and make maxCostUsd ineffective. A real positive provider
  // price is accepted; zero-variable-cost and subscription models require an
  // explicit global or protected-run override.
  return Number.isFinite(input) && input >= 0
    && Number.isFinite(output) && output >= 0
    && (input > 0 || output > 0);
}

export async function validateResolvedModels(configuration, { modelRegistry, currentModel = null } = {}) {
  if (!modelRegistry || typeof modelRegistry.find !== "function" || typeof modelRegistry.hasConfiguredAuth !== "function") {
    return immutable({ ok: false, status: "MODEL_REGISTRY_UNAVAILABLE", code: "MODEL_REGISTRY_UNAVAILABLE", roles: [] });
  }
  const results = [];
  for (const role of ROLE_IDS) {
    const selection = configuration.models.roles[role];
    const ids = [selection.model, ...selection.fallbackModels];
    const roleResults = [];
    for (const configuredId of ids) {
      let model = currentModel;
      let effectiveId = configuredId;
      if (configuredId !== "inherit") {
        const tuple = modelTuple(configuredId);
        model = await modelRegistry.find(tuple.provider, tuple.id);
      } else if (model) {
        effectiveId = `${model.provider ?? model.providerId}/${model.id ?? model.modelId}`;
      }
      if (!model) {
        roleResults.push({ model: effectiveId, status: "MODEL_NOT_FOUND" });
        continue;
      }
      const authenticated = await modelRegistry.hasConfiguredAuth(model);
      const priced = modelHasPricing(model, configuration.pricingOverrides[effectiveId]);
      roleResults.push({ model: effectiveId, status: !authenticated ? "AUTH_UNAVAILABLE" : !priced ? "PRICING_UNAVAILABLE" : "READY" });
    }
    const selected = roleResults.find((entry) => entry.status === "READY") ?? roleResults[0];
    results.push({ role, configured: selection, candidates: roleResults, selected: selected?.status === "READY" ? selected.model : null, status: selected?.status ?? "MODEL_NOT_FOUND" });
  }
  const ok = results.every((entry) => entry.status === "READY");
  return immutable({ ok, status: ok ? "MODEL_CONFIGURATION_READY" : "MODEL_CONFIGURATION_BLOCKED", code: ok ? null : "MODEL_CONFIGURATION_BLOCKED", roles: results });
}

export async function selectRoleModel(configuration, role, { modelRegistry, currentModel = null } = {}) {
  if (!ROLE_SET.has(role)) fail("MODEL_ROLE_UNKNOWN", `unknown model role ${role}`);
  if (!modelRegistry || typeof modelRegistry.find !== "function" || typeof modelRegistry.hasConfiguredAuth !== "function") fail("MODEL_REGISTRY_UNAVAILABLE", "Pi model registry is unavailable");
  const selection = configuration.models.roles[role];
  const failures = [];
  for (const configuredId of [selection.model, ...selection.fallbackModels]) {
    let model = currentModel;
    let effectiveId = configuredId;
    if (configuredId !== "inherit") {
      const tuple = modelTuple(configuredId);
      model = await modelRegistry.find(tuple.provider, tuple.id);
    } else if (model) effectiveId = `${model.provider ?? model.providerId}/${model.id ?? model.modelId}`;
    if (!model) { failures.push({ model: effectiveId, status: "MODEL_NOT_FOUND" }); continue; }
    if (!(await modelRegistry.hasConfiguredAuth(model))) { failures.push({ model: effectiveId, status: "AUTH_UNAVAILABLE" }); continue; }
    if (!modelHasPricing(model, configuration.pricingOverrides[effectiveId])) { failures.push({ model: effectiveId, status: "PRICING_UNAVAILABLE" }); continue; }
    return immutable({
      role,
      model: configuredId === "inherit" ? undefined : effectiveId,
      effectiveModel: effectiveId,
      thinking: selection.thinking === "inherit" ? undefined : selection.thinking,
      source: configuredId === "inherit" ? "parent" : "configured",
    });
  }
  fail("MODEL_CONFIGURATION_BLOCKED", `no ready model candidate for role ${role}`, { failures });
}

async function ensurePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("PREFERENCES_PATH_UNSAFE", "preferences directory must be a real directory");
  await fs.chmod(directory, 0o700);
}

export async function saveGlobalPreferences({ configRoot, preferences } = {}) {
  const normalized = normalizePreferences(preferences, { scope: "global" });
  const target = preferencePath(configRoot);
  const directory = path.dirname(target);
  await ensurePrivateDirectory(directory);
  const existing = await fs.lstat(target).catch((cause) => cause?.code === "ENOENT" ? null : Promise.reject(cause));
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) fail("PREFERENCES_PATH_UNSAFE", "preferences target must be a regular file");
  const temporary = path.join(directory, `.preferences-${process.pid}-${Date.now()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(`${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } finally {
    await handle?.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
  }
  return immutable({ ok: true, status: "PREFERENCES_SAVED", mutation: true, path: "only-my-pi/preferences.json", preferences: normalized });
}

export async function readLastInteractiveModel({ configRoot } = {}) {
  const document = await readJsonNoFollow(preferencePath(configRoot), "global preferences", { missing: null });
  if (document === null) return null;
  return normalizePreferences(document, { scope: "global" }).ui.lastModel ?? null;
}

export async function saveLastInteractiveModel({ configRoot, model, selectedAt = new Date().toISOString() } = {}) {
  const document = await readJsonNoFollow(preferencePath(configRoot), "global preferences", { missing: null });
  const preferences = document === null ? defaultPreferences() : normalizePreferences(document, { scope: "global" });
  const saved = await saveGlobalPreferences({
    configRoot,
    preferences: {
      ...preferences,
      ui: { lastModel: { model, selectedAt } },
    },
  });
  return immutable({
    ok: true,
    status: "LAST_INTERACTIVE_MODEL_SAVED",
    mutation: saved.mutation,
    lastModel: saved.preferences.ui.lastModel,
  });
}

export async function resetGlobalPreferences({ configRoot } = {}) {
  const target = preferencePath(configRoot);
  const stat = await fs.lstat(target).catch((cause) => cause?.code === "ENOENT" ? null : Promise.reject(cause));
  if (stat === null) return immutable({ ok: true, status: "NO_CHANGES", mutation: false });
  if (!stat.isFile() || stat.isSymbolicLink()) fail("PREFERENCES_PATH_UNSAFE", "preferences target must be a regular file");
  await fs.unlink(target);
  return immutable({ ok: true, status: "PREFERENCES_RESET", mutation: true });
}

export class DailyConfigService {
  constructor({ rootDir, configRoot } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("DailyConfigService requires absolute rootDir");
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("DailyConfigService requires absolute configRoot");
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
  }

  async catalog() { return loadDailyCatalog({ rootDir: this.rootDir }); }
  async readGlobal() {
    const document = await readJsonNoFollow(preferencePath(this.configRoot), "global preferences", { missing: null });
    return document === null ? defaultPreferences() : normalizePreferences(document, { scope: "global" });
  }
  async resolve(options = {}) { return resolveDailyConfiguration({ rootDir: this.rootDir, configRoot: this.configRoot, ...options }); }
  async list() {
    const catalog = await this.catalog();
    return { ok: true, status: "PRESET_LIST", mutation: false, presets: Object.values(catalog.presets), overlays: Object.values(catalog.overlays) };
  }
  async show(id = "daily") {
    const catalog = await this.catalog();
    const item = catalog.presets[id] ?? catalog.overlays[id];
    if (!item) return { ok: false, status: "CONFIG_ITEM_NOT_FOUND", code: "CONFIG_ITEM_NOT_FOUND", mutation: false, id };
    return { ok: true, status: catalog.presets[id] ? "PRESET_SHOW" : "OVERLAY_SHOW", mutation: false, item };
  }
  async save(preferences) { return saveGlobalPreferences({ configRoot: this.configRoot, preferences }); }
  async reset() { return resetGlobalPreferences({ configRoot: this.configRoot }); }
}

export function createDailyConfigService(options = {}) { return new DailyConfigService(options); }
export { DEFAULT_BUDGET, DEFAULT_MODEL, ROLE_IDS };
