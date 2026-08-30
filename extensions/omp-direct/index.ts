import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";

import { createDirectSessionController } from "./runtime.mjs";
import {
  DIRECT_READ_ONLY_AGENTS,
  DIRECT_RUNTIME_EVENT,
} from "../../packages/direct-agent/orchestration.mjs";

const CodingAccessParameters = {
  type: "object",
  additionalProperties: false,
  required: ["taskSummary", "complexity", "scope", "riskFlags", "verification", "orchestration"],
  properties: {
    taskSummary: { type: "string", minLength: 1, maxLength: 2000 },
    complexity: { type: "string", enum: ["simple", "complex"] },
    scope: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 512 } },
    riskFlags: {
      type: "array",
      maxItems: 8,
      uniqueItems: true,
      items: { type: "string", enum: ["public-api", "dependency", "schema", "security", "concurrency", "migration", "deletion", "release"] },
    },
    plan: { type: "string", maxLength: 16384 },
    verification: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 500 } },
    orchestration: {
      type: "object",
      additionalProperties: false,
      required: ["useReadOnlyScouts", "useManagedCloneWriter", "useFreshReviewer"],
      properties: {
        useReadOnlyScouts: { type: "boolean" },
        useManagedCloneWriter: { type: "boolean" },
        useFreshReviewer: { type: "boolean" },
      },
    },
  },
} as any;

const ReadOnlyDelegationParameters = {
  type: "object",
  additionalProperties: false,
  required: ["agent", "task"],
  properties: {
    agent: { type: "string", enum: [...DIRECT_READ_ONLY_AGENTS] },
    task: { type: "string", minLength: 1, maxLength: 32768 },
    label: { type: "string", minLength: 1, maxLength: 128 },
  },
} as any;

const ManagedWriterParameters = {
  type: "object",
  additionalProperties: false,
  properties: {
    scope: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 512 } },
  },
} as any;

export default function ompDirect(pi: ExtensionAPI): void {
  if (process.env.ONLY_MY_PI_DIRECT !== "1") return;
  const configRoot = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const controller = createDirectSessionController({ pi, configRoot, environment: process.env });

  pi.events.on(DIRECT_RUNTIME_EVENT, (payload: any) => {
    controller.attachOrchestrator(payload?.formatVersion === 1 && payload?.status === "READY" ? payload.orchestrator : null);
  });

  pi.registerTool({
    name: "request_coding_access",
    label: "Request coding access",
    description: "Request one process-scoped approval before modifying the active project. Complex tasks require a complete plan.",
    promptSnippet: "Request one process-local project coding grant after inspection and planning",
    promptGuidelines: ["Call request_coding_access by itself before the first edit, write, bash, project gate, or writer child in this OMP process."],
    parameters: CodingAccessParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return controller.requestCodingAccess(params, ctx) as any;
    },
  });

  pi.registerTool({
    name: "delegate_readonly_agent",
    label: "Delegate read-only analysis",
    description: "Run one bounded read-only OMP specialist through the shared pi-subagents runtime. Use only for independent evidence or fresh review.",
    promptSnippet: "Delegate bounded independent read-only work to a visible OMP specialist",
    promptGuidelines: ["Use no more children than the task needs. Children cannot delegate and cannot modify the project."],
    parameters: ReadOnlyDelegationParameters,
    executionMode: "parallel",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return controller.delegateReadOnly(params, ctx, signal) as any;
    },
  });

  pi.registerTool({
    name: "delegate_managed_writer",
    label: "Delegate approved managed writer",
    description: "Use the single approved managed-clone writer for a complex coding plan. OMP reviews and verifies its patch before applying it.",
    promptSnippet: "Delegate an approved complex implementation to the single managed-clone writer",
    promptGuidelines: ["Call only after coding access explicitly approved a managed writer; verify an applied patch again in the real worktree."],
    parameters: ManagedWriterParameters,
    executionMode: "sequential",
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return controller.delegateManagedWriter(params, ctx, signal) as any;
    },
  });

  pi.registerCommand("exit", {
    description: "Gracefully exit only-my-pi and return to the shell",
    handler: async (_args, ctx) => ctx.shutdown(),
  });
  pi.registerCommand("plan", {
    description: "Plan a task read-only, then request one coding approval",
    handler: async (args, ctx) => controller.enterPlanning(args, ctx),
  });
  pi.registerCommand("access", {
    description: "Show or revoke this process's project coding access",
    handler: async (args, ctx) => controller.accessCommand(args, ctx),
  });
  pi.registerCommand("agents", {
    description: "Show automatic OMP child-agent activity",
    handler: async (_args, ctx) => controller.agentsCommand(ctx),
  });

  pi.on("session_start", async (event, ctx) => {
    await controller.start(event, ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => controller.shutdown(ctx));
  pi.on("before_agent_start", (event) => controller.beforeAgentStart(event));
  pi.on("tool_call", (event) => controller.blockToolCall(event));
  pi.on("user_bash", (event) => controller.inspectUserBash(event));
  pi.on("model_select", async (event) => {
    await controller.rememberModel(event.model).catch(() => {});
  });
}
