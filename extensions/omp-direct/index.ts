import type { BashOperations, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";
import { DirectSessionOwnership } from "../../packages/direct-agent/ownership.mjs";
import { createOwnedBashOperations } from "../../packages/direct-agent/shell.mjs";
import { disableOmpCacheWarming } from "../../packages/direct-agent/cache-warming-policy.mjs";

import {
  DIRECT_READ_ONLY_AGENTS,
  createDirectSessionController,
} from "./runtime.mjs";

const DIRECT_RUNTIME_EVENT = "only-my-pi:direct-runtime:v1";

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

export default async function ompDirect(pi: ExtensionAPI): Promise<void> {
  if (process.env.ONLY_MY_PI_DIRECT !== "1") return;
  // Native clients belong to the controlled direct runtime. A Harness-only
  // generation loads this entrypoint with the direct session disabled.
  const { installOmpCodemode } = await import("../../packages/direct-agent/codemode.mjs");
  const { installOmpMcp } = await import("../../packages/mcp/extension.mjs");
  const { mcpCommand, prepareMcpCommand } = await import("../../packages/mcp/commands.mjs");
  // Also covers the native CLI's ephemeral --no-session path and legacy RPC.
  disableOmpCacheWarming(pi);
  const configRoot = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const ownership = new DirectSessionOwnership(configRoot);
  let ownsSession: ((ctx: any) => boolean) | undefined;
  let verifyHostProject: ((ctx: any) => Promise<any>) | undefined;
  let ownsDirectSession: ((ctx: any) => boolean) | undefined;
  let ownershipReady = false;
  pi.events.on("only-my-pi:host-session-owner:v1", (payload: any) => {
    if (typeof payload?.ownsSession === "function") ownsSession = payload.ownsSession;
    if (typeof payload?.verifyProject === "function") verifyHostProject = payload.verifyProject;
  });
  pi.events.on("only-my-pi:direct-session-owner:v1", (payload: any) => {
    if (typeof payload?.ownsSession === "function") ownsDirectSession = payload.ownsSession;
  });
  const ownedShell = createOwnedBashOperations();
  const controller = createDirectSessionController({ pi, configRoot, environment: process.env,
    acquireProject: async (ctx: any) => { if (!ownsSession?.(ctx)) await ownership.acquire("project", ctx.cwd); },
    verifyProject: async (ctx: any) => ownsSession?.(ctx) ? verifyHostProject?.(ctx) : ownership.verifyProject(ctx.cwd),
  });
  const { installProductSettings } = await import("../../packages/product-settings/runtime.mjs");
  pi.events.on("only-my-pi:product-task:v1", (snapshot: any) => installProductSettings(pi, { configRoot, snapshot, controller }));
  const mcp = installOmpMcp(pi, { configRoot, controller });
  await installOmpCodemode(pi, { controller });
  const shellOperations: BashOperations = { exec: (command, cwd, options) => ownedShell.exec(command, cwd, {
    ...options, signal: AbortSignal.any([options.signal, controller.grantAbort?.signal].filter((signal): signal is AbortSignal => !!signal)),
  }) };
  let shellReady = false;
  // The permission extension remains the sole bash tool owner, preserving its
  // sandbox and policy. The pinned build adapter delegates its process launch.
  pi.events.emit("only-my-pi:owned-shell:v1", { operations: shellOperations, accept: () => { shellReady = true; } });

  // Only the trusted SDK bootstrap publishes this process-local object. No
  // environment flag or serializable RPC command can create this capability.
  pi.events.on("only-my-pi:host-interaction:v1", (payload: any) => {
    if (controller.hostInteraction || !payload?.capability || typeof payload.register !== "function") return;
    if (!["bind", "allows", "invalidate"].every((key) => typeof payload.capability[key] === "function")) return;
    controller.hostInteraction = payload.capability;
    payload.register(controller);
    payload.registerExecutionProbe?.(() => ({ active: mcp.clean() ? 0 : 1, unconfirmed: !mcp.clean() }));
  });

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
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      controller.hostInteraction?.bind(ctx);
      return controller.requestCodingAccess(params, ctx, signal) as any;
    },
  });

  pi.registerTool({
    name: "delegate_readonly_agent",
    label: "Delegate read-only analysis",
    description: "Run one bounded read-only OMP specialist through pi-subagents. Researcher/source-verifier require separate interactive public-Web approval; other roles cannot use Web.",
    promptSnippet: "Delegate bounded independent read-only work to a visible OMP specialist",
    promptGuidelines: ["Use no more children than the task needs. Children cannot delegate and cannot modify the project.", "Call Web research delegation alone so its public internet confirmation is clear; coding access does not authorize Web."],
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
  pi.registerCommand("mcp", {
    description: "OMP MCP: list, status, preview /absolute/raw.json, apply /absolute/action.json",
    handler: async (args, ctx) => {
      try {
        const input = await prepareMcpCommand(args);
        if (!["list", "status", "previewImport"].includes(input.type)
          && !await ctx.ui.confirm("保存 MCP 配置", `操作 ${input.type}；仅影响后续任务，默认不取得工具授权。确认将此操作保存到当前项目？`)) return;
        ctx.ui.notify(JSON.stringify(await mcpCommand(configRoot, input, ctx.cwd), null, 2), "info");
      } catch (error: any) { ctx.ui.notify(/^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "MCP_COMMAND_FAILED", "error"); }
    },
  });

  pi.on("session_start", async (event, ctx) => {
    controller.hostInteraction?.bind(ctx);
    ownershipReady = false;
    if (!shellReady && process.env.ONLY_MY_PI_HEADLESS !== "1") {
      ctx.ui.notify("OWNED_SHELL_UNAVAILABLE: rebuild the controlled runtime", "error");
      ctx.shutdown();
      return;
    }
    if (!ownsSession?.(ctx) && !ownsDirectSession?.(ctx)) {
      try { await ownership.acquire("session", ctx.sessionManager.getSessionId()); }
      catch {
        controller.shutdown(ctx);
        ctx.ui.notify("SESSION_OWNERSHIP_UNAVAILABLE: this session is owned elsewhere or needs reconciliation.", "error");
        // Print mode's shutdown callback may be a no-op. The input/tool guards
        // below still prevent it from submitting a model request or executing.
        if (ctx.mode === "print" || ctx.mode === "json") { process.stderr.write("SESSION_OWNERSHIP_UNAVAILABLE\n"); process.exitCode = 1; }
        ctx.shutdown(); return;
      }
    }
    ownershipReady = true;
    await controller.start(event, ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    controller.hostInteraction?.invalidate(); controller.shutdown(ctx);
    ownershipReady = false;
    if (!mcp.clean()) throw new Error("MCP_PROCESS_RECONCILIATION_REQUIRED");
    await ownership.close();
  });
  pi.on("input", () => ownershipReady ? undefined : { action: "handled" as const });
  pi.on("before_agent_start", (event) => controller.beforeAgentStart(event));
  pi.on("tool_call", (event) => ownershipReady ? controller.blockToolCall(event) : { block: true, reason: "SESSION_OWNERSHIP_UNAVAILABLE" });
  pi.on("tool_result", (event) => { controller.mutationCalls.delete(event.toolCallId); });
  pi.on("user_bash", (event) => !ownershipReady ? { result: { output: "SESSION_OWNERSHIP_UNAVAILABLE", exitCode: 126, cancelled: false, truncated: false } } : controller.inspectUserBash(event) ?? { operations: shellOperations });
  pi.on("model_select", async (event) => {
    await controller.rememberModel(event.model).catch(() => {});
  });
}
