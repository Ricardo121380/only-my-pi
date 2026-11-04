// Mock content for the Only-My-Pi prototypes. One realistic session drives every
// direction so the four layouts can be compared on identical material.

export type AccessState = "inspect" | "planning" | "awaiting" | "coding";
export type ToolName = "read" | "grep" | "find" | "ls" | "bash" | "edit" | "write";
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Project {
  id: string;
  name: string;
  path: string;
  branch: string;
  dirty: number;
  pinned?: boolean;
}

export interface Session {
  id: string;
  projectId: string;
  title: string;
  updated: string;
  status: "running" | "awaiting" | "idle" | "archived";
  model: string;
}

export interface ToolCall {
  id: string;
  tool: ToolName;
  target: string;
  detail?: string;
  ms: number;
  status: RunStatus;
}

export interface ChildAgent {
  id: string;
  role: "scout" | "writer" | "reviewer";
  name: string;
  task: string;
  model: string;
  status: RunStatus;
  steps: number;
  tokens: number;
  seconds: number;
}

export type TimelineEvent =
  | { id: string; kind: "user"; text: string; at: string }
  | { id: string; kind: "thinking"; seconds: number; text: string }
  | { id: string; kind: "tools"; summary: string; calls: ToolCall[] }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "plan" }
  | { id: string; kind: "approval" }
  | { id: string; kind: "agents" }
  | { id: string; kind: "verify" };

export const projects: Project[] = [
  { id: "omp", name: "only-my-pi", path: "~/AgentProjects/only-my-pi", branch: "codex/dev/pi-native-web", dirty: 3, pinned: true },
  { id: "notes", name: "pi-notes", path: "~/AgentProjects/pi-notes", branch: "main", dirty: 0, pinned: true },
  { id: "glacier", name: "glacier-site", path: "~/AgentProjects/glacier-site", branch: "feat/pricing", dirty: 1 },
  { id: "homelab", name: "homelab-scripts", path: "~/AgentProjects/homelab-scripts", branch: "main", dirty: 0 },
];

export const sessions: Session[] = [
  { id: "s1", projectId: "omp", title: "会话列表支持归档", updated: "刚刚", status: "awaiting", model: "deepseek-v4-pro" },
  { id: "s2", projectId: "omp", title: "排查 Host 重启后历史丢失", updated: "12 分钟前", status: "running", model: "claude-sonnet-5-5" },
  { id: "s3", projectId: "omp", title: "梳理 minimal-services 的装配", updated: "昨天", status: "idle", model: "deepseek-v4-pro" },
  { id: "s4", projectId: "omp", title: "Pi 1.5.0 升级预检", updated: "昨天", status: "idle", model: "deepseek-v4-flash" },
  { id: "s5", projectId: "notes", title: "导出笔记为静态站点", updated: "周一", status: "idle", model: "qwen3-coder" },
  { id: "s6", projectId: "glacier", title: "定价页响应式修复", updated: "10月30日", status: "idle", model: "claude-sonnet-5-5" },
  { id: "s7", projectId: "homelab", title: "备份脚本加校验", updated: "10月28日", status: "archived", model: "deepseek-v4-flash" },
];

export const accounts = [
  { id: "ds-personal", provider: "DeepSeek", label: "个人", models: ["deepseek-v4-pro", "deepseek-v4-flash"] },
  { id: "anthropic-work", provider: "Anthropic", label: "工作", models: ["claude-sonnet-5-5", "claude-opus-5-5"] },
  { id: "local", provider: "OpenAI 兼容", label: "本机 LM Studio", models: ["qwen3-coder"] },
];

export const thinkingLevels = ["关闭", "低", "中", "高"] as const;

export const codingRequest = {
  taskSummary: "为会话增加“归档”操作：Host 新增 archiveSession 命令，WebUI 侧栏折叠已归档会话，可随时恢复。",
  complexity: "complex" as const,
  scope: [
    "packages/host/contracts.mjs",
    "packages/host/server.mjs",
    "webui/src/MinimalApp.tsx",
    "webui/src/useSessionHistory.ts",
    "tests/host-minimal-web.test.mjs",
  ],
  riskFlags: ["public-api", "schema"],
  verification: ["npm run typecheck", "node --test tests/host-minimal-web.test.mjs", "npm run test:web"],
  orchestration: { useReadOnlyScouts: true, useManagedCloneWriter: true, useFreshReviewer: true },
};

