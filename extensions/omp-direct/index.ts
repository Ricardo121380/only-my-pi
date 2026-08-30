import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";

import { createDirectSessionController } from "./runtime.mjs";

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

export default function ompDirect(pi: ExtensionAPI): void {
  if (process.env.ONLY_MY_PI_DIRECT !== "1") return;
  const configRoot = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const controller = createDirectSessionController({ pi, configRoot, environment: process.env });

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
    handler: async (_args, ctx) => ctx.ui.notify("No automatic child agents are active.", "info"),
  });

  pi.on("session_start", async (event, ctx) => {
    await controller.start(event, ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => controller.shutdown(ctx));
  pi.on("before_agent_start", (event) => controller.beforeAgentStart(event));
  pi.on("tool_call", (event) => controller.blockToolCall(event));
  pi.on("user_bash", () => controller.blockUserBash());
  pi.on("model_select", async (event) => {
    await controller.rememberModel(event.model).catch(() => {});
  });
}
