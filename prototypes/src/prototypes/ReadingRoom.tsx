import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, FileDiff, FolderOpen, Lock, PanelLeft, Plus, Search, Square, Unlock, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShinyText, TextGenerate } from "@/components/magic";
import { DiffView, ModelMenu, Prose, Skeleton, StatusGlyph, fmtMs, toolIcon } from "@/components/shared";
import {
  accessCopy, childAgents, codingRequest, planSteps, riskNotes, toolLabel, verifyChecks, type TimelineEvent, type ToolCall,
} from "@/data/mock";
import { useDiff, useSessions, useTimeline } from "@/data/queries";
import { useCoding, useProto } from "@/store";
import { cn } from "@/lib/utils";

type Sheet = "plan" | "diff" | null;

export default function ReadingRoom() {
  const [navOpen, setNavOpen] = useState(true);
  const [sheet, setSheetState] = useState<Sheet>(null);
  const setSheet = (next: Sheet) => {
    if (next && !sheet) setNavOpen(false);
    setSheetState(next);
  };
  return (
    <div className="proto-b flex h-full bg-canvas text-foreground">
      <Nav open={navOpen} onToggle={() => setNavOpen((v) => !v)} />
      <main className="relative flex min-w-0 flex-1 flex-col bg-background md:my-2 md:mr-2 md:rounded-2xl md:shadow-[0_0_0_1px_var(--line)]">
        <TopBar />
        <Reading onOpen={setSheet} />
      </main>
      <AnimatePresence>{sheet && <SideSheet kind={sheet} onClose={() => setSheet(null)} onSwitch={setSheet} />}</AnimatePresence>
    </div>
  );
}

