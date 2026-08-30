import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContextSnapshotProvider, createOmpRuntime } from "./runtime.mjs";
import { DIRECT_RUNTIME_EVENT } from "../../packages/direct-agent/orchestration.mjs";

export default function ompControl(pi: ExtensionAPI): void {
  let messages: unknown[] = [];
  let systemPromptCharacters: number | undefined;
  let turnIndex: number | undefined;
  let context: any;
  let runtime: ReturnType<typeof createOmpRuntime> | undefined;
  let sessionComposer: any;
  let runtimeServices: any = {};
  let sessionRuntimeStatus = "NOT_INITIALIZED";
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const configRoot = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
  let pendingModePrompt: { text: string; modeId: string; hash: string } | undefined;
  let activeModeSnapshot: any;
  let modeRestoreStatus: string | undefined;
  const directSession = process.env.ONLY_MY_PI_DIRECT === "1";

  const publishDirectRuntime = (status: "READY" | "UNAVAILABLE", orchestrator?: any) => {
    if (!directSession) return;
    pi.events.emit(DIRECT_RUNTIME_EVENT, {
      formatVersion: 1,
      status,
      orchestrator: status === "READY" ? orchestrator : null,
    });
  };

  // This is intentionally a session adapter, not a second permission owner.
  // It exposes only Pi's public idle/prompt/status/append seams.  Hard
  // execution-state changes still require a separate audited driver and are
  // therefore returned as RESTART_REQUIRED by the Mode Registry.
  const sessionDriver = {
    isIdle: () => typeof context?.isIdle === "function" && context.isIdle(),
    readMode: () => activeModeSnapshot ?? null,
    injectPrompt: async (payloads: any[], target: any) => {
      const text = payloads.map((payload) => payload?.content).filter((value) => typeof value === "string").join("\n\n");
      pendingModePrompt = { text: text.slice(0, 16_384), modeId: target.modeId, hash: target.hash };
      activeModeSnapshot = target;
    },
    setStatus: async ({ modeId, hash }: { modeId: string; hash: string }) => {
      if (context?.mode === "tui") context.ui.setStatus("only-my-pi-mode", `${modeId} ${hash.slice(0, 12)}`);
    },
    appendEntry: async (entry: any) => {
      if (typeof pi.appendEntry === "function") {
        await pi.appendEntry("only-my-pi-mode", {
          type: entry?.type === "mode_changed" ? "mode_changed" : "mode_event",
          modeId: typeof entry?.modeId === "string" ? entry.modeId : null,
          hash: typeof entry?.hash === "string" ? entry.hash : null,
          sourceHash: typeof entry?.sourceHash === "string" ? entry.sourceHash : null,
          // The receipt is produced by Mode Registry and deliberately omits
          // prompt text, host paths, credentials, and provider settings.
          receipt: entry?.receipt ?? null,
        });
      }
    },
  };

  const getRuntime = () => {
    if (!runtime) {
      runtime = createOmpRuntime({
        rootDir,
        configRoot,
        ...runtimeServices,
        sessionDriver,
        onModeRestored: async (target: any, result: any) => {
          activeModeSnapshot = target;
          const text = (target?.promptPayloads ?? [])
            .map((payload: any) => payload?.content)
            .filter((value: unknown): value is string => typeof value === "string")
            .join("\n\n")
            .slice(0, 16_384);
          pendingModePrompt = text ? { text, modeId: target.modeId, hash: target.hash } : undefined;
          modeRestoreStatus = result.status;
        },
        onModeStale: async (result: any) => {
          activeModeSnapshot = undefined;
          pendingModePrompt = undefined;
          modeRestoreStatus = result.status;
        },
        getModeRestoreStatus: () => modeRestoreStatus,
        snapshotProvider: createContextSnapshotProvider({
          pi,
          getState: () => ({ messages, ctx: context, systemPromptCharacters, turnIndex }),
        }),
      });
    }
    return runtime;
  };

  pi.on("before_agent_start", (event) => {
    systemPromptCharacters = event.systemPrompt.length;
    if (!pendingModePrompt) return;
    const mode = pendingModePrompt;
    pendingModePrompt = undefined;
    return {
      systemPrompt: `${event.systemPrompt}\n\n## only-my-pi Mode: ${mode.modeId}\n${mode.text}`,
    };
  });

  pi.on("turn_start", (event) => {
    turnIndex = event.turnIndex;
  });

  pi.on("context", (event, ctx) => {
    messages = event.messages;
    context = ctx;
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-control", "omp");
  });

  pi.on("session_start", async (_event, ctx) => {
    messages = [];
    context = ctx;
    systemPromptCharacters = undefined;
    turnIndex = undefined;
    activeModeSnapshot = undefined;
    pendingModePrompt = undefined;
    modeRestoreStatus = undefined;
    runtime = undefined;
    runtimeServices = {};
    await sessionComposer?.dispose?.().catch(() => {});
    sessionComposer = undefined;
    sessionRuntimeStatus = "INITIALIZING";
    try {
      const module: any = await import("../../packages/subagents/runtime/session-composer.mjs");
      sessionComposer = await module.createSessionRuntimeComposer({
        pi,
        rootDir,
        configRoot,
        getContext: () => context,
      });
      sessionRuntimeStatus = sessionComposer.status;
      runtimeServices = sessionComposer.enabled === true ? {
        subagentsOrchestration: sessionComposer.coordinator,
        goalController: sessionComposer.goalController,
        batchService: sessionComposer.batchControl,
        ultraRouter: sessionComposer.ultraRouter,
        configurationProvider: sessionComposer.configurationProvider,
        projectGateService: sessionComposer.projectGateService,
        webAuthorizer: sessionComposer.webAuthorizer,
        runManagement: sessionComposer.runManagement,
        dailyConfigService: sessionComposer.dailyConfig,
      } : {
        dailyConfigService: sessionComposer.dailyConfig,
      };
      publishDirectRuntime(sessionComposer.directCodingOrchestrator ? "READY" : "UNAVAILABLE", sessionComposer.directCodingOrchestrator);
    } catch (error: any) {
      sessionRuntimeStatus = error?.code ?? "SESSION_RUNTIME_UNAVAILABLE";
      publishDirectRuntime("UNAVAILABLE");
      if (ctx.mode === "tui") ctx.ui?.notify?.(`only-my-pi live runtime unavailable: ${sessionRuntimeStatus}`, "warning");
    }
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-control", "omp");
    const entries = typeof ctx.sessionManager?.getEntries === "function" ? ctx.sessionManager.getEntries() : null;
    let restored: { status: string; code?: string };
    try {
      restored = await getRuntime().restoreSession(entries);
    } catch (_error) {
      // Session restore is evidence-only. A malformed or unavailable registry
      // must not prevent Pi from starting or expose a raw filesystem error.
      restored = { status: "MODE_RECEIPT_UNAVAILABLE", code: "MODE_REGISTRY_UNAVAILABLE" };
    }
    modeRestoreStatus = restored.status;
    if (restored.status === "STALE_MODE_SNAPSHOT") {
      ctx.ui?.notify?.("only-my-pi mode receipt is stale; no mode prompt was restored", "warning");
    } else if (restored.status === "MODE_RECEIPT_IGNORED") {
      ctx.ui?.notify?.("only-my-pi mode receipt was ignored as invalid", "warning");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-control", undefined);
    publishDirectRuntime("UNAVAILABLE");
    await sessionComposer?.dispose?.().catch(() => {});
    sessionComposer = undefined;
    runtime = undefined;
    runtimeServices = {};
    sessionRuntimeStatus = "SHUTDOWN";
  });

  const handler = async (args: string, ctx: any) => {
    try {
      let command = typeof args === "string" ? args.trim() : "";
      if (directSession) {
        if (command === "" || command === "run") {
          ctx.ui.notify("You are already inside the OMP Agent. Type a task directly; use /omp advanced ... only for expert diagnostics.", "info");
          return;
        }
        if (command === "advanced") {
          ctx.ui.notify("Usage: /omp advanced <agent|workflow|swarm|goal|ultra> ...", "info");
          return;
        }
        if (command.startsWith("advanced ")) command = command.slice("advanced ".length).trim();
        else if (/^(?:agent|workflow|swarm|goal|ultra)(?:\s|$)/u.test(command)) {
          ctx.ui.notify("This legacy executor is now expert-only. Use /omp advanced " + command, "warning");
          return;
        }
      }
      return await getRuntime().execute(command, { ...ctx, pi });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`status: ERROR\nmessage: ${message.replace(/[\r\n]/gu, " ").slice(0, 512)}`, "warning");
    }
  };

  pi.registerCommand("omp", {
    description: directSession
      ? "Advanced only-my-pi status and diagnostics (type tasks directly in OMP)"
      : "only-my-pi daily Harness (run, agents, workflows, swarms, modes, configuration, and status)",
    handler,
  });

  // Compatibility alias. The alias is intentionally registered here, so the
  // context-doctor extension owns metrics only and cannot double-register it.
  pi.registerCommand("omp-context", {
    description: "Show low-sensitivity context and tool-schema metrics",
    handler: async (_args, ctx) => handler("context", ctx),
  });
}
