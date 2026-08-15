const TEXT_KEYS = new Set(["text", "content", "reasoning", "thinking"]);

function textCharacters(value, seen = new WeakSet()) {
  if (typeof value === "string") return value.length;
  if (value === null || typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + textCharacters(item, seen), 0);
  }

  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && TEXT_KEYS.has(key)) total += item.length;
    else if (typeof item === "object" && item !== null) total += textCharacters(item, seen);
  }
  return total;
}

function messageRole(message) {
  return typeof message?.role === "string" ? message.role : "unknown";
}

export function estimateTokensFromCharacters(characters) {
  return Math.ceil(Math.max(0, characters) / 4);
}

export function summarizeMessages(messages) {
  const roles = {};
  let characters = 0;
  for (const message of messages ?? []) {
    const role = messageRole(message);
    roles[role] = (roles[role] ?? 0) + 1;
    characters += textCharacters(message);
  }
  return {
    count: messages?.length ?? 0,
    roles,
    textCharacters: characters,
    approximateTextTokens: estimateTokensFromCharacters(characters),
  };
}

export function summarizeTools(tools) {
  let schemaCharacters = 0;
  for (const tool of tools ?? []) {
    schemaCharacters += JSON.stringify(tool.parameters ?? {}).length;
    schemaCharacters += (tool.description ?? "").length;
    schemaCharacters += (tool.promptGuidelines ?? []).join("\n").length;
  }
  return {
    count: tools?.length ?? 0,
    schemaCharacters,
    approximateSchemaTokens: estimateTokensFromCharacters(schemaCharacters),
  };
}

export function buildContextSnapshot({ messages, tools, activeTools, usage, systemPromptCharacters, turnIndex }) {
  return {
    schemaVersion: 1,
    turnIndex: Number.isInteger(turnIndex) ? turnIndex : null,
    messages: summarizeMessages(messages),
    tools: {
      ...summarizeTools(tools),
      active: [...(activeTools ?? [])].sort(),
    },
    systemPrompt: {
      textCharacters: systemPromptCharacters ?? null,
      approximateTextTokens:
        systemPromptCharacters === undefined || systemPromptCharacters === null
          ? null
          : estimateTokensFromCharacters(systemPromptCharacters),
    },
    providerEstimate: usage
      ? {
          tokens: usage.tokens ?? null,
          contextWindow: usage.contextWindow,
          percent: usage.percent ?? null,
        }
      : null,
  };
}

export function formatSnapshot(snapshot) {
  const provider = snapshot.providerEstimate;
  const providerText = provider
    ? `${provider.tokens ?? "?"}/${provider.contextWindow} tokens (${provider.percent ?? "?"}%)`
    : "provider usage unavailable";
  return [
    providerText,
    `${snapshot.messages.count} messages (~${snapshot.messages.approximateTextTokens} text tokens)`,
    `${snapshot.tools.count} tools, ${snapshot.tools.active.length} active (~${snapshot.tools.approximateSchemaTokens} schema tokens)`,
    `system prompt ~${snapshot.systemPrompt.approximateTextTokens ?? "?"} tokens`,
  ].join(" · ");
}
