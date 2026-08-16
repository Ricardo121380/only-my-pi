import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createModeControlService } from "../../packages/control-service/mode-service.mjs";
import { validateModeReceipt } from "../../packages/mode-registry/index.mjs";
import { buildContextSnapshot, formatSnapshot } from "../context-doctor/metrics.mjs";

const TOKEN = /^[A-Za-z0-9:_./-]+$/u;
const ROOT_COMMANDS = new Set(["", "help", "status", "doctor", "profile", "mode", "workflow", "tools", "packages", "context", "verify", "safe", "swarm", "theme"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parseOmpCommand(input = "") {
  if (typeof input !== "string" || input.length > 2048 || /[\0\r\n]/u.test(input)) fail("INVALID_COMMAND", "command text is bounded and single-line");
  const trimmed = input.trim();
  if (trimmed === "") return { command: "help", args: [] };
  const args = trimmed.split(/\s+/u);
  if (args.some((token) => !TOKEN.test(token))) fail("INVALID_COMMAND", "quoted or shell-shaped arguments are not accepted");
  const command = args.shift();
  if (!ROOT_COMMANDS.has(command)) fail("UNKNOWN_COMMAND", `unknown /omp command: ${command}`);
  return { command: command || "help", args };
}

function bounded(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/[\0\r\n\t]+/gu, " ").slice(0, 768);
}

function asText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return bounded(result, "unavailable");
  const lines = [`status: ${bounded(result.status, "UNKNOWN")}`];
  if (result.code) lines.push(`code: ${bounded(result.code)}`);
  if (result.message) lines.push(`message: ${bounded(result.message)}`);
  if (result.modeId) lines.push(`mode: ${bounded(result.modeId)}`);
  if (result.count !== undefined) lines.push(`count: ${bounded(result.count)}`);
  if (result.next) lines.push(`next: ${bounded(result.next)}`);
  if (result.reason) lines.push(`reason: ${bounded(result.reason)}`);
  if (Array.isArray(result.modes)) lines.push(`modes: ${result.modes.map((entry) => bounded(entry.id ?? entry)).join(", ") || "none"}`);
  if (result.executionState) lines.push(`executionState: ${bounded(result.executionState)}`);
  return lines.join("\n");
}

function notify(ctx, value, level = "info") {
  if (typeof ctx?.ui?.notify === "function") ctx.ui.notify(asText(value), level);
}

