export type HostCommand =
  | { type: "openTerminal"; projectId: string; cols: number; rows: number }
  | { type: "writeTerminal"; terminalId: string; seq: number; data: string }
  | { type: "resizeTerminal"; terminalId: string; cols: number; rows: number }
  | { type: "closeTerminal"; terminalId: string }
  | { type: "enterManual"; projectId: string }
  | { type: "leaveManual"; projectId: string; manualId: string }
  | { type: "saveFile"; projectId: string; manualId: string; path: string; version: string; text: string }
  | { type: "addProject"; path: string }
  | { type: "startTask"; requestId: string; projectId: string; accountId: string; model: string; prompt: string; thinkingLevel?: ThinkingLevel; mode?: "readonly" | "controlled"; resumeSessionKey?: string }
  | { type: "answerApproval"; taskId: string; approvalId: string; value: string | boolean }
  | { type: "revokeTask"; taskId: string }
  | { type: "cancelTask"; taskId: string };
export type TaskStatus = "starting" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface Project { projectId: string; path: string; name: string; available: boolean }
export interface TerminalState { terminalId: string; projectId: string; status: "starting" | "running" | "closing" | "closed" | "reconciliation"; cols: number; rows: number; inputSeq: number; exitCode: number | null; error: string | null }
export interface TerminalOutput extends TerminalState { base: number; end: number; truncated: boolean; output: string }
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface ModelChoice { id: string; name: string; provider: string; thinkingLevels?: ThinkingLevel[]; contextWindow?: number }
export interface TaskUsage {
  scope: "task"; responses: number; tools: number; reported: number; priced: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null;
  estimatedCost: number | null;
}
/** Metadata only; creating an account does not authenticate it. */
export interface AccountInput { providerId: string; name: string; authType: "api_key" | "oauth" }
export interface GuiAccount extends AccountInput { accountId: string }
export interface StaticProvider { baseUrl: string; api: "openai-completions" | "openai-responses" | "anthropic-messages"; models: { id: string; name: string; contextWindow: number; maxTokens: number; reasoning?: boolean }[] }
export type AccountAction = { type: "status" | "logout" | "remove" | "oauthStart" } | { type: "apiKey"; key: string } | { type: "rename"; name: string } | { type: "configure"; config: StaticProvider } | { type: "oauthAnswer"; flowId: string; promptId: string; value: string } | { type: "oauthCancel"; flowId: string };
export interface OAuthFlow { flowId: string; accountId: string; status: "starting" | "waiting" | "awaiting_input" | "cancelling" | "stored" | "stored_sync_failed" | "failed" | "cancelled" | "timed_out"; prompt: { promptId: string; type: "text" | "secret" | "manual_code" | "select"; options?: { id: string; label: string }[] } | null; event: { type: "auth_url" | "device_code"; url: string; userCode?: string } | null }
export interface AccountDirectory { protocol: 1; authentication: "api_key"; cliReference: { accountId: "cli-readonly"; name: string; readOnly: true }; accounts: GuiAccount[] }
export interface Message { id: string; role: "user" | "assistant" | "toolResult"; text: string; toolName?: string; isError?: boolean; outputAvailable?: boolean; truncated?: boolean; durationMs?: number; stopReason?: string | null }
export interface HostTask {
  mcp?: { protocol: 1; revision: number; enabled: boolean };
  settlement?: { aborted: boolean } | null;
  inputFeedback?: { inputId: string | null; source: "pi-prompt" | "omp-custom-message"; disposition: "handled" | "queued" | "started" }[] | null;
  inputId?: string; originDraftInputId?: string; originDraftSessionId?: string | null;
  orchestration?: { maximumConcurrency: number | null; maximumChildren: number | null; totalChildren: number | null; writerUsed: boolean;
    budget: { scope: "process-child-delegations"; mainAgentIncluded: false; status: string; limits: Record<string, number | null>; used: Record<string, number | null> };
    children: { label: string; agent: string | null; status: string; toolCount: number | null; tokens: number | null }[] } | null;
  mode?: "readonly" | "controlled"; access?: "inspect" | "coding";
  approvals?: { approvalId: string; kind: "select" | "confirm"; title: string; message: string; options?: string[]; expiresAt: string }[];
  accountId?: string | null;
  thinkingLevel?: ThinkingLevel | null; requestedThinkingLevel?: ThinkingLevel | null; usage?: TaskUsage | null;
  taskId: string; requestId: string; projectId: string; model: string; prompt: string;
  status: TaskStatus; sessionId: string | null; messages: Message[]; partial?: string; error?: string | null;
  tool?: { name: string; status: "running" } | null; createdAt: string; updatedAt: string;
}
export type TaskSummary = Omit<HostTask, "messages" | "partial">;
export interface Session { sessionKey: string; sessionId: string; projectId: string; timestamp: string; name: string; readOnly: true }
export interface HostSnapshot { protocol: number; version: string; epoch: string; seq: number; indexing: boolean;
  capabilities?: { controlled: boolean; inputs?: { protocol: 1; materials: false; resourceRevision: number } };
  runtime: { stackId: string; sourceCommit: string | null }; projects: Project[]; tasks: TaskSummary[]; diagnostics: { code: string; sessionKey?: string }[] }
