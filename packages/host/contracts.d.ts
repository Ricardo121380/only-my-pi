import type { ThinkingLevel } from "../accounts/contracts.js";

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
export interface TaskUsage {
  scope: "task"; responses: number; tools: number; reported: number; priced: number;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number } | null;
  estimatedCost: number | null;
}
export interface Message { id: string; role: "user" | "assistant" | "toolResult"; text: string; toolName?: string; toolCallId?: string; filePath?: string; isError?: boolean; outputAvailable?: boolean; truncated?: boolean; durationMs?: number; stopReason?: string | null }
export interface FileEntry { name: string; path: string; directory: boolean }
export interface FileListing { entries: FileEntry[]; truncated: boolean }
export interface FilePreview { path: string; text: string; bytes: number; version: string }
export interface GitDiff { available: boolean; text: string; truncated?: boolean; code?: string }
export interface HostTask {
  resourceRevision?: number;
  settingsSnapshot?: { revision: number; resourceRevision: number; resources: { id: string; enabled: boolean; parameters: Record<string, unknown> }[] } | null;
  settingsLoaded?: { revision: number; resourceRevision: number; tools: string[]; skills: string[] } | null;
  codemode?: { enabled: true; classifier: boolean; image: boolean };
  toolCalls?: { toolCallId: string; parentToolCallId: string | null; name: string; filePath?: string; status: "running" | "completed" | "failed" | "cancelled" | "unknown"; startedAt: string; completedAt?: string; durationMs?: number; result?: string; output?: string; error?: string }[];
  mcp?: { protocol: 1; revision: number; enabled: boolean };
  settlement?: { aborted: boolean } | null;
  inputFeedback?: { inputId: string | null; source: "pi-prompt" | "omp-custom-message"; disposition: "handled" | "queued" | "started" }[] | null;
  inputId?: string; originDraftInputId?: string; originDraftSessionId?: string | null;
  orchestration?: { maximumConcurrency: number | null; maximumChildren: number | null; totalChildren: number | null; writerUsed: boolean;
    budget: { scope: "process-child-delegations"; mainAgentIncluded: false; status: string; limits: Record<string, number | null>; used: Record<string, number | null> };
    children: { label: string; agent: string | null; status: string; toolCount: number | null; tokens: number | null; model?: string; accountId?: string }[] } | null;
  mode?: "readonly" | "controlled"; access?: "inspect" | "coding";
  approvals?: { approvalId: string; kind: "select" | "confirm"; title: string; message: string; options?: string[]; expiresAt: string }[];
  accountId?: string | null;
  thinkingLevel?: ThinkingLevel | null; requestedThinkingLevel?: ThinkingLevel | null; usage?: TaskUsage | null;
  taskId: string; requestId: string; projectId: string; model: string; prompt: string;
  status: TaskStatus; sessionId: string | null; messages: Message[]; partial?: string; error?: string | null;
  tool?: { name: string; status: "running"; output?: string } | null; createdAt: string; updatedAt: string;
}
export type TaskSummary = Omit<HostTask, "messages" | "partial">;
export interface Session { sessionKey: string; sessionId: string; projectId: string; timestamp: string; name: string; readOnly: true }
export interface HostSnapshot { protocol: number; version: string; epoch: string; seq: number; indexing: boolean;
  capabilities?: { minimal?: boolean; controlled: boolean; inspector?: { protocol: 1 }; accounts?: { protocol: 1; apiKey: true; probe: true }; inputs?: { protocol: 1; materials: false; resourceRevision: number | null } };
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
export interface InputsResultV1 { protocol: 1; admission: "ready" | "reconciliation_required"; draft: DraftShardV1; queue: QueueShardV1 }
export type InputCommandResultV1<C extends InputCommandV1> = C extends { type: "getInputs" } ? InputsResultV1
  : C extends { type: "saveDraft" | "clearDraft" } ? DraftShardV1
  : C extends { type: "submitPrompt" } ? HostTask : QueueShardV1;