export const planSteps = [
  { title: "扩展 Host 合同", body: "在 contracts.mjs 增加 archiveSession / restoreSession 命令；归档只写 OMP 索引，不改 Pi 原生历史文件。" },
  { title: "Host 命令处理", body: "server.mjs 校验会话归属与执行状态；运行中的会话拒绝归档并返回 SESSION_ACTIVE。" },
  { title: "侧栏交互", body: "MinimalApp 在会话行菜单加入“归档”，侧栏底部折叠“已归档 (n)”分组。" },
  { title: "历史读取", body: "useSessionHistory 读取 archived 标记，默认列表过滤，搜索时仍可命中。" },
  { title: "补测试", body: "覆盖归档、恢复、运行中拒绝、重启后状态保留四条路径。" },
];

export const riskNotes: Record<string, string> = {
  "public-api": "Host 协议新增两条命令，旧版 WebUI 不会发送它们，保持向后兼容。",
  schema: "会话索引增加 archived 字段；缺省视为未归档，旧索引无需迁移。",
};

export const tools1: ToolCall[] = [
  { id: "t1", tool: "ls", target: "packages/host", ms: 42, status: "done" },
  { id: "t2", tool: "read", target: "packages/host/contracts.mjs", detail: "212 行", ms: 88, status: "done" },
  { id: "t3", tool: "grep", target: "\"startTask\" packages/host", detail: "6 处匹配", ms: 61, status: "done" },
  { id: "t4", tool: "read", target: "webui/src/MinimalApp.tsx", detail: "201 行", ms: 95, status: "done" },
  { id: "t5", tool: "read", target: "webui/src/useSessionHistory.ts", detail: "48 行", ms: 40, status: "done" },
  { id: "t6", tool: "find", target: "tests -name 'host-minimal*'", detail: "1 个文件", ms: 33, status: "done" },
];

export const tools2: ToolCall[] = [
  { id: "t7", tool: "bash", target: "npm run typecheck", detail: "4 个项目通过", ms: 18400, status: "done" },
  { id: "t8", tool: "bash", target: "node --test tests/host-minimal-web.test.mjs", detail: "9 / 9 通过", ms: 6200, status: "done" },
  { id: "t9", tool: "bash", target: "npm run test:web", detail: "运行中", ms: 0, status: "running" },
];

export const childAgents: ChildAgent[] = [
  { id: "c1", role: "scout", name: "协议侦察", task: "梳理 Host 命令与错误码的现有约定", model: "deepseek-v4-flash", status: "done", steps: 14, tokens: 6820, seconds: 48 },
  { id: "c2", role: "scout", name: "界面侦察", task: "定位侧栏会话行的菜单与状态来源", model: "deepseek-v4-flash", status: "done", steps: 11, tokens: 5310, seconds: 39 },
  { id: "c3", role: "writer", name: "受管写入", task: "在受管克隆中实现计划第 1–5 步", model: "deepseek-v4-pro", status: "running", steps: 23, tokens: 18440, seconds: 131 },
  { id: "c4", role: "reviewer", name: "全新审查", task: "以全新上下文审查补丁与测试", model: "claude-sonnet-5-5", status: "queued", steps: 0, tokens: 0, seconds: 0 },
];

export const budget = {
  children: { used: 4, max: 8 },
  concurrency: { used: 1, max: 2 },
  tokens: { used: 30570, max: 50000 },
  costUsd: { used: 0.142, max: 0.25 },
  toolCalls: { used: 41, max: 64 },
  wallSeconds: { used: 412, max: 1800 },
};

export const tokenSeries = [
  { t: "0:00", main: 1200, scouts: 0, writer: 0 },
  { t: "0:30", main: 2600, scouts: 2100, writer: 0 },
  { t: "1:00", main: 3400, scouts: 6900, writer: 0 },
  { t: "1:30", main: 4100, scouts: 12130, writer: 0 },
  { t: "2:00", main: 4800, scouts: 12130, writer: 3900 },
  { t: "2:30", main: 5200, scouts: 12130, writer: 9800 },
  { t: "3:00", main: 5600, scouts: 12130, writer: 14200 },
  { t: "3:30", main: 5810, scouts: 12130, writer: 18440 },
];

export interface DiffLine { type: "ctx" | "add" | "del" | "hunk"; text: string; n?: number }
export interface DiffFile { path: string; add: number; del: number; lines: DiffLine[] }

