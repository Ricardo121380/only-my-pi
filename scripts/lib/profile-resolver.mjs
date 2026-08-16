import fs from "node:fs";
import path from "node:path";

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function packageSetting(entry) {
  if (!entry.resourceFilter) return entry.spec;
  return {
    source: entry.spec,
    extensions: [...entry.resourceFilter],
    skills: [],
    prompts: [],
    themes: [],
  };
}

function assertProfileShape(profile) {
  if (profile.formatVersion !== 1) {
    throw new Error(`Unsupported profile format: ${profile.formatVersion}`);
  }
  if (typeof profile.id !== "string" || profile.id.length === 0) {
    throw new Error("Profile id must be a non-empty string.");
  }
  if (!Array.isArray(profile.packageIds)) {
    throw new Error(`Profile ${profile.id} must contain packageIds.`);
  }
  if (!Array.isArray(profile.capabilityIds)) {
    throw new Error(`Profile ${profile.id} must contain capabilityIds.`);
  }
  if (profile.policy === null || typeof profile.policy !== "object" || Array.isArray(profile.policy)) {
    throw new Error(`Profile ${profile.id} must contain a policy object.`);
  }
}

export function resolveProfileData(inventory, profile) {
  assertProfileShape(profile);
  if (inventory.formatVersion !== 1) {
    throw new Error(`Unsupported inventory format: ${inventory.formatVersion}`);
  }

  const entries = [...(inventory.packages ?? []), ...(inventory.candidates ?? [])];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const selectedPackages = [];
  const seen = new Set();

  for (const id of profile.packageIds) {
    if (seen.has(id)) throw new Error(`Profile ${profile.id} selects ${id} more than once.`);
    seen.add(id);
    const entry = byId.get(id);
    if (!entry) throw new Error(`Profile ${profile.id} selects unknown package ${id}.`);
    if (entry.mode === "blocked" || entry.installed === false) {
      throw new Error(`Profile ${profile.id} selects unavailable package ${id}.`);
    }
    if (entry.installed !== true) {
      throw new Error(`Profile ${profile.id} selects non-promoted candidate ${id}.`);
    }
    selectedPackages.push({
      id: entry.id,
      spec: entry.spec,
      scope: entry.scope,
      review: entry.review,
      owners: [...(entry.owners ?? [])],
      risk: [...(entry.risk ?? [])],
      setting: packageSetting(entry),
    });
  }

  const candidates = (profile.candidatePackageIds ?? []).map((id) => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Profile ${profile.id} references unknown candidate ${id}.`);
    return {
      id: entry.id,
      spec: entry.spec,
      mode: entry.mode ?? "candidate",
      risk: [...(entry.risk ?? [])],
    };
  });

  return {
    formatVersion: 1,
    profile: {
      id: profile.id,
      description: profile.description ?? "",
      sourceFormatVersion: profile.formatVersion,
      capabilityIds: [...profile.capabilityIds],
    },
    runtime: clone(inventory.runtime ?? {}),
    policy: clone(profile.policy),
    packages: selectedPackages,
    capabilities: profile.capabilityIds.map((id) => ({ id, state: "CONFIGURED_UNVERIFIED" })),
    candidates,
    piSettings: {
      packages: selectedPackages.map((entry) => clone(entry.setting)),
    },
  };
}

export function resolveProfileFile(root, profileFile) {
  const inventory = readJson(path.join(root, "inventory", "packages.lock.json"));
  const profilePath = path.resolve(root, profileFile);
  return resolveProfileData(inventory, readJson(profilePath));
}

function normalized(value) {
  if (Array.isArray(value)) return value.map((entry) => normalized(entry));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalized(value[key])]),
    );
  }
  return value;
}

function stable(value) {
  return JSON.stringify(normalized(value));
}

function flatten(value, prefix = "", output = new Map()) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    output.set(prefix, value);
    return output;
  }
  const keys = Object.keys(value).sort();
  if (keys.length === 0) output.set(prefix, value);
  for (const key of keys) {
    flatten(value[key], prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

export function diffResolved(from, to) {
  const fromPackages = new Map(from.packages.map((entry) => [entry.id, entry]));
  const toPackages = new Map(to.packages.map((entry) => [entry.id, entry]));
  const added = [...toPackages.keys()].filter((id) => !fromPackages.has(id)).sort();
  const removed = [...fromPackages.keys()].filter((id) => !toPackages.has(id)).sort();
  const changed = [...toPackages.keys()]
    .filter((id) => fromPackages.has(id) && stable(fromPackages.get(id)) !== stable(toPackages.get(id)))
    .sort();

  const fromCapabilities = new Set(from.capabilities.map((entry) => entry.id));
  const toCapabilities = new Set(to.capabilities.map((entry) => entry.id));
  const capabilityChanges = {
    added: [...toCapabilities].filter((id) => !fromCapabilities.has(id)).sort(),
    removed: [...fromCapabilities].filter((id) => !toCapabilities.has(id)).sort(),
  };

  const left = flatten(from.policy);
  const right = flatten(to.policy);
  const paths = new Set([...left.keys(), ...right.keys()]);
  const policy = [...paths]
    .sort()
    .filter((key) => stable(left.get(key)) !== stable(right.get(key)))
    .map((key) => ({ path: key, from: left.get(key), to: right.get(key) }));

  return {
    formatVersion: 1,
    from: from.profile.id,
    to: to.profile.id,
    packages: { added, removed, changed },
    capabilities: capabilityChanges,
    policy,
  };
}
