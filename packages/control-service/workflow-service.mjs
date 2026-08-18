import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { createAgentRegistry } from "../agent-registry/index.mjs";
import { createGateRunner } from "../gate-runner/index.mjs";
import { createWorkflowRegistry } from "../workflow-core/index.mjs";

function unavailable(message, code) {
  return Object.assign(new Error(message), { code });
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalInput(value, path = "input") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw unavailable(`${path} must contain finite JSON numbers`, "INVALID_RUN_INPUT");
    return value;
  }
  if (Array.isArray(value)) return value.map((child, index) => canonicalInput(child, `${path}[${index}]`));
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw unavailable(`${path} must be plain JSON`, "INVALID_RUN_INPUT");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalInput(value[key], `${path}.${key}`)]));
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonicalInput(value, "digest input"))).digest("hex")}`;
}

function prepareInput(value, preparedInputs) {
  if (preparedInputs.has(value)) return value;
  const normalized = deepFreeze(canonicalInput(value ?? {}));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw unavailable("workflow run input must be a JSON object", "INVALID_RUN_INPUT");
  const bytes = Buffer.byteLength(JSON.stringify(normalized), "utf8");
  if (bytes > 256 * 1024) throw unavailable("workflow run input exceeds 256 KiB", "RUN_INPUT_TOO_LARGE");
  preparedInputs.add(normalized);
  return normalized;
}

async function readInputFile(inputFile) {
  if (typeof inputFile !== "string" || !path.isAbsolute(inputFile)) throw unavailable("workflow input file must be an absolute path", "INVALID_INPUT_FILE");
  const target = path.resolve(inputFile);
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw unavailable("workflow input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
    if (stat.size > 256 * 1024) throw unavailable("workflow input file exceeds 256 KiB", "RUN_INPUT_TOO_LARGE");
    const contents = await handle.readFile();
    if (contents.byteLength > 256 * 1024) throw unavailable("workflow input file exceeds 256 KiB", "RUN_INPUT_TOO_LARGE");
    return JSON.parse(contents.toString("utf8"));
  } catch (cause) {
    if (["ELOOP", "EMLINK"].includes(cause?.code)) throw unavailable("workflow input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
    if (cause instanceof SyntaxError) throw unavailable("workflow input file must contain valid JSON", "INVALID_RUN_INPUT");
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function normalizeConditions(value) {
  if (!Array.isArray(value)) throw unavailable("workflow entry conditions must be an array", "INVALID_EXECUTION_ENVELOPE");
  const conditions = [...new Set(value)];
  if (conditions.length !== value.length || conditions.some((condition) => typeof condition !== "string" || condition.length === 0 || condition.length > 256)) {
    throw unavailable("workflow entry conditions are invalid", "INVALID_EXECUTION_ENVELOPE");
  }
  return conditions.sort();
}

function executionEnvelope(plan, { runId, sourceHash, target, input, conditions } = {}) {
  if (!RUN_ID.test(runId ?? "")) throw unavailable("workflow run id is invalid", "INVALID_RUN_ID");
  const payload = {
    formatVersion: 1,
    runId,
    planDigest: plan.planDigest,
    sourceHash: sourceHash ?? plan.definitionDigest,
    runInputDigest: digest(input),
    target: { kind: target?.kind ?? "workflow", id: target?.id ?? plan.id },
    conditions: normalizeConditions(conditions ?? []),
  };
  if (!SHA256.test(payload.sourceHash) || !SHA256.test(payload.runInputDigest)) throw unavailable("workflow execution envelope contains an invalid digest", "INVALID_EXECUTION_ENVELOPE");
  const executionEnvelopeDigest = digest(payload);
  return deepFreeze({ ...payload, executionEnvelopeDigest });
}

function assertOrchestration(value) {
  if (value === null || value === undefined) return null;
  for (const method of ["execute", "inspect", "cancel"]) {
    if (typeof value[method] !== "function") throw new TypeError(`unified RunCoordinator must implement ${method}()`);
  }
  return value;
}

function workflowResultStatus(status) {
  return ({
    completed: "WORKFLOW_COMPLETED",
    cancelled: "WORKFLOW_CANCELLED",
    paused: "WORKFLOW_PAUSED",
    "awaiting-approval": "WORKFLOW_AWAITING_APPROVAL",
    interrupted: "WORKFLOW_INTERRUPTED",
    orphaned: "WORKFLOW_ORPHANED",
  })[status] ?? "WORKFLOW_FAILED";
}

export class WorkflowControlService {
  constructor({ rootDir, registry, recipeRegistry, orchestration, agentRegistry, gateRunner, migrationCompiler } = {}) {
    this.rootDir = rootDir;
    this.gateRunner = gateRunner ?? createGateRunner({ rootDir });
    this.agentRegistry = agentRegistry ?? createAgentRegistry({ rootDir });
    this.registry = registry ?? createWorkflowRegistry({ rootDir, gateRunner: this.gateRunner, agentRegistry: this.agentRegistry });
    this.recipeRegistry = recipeRegistry ?? null;
    if (migrationCompiler !== undefined && typeof migrationCompiler !== "function") {
      throw new TypeError("migrationCompiler must be a function");
    }
    this.migrationCompiler = migrationCompiler ?? null;
    // This is an injected @only-my-pi/subagents RunCoordinator. The public
    // control service never creates the legacy workflow-v1 controller.
    this.orchestration = assertOrchestration(orchestration);
    this.runPlans = new Map();
    this.preparedInputs = new WeakSet();
  }

  #input(value) {
    return prepareInput(value, this.preparedInputs);
  }

  async #loadMigrationCompiler() {
    if (this.migrationCompiler) return this.migrationCompiler;
    try {
      const module = await import("../subagents/workflow/migration/index.mjs");
      if (typeof module.translateLegacyWorkflow !== "function") {
        throw unavailable("The staged Workflow v2 planner is invalid.", "WORKFLOW_V2_RUNTIME_INVALID");
      }
      this.migrationCompiler = module.translateLegacyWorkflow;
      return this.migrationCompiler;
    } catch (cause) {
      if (cause?.code === "WORKFLOW_V2_RUNTIME_INVALID") throw cause;
      throw unavailable(
        "Workflow v2 planning is not installed for the active Profile.",
        cause?.code === "ERR_MODULE_NOT_FOUND" ? "WORKFLOW_V2_RUNTIME_UNAVAILABLE" : "WORKFLOW_V2_RUNTIME_INVALID",
      );
    }
  }

  async #loadRecipeRegistry() {
    if (this.recipeRegistry) return this.recipeRegistry;
    try {
      const module = await import("../swarm-core/index.mjs");
      if (typeof module.createSwarmRecipeRegistry !== "function") {
        throw unavailable("The staged Swarm recipe registry is invalid.", "SWARM_RECIPE_REGISTRY_INVALID");
      }
      this.recipeRegistry = module.createSwarmRecipeRegistry({ rootDir: this.rootDir, agentRegistry: this.agentRegistry });
      return this.recipeRegistry;
    } catch (cause) {
      if (cause?.code === "SWARM_RECIPE_REGISTRY_INVALID") throw cause;
      throw unavailable(
        "Swarm recipe planning is not installed for the active Profile.",
        cause?.code === "ERR_MODULE_NOT_FOUND" ? "SWARM_RECIPE_REGISTRY_UNAVAILABLE" : "SWARM_RECIPE_REGISTRY_INVALID",
      );
    }
  }

  async #migration(workflow) {
    const compile = await this.#loadMigrationCompiler();
    if (!workflow.manifest.steps.some((step) => step.action === "swarm")) return compile(workflow.manifest);
    const recipes = await (await this.#loadRecipeRegistry()).list();
    const byId = new Map(recipes.map((entry) => [entry.id, entry.manifest]));
    return compile(workflow.manifest, { resolveRecipe: (id) => byId.get(id) });
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") return { ok: true, status: "WORKFLOW_LIST", mutation: false, workflows: await this.registry.list() };
    if (subcommand === "show") {
      const workflow = await this.registry.resolve(options.workflowId);
      return { ok: true, status: "WORKFLOW_SHOW", mutation: false, workflow: workflow.manifest, sourceHash: workflow.sourceHash };
    }
    if (subcommand === "status") {
      if (!options.runId) return { ok: false, status: "WORKFLOW_STATUS_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      const plan = this.runPlans.get(options.runId);
      if (!this.orchestration) return { ok: false, status: "WORKFLOW_STATUS_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      let state;
      try {
        state = await this.orchestration.inspect(options.runId);
      } catch (cause) {
        if (!plan) return { ok: false, status: "WORKFLOW_STATUS_UNAVAILABLE", mutation: false, code: cause?.code ?? "LIVE_RUNTIME_UNAVAILABLE" };
        state = await this.orchestration.inspect(options.runId, plan);
      }
      return { ok: true, status: "WORKFLOW_STATUS", mutation: false, state };
    }
    if (subcommand === "cancel") {
      if (!options.runId) return { ok: false, status: "WORKFLOW_CANCEL_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration) return { ok: false, status: "WORKFLOW_CANCEL_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      return { ok: true, status: "WORKFLOW_CANCEL", mutation: true, result: await this.orchestration.cancel(options.runId) };
    }
    if (subcommand === "resume") {
      if (!options.runId) return { ok: false, status: "WORKFLOW_RESUME_UNAVAILABLE", mutation: true, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration || typeof this.orchestration.resume !== "function") {
        return { ok: false, status: "WORKFLOW_RESUME_UNAVAILABLE", mutation: true, code: "PLAN_STORE_UNAVAILABLE" };
      }
      try {
        const input = this.#input(options.inputFile ? await readInputFile(options.inputFile) : options.input);
        const state = await this.orchestration.resume(options.runId, {
          input,
          approval: options.approval,
          signal: options.signal,
        });
        return { ok: state.status === "completed", status: workflowResultStatus(state.status), mutation: true, state };
      } catch (cause) {
        return { ok: false, status: "WORKFLOW_RESUME_UNAVAILABLE", mutation: true, code: cause?.code ?? "WORKFLOW_RESUME_FAILED", message: cause?.message };
      }
    }
    if (subcommand === "run") {
      let workflow;
      let migration;
      try {
        workflow = await this.registry.resolve(options.workflowId);
        migration = await this.#migration(workflow);
      } catch (cause) {
        return {
          ok: false,
          status: "WORKFLOW_PLAN_UNAVAILABLE",
          mutation: false,
          code: cause?.code ?? "WORKFLOW_PLAN_UNAVAILABLE",
          message: "The requested Workflow could not be compiled for the active Profile.",
        };
      }
      const conditions = options.conditions ?? workflow.manifest.entryConditions;
      const runId = options.runId ?? `workflow-${crypto.randomUUID()}`;
      let input;
      let envelope;
      try {
        input = this.#input(options.inputFile ? await readInputFile(options.inputFile) : options.input);
        envelope = executionEnvelope(migration.plan, {
          runId,
          sourceHash: workflow.sourceHash,
          target: { kind: "workflow", id: workflow.id },
          input,
          conditions,
        });
      } catch (cause) {
        return { ok: false, status: "WORKFLOW_PLAN_BLOCKED", mutation: false, code: cause?.code ?? "INVALID_EXECUTION_ENVELOPE", message: cause?.message ?? "Workflow execution envelope is invalid." };
      }
      if (!options.apply) return {
        ok: true,
        status: "WORKFLOW_PLAN",
        mutation: false,
        kind: "legacy-workflow",
        workflowId: workflow.id,
        sourceHash: workflow.sourceHash,
        migration: migration.migration,
        plan: migration.plan,
        runId,
        input,
        executionEnvelope: envelope,
      };
      if (options.yes !== true) return {
        ok: false,
        status: "CONFIRMATION_REQUIRED",
        mutation: true,
        code: "EXACT_PLAN_CONFIRMATION_REQUIRED",
        plan: migration.plan,
      };
      if (options.expectedPlanDigest !== migration.plan.planDigest) return {
        ok: false,
        status: "WORKFLOW_PLAN_STALE",
        mutation: false,
        code: options.expectedPlanDigest === undefined ? "EXACT_PLAN_DIGEST_REQUIRED" : "PLAN_DIGEST_MISMATCH",
        expectedPlanDigest: options.expectedPlanDigest ?? null,
        currentPlanDigest: migration.plan.planDigest,
      };
      if (options.expectedExecutionDigest === undefined) return {
        ok: false,
        status: "WORKFLOW_PLAN_STALE",
        mutation: false,
        code: "EXACT_EXECUTION_ENVELOPE_REQUIRED",
        currentExecutionDigest: envelope.executionEnvelopeDigest,
      };
      if (options.expectedExecutionDigest !== envelope.executionEnvelopeDigest) return {
        ok: false,
        status: "WORKFLOW_PLAN_STALE",
        mutation: false,
        code: "EXECUTION_ENVELOPE_DRIFT",
        expectedExecutionDigest: options.expectedExecutionDigest,
        currentExecutionDigest: envelope.executionEnvelopeDigest,
      };
      if (!this.orchestration) return {
        ok: false,
        status: "LIVE_WORKFLOW_REQUIRES_PI_SESSION",
        mutation: workflow.manifest.mutationScope !== "none",
        code: "LIVE_RUNTIME_UNAVAILABLE",
        next: "Inject the @only-my-pi/subagents RunCoordinator from a trusted Pi session.",
      };
      if (!workflow.manifest.entryConditions.every((condition) => conditions.includes(condition))) {
        return { ok: false, status: "WORKFLOW_BLOCKED", mutation: false, code: "ENTRY_CONDITIONS_UNSATISFIED" };
      }
      if (runId) this.runPlans.set(runId, migration.plan);
      const state = await this.orchestration.execute(migration.plan, {
        runId,
        input,
        executionEnvelope: envelope,
        approval: options.approval,
        signal: options.signal,
      });
      this.runPlans.set(state.runId, migration.plan);
      return {
        ok: state.status === "completed",
        status: workflowResultStatus(state.status),
        mutation: workflow.manifest.mutationScope !== "none",
        state,
      };
    }
    return { ok: false, status: "WORKFLOW_COMMAND_INVALID", mutation: false, code: "INVALID_WORKFLOW_COMMAND" };
  }
}

export function createWorkflowControlService(options = {}) { return new WorkflowControlService(options); }