export const diffFiles: DiffFile[] = [
  {
    path: "packages/host/contracts.mjs",
    add: 9,
    del: 1,
    lines: [
      { type: "hunk", text: "@@ -41,7 +41,15 @@ export const MINIMAL_COMMANDS" },
      { type: "ctx", n: 41, text: "export const MINIMAL_COMMANDS = Object.freeze([" },
      { type: "ctx", n: 42, text: '  "addProject", "startTask", "cancelTask",' },
      { type: "del", n: 43, text: '  "answerApproval", "revokeTask",' },
      { type: "add", n: 43, text: '  "answerApproval", "revokeTask", "archiveSession", "restoreSession",' },
      { type: "ctx", n: 44, text: "]);" },
      { type: "add", n: 45, text: "" },
      { type: "add", n: 46, text: "// Archiving only changes OMP's index; Pi history files stay untouched." },
      { type: "add", n: 47, text: "export function archiveRecord(session, archived, now = Date.now()) {" },
      { type: "add", n: 48, text: "  if (typeof session?.sessionKey !== \"string\") throw hostError(\"SESSION_INVALID\");" },
      { type: "add", n: 49, text: "  return { ...session, archived, archivedAt: archived ? now : null };" },
      { type: "add", n: 50, text: "}" },
    ],
  },
  {
    path: "packages/host/server.mjs",
    add: 14,
    del: 2,
    lines: [
      { type: "hunk", text: "@@ -336,9 +336,21 @@ async function command(request)" },
      { type: "ctx", n: 336, text: "        const command = validateCommand(await body(request));" },
      { type: "del", n: 337, text: '        if (minimal && !["addProject", "startTask", "cancelTask", "answerApproval", "revokeTask"].includes(command.type))' },
      { type: "add", n: 337, text: "        if (minimal && !MINIMAL_COMMANDS.includes(command.type))" },
      { type: "ctx", n: 338, text: '          throw hostError("COMMAND_UNAVAILABLE", 409);' },
      { type: "add", n: 339, text: '        if (command.type === "archiveSession" || command.type === "restoreSession") {' },
      { type: "add", n: 340, text: "          const session = await catalog.session(command.sessionKey);" },
      { type: "add", n: 341, text: '          if (tasks.activeFor(session.sessionId)) throw hostError("SESSION_ACTIVE", 409);' },
      { type: "add", n: 342, text: '          return catalog.saveSession(archiveRecord(session, command.type === "archiveSession"));' },
      { type: "add", n: 343, text: "        }" },
    ],
  },
  {
    path: "webui/src/MinimalApp.tsx",
    add: 22,
    del: 3,
    lines: [
      { type: "hunk", text: "@@ -151,6 +151,14 @@ const sessionNavigation" },
      { type: "ctx", n: 151, text: '  const sessionNavigation = <nav className="session-nav" aria-label="会话列表">' },
      { type: "del", n: 152, text: "    {history.sessions.map(s => (" },
      { type: "add", n: 152, text: "    {history.sessions.filter(s => !s.archived).map(s => (" },
      { type: "add", n: 153, text: "      <SessionRow key={s.sessionKey} session={s} onArchive={archive} />" },
      { type: "add", n: 154, text: "    ))}" },
      { type: "add", n: 155, text: "    <ArchivedGroup sessions={history.sessions.filter(s => s.archived)} onRestore={restore} />" },
    ],
  },
  {
    path: "tests/host-minimal-web.test.mjs",
    add: 31,
    del: 0,
    lines: [
      { type: "hunk", text: "@@ -78,0 +79,9 @@" },
      { type: "add", n: 79, text: 'test("archiving a running session is refused", async () => {' },
      { type: "add", n: 80, text: "  const host = await startMinimalHost();" },
      { type: "add", n: 81, text: '  const task = await host.command({ type: "startTask", prompt: "stop stream" });' },
      { type: "add", n: 82, text: "  await assert.rejects(" },
      { type: "add", n: 83, text: '    host.command({ type: "archiveSession", sessionKey: task.sessionKey }),' },
      { type: "add", n: 84, text: '    { code: "SESSION_ACTIVE" },' },
      { type: "add", n: 85, text: "  );" },
      { type: "add", n: 86, text: "});" },
    ],
  },
];

export const verifyChecks = [
  { id: "v1", label: "受管克隆中的项目检查", where: "克隆", status: "done" as RunStatus, detail: "typecheck 与 9 个 Host 测试通过" },
  { id: "v2", label: "补丁范围与基线漂移", where: "克隆", status: "done" as RunStatus, detail: "5 个文件均在批准范围内，基线未漂移" },
  { id: "v3", label: "全新上下文审查", where: "审查者", status: "queued" as RunStatus, detail: "等待写入完成" },
  { id: "v4", label: "真实工作树再次验证", where: "工作树", status: "queued" as RunStatus, detail: "应用补丁后重新运行批准的检查" },
];

