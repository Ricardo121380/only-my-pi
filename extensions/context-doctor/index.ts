import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildContextSnapshot, formatSnapshot } from "./metrics.mjs";

type Snapshot = ReturnType<typeof buildContextSnapshot>;

export default function contextDoctor(pi: ExtensionAPI): void {
  let settings: any;
  pi.events.on("only-my-pi:product-settings:v1", (snapshot: any) => { settings = snapshot.resources.find((r: any) => r.id === "context-doctor"); });
  const enabled = () => settings?.enabled !== false;
  const labelPrefix = () => settings?.parameters.label ?? "ctx";
  pi.registerTool({ name: "context_snapshot", label: "Context diagnostics", description: "Report measured context and active tool diagnostics. Estimates remain estimates.",
    parameters: { type: "object", properties: {}, additionalProperties: false } as any,
    async execute() { return { content: [{ type: "text", text: `${labelPrefix()}: ${lastSnapshot ? formatSnapshot(lastSnapshot) : "context not measured yet"}` }], details: { label: labelPrefix(), snapshot: lastSnapshot ?? null } }; }
  });
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
    if (!enabled()) return;
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
        ? `${labelPrefix()} ~${lastSnapshot.messages.approximateTextTokens}`
        : `${labelPrefix()} ${usage.percent.toFixed(1)}%`;
      ctx.ui.setStatus("only-my-pi-context", label);
    }
  });

  pi.on("session_start", (_event, ctx) => {
    lastSnapshot = undefined;
    systemPromptCharacters = undefined;
    turnIndex = undefined;
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-context", enabled() ? `${labelPrefix()} ?` : undefined);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode === "tui") ctx.ui.setStatus("only-my-pi-context", undefined);
  });

}
