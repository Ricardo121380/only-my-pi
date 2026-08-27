import crypto from "node:crypto";

import { createAgentRegistry } from "../agent-registry/index.mjs";
import { compileWorkflowDefinition } from "../subagents/workflow/plan-compiler/index.mjs";
import { createExecutionEnvelope } from "../subagents/workflow/run-coordinator/index.mjs";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function boundedInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("AGENT_INPUT_INVALID", "Agent input must be a JSON object");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > 128 * 1024) fail("AGENT_INPUT_TOO_LARGE", "Agent input exceeds 128 KiB");
  return Object.freeze(JSON.parse(encoded));
}

function policyFromManifest(manifest) {
  const egress = manifest.policyCeiling.egress;
  return {
    workspace: "shared-read-only",
    mutation: "none",
    egress: {
      web: egress.web === "deny" ? "deny" : "allow",
      mcp: "deny",
      provider: egress.provider === "deny" ? "deny" : "allow",
    },
    tools: {
      allow: manifest.tools.allow.filter((tool) => !["bash", "edit", "write"].includes(tool)),
      deny: [...new Set([...manifest.tools.deny, "bash", "edit", "write"])].sort(),
    },
  };
}

function planDefinition(entry, budget) {
  if (entry.manifest.writer !== false) fail("WRITER_UNAVAILABLE_IN_READONLY_MILESTONE", `Agent ${entry.id} is a writer and is unavailable in M8`);
  const policy = policyFromManifest(entry.manifest);
  const childTokenBudget = Math.max(1, Math.floor(budget.maxTotalTokens / budget.maxChildren));
  const childCostBudget = budget.maxCostUsd / budget.maxChildren;
  const timeoutMs = Math.min(entry.manifest.timeoutSeconds * 1000, budget.maxWallSeconds * 1000);
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id: `agent-${entry.rawId}`,
    version: "2.0.0",
    description: `Single read-only Agent run for ${entry.rawId}`,
    policy,
    budget: {
      maxNodes: 1,
      maxParallel: 1,
      maxDepth: 1,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: timeoutMs,
      maxOutputBytes: budget.maxOutputBytesPerChild,
      maxAssignments: 1,
      maxTokens: childTokenBudget,
      maxCostUsd: childCostBudget,
    },
    flow: {
      kind: "agent",
      id: "agent",
      agentTemplateRef: entry.rawId,
      assignment: { taskTemplateRef: "daily-task" },
      outputSchemaRef: null,
      policy,
      budget: {
        maxAttempts: 1,
        timeoutMs,
        maxOutputBytes: budget.maxOutputBytesPerChild,
        maxTokens: childTokenBudget,
        maxCostUsd: childCostBudget,
      },
      cache: { mode: "content-addressed", keyInputs: ["assignment", "dependencies"] },
      idempotency: "content-addressed",
    },
    terminalNodeId: "agent",
  };
}

function resultStatus(status) {
  return ({ completed: "AGENT_COMPLETED", cancelled: "AGENT_CANCELLED", paused: "AGENT_PAUSED", interrupted: "AGENT_INTERRUPTED", orphaned: "AGENT_ORPHANED", "budget-exhausted": "AGENT_BUDGET_EXHAUSTED" })[status] ?? "AGENT_FAILED";
}

export class AgentControlService {
  constructor({ rootDir, registry, orchestration, configurationProvider } = {}) {
    this.registry = registry ?? createAgentRegistry({ rootDir });
    this.orchestration = orchestration ?? null;
    this.configurationProvider = configurationProvider;
  }

