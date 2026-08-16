#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { validatePackageEntrySource } from "./lib/package-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = path.resolve(here, "..");

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function add(findings, severity, code, message, data = {}) {
  findings.push({ severity, code, message, ...data });
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function normalizedResourcePath(value) {
  return typeof value === "string" ? value.replace(/^\.\//, "").replace(/\/$/, "") : value;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function exactVersion(value) {
  return typeof value === "string" && semver.valid(value, { loose: false }) === value;
}

function profileRecord(file, document) {
  return { file, document };
}

export function loadGovernance(rootDir = defaultRoot) {
  const root = path.resolve(rootDir);
  const profilesRoot = path.join(root, "profiles");
  const profiles = fs
    .readdirSync(profilesRoot)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => profileRecord(path.join(profilesRoot, file), readJson(path.join(profilesRoot, file))));

  return {
    root,
    inventory: readJson(path.join(root, "inventory", "packages.lock.json")),
    resources: readJson(path.join(root, "inventory", "resources.lock.json")),
    capabilities: readJson(path.join(root, "policies", "capabilities.v1.json")),
    owners: readJson(path.join(root, "policies", "owners.v1.json")),
    commandOwners: readJson(path.join(root, "policies", "command-owners.v1.json")),
    enforcement: readJson(path.join(root, "policies", "enforcement-surfaces.v1.json")),
    profiles,
    packageManifest: readJson(path.join(root, "package.json")),
  };
}

function checkDocumentVersion(findings, name, document) {
  if (document?.formatVersion !== 1) {
    add(findings, "error", "unsupported-format-version", `${name} must use formatVersion 1.`, { document: name });
  }
}

function checkUniqueStrings(findings, values, label, data = {}) {
  for (const value of duplicateValues(asArray(values))) {
    add(findings, "error", "duplicate-reference", `${label} contains duplicate reference ${value}.`, {
      reference: value,
      ...data,
    });
  }
}

function contractTestExists(root, testId) {
  if (typeof testId !== "string" || testId.length === 0) return false;
  const candidates = testId.includes("/") || testId.endsWith(".mjs")
    ? [path.resolve(root, testId)]
    : [path.join(root, "tests", `${testId}.test.mjs`)];
  return candidates.some((candidate) => isInside(root, candidate) && fs.existsSync(candidate));
}

function checkPackageTopology(findings, root, manifest) {
  const hostPackage = "@earendil-works/pi-coding-agent";
  if (manifest?.peerDependencies?.[hostPackage] !== "*") {
    add(findings, "error", "host-peer-topology", `${hostPackage} must be a wildcard peer dependency.`);
  }
  if (!exactVersion(manifest?.devDependencies?.[hostPackage])) {
    add(findings, "error", "host-dev-topology", `${hostPackage} must also be an exact dev dependency for CI and typecheck.`);
  }
  if (manifest?.dependencies?.[hostPackage] !== undefined) {
    add(findings, "error", "host-runtime-duplication", `${hostPackage} must not be bundled as a direct runtime dependency.`);
  }

  for (const dependency of ["ajv", "ajv-formats", "semver", "ssri"]) {
    if (!exactVersion(manifest?.dependencies?.[dependency])) {
      add(findings, "error", "missing-exact-direct-dependency", `${dependency} must be an explicit exact runtime dependency.`, {
        dependency,
      });
    }
  }
  if (!exactVersion(manifest?.devDependencies?.typescript)) {
    add(findings, "error", "missing-exact-dev-dependency", "typescript must be an explicit exact dev dependency.", {
      dependency: "typescript",
    });
  }

  for (const [section, dependencies] of [
    ["dependencies", manifest?.dependencies],
    ["devDependencies", manifest?.devDependencies],
  ]) {
    for (const [dependency, version] of Object.entries(dependencies ?? {})) {
      if (!exactVersion(version)) {
        add(findings, "error", "non-exact-manifest-dependency", `${section}.${dependency} is not exact: ${version}.`, {
          dependency,
          section,
        });
      }
    }
  }

  if (!fs.existsSync(path.join(root, "package-lock.json"))) {
    add(findings, "error", "missing-lockfile", "package-lock.json is required for reproducible installs.");
  }
}

function checkManifestResources(findings, manifest, resources) {
  const typeByManifestKey = {
    extensions: "extension",
    skills: "skill",
    prompts: "prompt",
    themes: "theme",
  };
  const resourcesByPath = new Map(
    resources.map((resource) => [`${resource.type}:${normalizedResourcePath(resource.path)}`, resource]),
  );

  for (const [manifestKey, resourceType] of Object.entries(typeByManifestKey)) {
    const manifestPaths = asArray(manifest?.pi?.[manifestKey]).map(normalizedResourcePath);
    for (const resourcePath of manifestPaths) {
      const resource = resourcesByPath.get(`${resourceType}:${resourcePath}`);
      if (!resource) {
        add(findings, "error", "untracked-manifest-resource", `package.json#pi.${manifestKey} is not in resources.lock.json: ${resourcePath}.`, {
          path: resourcePath,
        });
      } else if (resource.defaultLoaded !== true) {
        add(findings, "error", "manifest-resource-not-default", `Manifest resource ${resource.id} must be marked defaultLoaded.`, {
          resourceId: resource.id,
        });
      }
    }

    const manifestSet = new Set(manifestPaths);
    for (const resource of resources) {
      if (resource.type !== resourceType || resource.defaultLoaded !== true) continue;
      if (!manifestSet.has(normalizedResourcePath(resource.path))) {
        add(findings, "error", "default-resource-not-manifested", `Default resource ${resource.id} is absent from package.json#pi.${manifestKey}.`, {
          resourceId: resource.id,
        });
      }
    }
  }
}

function checkPackagedResource(findings, manifest, resource) {
  if (resource.packaged !== true) return;
  const resourcePath = normalizedResourcePath(resource.path);
  const covered = asArray(manifest?.files).some((entry) => {
    const fileEntry = normalizedResourcePath(entry);
    return resourcePath === fileEntry || resourcePath.startsWith(`${fileEntry}/`);
  });
  if (!covered) {
    add(findings, "error", "resource-not-packaged", `Resource ${resource.id} is marked packaged but excluded by package.json#files.`, {
      resourceId: resource.id,
    });
  }
}

function checkOwnedResourceSubpaths(findings, root, resource) {
  if (!["mode", "agent", "workflow", "swarm-recipe"].includes(resource.type)) return;
  const resourcePath = path.resolve(root, resource.path);
  if (!fs.existsSync(resourcePath) || path.extname(resourcePath) !== ".json") return;

  let document;
  try {
    document = readJson(resourcePath);
  } catch (error) {
    add(findings, "error", "invalid-resource-document", `Resource ${resource.id} is not valid JSON: ${error.message}`, {
      resourceId: resource.id,
    });
    return;
  }

  if (resource.lifecycle === "planned" && document.contractStatus !== "contract-only") {
    add(findings, "error", "planned-resource-runtime-claim", `Planned resource ${resource.id} must declare contractStatus contract-only.`, {
      resourceId: resource.id,
    });
  }
  if (document.version !== resource.version) {
    add(findings, "error", "resource-version-mismatch", `Resource ${resource.id} version differs from its canonical document.`, {
      resourceId: resource.id,
    });
  }

  if (typeof document.prompt?.file === "string") {
    const promptPath = path.resolve(root, document.prompt.file);
    if (!isInside(root, promptPath) || !fs.existsSync(promptPath)) {
      add(findings, "error", "missing-owned-prompt", `Resource ${resource.id} references a missing or escaping prompt file.`, {
        resourceId: resource.id,
      });
    }
  }
  if (resource.type === "agent" && typeof document.upstreamAgentId === "string") {
    const generated = path.join(root, "agents", "generated", `${document.upstreamAgentId}.md`);
    if (!fs.existsSync(generated)) {
      add(findings, "error", "missing-generated-agent", `Logical agent ${resource.id} is missing generated upstream resource ${document.upstreamAgentId}.`, {
        resourceId: resource.id,
      });
    }
  }
}

function requiredCommand(findings, commandsById, id, surface, owner) {
  const command = commandsById.get(id);
  if (!command || command.surface !== surface || command.owner !== owner) {
    add(findings, "error", "required-command-owner", `${id} must be owned by ${owner} on ${surface}.`, {
      commandId: id,
    });
  }
}

function auditProfile({
  findings,
  profile,
  file,
  promotedById,
  candidateById,
  ownerById,
  capabilityById,
  resources,
}) {
  const profileId = profile?.id ?? "<unknown>";
  const data = { profile: profileId, file };
  const packageIds = asArray(profile?.packageIds);
  const candidateIds = asArray(profile?.candidatePackageIds);
  const capabilityIds = asArray(profile?.capabilityIds);

  checkUniqueStrings(findings, packageIds, `Profile ${profileId} packageIds`, data);
  checkUniqueStrings(findings, candidateIds, `Profile ${profileId} candidatePackageIds`, data);
  checkUniqueStrings(findings, capabilityIds, `Profile ${profileId} capabilityIds`, data);

  const selectedOwners = new Map();
  for (const packageId of packageIds) {
    const entry = promotedById.get(packageId);
    if (!entry) {
      add(findings, "error", "unknown-or-unpromoted-package", `Profile ${profileId} selects unknown or unpromoted package ${packageId}.`, {
        packageId,
        ...data,
      });
      continue;
    }
    for (const ownerId of asArray(entry.owners)) {
      const owner = ownerById.get(ownerId);
      if (owner?.exclusive !== true) continue;
      const previous = selectedOwners.get(ownerId);
      if (previous && previous !== packageId) {
        add(findings, "error", "exclusive-owner-conflict", `Profile ${profileId} selects ${previous} and ${packageId} for exclusive owner ${ownerId}.`, {
          owner: ownerId,
          ...data,
        });
      }
      selectedOwners.set(ownerId, packageId);
    }
  }

  for (const candidateId of candidateIds) {
    const entry = candidateById.get(candidateId);
    if (!entry) {
      add(findings, "error", "unknown-candidate", `Profile ${profileId} references unknown candidate ${candidateId}.`, {
        candidateId,
        ...data,
      });
    } else if (entry.mode === "blocked") {
      add(findings, "warning", "blocked-candidate", `Profile ${profileId} keeps blocked candidate ${candidateId} explicit and inactive.`, {
        candidateId,
        ...data,
      });
    }
    if (packageIds.includes(candidateId)) {
      add(findings, "error", "candidate-activated", `Profile ${profileId} lists ${candidateId} as both active and candidate.`, {
        candidateId,
        ...data,
      });
    }
  }

  const activeProviders = new Set(["pi-host-runtime", ...packageIds.filter((id) => promotedById.has(id))]);
  for (const resource of resources) {
    if (resource.defaultLoaded === true && asArray(resource.profileEligibility).includes(profileId)) {
      activeProviders.add(resource.id);
    }
  }

  const declaredCapabilities = new Set(capabilityIds);
  const expectedCapabilities = new Set();
  for (const capability of capabilityById.values()) {
    if (asArray(capability.providedBy).some((provider) => activeProviders.has(provider))) {
      expectedCapabilities.add(capability.id);
    }
  }

  for (const capabilityId of declaredCapabilities) {
    const capability = capabilityById.get(capabilityId);
    if (!capability) {
      add(findings, "error", "unknown-capability", `Profile ${profileId} declares unknown capability ${capabilityId}.`, {
        capabilityId,
        ...data,
      });
      continue;
    }
    if (!asArray(capability.providedBy).some((provider) => activeProviders.has(provider))) {
      add(findings, "error", "inactive-capability-provider", `Profile ${profileId} declares ${capabilityId} without an active provider.`, {
        capabilityId,
        ...data,
      });
    }
    for (const requirement of asArray(capability.requires)) {
      if (!declaredCapabilities.has(requirement)) {
        add(findings, "error", "missing-capability-requirement", `Profile ${profileId} capability ${capabilityId} requires ${requirement}.`, {
          capabilityId,
          requirement,
          ...data,
        });
      }
    }
    for (const conflict of asArray(capability.conflictsWith)) {
      if (declaredCapabilities.has(conflict)) {
        add(findings, "error", "capability-conflict", `Profile ${profileId} combines conflicting capabilities ${capabilityId} and ${conflict}.`, {
          capabilityId,
          conflict,
          ...data,
        });
      }
    }
  }
  for (const capabilityId of expectedCapabilities) {
    if (!declaredCapabilities.has(capabilityId)) {
      add(findings, "error", "missing-profile-capability", `Profile ${profileId} activates a provider for ${capabilityId} but omits it from its ceiling.`, {
        capabilityId,
        ...data,
      });
    }
  }

  const subagentsSelected = packageIds.includes("subagents") && declaredCapabilities.has("subagent-runtime");
  const subagentsEnabled = profile?.policy?.subagents?.enabled === true;
  if (subagentsSelected !== subagentsEnabled) {
    add(findings, "error", "policy-package-mismatch", `Profile ${profileId} subagent policy does not match its package and capability selection.`, {
      policy: "subagents",
      ...data,
    });
  }

  const webSelected = packageIds.includes("web-access") && declaredCapabilities.has("web-access");
  if (webSelected !== (profile?.policy?.network === "allow-listed-only")) {
    add(findings, "error", "policy-package-mismatch", `Profile ${profileId} web package selection must exactly match allow-listed-only network policy.`, {
      policy: "network",
      ...data,
    });
  }
  if (asArray(profile?.policy?.tools).includes("web") && !webSelected) {
    add(findings, "error", "policy-package-mismatch", `Profile ${profileId} exposes the web tool without the web capability.`, {
      policy: "tools",
      ...data,
    });
  }

  const memorySelected = packageIds.includes("memory") && declaredCapabilities.has("memory");
  const memoryOwner = profile?.policy?.memory?.owner;
  if (memorySelected !== (memoryOwner === "memory")) {
    add(findings, "error", "policy-package-mismatch", `Profile ${profileId} memory owner does not match its package and capability selection.`, {
      policy: "memory",
      ...data,
    });
  }

  const mcpEnabled = profile?.policy?.mcp?.enabled === true;
  const mcpSelected = packageIds.includes("mcp-adapter") && declaredCapabilities.has("mcp");
  if (mcpEnabled !== mcpSelected) {
    add(findings, "error", "policy-package-mismatch", `Profile ${profileId} MCP policy does not match an active MCP provider.`, {
      policy: "mcp",
      ...data,
    });
  }

  if (profile?.policy?.requiresDisposableWorkspace === true && profile?.policy?.requiresOsSandbox !== true) {
    add(findings, "error", "sandbox-policy", `Profile ${profileId} requires a disposable workspace but not an OS sandbox.`, data);
  }

  return {
    id: profileId,
    packages: packageIds.length,
    candidates: candidateIds.length,
    capabilities: capabilityIds.length,
    activeProviders: [...activeProviders].sort(),
  };
}

/**
 * Audit static M1 declarations. This performs no install, network request,
 * credential read, Pi-home access, or live Provider/runtime probe.
 */
export function auditPackageGovernance(governance, { strict = false, profileIds } = {}) {
  const root = path.resolve(governance.root ?? defaultRoot);
  const findings = [];
  const inventory = governance.inventory ?? {};
  const resourcesDocument = governance.resources ?? {};
  const capabilityDocument = governance.capabilities ?? {};
  const ownerDocument = governance.owners ?? {};
  const commandDocument = governance.commandOwners ?? {};
  const enforcementDocument = governance.enforcement ?? {};
  const manifest = governance.packageManifest ?? {};

  for (const [name, document] of [
    ["package inventory", inventory],
    ["resource inventory", resourcesDocument],
    ["capability catalog", capabilityDocument],
    ["owner catalog", ownerDocument],
    ["command owner catalog", commandDocument],
    ["enforcement surface catalog", enforcementDocument],
  ]) {
    checkDocumentVersion(findings, name, document);
  }
  checkPackageTopology(findings, root, manifest);

  const promoted = asArray(inventory.packages);
  const candidates = asArray(inventory.candidates);
  const allEntries = [...promoted, ...candidates];
  const promotedById = new Map();
  const candidateById = new Map();
  const entryById = new Map();

  for (const [entries, target, promotedEntry] of [
    [promoted, promotedById, true],
    [candidates, candidateById, false],
  ]) {
    for (const entry of entries) {
      if (typeof entry?.id !== "string" || typeof entry?.spec !== "string") {
        add(findings, "error", "entry-shape", "Every package entry requires string id and spec fields.");
        continue;
      }
      if (entryById.has(entry.id)) {
        add(findings, "error", "duplicate-package-id", `Duplicate package id ${entry.id}.`, { packageId: entry.id });
      } else {
        entryById.set(entry.id, entry);
        target.set(entry.id, entry);
      }
      try {
        validatePackageEntrySource(entry, { promoted: promotedEntry });
      } catch (error) {
        add(findings, "error", "invalid-package-source", error.message, { packageId: entry.id });
      }
      if (inventory.policy?.allowOldMarioScope === false && entry.spec.includes("@mariozechner/")) {
        add(findings, "error", "old-scope", `Old @mariozechner scope is blocked: ${entry.spec}.`, {
          packageId: entry.id,
        });
      }
      if (promotedEntry && (entry.installed !== true || typeof entry.review !== "string")) {
        add(findings, "error", "invalid-promotion-state", `Promoted package ${entry.id} must be installed and reviewed.`, {
          packageId: entry.id,
        });
      }
      checkUniqueStrings(findings, entry.owners, `Package ${entry.id} owners`, { packageId: entry.id });
    }
  }

  const profileRecords = asArray(governance.profiles).map((record, index) => {
    if (record?.document) return record;
    return profileRecord(record?.file ?? `<profile-${index}>`, record);
  });
  const profileById = new Map();
  for (const record of profileRecords) {
    const profileId = record.document?.id;
    if (typeof profileId !== "string") {
      add(findings, "error", "profile-shape", `Profile ${record.file} has no string id.`, { file: record.file });
      continue;
    }
    if (profileById.has(profileId)) {
      add(findings, "error", "duplicate-profile-id", `Duplicate profile id ${profileId}.`, { profile: profileId });
    } else {
      profileById.set(profileId, record);
    }
    checkDocumentVersion(findings, `profile ${profileId}`, record.document);
  }

  const resources = asArray(resourcesDocument.resources);
  const resourceById = new Map();
  for (const resource of resources) {
    if (resourceById.has(resource.id)) {
      add(findings, "error", "duplicate-resource-id", `Duplicate first-party resource id ${resource.id}.`, {
        resourceId: resource.id,
      });
      continue;
    }
    resourceById.set(resource.id, resource);
    const absolute = path.resolve(root, resource.path ?? "");
    if (!isInside(root, absolute) || !fs.existsSync(absolute)) {
      add(findings, "error", "invalid-resource-path", `Resource ${resource.id} path is missing or escapes the repository.`, {
        resourceId: resource.id,
      });
    } else {
      const real = fs.realpathSync(absolute);
      if (!isInside(fs.realpathSync(root), real)) {
        add(findings, "error", "resource-symlink-escape", `Resource ${resource.id} resolves outside the repository.`, {
          resourceId: resource.id,
        });
      }
    }
    checkPackagedResource(findings, manifest, resource);
    checkOwnedResourceSubpaths(findings, root, resource);
    checkUniqueStrings(findings, resource.provides, `Resource ${resource.id} provides`, { resourceId: resource.id });
    checkUniqueStrings(findings, resource.owners, `Resource ${resource.id} owners`, { resourceId: resource.id });
    for (const profileId of asArray(resource.profileEligibility)) {
      if (!profileById.has(profileId)) {
        add(findings, "error", "unknown-resource-profile", `Resource ${resource.id} references unknown profile ${profileId}.`, {
          resourceId: resource.id,
          profile: profileId,
        });
      }
    }
  }
  checkManifestResources(findings, manifest, resources);

  const surfaces = asArray(enforcementDocument.surfaces);
  const surfaceById = new Map();
  const requiredStates = ["active", "degraded", "unavailable", "unknown"];
  for (const surface of surfaces) {
    if (surfaceById.has(surface.id)) {
      add(findings, "error", "duplicate-enforcement-surface", `Duplicate enforcement surface ${surface.id}.`, {
        surfaceId: surface.id,
      });
      continue;
    }
    surfaceById.set(surface.id, surface);
    for (const state of requiredStates) {
      if (!asArray(surface.observableStates).includes(state)) {
        add(findings, "error", "missing-observable-state", `Surface ${surface.id} omits required state ${state}.`, {
          surfaceId: surface.id,
          state,
        });
      }
    }
    if (surface.failClosed !== true) {
      add(findings, "error", "surface-not-fail-closed", `Surface ${surface.id} must fail closed.`, { surfaceId: surface.id });
    }
    for (const testId of asArray(surface.contractTests)) {
      if (!contractTestExists(root, testId)) {
        add(findings, "error", "missing-contract-test", `Surface ${surface.id} references missing contract test ${testId}.`, {
          surfaceId: surface.id,
          testId,
        });
      }
    }
  }

  const capabilities = asArray(capabilityDocument.capabilities);
  const capabilityById = new Map();
  const providerIds = new Set(["pi-host-runtime", ...entryById.keys(), ...resourceById.keys()]);
  for (const capability of capabilities) {
    if (capabilityById.has(capability.id)) {
      add(findings, "error", "duplicate-capability-id", `Duplicate capability id ${capability.id}.`, {
        capabilityId: capability.id,
      });
      continue;
    }
    capabilityById.set(capability.id, capability);
    if (asArray(capability.providedBy).length === 0) {
      add(findings, "error", "missing-capability-provider", `Capability ${capability.id} has no provider.`, {
        capabilityId: capability.id,
      });
    }
    for (const provider of asArray(capability.providedBy)) {
      if (!providerIds.has(provider)) {
        add(findings, "error", "unknown-capability-provider", `Capability ${capability.id} references unknown provider ${provider}.`, {
          capabilityId: capability.id,
          provider,
        });
      }
    }
    for (const surfaceId of asArray(capability.surfaces)) {
      if (!surfaceById.has(surfaceId)) {
        add(findings, "error", "unknown-capability-surface", `Capability ${capability.id} references unknown surface ${surfaceId}.`, {
          capabilityId: capability.id,
          surfaceId,
        });
      }
    }
  }
  for (const capability of capabilities) {
    for (const reference of [...asArray(capability.requires), ...asArray(capability.conflictsWith)]) {
      if (!capabilityById.has(reference)) {
        add(findings, "error", "unknown-capability-reference", `Capability ${capability.id} references unknown capability ${reference}.`, {
          capabilityId: capability.id,
          reference,
        });
      }
    }
  }

  const owners = asArray(ownerDocument.owners);
  const ownerById = new Map();
  const capabilityOwners = new Map();
  const surfaceOwners = new Map();
  for (const owner of owners) {
    if (ownerById.has(owner.id)) {
      add(findings, "error", "duplicate-owner-id", `Duplicate owner id ${owner.id}.`, { owner: owner.id });
      continue;
    }
    ownerById.set(owner.id, owner);
    for (const capabilityId of asArray(owner.capabilities)) {
      if (!capabilityById.has(capabilityId)) {
        add(findings, "error", "unknown-owner-capability", `Owner ${owner.id} references unknown capability ${capabilityId}.`, {
          owner: owner.id,
          capabilityId,
        });
      }
      const assignments = capabilityOwners.get(capabilityId) ?? [];
      assignments.push(owner.id);
      capabilityOwners.set(capabilityId, assignments);
    }
    for (const surfaceId of asArray(owner.surfaces)) {
      if (!surfaceById.has(surfaceId)) {
        add(findings, "error", "unknown-owner-surface", `Owner ${owner.id} references unknown surface ${surfaceId}.`, {
          owner: owner.id,
          surfaceId,
        });
      }
      const assignments = surfaceOwners.get(surfaceId) ?? [];
      assignments.push(owner.id);
      surfaceOwners.set(surfaceId, assignments);
    }
    for (const resourceId of asArray(owner.resourceIds)) {
      const resource = resourceById.get(resourceId);
      if (!resource) {
        add(findings, "error", "unknown-owner-resource", `Owner ${owner.id} references unknown resource ${resourceId}.`, {
          owner: owner.id,
          resourceId,
        });
      } else if (!asArray(resource.owners).includes(owner.id)) {
        add(findings, "error", "owner-resource-mismatch", `Owner ${owner.id} claims ${resourceId}, but the resource does not name that owner.`, {
          owner: owner.id,
          resourceId,
        });
      }
    }
  }

  for (const capability of capabilities) {
    const assignments = capabilityOwners.get(capability.id) ?? [];
    if (assignments.length !== 1) {
      add(findings, "error", assignments.length === 0 ? "missing-capability-owner" : "duplicate-capability-owner", `Capability ${capability.id} must have exactly one owner; found ${assignments.join(", ") || "none"}.`, {
        capabilityId: capability.id,
        owners: assignments,
      });
    }
  }
  for (const surface of surfaces) {
    const assignments = surfaceOwners.get(surface.id) ?? [];
    if (assignments.length !== 1) {
      add(findings, "error", assignments.length === 0 ? "missing-surface-owner" : "duplicate-surface-owner", `Surface ${surface.id} must have exactly one catalog owner.`, {
        surfaceId: surface.id,
        owners: assignments,
      });
    }
    if (surface.owner === "none" || surface.owner === "unknown" || !ownerById.has(surface.owner)) {
      add(findings, "error", "unowned-enforcement-surface", `Surface ${surface.id} has no concrete registered owner.`, {
        surfaceId: surface.id,
      });
    } else if (assignments.length === 1 && assignments[0] !== surface.owner) {
      add(findings, "error", "surface-owner-mismatch", `Surface ${surface.id} document owner ${surface.owner} disagrees with owner catalog ${assignments[0]}.`, {
        surfaceId: surface.id,
      });
    }
  }

  for (const entry of allEntries) {
    for (const ownerId of asArray(entry.owners)) {
      if (!ownerById.has(ownerId)) {
        add(findings, "error", "unknown-package-owner", `Package ${entry.id} references unknown owner ${ownerId}.`, {
          packageId: entry.id,
          owner: ownerId,
        });
      }
    }
  }
  for (const resource of resources) {
    for (const ownerId of asArray(resource.owners)) {
      if (!ownerById.has(ownerId)) {
        add(findings, "error", "unknown-resource-owner", `Resource ${resource.id} references unknown owner ${ownerId}.`, {
          resourceId: resource.id,
          owner: ownerId,
        });
      }
    }
    for (const capabilityId of [...asArray(resource.provides), ...asArray(resource.requires)]) {
      if (!capabilityById.has(capabilityId)) {
        add(findings, "error", "unknown-resource-capability", `Resource ${resource.id} references unknown capability ${capabilityId}.`, {
          resourceId: resource.id,
          capabilityId,
        });
      }
    }
    for (const capabilityId of asArray(resource.provides)) {
      const capability = capabilityById.get(capabilityId);
      if (capability && !asArray(capability.providedBy).includes(resource.id)) {
        add(findings, "error", "resource-provider-mismatch", `Resource ${resource.id} provides ${capabilityId}, but the capability catalog omits that provider.`, {
          resourceId: resource.id,
          capabilityId,
        });
      }
    }
    for (const surfaceId of asArray(resource.egressSurfaces)) {
      if (!surfaceById.has(surfaceId)) {
        add(findings, "error", "unknown-resource-surface", `Resource ${resource.id} references unknown egress surface ${surfaceId}.`, {
          resourceId: resource.id,
          surfaceId,
        });
      }
    }
  }

  for (const capability of capabilities) {
    const ownerId = (capabilityOwners.get(capability.id) ?? [])[0];
    if (!ownerId) continue;
    for (const providerId of asArray(capability.providedBy)) {
      if (providerId === "pi-host-runtime") {
        if (ownerId !== providerId) {
          add(findings, "error", "provider-owner-mismatch", `Pi host capability ${capability.id} must be owned by pi-host-runtime.`, {
            capabilityId: capability.id,
          });
        }
        continue;
      }
      const provider = entryById.get(providerId) ?? resourceById.get(providerId);
      if (provider && !asArray(provider.owners).includes(ownerId)) {
        add(findings, "error", "provider-owner-mismatch", `Provider ${providerId} does not name capability owner ${ownerId} for ${capability.id}.`, {
          provider: providerId,
          owner: ownerId,
          capabilityId: capability.id,
        });
      }
    }
  }

  const commands = asArray(commandDocument.commands);
  const commandsById = new Map();
  const claimedNames = new Map();
  for (const command of commands) {
    if (commandsById.has(command.id)) {
      add(findings, "error", "duplicate-command-id", `Duplicate command id ${command.id}.`, { commandId: command.id });
    } else {
      commandsById.set(command.id, command);
    }
    if (!ownerById.has(command.owner)) {
      add(findings, "error", "unknown-command-owner", `Command ${command.id} references unknown owner ${command.owner}.`, {
        commandId: command.id,
        owner: command.owner,
      });
    }
    for (const name of [command.id, ...asArray(command.aliases)]) {
      const key = `${command.surface}:${name}`;
      const previous = claimedNames.get(key);
      if (previous) {
        add(findings, "error", "duplicate-command-name", `${command.surface} name ${name} is claimed by ${previous} and ${command.id}.`, {
          commandId: command.id,
          name,
          surface: command.surface,
        });
      } else {
        claimedNames.set(key, command.id);
      }
    }
    if (command.status === "implemented") {
      const implementation = path.resolve(root, command.implementedBy ?? "");
      if (!command.implementedBy || !isInside(root, implementation) || !fs.existsSync(implementation)) {
        add(findings, "error", "missing-command-implementation", `Implemented command ${command.id} has no valid implementation path.`, {
          commandId: command.id,
        });
      }
    }
  }
  requiredCommand(findings, commandsById, "omp", "cli", "only-my-pi-control");
  requiredCommand(findings, commandsById, "/omp", "pi-command", "only-my-pi-control");
  requiredCommand(findings, commandsById, "subagent", "pi-tool", "subagents");

  const commandsReferencedByResources = new Set();
  for (const resource of resources) {
    for (const commandId of asArray(resource.commands)) {
      commandsReferencedByResources.add(commandId);
      if (!commandsById.has(commandId)) {
        add(findings, "error", "unknown-resource-command", `Resource ${resource.id} references unknown command ${commandId}.`, {
          resourceId: resource.id,
          commandId,
        });
      }
    }
  }
  for (const command of commands) {
    if (command.status === "implemented" && !commandsReferencedByResources.has(command.id)) {
      add(findings, "error", "untracked-command-implementation", `Implemented command ${command.id} is not attributed to a first-party resource.`, {
        commandId: command.id,
      });
    }
  }

  for (const resource of resources) {
    for (const profileId of asArray(resource.profileEligibility)) {
      const profile = profileById.get(profileId)?.document;
      if (!profile) continue;
      for (const requirement of asArray(resource.requires)) {
        if (!asArray(profile.capabilityIds).includes(requirement)) {
          add(findings, "error", "resource-profile-capability-mismatch", `Resource ${resource.id} is eligible for ${profileId}, which lacks required capability ${requirement}.`, {
            resourceId: resource.id,
            profile: profileId,
            capabilityId: requirement,
          });
        }
      }
    }
  }

  const selectedProfileIds = profileIds === undefined ? null : new Set(profileIds);
  const profileSummaries = [];
  for (const [profileId, record] of profileById) {
    if (selectedProfileIds && !selectedProfileIds.has(profileId)) continue;
    profileSummaries.push(auditProfile({
      findings,
      profile: record.document,
      file: path.relative(root, record.file),
      promotedById,
      candidateById,
      ownerById,
      capabilityById,
      resources,
    }));
  }
  if (selectedProfileIds) {
    for (const profileId of selectedProfileIds) {
      if (!profileById.has(profileId)) {
        add(findings, "error", "unknown-profile-selection", `Requested profile ${profileId} is not in the governance set.`, {
          profile: profileId,
        });
      }
    }
  }

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  return {
    ok: errors === 0 && (!strict || warnings === 0),
    scope: "static-declarations-only",
    runtimeEvidence: "not-evaluated",
    errors,
    warnings,
    findings,
    profiles: profileSummaries,
    counts: {
      promotedPackages: promoted.length,
      candidatePackages: candidates.length,
      resources: resources.length,
      capabilities: capabilities.length,
      owners: owners.length,
      commands: commands.length,
      enforcementSurfaces: surfaces.length,
    },
  };
}

export function parseArgs(argv) {
  const args = { json: false, strict: false, profile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--profile") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("--profile requires a JSON file");
      args.profile = value;
    } else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printHelp() {
  console.log(
    `Usage: node scripts/package-doctor.mjs [options]\n\n` +
      `  --profile <file>  validate one profile; the default validates all profiles\n` +
      `  --strict          return non-zero on warnings\n` +
      `  --json            print machine-readable findings\n` +
      `  --help            show this help`,
  );
}

export function main(argv = process.argv.slice(2), rootDir = defaultRoot) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const governance = loadGovernance(rootDir);
  let profileIds;
  if (args.profile) {
    const profilePath = path.resolve(process.cwd(), args.profile);
    const profile = readJson(profilePath);
    const existing = governance.profiles.find((record) => path.resolve(record.file) === profilePath);
    if (!existing) governance.profiles.push(profileRecord(profilePath, profile));
    profileIds = [profile.id];
  }
  const result = auditPackageGovernance(governance, { strict: args.strict, profileIds });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`package-doctor: ${result.ok ? "PASS" : "FAIL"} (${result.errors} errors, ${result.warnings} warnings)`);
    console.log(`scope: ${result.scope}; live runtime evidence: ${result.runtimeEvidence}`);
    for (const item of result.findings) {
      console.log(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    }
  }
  return result.ok ? 0 : 1;
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`package-doctor: ERROR ${error.message}`);
    process.exitCode = 1;
  }
}
