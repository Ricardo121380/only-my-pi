import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { parsePackageSpec } from "../../scripts/lib/package-source.mjs";
import {
  canonicalJson,
  computeOwnedGraphDigest,
  generationKeyFromDigest,
  hashResourcePath,
  sha256,
} from "./graph-plan.mjs";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;
const SENSITIVE_PATH_PARTS = new Set(["auth.json", "models.json", "models-store.json", "sessions"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function packageSettingSource(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.source === "string") return value.source;
  return null;
}

function expectedExternalSetting(entry) {
  if (entry.resourceFilter.length === 0) return entry.spec;
  return {
    source: entry.spec,
    extensions: [...entry.resourceFilter],
    skills: [],
    prompts: [],
    themes: [],
  };
}

function externalSettingMatches(entry, setting) {
  const expected = expectedExternalSetting(entry);
  if (typeof expected === "string") return setting === expected;
  if (!setting || typeof setting !== "object" || Array.isArray(setting)) return false;
  const expectedKeys = Object.keys(expected).sort();
  if (canonicalJson(Object.keys(setting).sort()) !== canonicalJson(expectedKeys)) return false;
  if (setting.source !== expected.source) return false;
  return ["extensions", "skills", "prompts", "themes"].every((field) => (
    Array.isArray(setting[field])
    && setting[field].every((value) => typeof value === "string")
    && canonicalJson([...setting[field]].sort()) === canonicalJson([...expected[field]].sort())
  ));
}

function packageIdentityFromSetting(value) {
  const source = packageSettingSource(value);
  if (source === null) return null;
  try {
    const parsed = parsePackageSpec(source);
    return parsed.type === "npm" ? `npm:${parsed.name}` : `git:${parsed.repository}`;
  } catch {
    return null;
  }
}

function packageIdentity(entry) {
  return entry.source.type === "npm" ? `npm:${entry.source.name}` : `git:${entry.source.repository}`;
}

async function readJsonNoFollow(filename, { missing = null } = {}) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) fail("EXTERNAL_PACKAGE_EVIDENCE_INVALID", `${path.basename(filename)} must be a regular file`);
    if (stat.size > 8 * 1024 * 1024) fail("EXTERNAL_PACKAGE_EVIDENCE_INVALID", `${path.basename(filename)} exceeds the evidence size bound`);
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return missing;
    if (cause instanceof SyntaxError) fail("EXTERNAL_PACKAGE_EVIDENCE_INVALID", `${path.basename(filename)} is not valid JSON`);
    if (["ELOOP", "EMLINK"].includes(cause?.code)) fail("EXTERNAL_PACKAGE_PATH_UNSAFE", `${path.basename(filename)} may not be a symlink`);
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertRealDirectory(target, code, label) {
  let stat;
  try { stat = await fs.lstat(target); } catch (cause) { if (cause?.code === "ENOENT") fail(code, `${label} is missing`); throw cause; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(code, `${label} must be a real directory`);
  return target;
}

function lifecycleEvidence(packageManifest) {
  const lifecycleNames = new Set(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "prepack", "postpack"]);
  const scripts = packageManifest?.scripts ?? {};
  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) fail("EXTERNAL_PACKAGE_LIFECYCLE_DRIFT", "package scripts must be an object");
  return Object.entries(scripts)
    .filter(([name]) => lifecycleNames.has(name))
    .map(([name, command]) => {
      if (typeof command !== "string") fail("EXTERNAL_PACKAGE_LIFECYCLE_DRIFT", `lifecycle script ${name} is not a string`);
      return { name, commandSha256: `sha256:${sha256(command)}`, necessity: "not-required" };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolvedUrlDigest(value) {
  let url;
  try { url = new URL(value); } catch { fail("EXTERNAL_PACKAGE_LOCK_DRIFT", "lockfile resolved URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    fail("EXTERNAL_PACKAGE_LOCK_DRIFT", "lockfile resolved URL must be credential-free HTTPS");
  }
  return `sha256:${crypto.createHash("sha256").update(url.href).digest("hex")}`;
}

function priorBindingById(priorBindings) {
  if (priorBindings === undefined || priorBindings === null) return new Map();
  if (!Array.isArray(priorBindings)) fail("EXTERNAL_PACKAGE_BINDING_INVALID", "prior package bindings must be an array");
  return new Map(priorBindings.map((entry) => [entry.id, entry]));
}

function managedBinding(entry) {
  return {
    id: entry.id,
    name: entry.source.type === "npm" ? entry.source.name : null,
    binding: "managed",
    sourceSpec: entry.spec,
    resolvedVersion: entry.source.type === "npm" ? entry.source.version : null,
    integrity: entry.integrity,
    resolvedUrlDigest: null,
    physicalRootDigest: null,
    owner: "only-my-pi",
    resourceFilter: [...entry.resourceFilter],
  };
}

async function verifyExternalBinding({ configRoot, entry, setting, lockfile, prior }) {
  if (entry.source.type !== "npm") fail("EXTERNAL_PACKAGE_SOURCE_UNSUPPORTED", `external binding supports exact npm packages only: ${entry.id}`);
  if (!externalSettingMatches(entry, setting)) {
    fail("EXTERNAL_PACKAGE_SETTINGS_DRIFT", `settings activation differs from the governed package selection for ${entry.id}`);
  }
  if (!lockfile || lockfile.lockfileVersion !== 3 || !lockfile.packages || typeof lockfile.packages !== "object") {
    fail("EXTERNAL_PACKAGE_LOCK_DRIFT", "npm/package-lock.json v3 is required to borrow existing packages");
  }
  const name = entry.source.name;
  if (!PACKAGE_NAME.test(name)) fail("EXTERNAL_PACKAGE_IDENTITY_INVALID", `package name is invalid for ${entry.id}`);
  const lockPath = `node_modules/${name}`;
  const locked = lockfile.packages[lockPath];
  if (!locked || locked.version !== entry.source.version || locked.integrity !== entry.integrity || typeof locked.resolved !== "string") {
    fail("EXTERNAL_PACKAGE_LOCK_DRIFT", `lockfile identity or integrity differs for ${entry.id}`);
  }
  const resolvedDigest = resolvedUrlDigest(locked.resolved);
  const npmRoot = path.join(configRoot, "npm");
  await assertRealDirectory(configRoot, "EXTERNAL_PACKAGE_PATH_UNSAFE", "Pi config root");
  await assertRealDirectory(npmRoot, "EXTERNAL_PACKAGE_PATH_UNSAFE", "Pi npm root");
  await assertRealDirectory(path.join(npmRoot, "node_modules"), "EXTERNAL_PACKAGE_PATH_UNSAFE", "Pi node_modules root");
  const relativePackagePath = `node_modules/${name}`;
  const physicalRoot = path.join(npmRoot, ...relativePackagePath.split("/"));
  await assertRealDirectory(physicalRoot, "EXTERNAL_PACKAGE_MISSING", `external package ${entry.id}`);
  const manifest = await readJsonNoFollow(path.join(physicalRoot, "package.json"));
  if (manifest?.name !== name || manifest?.version !== entry.source.version) {
    fail("EXTERNAL_PACKAGE_IDENTITY_DRIFT", `physical package identity differs for ${entry.id}`);
  }
  if (canonicalJson(lifecycleEvidence(manifest)) !== canonicalJson(entry.lifecycle.scripts)) {
    fail("EXTERNAL_PACKAGE_LIFECYCLE_DRIFT", `physical lifecycle scripts differ from the audit for ${entry.id}`);
  }
  const physicalRootDigest = `sha256:${await hashResourcePath({
    artifactRoot: npmRoot,
    relativePath: relativePackagePath,
    allowContainedSymlinks: true,
  })}`;
  const binding = {
    id: entry.id,
    name,
    binding: "external",
    sourceSpec: entry.spec,
    resolvedVersion: entry.source.version,
    integrity: entry.integrity,
    resolvedUrlDigest: resolvedDigest,
    physicalRootDigest,
    owner: "user",
    resourceFilter: [...entry.resourceFilter],
  };
  if (prior?.binding === "external" && canonicalJson(prior) !== canonicalJson(binding)) {
    fail("EXTERNAL_PACKAGE_BINDING_DRIFT", `previously borrowed package drifted for ${entry.id}`);
  }
  return binding;
}

/**
 * Reclassify exact pre-existing Pi packages as borrowed external bindings.
 * This function is read-only. Packages not already selected remain managed and
 * are staged by the existing immutable-generation pipeline.
 */
export async function bindExistingPackages({ configRoot, settings, plan, priorBindings } = {}) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("bindExistingPackages requires an absolute configRoot");
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new TypeError("settings must be an object");
  if (!plan || !Array.isArray(plan.packages)) throw new TypeError("owned graph plan is required");
  if (SENSITIVE_PATH_PARTS.has(path.basename(configRoot))) fail("EXTERNAL_PACKAGE_PATH_UNSAFE", "configRoot resolves to a sensitive file name");
  const selectedSettings = Array.isArray(settings.packages) ? settings.packages : [];
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) fail("SETTINGS_FIELD_CONFLICT", "Pi setting packages must be an array");
  const prior = priorBindingById(priorBindings);
  const lockfile = await readJsonNoFollow(path.join(configRoot, "npm", "package-lock.json"), { missing: null });
  const managed = [];
  const bindings = [];
  for (const entry of plan.packages) {
    const identity = packageIdentity(entry);
    const sameIdentity = selectedSettings.filter((setting) => packageIdentityFromSetting(setting) === identity);
    const exact = sameIdentity.filter((setting) => packageSettingSource(setting) === entry.spec);
    if (sameIdentity.length > 1 || exact.length > 1) fail("EXTERNAL_PACKAGE_DUPLICATE", `Pi settings contain duplicate package identity ${identity}`);
    if (sameIdentity.length === 1 && exact.length === 0) {
      fail("EXTERNAL_PACKAGE_VERSION_CONFLICT", `Pi settings already select a different source for ${identity}`);
    }
    if (exact.length === 1) {
      bindings.push(await verifyExternalBinding({ configRoot: path.resolve(configRoot), entry, setting: exact[0], lockfile, prior: prior.get(entry.id) }));
    } else {
      const binding = managedBinding(entry);
      if (prior.get(entry.id)?.binding === "external") {
        fail("EXTERNAL_PACKAGE_BINDING_DRIFT", `previously borrowed package is no longer selected: ${entry.id}`);
      }
      bindings.push(binding);
      managed.push(entry);
    }
  }
  bindings.sort((left, right) => left.id.localeCompare(right.id));
  const rebound = {
    ...clone(plan),
    packages: managed,
    packageBindings: bindings,
  };
  delete rebound.graphDigest;
  delete rebound.generationKey;
  const graphDigest = computeOwnedGraphDigest(rebound);
  return Object.freeze({
    ...rebound,
    graphDigest,
    generationKey: generationKeyFromDigest(graphDigest),
  });
}
