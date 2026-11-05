// B2 view and layout state, shared by the setup flow, the new-session home and
// the coding session. Kept apart from the components so modules can share it.
import { create } from "zustand";
import { fileTree, type ToolCall } from "@/data/mock";
import { cn } from "@/lib/utils";

export type WorkTab = "plan" | "changes" | "files" | "terminal";
export type View = "setup" | "home" | "session" | "fresh" | "settings";
export type SettingsPage = "accounts" | "tools" | "mcp" | "budget" | "appearance" | "runtime";
export type AskMode = "inspect" | "plan";

export type FreshItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "work"; summary: string; calls: ToolCall[] }
  | { id: string; kind: "note"; text: string };

export interface FreshSession {
  title: string;
  mode: AskMode;
  items: FreshItem[];
}

export interface SetupAccount {
  provider: string;
  label: string;
  model: string;
  thinking: string;
}

const SETUP_KEY = "omp.b2.setup.v1";
const readSetup = () => { try { return localStorage.getItem(SETUP_KEY) === "done"; } catch { return false; } };
const writeSetup = (done: boolean) => { try { if (done) localStorage.setItem(SETUP_KEY, "done"); else localStorage.removeItem(SETUP_KEY); } catch { /* the flow still works for this visit */ } };

interface Layout {
  view: View;
  nav: boolean;
  workspace: boolean;
  tab: WorkTab;
  file: string;
  palette: boolean;
  night: boolean;
  account: SetupAccount | null;
  projectId: string;
  /** OMP never reuses the previous model silently: each new session confirms it. */
  modelConfirmed: boolean;
  fresh: FreshSession | null;
  settingsPage: SettingsPage;
  returnTo: View;
  readSize: number;
  setView: (view: View) => void;
  openSettings: (page?: SettingsPage) => void;
  closeSettings: () => void;
  setReadSize: (size: number) => void;
  setNight: (night: boolean) => void;
  toggleNav: () => void;
  toggleWorkspace: () => void;
  toggleNight: () => void;
  setTab: (tab: WorkTab) => void;
  openFile: (path: string) => void;
  setPalette: (open: boolean) => void;
  finishSetup: (account: SetupAccount | null, projectId: string) => void;
  restartSetup: () => void;
  newSession: () => void;
  confirmModel: () => void;
  startFresh: (text: string, mode: AskMode) => void;
  replyFresh: (text: string) => void;
}

let seq = 0;
const uid = (p: string) => `${p}-f${++seq}`;
const done = (tool: ToolCall["tool"], target: string, detail: string, ms: number): ToolCall => ({ id: uid("c"), tool, target, status: "done", detail, ms });
const running = (tool: ToolCall["tool"], target: string): ToolCall => ({ id: uid("c"), tool, target, status: "running", ms: 0 });

/* Canned read-only answers for the project-specific starting points. */
const answers: { match: RegExp; calls: ToolCall[]; text: string }[] = [
  {
    match: /命令流程|最小模式/,
    calls: [done("read", "packages/host/server.mjs", "412 行", 96), done("read", "packages/host/contracts.mjs", "212 行", 71), done("grep", "\"MINIMAL_COMMANDS\" packages", "3 处匹配", 44)],
    text: "最小模式下，WebUI 只能调用 5 个命令：`addProject`、`startTask`、`cancelTask`、`answerApproval` 和 `revokeTask`。\n\n请求先经过 `server.mjs` 的配对认证与 Origin 检查，再由 `validateCommand` 校验结构，最后交给 `tasks.mjs` 启动或停止 worker。白名单之外的命令一律返回 COMMAND_UNAVAILABLE，所以给 Host 加新能力时，`contracts.mjs` 是第一个要改的地方。",
  },
  {
    match: /1\.5\.0|升级/,
    calls: [done("read", "package.json", "依赖锁定 Pi 1.3.0", 38), done("grep", "\"pi110-v1\" packages", "7 处匹配", 52), done("read", "packages/release-stack/contracts.mjs", "188 行", 66)],
    text: "当前开发依赖精确锁定在 Pi 1.3.0。升级的风险主要集中在三处：Host 和 worker 会精确识别运行合同版本，`release-stack` 的栈合同需要新增 1.5.0 的身份，最小会话装配依赖 `createAgentSessionServices` 的参数形状。\n\n这些都只是只读检查得出的判断。要实际升级，我会先给出计划并申请编程授权。",
  },
];

