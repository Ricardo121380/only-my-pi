import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowUp, Bell, Bot, ChevronDown, ChevronRight, Cog, File, FileCode2, Folder, FolderOpen, GitCompareArrows, MessageSquarePlus,
  PanelLeft, PanelRight, Plug, Plus, Search, Shield, ShieldCheck, Sparkles, Square, SquareTerminal, Star, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BorderBeam, ShinyText, useTypewriter } from "@/components/magic";
import { DiffView, ModelMenu, Prose, StatusGlyph, fmtK, fmtMs, fmtSec, toolIcon } from "@/components/shared";
import {
  accessCopy, childAgents, codingRequest, fileTree, planSteps, projects, toolLabel, type ChildAgent, type TimelineEvent, type ToolCall,
} from "@/data/mock";
import { useDiff, useSessions, useTimeline } from "@/data/queries";
import { useCoding, useProto } from "@/store";
import { cn } from "@/lib/utils";

export default function PiNative() {
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(true);
  return (
    <div className="proto-c dark flex h-full bg-canvas text-foreground">
      {left && <Sessions />}
      <Group orientation="horizontal" className="min-w-0 flex-1">
        <Panel minSize="38" className="min-w-0">
          <Chat left={left} right={right} onLeft={() => setLeft((v) => !v)} onRight={() => setRight((v) => !v)} />
        </Panel>
        {right && (
          <>
            <Separator className="w-1 bg-canvas transition-colors hover:bg-primary/40 data-[separator=active]:bg-primary/60" />
            <Panel defaultSize="40" minSize="26" className="min-w-0">
              <WorkPanel />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}

/* ───────────── Sessions and project tree ───────────── */

function Sessions() {
  const { data: sessions } = useSessions();
  const { sessionId, setSession } = useProto();
  const [open, setOpen] = useState<Record<string, boolean>>({ omp: true });
  return (
    <aside className="hidden w-[248px] shrink-0 flex-col bg-canvas text-[13px] lg:flex" aria-label="会话与项目">
      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-3 scrollbar-thin">
        <p className="px-2 pb-1 text-[12px] text-muted-foreground">最近会话</p>
        {sessions?.slice(0, 3).map((s) => (
          <button key={s.id} onClick={() => setSession(s.id)} className="block w-full truncate rounded-md px-2.5 py-1.5 text-left text-foreground/75 hover:bg-secondary">
            {s.title}
          </button>
        ))}
        <p className="mt-4 px-2 pb-1 text-[12px] text-muted-foreground">项目</p>
        {projects.map((p) => (
          <div key={p.id}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-secondary"
              aria-expanded={!!open[p.id]}
            >
              <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open[p.id] && "rotate-90")} />
              {p.pinned ? <Star className="size-3.5 fill-primary/30 text-primary" /> : <Folder className="size-3.5 text-muted-foreground" />}
              <span className="truncate">{p.name}</span>
              {p.dirty > 0 && <span className="ml-auto size-1.5 rounded-full bg-planning" aria-label="有未提交改动" />}
            </button>
            {open[p.id] &&
              sessions?.filter((s) => s.projectId === p.id).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSession(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-8 text-left",
                    s.id === sessionId ? "bg-secondary text-foreground" : "text-foreground/70 hover:bg-secondary/60",
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      s.status === "running" && "bg-primary",
                      s.status === "awaiting" && "bg-planning",
                      (s.status === "idle" || s.status === "archived") && "bg-transparent",
                    )}
                  />
                  <span className="truncate">{s.title}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
      <footer className="flex items-center gap-1 px-3 py-2.5 text-muted-foreground">
        {[Cog, Plug, Bell].map((Icon, i) => (
          <Button key={i} size="icon" variant="ghost" className="size-7" aria-label={["设置", "扩展", "通知"][i]}><Icon className="size-3.5" /></Button>
        ))}
        <span className="ml-auto font-mono text-[11px] whitespace-nowrap">pi 1.3.0</span>
      </footer>
    </aside>
  );
}

/* ───────────── Chat ───────────── */

function Chat({ left, right, onLeft, onRight }: { left: boolean; right: boolean; onLeft: () => void; onRight: () => void }) {
  const { sessionId } = useProto();
  const { data: events } = useTimeline(sessionId);
  const { data: sessions } = useSessions();
  return (
    <section className="flex h-full flex-col rounded-l-xl bg-background lg:border-l lg:border-line">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <IconButton label={left ? "隐藏侧栏" : "显示侧栏"} onClick={onLeft}><PanelLeft className="size-4" /></IconButton>
        <h1 className="min-w-0 truncate text-[13.5px] font-semibold">{sessions?.find((s) => s.id === sessionId)?.title}</h1>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="新会话"><MessageSquarePlus className="size-4" /></IconButton>
          <IconButton label="搜索"><Search className="size-4" /></IconButton>
          <IconButton label={right ? "隐藏工作区" : "显示工作区"} onClick={onRight}><PanelRight className="size-4" /></IconButton>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[820px] space-y-4 px-5 py-6 text-[13.5px]">
          {events?.map((e) => <ChatEvent key={e.id} event={e} />)}
        </div>
      </div>
      <Composer />
    </section>
  );
}

function IconButton({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground hover:text-foreground" onClick={onClick} aria-label={label}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ChatEvent({ event }: { event: TimelineEvent }) {
  const coding = useCoding();
  switch (event.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-xl bg-secondary px-3.5 py-2.5 leading-relaxed">{event.text}</div>
        </div>
      );
    case "thinking":
      return <Row icon={<Sparkles className="size-3.5" />} label="思考" muted={event.text} />;
    case "tools":
      if (event.calls.some((c) => c.tool === "bash") && !coding) return null;
      return <ToolsRow summary={event.summary} calls={event.calls} />;
    case "assistant":
      return <Prose text={event.text} className="leading-[1.75] text-foreground/90" codeClassName="bg-secondary text-primary" />;
    case "plan":
      return (
        <div className="rounded-lg border border-line bg-card/60 px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-[12.5px] text-planning"><Shield className="size-3.5" />计划，5 步</p>
          <ol className="space-y-1">
            {planSteps.map((s, i) => (
              <li key={s.title} className="flex gap-2.5"><span className="font-mono text-muted-foreground">{i + 1}</span><span><span className="text-foreground">{s.title}</span><span className="text-muted-foreground">，{s.body}</span></span></li>
            ))}
          </ol>
        </div>
      );
    case "approval":
      return <ApprovalBar />;
    case "agents":
      return coding ? <Orchestration /> : null;
    case "verify":
      return coding ? <LiveReply /> : null;
  }
}

function Row({ icon, label, muted, children, defaultOpen = false }: { icon: ReactNode; label: ReactNode; muted?: string; children?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-2 text-left text-[12.5px] text-muted-foreground hover:text-foreground">
        {icon}<span className="shrink-0 text-foreground/80">{label}</span>
        {muted && !open && <span className="min-w-0 flex-1 truncate font-mono text-[12px] opacity-70">{muted}</span>}
        <ChevronRight className={cn("ml-auto size-3.5 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-1.5 ml-[22px] text-[12.5px] leading-relaxed text-muted-foreground">{children ?? muted}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolsRow({ summary, calls }: { summary: string; calls: ToolCall[] }) {
  const total = calls.reduce((n, c) => n + c.ms, 0);
  const running = calls.some((c) => c.status === "running");
  return (
    <Row
      icon={<Cog className={cn("size-3.5", running && "animate-spin [animation-duration:3s]")} />}
      label={running ? <ShinyText>已处理 {fmtMs(total)}</ShinyText> : `已处理 ${fmtMs(total)}`}
      muted={`${calls.length} 个工具，${summary}`}
      defaultOpen={running}
    >
      <ul className="space-y-0.5">
        {calls.map((c) => {
          const Icon = toolIcon[c.tool];
          return (
            <li key={c.id} className="flex items-center gap-2">
              <Icon className="size-3.5" />
              <span className="w-9 text-foreground/70">{toolLabel[c.tool]}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/80">{c.target}</span>
              <span>{c.detail}</span>
              <StatusGlyph status={c.status} />
            </li>
          );
        })}
      </ul>
    </Row>
  );
}

function ApprovalBar() {
  const { access, approve, revise, deny, revoke, reopen } = useProto();
  const [details, setDetails] = useState(false);
  const awaiting = access === "awaiting";
  return (
    <motion.div layout className={cn("rounded-lg border-l-2 bg-card px-4 py-3", awaiting ? "border-planning" : access === "coding" ? "border-coding" : "border-inspect")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ShieldCheck className={cn("size-4", awaiting ? "text-planning" : access === "coding" ? "text-coding" : "text-inspect")} />
        <span className="font-medium">{awaiting ? "申请编程授权" : accessCopy[access].label}</span>
        <button onClick={() => setDetails((v) => !v)} className="text-[12.5px] text-muted-foreground underline-offset-2 hover:underline">
          {codingRequest.scope.length} 个文件，{codingRequest.riskFlags.join(" ")}
        </button>
        <div className="ml-auto flex gap-1.5">
          {awaiting ? (
            <>
              <Button size="sm" className="h-7 bg-coding text-[#06241a] hover:bg-coding/90" onClick={approve}>批准</Button>
              <Button size="sm" variant="secondary" className="h-7" onClick={revise}>修改计划</Button>
              <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={deny}>保持只读</Button>
            </>
          ) : access === "coding" ? (
            <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={revoke}>/access revoke</Button>
          ) : (
            <Button size="sm" variant="ghost" className="h-7" onClick={reopen}>重新申请</Button>
          )}
        </div>
      </div>
      {details && (
        <div className="mt-2.5 grid gap-1 font-mono text-[12px] text-muted-foreground">
          {codingRequest.scope.map((p) => <span key={p}>{p}</span>)}
        </div>
      )}
    </motion.div>
  );
}

/* Signature: main agent → children, connected like a process tree. */
function Orchestration() {
  const { running } = useProto();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-line bg-card/50 p-4">
      <p className="mb-4 flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <Users className="size-3.5" />子代理 {running ? <ShinyText>运行中 2/4</ShinyText> : "已停止"}<span className="ml-auto font-mono">名额 4/8，并发 1/2，$0.142 / $0.25</span>
      </p>
      <div className="grid grid-cols-[150px_40px_1fr] items-center">
        <div className="rounded-lg border border-line bg-secondary px-3 py-3">
          <p className="flex items-center gap-1.5 font-semibold"><Bot className="size-4 text-primary" />主 Agent</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">协调 4 个委派任务</p>
        </div>
        <svg className="h-full w-full overflow-visible" viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden>
          {[12.5, 37.5, 62.5, 87.5].map((y, i) => (
            <path key={y} d={`M0 50 C 20 50, 20 ${y}, 40 ${y}`} fill="none" stroke={i === 2 && running ? "var(--primary)" : "var(--line)"} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <div className="space-y-2">{childAgents.map((a) => <ChildCard key={a.id} agent={a} />)}</div>
      </div>
    </motion.div>
  );
}

function ChildCard({ agent }: { agent: ChildAgent }) {
  const { running } = useProto();
  const live = agent.status === "running" && running;
  const [steps, setSteps] = useState(agent.steps);
  const [secs, setSecs] = useState(agent.seconds);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => { setSecs((s) => s + 1); setSteps((n) => (Math.random() > 0.6 ? n + 1 : n)); }, 1000);
    return () => clearInterval(id);
  }, [live]);
  const role = { scout: "explorer", writer: "writer", reviewer: "reviewer" }[agent.role];
  return (
    <div className={cn("relative flex items-center gap-3 rounded-lg border bg-secondary/60 px-3 py-2", live ? "border-primary/30" : "border-line")}>
      {live && <BorderBeam size={70} duration={4} colorFrom="#8bd3f7" />}
      <span className="relative grid size-7 shrink-0 place-items-center rounded-md bg-background">
        <Bot className="size-3.5 text-muted-foreground" />
        <span className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-secondary", agent.status === "done" ? "bg-coding" : live ? "bg-primary" : "bg-muted-foreground/40")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2"><span className="font-semibold">{role}</span><span className="truncate text-[12px] text-muted-foreground">{agent.task}</span></p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {agent.status === "queued" ? "等待写入完成后启动" : `${steps} 步，${fmtK(agent.tokens)} tok，${fmtSec(secs)}`}
        </p>
      </div>
      <span className="hidden font-mono text-[11px] text-muted-foreground xl:inline">{agent.model}</span>
    </div>
  );
}

function LiveReply() {
  const { running } = useProto();
  const text = "写入者已在受管克隆里完成实现，类型检查与 9 个 Host 测试通过。等审查者确认补丁后，我会在真实工作树中再跑一遍批准的验证。";
  const shown = useTypewriter(text, running);
  return <p className="leading-[1.75] text-foreground/90">{shown}{running && shown.length < text.length && <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse bg-primary" />}</p>;
}

function Composer() {
  const { access, running, stop } = useProto();
  const [text, setText] = useState("");
  const coding = access === "coding";
  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto max-w-[820px] rounded-xl border border-line bg-card focus-within:border-primary/40">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="让 Pi 帮你做任何事，@ 引用文件，/ 使用命令"
          aria-label="输入消息"
          className="block w-full resize-none bg-transparent px-3.5 pt-3 text-[13.5px] outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1 px-2 pb-2 text-[12px]">
          <IconButton label="添加文件"><Plus className="size-4" /></IconButton>
          <span className={cn("flex items-center gap-1 rounded-md px-2 py-1", coding ? "bg-coding/10 text-coding" : "bg-secondary text-muted-foreground")}>
            <Shield className="size-3.5" />{accessCopy[access].label}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-muted-foreground" title="上下文占用">
            <svg viewBox="0 0 20 20" className="size-4 -rotate-90" aria-hidden>
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="2.5" />
              <circle cx="10" cy="10" r="8" fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray={`${0.38 * 50.3} 50.3`} strokeLinecap="round" />
            </svg>
            38%
          </span>
          <ModelMenu
            align="end"
            trigger={<button className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-muted-foreground hover:bg-secondary hover:text-foreground">deepseek-v4-pro<ChevronDown className="size-3" /></button>}
          />
          {running ? (
            <Button size="icon" className="size-7 bg-foreground text-background" onClick={stop} aria-label="停止"><Square className="size-3 fill-current" /></Button>
          ) : (
            <Button size="icon" className="size-7" disabled={!text.trim()} aria-label="发送"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Work panel ───────────── */

type WorkTab = "files" | "diff" | "terminal";

function WorkPanel() {
  const [tab, setTab] = useState<WorkTab>("files");
  const tabs: { id: WorkTab; label: string; icon: typeof File }[] = [
    { id: "files", label: "文件", icon: FolderOpen },
    { id: "diff", label: "改动", icon: GitCompareArrows },
    { id: "terminal", label: "终端", icon: SquareTerminal },
  ];
  return (
    <aside className="flex h-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center gap-0.5 border-b border-line px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px]", tab === t.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <t.icon className="size-3.5" />{t.label}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1">{tab === "files" ? <Files /> : tab === "diff" ? <DiffTab /> : <Terminal />}</div>
    </aside>
  );
}

function Files() {
  const { data: files } = useDiff();
  const [active, setActive] = useState("contracts.mjs");
  const file = files?.find((f) => f.path.endsWith(active)) ?? files?.[0];
  return (
    <div className="grid h-full grid-cols-[minmax(150px,38%)_1fr]">
      <div className="overflow-y-auto border-r border-line py-2 text-[12.5px] scrollbar-thin">
        <p className="flex items-center gap-1.5 px-3 pb-1.5 text-muted-foreground"><FolderOpen className="size-3.5" />only-my-pi</p>
        {fileTree.map((n) => (
          <button
            key={`${n.depth}-${n.name}`}
            onClick={() => !n.dir && setActive(n.name)}
            style={{ paddingLeft: 12 + n.depth * 12 }}
            className={cn("flex w-full items-center gap-1.5 py-[3px] pr-2 text-left", !n.dir && active === n.name ? "bg-accent text-accent-foreground" : "hover:bg-secondary")}
          >
            {n.dir ? <ChevronRight className={cn("size-3 text-muted-foreground", n.open && "rotate-90")} /> : <FileCode2 className="size-3 text-muted-foreground" />}
            <span className="truncate">{n.name}</span>
            {n.changed && <span className="ml-auto font-mono text-[10px] text-planning">{n.changed}</span>}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-col">
        <p className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-3 font-mono text-[11.5px] text-muted-foreground">
          {file?.path}<span className="ml-auto">受管克隆</span>
        </p>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">{file && <DiffView file={file} className="py-1" />}</div>
      </div>
    </div>
  );
}

function DiffTab() {
  const { data: files } = useDiff();
  const coding = useCoding();
  if (!coding) return <p className="p-6 text-center text-[12.5px] text-muted-foreground">批准编程后，这里会显示写入者的补丁。</p>;
  return (
    <div className="h-full overflow-y-auto p-3 scrollbar-thin">
      {files?.map((f) => (
        <section key={f.path} className="mb-3 overflow-hidden rounded-lg border border-line">
          <p className="flex items-center gap-2 bg-card px-3 py-1.5 font-mono text-[11.5px]">
            <span className="min-w-0 flex-1 truncate">{f.path}</span><span className="text-coding">+{f.add}</span><span className="text-destructive">−{f.del}</span>
          </p>
          <DiffView file={f} />
        </section>
      ))}
    </div>
  );
}

function Terminal() {
  const lines = [
    { c: "text-muted-foreground", t: "~/AgentProjects/only-my-pi (clone:omp-run-7f3a)" },
    { c: "text-primary", t: "$ npm run typecheck" },
    { c: "", t: "tsc --noEmit && tsc -p tsconfig.safety.json && tsc -p tsconfig.host.json && tsc -p webui/tsconfig.json" },
    { c: "text-coding", t: "✓ 4 projects, 0 errors (18.4s)" },
    { c: "text-primary", t: "$ node --test tests/host-minimal-web.test.mjs" },
    { c: "", t: "▶ minimal host" },
    { c: "", t: "  ✔ archives an idle session (41ms)" },
    { c: "", t: "  ✔ restores an archived session (22ms)" },
    { c: "", t: "  ✔ archiving a running session is refused (318ms)" },
    { c: "", t: "  ✔ archive state survives a Host restart (604ms)" },
    { c: "text-coding", t: "ℹ tests 9  pass 9  fail 0" },
    { c: "text-primary", t: "$ npm run test:web" },
  ];
  return (
    <div className="h-full overflow-y-auto bg-canvas p-4 font-mono text-[12px] leading-[1.7] scrollbar-thin" role="log" aria-label="命令输出">
      {lines.map((l, i) => <p key={i} className={cn("whitespace-pre-wrap", l.c)}>{l.t}</p>)}
      <p><span className="text-muted-foreground">  RUN  v5.0.1</span><span className="ml-1 inline-block h-3.5 w-[7px] translate-y-0.5 animate-pulse bg-foreground/70" /></p>
    </div>
  );
}
