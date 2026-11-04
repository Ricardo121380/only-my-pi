// B2 · 静室·编码: B's paper, ink and serif reading voice, restructured for coding.
// The conversation stays a calm reading column; code lives in a persistent,
// resizable workspace beside it, and live state sits in one status bar.
// After approval the task plays through `b2/run.ts`: scouts, writer, reviewer,
// an explicit apply, then verification again in the real worktree.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowUp, AtSign, BookOpen, Check, CheckCircle2, ChevronDown, ChevronRight, Circle, CircleDot, Clock3, Command, FileCode2, FileDiff,
  FolderGit2, FolderOpen, GitBranch, Laptop, ListPlus, Lock, MessageSquarePlus, Moon, PanelLeft, PanelRight, Plus, RotateCcw, Search,
  Settings2, Slash, Square, SquareTerminal, Sun, Unlock, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShinyText } from "@/components/magic";
import { Skeleton, StatusGlyph, fmtK, fmtMs, toolIcon } from "@/components/shared";
import {
  accessCopy, budget, childAgents, codingRequest, diffFiles, fileTree, planSteps, projects, riskNotes, toolLabel, verifyChecks,
  type AccessState, type DiffFile, type TimelineEvent, type ToolCall,
} from "@/data/mock";
import { useDiff, useSessions, useTimeline } from "@/data/queries";
import { useCoding, useProto } from "@/store";
import { cn } from "@/lib/utils";
import { agentStatuses, checkStatuses, isActive, phaseCopy, useRun, type ReviewComment, type StreamItem } from "@/prototypes/b2/run";
import { filePaths, resolveFile, snippets, useLayout, useTheme, type WorkTab } from "@/prototypes/b2/layout";
import { useAccounts } from "@/prototypes/b2/accounts";
import Setup from "@/prototypes/b2/Setup";
import Settings from "@/prototypes/b2/Settings";
import { AccountMenu, useCurrentAccount } from "@/prototypes/b2/AccountMenu";
import { FreshSessionView, NewSessionHome, OverviewWorkspace } from "@/prototypes/b2/Home";

export const tone: Record<AccessState, string> = {
  inspect: "bg-inspect",
  planning: "bg-planning",
  awaiting: "bg-planning",
  coding: "bg-coding",
};

/* ───────────── Root ───────────── */

export default function ReadingRoomCoder() {
  const { view, nav, workspace, toggleNav, toggleWorkspace, setPalette, setTab, newSession, readSize } = useLayout();
  const theme = useTheme();
  const access = useProto((s) => s.access);
  const phase = useRun((s) => s.phase);

  // The task follows the grant: approval starts it, revocation stops it.
  useEffect(() => {
    const run = useRun.getState();
    if (access === "coding" && run.phase === "idle") run.start();
    if (access !== "coding" && isActive(run.phase)) run.stop("revoked");
  }, [access]);

  // The workspace follows the work: the plan while approval is pending, the patch once coding.
  useEffect(() => {
    if (access === "awaiting" || access === "planning") setTab("plan");
  }, [access, setTab]);
  useEffect(() => {
    if (phase === "scouting") setTab("changes");
  }, [phase, setTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "k") { e.preventDefault(); setPalette(true); }
      if (key === "j") { e.preventDefault(); toggleWorkspace(); }
      if (key === "b") { e.preventDefault(); toggleNav(); }
      if (key === "n") { e.preventDefault(); newSession(); }
      if (key === ",") { e.preventDefault(); useLayout.getState().openSettings(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPalette, toggleNav, toggleWorkspace, newSession]);

  if (view === "setup") return <div className={cn(theme, "h-full")}><Setup /><Palette /></div>;
  if (view === "settings") {
    return (
      <div className={cn(theme, "flex h-full flex-col bg-canvas text-foreground")} style={{ "--read-size": `${readSize}px` } as CSSProperties}>
        <div className="flex min-h-0 flex-1">
          <Nav open={nav} />
          <div className="min-w-0 flex-1 py-2 pr-2"><Settings /></div>
        </div>
        <StatusBar />
        <Palette />
      </div>
    );
  }
  const inSession = view === "session";

  return (
    <div className={cn(theme, "flex h-full flex-col bg-canvas text-foreground")} style={{ "--read-size": `${readSize}px` } as CSSProperties}>
      <div className="flex min-h-0 flex-1">
        <Nav open={nav} />
        <Group key={inSession ? "session" : "new"} orientation="horizontal" className="min-w-0 flex-1 py-2 pr-2">
          <Panel defaultSize={workspace ? (inSession ? "50" : "58") : "100"} minSize="32" className="min-w-0">
            {view === "home" ? <NewSessionHome /> : view === "fresh" ? <FreshSessionView /> : <Conversation />}
          </Panel>
          {workspace && (
            <>
              <Separator className="group mx-0.5 flex w-1.5 items-center justify-center">
                <span className="h-10 w-1 rounded-full bg-line transition-colors group-hover:bg-primary/50 group-data-[separator=active]:bg-primary" />
              </Separator>
              <Panel defaultSize={inSession ? "50" : "42"} minSize="30" className="min-w-0">
                {inSession ? <Workspace /> : <OverviewWorkspace />}
              </Panel>
            </>
          )}
        </Group>
      </div>
      <StatusBar />
      <Palette />
    </div>
  );
}

/* ───────────── Navigation ───────────── */

function Nav({ open }: { open: boolean }) {
  const { data: sessions } = useSessions();
  const { sessionId, setSession } = useProto();
  const { toggleNav, setPalette, newSession, view, setView, fresh, projectId, openSettings } = useLayout();
  const brokenAccounts = useAccounts((s) => s.accounts.filter((a) => a.status === "invalid" || a.status === "expired").length);
  const setProjectId = (id: string) => useLayout.setState({ projectId: id });
  const openSession = (id: string) => { setSession(id); setView("session"); };
  const theme = useTheme();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const project = projects.find((p) => p.id === projectId)!;
  const mine = sessions?.filter((s) => s.projectId === projectId) ?? [];
  const groups = [
    { label: "进行中", items: mine.filter((s) => s.status === "running" || s.status === "awaiting") },
    { label: "最近", items: mine.filter((s) => s.status === "idle") },
  ];
  const archived = sessions?.filter((s) => s.status === "archived") ?? [];

  return (
    <motion.nav
      initial={false}
      animate={{ width: open ? 256 : 56 }}
      transition={{ type: "spring", bounce: 0, duration: 0.35 }}
      className="hidden shrink-0 flex-col overflow-hidden md:flex"
      aria-label="项目与会话"
    >
      <div className="flex items-center gap-2 px-3 pt-4 pb-3">
        <IconTip label={open ? "收起侧栏" : "展开侧栏"} kbd="⌘B" side="right">
          <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={toggleNav}><PanelLeft className="size-4" /></Button>
        </IconTip>
        {open && <span className="font-read text-[17px] whitespace-nowrap italic">Only My Pi</span>}
      </div>

      {open ? (
        <div className="px-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2 text-left shadow-[0_0_0_1px_var(--line)] hover:bg-card/80">
                <FolderGit2 className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{project.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{project.branch}</span>
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className={cn(theme, "w-60")}>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换项目</DropdownMenuLabel>
              {projects.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => setProjectId(p.id)} className="items-start">
                  <FolderGit2 className="mt-0.5 size-4" />
                  <span className="min-w-0 flex-1">
                    <span className="block">{p.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.path}</span>
                  </span>
                  {p.id === projectId && <Check className="size-3.5" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem><Plus className="size-4" />添加本机目录</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="mt-2 space-y-0.5">
            <NavRow icon={Plus} label="新会话" kbd="⌘N" onClick={newSession} active={view === "home"} />
            <NavRow icon={Search} label="搜索与命令" kbd="⌘K" onClick={() => setPalette(true)} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <IconTip label="新会话" kbd="⌘N" side="right"><Button size="icon" variant="ghost" className="size-8" onClick={newSession}><Plus className="size-4" /></Button></IconTip>
          <IconTip label="搜索与命令" kbd="⌘K" side="right"><Button size="icon" variant="ghost" className="size-8" onClick={() => setPalette(true)}><Search className="size-4" /></Button></IconTip>
        </div>
      )}

      {open && (
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin">
          {fresh && (
            <div className="mb-4">
              <p className="px-2 pb-1 text-[12px] text-muted-foreground">刚刚开始</p>
              <button
                onClick={() => setView("fresh")}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]", view === "fresh" ? "bg-secondary" : "text-foreground/80 hover:bg-secondary/60")}
              >
                <span className="min-w-0 flex-1 truncate">{fresh.title}</span>
                <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">{fresh.mode === "plan" ? "规划" : "只读"}</span>
              </button>
            </div>
          )}
          {!sessions ? <Skeleton className="mx-2 h-5" /> : groups.map((g) => g.items.length > 0 && (
            <div key={g.label} className="mb-4">
              <p className="px-2 pb-1 text-[12px] text-muted-foreground">{g.label}</p>
              {g.items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSession(s.id)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]", view === "session" && s.id === sessionId ? "bg-secondary" : "text-foreground/80 hover:bg-secondary/60")}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.id === "s1" ? <SessionPhase /> : s.status === "running" ? <span className="size-1.5 rounded-full bg-primary" aria-label="运行中" /> : <span className="text-[11px] text-muted-foreground">{s.updated}</span>}
                </button>
              ))}
            </div>
          ))}
          <button onClick={() => setArchivedOpen((v) => !v)} aria-expanded={archivedOpen} className="flex w-full items-center gap-1 px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground">
            <ChevronRight className={cn("size-3.5 transition-transform", archivedOpen && "rotate-90")} />已归档（{archived.length}）
          </button>
          {archivedOpen && archived.map((s) => (
            <p key={s.id} className="flex items-center gap-2 rounded-lg py-1.5 pr-2 pl-7 text-[13px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{s.title}</span><button className="text-[12px] text-primary hover:underline">恢复</button>
            </p>
          ))}
        </div>
      )}
      <div className={cn("mt-auto px-3 pb-3", !open && "flex justify-center")}>
        {open ? (
          <NavRow icon={Settings2} label="设置" kbd="⌘," onClick={() => openSettings()} active={view === "settings"} badge={brokenAccounts || undefined} />
        ) : (
          <IconTip label="设置" kbd="⌘," side="right">
            <Button size="icon" variant="ghost" className="relative size-8" onClick={() => openSettings()}>
              <Settings2 className="size-4" />{brokenAccounts > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-planning" />}
            </Button>
          </IconTip>
        )}
      </div>
    </motion.nav>
  );
}

