import crypto from "node:crypto";
import path from "node:path";

import {
  atomicPublishDirectory,
  atomicWriteJson,
  canonicalJson,
  readJsonObject,
  sha256,
} from "./atomic-file.mjs";
import {
  configRuntimePaths,
  ensureConfigDirectory,
  normalizeConfigRoot,
  relativeConfigPath,
  validatePortableId,
  validateRelativeConfigPath,
} from "./paths.mjs";
import {
  extractOwnedSettings,
  normalizeOwnedPaths,
  ownedPathPointer,
  restoreOwnedSettings,
} from "./owned-settings.mjs";
import {
  ABSENT_SETTINGS_DIGEST,
  compareAndRemoveSettings,
  compareAndSaveSettings,
  loadSettings,
  settingsDigest,
} from "./settings-store.mjs";

export const SNAPSHOT_SCHEMA =
  "https://github.com/Ricardo121380/only-my-pi/schemas/bootstrap-snapshot-v1.schema.json";

const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SCHEMA_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

export class SettingsSnapshotError extends Error {
  constructor(message, code, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "SettingsSnapshotError";
    this.code = code;
    Object.assign(this, details);
  }
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError("config-runtime: snapshot clock returned an invalid date");
  return date.toISOString();
}

function snapshotPaths(configRoot, snapshotId) {
  const id = validatePortableId(snapshotId, "snapshot id");
  if (!SCHEMA_ID.test(id)) throw new SettingsSnapshotError("snapshot id must be canonical lower-case", "INVALID_SNAPSHOT_ID");
  const root = configRuntimePaths(configRoot).snapshotsRoot;
  return { id, directory: path.join(root, id), manifestFile: path.join(root, id, "manifest.json") };
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SettingsSnapshotError(`${label} must be an object`, "INVALID_SNAPSHOT");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new SettingsSnapshotError(`${label} contains an unexpected field set`, "INVALID_SNAPSHOT");
  }
}

function manifestDigest(manifest) {
  const copy = { ...manifest };
  delete copy.digest;
  return sha256(canonicalJson(copy));
}

function isDeepEmptyObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.values(value).every(isDeepEmptyObject);
}

function validateManifest(manifest, expectedId) {
  assertExactKeys(
    manifest,
    ["$schema", "formatVersion", "snapshotId", "createdAt", "settingsRelativePath", "source", "owned", "digest"],
    "snapshot manifest",
  );
  if (
    manifest.$schema !== SNAPSHOT_SCHEMA
    || manifest.formatVersion !== 1
    || manifest.snapshotId !== expectedId
    || !Number.isFinite(Date.parse(manifest.createdAt))
  ) {
    throw new SettingsSnapshotError("snapshot identity is invalid", "INVALID_SNAPSHOT");
  }
  if (typeof manifest.settingsRelativePath !== "string") {
    throw new SettingsSnapshotError("snapshot settings path is invalid", "INVALID_SNAPSHOT");
  }
  validateRelativeConfigPath(manifest.settingsRelativePath);
  if (manifest.settingsRelativePath !== "settings.json") {
    throw new SettingsSnapshotError("snapshot must target configRoot/settings.json", "INVALID_SNAPSHOT");
  }
  assertExactKeys(manifest.source, ["exists", "digest"], "snapshot source");
  assertExactKeys(manifest.owned, ["paths", "present", "values"], "snapshot ownership");
  let normalized;
  try {
    normalized = normalizeOwnedPaths(manifest.owned?.paths ?? []);
  } catch (cause) {
    throw new SettingsSnapshotError("snapshot ownership is invalid", "INVALID_SNAPSHOT", { cause });
  }
  const pointers = normalized.map(ownedPathPointer);
  if (canonicalJson(pointers) !== canonicalJson(manifest.owned.paths)) {
    throw new SettingsSnapshotError("snapshot ownership is not canonical", "INVALID_SNAPSHOT");
  }
  if (
    !Array.isArray(manifest.owned.present)
    || new Set(manifest.owned.present).size !== manifest.owned.present.length
    || manifest.owned.present.some((pointer, index) => pointer !== [...manifest.owned.present].sort()[index])
    || manifest.owned.present.some((pointer) => !manifest.owned.paths.includes(pointer))
    || !manifest.owned.values
    || typeof manifest.owned.values !== "object"
    || Array.isArray(manifest.owned.values)
  ) {
    throw new SettingsSnapshotError("snapshot owned values are invalid", "INVALID_SNAPSHOT");
  }
  const projected = extractOwnedSettings(manifest.owned.values, manifest.owned.paths);
  if (canonicalJson(projected) !== canonicalJson(manifest.owned)) {
    throw new SettingsSnapshotError("snapshot owned values do not match its presence map", "INVALID_SNAPSHOT");
  }
  if (typeof manifest.source.exists !== "boolean" || !SHA256_DIGEST.test(manifest.source.digest)) {
    throw new SettingsSnapshotError("snapshot source state is invalid", "INVALID_SNAPSHOT");
  }
  if (
    (!manifest.source.exists && manifest.source.digest !== ABSENT_SETTINGS_DIGEST)
    || (manifest.source.exists && manifest.source.digest === ABSENT_SETTINGS_DIGEST)
  ) {
    throw new SettingsSnapshotError("snapshot source existence and digest disagree", "INVALID_SNAPSHOT");
  }
  if (manifest.digest !== manifestDigest(manifest)) {
    throw new SettingsSnapshotError("snapshot manifest digest mismatch", "SNAPSHOT_DIGEST_MISMATCH");
  }
  return manifest;
}