async function readRootJson(rootDir, relative) {
  try {
    return JSON.parse(await fs.readFile(path.join(rootDir, relative), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function profileSummary(document) {
  if (!document || typeof document !== "object") return null;
  return {
    id: document.id,
    description: document.description ?? "",
    packages: Array.isArray(document.packageIds) ? [...document.packageIds].sort() : [],
    capabilities: Array.isArray(document.capabilityIds) ? [...document.capabilityIds].sort() : [],
  };
}

function latestModeReceipt(entries) {
  if (!Array.isArray(entries)) return { status: "MODE_RECEIPT_UNAVAILABLE", code: "SESSION_ENTRIES_UNAVAILABLE" };
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== "only-my-pi-mode") continue;
    const candidate = entry.data?.receipt;
    if (!candidate) return { status: "MODE_RECEIPT_IGNORED", code: "MODE_RECEIPT_MISSING" };
    return { status: "CANDIDATE", candidate };
  }
  return { status: "NO_MODE_RECEIPT" };
}

/**
 * Re-resolve the last persisted mode receipt against the current registry.
 * A receipt never supplies prompt text or policy; it only proves which
 * resolved hash was previously active.  Any malformed, missing, or drifted
 * receipt is retained as evidence and fails closed without injecting a
 * prompt.
 */
export async function restoreModeReceipt({ registry, entries, profile } = {}) {
  const located = latestModeReceipt(entries);
  if (located.status !== "CANDIDATE") return located;
  const validation = validateModeReceipt(located.candidate);
  if (!validation.valid) {
    return {
      status: "MODE_RECEIPT_IGNORED",
      code: "INVALID_MODE_RECEIPT",
      errors: validation.errors.slice(0, 4),
    };
  }
  if (!registry || typeof registry.resolve !== "function") {
    return { status: "MODE_RECEIPT_UNAVAILABLE", code: "MODE_REGISTRY_UNAVAILABLE", receipt: located.candidate };
  }
  let target;
  try {
    target = await registry.resolve(located.candidate.modeId, { refresh: true, profile });
  } catch (cause) {
    return {
      status: "MODE_RECEIPT_UNAVAILABLE",
      code: cause?.code ?? "MODE_RESOLUTION_FAILED",
      receipt: located.candidate,
    };
  }
  if (target.hash !== located.candidate.hash || target.sourceHash !== located.candidate.sourceHash) {
    return {
      status: "STALE_MODE_SNAPSHOT",
      code: "STALE_MODE_SNAPSHOT",
      modeId: located.candidate.modeId,
      receipt: located.candidate,
      current: { modeId: target.modeId, hash: target.hash, sourceHash: target.sourceHash },
    };
  }
  return {
    status: "MODE_RESTORED",
    modeId: target.modeId,
    hash: target.hash,
    sourceHash: target.sourceHash,
    target,
  };
}

/**
 * Runtime command adapter shared by the Pi extension and deterministic tests.
 * It never invokes a shell and treats missing live services as an explicit
 * unavailable state rather than guessing a permission or sandbox state.
 */
export function createOmpRuntime({ rootDir, configRoot, registry, modeService, workflowService, sessionDriver, snapshotProvider, profile, onModeRestored, onModeStale, getModeRestoreStatus } = {}) {
  const derivedRoot = rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const derivedConfigRoot = configRoot ?? process.env.PI_CODING_AGENT_DIR ?? null;
  let modes = modeService;
  let workflows = workflowService;
  const getModes = async () => {
    if (!modes) modes = createModeControlService({ rootDir: derivedRoot, configRoot: derivedConfigRoot, registry, sessionDriver });
    return modes;
  };
  const getWorkflows = async () => {
    if (!workflows) {
      // Keep the M3 packaged runtime dependency-closed: workflow support is an
      // M4 surface and must not be imported during the minimal extension's
      // startup path.  The dynamic import also makes a missing optional
      // workflow bundle an explicit command-time UNAVAILABLE result.
      const module = await import("../../packages/control-service/workflow-service.mjs");
      workflows = module.createWorkflowControlService({ rootDir: derivedRoot });
    }
    return workflows;
  };

  const restoreSession = async (entries) => {
    let liveRegistry = registry;
    try {
      const service = await getModes();
      if (!liveRegistry && typeof service?.getRegistry === "function") liveRegistry = await service.getRegistry();
    } catch (cause) {
      return { status: "MODE_RECEIPT_UNAVAILABLE", code: cause?.code ?? "MODE_REGISTRY_UNAVAILABLE" };
    }
    const result = await restoreModeReceipt({ registry: liveRegistry, entries, profile });
    if (result.status === "MODE_RESTORED" && typeof onModeRestored === "function") {
      await onModeRestored(result.target, result);
    } else if (result.status === "STALE_MODE_SNAPSHOT" && typeof onModeStale === "function") {
      await onModeStale(result);
    }
    return result;
  };

  return {
    restoreSession,
    async execute(input, ctx = {}) {
      const parsed = typeof input === "string" ? parseOmpCommand(input) : input;
      const command = parsed.command;
      const args = parsed.args ?? [];
      if (command === "help") {
        return {
          ok: true,
          status: "HELP",
          text: "/omp status|doctor|profile|mode|tools|packages|context|verify|safe|help",
        };
      }
      if (command === "mode") {
        const subcommand = args[0] ?? "list";
        const modeId = args[1] ?? null;
        const result = await (await getModes()).dispatch({
          subcommand,
          modeId,
          configRoot,
          resolved: args.includes("--resolved"),
        });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "workflow") {
        const subcommand = args[0] ?? "list";
        const workflowId = args[1] ?? null;
        const result = await (await getWorkflows()).dispatch({ subcommand, workflowId, runId: workflowId, apply: args.includes("--apply") && args.includes("--yes"), input: {}, conditions: ["profile-resolved", "mode-resolved", "session-idle"] });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "context") {
        const snapshot = typeof snapshotProvider === "function" ? snapshotProvider() : null;
        const result = snapshot
          ? { ok: true, status: "CONTEXT", snapshot, text: formatSnapshot(snapshot) }
          : { ok: false, status: "CONTEXT_UNAVAILABLE", next: "wait for the first context event" };
        notify(ctx, result.text ?? result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "profile") {
        const subcommand = args[0] ?? "list";
        if (subcommand === "list") {
          const profilesRoot = path.join(derivedRoot, "profiles");
          let names = [];
          try {
            names = (await fs.readdir(profilesRoot)).filter((name) => name.endsWith(".json")).sort();
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
          const profiles = [];
          for (const name of names) {
            const document = await readRootJson(derivedRoot, `profiles/${name}`);
            const summary = profileSummary(document);
            if (summary) profiles.push(summary);
          }
          const result = { ok: true, status: "PROFILE_LIST", mutation: false, profiles };
          notify(ctx, result);
          return result;
        }
        const profileId = args[1];
        if (!/^[a-z][a-z0-9-]{0,63}$/u.test(profileId ?? "")) {
          const result = { ok: false, status: "PROFILE_UNAVAILABLE", code: "INVALID_PROFILE_ID", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const document = await readRootJson(derivedRoot, `profiles/${profileId}.json`);
        if (!document) {
          const result = { ok: false, status: "PROFILE_NOT_FOUND", code: "UNKNOWN_PROFILE", mutation: false, profileId };
          notify(ctx, result, "warning");
          return result;
        }
        if (subcommand === "show") {
          const result = { ok: true, status: "PROFILE_SHOW", mutation: false, profile: document };
          notify(ctx, result);
          return result;
        }
        if (subcommand === "diff") {
          const otherId = args[2];
          const other = await readRootJson(derivedRoot, `profiles/${otherId}.json`);
          if (!other) return { ok: false, status: "PROFILE_NOT_FOUND", code: "UNKNOWN_PROFILE", mutation: false, profileId: otherId };
          const changes = [];
          if (JSON.stringify(document.packageIds ?? []) !== JSON.stringify(other.packageIds ?? [])) changes.push({ path: "packageIds" });
          if (JSON.stringify(document.capabilityIds ?? []) !== JSON.stringify(other.capabilityIds ?? [])) changes.push({ path: "capabilityIds" });
          if (JSON.stringify(document.policy ?? {}) !== JSON.stringify(other.policy ?? {})) changes.push({ path: "policy" });
          const result = { ok: true, status: "PROFILE_DIFF", mutation: false, from: profileId, to: otherId, changes };
          notify(ctx, result);
          return result;
        }
        return { ok: false, status: "PROFILE_UNAVAILABLE", code: "INVALID_PROFILE_COMMAND", mutation: false };
      }
      if (command === "tools") {
        const active = typeof ctx?.pi?.getActiveTools === "function" ? [...ctx.pi.getActiveTools()].sort() : [];
        const all = typeof ctx?.pi?.getAllTools === "function" ? ctx.pi.getAllTools().map((tool) => tool.name ?? tool.id).filter(Boolean).sort() : [];
        const result = { ok: true, status: "TOOLS", mutation: false, active, available: all, enforcement: { state: "unknown", reason: "Pi public API does not expose the complete cross-surface policy" } };
        notify(ctx, result);
        return result;
      }
      if (command === "packages") {
        const inventory = await readRootJson(derivedRoot, "inventory/packages.lock.json");
        if (!inventory) {
          const result = { ok: false, status: "PACKAGES_UNAVAILABLE", code: "PACKAGES_UNAVAILABLE", mutation: false };
          notify(ctx, result, "warning");
          return result;
        }
        const packages = [...(inventory.packages ?? []), ...(inventory.candidates ?? [])]
          .map((entry) => ({ id: entry.id, spec: entry.spec, mode: entry.mode ?? "promoted", installed: entry.installed === true, scope: entry.scope ?? null }))
          .sort((left, right) => left.id.localeCompare(right.id));
        const result = { ok: true, status: "PACKAGES", mutation: false, packages };
        notify(ctx, result);
        return result;
      }
      if (command === "safe") {
        const result = {
          ok: true,
          status: "SAFE_START_GUIDANCE",
          mutation: false,
          command: ["pi", "--offline", "--no-session", "--no-extensions", "--no-skills", "--no-context-files", "--tools", "read,grep,find,ls"],
          note: "This is launch guidance; true isolation still requires an OS/container boundary.",
        };
        notify(ctx, result);
        return result;
      }
      if (command === "verify") {
        const manifest = await readRootJson(derivedRoot, "verification/release-gates-v1.json");
        const result = manifest
          ? { ok: true, status: "VERIFY_INSPECTOR", mutation: false, executable: false, manifest: manifest.id ?? null, gateIds: (manifest.gates ?? []).map((gate) => gate.id), gateCount: (manifest.gates ?? []).length }
          : { ok: false, status: "VERIFY_UNAVAILABLE", code: "VERIFY_MANIFEST_UNAVAILABLE", mutation: false };
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      if (command === "status") {
        const currentMode = typeof sessionDriver?.readMode === "function" ? await sessionDriver.readMode() : null;
        const result = {
          ok: true,
          status: "STATUS",
          mode: currentMode ? { modeId: currentMode.modeId ?? null, hash: currentMode.hash ?? null, sourceHash: currentMode.sourceHash ?? null } : null,
          modeRestoreStatus: typeof getModeRestoreStatus === "function" ? getModeRestoreStatus() : null,
          profile: null,
          executionState: "unknown",
          enforcement: "unknown",
          activeTools: typeof ctx?.pi?.getActiveTools === "function" ? [...ctx.pi.getActiveTools()].sort() : [],
          restartRequired: false,
        };
        notify(ctx, result);
        return result;
      }
      if (command === "doctor") {
        const result = await (await getModes()).dispatch({ subcommand: "doctor", configRoot });
        notify(ctx, result, result.ok === false ? "warning" : "info");
        return result;
      }
      const unavailable = {
        ok: false,
        status: "UNAVAILABLE",
        code: "MILESTONE_NOT_IMPLEMENTED",
        command,
        next: "use the corresponding omp CLI plan or wait for its owning milestone",
      };
      notify(ctx, unavailable, "warning");
      return unavailable;
    },
  };
}

/** @param {any} options */
export function createContextSnapshotProvider({ messages = [], pi, ctx, systemPromptCharacters, turnIndex, getState } = {}) {
  return () => buildContextSnapshot({
    messages: typeof getState === "function" ? (getState().messages ?? []) : messages,
    tools: typeof pi?.getAllTools === "function" ? pi.getAllTools() : [],
    activeTools: typeof pi?.getActiveTools === "function" ? pi.getActiveTools() : [],
    usage: typeof (typeof getState === "function" ? getState().ctx : ctx)?.getContextUsage === "function"
      ? (typeof getState === "function" ? getState().ctx : ctx).getContextUsage()
      : null,
    systemPromptCharacters: typeof getState === "function" ? getState().systemPromptCharacters : systemPromptCharacters,
    turnIndex: typeof getState === "function" ? getState().turnIndex : turnIndex,
  });
}
