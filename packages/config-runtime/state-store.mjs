import path from "node:path";

import { atomicWriteJson, canonicalJson, hashFile, readJsonObject, sha256 } from "./atomic-file.mjs";
import {
  configRuntimePaths,
  normalizeConfigRoot,
  relativeConfigPath,
  validatePortableId,
  validateRelativeConfigPath,
} from "./paths.mjs";
import {
  loadOwnedSettingsSnapshot,
  restoreOwnedSettingsSnapshot,
  verifyOwnedSettingsSnapshot,
} from "./snapshots.mjs";
import { loadSettings } from "./settings-store.mjs";

export class LastKnownGoodError extends Error {
  constructor(message, code, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "LastKnownGoodError";
    this.code = code;
    Object.assign(this, details);
  }
}

export const LAST_KNOWN_GOOD_SCHEMA =
  "https://github.com/Ricardo121380/only-my-pi/schemas/bootstrap-state-v1.schema.json";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SCHEMA_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const MODE_ID = /^(?:[a-z][a-z0-9-]{0,63}|(?:user|project|package):[a-z][a-z0-9-]{0,63}|[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63})$/u;
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;

function nowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("config-runtime: state clock returned an invalid date");
  return date.toISOString();
}

function stateDigest(state) {
  const copy = { ...state };
  delete copy.digest;
  return sha256(canonicalJson(copy));
}

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
    throw new LastKnownGoodError(`${label} is not a canonical sha256 digest`, "INVALID_LAST_KNOWN_GOOD");
  }
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LastKnownGoodError(`${label} must be an object`, "INVALID_LAST_KNOWN_GOOD");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new LastKnownGoodError(`${label} contains an unexpected field set`, "INVALID_LAST_KNOWN_GOOD");
  }
}

function normalizeMetadata(metadata = {}, options = {}) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new LastKnownGoodError("metadata must be an object", "INVALID_LAST_KNOWN_GOOD");
  }
  const allowed = new Set(["providerSelection", "initialMode"]);
  if (Object.keys(metadata).some((key) => !allowed.has(key))) {
    throw new LastKnownGoodError("metadata contains an unowned field", "INVALID_LAST_KNOWN_GOOD");
  }
  if (options.requireExact) {
    assertExactKeys(metadata, ["providerSelection", "initialMode"], "metadata");
  }
  const providerSelection = metadata.providerSelection ?? null;
  if (providerSelection !== null) {
    assertExactKeys(providerSelection, ["providerId", "modelId", "status"], "providerSelection");
    if (
      !SCHEMA_ID.test(providerSelection.providerId)
      || (providerSelection.modelId !== null && !MODEL_ID.test(providerSelection.modelId))
      || providerSelection.status !== "CONFIGURED_UNVERIFIED"
    ) {
      throw new LastKnownGoodError("providerSelection is invalid", "INVALID_LAST_KNOWN_GOOD");
    }
  }
  const initialMode = metadata.initialMode ?? null;
  if (initialMode !== null) {
    assertExactKeys(initialMode, ["id", "status"], "initialMode");
    if (!MODE_ID.test(initialMode.id) || initialMode.status !== "PENDING_M3_RESOLUTION") {
      throw new LastKnownGoodError("initialMode is invalid", "INVALID_LAST_KN_GOOD");
    }
  }
  return { providerSelection, initialMode };
}

function validateState(configRoot, state) {
  assertExactKeys(
    state,
    [
      "$schema",
      "formatVersion",
      "generationId",
      "generationManifestRelativePath",
      "generationManifestDigest",
      "settingsDigest",
      "snapshotId",
      "transactionId",
      "committedAt",
      "metadata",
      "digest",
    ],
    "last-known-good state",
  );
  if (state.$schema !== LAST_KNOWN_GOOD_SCHEMA || state.formatVersion !== 1) {
    throw new LastKnownGoodError("last-known-good state is invalid", "INVALID_LAST_KNOWN_GOOD");
  }
  assertSha256(state.generationId, "generationId");
  validatePortableId(state.snapshotId, "snapshot id");
  if (!SCHEMA_ID.test(state.snapshotId)) {
    throw new LastKnownGoodError("snapshotId is invalid", "INVALID_LAST_KNOWN_GOOD");
  }
  if (state.transactionId !== null && !TRANSACTION_ID.test(state.transactionId)) {
    throw new LastKnownGoodError("transactionId is invalid", "INVALID_LAST_KNOWN_GOOD");
  }
  assertSha256(state.settingsDigest, "settingsDigest");
  assertSha256(state.generationManifestDigest, "generationManifestDigest");
  if (!Number.isFinite(Date.parse(state.committedAt))) {
    throw new LastKnownGoodError("committedAt is invalid", "INVALID_LAST_KNOWN_GOOD");
  }
  normalizeMetadata(state.metadata, { requireExact: true });
  validateRelativeConfigPath(state.generationManifestRelativePath);
  if (state.generationManifestRelativePath.length > 512) {
    throw new LastKnownGoodError("generation manifest path is too long", "INVALID_LAST_KN_GOOD");
  }
  relativeConfigPath(configRoot, path.join(configRoot, ...state.generationManifestRelativePath.split("/")));
  if (state.digest !== stateDigest(state)) {
    throw new LastKnownGoodError("last-known-good state digest mismatch", "LAST_KNOWN_GOOD_DIGEST_MISMATCH");
  }
  return state;
}

