// New-session home for B2, the first read-only exchange, and the project
// overview that sits in the workspace before any plan or patch exists.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  ArrowUp, BookOpen, ChevronDown, CircleDot, Eye, FileCode2, FolderGit2, GitBranch, GitCommitHorizontal, History, ListChecks,
  PanelRight, Paperclip, ScrollText, ShieldCheck, Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AccountMenu, useCurrentAccount } from "@/prototypes/b2/AccountMenu";
import { statusCopy, usable } from "@/prototypes/b2/accounts";
import { projects } from "@/data/mock";
import { useSessions } from "@/data/queries";
import { useProto } from "@/store";
import { cn } from "@/lib/utils";
import { projectFacts, useLayout, type AskMode } from "@/prototypes/b2/layout";
import { FilesTab, IconTip, ReadingProse, UserBubble, WorkRecord } from "@/prototypes/ReadingRoomCoder";

const starters: Record<string, { mode: AskMode; title: string; body: string; prompt: string; attachDirty?: boolean }[]> = {
  omp: [
    { mode: "inspect", title: "解释 Host 最小模式的命令流程", body: "从 server.mjs 到 tasks.mjs，只读梳理", prompt: "解释 Host 最小模式下，一个命令从进入到执行的流程" },
    { mode: "inspect", title: "评估升级到 Pi 1.5.0 的影响", body: "兼容验收还没做，先看哪些合同会受影响", prompt: "评估把 Pi 从 1.3.0 升级到 1.5.0 会影响哪些地方" },
    { mode: "inspect", title: "审查还没提交的 3 处改动", body: "server.mjs、MinimalApp.tsx 和一份笔记", prompt: "审查我还没提交的改动，指出风险和遗漏的测试", attachDirty: true },
    { mode: "plan", title: "给会话列表加全文搜索", body: "先出计划，确认后再申请编程", prompt: "给会话列表加全文搜索，先给我计划" },
  ],
};
const genericStarters = [
  { mode: "inspect" as AskMode, title: "介绍这个项目", body: "目录结构、核心模块和入口", prompt: "介绍这个项目的目录结构、核心模块和主要入口" },
  { mode: "inspect" as AskMode, title: "找出潜在问题", body: "只读检查，给出依据", prompt: "只读检查这个项目中的潜在问题，说明依据和验证方法" },
];

const modes: { id: AskMode; label: string; hint: string; icon: typeof Eye }[] = [
  { id: "inspect", label: "检查与提问", hint: "只读，不会修改文件", icon: Eye },
  { id: "plan", label: "规划改动", hint: "先出计划，批准后才编程", icon: ListChecks },
];

/* ───────────── Home ───────────── */

