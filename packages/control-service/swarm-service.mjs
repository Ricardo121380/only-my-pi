import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { createAgentRegistry } from "../agent-registry/index.mjs";
import { createSwarmRecipeRegistry } from "../swarm-core/index.mjs";
import { translateLegacySwarmRecipe } from "../subagents/workflow/migration/index.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function controlError(message, code) {
  return Object.assign(new Error(message), { code });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalInput(value, location = "input") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw controlError(`${location} must contain finite JSON numbers`, "INVALID_INPUT");
    return value;
  }
  if (Array.isArray(value)) return value.map((child, index) => canonicalInput(child, `${location}[${index}]`));
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw controlError(`${location} must be plain JSON`, "INVALID_INPUT");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalInput(value[key], `${location}.${key}`)]));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalInput(value, "digest input"))).digest("hex")}`;
}

function prepareInput(value, preparedInputs) {
  if (preparedInputs.has(value)) return value;
  const normalized = deepFreeze(canonicalInput(value ?? {}));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw controlError("swarm input must be a JSON object", "INVALID_INPUT");
  const bytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  if (bytes > 64 * 1024) throw controlError("swarm input exceeds 64 KiB", "INPUT_TOO_LARGE");
  preparedInputs.add(normalized);
  return normalized;
}

function normalizeConditions(value) {
  if (!Array.isArray(value)) throw controlError("swarm execution conditions must be an array", "INVALID_EXECUTION_ENVELOPE");
  const conditions = [...new Set(value)];
  if (conditions.length !== value.length || conditions.some((condition) => typeof condition !== "string" || condition.length === 0 || condition.length > 256)) {
    throw controlError("swarm execution conditions are invalid", "INVALID_EXECUTION_ENVELOPE");
  }
  return conditions.sort();
}

function executionEnvelope(plan, { runId, sourceHash, recipeId, input, conditions = [] } = {}) {
  if (!RUN_ID.test(runId ?? "")) throw controlError("swarm run id is invalid", "INVALID_RUN_ID");
  const payload = {
    formatVersion: 1,
    runId,
    planDigest: plan.planDigest,
    sourceHash: sourceHash ?? plan.definitionDigest,
    runInputDigest: digest(input),
    target: { kind: "swarm", id: recipeId ?? plan.id },
    conditions: normalizeConditions(conditions),
  };
  if (!SHA256.test(payload.sourceHash) || !SHA256.test(payload.runInputDigest)) throw controlError("swarm execution envelope contains an invalid digest", "INVALID_EXECUTION_ENVELOPE");
  return deepFreeze({ ...payload, executionEnvelopeDigest: digest(payload) });
}

function assertOrchestration(value) {
  if (value === null || value === undefined) return null;
  for (const method of ["execute", "inspect", "cancel"]) {
    if (typeof value[method] !== "function") throw new TypeError(`unified RunCoordinator must implement ${method}()`);
  }
  return value;
}

function swarmResultStatus(status) {
  return ({
    completed: "SWARM_COMPLETED",
    cancelled: "SWARM_CANCELLED",
    paused: "SWARM_PAUSED",
    "awaiting-approval": "SWARM_AWAITING_APPROVAL",
    interrupted: "SWARM_INTERRUPTED",
    orphaned: "SWARM_ORPHANED",
  })[status] ?? "SWARM_FAILED";
}

/**
 * Control surface for Swarm recipes.  Listing, showing, validating, and
 * planning are offline/read-only.  Live run/status/cancel require an injected
 * Pi extension-RPC transport; the default service deliberately has none.
 */
export class SwarmControlService {
  constructor({ rootDir, registry, agentRegistry, orchestration } = {}) {
    this.rootDir = rootDir;
    this.agentRegistry = agentRegistry ?? createAgentRegistry({ rootDir });
    this.registry = registry ?? createSwarmRecipeRegistry({ rootDir, agentRegistry: this.agentRegistry });
    // Live execution is injected from the single @only-my-pi/subagents
    // facade. This service never constructs the legacy SwarmRunController.
    this.orchestration = assertOrchestration(orchestration);
    this.runPlans = new Map();
    this.preparedInputs = new WeakSet();
  }

  async #input(options) {
    if (options.input !== undefined) return prepareInput(options.input, this.preparedInputs);
    if (!options.inputFile) return prepareInput({}, this.preparedInputs);
    const target = path.resolve(options.inputFile);
    let handle;
    try {
      handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile()) throw controlError("swarm input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
      if (stat.size > 64 * 1024) throw controlError("swarm input file exceeds 64 KiB", "INPUT_TOO_LARGE");
      const contents = await handle.readFile();
      if (contents.byteLength > 64 * 1024) throw controlError("swarm input file exceeds 64 KiB", "INPUT_TOO_LARGE");
      return prepareInput(JSON.parse(contents.toString("utf8")), this.preparedInputs);
    } catch (cause) {
      if (["ELOOP", "EMLINK"].includes(cause?.code)) throw controlError("swarm input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
      if (cause instanceof SyntaxError) throw controlError("swarm input file must contain valid JSON", "INVALID_INPUT");
      throw cause;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") {
      const recipes = await this.registry.list();
      return { ok: true, status: "SWARM_RECIPE_LIST", mutation: false, recipes: recipes.map((entry) => ({ id: entry.id, version: entry.manifest.version, description: entry.manifest.description, readOnly: entry.manifest.readOnly, nodes: entry.graph.order.length, sourceHash: entry.sourceHash, contractStatus: entry.manifest.contractStatus })) };
    }
    if (subcommand === "show") {
      const entry = await this.registry.resolve(options.recipeId);
      return { ok: true, status: "SWARM_RECIPE_SHOW", mutation: false, recipe: entry.manifest, sourceHash: entry.sourceHash };
    }
    if (subcommand === "validate") {
      const result = options.recipeId ? await this.registry.resolve(options.recipeId).then(() => ({ ok: true, status: "SWARM_RECIPE_VALID", mutation: false, recipeId: options.recipeId })) : await this.registry.doctor();
      return result;
    }
    if (subcommand === "plan") {
      try {
        const entry = await this.registry.resolve(options.recipeId);
        const migration = translateLegacySwarmRecipe(entry.manifest);
        const runId = options.runId ?? `swarm-${crypto.randomUUID()}`;
        const input = await this.#input(options);
        const envelope = executionEnvelope(migration.plan, { runId, sourceHash: entry.sourceHash, recipeId: entry.id, input, conditions: options.conditions ?? [] });
        return {
          ok: true,
          status: "SWARM_PLAN",
          mutation: false,
          kind: "legacy-workflow",
          recipeId: options.recipeId,
          sourceHash: entry.sourceHash,
          migration: migration.migration,
          plan: migration.plan,
          runId,
          input,
          executionEnvelope: envelope,
        };
      } catch (error) {
        return { ok: false, status: "SWARM_PLAN_BLOCKED", mutation: false, code: error.code ?? "SWARM_PLAN_BLOCKED", message: error.message };
      }
    }
    if (subcommand === "run") {
      const entry = await this.registry.resolve(options.recipeId);
      const migration = translateLegacySwarmRecipe(entry.manifest);
      const runId = options.runId ?? `swarm-${crypto.randomUUID()}`;
      let input;
      let envelope;
      try {
        input = await this.#input(options);
        envelope = executionEnvelope(migration.plan, { runId, sourceHash: entry.sourceHash, recipeId: entry.id, input, conditions: options.conditions ?? [] });
      } catch (error) {
        return { ok: false, status: "SWARM_PLAN_BLOCKED", mutation: false, code: error.code ?? "SWARM_PLAN_BLOCKED", message: error.message };
      }
      if (options.yes !== true) return {
        ok: false,
        status: "CONFIRMATION_REQUIRED",
        mutation: true,
        code: "EXACT_PLAN_CONFIRMATION_REQUIRED",
        kind: "legacy-workflow",
        migration: migration.migration,
        plan: migration.plan,
      };
      if (options.expectedPlanDigest !== migration.plan.planDigest) return {
        ok: false,
        status: "SWARM_PLAN_STALE",
        mutation: false,
        code: options.expectedPlanDigest === undefined ? "EXACT_PLAN_DIGEST_REQUIRED" : "PLAN_DIGEST_MISMATCH",
        expectedPlanDigest: options.expectedPlanDigest ?? null,
        currentPlanDigest: migration.plan.planDigest,
      };
      if (options.expectedExecutionDigest === undefined) return {
        ok: false,
        status: "SWARM_PLAN_STALE",
        mutation: false,
        code: "EXACT_EXECUTION_ENVELOPE_REQUIRED",
        currentExecutionDigest: envelope.executionEnvelopeDigest,
      };
      if (options.expectedExecutionDigest !== envelope.executionEnvelopeDigest) return {
        ok: false,
        status: "SWARM_PLAN_STALE",
        mutation: false,
        code: "EXECUTION_ENVELOPE_DRIFT",
        expectedExecutionDigest: options.expectedExecutionDigest,
        currentExecutionDigest: envelope.executionEnvelopeDigest,
      };
      if (!this.orchestration) return { ok: false, status: "LIVE_SWARM_REQUIRES_PI_SESSION", mutation: true, code: "LIVE_RUNTIME_UNAVAILABLE", next: "Inject the @only-my-pi/subagents RunCoordinator from a trusted Pi session." };
      this.runPlans.set(runId, migration.plan);
      const state = await this.orchestration.execute(migration.plan, { runId, input, executionEnvelope: envelope, approval: options.approval, signal: options.signal });
      this.runPlans.set(state.runId, migration.plan);
      return { ok: state.status === "completed", status: swarmResultStatus(state.status), mutation: true, kind: "legacy-workflow", state };
    }
    if (subcommand === "status") {
      if (!options.runId) return { ok: false, status: "SWARM_STATUS_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      const plan = this.runPlans.get(options.runId);
      if (!this.orchestration || !plan) return { ok: false, status: "SWARM_STATUS_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      const state = await this.orchestration.inspect(options.runId, plan);
      return { ok: true, status: "SWARM_STATUS", mutation: false, kind: "legacy-workflow", state };
    }
    if (subcommand === "cancel") {
      if (!options.runId) return { ok: false, status: "SWARM_CANCEL_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration) return { ok: false, status: "SWARM_CANCEL_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      return { ok: true, status: "SWARM_CANCEL", mutation: false, result: await this.orchestration.cancel(options.runId) };
    }
    return { ok: false, status: "SWARM_COMMAND_INVALID", mutation: false, code: "INVALID_SWARM_COMMAND" };
  }
}

export function createSwarmControlService(options = {}) { return new SwarmControlService(options); }