export async function writeLastKnownGood(configRootInput, record, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("config-runtime: last-known-good record is required");
  }
  const state = {
    $schema: LAST_KNOWN_GOOD_SCHEMA,
    formatVersion: 1,
    generationId: record.generationId,
    generationManifestRelativePath: record.generationManifestRelativePath,
    generationManifestDigest: record.generationManifestDigest,
    settingsDigest: record.settingsDigest,
    snapshotId: validatePortableId(record.snapshotId, "snapshot id"),
    transactionId: record.transactionId ?? null,
    committedAt: record.committedAt ?? nowIso(options.now),
    metadata: normalizeMetadata(record.metadata),
  };
  assertSha256(state.generationId, "generationId");
  if (state.transactionId !== null && !TRANSACTION_ID.test(state.transactionId)) {
    throw new LastKnownGoodError("transactionId must be a UUIDv4 or null", "INVALID_LAST_KNOWN_GOOD");
  }
  assertSha256(state.settingsDigest, "settingsDigest");
  assertSha256(state.generationManifestDigest, "generationManifestDigest");
  if (typeof state.generationManifestRelativePath !== "string") {
    throw new LastKnownGoodError("generation manifest path is required", "INVALID_LAST_KNOWN_GOOD");
  }
  validateRelativeConfigPath(state.generationManifestRelativePath);
  if (state.generationManifestRelativePath.length > 512) {
    throw new LastKnownGoodError("generation manifest path is too long", "INVALID_LAST_KNOWN_GOOD");
  }
  const absoluteManifest = path.join(configRoot, ...state.generationManifestRelativePath.split("/"));
  relativeConfigPath(configRoot, absoluteManifest);
  const actualManifestDigest = await hashFile(configRoot, absoluteManifest);
  if (actualManifestDigest !== state.generationManifestDigest) {
    throw new LastKnownGoodError(
      "generation manifest digest does not match the file",
      "GENERATION_MANIFEST_HASH_MISMATCH",
      { expected: state.generationManifestDigest, actual: actualManifestDigest },
    );
  }
  const snapshot = await loadOwnedSettingsSnapshot(configRoot, state.snapshotId);
  if (snapshot.source.digest !== state.settingsDigest) {
    throw new LastKnownGoodError(
      "snapshot source does not match the last-known-good settings digest",
      "SNAPSHOT_SETTINGS_HASH_MISMATCH",
    );
  }
  const currentSettings = await loadSettings(configRoot);
  if (currentSettings.digest !== state.settingsDigest) {
    throw new LastKnownGoodError(
      "current settings do not match the proposed last-known-good state",
      "CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD",
      { expected: state.settingsDigest, actual: currentSettings.digest },
    );
  }
  state.digest = stateDigest(state);
  await atomicWriteJson(configRoot, configRuntimePaths(configRoot).lastKnownGoodFile, state, options.atomic ?? {});
  return Object.freeze(state);
}

export async function readLastKnownGood(configRootInput) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const state = await readJsonObject(configRoot, configRuntimePaths(configRoot).lastKnownGoodFile);
  return Object.freeze(validateState(configRoot, state));
}

export async function verifyLastKnownGood(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const state = await readLastKnownGood(configRoot);
  const snapshot = await verifyOwnedSettingsSnapshot(configRoot, state.snapshotId);
  if (snapshot.sourceDigest !== state.settingsDigest) {
    throw new LastKnownGoodError("snapshot source digest drifted", "SNAPSHOT_SETTINGS_HASH_MISMATCH");
  }
  const manifestPath = path.join(configRoot, ...state.generationManifestRelativePath.split("/"));
  const manifestDigest = await hashFile(configRoot, manifestPath);
  if (manifestDigest !== state.generationManifestDigest) {
    throw new LastKnownGoodError(
      "generation manifest digest drifted",
      "GENERATION_MANIFEST_HASH_MISMATCH",
      { expected: state.generationManifestDigest, actual: manifestDigest },
    );
  }
  let currentSettingsMatch = null;
  if (options.verifyCurrentSettings !== false) {
    const current = await loadSettings(configRoot, { settingsFile: options.settingsFile });
    currentSettingsMatch = current.digest === state.settingsDigest;
    if (!currentSettingsMatch) {
      throw new LastKnownGoodError(
        "current settings are not the last-known-good settings",
        "CURRENT_SETTINGS_NOT_LAST_KNOWN_GOOD",
        { expected: state.settingsDigest, actual: current.digest },
      );
    }
  }
  return Object.freeze({ ok: true, state, snapshot, currentSettingsMatch, generationManifestDigest: manifestDigest });
}

export async function restoreLastKnownGood(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (typeof options.expectedCurrentDigest !== "string") {
    throw new LastKnownGoodError("expectedCurrentDigest is required", "ROLLBACK_HASH_REQUIRED");
  }
  const verified = await verifyLastKnownGood(configRoot, { verifyCurrentSettings: false });
  const restored = await restoreOwnedSettingsSnapshot(configRoot, verified.state.snapshotId, {
    expectedCurrentDigest: options.expectedCurrentDigest,
    expectedOwnedPaths: options.expectedOwnedPaths,
    requireSourceDigest: true,
    settingsFile: options.settingsFile,
    atomic: options.atomic,
  });
  if (restored.digest !== verified.state.settingsDigest) {
    throw new LastKnownGoodError("restored settings do not match last-known-good", "RESTORED_SETTINGS_HASH_MISMATCH");
  }
  return Object.freeze({ restored: true, state: verified.state, settings: restored.settings, digest: restored.digest });
}