export type HostEvent = ({ type: "snapshot" } & HostSnapshot)
  | { type: "task"; epoch: string; seq: number; data: HostTask }
  | { type: "projects"; epoch: string; seq: number; data: Project[] };

/** Host-private input storage; not an executable browser command or a grant. */
export interface InputScopeV1 { projectId: string; sessionId: string | null }
export interface InputBindingV1 {
  accountId: string; modelId: string; thinking: ThinkingLevel;
  mode: "readonly" | "controlled"; resourceRevision: number;
}
export interface InputContentV1 {
  inputId: string; delivery: "prompt" | "steer" | "queue"; text: string;
  materialSnapshotIds: string[]; binding: InputBindingV1;
}
export type InputStateV1 = "draft" | "queued" | "dispatching" | "accepted" | "consumed" | "paused" | "unknown" | "removed";
export interface InputRecordV1 extends InputContentV1, InputScopeV1 {
  schemaVersion: 1; revision: number; taskId: string | null; contentDigest: string;
  state: InputStateV1; consumedEntryId: string | null; pauseReason: string | null;
  createdAt: string; updatedAt: string;
}
export interface DraftShardV1 { schemaVersion: 1; kind: "draft"; revision: number; scope: InputScopeV1; draft: InputRecordV1 | null }
export interface QueueShardV1 { schemaVersion: 1; kind: "queue"; revision: number; scope: InputScopeV1; items: InputRecordV1[] }
export type InputShardV1 = DraftShardV1 | QueueShardV1;
export interface InputRevision { expectedRevision: number }
export interface InputItemRevision extends InputRevision { expectedInputRevision: number }
export interface InputTransition extends InputItemRevision {
  state: Exclude<InputStateV1, "draft">; taskId?: string; consumedEntryId?: string; pauseReason?: string;
}

/** Targets are resolved by Host; a browser cannot supply a history file path. */
export type InputTargetV1 = { projectId: string; sessionKey: string | null } | { projectId: string; taskId: string };
export type InputCommandV1 =
  | { type: "getInputs"; target: InputTargetV1 }
  | { type: "submitPrompt"; target: { projectId: string; sessionKey: string | null }; requestId: string; input: InputContentV1; expectedRevision: number; expectedInputRevision: number }
  | { type: "saveDraft"; target: InputTargetV1; input: InputContentV1; expectedRevision: number }
  | { type: "clearDraft"; target: InputTargetV1; expectedRevision: number }
  | { type: "enqueueInput"; target: InputTargetV1; predecessorTaskId: string; input: InputContentV1; expectedRevision: number }
  | { type: "deliverSupplement"; target: InputTargetV1; taskId: string; input: InputContentV1; expectedRevision: number }
  | { type: "editQueuedInput"; target: InputTargetV1; input: InputContentV1; expectedRevision: number; expectedInputRevision: number }
  | { type: "removeQueuedInput"; target: InputTargetV1; inputId: string; expectedRevision: number; expectedInputRevision: number }
  | { type: "resumeQueue"; target: InputTargetV1; expectedRevision: number }
  | { type: "reconcileInput"; target: InputTargetV1; inputId: string };
export interface InputReceiptV1 { inputId: string; taskId: string; contentDigest: string; entryId: string }
export interface InputDeliveryV1 { status: "accepted" | "consumed" | "unknown"; receipt?: InputReceiptV1; feedback?: { source: "omp-custom-message"; disposition: "queued" | "started" } }
export interface InputDirtyEventV1 { type: "inputs"; inputProtocol: 1; epoch: string; inputSeq: number; data: { scope: InputScopeV1 } }
