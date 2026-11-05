// Simulated agent run for B2. One approved task moves through the same stages
// OMP's direct runtime uses: read-only scouts, one managed-clone writer, a fresh
// reviewer, an explicit apply, then verification again in the real worktree.
import { create } from "zustand";
import type { RunStatus, ToolCall } from "@/data/mock";

export type Phase =
  | "idle" | "scouting" | "writing" | "reviewing" | "ready" | "revising" | "applying" | "verifying" | "applied" | "cancelled";

export const ACTIVE_PHASES: Phase[] = ["scouting", "writing", "reviewing", "revising", "applying", "verifying"];
export const isActive = (phase: Phase) => ACTIVE_PHASES.includes(phase);

export const phaseCopy: Record<Phase, string> = {
  idle: "未开始",
  scouting: "侦察中",
  writing: "写入中",
  reviewing: "审查中",
  ready: "待你决定",
  revising: "按意见修改",
  applying: "应用中",
  verifying: "工作树验证中",
  applied: "已应用，未提交",
  cancelled: "已停止",
};

export type StreamItem =
  | { id: string; kind: "note"; text: string }
  | { id: string; kind: "work"; summary: string; calls: ToolCall[] }
  | { id: string; kind: "agents" }
  | { id: string; kind: "artifact"; which: "patch" | "applied"; version: number }
  | { id: string; kind: "user"; text: string; tag: "steer" | "review" | "message"; landed: boolean }
  | { id: string; kind: "system"; text: string };

export interface ReviewComment {
  id: string;
  file: string;
  line: number;
  text: string;
  author: "you" | "reviewer";
  resolved: boolean;
}

export interface CommandRun {
  id: string;
  cmd: string;
  where: "受管克隆" | "工作树";
  ms: number;
  exit: number | null;
  out: string[];
}

interface RunState {
  phase: Phase;
  stoppedIn: Phase | null;
  patchVersion: number;
  stream: StreamItem[];
  comments: ReviewComment[];
  commands: CommandRun[];
  queue: { id: string; text: string }[];
  viewed: string[];
  dirty: number;
  start: () => void;
  apply: () => void;
  requestChanges: () => void;
  stop: (reason: "user" | "revoked") => void;
  send: (text: string, mode: "steer" | "queue" | "message") => void;
  sendQueued: (id: string) => void;
  dropQueued: (id: string) => void;
  addComment: (file: string, line: number, text: string) => void;
  removeComment: (id: string) => void;
  toggleViewed: (file: string) => void;
  reset: () => void;
}

let timers: number[] = [];
const later = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)); };
const clearTimers = () => { timers.forEach((t) => window.clearTimeout(t)); timers = []; };
let seq = 0;
const uid = (p: string) => `${p}-${++seq}`;

const call = (tool: ToolCall["tool"], target: string, status: RunStatus, detail?: string, ms = 0): ToolCall => ({ id: uid("c"), tool, target, status, detail, ms });

const cloneChecks: CommandRun[] = [
  { id: "k1", cmd: "npm run typecheck", where: "受管克隆", ms: 18400, exit: 0, out: ["tsc --noEmit && tsc -p tsconfig.safety.json && tsc -p tsconfig.host.json && tsc -p webui/tsconfig.json", "4 个项目，0 个错误"] },
  { id: "k2", cmd: "node --test tests/host-minimal-web.test.mjs", where: "受管克隆", ms: 6200, exit: 0, out: ["✔ archives an idle session (41ms)", "✔ restores an archived session (22ms)", "✔ archiving a running session is refused (318ms)", "✔ archive state survives a Host restart (604ms)", "tests 9  pass 9  fail 0"] },
];
const webCheck = (where: CommandRun["where"], done: boolean): CommandRun => ({
  id: `web-${where}`, cmd: "npm run test:web", where, ms: done ? 9800 : 0, exit: done ? 0 : null,
  out: done ? ["RUN  v5.0.1", "Test Files  17 passed (17)", "Tests  99 passed (99)"] : ["RUN  v5.0.1", "✓ src/MinimalApp.test.tsx (12)"],
});