export function NewSessionHome() {
  const { projectId, modelConfirmed, confirmModel, startFresh, setView, workspace, toggleWorkspace, openSettings } = useLayout();
  const current = useCurrentAccount();
  const broken = !current || !usable(current);
  const { model, thinking, setSession } = useProto();
  const { data: sessions } = useSessions();
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const isOmp = project.id === "omp";
  const [mode, setMode] = useState<AskMode>("inspect");
  const [text, setText] = useState("");
  const [context, setContext] = useState<string[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);

  // Choosing a model from the menu is itself an explicit confirmation.
  const initialModel = useRef(`${model}/${thinking}`);
  useEffect(() => { if (`${model}/${thinking}` !== initialModel.current) confirmModel(); }, [model, thinking, confirmModel]);

  const recent = (sessions ?? []).filter((s) => s.projectId === project.id && s.status !== "archived").slice(0, 3);
  const ideas = starters[project.id] ?? genericStarters;
  const canSend = modelConfirmed && !broken && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    const attached = context.length ? `\n\n（附带 ${context.length} 个文件：${context.map((c) => c.split("/").pop()).join("、")}）` : "";
    startFresh(text.trim() + attached, mode);
  };
  const pickStarter = (s: (typeof ideas)[number]) => {
    setMode(s.mode);
    setText(s.prompt);
    if (s.attachDirty) setContext(projectFacts.dirty.map((d) => d.path));
    area.current?.focus();
  };

  return (
    <section className="relative flex h-full flex-col rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/70 px-4">
        <h1 className="text-[14px] font-medium">新会话</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground"><span className="size-1.5 rounded-full bg-inspect" />只读检查</span>
        <IconTip label={workspace ? "收起项目概览" : "打开项目概览"} kbd="⌘J">
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={toggleWorkspace} aria-pressed={workspace}><PanelRight className="size-4" /></Button>
        </IconTip>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[640px] px-7 pt-[9vh] pb-12">
          <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
            <span className="flex items-center gap-1.5 text-foreground"><FolderGit2 className="size-3.5 text-primary" />{project.name}</span>
            <span className="flex items-center gap-1 font-mono"><GitBranch className="size-3" />{project.branch}</span>
            {(isOmp ? projectFacts.dirty.length : project.dirty) > 0 && (
              <span className="flex items-center gap-1"><CircleDot className="size-3 text-planning" />{isOmp ? projectFacts.dirty.length : project.dirty} 处未提交</span>
            )}
          </p>
          <h2 className="mt-3 font-read text-[34px] leading-tight font-semibold tracking-tight">在 {project.name} 里做什么？</h2>

          <div role="radiogroup" aria-label="会话方式" className="mt-6 grid grid-cols-2 gap-2">
            {modes.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-left", mode === m.id ? "border-primary bg-accent/50" : "border-line hover:border-primary/40")}
              >
                <m.icon className={cn("mt-0.5 size-4 shrink-0", mode === m.id ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className="block text-[13.5px] font-medium">{m.label}</span>
                  <span className="block text-[12px] text-muted-foreground">{m.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-[22px] border border-line bg-card px-4 pt-3 pb-2.5 shadow-[0_10px_30px_-18px_rgba(30,34,29,0.35)] focus-within:border-primary/40">
            {context.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {context.map((p) => (
                  <span key={p} className="flex items-center gap-1 rounded-lg bg-secondary py-0.5 pr-1 pl-2 font-mono text-[11.5px]">
                    <FileCode2 className="size-3 text-muted-foreground" />{p.split("/").pop()}
                    <button onClick={() => setContext((c) => c.filter((x) => x !== p))} aria-label={`移除 ${p}`} className="rounded p-0.5 hover:bg-background"><X className="size-3" /></button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={area}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              rows={3}
              aria-label="描述你要做的事"
              placeholder={mode === "plan" ? "描述要改的东西，Pi 会先给出计划" : "问一个关于这个项目的问题，或让 Pi 先看看某处代码"}
              className="block w-full resize-none bg-transparent font-read text-[16.5px] outline-none placeholder:text-muted-foreground/80"
            />
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {isOmp && context.length === 0 && (
                <button onClick={() => setContext(projectFacts.dirty.map((d) => d.path))} className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-secondary hover:text-foreground">
                  <Paperclip className="size-3.5" />引用未提交的 {projectFacts.dirty.length} 个文件
                </button>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {broken ? (
                  <span className="flex items-center gap-1 rounded-full bg-planning/12 py-0.5 pr-0.5 pl-2.5 text-[12.5px] whitespace-nowrap">
                    <span className="text-planning">{current ? `${current.label}${statusCopy[current.status]}` : "没有可用账号"}</span>
                    <button onClick={() => openSettings("accounts")} className="rounded-full bg-card px-2.5 py-0.5 text-primary shadow-[0_0_0_1px_var(--line)] hover:bg-background">去处理</button>
                    <AccountMenu onPicked={confirmModel} trigger={<button className="rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground">更换</button>} />
                  </span>
                ) : modelConfirmed ? (
                  <AccountMenu
                    trigger={<button className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-secondary">{current.label}，{model}，思考{thinking}<ChevronDown className="size-3" /></button>}
                  />
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-planning/12 py-0.5 pr-0.5 pl-2.5 text-[12.5px] whitespace-nowrap">
                    <span className="text-muted-foreground">上次用的是</span><span>{current.label}</span><span className="font-mono">{model}</span>
                    <button onClick={confirmModel} className="rounded-full bg-card px-2.5 py-0.5 text-primary shadow-[0_0_0_1px_var(--line)] hover:bg-background">使用</button>
                    <AccountMenu onPicked={confirmModel} trigger={<button className="rounded-full px-2 py-0.5 text-muted-foreground hover:text-foreground">更换</button>} />
                  </span>
                )}
                <IconTip label={broken ? "所选账号不可用，先处理或更换" : modelConfirmed ? "发送" : "先确认这次要用的模型"} kbd={modelConfirmed && !broken ? "Enter" : undefined}>
                  <span>
                    <Button size="icon" className="size-8 rounded-full" disabled={!canSend} onClick={send} aria-label="发送"><ArrowUp className="size-4" /></Button>
                  </span>
                </IconTip>
              </div>
            </div>
          </div>
          {!modelConfirmed && <p className="mt-2 px-1 text-[12px] text-muted-foreground">每次开始新会话都要确认模型。上次的选择只会高亮，不会被悄悄沿用。</p>}

          <h3 className="mt-10 mb-3 text-[13px] text-muted-foreground">从这个项目的现状开始</h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {ideas.map((s) => (
              <button key={s.title} onClick={() => pickStarter(s)} className="group rounded-2xl border border-line bg-card px-4 py-3 text-left transition-shadow hover:shadow-[0_6px_24px_-14px_rgba(30,34,29,0.3)]">
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  {s.mode === "plan" ? <ListChecks className="size-3.5" /> : <Sparkles className="size-3.5" />}{s.mode === "plan" ? "规划改动" : "只读检查"}
                </span>
                <span className="mt-1 block text-[14px] font-medium">{s.title}</span>
                <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{s.body}</span>
              </button>
            ))}
          </div>

          {recent.length > 0 && (
            <>
              <h3 className="mt-10 mb-2 text-[13px] text-muted-foreground">或者继续之前的会话</h3>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
                {recent.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <History className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{s.title}</span>
                      <span className="block text-[12px] text-muted-foreground">{s.updated}，{s.model}</span>
                    </span>
                    <button onClick={() => { setSession(s.id); setView("session"); }} className="text-[13px] text-primary hover:underline">继续</button>
                  </li>
                ))}
              </ul>
              <p className="mt-2 px-1 text-[12px] text-muted-foreground">继续会恢复对话历史，不会恢复之前的编程授权。</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────── First exchange in a fresh session ───────────── */

export function FreshSessionView() {
  const { fresh, replyFresh, workspace, toggleWorkspace } = useLayout();
  const { model, thinking } = useProto();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [fresh?.items.length]);
  if (!fresh) return null;
  const send = () => { if (text.trim()) { replyFresh(text.trim()); setText(""); } };
  return (
    <section className="flex h-full flex-col rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/70 px-4">
        <h1 className="min-w-0 truncate text-[14px] font-medium">{fresh.title}</h1>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", fresh.mode === "plan" ? "bg-planning" : "bg-inspect")} />{fresh.mode === "plan" ? "规划" : "只读检查"}
        </span>
        <IconTip label={workspace ? "收起项目概览" : "打开项目概览"} kbd="⌘J">
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={toggleWorkspace} aria-pressed={workspace}><PanelRight className="size-4" /></Button>
        </IconTip>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[660px] space-y-6 px-7 pt-7 pb-10">
          {fresh.items.map((item) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              {item.kind === "user" && <UserBubble text={item.text} />}
              {item.kind === "work" && <WorkRecord calls={item.calls} summary={item.summary} />}
              {item.kind === "note" && <ReadingProse text={item.text} />}
            </motion.div>
          ))}
          <div ref={end} />
        </div>
      </div>
      <div className="shrink-0 px-5 pt-3 pb-4">
        <div className="mx-auto flex max-w-[660px] items-end gap-2 rounded-[22px] border border-line bg-card px-4 py-2.5 focus-within:border-primary/40">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
            rows={2}
            aria-label="回复 Pi"
            placeholder="继续提问，或说明要改什么"
            className="block flex-1 resize-none bg-transparent font-read text-[16px] outline-none placeholder:text-muted-foreground/80"
          />
          <span className="pb-1.5 text-[12px] text-muted-foreground">{model}，思考{thinking}</span>
          <Button size="icon" className="mb-0.5 size-8 rounded-full" disabled={!text.trim()} onClick={send} aria-label="发送"><ArrowUp className="size-4" /></Button>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Workspace before any plan: the project overview ───────────── */

export function OverviewWorkspace() {
  const { tab, setTab, openFile, toggleWorkspace, projectId, openSettings } = useLayout();
  const { model } = useProto();
  const current = useCurrentAccount();
  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  const isOmp = project.id === "omp";
  const showFiles = tab === "files";
  return (
    <section className="@container flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]" aria-label="项目概览">
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-2" role="tablist">
        {[{ id: "overview", label: "概览", icon: BookOpen }, { id: "files", label: "文件", icon: FileCode2 }].map((t) => {
          const active = t.id === "files" ? showFiles : !showFiles;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id === "files" ? "files" : "plan")}
              className={cn("relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px]", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {active && <motion.span layoutId="b2-overview-tab" className="absolute inset-0 rounded-lg bg-secondary" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
              <t.icon className="relative size-3.5" /><span className="relative">{t.label}</span>
            </button>
          );
        })}
        <IconTip label="收起项目概览" kbd="⌘J">
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={toggleWorkspace}><X className="size-4" /></Button>
        </IconTip>
      </header>
      <div className="min-h-0 flex-1">
        {showFiles ? <FilesTab plain /> : (
          <div className="h-full space-y-6 overflow-y-auto px-6 py-6 scrollbar-thin">
            <Section icon={GitBranch} title="工作树" aside={<span className="font-mono">{project.branch}</span>}>
              {isOmp ? (
                <ul className="space-y-0.5">
                  {projectFacts.dirty.map((d) => (
                    <li key={d.path}>
                      <button onClick={() => openFile(d.path)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left font-mono text-[12.5px] hover:bg-secondary/70">
                        <span className={cn("w-5 text-[11px]", d.status === "M" ? "text-planning" : "text-coding")}>{d.status}</span>
                        <span className="min-w-0 truncate">{d.path}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[13px] text-muted-foreground">{project.dirty ? `${project.dirty} 处未提交改动` : "工作树干净"}</p>}
              {isOmp && <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">开始编程前会把这些改动记为基线。与它们重叠的文件不会交给子代理写入。</p>}
            </Section>

            {isOmp && (
              <Section icon={GitCommitHorizontal} title="最近提交">
                <ul className="space-y-1.5">
                  {projectFacts.commits.map((c) => (
                    <li key={c.sha} className="flex gap-2.5 text-[12.5px]">
                      <span className="font-mono text-primary">{c.sha}</span>
                      <span className="min-w-0 flex-1 truncate">{c.text}</span>
                      <span className="shrink-0 text-muted-foreground">{c.when}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section icon={ScrollText} title="项目规则" aside={isOmp ? <button onClick={() => openFile("AGENTS.md")} className="text-primary hover:underline">打开 AGENTS.md</button> : undefined}>
              {isOmp ? (
                <ul className="space-y-1.5 font-read text-[14.5px] leading-relaxed text-foreground/85">
                  {projectFacts.rules.map((r) => <li key={r} className="border-l-2 border-line pl-3">{r}</li>)}
                </ul>
              ) : <p className="text-[13px] text-muted-foreground">没有 AGENTS.md。可以在项目根目录新建一份，写下 Pi 需要遵守的约定。</p>}
            </Section>

            <Section icon={ListChecks} title="验证命令" aside={<span>从 package.json 检测</span>}>
              <div className="flex flex-wrap gap-1.5">
                {(isOmp ? projectFacts.checks : ["npm test"]).map((c) => <code key={c} className="rounded-lg bg-secondary px-2.5 py-1 font-mono text-[12px]">{c}</code>)}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">申请编程时，Pi 会从这些命令里选出要运行的验证，由你一起批准。</p>
            </Section>

            <Section icon={ShieldCheck} title="这次会话会加载什么">
              <dl className="grid grid-cols-[5.5rem_1fr] gap-y-2 text-[13px]">
                <dt className="text-muted-foreground">可用工具</dt><dd>read、grep、find、ls。edit、write 和 bash 在批准后才开放</dd>
                <dt className="text-muted-foreground">扩展</dt><dd className="font-mono text-[12px]">pi-permission-modes，omp-direct</dd>
                <dt className="text-muted-foreground">模型账号</dt>
                <dd className="flex flex-wrap items-center gap-x-2">
                  <span>{current ? `${current.provider}，${current.label}` : "未选择"}</span>
                  <span className="font-mono text-[12px] text-muted-foreground">{model}</span>
                  <button onClick={() => openSettings("accounts")} className="text-[12.5px] text-primary hover:underline">管理账号</button>
                </dd>
              </dl>
            </Section>
          </div>
        )}
      </div>
    </section>
  );
}

function Section({ icon: Icon, title, aside, children }: { icon: typeof BookOpen; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <Icon className="size-3.5 text-muted-foreground" />{title}
        {aside && <span className="ml-auto text-[12px] font-normal text-muted-foreground">{aside}</span>}
      </h3>
      {children}
    </section>
  );
}