/** The current session's badge reflects the live run, not a stored status. */
function SessionPhase() {
  const access = useProto((s) => s.access);
  const phase = useRun((s) => s.phase);
  if (access === "awaiting") return <span className="rounded-full bg-planning/15 px-1.5 text-[11px] text-planning">待批准</span>;
  if (isActive(phase)) return <span className="size-1.5 rounded-full bg-primary" aria-label="运行中" />;
  if (phase === "ready") return <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">待审查</span>;
  if (phase === "applied") return <Check className="size-3.5 text-coding" aria-label="已完成" />;
  return null;
}

function NavRow({ icon: Icon, label, kbd, onClick, active, badge }: { icon: typeof Plus; label: string; kbd?: string; onClick?: () => void; active?: boolean; badge?: number }) {
  return (
    <button onClick={onClick} className={cn("flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13.5px] hover:bg-secondary/70", active && "bg-secondary")}>
      <Icon className="size-4 shrink-0" /><span className="whitespace-nowrap">{label}</span>
      {badge ? <span className="rounded-full bg-planning/15 px-1.5 text-[11px] text-planning" aria-label={`${badge} 个账号需要处理`}>{badge}</span> : null}
      {kbd && <Kbd className="ml-auto">{kbd}</Kbd>}
    </button>
  );
}

export function IconTip({ label, kbd, side = "bottom", children }: { label: string; kbd?: string; side?: "bottom" | "right" | "top"; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className={cn(theme, "flex items-center gap-2")}>{label}{kbd && <Kbd>{kbd}</Kbd>}</TooltipContent>
    </Tooltip>
  );
}

/* ───────────── Conversation ───────────── */

