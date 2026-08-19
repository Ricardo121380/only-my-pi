import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createBatchSwarmNodeExecutor,
} from "../subagents/batch-swarm/index.mjs";
import { createBatchSwarmRegistry } from "../subagents/batch-swarm/registry.mjs";
import { compileWorkflowDefinition } from "../subagents/workflow/plan-compiler/index.mjs";
import { createExecutionEnvelope } from "../subagents/workflow/run-coordinator/index.mjs";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const MAX_INPUT_BYTES = 256 * 1024;

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
    if (!Number.isFinite(value)) throw controlError(`${location} must contain finite JSON numbers`, "INVALID_BATCH_INPUT");
    return value;
  }
  if (Array.isArray(value)) return value.map((child, index) => canonicalInput(child, `${location}[${index}]`));
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw controlError(`${location} must be plain JSON`, "INVALID_BATCH_INPUT");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalInput(value[key], `${location}.${key}`)]));
}

function prepareInput(value) {
  const normalized = deepFreeze(canonicalInput(value ?? {}));
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) throw controlError("batch input must be a JSON object", "INVALID_BATCH_INPUT");
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > MAX_INPUT_BYTES) throw controlError("batch input exceeds 256 KiB", "BATCH_INPUT_TOO_LARGE");
  return normalized;
}

