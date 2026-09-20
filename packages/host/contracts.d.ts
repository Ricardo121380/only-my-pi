export type HostCommand =
  | { type: "addProject"; path: string }
  | { type: "startTask"; requestId: string; projectId: string; model: string; prompt: string }
  | { type: "cancelTask"; taskId: string };
export type TaskStatus = "starting" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted";
export interface Project { projectId: string; path: string; name: string; available: boolean }
export interface ModelChoice { id: string; name: string; provider: string }
export interface Message { id: string; role: "user" | "assistant" | "toolResult"; text: string; toolName?: string; isError?: boolean; outputAvailable?: boolean; truncated?: boolean }
export interface HostTask {
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
