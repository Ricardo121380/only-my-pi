export interface McpExposure { exposure?: "direct" | "deferred" | "codemode" | "hidden"; active?: boolean }
export interface McpResourceScope { uri: string; mimeTypes: ("text/plain" | "text/markdown" | "application/json" | "application/octet-stream")[]; active?: boolean; paths?: string[] }
export type McpToolScope = McpExposure & { name: string; pathArgument: string; paths: string[] } & ({ effect: "read"; writeMode?: never } | { effect: "write"; writeMode: "descriptor" });
export type McpServer = { name: string; credentialRefs: Record<string, string>; enabled: boolean; resources?: McpResourceScope[] } & (
  { transport: "stdio"; command: string; args: string[]; codePaths: string[]; cwd?: string; env: Record<string, string>; tools: McpToolScope[] }
  | { transport: "streamable-http"; url: string; tools: (McpExposure & { name: string; effect: "remote" })[] });
export declare const isMcpOAuthActive: (status: string) => boolean;
export declare const isMcpOAuthStored: (status: string) => boolean;
export declare const isMcpOAuthBlocked: (flow: McpOAuthFlow | null | undefined) => boolean;
export interface McpOAuthFlow { flowId: string; name: string; projectPath: string; targetDigest: string; ref: string | null; kind: "login" | "refresh"; ownerPid?: number; ownerIdentity?: string; status: "starting" | "waiting" | "refreshing" | "cancelling" | "stored" | "stored_sync_failed" | "publication_unconfirmed" | "failed" | "cancelled" | "timed_out" | "interrupted"; updatedAt: string; events: { status: string; at: string }[]; authorizationOrigin?: string; opened?: boolean; code?: string; bindingConfirmed?: boolean }
export interface McpAuthentication { state: "not_connected" | "connected" | "token" | "expired" | "revoked" | "binding_changed" | "refresh_required"; ref: string | null; flow?: McpOAuthFlow }
export interface McpSnapshot { protocol: 1; revision: number; projectPath: string | null; servers: (McpServer & { source: "default" | "project"; targetDigest: string })[]; authentication?: Record<string, McpAuthentication> }
export interface McpPreview { protocol: 1; revision: number; digest: string; servers: McpServer[]; differences: { name: string; status: "new" | "existing" }[] }
export type McpAction = { type: "list" | "status" }
  | { type: "discover"; taskId: string; name: string }
  | { type: "oauthStart" | "oauthRefresh"; name: string; revision: number }
  | { type: "oauthCancel" | "oauthStatus"; flowId: string }
  | { type: "previewImport"; source: string }
  | { type: "import"; source: string; digest: string; revision: number }
  | { type: "save"; server: McpServer; revision: number }
  | { type: "enable"; name: string; enabled: boolean; revision: number }
  | { type: "reset"; name: string; revision: number }
  | { type: "revokeCredential"; name: string; envName: string; revision: number }
  | { type: "credential"; name: string; envName: string; value: string; revision: number };
export interface McpDiscovery { server: string; targetDigest: string; status: "discovering" | "ready" | "stale" | "failed" | "disconnected"; live?: boolean; epoch: number; discoveredAt?: string; code?: string; tools: { name: string; exposure: "direct" | "deferred" | "codemode" | "hidden"; active: boolean; definitionDigest: string | null }[]; resources: { uri: string; name: string; mimeType: string; size?: number; definitionDigest: string }[]; events: { type: string; at: string }[] }
export interface McpRun { runId: string; taskId: string; projectPath: string; revision: number; status: "running" | "stopped" | "reconciliation"; discoveries?: McpDiscovery[]; processes: { server: string; transport?: "stdio" | "streamable-http"; remoteState?: "unconfirmed"; pid: number | null; status: "starting" | "running" | "stopping" | "stopped" | "reconciliation"; alive: boolean; runtimeDir?: string }[]; calls: { callId: string; toolCallId: string; parentToolCallId: string | null; taskId: string; server: string; tool: string; effect: "read" | "write" | "remote"; kind?: "resource"; uri?: string; partial?: boolean; definitionDigest?: string; revision: number; status: "checking" | "awaiting_approval" | "dispatched" | "completed" | "failed" | "rejected" | "unknown"; target?: string; code?: string; application?: "not_applied" | "applied" | "unknown"; verification?: "not_run"; observedChange?: boolean; beforeDigest?: string; afterDigest?: string | null }[] }
export interface McpStatus { protocol: 1; runs: McpRun[] }
