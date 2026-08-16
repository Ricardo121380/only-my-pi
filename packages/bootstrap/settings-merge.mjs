import { canonicalJson } from "../config-runtime/atomic-file.mjs";

export const MANAGED_SETTING_FIELDS = Object.freeze(["packages", "extensions", "skills", "prompts", "themes"]);
export const OWNED_METADATA_KEY = "onlyMyPi";

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const METADATA_KEYS = Object.freeze([
  "formatVersion",
  "generationId",
  "graphDigest",
  "initialMode",
  "managedSettings",
  "profileId",
  "providerSelection",
].sort());

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactKeys(value, keys) {
  return plainObject(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function asList(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    const error = new TypeError(`Pi setting ${field} must be an array before only-my-pi can reconcile it`);
    error.code = "SETTINGS_FIELD_CONFLICT";
    throw error;
  }
  return value;
}

function identity(value) {
  return canonicalJson(value);
}

function priorManagedSettings(existing) {
  const metadata = existing[OWNED_METADATA_KEY];
  if (metadata === undefined) return Object.fromEntries(MANAGED_SETTING_FIELDS.map((field) => [field, []]));
  if (!isManagedMetadata(metadata)) {
    const error = new Error("existing onlyMyPi metadata is malformed or unsupported");
    error.code = "OWNED_METADATA_INVALID";
    throw error;
  }
  return Object.fromEntries(MANAGED_SETTING_FIELDS.map((field) => [field, asList(metadata.managedSettings[field], `onlyMyPi.managedSettings.${field}`)]));
}

function isProviderSelection(value) {
  return value === null || (
    exactKeys(value, ["modelId", "providerId", "status"])
    && ID.test(value.providerId)
    && (value.modelId === null || (typeof value.modelId === "string" && MODEL_ID.test(value.modelId)))
    && value.status === "CONFIGURED_UNVERIFIED"
  );
}

function isInitialMode(value) {
  return value === null || (
    exactKeys(value, ["id", "status"])
    && ID.test(value.id)
    && value.status === "PENDING_M3_RESOLUTION"
  );
}

function isManagedMetadata(value) {
  if (!exactKeys(value, METADATA_KEYS)
    || value.formatVersion !== 1
    || !ID.test(value.profileId)
    || !SHA256.test(value.generationId)
    || value.graphDigest !== value.generationId
    || !isProviderSelection(value.providerSelection)
    || !isInitialMode(value.initialMode)
    || !exactKeys(value.managedSettings, MANAGED_SETTING_FIELDS)) {
    return false;
  }
  return MANAGED_SETTING_FIELDS.every((field) => Array.isArray(value.managedSettings[field]));
}

function normalizeDesiredMetadata(metadata, managedSettings) {
  const value = {
    formatVersion: 1,
    profileId: metadata.profileId,
    generationId: metadata.generationId,
    graphDigest: metadata.graphDigest,
    providerSelection: metadata.providerSelection ?? null,
    initialMode: metadata.initialMode ?? null,
    managedSettings,
  };
  if (!isManagedMetadata(value)) {
    const error = new Error("desired onlyMyPi metadata is malformed, sensitive, or unsupported");
    error.code = "OWNED_METADATA_INVALID";
    throw error;
  }
  return value;
}

function reconcileList(existing, priorManaged, desiredManaged) {
  const prior = new Set(priorManaged.map(identity));
  const desired = new Map(desiredManaged.map((entry) => [identity(entry), entry]));
  const kept = [];
  const seen = new Set();
  for (const entry of existing) {
    const key = identity(entry);
    if (prior.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(clone(entry));
  }
  for (const [key, entry] of desired) {
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(clone(entry));
  }
  return kept;
}

export function compilePublishedSettings(existingSettings, generationSettings, metadata) {
  if (!plainObject(existingSettings) || !plainObject(generationSettings) || !plainObject(metadata)) {
    throw new TypeError("existing settings, generation settings, and metadata must be objects");
  }
  const previous = priorManagedSettings(existingSettings);
  const output = clone(existingSettings);
  const managedSettings = {};
  for (const field of MANAGED_SETTING_FIELDS) {
    const desired = asList(generationSettings[field], field);
    managedSettings[field] = clone(desired);
    output[field] = reconcileList(asList(existingSettings[field], field), previous[field], desired);
  }
  output[OWNED_METADATA_KEY] = normalizeDesiredMetadata(metadata, managedSettings);
  return output;
}

export function compileUninstalledSettings(existingSettings) {
  if (!plainObject(existingSettings)) throw new TypeError("existing settings must be an object");
  const previous = priorManagedSettings(existingSettings);
  const output = clone(existingSettings);
  for (const field of MANAGED_SETTING_FIELDS) {
    output[field] = reconcileList(asList(existingSettings[field], field), previous[field], []);
  }
  delete output[OWNED_METADATA_KEY];
  return output;
}

export function extractManagedMetadata(settings) {
  if (!plainObject(settings)) throw new TypeError("settings must be an object");
  if (settings[OWNED_METADATA_KEY] === undefined) return null;
  priorManagedSettings(settings);
  return clone(settings[OWNED_METADATA_KEY]);
}
