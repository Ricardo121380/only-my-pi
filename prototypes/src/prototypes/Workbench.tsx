import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowUp, Bot, Brain, Check, ChevronRight, CircleStop, FolderGit2, GitBranch, GripVertical, Laptop, Lock, MessageSquarePlus,
  PanelRight, Paperclip, Search, ShieldCheck, Sparkles, Square, Unlock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { BorderBeam, ShinyText } from "@/components/magic";
import { DiffView, ModelChip, Prose, Skeleton, StatusGlyph, fmtK, fmtMs, fmtSec, toolIcon } from "@/components/shared";
import {
  accessCopy, childAgents, codingRequest, planSteps, riskNotes, verifyChecks, toolLabel,
  type AccessState, type Project, type TimelineEvent, type ToolCall,
} from "@/data/mock";
import { useDiff, useProjects, useSessions, useTimeline } from "@/data/queries";
import { useCoding, useProto } from "@/store";
import { cn } from "@/lib/utils";

export default function Workbench() {
  const [reviewOpen, setReviewOpen] = useState(true);
  return (
    <div className="proto-a flex h-full bg-canvas text-foreground">
      <Group orientation="horizontal" className="h-full">
        <Panel defaultSize="19" minSize="14" maxSize="28" className="min-w-0">
          <Sidebar />
        </Panel>
        <Separator className="w-px bg-line transition-colors hover:bg-primary data-[separator=active]:bg-primary" />
        <Panel defaultSize={reviewOpen ? "50" : "81"} minSize="34" className="min-w-0">
          <Conversation reviewOpen={reviewOpen} onToggleReview={() => setReviewOpen((v) => !v)} />
        </Panel>
        {reviewOpen && (
          <>
            <Separator className="w-px bg-line transition-colors hover:bg-primary data-[separator=active]:bg-primary" />
            <Panel defaultSize="31" minSize="22" className="min-w-0">
              <ReviewPane />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}

/* ───────────── Sidebar ───────────── */

function Sidebar() {
  const { data: projects } = useProjects();
  const { data: sessions } = useSessions();
  const { sessionId, setSession } = useProto();
  const [order, setOrder] = useState<string[] | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ordered = projects ? (order ?? projects.map((p) => p.id)).map((id) => projects.find((p) => p.id === id)!) : [];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = ordered.map((p) => p.id);
    setOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };

  return (
    <aside className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className="grid size-7 place-items-center rounded-md bg-foreground font-mono text-[15px] text-background">π</span>
        <span className="text-[14px] font-semibold tracking-tight">Only My Pi</span>
      </div>
      <div className="space-y-1 px-2.5">
        <Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-[13px]">
          <MessageSquarePlus className="size-4" />新会话<Kbd className="ml-auto">⌘N</Kbd>
        </Button>
        <Button variant="ghost" className="h-8 w-full justify-start gap-2 px-2 text-[13px] text-muted-foreground">
          <Search className="size-4" />搜索会话<Kbd className="ml-auto">⌘K</Kbd>
        </Button>
      </div>
      <div className="mt-4 flex-1 overflow-y-auto px-2.5 pb-4 scrollbar-thin">
        <p className="px-2 pb-1.5 text-[12px] text-muted-foreground">项目，拖动可排序</p>
        {!projects || !sessions ? (
          <div className="space-y-2 px-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ordered.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {ordered.map((project) => (
                <ProjectGroup key={project.id} project={project}>
                  {sessions.filter((s) => s.projectId === project.id && s.status !== "archived").map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setSession(s.id)}
                      className={cn(
                        "group flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-left text-[13px]",
                        s.id === sessionId ? "bg-background font-medium shadow-[0_0_0_1px_var(--line)]" : "text-foreground/80 hover:bg-background/70",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      {s.status === "running" && <span className="size-1.5 rounded-full bg-primary" aria-label="运行中" />}
                      {s.status === "awaiting" && <span className="size-1.5 rounded-full bg-planning" aria-label="等待批准" />}
                      {s.status === "idle" && <span className="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100">{s.updated}</span>}
                    </button>
                  ))}
                </ProjectGroup>
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12px] text-muted-foreground">
        <Laptop className="size-3.5" />本机 Host<span className="size-1.5 rounded-full bg-coding" />已连接
      </div>
    </aside>
  );
}

function ProjectGroup({ project, children }: { project: Project; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  const [open, setOpen] = useState(project.id === "omp");
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("mb-0.5", isDragging && "relative z-10 opacity-80")}>
      <div className="group flex items-center rounded-md hover:bg-background/70">
        <button onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-[13px]" aria-expanded={open}>
          <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          <span className="truncate font-medium">{project.name}</span>
          {project.dirty > 0 && <span className="text-[11px] text-planning">{project.dirty} 处未提交</span>}
        </button>
        <button {...attributes} {...listeners} aria-label={`拖动 ${project.name}`} className="cursor-grab px-1.5 text-muted-foreground opacity-0 group-hover:opacity-100">
          <GripVertical className="size-3.5" />
        </button>
      </div>
      {open && children}
    </div>
  );
}

/* ───────────── Access track: the signature element ───────────── */

const trackStops: { id: AccessState; icon: typeof Lock }[] = [
  { id: "inspect", icon: Lock },
  { id: "planning", icon: Brain },
  { id: "coding", icon: Unlock },
];

function AccessTrack() {
  const { access, grantedAt, revoke, reopen } = useProto();
  const reached = access === "awaiting" ? 1.5 : trackStops.findIndex((s) => s.id === access);
  return (
    <div className="flex items-center gap-3">
      <ol className="flex items-center" aria-label="权限状态">
        {trackStops.map((stop, i) => {
          const active = access === stop.id || (access === "awaiting" && stop.id === "planning");
          const passed = i < reached;
          const color = stop.id === "coding" ? "var(--coding)" : stop.id === "planning" ? "var(--planning)" : "var(--inspect)";
          return (
            <li key={stop.id} className="flex items-center">
              {i > 0 && (
                <span className="relative mx-1 h-px w-5 bg-line xl:w-8">
                  <motion.span
                    className="absolute inset-y-0 left-0"
                    style={{ background: color }}
                    initial={false}
                    animate={{ width: passed || active ? "100%" : access === "awaiting" && i === 2 ? "50%" : "0%" }}
                    transition={{ duration: 0.4 }}
                  />
                </span>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                      active ? "border-transparent text-white" : "border-line text-muted-foreground",
                    )}
                    style={active ? { background: color } : undefined}
                  >
                    <stop.icon className="size-3" />
                    <span className={active ? "" : "hidden 2xl:inline"}>{accessCopy[stop.id].label}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{accessCopy[stop.id].hint}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {access === "awaiting" && <span className="whitespace-nowrap text-[12px] text-planning"><ShinyText>等待你批准</ShinyText></span>}
      {access === "coding" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 whitespace-nowrap text-[12px] text-muted-foreground" onClick={revoke}>撤销</Button>
          </TooltipTrigger>
          <TooltipContent>{grantedAt ? `${grantedAt} 起有效，撤销后回到只读` : "撤销后回到只读"}</TooltipContent>
        </Tooltip>
      )}
      {(access === "inspect" || access === "planning") && (
        <Button size="sm" variant="ghost" className="h-7 text-[12px]" onClick={reopen}>重新申请</Button>
      )}
    </div>
  );
}

/* ───────────── Conversation ───────────── */

function Conversation({ reviewOpen, onToggleReview }: { reviewOpen: boolean; onToggleReview: () => void }) {
  const { sessionId } = useProto();
  const { data: sessions } = useSessions();
  const { data: events, isLoading } = useTimeline(sessionId);
  const session = sessions?.find((s) => s.id === sessionId);
  return (
    <section className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14px] font-semibold">{session?.title ?? "…"}</h1>
          <p className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
            <GitBranch className="size-3 shrink-0" /><span className="truncate">only-my-pi，codex/dev/pi-native-web</span>
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <AccessTrack />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" className="size-8" onClick={onToggleReview} aria-pressed={reviewOpen} aria-label="审查面板">
                <PanelRight className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{reviewOpen ? "收起审查面板" : "打开审查面板"}</TooltipContent>
          </Tooltip>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[760px] space-y-5 px-6 py-8">
          {isLoading || !events ? (
            <div className="space-y-3">{["w-4/5", "w-3/5", "w-11/12"].map((w) => <Skeleton key={w} className={`h-4 ${w}`} />)}</div>
          ) : (
            events.map((event) => <EventView key={event.id} event={event} />)
          )}
        </div>
      </div>
      <Composer />
    </section>
  );
}

function EventView({ event }: { event: TimelineEvent }) {
  const coding = useCoding();
  switch (event.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] leading-relaxed">{event.text}</div>
        </div>
      );
    case "thinking":
      return <Collapsible icon={<Sparkles className="size-3.5" />} label={`思考了 ${event.seconds}s`}><p className="text-[13px] leading-relaxed text-muted-foreground">{event.text}</p></Collapsible>;
    case "tools":
      if (event.calls.some((c) => c.tool === "bash") && !coding) return null;
      return (
        <Collapsible icon={<ShieldCheck className="size-3.5" />} label={event.summary} defaultOpen={event.calls.some((c) => c.status === "running")}>
          <ToolList calls={event.calls} />
        </Collapsible>
      );
    case "assistant":
      return <Prose text={event.text} className="text-[14.5px] leading-[1.7]" />;
    case "plan":
      return <PlanCard />;
    case "approval":
      return <ApprovalCard />;
    case "agents":
      return coding ? <AgentsCard /> : null;
    case "verify":
      return null;
  }
}

function Collapsible({ icon, label, children, defaultOpen = false }: { icon: ReactNode; label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        {icon}{label}<ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="mt-2 border-l border-line pl-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolList({ calls }: { calls: ToolCall[] }) {
  return (
    <ul className="space-y-0.5">
      {calls.map((call) => {
        const Icon = toolIcon[call.tool];
        return (
          <li key={call.id} className="flex items-center gap-2.5 py-1 text-[12.5px]">
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="w-10 shrink-0 text-muted-foreground">{toolLabel[call.tool]}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{call.target}</span>
            {call.detail && <span className="shrink-0 text-muted-foreground">{call.detail}</span>}
            <span className="w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{call.ms ? fmtMs(call.ms) : ""}</span>
            <StatusGlyph status={call.status} />
          </li>
        );
      })}
    </ul>
  );
}

function PlanCard() {
  return (
    <article className="rounded-xl border border-line bg-card">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Brain className="size-4 text-planning" />
        <h2 className="text-[13.5px] font-semibold">实施计划</h2>
        <Badge variant="outline" className="ml-auto border-planning/40 text-planning">复杂任务，需先审批</Badge>
      </header>
      <ol className="space-y-3 px-4 py-4">
        {planSteps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[1.5rem_1fr] gap-x-2 text-[13.5px]">
            <span className="font-mono text-[12px] leading-[1.6rem] text-muted-foreground">{i + 1}.</span>
            <div>
              <p className="font-medium leading-[1.6rem]">{step.title}</p>
              <p className="leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function ApprovalCard() {
  const { access, approve, revise, deny, grantedAt } = useProto();
  return (
    <motion.article
      layout
      className={cn(
        "relative overflow-hidden rounded-xl border bg-card",
        access === "awaiting" ? "border-planning/50 shadow-[0_0_0_4px_color-mix(in_oklab,var(--planning)_10%,transparent)]" : "border-line",
      )}
    >
      <header className="flex items-start gap-3 px-4 pt-4">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", access === "coding" ? "bg-coding/10 text-coding" : "bg-planning/10 text-planning")}>
          {access === "coding" ? <Unlock className="size-4" /> : <Lock className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-semibold">申请本进程的编程授权</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{codingRequest.taskSummary}</p>
        </div>
      </header>
      <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2.5 px-4 py-4 text-[12.5px]">
        <dt className="text-muted-foreground">修改范围</dt>
        <dd className="flex flex-wrap gap-1">
          {codingRequest.scope.map((p) => <code key={p} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{p}</code>)}
        </dd>
        <dt className="text-muted-foreground">风险</dt>
        <dd className="space-y-1">
          {codingRequest.riskFlags.map((flag) => (
            <p key={flag}><span className="mr-1.5 font-mono text-planning">{flag}</span><span className="text-muted-foreground">{riskNotes[flag]}</span></p>
          ))}
        </dd>
        <dt className="text-muted-foreground">验证</dt>
        <dd className="font-mono text-[11.5px] leading-relaxed">{codingRequest.verification.join("，")}</dd>
        <dt className="text-muted-foreground">协作</dt>
        <dd className="text-muted-foreground">2 个只读侦察，1 个受管克隆写入者，1 个全新审查者；不会提交或推送</dd>
      </dl>
      <footer className="flex items-center gap-2 border-t border-line bg-muted/40 px-4 py-3">
        <AnimatePresence mode="wait" initial={false}>
          {access === "awaiting" ? (
            <motion.div key="ask" className="flex w-full items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Button size="sm" className="bg-coding text-white hover:bg-coding/90" onClick={approve}><Check className="size-3.5" />批准编程</Button>
              <Button size="sm" variant="outline" onClick={revise}>修改计划</Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={deny}>保持只读</Button>
              <span className="ml-auto text-[12px] text-muted-foreground">仅本进程有效，恢复会话不会继承</span>
            </motion.div>
          ) : (
            <motion.p key="done" className="text-[12.5px] text-muted-foreground" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
              {access === "coding" && <span className="text-coding">已批准{grantedAt && `，${grantedAt}`}。项目内编辑、写入和沙箱命令已开放。</span>}
              {access === "planning" && "你要求修改计划。Agent 会给出新计划后再次申请。"}
              {access === "inspect" && "已保持只读。Agent 不会修改任何文件。"}
            </motion.p>
          )}
        </AnimatePresence>
      </footer>
    </motion.article>
  );
}

const roleIcon = { scout: Search, writer: Bot, reviewer: Users } as const;
const roleName = { scout: "只读侦察", writer: "受管写入", reviewer: "全新审查" } as const;

function AgentsCard() {
  const { running } = useProto();
  return (
    <motion.article initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-line bg-card">
      <header className="flex items-center gap-2 px-4 py-3 text-[13px]">
        <Users className="size-4 text-muted-foreground" />
        <span className="font-semibold">子代理</span>
        <span className="text-muted-foreground">4 / 8 个名额，并发 1 / 2</span>
      </header>
      <ul className="divide-y divide-line border-t border-line">
        {childAgents.map((agent) => {
          const Icon = roleIcon[agent.role];
          const live = agent.status === "running" && running;
          return (
            <li key={agent.id} className="relative flex items-center gap-3 px-4 py-2.5">
              {live && <BorderBeam size={80} duration={5} />}
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px]"><span className="font-medium">{agent.name}</span><span className="ml-2 text-muted-foreground">{roleName[agent.role]}</span></p>
                <p className="truncate text-[12px] text-muted-foreground">{agent.task}</p>
              </div>
              <span className="hidden font-mono text-[11px] text-muted-foreground sm:block">{agent.model}</span>
              <span className="w-24 text-right font-mono text-[11px] text-muted-foreground">
                {agent.steps ? `${agent.steps} 步，${fmtK(agent.tokens)}` : "等待中"}
              </span>
              <StatusGlyph status={agent.status === "running" && !running ? "cancelled" : agent.status} />
            </li>
          );
        })}
      </ul>
    </motion.article>
  );
}

function Composer() {
  const { access, running, stop } = useProto();
  const [text, setText] = useState("");
  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto max-w-[760px] rounded-2xl border border-line bg-card shadow-[0_1px_2px_rgba(22,24,29,0.04),0_8px_24px_-12px_rgba(22,24,29,0.12)] focus-within:border-primary/50">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder={access === "awaiting" ? "批准前也可以补充说明，Agent 会在下一次可接收时读取" : "描述下一步，或用 @ 引用文件"}
          className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] outline-none placeholder:text-muted-foreground"
          aria-label="输入消息"
        />
        <div className="flex items-center gap-1 px-2.5 pb-2.5">
          <Button size="icon" variant="ghost" className="size-8" aria-label="附加文件"><Paperclip className="size-4" /></Button>
          <ModelChip />
          <span className="ml-1 hidden items-center gap-1 text-[12px] text-muted-foreground md:flex">
            <Laptop className="size-3" />本机工作树
          </span>
          {running ? (
            <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={stop}><Square className="size-3 fill-current" />停止</Button>
          ) : (
            <Button size="icon" className="ml-auto size-8 rounded-full" disabled={!text.trim()} aria-label="发送"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Review pane ───────────── */

function ReviewPane() {
  const { data: files } = useDiff();
  const coding = useCoding();
  const [selected, setSelected] = useState(0);
  const file = files?.[selected];
  const adds = files?.reduce((n, f) => n + f.add, 0) ?? 0;
  const dels = files?.reduce((n, f) => n + f.del, 0) ?? 0;
  return (
    <aside className="flex h-full flex-col bg-background">
      <Tabs defaultValue="changes" className="flex h-full flex-col gap-0">
        <div className="flex h-14 shrink-0 items-center border-b border-line px-3">
          <TabsList className="h-8">
            <TabsTrigger value="changes" className="text-[12.5px]">改动{coding && <span className="ml-1 text-muted-foreground">{files?.length}</span>}</TabsTrigger>
            <TabsTrigger value="verify" className="text-[12.5px]">验证</TabsTrigger>
            <TabsTrigger value="budget" className="text-[12.5px]">预算</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="changes" className="flex min-h-0 flex-1 flex-col">
          {!coding ? (
            <EmptyReview />
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] text-muted-foreground">
                受管克隆中的补丁<span className="ml-auto font-mono"><span className="text-coding">+{adds}</span> <span className="text-destructive">−{dels}</span></span>
              </div>
              <ul className="border-y border-line">
                {files?.map((f, i) => (
                  <li key={f.path}>
                    <button
                      onClick={() => setSelected(i)}
                      className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left font-mono text-[12px]", i === selected ? "bg-accent text-accent-foreground" : "hover:bg-muted")}
                    >
                      <span className="min-w-0 flex-1 truncate">{f.path}</span>
                      <span className="text-coding">+{f.add}</span>
                      {f.del > 0 && <span className="text-destructive">−{f.del}</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{file && <DiffView file={file} className="py-2" />}</div>
              <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
                <p className="text-[12px] leading-snug text-muted-foreground">审查和工作树验证通过后才能应用；不会暂存或提交。</p>
                <Button size="sm" className="ml-auto shrink-0" disabled>应用到工作树</Button>
              </footer>
            </>
          )}
        </TabsContent>
        <TabsContent value="verify" className="min-h-0 flex-1 overflow-y-auto p-4">
          {!coding ? <EmptyReview /> : (
            <ol className="relative space-y-4 border-l border-line pl-5">
              {verifyChecks.map((check) => (
                <li key={check.id} className="relative">
                  <span className="absolute top-0.5 -left-[27px] grid size-3.5 place-items-center rounded-full bg-background"><StatusGlyph status={check.status} /></span>
                  <p className="text-[13px] font-medium">{check.label}<span className="ml-2 text-[11px] font-normal text-muted-foreground">{check.where}</span></p>
                  <p className="text-[12.5px] text-muted-foreground">{check.detail}</p>
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="budget" className="min-h-0 flex-1 overflow-y-auto p-4">
          <BudgetBars />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function EmptyReview() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      <Lock className="size-5 text-muted-foreground" />
      <p className="text-[13px] font-medium">还没有改动</p>
      <p className="max-w-[16rem] text-[12.5px] leading-relaxed text-muted-foreground">批准编程后，写入者在受管克隆中生成的补丁会出现在这里，先审查再应用。</p>
    </div>
  );
}

function BudgetBars() {
  const rows = [
    { label: "子代理", used: 4, max: 8, fmt: (n: number) => `${n}` },
    { label: "Token", used: 30570, max: 50000, fmt: fmtK },
    { label: "费用", used: 0.142, max: 0.25, fmt: (n: number) => `$${n.toFixed(3)}` },
    { label: "工具调用", used: 41, max: 64, fmt: (n: number) => `${n}` },
    { label: "运行时长", used: 412, max: 1800, fmt: fmtSec },
  ];
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">本任务的子代理额度。用尽后不会自动扩额，需要你再次确认。</p>
      {rows.map((row) => {
        const pct = Math.min(100, (row.used / row.max) * 100);
        return (
          <div key={row.label}>
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span>{row.label}</span>
              <span className="font-mono text-muted-foreground">{row.fmt(row.used)} / {row.fmt(row.max)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div className={cn("h-full rounded-full", pct > 80 ? "bg-planning" : "bg-primary")} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} />
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">
        <CircleStop className="size-3.5" />停止任务会取消所有子代理，结果未知的请求仍计入额度。
      </div>
    </div>
  );
}