  async #configuration(options) {
    if (typeof this.configurationProvider !== "function") fail("DAILY_CONFIG_UNAVAILABLE", "Agent planning requires daily configuration");
    return this.configurationProvider(options);
  }

  async #plan(options) {
    const entry = await this.registry.resolve(options.agentId);
    const configuration = await this.#configuration(options);
    const input = boundedInput(options.input ?? {});
    if (typeof input.task !== "string" || input.task.trim().length === 0) fail("AGENT_TASK_REQUIRED", "Agent input requires a non-empty task");
    const runId = options.runId ?? `agent-${crypto.randomUUID()}`;
    if (!RUN_ID.test(runId)) fail("INVALID_RUN_ID", "Agent run id is invalid");
    const plan = compileWorkflowDefinition(planDefinition(entry, configuration.budget));
    const executionEnvelope = createExecutionEnvelope(plan, {
      runId,
      sourceHash: entry.sourceHash,
      target: { kind: "workflow", id: `agent:${entry.rawId}` },
      input,
      conditions: ["daily-config-resolved", "read-only-agent"],
    });
    return Object.freeze({ entry, configuration, input, runId, plan, executionEnvelope });
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") {
      const agents = (await this.registry.list()).filter((entry) => entry.manifest.writer === false);
      return { ok: true, status: "AGENT_LIST", mutation: false, agents: agents.map((entry) => ({ id: entry.rawId, description: entry.manifest.description, sourceHash: entry.sourceHash, web: entry.manifest.policyCeiling.egress.web !== "deny" })) };
    }
    if (subcommand === "show") {
      const entry = await this.registry.resolve(options.agentId);
      if (entry.manifest.writer !== false) return { ok: false, status: "AGENT_UNAVAILABLE", code: "WRITER_UNAVAILABLE_IN_READONLY_MILESTONE", mutation: false };
      return { ok: true, status: "AGENT_SHOW", mutation: false, agent: entry.manifest, sourceHash: entry.sourceHash };
    }
    if (["plan", "run"].includes(subcommand)) {
      let prepared;
      try { prepared = await this.#plan(options); } catch (cause) { return { ok: false, status: "AGENT_PLAN_BLOCKED", code: cause?.code ?? "AGENT_PLAN_BLOCKED", message: cause?.message, mutation: false }; }
      const projection = {
        ok: true,
        status: "AGENT_PLAN",
        mutation: false,
        agentId: prepared.entry.rawId,
        runId: prepared.runId,
        input: prepared.input,
        plan: prepared.plan,
        executionEnvelope: prepared.executionEnvelope,
        authority: { mutation: "none", web: prepared.entry.manifest.policyCeiling.egress.web !== "deny" },
      };
      if (subcommand === "plan") return projection;
      if (options.yes !== true) return { ok: false, status: "CONFIRMATION_REQUIRED", code: "EXACT_AGENT_CONFIRMATION_REQUIRED", mutation: true, plan: projection };
      if (options.expectedPlanDigest !== prepared.plan.planDigest || options.expectedExecutionDigest !== prepared.executionEnvelope.executionEnvelopeDigest) {
        return { ok: false, status: "AGENT_PLAN_STALE", code: "AGENT_ADMISSION_DRIFT", mutation: false, currentPlanDigest: prepared.plan.planDigest, currentExecutionDigest: prepared.executionEnvelope.executionEnvelopeDigest };
      }
      if (!this.orchestration) return { ok: false, status: "LIVE_AGENT_REQUIRES_PI_SESSION", code: "LIVE_RUNTIME_UNAVAILABLE", mutation: true };
      const state = await this.orchestration.execute(prepared.plan, { runId: prepared.runId, input: prepared.input, executionEnvelope: prepared.executionEnvelope, signal: options.signal });
      return { ok: state.status === "completed", status: resultStatus(state.status), mutation: true, state };
    }
    if (subcommand === "status") {
      if (!this.orchestration) return { ok: false, status: "AGENT_STATUS_UNAVAILABLE", code: "LIVE_RUNTIME_UNAVAILABLE", mutation: false };
      try { return { ok: true, status: "AGENT_STATUS", mutation: false, state: await this.orchestration.inspect(options.runId) }; }
      catch (cause) { return { ok: false, status: "AGENT_STATUS_UNAVAILABLE", code: cause?.code ?? "RUN_NOT_FOUND", mutation: false }; }
    }
    if (subcommand === "cancel") {
      if (!this.orchestration) return { ok: false, status: "AGENT_CANCEL_UNAVAILABLE", code: "LIVE_RUNTIME_UNAVAILABLE", mutation: true };
      return { ok: true, status: "AGENT_CANCEL", mutation: true, result: await this.orchestration.cancel(options.runId) };
    }
    if (subcommand === "resume") {
      if (!this.orchestration?.resume) return { ok: false, status: "AGENT_RESUME_UNAVAILABLE", code: "PLAN_STORE_UNAVAILABLE", mutation: true };
      try {
        const input = boundedInput(options.input ?? {});
        const state = await this.orchestration.resume(options.runId, { input, signal: options.signal });
        return { ok: state.status === "completed", status: resultStatus(state.status), mutation: true, state };
      } catch (cause) { return { ok: false, status: "AGENT_RESUME_UNAVAILABLE", code: cause?.code ?? "AGENT_RESUME_FAILED", message: cause?.message, mutation: true }; }
    }
    return { ok: false, status: "AGENT_COMMAND_INVALID", code: "INVALID_AGENT_COMMAND", mutation: false };
  }
}

export function createAgentControlService(options = {}) { return new AgentControlService(options); }
export { planDefinition as createSingleAgentWorkflowDefinition, policyFromManifest as agentPolicyFromManifest };