function Conversation() {
  const { sessionId, access } = useProto();
  const { data: sessions } = useSessions();
  const { data: events } = useTimeline(sessionId);
  const stream = useRun((s) => s.stream);
  const phase = useRun((s) => s.phase);
  const { workspace, toggleWorkspace } = useLayout();
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const [follow, setFollow] = useState(true);

  // Keep the newest step in view unless the reader scrolled back up. Our own
  // scroll is instant and flagged, so it is never mistaken for the reader's.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !follow) return;
    const id = requestAnimationFrame(() => { programmatic.current = true; el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [stream, follow]);

  const before = useMemo(() => groupTurns((events ?? []).filter((e) => e.kind !== "agents" && e.kind !== "verify" && !(e.kind === "tools" && e.calls.some((c) => c.tool === "bash")))), [events]);

  return (
    <section className="relative flex h-full flex-col rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/70 px-4">
        <h1 className="min-w-0 truncate text-[14px] font-medium">{sessions?.find((s) => s.id === sessionId)?.title ?? "…"}</h1>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full", tone[access])} />
          {access === "coding" && phase !== "idle" ? phaseCopy[phase] : accessCopy[access].label}
        </span>
        <IconTip label={workspace ? "收起工作区" : "打开工作区"} kbd="⌘J">
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={toggleWorkspace} aria-pressed={workspace}><PanelRight className="size-4" /></Button>
        </IconTip>
      </header>
      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          if (programmatic.current) { programmatic.current = false; return; }
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"
      >
        <div className="mx-auto max-w-[660px] px-7 pt-7 pb-10">
          {!events ? (
            <div className="space-y-3">{["w-4/5", "w-full", "w-2/3"].map((w) => <Skeleton key={w} className={cn("h-4", w)} />)}</div>
          ) : (
            <div className="space-y-6">
              {before.map((turn) => <Turn key={turn.key} turn={turn} />)}
              <AnimatePresence initial={false}>
                {stream.map((item) => (
                  <motion.div key={item.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                    <RunItem item={item} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
      {!follow && (
        <button
          onClick={() => setFollow(true)}
          className="absolute bottom-40 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-card px-3 py-1 text-[12px] shadow-[0_0_0_1px_var(--line),0_6px_16px_-8px_rgba(0,0,0,0.3)]"
        >
          <ChevronDown className="size-3.5" />回到最新
        </button>
      )}
      <ApprovalDock />
      <Composer />
    </section>
  );
}

/* Thinking and tool runs fold into one work record per agent step. */
type TurnItem = { key: string; kind: "work"; thinking?: number; calls: ToolCall[]; summary: string } | { key: string; kind: "event"; event: TimelineEvent };

function groupTurns(events: TimelineEvent[]): TurnItem[] {
  const out: TurnItem[] = [];
  let thinking: number | undefined;
  for (const e of events) {
    if (e.kind === "thinking") { thinking = e.seconds; continue; }
    if (e.kind === "tools") { out.push({ key: e.id, kind: "work", thinking, calls: e.calls, summary: e.summary }); thinking = undefined; continue; }
    out.push({ key: e.id, kind: "event", event: e });
  }
  return out;
}

function Turn({ turn }: { turn: TurnItem }) {
  const { setTab } = useLayout();
  if (turn.kind === "work") return <WorkRecord thinking={turn.thinking} calls={turn.calls} summary={turn.summary} />;
  const e = turn.event;
  switch (e.kind) {
    case "user":
      return <UserBubble text={e.text} />;
    case "assistant":
      return <ReadingProse text={e.text} />;
    case "plan":
      return <ArtifactLink icon={BookOpen} title="实施计划" meta={`${planSteps.length} 步，${codingRequest.scope.length} 个文件，两项风险`} onOpen={() => setTab("plan")} />;
    case "approval":
      return <ApprovalRecord />;
    default:
      return null;
  }
}

function RunItem({ item }: { item: StreamItem }) {
  const { setTab } = useLayout();
  const { data: files } = useDiff();
  const adds = files?.reduce((n, f) => n + f.add, 0) ?? 0;
  const dels = files?.reduce((n, f) => n + f.del, 0) ?? 0;
  switch (item.kind) {
    case "note":
      return <ReadingProse text={item.text} />;
    case "work":
      return <WorkRecord calls={item.calls} summary={item.summary} />;
    case "agents":
      return <AgentStrip />;
    case "artifact":
      return item.which === "patch" ? (
        <ArtifactLink icon={FileDiff} title={`补丁 v${item.version} 已生成`} meta={`${files?.length ?? 4} 个文件，+${adds} −${dels}，在受管克隆中`} onOpen={() => setTab("changes")} />
      ) : (
        <ArtifactLink icon={CheckCircle2} tone="coding" title="已应用到工作树" meta={`补丁 v${item.version}，未暂存，未提交`} onOpen={() => setTab("changes")} />
      );
    case "user":
      return <UserBubble text={item.text} tag={item.tag} landed={item.landed} />;
    case "system":
      return <p className="flex items-start gap-2 rounded-xl bg-muted/60 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground"><Clock3 className="mt-0.5 size-3.5 shrink-0" />{item.text}</p>;
  }
}

export function UserBubble({ text, tag, landed }: { text: string; tag?: "steer" | "review" | "message"; landed?: boolean }) {
  return (
    <div className="ml-auto max-w-[88%]">
      {tag === "steer" && (
        <p className="mb-1 text-right text-[11.5px] text-muted-foreground">
          即时补充，{landed ? "已在下一步读取" : <ShinyText>等待下一个可接收的位置</ShinyText>}
        </p>
      )}
      {tag === "review" && <p className="mb-1 text-right text-[11.5px] text-muted-foreground">审查意见，交给写入者</p>}
      <div className={cn("rounded-2xl bg-secondary px-4 py-3 text-[14.5px] leading-relaxed", tag === "review" && "font-mono text-[12.5px] whitespace-pre-wrap", tag === "steer" && !landed && "opacity-75")}>
        {text}
      </div>
    </div>
  );
}

/* Inline `code` that names a project file becomes a link into the workspace. */
export function ReadingProse({ text }: { text: string }) {
  const openFile = useLayout((s) => s.openFile);
  return (
    <div className="space-y-3 font-read text-[length:var(--read-size,16.5px)] leading-[1.75] text-foreground/90">
      {text.split("\n\n").map((para, i) => (
        <p key={i}>
          {para.split(/(`[^`]+`)/).map((part, j) => {
            if (!part.startsWith("`")) return <Fragment key={j}>{part}</Fragment>;
            const code = part.slice(1, -1);
            const file = resolveFile(code);
            return file ? (
              <button key={j} onClick={() => openFile(file)} className="rounded bg-accent px-1 py-0.5 font-mono text-[13px] text-accent-foreground underline decoration-accent-foreground/30 underline-offset-2 hover:decoration-accent-foreground">
                {code}
              </button>
            ) : (
              <code key={j} className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">{code}</code>
            );
          })}
        </p>
      ))}
    </div>
  );
}

export function WorkRecord({ thinking, calls, summary }: { thinking?: number; calls: ToolCall[]; summary: string }) {
  const openFile = useLayout((s) => s.openFile);
  const setTab = useLayout((s) => s.setTab);
  const running = calls.some((c) => c.status === "running");
  const [open, setOpen] = useState(running);
  useEffect(() => { if (running) setOpen(true); }, [running]);
  const total = calls.reduce((n, c) => n + c.ms, 0);
  return (
    <div className="rounded-xl text-[13px]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left text-muted-foreground hover:text-foreground">
        <span className="flex -space-x-1">
          {[...new Set(calls.map((c) => c.tool))].slice(0, 3).map((t) => {
            const Icon = toolIcon[t];
            return <span key={t} className="grid size-5 place-items-center rounded-full bg-secondary ring-2 ring-background"><Icon className="size-3" /></span>;
          })}
        </span>
        <span>{running ? <ShinyText>{summary}</ShinyText> : summary}</span>
        {thinking && <span className="text-muted-foreground/70">，思考 {thinking}s</span>}
        <span className="ml-auto font-mono text-[11px] text-muted-foreground/70">{total ? fmtMs(total) : ""}</span>
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden rounded-xl bg-muted/70 px-1.5 py-1.5">
            {calls.map((c) => {
              const file = c.tool !== "bash" ? resolveFile(c.target.split(":")[0]) : undefined;
              const go = file ? () => openFile(file) : c.tool === "bash" ? () => setTab("terminal") : undefined;
              return (
                <li key={c.id}>
                  <button disabled={!go} onClick={go} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left enabled:hover:bg-background/70">
                    <span className="w-10 shrink-0 text-muted-foreground">{toolLabel[c.tool]}</span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.target}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{c.detail}</span>
                    <StatusGlyph status={c.status} />
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ArtifactLink({ icon: Icon, title, meta, onOpen, tone: color }: { icon: typeof BookOpen; title: string; meta: string; onOpen: () => void; tone?: "coding" }) {
  return (
    <button onClick={onOpen} className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left transition-shadow hover:shadow-[0_6px_24px_-14px_rgba(30,34,29,0.3)]">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", color === "coding" ? "bg-coding/12 text-coding" : "bg-accent text-primary")}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">{meta}</span>
      </span>
      <span className="flex items-center gap-1 text-[12.5px] text-primary opacity-70 group-hover:opacity-100">在工作区查看<ChevronRight className="size-3.5" /></span>
    </button>
  );
}

/* The decision stays visible above the composer; the stream keeps only a record. */
function ApprovalDock() {
  const { access, approve, revise, deny } = useProto();
  const setTab = useLayout((s) => s.setTab);
  return (
    <AnimatePresence>
      {access === "awaiting" && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="mx-auto w-full max-w-[660px] px-5">
          <ApprovalDockCard onApprove={approve} onRevise={revise} onDeny={deny} onPlan={() => setTab("plan")} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ApprovalDockCard({ onApprove, onRevise, onDeny, onPlan }: { onApprove: () => void; onRevise: () => void; onDeny: () => void; onPlan: () => void }) {
  return (
    <div className="rounded-2xl border border-planning/35 bg-card px-4 py-3 shadow-[0_10px_30px_-18px_rgba(122,83,6,0.45)]">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-planning" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold">允许 Pi 修改这个项目？</p>
          <p className="text-[12.5px] text-muted-foreground">
            {codingRequest.scope.length} 个文件，风险 {codingRequest.riskFlags.join("、")}。仅本进程有效，不会提交或推送。
            <button onClick={onPlan} className="ml-1 text-primary hover:underline">查看计划</button>
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 pl-7">
        <Button size="sm" className="rounded-full px-4" onClick={onApprove}>允许编程</Button>
        <Button size="sm" variant="outline" className="rounded-full" onClick={onRevise}>先修改计划</Button>
        <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground" onClick={onDeny}>不允许</Button>
      </div>
    </div>
  );
}

function ApprovalRecord() {
  const { access, grantedAt, revoke, reopen } = useProto();
  const text = {
    awaiting: "Pi 申请了本进程的编程授权，等待你在下方决定。",
    coding: `你允许了编程${grantedAt ? `（${grantedAt}）` : ""}。项目内编辑、写入和沙箱命令已开放。`,
    planning: "你要求先修改计划，编程授权未开放。",
    inspect: "Pi 现在没有编程授权，保持只读。",
  }[access];
  return (
    <div className="flex items-center gap-2.5 border-l-2 pl-3 text-[13px] text-muted-foreground" style={{ borderColor: access === "coding" ? "var(--coding)" : "var(--planning)" }}>
      {access === "coding" ? <Unlock className="size-3.5 text-coding" /> : <Lock className="size-3.5" />}
      <span className="flex-1">{text}</span>
      {access === "coding" && <button onClick={revoke} className="text-primary hover:underline">收回</button>}
      {(access === "inspect" || access === "planning") && <button onClick={reopen} className="text-primary hover:underline">重新询问</button>}
    </div>
  );
}

function AgentStrip() {
  const phase = useRun((s) => s.phase);
  const stoppedIn = useRun((s) => s.stoppedIn);
  const statuses = agentStatuses(phase, stoppedIn);
  const live = Object.values(statuses).filter((s) => s === "running").length;
  return (
    <div className="rounded-2xl bg-muted/70 px-4 py-3.5">
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Users className="size-3.5" />
        {live > 0 ? <ShinyText>{live} 位助手正在工作</ShinyText> : phase === "cancelled" ? "协作已停止" : "协作完成"}
        <span className="ml-auto">名额 4 / 8，并发 {Math.max(live, 0)} / 2</span>
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        {childAgents.map((a) => {
          const status = statuses[a.id];
          return (
            <li key={a.id} className="min-w-0">
              <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-line">
                {status === "running" ? (
                  <motion.div className="h-full w-1/3 rounded-full bg-primary" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
                ) : (
                  <motion.div className={cn("h-full", status === "done" ? "bg-coding" : status === "cancelled" ? "bg-destructive/60" : "bg-transparent")} initial={false} animate={{ width: status === "queued" ? "0%" : "100%" }} transition={{ duration: 0.5 }} />
                )}
              </div>
              <p className="flex items-center gap-1.5 truncate text-[13px] font-medium"><StatusGlyph status={status} className="size-3" />{a.name}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {status === "queued" ? (a.role === "reviewer" ? "等写入完成" : "等待开始") : status === "cancelled" ? "已取消" : a.task}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ───────────── Composer: @ files, / commands, steering and queue ───────────── */

const slashCommands = [
  { cmd: "/plan", label: "只读规划，然后申请一次编程授权" },
  { cmd: "/access", label: "查看或撤销本进程的编程授权" },
  { cmd: "/agents", label: "查看自动子代理的活动" },
  { cmd: "/mcp", label: "列出或配置 MCP 连接" },
];

function Composer() {
  const { model, thinking, access } = useProto();
  const current = useCurrentAccount();
  const { phase, queue, send, stop, sendQueued, dropQueued } = useRun();
  const running = isActive(phase);
  const [text, setText] = useState("");
  const [context, setContext] = useState<string[]>(["packages/host/catalog.mjs"]);
  const token = text.match(/(^|\s)([@/])(\S*)$/);
  const trigger = token?.[2];
  const query = token?.[3] ?? "";
  const fileHits = trigger === "@" ? filePaths.filter((p) => p.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];
  const cmdHits = trigger === "/" ? slashCommands.filter((c) => c.cmd.includes(query)) : [];

  const pickFile = (path: string) => {
    setText((t) => t.replace(/@\S*$/, ""));
    setContext((c) => (c.includes(path) ? c : [...c, path]));
  };
  const submit = (mode: "steer" | "queue" | "message") => {
    const value = text.trim();
    if (!value) return;
    send(value, mode);
    setText("");
  };

  return (
    <div className="relative shrink-0 px-5 pt-3 pb-4">
      <AnimatePresence>
        {(fileHits.length > 0 || cmdHits.length > 0) && (
          <motion.ul
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute inset-x-5 bottom-full z-20 mx-auto max-w-[660px] overflow-hidden rounded-2xl border border-line bg-popover p-1.5 shadow-[0_16px_40px_-20px_rgba(30,34,29,0.4)]"
            role="listbox"
            aria-label={trigger === "@" ? "引用文件" : "命令"}
          >
            {fileHits.map((p) => (
              <li key={p}>
                <button onClick={() => pickFile(p)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-secondary">
                  <FileCode2 className="size-3.5 text-muted-foreground" /><span className="font-mono text-[12.5px]">{p}</span>
                </button>
              </li>
            ))}
            {cmdHits.map((c) => (
              <li key={c.cmd}>
                <button onClick={() => setText(`${c.cmd} `)} className="flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left hover:bg-secondary">
                  <span className="w-16 font-mono text-[12.5px] text-primary">{c.cmd}</span><span className="text-[13px] text-muted-foreground">{c.label}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>

      {queue.length > 0 && (
        <div className="mx-auto mb-2 max-w-[660px] space-y-1.5">
          {queue.map((q, i) => (
            <div key={q.id} className="flex items-center gap-2 rounded-xl bg-muted/80 px-3 py-1.5 text-[13px]">
              <ListPlus className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="shrink-0 text-muted-foreground">排队 {i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              {running ? (
                <span className="shrink-0 text-[12px] text-muted-foreground">当前任务结束后可发送</span>
              ) : (
                <button onClick={() => sendQueued(q.id)} className="shrink-0 text-[12.5px] text-primary hover:underline">发送</button>
              )}
              <button onClick={() => dropQueued(q.id)} aria-label="移除排队消息" className="rounded p-0.5 text-muted-foreground hover:bg-background"><X className="size-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-auto max-w-[660px] rounded-[22px] border border-line bg-card px-4 pt-3 pb-2.5 shadow-[0_10px_30px_-18px_rgba(30,34,29,0.35)] focus-within:border-primary/40">
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
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            if (fileHits[0]) return pickFile(fileHits[0]);
            submit(running ? "steer" : "message");
          }}
          rows={2}
          aria-label="回复 Pi"
          placeholder={
            access === "awaiting" ? "可以先补充说明，Pi 会在下一个可接收的位置读取"
              : running ? "补充说明会在下一步生效；也可以排到当前任务之后"
              : "回复 Pi，@ 引用文件，/ 使用命令"
          }
          className="block w-full resize-none bg-transparent font-read text-[16px] outline-none placeholder:text-muted-foreground/80"
        />
        <div className="mt-1 flex items-center gap-1">
          <IconTip label="引用文件"><Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@`)}><AtSign className="size-4" /></Button></IconTip>
          <IconTip label="命令"><Button size="icon" variant="ghost" className="size-8 rounded-full" onClick={() => setText("/")}><Slash className="size-4" /></Button></IconTip>
          <AccountMenu
            trigger={
              <button className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-secondary">
                {current?.label}，{model}，思考{thinking}<ChevronDown className="size-3" />
              </button>
            }
          />
          {running ? (
            <>
              {text.trim() && (
                <>
                  <IconTip label="排到当前任务之后，不会自动发送">
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => submit("queue")}><ListPlus className="size-3.5" />排队</Button>
                  </IconTip>
                  <IconTip label="在 Agent 下一个可接收的位置读取" kbd="Enter">
                    <Button size="sm" className="rounded-full" onClick={() => submit("steer")}><MessageSquarePlus className="size-3.5" />补充</Button>
                  </IconTip>
                </>
              )}
              <IconTip label="停止任务，取消所有子代理">
                <Button size="icon" variant="outline" className="size-8 rounded-full" onClick={() => stop("user")} aria-label="停止"><Square className="size-3 fill-current" /></Button>
              </IconTip>
            </>
          ) : (
            <Button size="icon" className="size-8 rounded-full" disabled={!text.trim()} onClick={() => submit("message")} aria-label="发送"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Workspace ───────────── */

function Workspace() {
  const { tab, setTab, toggleWorkspace } = useLayout();
  const comments = useRun((s) => s.comments);
  const commands = useRun((s) => s.commands);
  const patchVersion = useRun((s) => s.patchVersion);
  const openComments = comments.filter((c) => !c.resolved).length;
  const tabs: { id: WorkTab; label: string; icon: typeof BookOpen; badge?: string; alert?: boolean }[] = [
    { id: "plan", label: "计划", icon: BookOpen },
    { id: "changes", label: "改动", icon: FileDiff, badge: patchVersion ? (openComments ? `${openComments} 条意见` : "4") : undefined, alert: openComments > 0 },
    { id: "files", label: "文件", icon: FolderOpen },
    { id: "terminal", label: "终端", icon: SquareTerminal, badge: commands.length ? String(commands.length) : undefined },
  ];
  return (
    <section className="@container flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]" aria-label="工作区">
      <header className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-2" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap", tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {tab === t.id && <motion.span layoutId="b2-tab" className="absolute inset-0 rounded-lg bg-secondary" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}
            <t.icon className="relative size-3.5" />
            <span className="relative">{t.label}</span>
            {t.badge && <span className={cn("relative rounded-full px-1.5 text-[11px] tabular-nums", t.alert ? "bg-planning/15 text-planning" : "bg-background text-muted-foreground")}>{t.badge}</span>}
          </button>
        ))}
        <IconTip label="收起工作区" kbd="⌘J">
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={toggleWorkspace}><X className="size-4" /></Button>
        </IconTip>
      </header>
      <div className="min-h-0 flex-1">
        {tab === "plan" && <PlanTab />}
        {tab === "changes" && <ChangesTab />}
        {tab === "files" && <FilesTab />}
        {tab === "terminal" && <TerminalTab />}
      </div>
    </section>
  );
}

function PlanTab() {
  const openFile = useLayout((s) => s.openFile);
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <article className="mx-auto grid max-w-[760px] grid-cols-1 gap-x-6 px-7 py-8 @[620px]:grid-cols-[1fr_10rem]">
        <header>
          <h2 className="font-read text-[26px] leading-tight font-semibold tracking-tight">会话归档</h2>
          <p className="mt-2 font-read text-[15.5px] leading-relaxed text-muted-foreground">{codingRequest.taskSummary}</p>
        </header>
        <div className="hidden @[620px]:block" />
        {planSteps.map((step, i) => (
          <div key={step.title} className="contents">
            <section className="mt-6 border-t border-line pt-4">
              <h3 className="text-[14px] font-semibold"><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{step.title}</h3>
              <p className="mt-1.5 font-read text-[15.5px] leading-[1.7] text-foreground/85">{step.body}</p>
            </section>
            <aside className="text-[12px] leading-snug text-muted-foreground @[620px]:mt-6 @[620px]:pt-4">
              {i === 0 && <Margin flag="public-api" />}
              {i === 3 && <Margin flag="schema" />}
            </aside>
          </div>
        ))}
        <section className="mt-8 rounded-2xl bg-muted/70 p-4 @[620px]:col-span-2">
          <h3 className="text-[13px] font-semibold">申请修改的文件</h3>
          <ul className="mt-2 grid gap-1 @[520px]:grid-cols-2">
            {codingRequest.scope.map((p) => (
              <li key={p}><button onClick={() => openFile(p)} className="truncate font-mono text-[12px] text-primary hover:underline">{p}</button></li>
            ))}
          </ul>
          <h3 className="mt-4 text-[13px] font-semibold">批准的验证</h3>
          <ul className="mt-2 space-y-1 font-mono text-[12px] text-foreground/80">
            {codingRequest.verification.map((v) => <li key={v}>{v}</li>)}
          </ul>
        </section>
      </article>
    </div>
  );
}

function Margin({ flag }: { flag: string }) {
  return (
    <p className="mt-2 border-l-2 border-planning pl-2 @[620px]:mt-0">
      <span className="font-mono text-planning">{flag}</span><br />{riskNotes[flag]}
    </p>
  );
}

function Pipeline() {
  const phase = useRun((s) => s.phase);
  const stoppedIn = useRun((s) => s.stoppedIn);
  const statuses = checkStatuses(phase, stoppedIn);
  return (
    <ol className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-4 py-2.5 text-[12px] scrollbar-thin" aria-label="验证进度">
      {verifyChecks.map((c, i) => (
        <li key={c.id} className="flex shrink-0 items-center gap-1">
          {i > 0 && <span className={cn("mx-1 h-px w-4", statuses[c.id] === "done" ? "bg-coding" : "bg-line")} />}
          <StatusGlyph status={statuses[c.id]} />
          <span className={statuses[c.id] === "done" ? "" : "text-muted-foreground"}>{c.label}</span>
        </li>
      ))}
    </ol>
  );
}

function ChangesTab() {
  const coding = useCoding();
  const { data: files } = useDiff();
  const { phase, patchVersion, comments, viewed, toggleViewed } = useRun();
  const [selected, setSelected] = useState(0);
  if (!coding && phase === "idle") return <Empty icon={Lock} title="还没有改动" body="允许编程后，写入者在受管克隆中生成的补丁会出现在这里。你先审查，再决定是否应用到工作树。" />;
  if (!patchVersion) {
    return (
      <div className="flex h-full flex-col">
        <Pipeline />
        {phase === "cancelled"
          ? <Empty icon={Square} title="任务已停止" body="写入完成前停止了，没有生成补丁，工作树保持原样。" />
          : <Empty
              icon={FileDiff}
              title={<ShinyText>{phase === "scouting" ? "侦察者正在只读梳理项目" : "写入者正在受管克隆中工作"}</ShinyText>}
              body="补丁生成并通过克隆里的检查后会出现在这里。你的工作树在此之前不会被改动。"
            />}
      </div>
    );
  }
  const file = files?.[selected];
  return (
    <div className="flex h-full flex-col">
      <Pipeline />
      {phase === "applied" && (
        <p className="flex shrink-0 items-center gap-2 border-b border-line bg-coding/8 px-4 py-2 text-[12.5px] text-coding">
          <CheckCircle2 className="size-3.5" />补丁 v{patchVersion} 已应用到工作树，验证通过。未暂存，未提交。
        </p>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] @[560px]:grid-cols-[11.5rem_minmax(0,1fr)] @[560px]:grid-rows-1">
        <ul className="max-h-36 overflow-y-auto border-b border-line py-1.5 scrollbar-thin @[560px]:max-h-none @[560px]:border-r @[560px]:border-b-0">
          {files?.map((f, i) => {
            const open = comments.filter((c) => c.file === f.path && !c.resolved).length;
            const seen = viewed.includes(f.path);
            return (
              <li key={f.path} className={cn("flex items-center", i === selected ? "bg-accent text-accent-foreground" : "hover:bg-secondary/60")}>
                <button onClick={() => toggleViewed(f.path)} aria-pressed={seen} aria-label={seen ? `取消已查看 ${f.path}` : `标为已查看 ${f.path}`} className="py-2 pr-1 pl-3">
                  {seen ? <CheckCircle2 className="size-3.5 text-coding" /> : <Circle className="size-3.5 text-muted-foreground/60" />}
                </button>
                <button onClick={() => setSelected(i)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-3 text-left text-[12.5px]">
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate font-medium", seen && "text-muted-foreground")}>{f.path.split("/").pop()}</span>
                    <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{f.path.split("/").slice(0, -1).join("/")}</span>
                  </span>
                  {open > 0 && <span className="rounded-full bg-planning/15 px-1.5 text-[10.5px] text-planning">{open}</span>}
                  <span className="font-mono text-[11px] text-coding">+{f.add}</span>
                </button>
              </li>
            );
          })}
          <li className="px-3 pt-2 pb-1 text-[11.5px] text-muted-foreground">已查看 {viewed.length} / {files?.length ?? 0}</li>
        </ul>
        <div className="flex min-h-0 flex-col">
          {file && (
            <>
              <p className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-4 font-mono text-[11.5px] text-muted-foreground">
                <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
                <span className="font-sans">补丁 v{patchVersion}，点行号写意见</span>
              </p>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"><ReviewDiff file={file} /></div>
            </>
          )}
        </div>
      </div>
      <ChangesFooter />
    </div>
  );
}

/* Diff with line comments. Reviewer notes and your own sit inline with the code. */
function ReviewDiff({ file }: { file: DiffFile }) {
  const { comments, addComment, removeComment, phase } = useRun();
  const [draftLine, setDraftLine] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const canComment = phase === "ready";
  const lastRowFor = useMemo(() => {
    const map = new Map<number, number>();
    file.lines.forEach((l, i) => { if (l.n) map.set(l.n, i); });
    return map;
  }, [file]);
  const save = () => {
    if (draftLine !== null && draft.trim()) addComment(file.path, draftLine, draft.trim());
    setDraft(""); setDraftLine(null);
  };

  return (
    <table className="w-full border-collapse font-mono text-[12px] leading-[1.65]">
      <tbody>
        {file.lines.map((line, i) => {
          if (line.type === "hunk") return <tr key={i} className="bg-accent/60 text-accent-foreground"><td colSpan={3} className="px-3 py-0.5">{line.text}</td></tr>;
          const anchored = line.n !== undefined && lastRowFor.get(line.n) === i;
          const notes = anchored ? comments.filter((c) => c.file === file.path && c.line === line.n) : [];
          return (
            <Fragment key={i}>
              <tr className={cn("group", line.type === "add" && "bg-coding/10", line.type === "del" && "bg-destructive/10")}>
                <td className="w-11 p-0 text-right">
                  <button
                    disabled={!canComment || line.n === undefined}
                    onClick={() => { setDraftLine(line.n!); setDraft(""); }}
                    aria-label={`在第 ${line.n} 行写意见`}
                    className="relative w-full px-2 text-muted-foreground/70 enabled:hover:text-primary"
                  >
                    {canComment && <Plus className="absolute top-1/2 left-0.5 size-3 -translate-y-1/2 text-primary opacity-0 group-hover:opacity-100" />}
                    {line.n}
                  </button>
                </td>
                <td className={cn("w-4 select-none", line.type === "add" ? "text-coding" : line.type === "del" ? "text-destructive" : "text-transparent")}>
                  {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                </td>
                <td className="pr-4 break-all whitespace-pre-wrap">{line.text || " "}</td>
              </tr>
              {notes.map((c) => <CommentRow key={c.id} comment={c} onRemove={() => removeComment(c.id)} />)}
              {anchored && draftLine === line.n && (
                <tr>
                  <td colSpan={3} className="px-3 py-2">
                    <div className="rounded-xl border border-primary/40 bg-card p-2 font-sans">
                      <textarea
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save(); if (e.key === "Escape") setDraftLine(null); }}
                        rows={2}
                        placeholder={`对第 ${line.n} 行的意见，写入者修改时会读到`}
                        aria-label={`第 ${line.n} 行的意见`}
                        className="block w-full resize-none bg-transparent px-1 text-[13px] outline-none placeholder:text-muted-foreground"
                      />
                      <div className="mt-1 flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => setDraftLine(null)}>取消</Button>
                        <Button size="sm" className="h-7 rounded-full" disabled={!draft.trim()} onClick={save}>添加意见</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

export function CommentRow({ comment, onRemove }: { comment: ReviewComment; onRemove: () => void }) {
  return (
    <tr>
      <td colSpan={3} className="px-3 py-1.5">
        <div className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2 font-sans text-[13px]", comment.resolved ? "border-line bg-muted/50 text-muted-foreground" : comment.author === "reviewer" ? "border-planning/40 bg-planning/8" : "border-primary/35 bg-accent/50")}>
          <span className={cn("mt-0.5 shrink-0 rounded-full px-1.5 text-[11px]", comment.author === "reviewer" ? "bg-planning/15 text-planning" : "bg-primary/15 text-primary")}>
            {comment.author === "reviewer" ? "审查者" : "你"}
          </span>
          <p className={cn("min-w-0 flex-1 leading-relaxed", comment.resolved && "line-through decoration-muted-foreground/50")}>{comment.text}</p>
          {comment.resolved ? (
            <span className="shrink-0 text-[11.5px] text-coding">已处理</span>
          ) : comment.author === "you" ? (
            <button onClick={onRemove} aria-label="删除这条意见" className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-background"><X className="size-3.5" /></button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function ChangesFooter() {
  const { phase, comments, apply, requestChanges, patchVersion } = useRun();
  const setTab = useLayout((s) => s.setTab);
  const [confirming, setConfirming] = useState(false);
  const open = comments.filter((c) => !c.resolved).length;
  useEffect(() => { if (phase !== "ready") setConfirming(false); }, [phase]);

  const message = {
    reviewing: "全新审查进行中，完成后才能应用。",
    revising: "写入者正在按意见修改，之后会重新审查。",
    ready: open ? `还有 ${open} 条意见未处理。可以让写入者修改，也可以直接应用。` : "审查通过。应用后会在工作树中重新验证，不会暂存或提交。",
    applying: "正在把补丁写入工作树。",
    verifying: "正在工作树中重新运行批准的验证。",
    applied: "已应用并验证。检查后可以自行提交。",
    cancelled: "任务已停止，补丁没有应用到工作树。",
  }[phase as "reviewing"] ?? "";

  return (
    <footer className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">{message}</p>
      {phase === "applied" || phase === "verifying" ? (
        <Button size="sm" variant="outline" className="rounded-full" onClick={() => setTab("terminal")}><SquareTerminal className="size-3.5" />查看验证输出</Button>
      ) : confirming ? (
        <span className="flex items-center gap-2 text-[12.5px]">
          将修改工作树中的 4 个文件
          <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setConfirming(false)}>取消</Button>
          <Button size="sm" className="rounded-full bg-coding text-[var(--coding-foreground)] hover:bg-coding/90" onClick={apply}>确认应用 v{patchVersion}</Button>
        </span>
      ) : (
        <>
          <Button size="sm" variant="outline" className="rounded-full" disabled={phase !== "ready" || open === 0} onClick={requestChanges}>
            请求修改{open > 0 && `（${open}）`}
          </Button>
          <Button size="sm" className="rounded-full" disabled={phase !== "ready"} onClick={() => setConfirming(true)}>应用到工作树</Button>
        </>
      )}
    </footer>
  );
}

export function FilesTab({ plain = false }: { plain?: boolean }) {
  const { file, openFile } = useLayout();
  const run = useRun();
  const phase = run.phase;
  const patchVersion = plain ? 0 : run.patchVersion;
  const diff = useMemo(() => diffFiles.find((d) => d.path === file), [file]);
  const hasPatch = patchVersion > 0;
  const rows = useMemo(() => {
    const stack: string[] = [];
    return fileTree.map((n) => {
      stack.length = n.depth;
      const path = [...stack, n.name].join("/");
      if (n.dir) stack.push(n.name);
      return { ...n, path };
    });
  }, []);
  const label = diff && hasPatch ? (phase === "applied" ? `工作树，已应用补丁 v${patchVersion}` : `受管克隆中的补丁 v${patchVersion}`) : "工作树，只读";
  return (
    <div className="grid h-full grid-cols-1 @[560px]:grid-cols-[12.5rem_1fr]">
      <nav className="hidden overflow-y-auto border-r border-line py-2 text-[12.5px] scrollbar-thin @[560px]:block" aria-label="文件树">
        {rows.map((n) => (
          <button
            key={n.path}
            onClick={() => !n.dir && openFile(n.path)}
            style={{ paddingLeft: 10 + n.depth * 12 }}
            className={cn("flex w-full items-center gap-1.5 py-[3px] pr-2 text-left", !n.dir && n.path === file ? "bg-accent text-accent-foreground" : "hover:bg-secondary/60")}
          >
            {n.dir ? <ChevronRight className={cn("size-3 text-muted-foreground", n.open && "rotate-90")} /> : <FileCode2 className="size-3 text-muted-foreground" />}
            <span className="truncate">{n.name}</span>
            {n.changed && hasPatch && <span className={cn("ml-auto font-mono text-[10px]", phase === "applied" ? "text-planning" : "text-primary")}>{n.changed}</span>}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-col">
        <p className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-4 font-mono text-[12px] text-muted-foreground">
          {file.split("/").map((part, i, all) => (
            <Fragment key={i}>{i > 0 && <ChevronRight className="size-3" />}<span className={i === all.length - 1 ? "text-foreground" : ""}>{part}</span></Fragment>
          ))}
          <span className="ml-auto pl-3 font-sans text-[11.5px] whitespace-nowrap">{label}</span>
        </p>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {diff && hasPatch ? <ReviewDiff file={diff} /> : <Source path={file} />}
        </div>
      </div>
    </div>
  );
}

function Source({ path }: { path: string }) {
  const lines = snippets[path] ?? diffFiles.find((d) => d.path === path)?.lines.filter((l) => l.type !== "add" && l.type !== "hunk").map((l) => l.text) ?? ["// 预览这个文件需要读取工作树。"];
  return (
    <table className="w-full font-mono text-[12px] leading-[1.7]">
      <tbody>
        {lines.map((text, i) => (
          <tr key={i}><td className="w-10 px-2 text-right text-muted-foreground/60 select-none">{i + 1}</td><td className="pr-4 whitespace-pre">{text || " "}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TerminalTab() {
  const coding = useCoding();
  const commands = useRun((s) => s.commands);
  if (!coding && commands.length === 0) return <Empty icon={SquareTerminal} title="还没有运行命令" body="只读阶段不会执行命令。允许编程后，Pi 在沙箱中运行的命令及其输出会按顺序出现在这里。" />;
  if (commands.length === 0) return <Empty icon={SquareTerminal} title={<ShinyText>等待写入完成</ShinyText>} body="写入者完成后，批准的检查命令会先在受管克隆中运行。" />;
  const groups = (["受管克隆", "工作树"] as const).map((where) => ({ where, runs: commands.filter((c) => c.where === where) })).filter((g) => g.runs.length);
  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 scrollbar-thin" role="log" aria-label="命令输出">
      {groups.map((g) => (
        <section key={g.where} className="space-y-2.5">
          <h3 className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
            {g.where === "工作树" ? <Laptop className="size-3.5" /> : <FolderGit2 className="size-3.5" />}{g.where}
          </h3>
          {g.runs.map((r) => (
            <article key={r.id} className="overflow-hidden rounded-xl border border-line bg-background">
              <header className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
                <StatusGlyph status={r.exit === null ? "running" : r.exit === 0 ? "done" : "cancelled"} />
                <span className="min-w-0 flex-1 truncate font-mono">{r.cmd}</span>
                <span className={cn("rounded-full px-1.5 font-mono text-[11px]", r.exit === 0 ? "bg-coding/12 text-coding" : "bg-secondary text-muted-foreground")}>
                  {r.exit === null ? "运行中" : `exit ${r.exit}`}
                </span>
                {r.ms > 0 && <span className="font-mono text-[11px] text-muted-foreground">{fmtMs(r.ms)}</span>}
              </header>
              <pre className="overflow-x-auto px-3 py-2 font-mono text-[11.5px] leading-[1.7] text-foreground/80 scrollbar-thin">
                {r.out.join("\n")}{r.exit === null && <span className="ml-0.5 inline-block h-3 w-[6px] translate-y-0.5 animate-pulse bg-foreground/60" />}
              </pre>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

export function Empty({ icon: Icon, title, body }: { icon: typeof Lock; title: ReactNode; body: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-10 text-center">
      <span className="grid size-10 place-items-center rounded-2xl bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
      <p className="mt-1 text-[14px] font-medium">{title}</p>
      <p className="max-w-[20rem] font-read text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

/* ───────────── Status bar ───────────── */

function StatusBar() {
  const { access, model, reopen } = useProto();
  const { phase, stoppedIn, dirty, reset } = useRun();
  const { night, toggleNight, view, setView } = useLayout();
  const inSession = view === "session";
  const statuses = agentStatuses(phase, stoppedIn);
  const live = Object.values(statuses).filter((s) => s === "running").length;
  const done = Object.values(statuses).filter((s) => s === "done").length;
  const restart = () => { reset(); reopen(); setView("session"); };
  const label = !inSession ? accessCopy.inspect.label : access === "coding" && phase !== "idle" ? phaseCopy[phase] : accessCopy[access].label;
  const dot = !inSession ? tone.inspect : tone[access];
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden px-4 text-[11.5px] whitespace-nowrap text-muted-foreground" aria-label="状态栏">
      <span className="flex items-center gap-1.5"><GitBranch className="size-3" />codex/dev/pi-native-web</span>
      <span className="flex items-center gap-1.5"><CircleDot className={cn("size-3", dirty > 3 ? "text-coding" : "text-planning")} />{dirty} 处未提交</span>
      <span className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", dot)} />{label}</span>
      {inSession && phase !== "idle" && <span className="hidden items-center gap-1.5 md:flex"><Users className="size-3" />子代理 {live} 运行，{done} 完成</span>}
      <span className="ml-auto hidden xl:inline">Token {fmtK(budget.tokens.used)} / {fmtK(budget.tokens.max)}</span>
      <span className="hidden xl:inline">${budget.costUsd.used.toFixed(3)} / ${budget.costUsd.max.toFixed(2)}</span>
      <span className="ml-auto hidden items-center gap-1.5 sm:flex xl:ml-0">
        <svg viewBox="0 0 20 20" className="size-3 -rotate-90" aria-hidden>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--line)" strokeWidth="3" />
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--primary)" strokeWidth="3" strokeDasharray={`${0.38 * 50.3} 50.3`} />
        </svg>
        上下文 38%
      </span>
      <span className="hidden font-mono xl:inline">{model}</span>
      <span className="flex items-center gap-1.5"><Laptop className="size-3" />本机 Host<span className="size-1.5 rounded-full bg-coding" /></span>
      <IconTip label="从头重新演示这个任务" side="top">
        <button onClick={restart} className="flex items-center gap-1 hover:text-foreground"><RotateCcw className="size-3" />重新演示</button>
      </IconTip>
      <IconTip label={night ? "切换到日间" : "切换到夜间"} side="top">
        <button onClick={toggleNight} aria-label={night ? "切换到日间" : "切换到夜间"} className="hover:text-foreground">{night ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}</button>
      </IconTip>
    </footer>
  );
}

/* ───────────── Command palette ───────────── */

function Palette() {
  const { palette, setPalette, openFile, setTab, toggleWorkspace, toggleNight, newSession, restartSetup, setView } = useLayout();
  const theme = useTheme();
  const { revoke, setSession, reopen } = useProto();
  const reset = useRun((s) => s.reset);
  const { data: sessions } = useSessions();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const q = query.trim().toLowerCase();
  const items = [
    { group: "会话", label: "新会话", hint: "⌘N", icon: Plus, run: newSession },
    ...(sessions ?? []).map((s) => ({ group: "会话", label: s.title, hint: s.updated, icon: BookOpen, run: () => { setSession(s.id); setView("session"); } })),
    ...filePaths.map((p) => ({ group: "文件", label: p, hint: "", icon: FileCode2, run: () => openFile(p) })),
    { group: "操作", label: "打开改动", hint: "", icon: FileDiff, run: () => setTab("changes") },
    { group: "操作", label: "打开终端", hint: "", icon: SquareTerminal, run: () => setTab("terminal") },
    { group: "操作", label: "切换工作区", hint: "⌘J", icon: PanelRight, run: toggleWorkspace },
    { group: "操作", label: "切换夜间模式", hint: "", icon: Moon, run: toggleNight },
    { group: "操作", label: "撤销编程授权", hint: "/access revoke", icon: Lock, run: revoke },
    { group: "操作", label: "重新演示这个任务", hint: "", icon: RotateCcw, run: () => { reset(); reopen(); setView("session"); } },
    { group: "操作", label: "重新运行首次配置", hint: "", icon: Settings2, run: restartSetup },
    { group: "设置", label: "打开设置", hint: "⌘,", icon: Settings2, run: () => useLayout.getState().openSettings() },
    { group: "设置", label: "账号与模型", hint: "", icon: Settings2, run: () => useLayout.getState().openSettings("accounts") },
    { group: "设置", label: "工具与技能", hint: "", icon: Settings2, run: () => useLayout.getState().openSettings("tools") },
  ].filter((it) => !q || it.label.toLowerCase().includes(q));
  const shown = items.slice(0, 12);
  const run = (i: number) => { shown[i]?.run(); setPalette(false); setQuery(""); };

  return (
    <Dialog open={palette} onOpenChange={(o) => { setPalette(o); if (!o) setQuery(""); }}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={(e) => e.preventDefault()} className={cn(theme, "top-[18%] translate-y-0 gap-0 overflow-hidden rounded-2xl border-line bg-popover p-0 sm:max-w-[560px]")}>
        <DialogTitle className="sr-only">搜索与命令</DialogTitle>
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Command className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, shown.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); run(cursor); }
            }}
            placeholder="搜索会话、文件或操作"
            aria-label="搜索会话、文件或操作"
            className="h-12 flex-1 bg-transparent text-[14.5px] text-popover-foreground outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[360px] overflow-y-auto p-1.5 scrollbar-thin" role="listbox">
          {shown.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">没有匹配“{query}”的会话、文件或操作。</li>}
          {shown.map((it, i) => (
            <Fragment key={`${it.group}-${it.label}`}>
              {(i === 0 || shown[i - 1].group !== it.group) && <li className="px-2.5 pt-2 pb-1 text-[11.5px] text-muted-foreground">{it.group}</li>}
              <li>
                <button
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => run(i)}
                  aria-selected={i === cursor}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-popover-foreground", i === cursor && "bg-secondary")}
                >
                  <it.icon className="size-3.5 text-muted-foreground" />
                  <span className={cn("min-w-0 flex-1 truncate", it.group === "文件" && "font-mono text-[12.5px]")}>{it.label}</span>
                  {it.hint && <span className="text-[12px] text-muted-foreground">{it.hint}</span>}
                </button>
              </li>
            </Fragment>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
