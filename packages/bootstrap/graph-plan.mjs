import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  validatePackageEntrySource,
  validateSri,
} from "../../scripts/lib/package-source.mjs";

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const GENERATION_RESOURCE_TYPES = new Set(["extension", "library", "skill", "prompt", "theme", "mode", "agent", "workflow", "swarm-recipe"]);
const LIFECYCLE_SCRIPT_NAMES = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
  "prepack",
  "postpack",
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function assertSafeRelativePath(value, label = "path") {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\")) {
    fail("UNSAFE_RELATIVE_PATH", `${label} must be a non-empty portable relative path`);
  }
  if (path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value === ".") {
    fail("UNSAFE_RELATIVE_PATH", `${label} must be a normalized relative path: ${value}`);
  }
  if (value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("UNSAFE_RELATIVE_PATH", `${label} contains an unsafe path segment: ${value}`);
  }
  return value;
}

function assertSafeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail("INVALID_ID", `${label} must be a canonical lower-case id`);
  }
  return value;
}

function assertFormat(document, label) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    fail("INVALID_DOCUMENT", `${label} must be an object`);
  }
  if (document.formatVersion !== 1) {
    fail("UNSUPPORTED_FORMAT", `${label} formatVersion must be 1`);
  }
}

function uniqueIndex(entries, label) {
  const index = new Map();
  for (const entry of entries ?? []) {
    const id = assertSafeId(entry?.id, `${label} id`);
    if (index.has(id)) fail("DUPLICATE_ID", `${label} contains duplicate id ${id}`);
    index.set(id, entry);
  }
  return index;
}

async function hashTreeEntry(absolutePath, relativePath, hash, options) {
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    if (!options.allowContainedSymlinks) {
      fail("RESOURCE_SYMLINK", `resource graph does not admit symlinks: ${relativePath}`);
    }
    let realTarget;
    try {
      realTarget = await fs.realpath(absolutePath);
    } catch (error) {
      fail("UNSAFE_TREE_SYMLINK", `managed tree contains a dangling symlink: ${relativePath}`, error);
    }
    if (realTarget !== options.realRoot && !realTarget.startsWith(`${options.realRoot}${path.sep}`)) {
      fail("UNSAFE_TREE_SYMLINK", `managed tree symlink escapes its root: ${relativePath}`);
    }
    const link = await fs.readlink(absolutePath);
    hash.update("L\0");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(link);
    hash.update("\0");
    return;
  }
  if (stat.isDirectory()) {
    hash.update("D\0");
    hash.update(relativePath);
    hash.update("\0");
    const names = await fs.readdir(absolutePath);
    names.sort();
    for (const name of names) {
      await hashTreeEntry(
        path.join(absolutePath, name),
        relativePath === "." ? name : `${relativePath}/${name}`,
        hash,
        options,
      );
    }
    return;
  }
  if (!stat.isFile()) {
    fail("UNSUPPORTED_RESOURCE_TYPE", `resource graph only admits regular files and directories: ${relativePath}`);
  }
  const bytes = await fs.readFile(absolutePath);
  hash.update("F\0");
  hash.update(relativePath);
  hash.update("\0");
  hash.update(String(bytes.length));
  hash.update("\0");
  hash.update(bytes);
  hash.update("\0");
}

export async function hashResourcePath({ artifactRoot, relativePath, allowContainedSymlinks = false }) {
  assertSafeRelativePath(relativePath, "resource path");
  const root = path.resolve(artifactRoot);
  const absolutePath = path.resolve(root, ...relativePath.split("/"));
  if (absolutePath === root || !absolutePath.startsWith(`${root}${path.sep}`)) {
    fail("RESOURCE_PATH_ESCAPE", `resource path escapes the artifact root: ${relativePath}`);
  }
  const hash = crypto.createHash("sha256");
  try {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      fail("UNSAFE_RESOURCE_ROOT", "resource artifact root must be a real directory");
    }
    let current = root;
    for (const segment of relativePath.split("/")) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() && current !== absolutePath) {
        fail("RESOURCE_SYMLINK", `resource path traverses a symlink: ${relativePath}`);
      }
    }
    const realRoot = await fs.realpath(root);
    await hashTreeEntry(absolutePath, ".", hash, { root, realRoot, allowContainedSymlinks });
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("RESOURCE_MISSING", `resource path does not exist: ${relativePath}`);
    }
    throw error;
  }
  return hash.digest("hex");
}

