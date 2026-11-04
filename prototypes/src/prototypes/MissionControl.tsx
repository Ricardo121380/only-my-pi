import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis } from "recharts";
import {
  ArrowUp, Bot, Check, ChevronDown, FolderGit2, GripVertical, LayoutGrid, Lock, MessagesSquare, Plus, Settings, ShieldCheck,
  Square, Unlock, Wallet, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NumberTicker, ShinyText } from "@/components/magic";
import { ModelMenu, StatusGlyph, fmtK } from "@/components/shared";
import { accessCopy, budget, codingRequest, queueColumns, tokenSeries, tools1, verifyChecks, toolLabel } from "@/data/mock";
import { useProto } from "@/store";
import { cn } from "@/lib/utils";

type Task = ReturnType<typeof useProto.getState>["queue"][number];

export default function MissionControl() {
  const [selected, setSelected] = useState<string | null>("q1");
  return (
    <div className="proto-d flex h-full bg-canvas text-foreground">
      <Rail />
      <main className="min-w-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-[1180px] space-y-5 px-6 py-6">
          <Header />
          <BudgetRow />
          <Board selected={selected} onSelect={setSelected} />
        </div>
      </main>
      <AnimatePresence>{selected && <Detail taskId={selected} onClose={() => setSelected(null)} />}</AnimatePresence>
    </div>
  );
}

function Rail() {
  const items = [
    { icon: LayoutGrid, label: "看板", active: true },
    { icon: MessagesSquare, label: "会话" },
    { icon: Wallet, label: "预算与用量" },
    { icon: FolderGit2, label: "项目" },
  ];
  return (
    <nav className="hidden w-[68px] shrink-0 flex-col items-center gap-1.5 py-4 sm:flex" aria-label="主导航">
      <span className="mb-3 grid size-10 place-items-center rounded-2xl bg-foreground font-mono text-[18px] text-background">π</span>
      {items.map((it) => (
        <Tooltip key={it.label}>
          <TooltipTrigger asChild>
            <button aria-label={it.label} className={cn("grid size-10 place-items-center rounded-xl", it.active ? "bg-background shadow-[0_0_0_1px_var(--line)]" : "text-muted-foreground hover:bg-background/70")}>
              <it.icon className="size-[18px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{it.label}</TooltipContent>
        </Tooltip>
      ))}
      <button aria-label="设置" className="mt-auto grid size-10 place-items-center rounded-xl text-muted-foreground hover:bg-background/70"><Settings className="size-[18px]" /></button>
    </nav>
  );
}

function Header() {
  return (
    <header className="flex flex-wrap items-end gap-4">
      <div>
        <button className="flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <FolderGit2 className="size-3.5" />only-my-pi<ChevronDown className="size-3.5" />
        </button>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-[-0.02em]">一项待你批准，两项正在进行</h1>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <ModelMenu
          align="end"
          trigger={
            <button className="flex h-10 items-center gap-2 rounded-full border border-line bg-background px-4 text-[13px]">
              <span className="size-2 rounded-full bg-[var(--ocean)]" />DeepSeek 个人<ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          }
        />
        <Button className="h-10 rounded-full px-5"><Plus className="size-4" />新任务</Button>
      </div>
    </header>
  );
}

/* ───────────── Budget: the signature gauge ───────────── */

