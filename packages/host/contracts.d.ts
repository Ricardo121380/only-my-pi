export type HostCommand =
  | { type: "addProject"; path: string }
  | { type: "startTask"; requestId: string; projectId: string; accountId: string; model: string; prompt: string; mode?: "readonly" | "controlled"; resumeSessionKey?: string }
  | { type: "answerApproval"; taskId: string; approvalId: string; value: string | boolean }
  | { type: "revokeTask"; taskId: string }
  | { type: "cancelTask"; taskId: string };
export type TaskStatus = "starting" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface Project { projectId: string; path: string; name: string; available: boolean }
export interface ModelChoice { id: string; name: string; provider: string }
/** Metadata only; creating an account does not authenticate it. */
export interface AccountInput { providerId: string; name: string; authType: "api_key" | "oauth" }
export interface GuiAccount extends AccountInput { accountId: string }
export interface StaticProvider { baseUrl: string; api: "openai-completions" | "openai-responses" | "anthropic-messages"; models: { id: string; name: string; contextWindow: number; maxTokens: number; reasoning?: boolean }[] }
export type AccountAction = { type: "status" | "logout" | "remove" | "oauthStart" } | { type: "apiKey"; key: string } | { type: "rename"; name: string } | { type: "configure"; config: StaticProvider } | { type: "oauthAnswer"; flowId: string; promptId: string; value: string } | { type: "oauthCancel"; flowId: string };
export interface OAuthFlow { flowId: string; accountId: string; status: "starting" | "waiting" | "awaiting_input" | "cancelling" | "stored" | "stored_sync_failed" | "failed" | "cancelled" | "timed_out"; prompt: { promptId: string; type: "text" | "secret" | "manual_code" | "select"; options?: { id: string; label: string }[] } | null; event: { type: "auth_url" | "device_code"; url: string; userCode?: string } | null }
export interface AccountDirectory { protocol: 1; authentication: "api_key"; cliReference: { accountId: "cli-readonly"; name: string; readOnly: true }; accounts: GuiAccount[] }
export interface Message { id: string; role: "user" | "assistant" | "toolResult"; text: string; toolName?: string; isError?: boolean; outputAvailable?: boolean; truncated?: boolean }
export interface HostTask {
  orchestration?: { maximumConcurrency: number | null; maximumChildren: number | null; totalChildren: number | null; writerUsed: boolean;
    budget: { scope: "process-child-delegations"; mainAgentIncluded: false; status: string; limits: Record<string, number | null>; used: Record<string, number | null> };
    children: { label: string; agent: string | null; status: string; toolCount: number | null; tokens: number | null }[] } | null;
  mode?: "readonly" | "controlled"; access?: "inspect" | "coding";
  approvals?: { approvalId: string; kind: "select" | "confirm"; title: string; message: string; options?: string[]; expiresAt: string }[];
  accountId?: string | null;
  taskId: string; requestId: string; projectId: string; model: string; prompt: string;
  status: TaskStatus; sessionId: string | null; messages: Message[]; partial?: string; error?: string | null;
  tool?: { name: string; status: "running" } | null; createdAt: string; updatedAt: string;
}
export type TaskSummary = Omit<HostTask, "messages" | "partial">;
export interface Session { sessionKey: string; sessionId: string; projectId: string; timestamp: string; name: string; readOnly: true }
export interface HostSnapshot { protocol: number; version: string; epoch: string; seq: number; indexing: boolean;
  runtime: { stackId: string; sourceCommit: string | null }; projects: Project[]; tasks: TaskSummary[]; diagnostics: { code: string; sessionKey?: string }[] }
export type HostEvent = ({ type: "snapshot" } & HostSnapshot)
  | { type: "task"; epoch: string; seq: number; data: HostTask }
  | { type: "projects"; epoch: string; seq: number; data: Project[] };