function graphDigestPayload(plan) {
  const payload = {
    formatVersion: plan.formatVersion,
    kind: plan.kind,
    profileId: plan.profileId,
    runtime: plan.runtime,
    packages: plan.packages,
    resources: plan.resources,
  };
  if (Array.isArray(plan.packageBindings)) payload.packageBindings = plan.packageBindings;
  return payload;
}

export function computeOwnedGraphDigest(plan) {
  return `sha256:${sha256(canonicalJson(graphDigestPayload(plan)))}`;
}

export function generationKeyFromDigest(graphDigest) {
  if (typeof graphDigest !== "string" || !graphDigest.startsWith("sha256:") || !SHA256.test(graphDigest.slice(7))) {
    fail("INVALID_GRAPH_DIGEST", "graph digest must be a canonical sha256 digest");
  }
  return graphDigest.slice(7);
}

function normalizedPackage(entry) {
  const source = validatePackageEntrySource(entry, { promoted: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.audit?.date ?? "") || !source.integrity) {
    fail("PACKAGE_AUDIT_REQUIRED", `promoted package ${entry.id} requires audit date and canonical sha512 integrity`);
  }
  validateSri(source.integrity);
  const sourceIdentity = source.type === "npm"
    ? { type: "npm", name: source.name, version: source.version }
    : { type: "git", protocol: source.protocol, repository: source.repository, commit: source.commit };
  const resourceFilter = [...(entry.resourceFilter ?? [])]
    .map((relativePath) => assertSafeRelativePath(relativePath, `package ${entry.id} resource filter`))
    .sort();
  const lifecycle = entry.audit?.lifecycle;
  if (
    lifecycle === null
    || typeof lifecycle !== "object"
    || Array.isArray(lifecycle)
    || lifecycle.execution !== "disabled"
    || !Array.isArray(lifecycle.scripts)
    || Object.keys(lifecycle).sort().join(",") !== "execution,scripts"
  ) {
    fail("PACKAGE_LIFECYCLE_AUDIT_REQUIRED", `promoted package ${entry.id} requires an exact disabled lifecycle audit`);
  }
  const lifecycleNames = new Set();
  const lifecycleScripts = lifecycle.scripts.map((script) => {
    if (
      script === null
      || typeof script !== "object"
      || Array.isArray(script)
      || Object.keys(script).sort().join(",") !== "commandSha256,name,necessity"
      || !LIFECYCLE_SCRIPT_NAMES.has(script.name)
      || !SHA256_DIGEST.test(script.commandSha256)
      || !["not-required", "required"].includes(script.necessity)
      || lifecycleNames.has(script.name)
    ) {
      fail("PACKAGE_LIFECYCLE_AUDIT_REQUIRED", `promoted package ${entry.id} has an invalid lifecycle script audit`);
    }
    lifecycleNames.add(script.name);
    if (script.necessity === "required") {
      fail("PACKAGE_LIFECYCLE_SANDBOX_REQUIRED", `package ${entry.id} requires lifecycle script ${script.name}, but no audited outer sandbox executor is available`);
    }
    return {
      name: script.name,
      commandSha256: script.commandSha256,
      necessity: script.necessity,
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return {
    id: entry.id,
    spec: source.normalized,
    source: sourceIdentity,
    integrity: source.integrity,
    resourceFilter,
    lifecycle: {
      execution: "disabled",
      scripts: lifecycleScripts,
    },
    owners: [...(entry.owners ?? [])].sort(),
  };
}

function rejectOverlappingResources(resources) {
  const paths = resources.map((resource) => resource.path).sort();
  for (let index = 0; index < paths.length; index += 1) {
    const current = paths[index];
    const next = paths[index + 1];
    if (next === current || next?.startsWith(`${current}/`)) {
      fail("RESOURCE_OWNERSHIP_OVERLAP", `owned resource paths overlap: ${current} and ${next}`);
    }
  }
}

/**
 * Resolve a Profile into the complete only-my-pi-owned package/resource graph.
 * Candidate packages are deliberately not accepted. Absolute host paths and
 * timestamps are excluded from the digest so equivalent artifacts resolve to
 * the same immutable generation key.
 */
export async function planOwnedGraph({
  packageInventory,
  resourceInventory,
  profile,
  artifactRoot,
}) {
  assertFormat(packageInventory, "package inventory");
  assertFormat(resourceInventory, "resource inventory");
  assertFormat(profile, "profile");
  const profileId = assertSafeId(profile.id, "profile id");
  if (!Array.isArray(profile.packageIds)) fail("INVALID_PROFILE", `profile ${profileId} must declare packageIds`);

  const promoted = uniqueIndex(packageInventory.packages, "promoted package inventory");
  const candidates = uniqueIndex(packageInventory.candidates, "candidate package inventory");
  const selectedPackageIds = new Set();
  const packages = [];
  for (const id of profile.packageIds) {
    assertSafeId(id, `profile ${profileId} package id`);
    if (selectedPackageIds.has(id)) fail("DUPLICATE_PACKAGE_SELECTION", `profile ${profileId} selects ${id} more than once`);
    selectedPackageIds.add(id);
    if (candidates.has(id)) fail("CANDIDATE_NOT_PROMOTED", `profile ${profileId} cannot activate candidate package ${id}`);
    const entry = promoted.get(id);
    if (!entry || entry.installed !== true) fail("PACKAGE_UNAVAILABLE", `profile ${profileId} selects unavailable package ${id}`);
    packages.push(normalizedPackage(entry));
  }
  packages.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const packageIdentities = new Set();
  for (const entry of packages) {
    const identity = entry.source.type === "npm"
      ? `npm:${entry.source.name}`
      : `git:${entry.source.repository}`;
    if (packageIdentities.has(identity)) {
      fail("PACKAGE_SOURCE_COLLISION", `profile ${profileId} selects the same package identity more than once: ${identity}`);
    }
    packageIdentities.add(identity);
  }

  const resourceEntries = [...(resourceInventory.resources ?? [])];
  uniqueIndex(resourceEntries, "resource inventory");
  const resources = [];
  for (const entry of resourceEntries) {
    if (entry.packaged !== true || !(entry.profileEligibility ?? []).includes(profileId)) continue;
    if (!GENERATION_RESOURCE_TYPES.has(entry.type)) {
      fail("UNSUPPORTED_GENERATION_RESOURCE", `resource ${entry.id} cannot be included in a managed generation: ${entry.type}`);
    }
    const relativePath = assertSafeRelativePath(entry.path, `resource ${entry.id} path`);
    const calculatedSha256 = await hashResourcePath({ artifactRoot, relativePath });
    if (entry.sha256 !== undefined && entry.sha256 !== calculatedSha256) {
      fail("RESOURCE_DIGEST_MISMATCH", `resource ${entry.id} does not match its declared sha256`);
    }
    resources.push({
      id: entry.id,
      type: entry.type,
      path: relativePath,
      version: entry.version,
      sha256: calculatedSha256,
      defaultLoaded: entry.defaultLoaded === true,
      lifecycle: entry.lifecycle,
      owners: [...(entry.owners ?? [])].sort(),
    });
  }
  resources.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  rejectOverlappingResources(resources);

  const plan = {
    formatVersion: 1,
    kind: "only-my-pi-owned-generation",
    profileId,
    runtime: {
      pi: packageInventory.runtime?.pi,
      node: packageInventory.runtime?.node,
      platform: packageInventory.runtime?.platform,
    },
    packages,
    resources,
  };
  const graphDigest = computeOwnedGraphDigest(plan);
  return Object.freeze({
    ...plan,
    graphDigest,
    generationKey: generationKeyFromDigest(graphDigest),
  });
}