function Nav({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { data: sessions } = useSessions();
  const { sessionId, setSession } = useProto();
  return (
    <motion.nav
      initial={false}
      animate={{ width: open ? 264 : 56 }}
      transition={{ type: "spring", bounce: 0, duration: 0.35 }}
      className="hidden shrink-0 flex-col overflow-hidden md:flex"
      aria-label="会话"
    >
      <div className="flex items-center gap-2 px-3 pt-4 pb-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" variant="ghost" className="size-8 shrink-0" onClick={onToggle} aria-label={open ? "收起侧栏" : "展开侧栏"}>
              <PanelLeft className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{open ? "收起侧栏" : "展开侧栏"}</TooltipContent>
        </Tooltip>
        {open && <span className="font-read text-[17px] italic tracking-tight whitespace-nowrap">Only My Pi</span>}
      </div>
      <div className="space-y-0.5 px-3">
        <NavAction icon={Plus} label="新会话" open={open} />
        <NavAction icon={Search} label="搜索" open={open} />
        <NavAction icon={FolderOpen} label="项目" open={open} />
      </div>
      {open && (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-4 scrollbar-thin">
          {[
            { label: "今天", items: sessions?.slice(0, 2) },
            { label: "昨天", items: sessions?.slice(2, 4) },
            { label: "更早", items: sessions?.slice(4, 6) },
          ].map((group) => (
            <div key={group.label} className="mb-4">
              <p className="px-2 pb-1 text-[12px] text-muted-foreground">{group.label}</p>
              {!group.items ? <Skeleton className="mx-2 h-5" /> : group.items.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSession(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px]",
                    s.id === sessionId ? "bg-secondary" : "text-foreground/80 hover:bg-secondary/60",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  {s.status === "awaiting" && <Lock className="size-3 text-planning" aria-label="等待批准" />}
                  {s.status === "running" && <span className="size-1.5 rounded-full bg-primary" aria-label="运行中" />}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className={cn("mt-auto flex items-center gap-2.5 px-4 py-4", !open && "justify-center px-0")}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[12px] text-primary-foreground">黄</span>
        {open && <span className="text-[13px] whitespace-nowrap">个人工作区</span>}
      </div>
    </motion.nav>
  );
}

function NavAction({ icon: Icon, label, open }: { icon: typeof Plus; label: string; open: boolean }) {
  return (
    <button className={cn("flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13.5px] hover:bg-secondary/70", !open && "justify-center px-0")} aria-label={label}>
      <Icon className="size-4 shrink-0" />{open && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

function TopBar() {
  const { access } = useProto();
  const { data: sessions } = useSessions();
  const tone = access === "coding" ? "bg-coding" : access === "inspect" ? "bg-inspect" : "bg-planning";
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-5">
      <button className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 text-[14px] hover:bg-secondary">
        <span className="truncate font-medium">{sessions?.find((s) => s.id === "s1")?.title ?? "…"}</span>
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>
      <span className="hidden items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground sm:flex">
        <FolderOpen className="size-3" />only-my-pi
      </span>
      <span className="ml-auto flex items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className={cn("size-2 rounded-full", tone)} />
        {accessCopy[access].label}
      </span>
    </header>
  );
}

function Reading({ onOpen }: { onOpen: (s: Sheet) => void }) {
  const { sessionId } = useProto();
  const { data: events } = useTimeline(sessionId);
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[680px] px-6 pt-6 pb-10">
          {!events ? (
            <div className="space-y-3 pt-8">{["w-4/5", "w-full", "w-2/3"].map((w) => <Skeleton key={w} className={cn("h-4", w)} />)}</div>
          ) : (
            <div className="space-y-7">{events.map((e) => <ReadingEvent key={e.id} event={e} onOpen={onOpen} />)}</div>
          )}
        </div>
      </div>
      <Composer />
    </>
  );
}

function ReadingEvent({ event, onOpen }: { event: TimelineEvent; onOpen: (s: Sheet) => void }) {
  const coding = useCoding();
  switch (event.kind) {
    case "user":
      return (
        <div className="ml-auto max-w-[88%] rounded-2xl bg-secondary px-4 py-3 text-[14.5px] leading-relaxed">{event.text}</div>
      );
    case "thinking":
      return null;
    case "tools":
      if (event.calls.some((c) => c.tool === "bash") && !coding) return null;
      return <ToolLine summary={event.summary} calls={event.calls} />;
    case "assistant":
      return <Prose text={event.text} className="font-read text-[17px] leading-[1.75] text-foreground/90" codeClassName="font-mono text-[13px]" />;
    case "plan":
      return (
        <DocCard
          icon={BookOpen}
          title="实施计划"
          meta={`${planSteps.length} 步，涉及 ${codingRequest.scope.length} 个文件`}
          excerpt={planSteps.slice(0, 2).map((s) => s.title).join("，") + "…"}
          onOpen={() => onOpen("plan")}
        />
      );
    case "approval":
      return <Permission />;
    case "agents":
      return coding ? <AgentStrip /> : null;
    case "verify":
      return coding ? (
        <>
          <DocCard icon={FileDiff} title="改动已就绪，等待审查" meta="4 个文件，+76 −6，在受管克隆中" excerpt="packages/host/contracts.mjs，server.mjs，MinimalApp.tsx…" onOpen={() => onOpen("diff")} />
          <p className="font-read text-[17px] leading-[1.75] text-foreground/90">
            <TextGenerate text="写入者已经完成实现，克隆里的类型检查和 Host 测试都通过了。接下来由一个全新上下文的审查者检查补丁，通过后我会在你的真实工作树里再跑一遍验证。" />
          </p>
        </>
      ) : null;
  }
}

function ToolLine({ summary, calls }: { summary: string; calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const running = calls.some((c) => c.status === "running");
  return (
    <div className="text-[13px]">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <span className="flex -space-x-1">
          {[...new Set(calls.map((c) => c.tool))].slice(0, 3).map((t) => {
            const Icon = toolIcon[t];
            return <span key={t} className="grid size-5 place-items-center rounded-full bg-secondary ring-2 ring-background"><Icon className="size-3" /></span>;
          })}
        </span>
        {running ? <ShinyText>{summary}</ShinyText> : summary}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-2 overflow-hidden rounded-xl bg-muted/70 px-3 py-2">
            {calls.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1">
                <span className="w-10 text-muted-foreground">{toolLabel[c.tool]}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{c.target}</span>
                <span className="text-[12px] text-muted-foreground">{c.detail}</span>
                <span className="w-12 text-right font-mono text-[11px] text-muted-foreground">{c.ms ? fmtMs(c.ms) : ""}</span>
                <StatusGlyph status={c.status} />
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function DocCard({ icon: Icon, title, meta, excerpt, onOpen }: { icon: typeof BookOpen; title: string; meta: string; excerpt: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-stretch overflow-hidden rounded-2xl border border-line bg-card text-left transition-shadow hover:shadow-[0_6px_24px_-12px_rgba(30,34,29,0.25)]"
    >
      <span className="relative w-20 shrink-0 bg-secondary">
        <span className="absolute inset-x-3 top-3 bottom-0 rounded-t-md bg-card shadow-[0_0_0_1px_var(--line)]">
          <span className="block px-2 pt-2"><Icon className="size-3.5 text-primary" /></span>
          {[0, 1, 2, 3].map((i) => <span key={i} className="mx-2 mt-1.5 block h-[3px] rounded bg-line" style={{ width: `${70 - i * 12}%` }} />)}
        </span>
      </span>
      <span className="min-w-0 flex-1 px-4 py-3.5">
        <span className="block text-[14px] font-medium">{title}</span>
        <span className="block text-[12.5px] text-muted-foreground">{meta}</span>
        <span className="mt-1.5 block truncate font-read text-[14px] text-foreground/70 italic">{excerpt}</span>
      </span>
      <span className="flex items-center pr-4 text-[12.5px] text-primary opacity-70 group-hover:opacity-100">打开</span>
    </button>
  );
}

function Permission() {
  const { access, approve, revise, deny, revoke, reopen } = useProto();
  return (
    <motion.section layout className="rounded-2xl border border-line bg-card px-5 py-5">
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full", access === "coding" ? "bg-coding/12 text-coding" : "bg-accent text-primary")}>
          {access === "coding" ? <Unlock className="size-4" /> : <Lock className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold">允许 Pi 修改这个项目？</h3>
          <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
            只在当前进程内有效，限于 only-my-pi 项目内部。不会访问项目外路径或密钥，不会提交、推送或发布。
          </p>
        </div>
      </div>
      <div className="mt-4 ml-11 space-y-1 border-l-2 border-line pl-4 font-mono text-[12px] text-foreground/80">
        {codingRequest.scope.map((p) => <p key={p}>{p}</p>)}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {access === "awaiting" ? (
          <motion.div key="ask" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-5 ml-11 flex flex-wrap items-center gap-2">
            <Button onClick={approve} className="rounded-full px-5">允许编程</Button>
            <Button onClick={revise} variant="outline" className="rounded-full">先修改计划</Button>
            <Button onClick={deny} variant="ghost" className="rounded-full text-muted-foreground">不允许</Button>
          </motion.div>
        ) : (
          <motion.div key="state" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-5 ml-11 flex items-center gap-3 text-[13.5px]">
            {access === "coding" ? (
              <><Check className="size-4 text-coding" /><span>已允许。你可以随时收回。</span><Button size="sm" variant="ghost" className="ml-auto rounded-full" onClick={revoke}>收回授权</Button></>
            ) : (
              <><span className="text-muted-foreground">{access === "planning" ? "已请求修改计划，Pi 会重新提交。" : "保持只读，没有任何文件被修改。"}</span><Button size="sm" variant="ghost" className="ml-auto rounded-full" onClick={reopen}>重新询问</Button></>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

function AgentStrip() {
  const { running } = useProto();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl bg-muted/70 px-4 py-3.5">
      <p className="text-[13px] text-muted-foreground">
        {running ? <ShinyText>4 位助手协作中</ShinyText> : "协作已停止"}，用了 8 个名额中的 4 个
      </p>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {childAgents.map((a, i) => (
          <li key={a.id} className="min-w-0">
            <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-line">
              <motion.div
                className={cn("h-full", a.status === "done" ? "bg-coding" : a.status === "running" ? "bg-primary" : "bg-transparent")}
                initial={{ width: 0 }}
                animate={{ width: a.status === "done" ? "100%" : a.status === "running" ? (running ? "62%" : "40%") : "0%" }}
                transition={{ delay: i * 0.12, duration: 0.6 }}
              />
            </div>
            <p className="truncate text-[13px] font-medium">{a.name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{a.status === "queued" ? "等待写入完成" : a.task}</p>
          </li>
        ))}
      </ol>
    </motion.div>
  );
}

function Composer() {
  const { model, thinking, running, stop, access } = useProto();
  const [text, setText] = useState("");
  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto max-w-[680px] rounded-[22px] border border-line bg-card px-4 pt-3 pb-2.5 shadow-[0_10px_30px_-18px_rgba(30,34,29,0.35)]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          aria-label="回复 Pi"
          placeholder="回复 Pi…"
          className="block w-full resize-none bg-transparent font-read text-[16px] outline-none placeholder:text-muted-foreground/80"
        />
        <div className="mt-1 flex items-center gap-1.5">
          <Button size="icon" variant="ghost" className="size-8 rounded-full" aria-label="添加文件或图片"><Plus className="size-4" /></Button>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[12px] text-muted-foreground">{accessCopy[access].label}</span>
          <ModelMenu
            align="end"
            trigger={
              <button className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-secondary">
                {model}，思考{thinking}<ChevronDown className="size-3" />
              </button>
            }
          />
          {running ? (
            <Button size="icon" variant="outline" className="size-8 rounded-full" onClick={stop} aria-label="停止"><Square className="size-3 fill-current" /></Button>
          ) : (
            <Button size="icon" className="size-8 rounded-full" disabled={!text.trim()} aria-label="发送"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Side sheet: plan as an annotated document, or the diff ───────────── */

function SideSheet({ kind, onClose, onSwitch }: { kind: Exclude<Sheet, null>; onClose: () => void; onSwitch: (s: Sheet) => void }) {
  const coding = useCoding();
  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: "min(46vw, 620px)", opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
      className="my-2 mr-2 hidden shrink-0 overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] md:block"
    >
      <div className="flex h-full w-[min(46vw,620px)] flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3">
          {(["plan", "diff"] as const).map((k) => (
            <button
              key={k}
              disabled={k === "diff" && !coding}
              onClick={() => onSwitch(k)}
              className={cn("rounded-lg px-3 py-1.5 text-[13px] disabled:opacity-40", kind === k ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-secondary/60")}
            >
              {k === "plan" ? "实施计划" : "改动"}
            </button>
          ))}
          <Button size="icon" variant="ghost" className="ml-auto size-8" onClick={onClose} aria-label="关闭侧页"><X className="size-4" /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{kind === "plan" ? <PlanDocument /> : <DiffSheet />}</div>
      </div>
    </motion.aside>
  );
}

function PlanDocument() {
  return (
    <article className="grid grid-cols-[1fr_9.5rem] gap-x-6 px-7 py-8">
      <div>
        <h2 className="font-read text-[26px] leading-tight font-semibold tracking-tight">会话归档</h2>
        <p className="mt-2 font-read text-[15.5px] leading-relaxed text-muted-foreground">{codingRequest.taskSummary}</p>
      </div>
      <div />
      {planSteps.map((step, i) => (
        <div key={step.title} className="contents">
          <section className="mt-6 border-t border-line pt-4">
            <h3 className="text-[14px] font-semibold"><span className="mr-2 text-muted-foreground">{i + 1}</span>{step.title}</h3>
            <p className="mt-1.5 font-read text-[15.5px] leading-[1.7] text-foreground/85">{step.body}</p>
          </section>
          <aside className="mt-6 pt-4 text-[12px] leading-snug text-muted-foreground">
            {i === 0 && <Margin flag="public-api" />}
            {i === 3 && <Margin flag="schema" />}
            {i === 4 && <p><span className="text-foreground">验证</span><br />{codingRequest.verification.map((v) => <span key={v} className="block font-mono text-[11px]">{v}</span>)}</p>}
          </aside>
        </div>
      ))}
    </article>
  );
}

function Margin({ flag }: { flag: string }) {
  return (
    <p className="border-l-2 border-planning pl-2">
      <span className="font-mono text-planning">{flag}</span>
      <br />
      {riskNotes[flag]}
    </p>
  );
}

function DiffSheet() {
  const { data: files } = useDiff();
  return (
    <div className="space-y-5 p-5">
      <ol className="space-y-1.5">
        {verifyChecks.map((c) => (
          <li key={c.id} className="flex items-center gap-2 text-[13px]">
            <StatusGlyph status={c.status} />
            <span>{c.label}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">{c.where}</span>
          </li>
        ))}
      </ol>
      {files?.map((f) => (
        <section key={f.path} className="overflow-hidden rounded-xl border border-line">
          <header className="flex items-center gap-2 bg-muted/70 px-3 py-2 font-mono text-[12px]">
            <span className="min-w-0 flex-1 truncate">{f.path}</span>
            <span className="text-coding">+{f.add}</span>
            {f.del > 0 && <span className="text-destructive">−{f.del}</span>}
          </header>
          <DiffView file={f} wrap />
        </section>
      ))}
    </div>
  );
}