export const useLayout = create<Layout>((set, get) => ({
  view: readSetup() ? "session" : "setup",
  // Below laptop width the reading column needs the room more than the session list.
  nav: window.innerWidth >= 1280,
  // Narrow windows give the conversation the whole width; ⌘J brings the workspace back.
  workspace: window.innerWidth >= 900,
  tab: "plan",
  file: "packages/host/catalog.mjs",
  palette: false,
  night: false,
  account: null,
  projectId: "omp",
  modelConfirmed: false,
  fresh: null,
  settingsPage: "accounts",
  returnTo: "session",
  readSize: 16.5,
  setView: (view) => set({ view }),
  openSettings: (page) => set((s) => ({ view: "settings", settingsPage: page ?? s.settingsPage, returnTo: s.view === "settings" ? s.returnTo : s.view })),
  closeSettings: () => set((s) => ({ view: s.returnTo === "settings" ? "session" : s.returnTo })),
  setReadSize: (readSize) => set({ readSize }),
  setNight: (night) => set({ night }),
  toggleNav: () => set((s) => ({ nav: !s.nav })),
  toggleWorkspace: () => set((s) => ({ workspace: !s.workspace })),
  toggleNight: () => set((s) => ({ night: !s.night })),
  setTab: (tab) => set({ tab, workspace: true }),
  openFile: (file) => set({ file, tab: "files", workspace: true }),
  setPalette: (palette) => set({ palette }),
  finishSetup: (account, projectId) => { writeSetup(true); set({ account: account ?? get().account, projectId, view: "home", modelConfirmed: false, fresh: null }); },
  restartSetup: () => { writeSetup(false); set({ view: "setup" }); },
  newSession: () => set({ view: "home", modelConfirmed: false }),
  confirmModel: () => set({ modelConfirmed: true }),

  startFresh: (text, mode) => {
    const title = text.replace(/\s+/g, " ").slice(0, 18) + (text.length > 18 ? "…" : "");
    const workId = uid("w");
    const canned = answers.find((a) => a.match.test(text));
    set({
      view: "fresh",
      fresh: {
        title,
        mode,
        items: [
          { id: uid("u"), kind: "user", text },
          { id: workId, kind: "work", summary: "只读检查项目", calls: [running("read", "AGENTS.md"), running("grep", "相关入口")] },
        ],
      },
    });
    window.setTimeout(() => {
      const fresh = get().fresh;
      if (!fresh) return;
      const calls = canned?.calls ?? [done("read", "AGENTS.md", "24 行", 31), done("read", "packages/host/server.mjs", "412 行", 96), done("grep", "相关入口", "4 处匹配", 40)];
      const reply = mode === "plan"
        ? "我先只读看了相关文件，接下来会把计划写进右侧的“计划”页：要改哪些文件、风险在哪里、用哪些命令验证。你确认计划后，我才会申请这个进程的编程授权。"
        : canned?.text ?? "我只读查看了相关文件。这是原型，回答内容是示意；真实版本会在这里给出带文件链接的分析。需要修改时，我会先给出计划并申请编程授权。";
      set({
        fresh: {
          ...fresh,
          items: [
            ...fresh.items.map((i) => (i.id === workId && i.kind === "work" ? { ...i, summary: `读了 ${calls.filter((c) => c.tool === "read").length} 个文件，搜索 ${calls.filter((c) => c.tool === "grep").length} 次`, calls } : i)),
            { id: uid("n"), kind: "note", text: reply },
          ],
        },
      });
    }, 2200);
  },

  replyFresh: (text) => {
    const fresh = get().fresh;
    if (!fresh) return;
    set({ fresh: { ...fresh, items: [...fresh.items, { id: uid("u"), kind: "user", text }] } });
    window.setTimeout(() => {
      const f = get().fresh;
      if (f) set({ fresh: { ...f, items: [...f.items, { id: uid("n"), kind: "note", text: "收到。这是原型，后续回答为示意，不会调用模型。" }] } });
    }, 900);
  },
}));

/** Portaled menus, tooltips and dialogs carry the theme class themselves. */
export const useTheme = () => cn("proto-b", useLayout((s) => s.night) && "night");

/* File index for @ mentions, the palette and clickable references. */
export const filePaths = (() => {
  const paths: string[] = [];
  const stack: string[] = [];
  for (const node of fileTree) {
    stack.length = node.depth;
    if (node.dir) stack.push(node.name);
    else paths.push([...stack, node.name].join("/"));
  }
  return paths;
})();
export const resolveFile = (name: string) => filePaths.find((p) => p === name || p.endsWith(`/${name}`));

export const snippets: Record<string, string[]> = {
  "packages/host/catalog.mjs": [
    "// OMP's own session index. Pi's native history files are read, never rewritten.",
    "export class ProjectCatalog {",
    "  constructor(configRoot) {",
    '    this.indexFile = path.join(configRoot, "only-my-pi/host/sessions.json");',
    "  }",
    "",
    "  async session(sessionKey) {",
    "    const index = await this.#read();",
    "    const record = index.sessions[sessionKey];",
    '    if (!record) throw hostError("SESSION_NOT_FOUND", 404);',
    "    return record;",
    "  }",
    "",
    "  async saveSession(record) {",
    "    return this.#write((index) => { index.sessions[record.sessionKey] = record; });",
    "  }",
    "}",
  ],
  "packages/host/tasks.mjs": [
    "export class HostTasks extends EventEmitter {",
    "  activeFor(sessionId) {",
    '    return [...this.tasks.values()].some((t) => t.sessionId === sessionId && ACTIVE.has(t.status));',
    "  }",
    "}",
  ],
  "AGENTS.md": [
    "# only-my-pi 项目规则",
    "",
    "- 子代理只做探索、检索和核验；实施、方案取舍及最终验证由主代理负责。",
    "- 验证命令从根目录 package.json 及当前任务的门禁取得。",
    "- 浏览器验收默认使用 Ego Lite；不可用时记录具体阻碍。",
  ],
};

/* Read-only facts the overview shows for the selected project. */
export const projectFacts = {
  dirty: [
    { status: "M", path: "packages/host/server.mjs" },
    { status: "M", path: "webui/src/MinimalApp.tsx" },
    { status: "??", path: "docs/notes/archive-idea.md" },
  ],
  commits: [
    { sha: "b994979", when: "11月3日", text: "Merge pull request #96 from codex/docs/current-development" },
    { sha: "75d4869", when: "11月3日", text: "fix(bootstrap): drain artifact subprocess output before validation" },
    { sha: "03c5189", when: "11月3日", text: "ci: enforce source binding and conservative change routing" },
  ],
  rules: [
    "子代理只做探索、检索和核验，实施与最终验证由主代理负责",
    "验证命令从根目录 package.json 及当前任务的门禁取得",
    "发布、安装切换和模型费用遵守当次的明确授权",
  ],
  checks: ["npm run typecheck", "npm run test:web", "node --test tests/host-*.test.mjs"],
};
