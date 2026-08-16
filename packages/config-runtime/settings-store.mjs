import fs from "node:fs/promises";

import {
  atomicWriteJson,
  canonicalJson,
  durableRemoveFile,
  sha256,
} from "./atomic-file.mjs";
import {
  assertSafeContainedPath,
  configRuntimePaths,
  normalizeConfigRoot,
  relativeConfigPath,
} from "./paths.mjs";

export const ABSENT_SETTINGS_DIGEST = sha256("only-my-pi:settings:absent:v1");
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;
const INVALID_CONCURRENT_SETTINGS = new Set([
  "EMPTY_SETTINGS",
  "MALFORMED_SETTINGS",
  "INVALID_SETTINGS_ROOT",
]);

export class ConcurrentSettingsChangeError extends Error {
  constructor(message, details = {}) {
    super(`config-runtime: ${message}`);
    this.name = "ConcurrentSettingsChangeError";
    this.code = "CONCURRENT_SETTINGS_CHANGE";
    Object.assign(this, details);
    this.atomicPublication = "NOT_PUBLISHED";
  }
}

function assertSettingsObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const error = new TypeError("config-runtime: settings root must be a JSON object");
    error.code = "INVALID_SETTINGS_ROOT";
    throw error;
  }
}

export function settingsDigest(settings) {
  assertSettingsObject(settings);
  return sha256(canonicalJson(settings));
}

function normalizeExpectedCurrent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("config-runtime: expectedCurrent must contain settings existence and digest");
  }
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "digest" || keys[1] !== "exists") {
    throw new TypeError("config-runtime: expectedCurrent must contain exactly exists and digest");
  }
  if (typeof value.exists !== "boolean" || !SHA256_DIGEST.test(value.digest ?? "")) {
    throw new TypeError("config-runtime: expectedCurrent existence or digest is invalid");
  }
  if (
    (!value.exists && value.digest !== ABSENT_SETTINGS_DIGEST)
    || (value.exists && value.digest === ABSENT_SETTINGS_DIGEST)
  ) {
    throw new TypeError("config-runtime: expectedCurrent existence and digest disagree");
  }
  return Object.freeze({ exists: value.exists, digest: value.digest });
}

function concurrentChange(expected, actual, cause) {
  return new ConcurrentSettingsChangeError(
    "settings changed after the transaction read and before atomic publication",
    {
      expected,
      actual,
      ...(cause ? { cause } : {}),
    },
  );
}

async function assertExpectedCurrent(configRoot, target, expected) {
  let actual;
  try {
    actual = await loadSettings(configRoot, { settingsFile: target });
  } catch (error) {
    if (!INVALID_CONCURRENT_SETTINGS.has(error?.code)) throw error;
    throw concurrentChange(
      expected,
      Object.freeze({ exists: true, digest: null, state: error.code }),
      error,
    );
  }
  const observed = Object.freeze({ exists: actual.exists, digest: actual.digest });
  if (observed.exists !== expected.exists || observed.digest !== expected.digest) {
    throw concurrentChange(expected, observed);
  }
  return actual;
}

function casWriteOptions(configRoot, target, expected, atomic = {}) {
  const callerBeforeRename = atomic.beforeRename;
  return {
    ...atomic,
    async beforeRename(context) {
      if (typeof callerBeforeRename === "function") await callerBeforeRename(context);
      await assertExpectedCurrent(configRoot, target, expected);
    },
  };
}

function casRemoveOptions(configRoot, target, expected, atomic = {}) {
  const callerBeforeRemoveRename = atomic.beforeRemoveRename;
  return {
    ...atomic,
    async beforeRemoveRename(context) {
      if (typeof callerBeforeRemoveRename === "function") await callerBeforeRemoveRename(context);
      await assertExpectedCurrent(configRoot, target, expected);
    },
  };
}

export async function loadSettings(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = options.settingsFile ?? configRuntimePaths(configRoot).settingsFile;
  relativeConfigPath(configRoot, target);
  await assertSafeContainedPath(configRoot, target);
  let text;
  try {
    text = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return Object.freeze({ exists: false, path: target, settings: {}, digest: ABSENT_SETTINGS_DIGEST });
    }
    throw error;
  }
  if (text.trim().length === 0) {
    const error = new SyntaxError("config-runtime: settings file is empty");
    error.code = "EMPTY_SETTINGS";
    throw error;
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (cause) {
    const error = new SyntaxError("config-runtime: settings file contains malformed JSON");
    error.code = "MALFORMED_SETTINGS";
    error.cause = cause;
    throw error;
  }
  assertSettingsObject(settings);
  return Object.freeze({ exists: true, path: target, settings, digest: settingsDigest(settings) });
}

export async function saveSettings(configRootInput, settings, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = options.settingsFile ?? configRuntimePaths(configRoot).settingsFile;
  relativeConfigPath(configRoot, target);
  assertSettingsObject(settings);
  await atomicWriteJson(configRoot, target, settings, options.atomic ?? {});
  return Object.freeze({ exists: true, path: target, settings, digest: settingsDigest(settings) });
}

/**
 * Atomically publish settings only if the immediately pre-rename canonical
 * state still matches the caller's earlier observation.
 */
export async function compareAndSaveSettings(configRootInput, settings, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = options.settingsFile ?? configRuntimePaths(configRoot).settingsFile;
  relativeConfigPath(configRoot, target);
  assertSettingsObject(settings);
  const expected = normalizeExpectedCurrent(options.expectedCurrent);
  await atomicWriteJson(
    configRoot,
    target,
    settings,
    casWriteOptions(configRoot, target, expected, options.atomic ?? {}),
  );
  return Object.freeze({
    exists: true,
    path: target,
    settings,
    digest: settingsDigest(settings),
    compared: expected,
  });
}

/**
 * Atomically remove settings only if its canonical state still matches the
 * caller's earlier observation. This is the absence-publication counterpart
 * to compareAndSaveSettings.
 */
export async function compareAndRemoveSettings(configRootInput, options = {}) {
  const configRoot = normalizeConfigRoot(configRootInput);
  const target = options.settingsFile ?? configRuntimePaths(configRoot).settingsFile;
  relativeConfigPath(configRoot, target);
  const expected = normalizeExpectedCurrent(options.expectedCurrent);
  await assertExpectedCurrent(configRoot, target, expected);
  if (!expected.exists) {
    return Object.freeze({
      exists: false,
      path: target,
      settings: {},
      digest: ABSENT_SETTINGS_DIGEST,
      removed: false,
      durable: true,
      compared: expected,
    });
  }
  const removed = await durableRemoveFile(
    configRoot,
    target,
    casRemoveOptions(configRoot, target, expected, options.atomic ?? {}),
  );
  if (!removed.removed) {
    let actual;
    try {
      const observed = await loadSettings(configRoot, { settingsFile: target });
      actual = Object.freeze({ exists: observed.exists, digest: observed.digest });
    } catch (error) {
      actual = Object.freeze({ exists: true, digest: null, state: error?.code ?? "INVALID" });
    }
    throw concurrentChange(expected, actual);
  }
  return Object.freeze({
    exists: false,
    path: target,
    settings: {},
    digest: ABSENT_SETTINGS_DIGEST,
    ...removed,
    compared: expected,
  });
}
