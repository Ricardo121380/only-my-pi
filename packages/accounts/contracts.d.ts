export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelChoice { id: string; name: string; provider: string; thinkingLevels?: ThinkingLevel[]; contextWindow?: number }
/** Metadata only; creating an account does not authenticate it. */
export interface AccountInput { providerId: string; name: string; authType: "api_key" | "oauth" }
export interface GuiAccount extends AccountInput { accountId: string }
export interface StaticProvider {
  baseUrl: string;
  api: "openai-completions" | "openai-responses" | "anthropic-messages" | "typesafe-system-one" | "openai-decisions" | "cloudflare-workers-ai-system-one" | "openrouter-images";
  models: ({ id: string; name: string; contextWindow: number; reasoning?: boolean; input?: ("text" | "image")[]; output?: ("text" | "image")[] } & (
    { type?: "llm"; maxTokens: number } | { type: "classifier" | "image"; maxTokens?: number }
  ))[];
}
export type AccountAction = { type: "status" | "logout" | "remove" | "oauthStart" } | { type: "apiKey"; key: string } | { type: "rename"; name: string } | { type: "configure"; config: StaticProvider } | { type: "oauthAnswer"; flowId: string; promptId: string; value: string } | { type: "oauthCancel"; flowId: string };
export interface OAuthFlow { flowId: string; accountId: string; status: "starting" | "waiting" | "awaiting_input" | "cancelling" | "stored" | "stored_sync_failed" | "failed" | "cancelled" | "timed_out"; prompt: { promptId: string; type: "text" | "secret" | "manual_code" | "select"; options?: { id: string; label: string }[] } | null; event: { type: "auth_url" | "device_code"; url: string; userCode?: string } | null }
export interface AccountDirectory { protocol: 1; authentication: "api_key"; cliReference: { accountId: "cli-readonly"; name: string; readOnly: true }; accounts: GuiAccount[] }