export const timeline: TimelineEvent[] = [
  { id: "e1", kind: "user", at: "16:02", text: "会话越来越多了。给侧栏加一个归档功能，归档后折叠到底部，随时可以恢复。别动 Pi 原生的历史文件。" },
  { id: "e2", kind: "thinking", seconds: 6, text: "需要先确认 Host 的命令白名单、会话索引的存储位置，以及侧栏如何渲染会话行。归档应只改 OMP 自己的索引。" },
  { id: "e3", kind: "tools", summary: "读取了 4 个文件，搜索 1 次", calls: tools1 },
  { id: "e4", kind: "assistant", text: "当前处于只读检查。Host 的最小模式只放行 5 个命令，会话索引由 `catalog.mjs` 维护，与 Pi 的原生历史分开存放，所以归档可以只写索引。\n\n这项改动涉及 Host 协议和索引字段，属于复杂任务。我先给出计划，你确认后再申请编程授权。" },
  { id: "e5", kind: "plan" },
  { id: "e6", kind: "approval" },
  { id: "e7", kind: "agents" },
  { id: "e8", kind: "tools", summary: "运行了 3 条验证命令", calls: tools2 },
  { id: "e9", kind: "verify" },
];

export const toolLabel: Record<ToolName, string> = {
  read: "读取",
  grep: "搜索",
  find: "查找",
  ls: "列目录",
  bash: "命令",
  edit: "编辑",
  write: "写入",
};

export const accessCopy: Record<AccessState, { label: string; hint: string }> = {
  inspect: { label: "只读检查", hint: "可以阅读和分析项目，不会修改文件" },
  planning: { label: "规划", hint: "保持只读，形成可审批的计划" },
  awaiting: { label: "等待批准", hint: "Agent 正在申请本进程的编程授权" },
  coding: { label: "编程中", hint: "本进程可在项目内编辑、写入和运行沙箱命令" },
};

export const fileTree = [
  { name: "packages", dir: true, depth: 0, open: true },
  { name: "host", dir: true, depth: 1, open: true },
  { name: "contracts.mjs", depth: 2, changed: "M" },
  { name: "server.mjs", depth: 2, changed: "M" },
  { name: "tasks.mjs", depth: 2 },
  { name: "catalog.mjs", depth: 2 },
  { name: "direct-agent", dir: true, depth: 1 },
  { name: "mcp", dir: true, depth: 1 },
  { name: "webui", dir: true, depth: 0, open: true },
  { name: "src", dir: true, depth: 1, open: true },
  { name: "MinimalApp.tsx", depth: 2, changed: "M" },
  { name: "useSessionHistory.ts", depth: 2 },
  { name: "Messages.tsx", depth: 2 },
  { name: "tests", dir: true, depth: 0, open: true },
  { name: "host-minimal-web.test.mjs", depth: 1, changed: "M" },
  { name: "AGENTS.md", depth: 0 },
  { name: "CONTEXT.md", depth: 0 },
  { name: "package.json", depth: 0 },
];

export const queueTasks = [
  { id: "q1", title: "会话列表支持归档", project: "only-my-pi", column: "approval", agent: "主 Agent", model: "deepseek-v4-pro" },
  { id: "q2", title: "排查 Host 重启后历史丢失", project: "only-my-pi", column: "running", agent: "主 Agent", model: "claude-sonnet-5-5" },
  { id: "q3", title: "受管写入：归档实现", project: "only-my-pi", column: "running", agent: "写入者", model: "deepseek-v4-pro" },
  { id: "q4", title: "全新审查：归档补丁", project: "only-my-pi", column: "queued", agent: "审查者", model: "claude-sonnet-5-5" },
  { id: "q5", title: "Pi 1.5.0 升级预检", project: "only-my-pi", column: "queued", agent: "主 Agent", model: "deepseek-v4-flash" },
  { id: "q6", title: "定价页响应式修复", project: "glacier-site", column: "done", agent: "主 Agent", model: "claude-sonnet-5-5" },
  { id: "q7", title: "协议侦察", project: "only-my-pi", column: "done", agent: "侦察者", model: "deepseek-v4-flash" },
];

export const queueColumns = [
  { id: "queued", title: "排队" },
  { id: "running", title: "进行中" },
  { id: "approval", title: "待你批准" },
  { id: "done", title: "已完成" },
] as const;
