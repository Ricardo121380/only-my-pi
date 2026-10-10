export interface McpToolScope { name: string; effect: "read"; pathArgument: string; paths: string[] }
export interface McpServer { name: string; transport: "stdio"; command: string; args: string[]; codePaths: string[]; cwd?: string; env: Record<string, string>; credentialRefs: Record<string, string>; tools: McpToolScope[]; enabled: boolean }
export interface McpSnapshot { protocol: 1; revision: number; projectPath: string | null; servers: (McpServer & { source: "default" | "project"; targetDigest: string })[] }
export interface McpPreview { protocol: 1; revision: number; digest: string; servers: McpServer[]; differences: { name: string; status: "new" | "existing" }[] }
export type McpAction = { type: "list" | "status" }
  | { type: "previewImport"; source: string }
  | { type: "import"; source: string; digest: string; revision: number }
  | { type: "save"; server: McpServer; revision: number }
  | { type: "enable"; name: string; enabled: boolean; revision: number }
  | { type: "reset"; name: string; revision: number }
  | { type: "revokeCredential"; name: string; envName: string; revision: number }
  | { type: "credential"; name: string; envName: string; value: string; revision: number };
export interface McpRun { runId: string; taskId: string; projectPath: string; revision: number; status: string; processes: { server: string; pid: number | null; status: string; alive: boolean; runtimeDir?: string }[]; calls: { callId: string; toolCallId: string; taskId: string; server: string; tool: string; revision: number; status: string; target?: string; code?: string }[] }
export interface McpStatus { protocol: 1; runs: McpRun[] }
