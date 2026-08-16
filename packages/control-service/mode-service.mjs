import fs from "node:fs/promises";
import path from "node:path";

const MODE_ID = /^(?:[a-z][a-z0-9-]{0,63}|(?:user|project|package):[a-z][a-z0-9-]{0,63}|[a-z][a-z0-9-]{0,63}\/[a-z][a-z0-9-]{0,63})$/u;

function error(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details });
}

function assertModeId(value) {
  if (typeof value !== "string" || !MODE_ID.test(value)) throw error("INVALID_MODE_ID", "mode id is not canonical");
  return value;
}

function normalizeMode(entry) {
  if (typeof entry === "string") return { id: entry };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = typeof entry.id === "string" ? entry.id : typeof entry.key === "string" ? entry.key : typeof entry.rawId === "string" ? entry.rawId : null;
  return id ? { ...entry, id } : null;
}

async function call(registry, names, ...args) {
  for (const name of names) {
    if (typeof registry?.[name] === "function") return registry[name](...args);
  }
  return undefined;
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

function ids(document, key) {
  return Array.isArray(document?.[key]) ? document[key].map((entry) => typeof entry === "string" ? entry : entry?.id).filter(Boolean) : [];
}

function listFrom(value) {
  if (Array.isArray(value)) return value.map(normalizeMode).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  if (value && typeof value === "object") {
    if (Array.isArray(value.modes)) return listFrom(value.modes);
    return Object.entries(value).map(([id, entry]) => normalizeMode({ ...(entry ?? {}), id })).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
  }
  return [];
}

function modeStatus(result, fallback = "MODE_RESULT") {
  if (result && typeof result === "object" && typeof result.status === "string") return result.status;
  return fallback;
}

/**
 * CLI-facing Mode service. It deliberately keeps the registry/runtime seam
 * injected: an offline CLI can list/resolve/inspect manifests, while a live
 * session driver is required before a hard execution-state change is applied.
 */
export class ModeControlService {
  constructor({ rootDir, configRoot, registry, sessionDriver = null, profileResolver = null } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("rootDir must be absolute");
    this.rootDir = path.resolve(rootDir);
    this.configRoot = typeof configRoot === "string" && path.isAbsolute(configRoot) ? path.resolve(configRoot) : null;
    this.registry = registry;
    this.sessionDriver = sessionDriver;
    this.profileResolver = profileResolver;
  }

  async #registry() {
    if (this.registry) return this.registry;
    const module = await import("../mode-registry/index.mjs");
    const factory = module.createModeRegistry ?? module.ModeRegistry;
    if (typeof factory !== "function") throw error("MODE_REGISTRY_UNAVAILABLE", "Mode Registry has no public factory");
    const [capabilities, packages, surfaces] = await Promise.all([
      readJsonIfPresent(path.join(this.rootDir, "policies", "capabilities.v1.json")),
      readJsonIfPresent(path.join(this.rootDir, "inventory", "packages.lock.json")),
      readJsonIfPresent(path.join(this.rootDir, "policies", "enforcement-surfaces.v1.json")),
    ]);
    const profile = this.profileResolver && typeof this.profileResolver === "object"
      ? this.profileResolver
      : typeof this.profileResolver === "string"
        ? await readJsonIfPresent(path.join(this.rootDir, "profiles", `${this.profileResolver}.json`))
        : null;
    const options = {
      rootDir: this.rootDir,
      // The registry must discover the repository/staged artifact's built-in
      // modes even when a runtime config root is supplied.  `configRoot` is
      // only the optional user-mode root; it must never replace the built-in
      // source with an empty per-user directory.
      builtInRoot: path.join(this.rootDir, "modes"),
      configRoot: this.configRoot,
      capabilities: ids(capabilities, "capabilities"),
      packages: [
        ...ids(packages, "packages"),
        ...ids(packages, "candidates"),
      ],
      enforcementSurfaces: ids(surfaces, "surfaces"),
      profile,
    };
    this.registry = typeof module.createModeRegistry === "function"
      ? await module.createModeRegistry(options)
      : new factory(options);
    return this.registry;
  }

  async #list(registry, options) {
    const value = await call(registry, ["list", "listModes"], options)
      ?? await call(registry, ["discover"], options);
    const modes = listFrom(value);
    const normalized = modes.map((entry) => ({
      ...entry,
      id: entry.id ?? entry.key,
      version: entry.version ?? entry.manifest?.version,
      executionState: entry.executionState ?? entry.manifest?.executionState,
      sourceHash: entry.sourceHash ?? null,
    }));
    return {
      ok: true,
      status: "MODE_LIST",
      mutation: false,
      modes: normalized,
      count: normalized.length,
      registry: registry.version ?? "1",
    };
  }

  async #resolve(registry, modeId, options) {
    const resolveOptions = typeof options?.profile === "string"
      ? { ...options, profile: this.profileResolver && typeof this.profileResolver === "object" ? this.profileResolver : undefined }
      : options;
    const resolved = await call(registry, ["resolve", "resolveMode", "get"], modeId, resolveOptions);
    if (resolved === undefined || resolved === null) throw error("MODE_NOT_FOUND", `mode ${modeId} was not found`);
    return resolved.mode ?? resolved;
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    const modeId = options.modeId ?? null;
    if (typeof options.profile === "string" && !this.profileResolver) this.profileResolver = options.profile;
    const registry = await this.#registry();
    try {
      if (subcommand === "list") return this.#list(registry, options);
      if (subcommand === "doctor") {
        const result = await call(registry, ["doctor", "check"], options);
        return result ?? { ok: true, status: "MODE_DOCTOR_PASS", mutation: false, errors: [] };
      }
      if (subcommand === "show") {
        assertModeId(modeId);
        const resolved = await this.#resolve(registry, modeId, { ...options, resolved: options.resolved !== false });
        const explanation = await call(registry, ["explain", "explainMode"], modeId, options);
        return { ok: true, status: "MODE_SHOW", mutation: false, mode: resolved, explanation: explanation ?? null };
      }
      if (subcommand === "diff") {
        assertModeId(modeId);
        let result;
        if (options.fromSnapshot && options.toSnapshot) {
          result = await call(registry, ["diff", "diffMode"], options.fromSnapshot, options.toSnapshot);
        } else {
          const target = await this.#resolve(registry, modeId, options);
          result = {
            available: false,
            reason: "No current session mode snapshot was supplied; use /omp mode show --resolved inside an active Pi session or provide two snapshots.",
            changes: [],
            hardEnvelopeChanged: "unknown",
            restartRequired: "unknown",
            target,
          };
        }
        return { ok: true, status: "MODE_DIFF", mutation: false, modeId, diff: result ?? [] };
      }
      if (subcommand === "scaffold") {
        assertModeId(modeId);
        const scaffoldId = modeId.includes(":") ? modeId.slice(modeId.indexOf(":") + 1) : modeId;
        const result = await call(registry, ["scaffold", "scaffoldMode"], { ...options, id: scaffoldId });
        return {
          ok: true,
          status: "MODE_SCAFFOLD",
          mutation: false,
          modeId,
          readOnly: true,
          template: result?.template ?? result ?? null,
          next: "review the template, save it under a trusted mode root, then rerun omp mode doctor",
        };
      }
      if (subcommand === "use" || subcommand === "reset") {
        if (subcommand === "use") assertModeId(modeId);
        const target = subcommand === "reset" ? null : modeId;
        const resolved = target ? await this.#resolve(registry, target, options) : null;
        // The upstream registry treats a missing session object as an
        // indeterminate idle state.  For the production service that is not
        // an actionable activation path: without an injected public
        // ExecutionStateDriver/session seam, fail closed with the documented
        // restart flow instead of reporting a misleading SESSION_NOT_IDLE.
        if (!this.sessionDriver) {
          return {
            ok: false,
            status: "RESTART_REQUIRED",
            mutation: false,
            modeId: target,
            executionState: resolved?.executionState ?? "unknown",
            reason: "No public session ExecutionStateDriver is available for a hard policy change.",
            launchArgs: target ? ["pi", "--perm", String(resolved?.executionState ?? "ask")] : ["pi"],
            next: "restart Pi with the reviewed mode/permission envelope; do not use prompt injection as a substitute",
          };
        }
        const activation = await call(registry, ["activate", "activateMode", "apply"], target, {
          ...options,
          mode: resolved,
          session: this.sessionDriver,
          executionStateDriver: this.sessionDriver,
        });
        if (activation !== undefined) {
          return {
            ...activation,
            ok: activation.ok ?? activation.status === "APPLIED",
            mutation: activation.mutation ?? activation.status === "APPLIED",
          };
        }
        return {
          ok: false,
          status: "RESTART_REQUIRED",
          mutation: false,
          modeId: target,
          executionState: resolved?.executionState ?? "unknown",
          reason: "No public session ExecutionStateDriver is available for a hard policy change.",
          launchArgs: target ? ["pi", "--perm", String(resolved?.executionState ?? "ask")] : ["pi"],
          next: "restart Pi with the reviewed mode/permission envelope; do not use prompt injection as a substitute",
        };
      }
      throw error("INVALID_MODE_COMMAND", `unsupported mode subcommand: ${subcommand}`);
    } catch (cause) {
      if (cause?.code) {
        return {
          ok: false,
          status: cause.code === "MODE_NOT_FOUND" ? "MODE_NOT_FOUND" : "MODE_UNAVAILABLE",
          mutation: false,
          code: cause.code,
          message: cause.message,
          details: cause.details,
        };
      }
      throw cause;
    }
  }

  async getRegistry() {
    return this.#registry();
  }
}

