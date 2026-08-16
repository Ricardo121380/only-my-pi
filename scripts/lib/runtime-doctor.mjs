import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERN = /^\/?[a-z][A-Za-z0-9]*(?:[._:/-][A-Za-z0-9]+)*$/;
const FORBIDDEN_KEY = /(auth|authorization|cookie|credential|key|prompt|reasoning|secret|session(?:data|content|transcript)?|token|tool(?:input|output|payload))/i;
const SURFACE_STATES = new Set(["ACTIVE", "DEGRADED", "RESTART_REQUIRED", "UNSUPPORTED", "UNAVAILABLE", "UNKNOWN"]);
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function scanForbiddenKeys(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...scanForbiddenKeys(entry, `${path}[${index}]`)));
  } else if (object(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) findings.push(`${path}.${key}`);
      findings.push(...scanForbiddenKeys(entry, `${path}.${key}`));
    }
  }
  return findings;
}

function validateIdArray(value, field, errors) {
  if (!Array.isArray(value) || value.length > 512 || value.some((entry) => typeof entry !== "string" || !ID_PATTERN.test(entry))) {
    errors.push(`${field} must be a bounded array of canonical IDs`);
    return [];
  }
  if (new Set(value).size !== value.length) errors.push(`${field} contains duplicate IDs`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Build the exact, non-sensitive runtime projection for one governed Profile.
 * This reads repository declarations only; it never reads Pi home,
 * credentials, sessions, or a Provider endpoint.
 */
export function loadExpectedRuntimeSnapshot({ rootDir = DEFAULT_ROOT, profileId = "coding" } = {}) {
  if (typeof profileId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(profileId)) {
    throw new Error(`invalid runtime doctor profile id: ${profileId}`);
  }
  const root = fs.realpathSync(path.resolve(rootDir));
  const profileFile = path.join(root, "profiles", `${profileId}.json`);
  const relative = path.relative(root, profileFile);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(profileFile)) {
    throw new Error(`unknown runtime doctor profile: ${profileId}`);
  }

  const inventory = readJson(path.join(root, "inventory", "packages.lock.json"));
  const resourceDocument = readJson(path.join(root, "inventory", "resources.lock.json"));
  const capabilityDocument = readJson(path.join(root, "policies", "capabilities.v1.json"));
  const ownerDocument = readJson(path.join(root, "policies", "owners.v1.json"));
  const commandDocument = readJson(path.join(root, "policies", "command-owners.v1.json"));
  const enforcementDocument = readJson(path.join(root, "policies", "enforcement-surfaces.v1.json"));
  const profile = readJson(profileFile);

  const packagesById = new Map((inventory.packages ?? []).map((entry) => [entry.id, entry]));
  const resources = (resourceDocument.resources ?? []).filter(
    (resource) => resource.defaultLoaded === true && (resource.profileEligibility ?? []).includes(profile.id),
  );
  const capabilitiesById = new Map((capabilityDocument.capabilities ?? []).map((entry) => [entry.id, entry]));
  const capabilityIds = [...(profile.capabilityIds ?? [])].sort();
  const missingCapabilities = capabilityIds.filter((id) => !capabilitiesById.has(id));
  if (missingCapabilities.length) throw new Error(`profile references unknown capabilities: ${missingCapabilities.join(", ")}`);

  const ownerIds = new Set(["pi-host-runtime"]);
  for (const packageId of profile.packageIds ?? []) {
    const entry = packagesById.get(packageId);
    if (!entry) throw new Error(`profile references unknown promoted package: ${packageId}`);
    for (const ownerId of entry.owners ?? []) ownerIds.add(ownerId);
  }
  for (const resource of resources) for (const ownerId of resource.owners ?? []) ownerIds.add(ownerId);
  const knownOwners = new Set((ownerDocument.owners ?? []).map((owner) => owner.id));
  for (const ownerId of ownerIds) if (!knownOwners.has(ownerId)) throw new Error(`runtime expectation references unknown owner: ${ownerId}`);

  const resourceIds = [...new Set([...(profile.packageIds ?? []), ...resources.map((resource) => resource.id)])].sort();
  const commandIds = (commandDocument.commands ?? [])
    .filter((command) => command.status === "implemented")
    .map((command) => command.id)
    .sort();
  const capabilitySnapshots = capabilityIds.map((id) => ({ id, hash: digest(capabilitiesById.get(id)) }));
  const enforcementSurfaces = (enforcementDocument.surfaces ?? [])
    .map(({ id, owner }) => ({ id, owner }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (enforcementSurfaces.length !== 7) {
    throw new Error(`runtime expectation requires exactly seven enforcement surfaces; found ${enforcementSurfaces.length}`);
  }

  return Object.freeze({
    profileId: profile.id,
    piVersion: inventory.runtime?.pi,
    resourceIds: Object.freeze(resourceIds),
    commandIds: Object.freeze(commandIds),
    ownerIds: Object.freeze([...ownerIds].sort()),
    capabilitySnapshots: Object.freeze(capabilitySnapshots.map(Object.freeze)),
    enforcementSurfaces: Object.freeze(enforcementSurfaces.map(Object.freeze)),
  });
}

export function validateRuntimeMetadata(value) {
  const errors = [];
  const allowed = new Set([
    "formatVersion",
    "piVersion",
    "loadedResourceIds",
    "registeredCommandIds",
    "capabilitySnapshots",
    "enforcementSurfaces",
    "packageOwnerIds",
  ]);
  if (!object(value)) return { valid: false, errors: ["metadata must be an object"] };
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`unknown metadata field: ${key}`);
  for (const keyPath of scanForbiddenKeys(value)) errors.push(`sensitive metadata field rejected: ${keyPath}`);
  if (value.formatVersion !== 1) errors.push("formatVersion must equal 1");
  if (typeof value.piVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.piVersion)) {
    errors.push("piVersion must be a semantic version string");
  }
  validateIdArray(value.loadedResourceIds, "loadedResourceIds", errors);
  validateIdArray(value.registeredCommandIds, "registeredCommandIds", errors);
  validateIdArray(value.packageOwnerIds, "packageOwnerIds", errors);

  if (!Array.isArray(value.capabilitySnapshots) || value.capabilitySnapshots.length > 512) {
    errors.push("capabilitySnapshots must be a bounded array");
  } else {
    const ids = new Set();
    for (const entry of value.capabilitySnapshots) {
      if (!object(entry) || Object.keys(entry).some((key) => !["id", "hash", "state"].includes(key))) {
        errors.push("invalid capability snapshot object");
        continue;
      }
      if (!ID_PATTERN.test(entry.id ?? "") || !HASH_PATTERN.test(entry.hash ?? "") || !SURFACE_STATES.has(entry.state)) {
        errors.push(`invalid capability snapshot: ${entry.id ?? "unknown"}`);
      }
      if (ids.has(entry.id)) errors.push(`duplicate capability snapshot: ${entry.id}`);
      ids.add(entry.id);
    }
  }

  if (!Array.isArray(value.enforcementSurfaces) || value.enforcementSurfaces.length > 128) {
    errors.push("enforcementSurfaces must be a bounded array");
  } else {
    const ids = new Set();
    for (const entry of value.enforcementSurfaces) {
      if (!object(entry) || Object.keys(entry).some((key) => !["id", "owner", "state", "reasonCode"].includes(key))) {
        errors.push("invalid enforcement surface object");
        continue;
      }
      if (!ID_PATTERN.test(entry.id ?? "") || !ID_PATTERN.test(entry.owner ?? "") || !SURFACE_STATES.has(entry.state)) {
        errors.push(`invalid enforcement surface: ${entry.id ?? "unknown"}`);
      }
      if (typeof entry.reasonCode !== "string" || !/^[A-Z][A-Z0-9_]{2,63}$/.test(entry.reasonCode)) {
        errors.push(`invalid enforcement reasonCode: ${entry.id ?? "unknown"}`);
      }
      if (ids.has(entry.id)) errors.push(`duplicate enforcement surface: ${entry.id}`);
      ids.add(entry.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function reconcileRuntimeMetadata(metadata, expected = {}) {
  if (metadata == null) {
    return {
      ok: false,
      status: "UNAVAILABLE",
      findings: [{ code: "LIVE_METADATA_UNAVAILABLE", severity: "warning" }],
    };
  }
  const validation = validateRuntimeMetadata(metadata);
  if (!validation.valid) {
    return {
      ok: false,
      status: "INVALID",
      findings: validation.errors.map((message) => ({ code: "INVALID_LIVE_METADATA", severity: "error", message })),
    };
  }

  if (!object(expected) || typeof expected.piVersion !== "string" || !Array.isArray(expected.enforcementSurfaces)) {
    return {
      ok: false,
      status: "INVALID_EXPECTATION",
      findings: [{ code: "EXPECTED_RUNTIME_SNAPSHOT_REQUIRED", severity: "error" }],
    };
  }

  const findings = [];
  if (metadata.piVersion !== expected.piVersion) {
    findings.push({
      code: "PI_VERSION_MISMATCH",
      severity: "error",
      expected: expected.piVersion,
      actual: metadata.piVersion,
    });
  }
  const checks = [
    ["resources", expected.resourceIds ?? [], metadata.loadedResourceIds],
    ["commands", expected.commandIds ?? [], metadata.registeredCommandIds],
    ["owners", expected.ownerIds ?? [], metadata.packageOwnerIds],
  ];
  for (const [kind, wanted, actual] of checks) {
    for (const id of wanted) if (!actual.includes(id)) findings.push({ code: `MISSING_LIVE_${kind.toUpperCase()}`, severity: "error", id });
    for (const id of actual) if (!wanted.includes(id)) findings.push({ code: `UNEXPECTED_LIVE_${kind.toUpperCase()}`, severity: "error", id });
  }

  const expectedCapabilities = new Map((expected.capabilitySnapshots ?? []).map((entry) => [entry.id, entry]));
  const actualCapabilities = new Map(metadata.capabilitySnapshots.map((entry) => [entry.id, entry]));
  for (const [id, wanted] of expectedCapabilities) {
    const actual = actualCapabilities.get(id);
    if (!actual) {
      findings.push({ code: "MISSING_LIVE_CAPABILITY", severity: "error", id });
      continue;
    }
    if (actual.hash !== wanted.hash) {
      findings.push({ code: "CAPABILITY_HASH_MISMATCH", severity: "error", id, expected: wanted.hash, actual: actual.hash });
    }
    if (actual.state !== "ACTIVE") {
      findings.push({
        code: "CAPABILITY_NOT_ACTIVE",
        severity: actual.state === "DEGRADED" ? "warning" : "error",
        id,
        state: actual.state,
      });
    }
  }
  for (const id of actualCapabilities.keys()) {
    if (!expectedCapabilities.has(id)) findings.push({ code: "UNEXPECTED_LIVE_CAPABILITY", severity: "error", id });
  }

  const expectedSurfaces = new Map(expected.enforcementSurfaces.map((entry) => [entry.id, entry]));
  const actualSurfaces = new Map(metadata.enforcementSurfaces.map((entry) => [entry.id, entry]));
  for (const [id, wanted] of expectedSurfaces) {
    const actual = actualSurfaces.get(id);
    if (!actual) {
      findings.push({ code: "MISSING_ENFORCEMENT_SURFACE", severity: "error", id });
      continue;
    }
    if (actual.owner !== wanted.owner) {
      findings.push({ code: "ENFORCEMENT_OWNER_MISMATCH", severity: "error", id, expected: wanted.owner, actual: actual.owner });
    }
    if (actual.state !== "ACTIVE") {
      findings.push({
        code: "ENFORCEMENT_NOT_ACTIVE",
        severity: actual.state === "DEGRADED" ? "warning" : "error",
        id: actual.id,
        state: actual.state,
        reasonCode: actual.reasonCode,
      });
    }
  }
  for (const id of actualSurfaces.keys()) {
    if (!expectedSurfaces.has(id)) findings.push({ code: "UNEXPECTED_ENFORCEMENT_SURFACE", severity: "error", id });
  }

  const hasErrors = findings.some((entry) => entry.severity === "error");
  return { ok: !hasErrors, status: hasErrors ? "FAIL" : findings.length ? "DEGRADED" : "PASS", findings };
}