const initial = {
  phase: "idle" as Phase,
  stoppedIn: null,
  patchVersion: 0,
  stream: [] as StreamItem[],
  comments: [] as ReviewComment[],
  commands: [] as CommandRun[],
  queue: [] as { id: string; text: string }[],
  viewed: [] as string[],
  dirty: 3,
};

export const useRun = create<RunState>((set, get) => {
  const push = (...items: StreamItem[]) => set((s) => ({ stream: [...s.stream, ...items] }));
  const patch = (id: string, fn: (item: StreamItem) => StreamItem) => set((s) => ({ stream: s.stream.map((i) => (i.id === id ? fn(i) : i)) }));
  const setCalls = (id: string, summary: string, calls: ToolCall[]) => patch(id, (i) => (i.kind === "work" ? { ...i, summary, calls } : i));
  const upsertCommand = (run: CommandRun) =>
    set((s) => ({ commands: s.commands.some((c) => c.id === run.id) ? s.commands.map((c) => (c.id === run.id ? run : c)) : [...s.commands, run] }));

  const review = (version: number) => {
    set({ phase: "reviewing" });
    upsertCommand(webCheck("受管克隆", false));
    later(4500, () => {
      upsertCommand(webCheck("受管克隆", true));
      if (version === 1) {
        set((s) => ({
          comments: [...s.comments, {
            id: uid("rc"), file: "packages/host/contracts.mjs", line: 49, author: "reviewer", resolved: false,
            text: "archived 没有校验类型，传入字符串 \"false\" 也会被当成已归档。建议写成 archived === true。",
          }],
        }));
        push({ id: uid("n"), kind: "note", text: "审查者通过了补丁，并在 `contracts.mjs` 第 49 行留下 1 条建议。补丁全部在批准范围内，基线没有漂移。\n\n你可以先在右侧看改动，再决定应用到工作树，或者在行上写意见让写入者修改。" });
      } else {
        push({ id: uid("n"), kind: "note", text: `补丁 v${version} 已通过全新审查，你提出的意见都已处理。可以应用到工作树了。` });
      }
      set({ phase: "ready" });
    });
  };

  return {
    ...initial,

    start: () => {
      if (get().phase !== "idle") return;
      clearTimers();
      const scout = uid("w");
      set({ phase: "scouting" });
      push(
        { id: uid("a"), kind: "agents" },
        { id: scout, kind: "work", summary: "侦察者在只读梳理协议与侧栏", calls: [
          call("read", "packages/host/contracts.mjs", "running"),
          call("grep", "\"sessionNavigation\" webui/src", "running"),
          call("read", "packages/host/catalog.mjs", "queued"),
        ] },
      );
      later(3600, () => {
        setCalls(scout, "侦察者读了 2 个文件，搜索 1 次", [
          call("read", "packages/host/contracts.mjs", "done", "212 行", 88),
          call("grep", "\"sessionNavigation\" webui/src", "done", "2 处匹配", 54),
          call("read", "packages/host/catalog.mjs", "done", "96 行", 61),
        ]);
        push({ id: uid("n"), kind: "note", text: "侦察完成。Host 的命令白名单在 `contracts.mjs`，侧栏会话行由 `MinimalApp.tsx` 渲染，索引读写集中在 `catalog.mjs`。写入者开始在受管克隆里实现计划的 5 步。" });
        set({ phase: "writing" });
        const writer = uid("w");
        const files = ["packages/host/contracts.mjs", "packages/host/server.mjs", "webui/src/MinimalApp.tsx", "tests/host-minimal-web.test.mjs"];
        const step = (done: number) => files.map((f, i) => call(i === 3 ? "write" : "edit", f, i < done ? "done" : i === done ? "running" : "queued", i < done ? "已改" : undefined));
        push({ id: writer, kind: "work", summary: "写入者在受管克隆中编辑", calls: step(0) });
        [1, 2, 3].forEach((n) => later(1800 * n, () => setCalls(writer, "写入者在受管克隆中编辑", step(n))));
        later(7200, () => {
          setCalls(writer, "写入者编辑了 3 个文件，新增 1 个测试", step(4));
          cloneChecks.forEach(upsertCommand);
          push(
            { id: uid("w"), kind: "work", summary: "在受管克隆中运行了 2 条检查", calls: [
              call("bash", "npm run typecheck", "done", "4 个项目通过", 18400),
              call("bash", "node --test tests/host-minimal-web.test.mjs", "done", "9 / 9 通过", 6200),
            ] },
            { id: uid("p"), kind: "artifact", which: "patch", version: 1 },
          );
          set({ patchVersion: 1 });
          review(1);
        });
      });
    },

    apply: () => {
      if (get().phase !== "ready") return;
      set({ phase: "applying" });
      push({ id: uid("s"), kind: "system", text: "你确认了应用。补丁正在写入真实工作树，之后会重新运行批准的验证。" });
      later(900, () => {
        set({ phase: "verifying", dirty: 7 });
        const verify = uid("w");
        const runs = (done: number): ToolCall[] => ["npm run typecheck", "node --test tests/host-minimal-web.test.mjs", "npm run test:web"].map((cmd, i) =>
          call("bash", cmd, i < done ? "done" : i === done ? "running" : "queued", i < done ? "通过" : undefined));
        push({ id: verify, kind: "work", summary: "在真实工作树中重新验证", calls: runs(0) });
        upsertCommand({ ...cloneChecks[0], id: "t1", where: "工作树", exit: null, ms: 0, out: ["tsc --noEmit …"] });
        later(1600, () => {
          setCalls(verify, "在真实工作树中重新验证", runs(1));
          upsertCommand({ ...cloneChecks[0], id: "t1", where: "工作树" });
          upsertCommand({ ...cloneChecks[1], id: "t2", where: "工作树", exit: null, ms: 0, out: ["▶ minimal host"] });
        });
        later(3200, () => {
          setCalls(verify, "在真实工作树中重新验证", runs(2));
          upsertCommand({ ...cloneChecks[1], id: "t2", where: "工作树" });
          upsertCommand(webCheck("工作树", false));
        });
        later(4800, () => {
          setCalls(verify, "工作树验证全部通过", runs(3));
          upsertCommand(webCheck("工作树", true));
          set({ phase: "applied" });
          push(
            { id: uid("p"), kind: "artifact", which: "applied", version: get().patchVersion },
            { id: uid("n"), kind: "note", text: "补丁已应用，并在你的工作树里通过了全部验证。改动没有暂存或提交，`git status` 现在有 7 处改动，你检查后可以自行提交。" },
          );
        });
      });
    },

    requestChanges: () => {
      const open = get().comments.filter((c) => !c.resolved);
      if (get().phase !== "ready" || open.length === 0) return;
      push({ id: uid("u"), kind: "user", tag: "review", landed: true, text: open.map((c) => `${c.file.split("/").pop()}:${c.line}  ${c.text}`).join("\n") });
      set({ phase: "revising" });
      const fix = uid("w");
      push({ id: fix, kind: "work", summary: "写入者按审查意见修改", calls: open.map((c) => call("edit", `${c.file}:${c.line}`, "running")) });
      later(2600, () => {
        const version = get().patchVersion + 1;
        setCalls(fix, `写入者处理了 ${open.length} 条意见`, open.map((c) => call("edit", `${c.file}:${c.line}`, "done", "已改")));
        set((s) => ({ patchVersion: version, comments: s.comments.map((c) => (c.resolved ? c : { ...c, resolved: true })) }));
        upsertCommand({ ...cloneChecks[1], id: `k2-v${version}`, cmd: `${cloneChecks[1].cmd}（补丁 v${version}）` });
        push({ id: uid("p"), kind: "artifact", which: "patch", version });
        review(version);
      });
    },

    stop: (reason) => {
      const { phase } = get();
      if (!isActive(phase)) return;
      clearTimers();
      set((s) => ({
        phase: "cancelled",
        stoppedIn: phase,
        stream: s.stream.map((i) => (i.kind === "work" ? { ...i, calls: i.calls.map((c) => (c.status === "running" || c.status === "queued" ? { ...c, status: "cancelled" as const } : c)) } : i)),
        commands: s.commands.map((c) => (c.exit === null ? { ...c, exit: 130, out: [...c.out, "^C 已取消"] } : c)),
      }));
      push({
        id: uid("s"), kind: "system",
        text: reason === "revoked"
          ? "你收回了编程授权，任务已停止。已生成的补丁只留在受管克隆中，没有写入工作树。"
          : "你停止了任务。运行中的子代理已取消；结果未知的请求仍计入额度，不会自动重试。",
      });
    },

    send: (text, mode) => {
      if (mode === "queue") { set((s) => ({ queue: [...s.queue, { id: uid("q"), text }] })); return; }
      const id = uid("u");
      push({ id, kind: "user", text, tag: mode, landed: mode === "message" });
      if (mode === "steer") later(1800, () => patch(id, (i) => (i.kind === "user" ? { ...i, landed: true } : i)));
      if (mode === "message") later(700, () => push({ id: uid("n"), kind: "note", text: "收到。这是原型，不会调用模型；真实版本会从这里开始新的一轮，先只读检查。" }));
    },

    sendQueued: (id) => {
      const item = get().queue.find((q) => q.id === id);
      if (!item) return;
      set((s) => ({ queue: s.queue.filter((q) => q.id !== id) }));
      get().send(item.text, "message");
    },

    dropQueued: (id) => set((s) => ({ queue: s.queue.filter((q) => q.id !== id) })),

    addComment: (file, line, text) => set((s) => ({ comments: [...s.comments, { id: uid("yc"), file, line, text, author: "you", resolved: false }] })),
    removeComment: (id) => set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
    toggleViewed: (file) => set((s) => ({ viewed: s.viewed.includes(file) ? s.viewed.filter((f) => f !== file) : [...s.viewed, file] })),

    reset: () => { clearTimers(); set({ ...initial, stream: [], comments: [], commands: [], queue: [], viewed: [] }); },
  };
});