export async function createOwnedSettingsSnapshot(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const id = options.id ?? crypto.randomUUID();
  const target = snapshotPaths(configRoot, id);
  const ownedPaths = normalizeOwnedPaths(options.ownedPaths).map(ownedPathPointer);
  const source = await loadSettings(configRoot, { settingsFile: options.settingsFile });
  const relativeSettingsPath = relativeConfigPath(configRoot, source.path);
  if (relativeSettingsPath !== "settings.json") {
    throw new SettingsSnapshotError(
      "owned snapshot settingsFile must be configRoot/settings.json",
      "INVALID_SNAPSHOT_SETTINGS_PATH",
    );
  }
  const owned = extractOwnedSettings(source.settings, ownedPaths);
  const snapshotsRoot = configRuntimePaths(configRoot).snapshotsRoot;
  await ensureConfigDirectory(configRoot, relativeConfigPath(configRoot, snapshotsRoot));
  const manifest = {
    $schema: SNAPSHOT_SCHEMA,
    formatVersion: 1,
    snapshotId: target.id,
    createdAt: nowIso(options.now),
    settingsRelativePath: relativeSettingsPath,
    source: { exists: source.exists, digest: source.digest },
    owned: { paths: owned.paths, present: [...owned.present], values: owned.values },
  };
  manifest.digest = manifestDigest(manifest);
  try {
    await atomicPublishDirectory(
      configRoot,
      target.directory,
      async ({ temporary }) => {
        await atomicWriteJson(
          configRoot,
          path.join(temporary, "manifest.json"),
          manifest,
          options.atomic ?? {},
        );
      },
      options.directoryAtomic ?? {},
    );
  } catch (error) {
    if (error.code === "ATOMIC_DIRECTORY_EXISTS") {
      throw new SettingsSnapshotError(
        `snapshot already exists: ${target.id}`,
        "SNAPSHOT_EXISTS",
        { cause: error },
      );
    }
    throw error;
  }
  return Object.freeze(manifest);
}

export async function loadOwnedSettingsSnapshot(configRootInput, snapshotId) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = snapshotPaths(configRoot, snapshotId);
  const manifest = await readJsonObject(configRoot, target.manifestFile);
  return Object.freeze(validateManifest(manifest, target.id));
}

export async function verifyOwnedSettingsSnapshot(configRootInput, snapshotId) {
  const manifest = await loadOwnedSettingsSnapshot(configRootInput, snapshotId);
  return Object.freeze({
    ok: true,
    snapshotId: manifest.snapshotId,
    digest: manifest.digest,
    sourceDigest: manifest.source.digest,
    ownedPaths: [...manifest.owned.paths],
  });
}

export async function restoreOwnedSettingsSnapshot(configRootInput, snapshotId, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  if (typeof options.expectedCurrentDigest !== "string") {
    throw new SettingsSnapshotError(
      "expectedCurrentDigest is required for rollback",
      "ROLLBACK_HASH_REQUIRED",
    );
  }
  const manifest = await loadOwnedSettingsSnapshot(configRoot, snapshotId);
  const manifestSettingsFile = path.join(configRoot, ...manifest.settingsRelativePath.split("/"));
  if (
    options.settingsFile
    && relativeConfigPath(configRoot, options.settingsFile) !== manifest.settingsRelativePath
  ) {
    throw new SettingsSnapshotError("settings path does not match snapshot", "ROLLBACK_SETTINGS_PATH_MISMATCH");
  }
  const current = await loadSettings(configRoot, { settingsFile: manifestSettingsFile });
  if (current.digest !== options.expectedCurrentDigest) {
    throw new SettingsSnapshotError(
      "current settings digest does not match rollback precondition",
      "ROLLBACK_HASH_MISMATCH",
      { expected: options.expectedCurrentDigest, actual: current.digest },
    );
  }
  if (options.expectedOwnedPaths) {
    const expected = normalizeOwnedPaths(options.expectedOwnedPaths).map(ownedPathPointer);
    if (canonicalJson(expected) !== canonicalJson(manifest.owned.paths)) {
      throw new SettingsSnapshotError("rollback ownership does not match snapshot", "ROLLBACK_OWNERSHIP_MISMATCH");
    }
  }
  const restored = restoreOwnedSettings(current.settings, manifest.owned, manifest.owned.paths);
  const restoreAbsence = !manifest.source.exists && isDeepEmptyObject(restored);
  const restoredDigest = restoreAbsence ? ABSENT_SETTINGS_DIGEST : settingsDigest(restored);
  if (options.requireSourceDigest && restoredDigest !== manifest.source.digest) {
    throw new SettingsSnapshotError(
      "owned rollback cannot reproduce the snapshot source digest",
      "ROLLBACK_SOURCE_HASH_MISMATCH",
      { expected: manifest.source.digest, actual: restoredDigest },
    );
  }
  const expectedCurrent = Object.freeze({ exists: current.exists, digest: current.digest });
  const saved = restoreAbsence
    ? await compareAndRemoveSettings(configRoot, {
        settingsFile: current.path,
        expectedCurrent,
        atomic: options.atomic,
      })
    : await compareAndSaveSettings(configRoot, restored, {
        settingsFile: current.path,
        expectedCurrent,
        atomic: options.atomic,
      });
  return Object.freeze({
    restored: true,
    snapshotId: manifest.snapshotId,
    digest: saved.digest,
    sourceDigestMatched: saved.digest === manifest.source.digest,
    settings: saved.settings,
  });
}
