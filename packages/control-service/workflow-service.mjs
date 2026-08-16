import { createAgentRegistry } from "../agent-registry/index.mjs";
import { createGateRunner } from "../gate-runner/index.mjs";
import { createSingleAgentWorkflowRunner, createWorkflowRegistry } from "../workflow-core/index.mjs";

export class WorkflowControlService {
  constructor({ rootDir, registry, runner, agentRegistry, gateRunner } = {}) {
    this.rootDir = rootDir;
    this.gateRunner = gateRunner ?? createGateRunner({ rootDir });
    this.agentRegistry = agentRegistry ?? createAgentRegistry({ rootDir });
    this.registry = registry ?? createWorkflowRegistry({ rootDir, gateRunner: this.gateRunner, agentRegistry: this.agentRegistry });
    this.runner = runner ?? createSingleAgentWorkflowRunner({ registry: this.registry, agentRegistry: this.agentRegistry, gateRunner: this.gateRunner });
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
      const state = await this.runner.stateStore?.get?.(options.runId);
      return state ? { ok: true, status: "WORKFLOW_STATUS", mutation: false, state } : { ok: false, status: "WORKFLOW_RUN_NOT_FOUND", mutation: false, code: "UNKNOWN_RUN" };
    }
    if (subcommand === "cancel") return { ok: true, status: "WORKFLOW_CANCEL", mutation: false, result: await this.runner.cancel(options.runId) };
    if (subcommand === "run") {
      const workflow = await this.registry.resolve(options.workflowId);
      if (!options.apply) return { ok: true, status: "WORKFLOW_PLAN", mutation: false, workflowId: workflow.id, sourceHash: workflow.sourceHash, steps: workflow.manifest.steps.map((step) => ({ id: step.id, action: step.action, agent: step.agent ?? null, gate: step.gate ?? null, needs: step.needs })) };
      const state = await this.runner.run(options.workflowId, { runId: options.runId, input: options.input ?? {}, profile: options.profile, conditions: options.conditions ?? workflow.manifest.entryConditions, signal: options.signal });
      return { ok: state.verdict === "pass", status: state.status === "completed" ? "WORKFLOW_COMPLETED" : state.status === "failed" ? "WORKFLOW_FAILED" : "WORKFLOW_BLOCKED", mutation: workflow.manifest.mutationScope !== "none", state };
    }
    return { ok: false, status: "WORKFLOW_COMMAND_INVALID", mutation: false, code: "INVALID_WORKFLOW_COMMAND" };
  }
}

export function createWorkflowControlService(options = {}) { return new WorkflowControlService(options); }