/* Derived views shared by the stream, workspace and status bar. */

const order: Phase[] = ["idle", "scouting", "writing", "reviewing", "ready", "applying", "verifying", "applied"];
const reached = (phase: Phase, target: Phase) => order.indexOf(phase === "revising" ? "writing" : phase) >= order.indexOf(target);

export function agentStatuses(phase: Phase, stoppedIn: Phase | null): Record<string, RunStatus> {
  const p = phase === "cancelled" ? (stoppedIn ?? "idle") : phase;
  const live = (s: RunStatus): RunStatus => (phase === "cancelled" && (s === "running" || s === "queued") ? "cancelled" : s);
  const scouts: RunStatus = p === "scouting" ? "running" : reached(p, "writing") ? "done" : "queued";
  const writer: RunStatus = p === "writing" || p === "revising" ? "running" : reached(p, "reviewing") ? "done" : "queued";
  const reviewer: RunStatus = p === "reviewing" ? "running" : p === "revising" ? "queued" : reached(p, "ready") ? "done" : "queued";
  return { c1: live(scouts), c2: live(scouts), c3: live(writer), c4: live(reviewer) };
}

export function checkStatuses(phase: Phase, stoppedIn: Phase | null): Record<string, RunStatus> {
  const p = phase === "cancelled" ? (stoppedIn ?? "idle") : phase;
  const live = (s: RunStatus): RunStatus => (phase === "cancelled" && (s === "running" || s === "queued") ? "cancelled" : s);
  return {
    v1: live(p === "writing" || p === "revising" ? "running" : reached(p, "reviewing") ? "done" : "queued"),
    v2: live(reached(p, "reviewing") && p !== "revising" ? "done" : "queued"),
    v3: live(p === "reviewing" ? "running" : reached(p, "ready") ? "done" : "queued"),
    v4: live(p === "applying" || p === "verifying" ? "running" : p === "applied" ? "done" : "queued"),
  };
}

export const patchAvailable = (phase: Phase, version: number) => version > 0 && phase !== "idle";
