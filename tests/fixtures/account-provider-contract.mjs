// @ts-check
// The type gate and the actual catalog configure path consume the same input.
/** @satisfies {import("../../packages/accounts/contracts.js").StaticProvider} */
export const llmProvider = {
  baseUrl: "https://example.invalid/v1", api: "openai-completions",
  models: [{ type: "llm", id: "chat", name: "Chat", contextWindow: 32000, maxTokens: 128, input: ["text", "image"], output: ["text"] }],
};