export function createModeControlService(options = {}) {
  return new ModeControlService(options);
}

export async function createDefaultModeControlService(options = {}) {
  const service = new ModeControlService(options);
  await service.dispatch({ subcommand: "doctor" });
  return service;
}

/** Resolve a bootstrap mode without mutating Pi settings or opening a session. */
export async function resolveBootstrapMode({ rootDir, profileId = null, modeId } = {}) {
  if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw error("INVALID_MODE_ROOT", "rootDir must be absolute");
  assertModeId(modeId);
  const profile = profileId
    ? await readJsonIfPresent(path.join(rootDir, "profiles", `${profileId}.json`))
    : null;
  const service = new ModeControlService({ rootDir, profileResolver: profile });
  const registry = await service.getRegistry();
  try {
    const resolved = await registry.resolve(modeId, profile ? { profile } : {});
    return {
      status: "RESOLVED",
      id: resolved.modeId,
      hash: resolved.hash,
      sourceHash: resolved.sourceHash,
      executionState: resolved.resolved?.executionState ?? "unknown",
    };
  } catch (cause) {
    return {
      status: "UNAVAILABLE",
      id: modeId,
      code: cause?.code ?? "MODE_RESOLUTION_FAILED",
      message: cause?.message ?? String(cause),
    };
  }
}
