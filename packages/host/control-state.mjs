const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const token = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null;
const numericFields = (value, keys) => Object.fromEntries(keys.map((key) => [key, finite(value?.[key])]));

// Explicit projection: no task text, raw child output, filesystem or auth data.
export function projectControlState(value) {
  const source = value?.orchestration;
  return {
    access: value?.access === "coding" ? "coding" : "inspect",
    orchestration: !source ? null : {
      maximumConcurrency: finite(source.maximumConcurrency), maximumChildren: finite(source.maximumChildren),
      totalChildren: finite(source.totalChildren), writerUsed: source.writerUsed === true,
      budget: {
        scope: "process-child-delegations", mainAgentIncluded: false,
        status: token(source.budget?.status) ?? "UNAVAILABLE",
        limits: numericFields(source.budget?.limits, ["maxChildren", "maxConcurrency", "maxDepth", "maxWallSeconds", "maxTotalTokens", "maxCostUsd", "maxTotalToolCalls", "maxTotalOutputBytes"]),
        used: numericFields(source.budget?.used, ["tokens", "costUsd", "toolCalls", "resultBytes"]),
      },
      children: (Array.isArray(source.children) ? source.children : []).slice(0, 64).map((child) => ({
        label: typeof child?.label === "string" ? child.label.slice(0, 128) : "child",
        agent: token(child?.agent), status: token(child?.status) ?? "unknown",
        toolCount: finite(child?.toolCount), tokens: finite(child?.tokens),
      })),
    },
  };
}
