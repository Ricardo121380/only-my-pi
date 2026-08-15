import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildContextSnapshot, formatSnapshot } from "./metrics.mjs";

type Snapshot = ReturnType<typeof buildContextSnapshot>;

export default function contextDoctor(pi: ExtensionAPI): void {
  let lastSnapshot: Snapshot | undefined;
  let systemPromptCharacters: number | undefined;
  let turnIndex: number | undefined;

  pi.on("before_agent_start", (event) => {
    systemPromptCharacters = event.systemPrompt.length;
  });

  pi.on("turn_start", (event) => {
    turnIndex = event.turnIndex;
  });

  pi.on("context", (event, ctx) => {
    lastSnapshot = buildContextSnapshot({
      messages: event.messages,
      tools: pi.getAllTools(),
      activeTools: pi.getActiveTools(),
      usage: ctx.getContextUsage(),
      systemPromptCharacters,
      turnIndex,
    });
    if (ctx.mode === "tui") {
      const usage = lastSnapshot.providerEstimate;
      const label = usage?.percent === null || usage?.percent === undefined
        ? `ctx ~${lastSnapshot.messages.approximateTextTokens}`
        : `ctx ${usage.percent.toFixed(1)}%`;
      ctx.ui.setStatus("only-my-pi-context", label);
    }
  });

  pi.on("session_start", (_event, ctx) => {
    lastSnapshot = undefined;
    systemPromptCharacters = undefined;
    turnIndex = undefined;
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-context", "ctx ?");
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-context", undefined);
  });

  pi.registerCommand("omp-context", {
    description: "Show low-sensitivity context, prompt, and tool-schema budget metrics",
    handler: async (_args, ctx) => {
      if (!lastSnapshot) {
        ctx.ui.notify("Context Doctor has no completed context snapshot yet.", "info");
        return;
      }
      ctx.ui.notify(formatSnapshot(lastSnapshot), "info");
    },
  });
}