async function readInputFile(inputFile) {
  if (typeof inputFile !== "string" || !path.isAbsolute(inputFile)) throw controlError("batch input file must be an absolute path", "INVALID_INPUT_FILE");
  const target = path.resolve(inputFile);
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw controlError("batch input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
    if (stat.size > MAX_INPUT_BYTES) throw controlError("batch input file exceeds 256 KiB", "BATCH_INPUT_TOO_LARGE");
    const contents = await handle.readFile();
    if (contents.byteLength > MAX_INPUT_BYTES) throw controlError("batch input file exceeds 256 KiB", "BATCH_INPUT_TOO_LARGE");
    return prepareInput(JSON.parse(contents.toString("utf8")));
  } catch (cause) {
    if (["ELOOP", "EMLINK"].includes(cause?.code)) throw controlError("batch input file must be a regular non-symlink file", "INVALID_INPUT_FILE");
    if (cause instanceof SyntaxError) throw controlError("batch input file must contain valid JSON", "INVALID_BATCH_INPUT");
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function policyFromAgentSpec(agentSpec) {
  const policy = agentSpec.effectivePolicy;
  return deepFreeze({
    workspace: policy.workspace,
    mutation: policy.mutation === "none" ? "none" : "guarded",
    egress: {
      web: policy.egress.web === "deny" ? "deny" : "allow",
      mcp: policy.egress.mcp === "deny" ? "deny" : "allow",
      provider: policy.egress.provider === "deny" ? "deny" : "allow",
    },
    tools: {
      allow: [...agentSpec.tools.allow].sort(),
      deny: [...agentSpec.tools.deny].sort(),
    },
  });
}

function workflowDefinition(entry) {
  const batch = entry.definition;
  const policy = policyFromAgentSpec(entry.agentSpec);
  return deepFreeze({
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id: `batch-${batch.id}`,
    version: "2.0.0",
    description: `Homogeneous BatchSwarm execution for ${batch.id}`,
    policy,
    budget: {
      maxNodes: 1,
      maxParallel: 1,
      maxDepth: 1,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: batch.retryPolicy.deadlineMs,
      maxOutputBytes: 16 * 1024 * 1024,
      maxAssignments: batch.maxItems * batch.retryPolicy.maxAttempts,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: {
      kind: "batch-swarm",
      id: "batch",
      batchRef: batch.id,
      policy,
      budget: {
        maxAttempts: 1,
        timeoutMs: batch.retryPolicy.deadlineMs,
        maxOutputBytes: 16 * 1024 * 1024,
      },
      cache: { mode: "content-addressed", keyInputs: [`artifacts.${batch.itemsFrom.slice("artifact://".length)}`] },
      idempotency: "content-addressed",
    },
    terminalNodeId: "batch",
  });
}

function staticCapabilityMatrix() {
  return deepFreeze({
    capabilities: {
      perItemResult: { state: "SUPPORTED" },
      rateLimitSignal: { state: "UNAVAILABLE" },
      dynamicConcurrency: { state: "UNAVAILABLE" },
    },
  });
}

function resultStatus(status) {
  return ({
    completed: "BATCH_SWARM_COMPLETED",
    cancelled: "BATCH_SWARM_CANCELLED",
    paused: "BATCH_SWARM_PAUSED",
    "awaiting-approval": "BATCH_SWARM_AWAITING_APPROVAL",
    interrupted: "BATCH_SWARM_INTERRUPTED",
    orphaned: "BATCH_SWARM_ORPHANED",
  })[status] ?? "BATCH_SWARM_FAILED";
}

export class BatchSwarmControlService {
  constructor({ rootDir, registry, orchestration, capabilityMatrix } = {}) {
    this.rootDir = rootDir;
    this.registry = registry ?? createBatchSwarmRegistry({ rootDir });
    this.orchestration = orchestration ?? null;
    this.capabilityMatrix = capabilityMatrix ?? staticCapabilityMatrix();
    this.runPlans = new Map();
  }

  async #input(options) {
    return options.inputFile ? readInputFile(options.inputFile) : prepareInput(options.input);
  }

  async #plan(options) {
    const entry = await this.registry.resolve(options.batchId);
    const definition = workflowDefinition(entry);
    const plan = compileWorkflowDefinition(definition, { resolveBatch: (id) => id === entry.id ? entry.definition : null });
    const runId = options.runId ?? `batch-${crypto.randomUUID()}`;
    if (!RUN_ID.test(runId)) throw controlError("batch run id is invalid", "INVALID_RUN_ID");
    const input = await this.#input(options);
    const executor = createBatchSwarmNodeExecutor({
      resolveBatch: async () => entry.definition,
      resolveAgentSpec: async () => entry.agentSpec,
      resolvePromptTemplate: async () => entry.promptTemplate,
      capabilityMatrix: this.capabilityMatrix,
      executeItem: async () => { throw controlError("offline batch planning cannot execute an item", "OFFLINE_PLAN_DISPATCH_FORBIDDEN"); },
    });
    const prepared = await executor.prepareBatch(plan.nodes[0], {
      runId,
      attemptId: "offline-plan",
      input,
      priorBatchEvents: [],
    });
    const executionEnvelope = createExecutionEnvelope(plan, {
      runId,
      sourceHash: entry.sourceHash,
      target: { kind: "swarm", id: entry.id },
      input,
      conditions: options.conditions ?? [],
    });
    return deepFreeze({
      entry,
      plan,
      runId,
      input,
      executionEnvelope,
      expansion: {
        batchId: entry.id,
        batchDigest: prepared.batchDigest,
        itemCount: prepared.itemCount,
        degradedToAgent: prepared.degradedToAgent,
        maximumAssignments: prepared.reservation.assignments,
        concurrency: entry.definition.concurrency,
        items: prepared.items.map(({ index, itemId, itemDigest }) => ({ index, itemId, itemDigest })),
      },
    });
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") {
      const batches = await this.registry.list();
      return {
        ok: true,
        status: "BATCH_SWARM_LIST",
        mutation: false,
        batches: batches.map((entry) => ({
          id: entry.id,
          agentSpecRef: entry.definition.agentSpecRef,
          maxItems: entry.definition.maxItems,
          concurrency: entry.definition.concurrency,
          sourceHash: entry.sourceHash,
        })),
      };
    }
    if (subcommand === "show") {
      const entry = await this.registry.resolve(options.batchId);
      return { ok: true, status: "BATCH_SWARM_SHOW", mutation: false, batch: entry.definition, sourceHash: entry.sourceHash, source: entry.source };
    }
    if (subcommand === "validate") return options.batchId
      ? this.registry.resolve(options.batchId).then((entry) => ({ ok: true, status: "BATCH_SWARM_VALID", mutation: false, batchId: entry.id, sourceHash: entry.sourceHash }))
      : this.registry.doctor();
    if (["plan", "run"].includes(subcommand)) {
      let prepared;
      try {
        prepared = await this.#plan(options);
      } catch (cause) {
        return { ok: false, status: "BATCH_SWARM_PLAN_BLOCKED", mutation: false, code: cause?.code ?? "BATCH_SWARM_PLAN_BLOCKED", message: cause?.message };
      }
      if (subcommand === "plan") return {
        ok: true,
        status: "BATCH_SWARM_PLAN",
        mutation: false,
        batchId: prepared.entry.id,
        sourceHash: prepared.entry.sourceHash,
        plan: prepared.plan,
        runId: prepared.runId,
        input: prepared.input,
        executionEnvelope: prepared.executionEnvelope,
        expansion: prepared.expansion,
        liveDispatch: "NOT_RUN_BY_POLICY",
      };
      if (options.yes !== true) return { ok: false, status: "CONFIRMATION_REQUIRED", mutation: true, code: "EXACT_PLAN_CONFIRMATION_REQUIRED", plan: prepared.plan, expansion: prepared.expansion };
      if (options.expectedPlanDigest !== prepared.plan.planDigest) return {
        ok: false,
        status: "BATCH_SWARM_PLAN_STALE",
        mutation: false,
        code: options.expectedPlanDigest === undefined ? "EXACT_PLAN_DIGEST_REQUIRED" : "PLAN_DIGEST_MISMATCH",
        currentPlanDigest: prepared.plan.planDigest,
      };
      if (options.expectedExecutionDigest !== prepared.executionEnvelope.executionEnvelopeDigest) return {
        ok: false,
        status: "BATCH_SWARM_PLAN_STALE",
        mutation: false,
        code: options.expectedExecutionDigest === undefined ? "EXACT_EXECUTION_ENVELOPE_REQUIRED" : "EXECUTION_ENVELOPE_DRIFT",
        currentExecutionDigest: prepared.executionEnvelope.executionEnvelopeDigest,
      };
      if (!this.orchestration) return {
        ok: false,
        status: "LIVE_BATCH_SWARM_REQUIRES_PI_SESSION",
        mutation: true,
        code: "LIVE_RUNTIME_UNAVAILABLE",
        liveDispatch: "NOT_RUN_BY_POLICY",
        next: "Inject the trusted @only-my-pi/subagents RunCoordinator from a Pi session.",
      };
      this.runPlans.set(prepared.runId, prepared.plan);
      const state = await this.orchestration.execute(prepared.plan, {
        runId: prepared.runId,
        input: prepared.input,
        executionEnvelope: prepared.executionEnvelope,
        approval: options.approval,
        signal: options.signal,
      });
      return { ok: state.status === "completed", status: resultStatus(state.status), mutation: true, state };
    }
    if (subcommand === "status") {
      if (!options.runId) return { ok: false, status: "BATCH_SWARM_STATUS_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration) return { ok: false, status: "BATCH_SWARM_STATUS_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      const plan = this.runPlans.get(options.runId);
      try {
        const state = await this.orchestration.inspect(options.runId, plan);
        return { ok: true, status: "BATCH_SWARM_STATUS", mutation: false, state };
      } catch (cause) {
        return { ok: false, status: "BATCH_SWARM_STATUS_UNAVAILABLE", mutation: false, code: cause?.code ?? "RUN_NOT_FOUND" };
      }
    }
    if (subcommand === "cancel") {
      if (!options.runId) return { ok: false, status: "BATCH_SWARM_CANCEL_UNAVAILABLE", mutation: true, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration) return { ok: false, status: "BATCH_SWARM_CANCEL_UNAVAILABLE", mutation: true, code: "LIVE_RUNTIME_UNAVAILABLE" };
      return { ok: true, status: "BATCH_SWARM_CANCEL", mutation: true, result: await this.orchestration.cancel(options.runId) };
    }
    if (subcommand === "resume") {
      if (!options.runId) return { ok: false, status: "BATCH_SWARM_RESUME_UNAVAILABLE", mutation: true, code: "RUN_ID_REQUIRED" };
      if (!this.orchestration || typeof this.orchestration.resume !== "function") return { ok: false, status: "BATCH_SWARM_RESUME_UNAVAILABLE", mutation: true, code: "PLAN_STORE_UNAVAILABLE" };
      try {
        const input = await this.#input(options);
        const state = await this.orchestration.resume(options.runId, { input, approval: options.approval, signal: options.signal });
        return { ok: state.status === "completed", status: resultStatus(state.status), mutation: true, state };
      } catch (cause) {
        return { ok: false, status: "BATCH_SWARM_RESUME_UNAVAILABLE", mutation: true, code: cause?.code ?? "BATCH_SWARM_RESUME_FAILED", message: cause?.message };
      }
    }
    return { ok: false, status: "BATCH_SWARM_COMMAND_INVALID", mutation: false, code: "INVALID_BATCH_SWARM_COMMAND" };
  }
}

export function createBatchSwarmControlService(options = {}) {
  return new BatchSwarmControlService(options);
}
