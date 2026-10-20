export function emptyUsage() {
  return { scope: "task", responses: 0, tools: 0, reported: 0, priced: 0, tokens: null, estimatedCost: null };
}
export function recordUsage(usage, message) {
  usage.responses++;
  const fields = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"];
  const raw = message.usage;
  // Pi initializes absent Provider usage to zeros; that is not a free request.
  if (!raw || !fields.every((key) => Number.isSafeInteger(raw[key]) && raw[key] >= 0) || raw.totalTokens === 0) return;
  usage.reported++;
  usage.tokens ??= Object.fromEntries(fields.map((key) => [key, 0]));
  for (const key of fields) usage.tokens[key] += raw[key];
  // SDK cost is a catalog estimate, not the user's billing statement. Zero may
  // be an unconfigured custom-model price and is deliberately kept unknown.
  if (Number.isFinite(raw.cost?.total) && raw.cost.total > 0) {
    usage.priced++; usage.estimatedCost = (usage.estimatedCost ?? 0) + raw.cost.total;
  }
}