function BudgetRow() {
  const pct = budget.costUsd.used / budget.costUsd.max;
  const gauge = [{ v: pct }, { v: 1 - pct }];
  const limits = [
    { label: "子代理", used: budget.children.used, max: budget.children.max, fmt: (n: number) => `${n}` },
    { label: "Token", used: budget.tokens.used, max: budget.tokens.max, fmt: fmtK },
    { label: "工具调用", used: budget.toolCalls.used, max: budget.toolCalls.max, fmt: (n: number) => `${n}` },
    { label: "运行时长", used: Math.round(budget.wallSeconds.used / 60), max: budget.wallSeconds.max / 60, fmt: (n: number) => `${n} 分` },
  ];
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]" aria-label="本任务预算">
      <div className="rounded-3xl bg-background p-5 shadow-[0_0_0_1px_var(--line)]">
        <p className="flex justify-between text-[13px] text-muted-foreground"><span>会话归档，子代理费用</span><span>用尽不自动扩额</span></p>
        <div className="relative mx-auto mt-3 h-[124px] w-[248px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={gauge} dataKey="v" startAngle={180} endAngle={0} cy="100%" innerRadius={98} outerRadius={122} stroke="none" cornerRadius={8} paddingAngle={1.5} isAnimationActive>
                <Cell fill="var(--ocean)" />
                <Cell fill="var(--secondary)" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-x-0 bottom-0 text-center">
            <p className="text-[32px] leading-none font-semibold tracking-tight"><NumberTicker value={budget.costUsd.used} decimals={3} prefix="$" /></p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">上限 ${budget.costUsd.max.toFixed(2)}</p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
          {limits.map((l) => (
            <div key={l.label}>
              <dt className="flex justify-between text-[12px] text-muted-foreground"><span>{l.label}</span><span className="tabular-nums">{l.fmt(l.used)}/{l.fmt(l.max)}</span></dt>
              <dd className="mt-1 h-1 overflow-hidden rounded-full bg-secondary">
                <motion.div className="h-full rounded-full bg-foreground" initial={{ width: 0 }} animate={{ width: `${(l.used / l.max) * 100}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col rounded-3xl bg-background p-5 shadow-[0_0_0_1px_var(--line)]">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p className="text-[13px] text-muted-foreground">Token 消耗，按参与者累计</p>
          {[
            { k: "主 Agent", c: "var(--foreground)" },
            { k: "侦察者", c: "#9aa6c2" },
            { k: "写入者", c: "var(--ocean)" },
          ].map((s) => (
            <span key={s.k} className="flex items-center gap-1.5 text-[12px]"><span className="size-2 rounded-full" style={{ background: s.c }} />{s.k}</span>
          ))}
          <p className="ml-auto text-[22px] font-semibold tracking-tight"><NumberTicker value={budget.tokens.used} /><span className="ml-1 text-[13px] font-normal text-muted-foreground">/ 50,000</span></p>
        </div>
        <div className="mt-3 min-h-[180px] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={tokenSeries} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="d-writer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--ocean)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--ocean)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <ChartTooltip
                cursor={{ stroke: "var(--line)" }}
                contentStyle={{ borderRadius: 12, border: "1px solid var(--line)", fontSize: 12, boxShadow: "0 8px 24px -12px rgba(0,0,0,.2)" }}
                formatter={(v, name) => [Number(v).toLocaleString("zh-CN"), { main: "主 Agent", scouts: "侦察者", writer: "写入者" }[String(name)] ?? name]}
              />
              <Area type="monotone" dataKey="main" stackId="1" stroke="var(--foreground)" strokeWidth={1.5} fill="var(--foreground)" fillOpacity={0.06} />
              <Area type="monotone" dataKey="scouts" stackId="1" stroke="#9aa6c2" strokeWidth={1.5} fill="#9aa6c2" fillOpacity={0.15} />
              <Area type="monotone" dataKey="writer" stackId="1" stroke="var(--ocean)" strokeWidth={2} fill="url(#d-writer)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Kanban board (dnd-kit) ───────────── */

function Board({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { queue, moveTask } = useProto();
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const onStart = (e: DragStartEvent) => setDragging(queue.find((t) => t.id === e.active.id) ?? null);
  const onEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (over) moveTask(String(active.id), String(over.id));
  };
  return (
    <section aria-label="任务看板">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[17px] font-semibold tracking-tight">任务</h2>
        <p className="text-[12.5px] text-muted-foreground">拖动卡片调整顺序；移入“已完成”只改变看板，不会改动结果</p>
      </div>
      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {queueColumns.map((col) => (
            <Column key={col.id} id={col.id} title={col.title} tasks={queue.filter((t) => t.column === col.id)} selected={selected} onSelect={onSelect} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 180 }}>{dragging && <Card task={dragging} overlay />}</DragOverlay>
      </DndContext>
    </section>
  );
}

function Column({ id, title, tasks, selected, onSelect }: { id: string; title: string; tasks: Task[]; selected: string | null; onSelect: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const approval = id === "approval";
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-[220px] rounded-3xl p-2.5 transition-colors",
        approval ? "bg-[color-mix(in_oklab,var(--ocean)_7%,var(--background))] shadow-[0_0_0_1px_color-mix(in_oklab,var(--ocean)_25%,transparent)]" : "bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)]",
        isOver && "shadow-[0_0_0_2px_var(--ocean)]",
      )}
    >
      <p className="flex items-center gap-2 px-2 pt-1 pb-2.5 text-[13px] font-medium">
        {title}<span className="rounded-full bg-background px-2 text-[11.5px] text-muted-foreground tabular-nums shadow-[0_0_0_1px_var(--line)]">{tasks.length}</span>
      </p>
      <div className="space-y-2">
        {tasks.map((t) => <DraggableCard key={t.id} task={t} selected={selected === t.id} onSelect={() => onSelect(t.id)} />)}
      </div>
    </div>
  );
}

function DraggableCard({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} aria-label={`${task.title}，可拖动`} className={cn("cursor-grab touch-none select-none rounded-2xl active:cursor-grabbing", isDragging && "opacity-30")}>
      <Card task={task} selected={selected} onSelect={onSelect} handle />
    </div>
  );
}

function Card({ task, selected, onSelect, handle, overlay }: { task: Task; selected?: boolean; onSelect?: () => void; handle?: boolean; overlay?: boolean }) {
  const { running } = useProto();
  const live = task.column === "running" && running;
  return (
    <article
      className={cn(
        "group relative rounded-2xl bg-background p-3.5 shadow-[0_0_0_1px_var(--line)] transition-shadow",
        selected && "shadow-[0_0_0_2px_var(--foreground)]",
        overlay && "rotate-[1.5deg] shadow-[0_18px_40px_-16px_rgba(14,17,22,0.35),0_0_0_1px_var(--line)]",
      )}
    >
      <button onClick={onSelect} tabIndex={handle ? -1 : 0} className="block w-full cursor-[inherit] text-left">
        <p className="pr-5 text-[14px] leading-snug font-medium">{task.title}</p>
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Bot className="size-3.5 shrink-0" /><span className="whitespace-nowrap">{task.agent}</span>
          <span className="ml-auto truncate font-mono text-[11px]">{task.model}</span>
        </p>
        {task.column === "approval" && (
          <p className="mt-2.5 flex items-center gap-1.5 rounded-xl bg-[color-mix(in_oklab,var(--ocean)_10%,transparent)] px-2.5 py-1.5 text-[12px] text-[var(--accent-foreground)]">
            <Lock className="size-3.5" />申请编程授权，5 个文件
          </p>
        )}
        {live && (
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-secondary">
            <motion.div className="h-full w-1/3 rounded-full bg-[var(--ocean)]" animate={{ x: ["-100%", "300%"] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
          </div>
        )}
      </button>
      {handle && (
        <GripVertical aria-hidden className="absolute top-3 right-2.5 size-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
      )}
    </article>
  );
}

/* ───────────── Detail drawer: conversation + approval ───────────── */

function Detail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const { queue, access, approve, revise, deny, revoke, reopen, running, stop } = useProto();
  const task = queue.find((t) => t.id === taskId);
  const [text, setText] = useState("");
  if (!task) return null;
  const isMain = task.id === "q1";
  return (
    <motion.aside
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", bounce: 0, duration: 0.35 }}
      className="m-2 ml-0 hidden w-[384px] shrink-0 flex-col overflow-hidden rounded-3xl bg-background shadow-[0_0_0_1px_var(--line)] lg:flex"
      aria-label="任务详情"
    >
      <header className="flex items-start gap-2 px-5 pt-5">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{task.project}，{task.agent}</p>
          <h2 className="mt-0.5 text-[17px] leading-snug font-semibold tracking-tight">{task.title}</h2>
        </div>
        <Button size="icon" variant="ghost" className="ml-auto size-8 shrink-0 rounded-full" onClick={onClose} aria-label="关闭详情"><X className="size-4" /></Button>
      </header>
      <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4 scrollbar-thin">
        <div className="ml-6 rounded-2xl rounded-tr-md bg-secondary px-3.5 py-2.5 text-[13.5px] leading-relaxed">
          会话越来越多了。给侧栏加一个归档功能，归档后折叠到底部，随时可以恢复。
        </div>
        <div className="space-y-1.5 text-[12.5px]">
          {tools1.slice(0, 4).map((c) => (
            <p key={c.id} className="flex items-center gap-2 text-muted-foreground">
              <StatusGlyph status={c.status} /><span className="w-10 whitespace-nowrap">{toolLabel[c.tool]}</span><span className="min-w-0 truncate font-mono text-[11.5px] text-foreground/80">{c.target}</span>
            </p>
          ))}
        </div>
        {isMain ? (
          <motion.section layout className="rounded-3xl p-4 shadow-[0_0_0_1px_var(--line)]">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              {access === "coding" ? <Unlock className="size-4 text-coding" /> : <ShieldCheck className="size-4 text-[var(--ocean)]" />}
              {access === "awaiting" ? "批准编程授权" : accessCopy[access].label}
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{codingRequest.taskSummary}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {codingRequest.scope.map((p) => (
                <span key={p} className="rounded-full bg-secondary px-2.5 py-0.5 font-mono text-[11px]">{p.split("/").pop()}</span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {access === "awaiting" ? (
                <>
                  <Button className="h-9 rounded-full px-5" onClick={approve}><Check className="size-4" />批准编程</Button>
                  <Button variant="outline" className="h-9 rounded-full" onClick={revise}>修改计划</Button>
                  <Button variant="ghost" className="h-9 rounded-full text-muted-foreground" onClick={deny}>保持只读</Button>
                </>
              ) : access === "coding" ? (
                <Button variant="outline" className="h-9 rounded-full" onClick={revoke}>撤销授权</Button>
              ) : (
                <Button variant="outline" className="h-9 rounded-full" onClick={reopen}>重新申请</Button>
              )}
            </div>
          </motion.section>
        ) : (
          <p className="rounded-2xl bg-secondary px-4 py-3 text-[13px] text-muted-foreground">
            {task.column === "running" ? <ShinyText>正在执行，工具输出实时更新</ShinyText> : task.column === "done" ? "已完成，结果已写入会话历史。" : "排队中，前一个任务停止后开始。"}
          </p>
        )}
        {access === "coding" && isMain && (
          <ol className="space-y-2 rounded-3xl p-4 shadow-[0_0_0_1px_var(--line)]">
            <p className="pb-1 text-[13px] font-semibold">验证进度</p>
            {verifyChecks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-[12.5px]">
                <StatusGlyph status={c.status} className="mt-0.5" />
                <span><span className="font-medium">{c.label}</span><br /><span className="text-muted-foreground">{c.detail}</span></span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl bg-secondary p-2 pl-3.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            placeholder="补充说明，下一步生效"
            aria-label="补充说明"
            className="min-h-9 flex-1 resize-none bg-transparent py-2 text-[13.5px] outline-none placeholder:text-muted-foreground"
          />
          {running ? (
            <Button size="icon" variant="outline" className="size-9 rounded-full bg-background" onClick={stop} aria-label="停止"><Square className="size-3 fill-current" /></Button>
          ) : (
            <Button size="icon" className="size-9 rounded-full" disabled={!text.trim()} aria-label="发送"><ArrowUp className="size-4" /></Button>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
