import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { MotionConfig, motion } from "motion/react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { BookOpen, Check, ChevronDown, FolderGit2, Laptop, Loader2, Moon, PanelLeft, PanelRight, Plus, RefreshCw, Search, Settings2, Sun, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNativeSession, isTaskActive, type NativeSession } from "../../../webui/src/useNativeSession";
import { runLabels } from "../../../webui/src/MinimalPanels";
import { errorText } from "../../../webui/src/api";
import type { Session } from "../../../packages/host/contracts";
import { ModelFields, NativeComposer, NativeMessage } from "./Conversation";
import { AccountSettings } from "./AccountSettings";
import { Workspace, type FileRequest, type WorkTab } from "./Workspace";
import "./layout.css";
import { fieldClass, NativeDialog, NativeTheme, Notice, Tip } from "./ui";

export default function NativeApp() {
  const c = useNativeSession();
  const [nav, setNav] = useState(() => window.innerWidth >= 1280), [workspace, setWorkspace] = useState(() => window.innerWidth >= 900);
  const [tab, setTab] = useState<WorkTab>("files"), [palette, setPalette] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [fileRequest, setFileRequest] = useState<FileRequest | null>(null);
  const openFile = useCallback((path: string) => { setFileRequest({ projectId: c.projectId, path, nonce: crypto.randomUUID() }); setTab("files"); setWorkspace(true); }, [c.projectId]);
  const [search, setSearch] = useState(""), [readSize, setReadSize] = useState(16.5);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const night = c.appearance.theme === "dark" || c.appearance.theme === "system" && systemDark, theme = `proto-b${night ? " night" : ""}`;
  const actions = useRef({ newSession: () => c.navigate(c.projectId), settings: () => c.setSettingsOpen(true) });
  actions.current = { newSession: () => c.navigate(c.projectId), settings: () => c.setSettingsOpen(true) };
  useEffect(() => { setConfirmed(false); }, [c.composerVersion]);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media?.matches ?? false);
    media?.addEventListener("change", update); return () => media?.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
      const k = event.key.toLowerCase();
      if (!["k", "j", "b", "n", ","].includes(k)) return;
      event.preventDefault();
      if (k === "k") setPalette(value => !value);
      if (k === "j") setWorkspace(value => !value);
      if (k === "b") setNav(value => !value);
      if (k === "n") actions.current.newSession();
      if (k === ",") actions.current.settings();
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  function openSession(session: Session) { c.openSession(session); setPalette(false); }
  const busy = isTaskActive(c.visibleTask?.status), status = c.currentSummary?.status;
  const access = busy && c.visibleTask?.access === "coding" ? "编程授权生效" : "只读检查";
  const label = c.visibleTask?.approvals?.length ? "等待批准" : status ? runLabels[status] : "只读检查";
  const sidebar = <Sidebar session={c} open={nav} onToggle={() => setNav(value => !value)} onPalette={() => setPalette(true)} />;
  const supported = !c.snapshot || c.snapshot.capabilities?.minimal === true;

  return <NativeTheme.Provider value={theme}><MotionConfig reducedMotion={c.appearance.reduceMotion ? "always" : "user"}>
    <div className={`${theme} b2-native flex h-full flex-col bg-canvas font-sans text-foreground`} style={{ "--read-size": `${readSize}px` } as CSSProperties}>
      <div className="flex min-h-0 flex-1">
        {sidebar}
        <Group orientation="horizontal" className={`native-panels ${workspace ? "workspace-open" : ""} min-w-0 flex-1 py-2 pr-2 max-md:pl-2`}>
          <Panel defaultSize={workspace ? "54" : "100"} minSize="32" className="min-w-0">
            <main className="flex h-full flex-col overflow-hidden rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]" aria-label="B2 原生会话">
              <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/70 px-4">
                <Button size="icon" variant="ghost" className="size-8 md:hidden" aria-label="打开项目与会话" onClick={() => c.setNavigationOpen(true)}><PanelLeft className="size-4" /></Button>
                <h1 className="min-w-0 truncate text-[14px] font-medium" title={c.title}>{c.title}</h1>
                <span role="status" className="flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-[12px] text-muted-foreground"><span className={`size-1.5 rounded-full ${c.visibleTask?.approvals?.length ? "bg-planning" : busy ? "bg-primary" : status === "failed" || status === "interrupted" ? "bg-destructive" : "bg-inspect"}`} />{label}</span>
                <Tip label={workspace ? "收起工作区" : "打开工作区"} kbd="⌘J"><Button size="icon" variant="ghost" className="ml-auto size-8" aria-label={workspace ? "收起工作区" : "打开工作区"} aria-pressed={workspace} onClick={() => setWorkspace(value => !value)}><PanelRight className="size-4" /></Button></Tip>
              </header>
              <div className="space-y-2 px-5 pt-2">
                {c.host.error && <Notice error><div className="flex items-start justify-between gap-2"><span>{c.host.error}</span><button aria-label="关闭错误提示" onClick={() => c.setError("")}><X className="size-4" /></button></div></Notice>}
                {!supported && <Notice error>当前 Host 不支持原生基础会话，请从 B2 开发入口启动并重新配对。</Notice>}
                {!!c.snapshot?.diagnostics.length && <Notice>部分历史无法读取，原文件已保留。请检查会话文件。</Notice>}
                {c.project && !c.project.available && <Notice>项目目录不可访问，仍可查看历史。</Notice>}
                {c.pending && <Notice><p>{c.submissionNotice || "正在核对上次提交…"}</p><p className="mt-1 truncate">项目：{c.snapshot?.projects.find(p => p.projectId === c.pending!.projectId)?.name ?? c.pending.projectId}，模型：{c.pending.model}</p><pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">{c.pending.prompt}</pre><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={!c.connected || c.reconciling} onClick={() => void c.lookup()}>核对提交结果</Button><Button size="sm" variant="outline" disabled={!c.connected || c.reconciling || !!c.sending.current} onClick={() => void c.dispatch(c.pending!).catch(() => {})}>重试同一请求</Button></div></Notice>}
              </div>
              <section ref={c.scroller} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" aria-label="对话" onScroll={() => { const node = c.scroller.current; if (node) c.setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 80); }}>
                <div className="mx-auto max-w-[660px] space-y-6 px-7 py-7">
                  {c.taskLoading || !!c.selectedKey && !c.historyReady ? <p role="status" className="text-[13px] text-muted-foreground">正在读取会话…</p> : !c.selectedKey && !c.visibleTask ? <Home session={c} /> : <>
                    {c.messages.map(message => <NativeMessage key={`${c.selectedKey || c.taskId}:${message.id}`} message={message} sessionKey={c.selectedKey || undefined} onOpenFile={openFile} />)}
                    {c.visibleTask?.partial && <article className="native-prose font-read text-[length:var(--read-size,16.5px)] leading-[1.75] text-foreground/90" aria-label="正在回复"><NativeMessage message={{ id: "partial", role: "assistant", text: c.visibleTask.partial }} /></article>}
                    {c.visibleTask?.toolCalls?.filter(call => call.status === "running").map(call => <details open key={call.toolCallId} className="rounded-xl border border-line bg-muted/50 p-3 text-[13px]"><summary className="flex cursor-pointer items-center gap-2"><Loader2 className="size-3.5 animate-spin text-primary" />{call.name}<span className="ml-auto text-[12px] text-muted-foreground">运行中</span></summary>{call.output && <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[12px]">{call.output}</pre>}</details>)}
                    {busy && !c.visibleTask?.partial && <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{c.visibleTask?.approvals?.length ? "等待你的决定" : c.visibleTask?.status === "cancelling" ? "正在停止，等待执行进程退出…" : "Pi 正在处理…"}</p>}
                    {c.currentSummary?.error && <Notice error>{errorText(new Error(c.currentSummary.error))}</Notice>}
                    {c.selectedKey && <div className="flex items-center justify-center gap-3 text-[12px] text-muted-foreground"><Button variant="ghost" size="sm" disabled={!c.historyReady || !c.history.offset} onClick={() => c.history.setOffset(Math.max(0, c.history.offset - 50))}>上一页</Button><span>第 {Math.floor(c.history.offset / 50) + 1} 页</span><Button variant="ghost" size="sm" disabled={!c.historyReady || c.history.page.nextOffset === null} onClick={() => c.history.setOffset(c.history.page.nextOffset!)}>下一页</Button></div>}
                  </>}
                </div>
              </section>
              {!c.follow && <button className="mx-auto rounded-full border border-line bg-card px-3 py-1 text-[12px] text-primary" onClick={() => c.setFollow(true)}>回到最新</button>}
              {supported && <NativeComposer key={`${c.projectId}:${c.composerVersion}`} session={c} confirmed={confirmed} onChoose={setConfirmed} />}
            </main>
          </Panel>
          {workspace && <><Separator className="group mx-0.5 flex w-1.5 items-center justify-center max-md:hidden" aria-label="调整工作区宽度"><span className="h-10 w-1 rounded-full bg-line transition-colors group-hover:bg-primary/50 group-data-[separator=active]:bg-primary" /></Separator><Panel defaultSize="46" minSize="30" className="min-w-0"><Workspace session={c} tab={tab} onTab={setTab} onClose={() => setWorkspace(false)} fileRequest={fileRequest} onOpenFile={openFile} /></Panel></>}
        </Group>
      </div>
      <footer className="flex h-7 shrink-0 items-center gap-4 overflow-hidden px-4 text-[11.5px] whitespace-nowrap text-muted-foreground" aria-label="状态栏">
        <button className="flex min-w-0 items-center gap-1.5" onClick={() => c.setDetailsOpen(true)} title="会话详情"><FolderGit2 className="size-3 shrink-0" /><span className="max-w-40 truncate">{c.project?.name ?? "选择项目"}</span></button>
        <span className="flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${access === "编程授权生效" ? "bg-coding" : "bg-inspect"}`} />{access}</span>
        <span className="ml-auto hidden sm:inline">本轮 Token {c.currentSummary?.usage?.tokens?.totalTokens.toLocaleString() ?? "未报告"}</span>
        <span className="hidden xl:inline">估算费用 {c.currentSummary?.usage?.estimatedCost == null ? "未报告" : `$${c.currentSummary.usage.estimatedCost.toFixed(4)}`}</span>
        <span className="flex items-center gap-1.5" role="status"><Laptop className="size-3" />{c.connection}<span className={`size-1.5 rounded-full ${c.connected ? "bg-coding" : "bg-planning"}`} /></span>
        <Tip label={night ? "切换到日间" : "切换到夜间"}><button aria-label={night ? "切换到日间" : "切换到夜间"} onClick={() => c.setAppearance({ ...c.appearance, theme: night ? "light" : "dark" })}>{night ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}</button></Tip>
      </footer>
      <NativeDialog open={c.addOpen} onOpenChange={c.setAddOpen} title="添加本机目录" description="选择已有目录。添加项目不会修改目录内容。"><form onSubmit={c.addProject} className="space-y-3"><label className="block space-y-2 text-[13px]"><span>项目目录的绝对路径</span><input className={fieldClass} aria-label="项目目录的绝对路径" value={c.projectPath} onChange={e => c.setProjectPath(e.target.value)} required autoComplete="off" /></label>{c.addError && <Notice error>{c.addError}</Notice>}<Button className="rounded-full" disabled={c.adding || !c.projectPath.trim()}>{c.adding ? "正在添加…" : "添加项目"}</Button></form></NativeDialog>
      <NativeDialog open={c.navigationOpen} onOpenChange={c.setNavigationOpen} title="项目与会话" description="选择项目，再打开会话历史。"><Sidebar session={c} open mobile onToggle={() => c.setNavigationOpen(false)} onPalette={() => { c.setNavigationOpen(false); setPalette(true); }} /></NativeDialog>
      <NativeDialog open={palette} onOpenChange={setPalette} title="搜索与命令" description="搜索当前项目已载入的会话。"><input className={fieldClass} aria-label="搜索会话" value={search} onChange={e => setSearch(e.target.value)} /><div className="space-y-1"><Button variant="ghost" className="w-full justify-start" onClick={() => { c.navigate(c.projectId); setPalette(false); }}>新建会话</Button>{c.history.sessions.filter(s => c.sessionTitle(s).toLowerCase().includes(search.toLowerCase())).map(s => <button key={s.sessionKey} className="block w-full rounded-xl px-3 py-2 text-left text-[13px] hover:bg-secondary" onClick={() => openSession(s)}>{c.sessionTitle(s)}</button>)}</div></NativeDialog>
      <NativeDialog open={c.settingsOpen} onOpenChange={c.setSettingsOpen} title="设置" description="当前 Host 提供的账号与模型，以及本机界面偏好。"><ModelFields session={c} disabled={busy} onChoose={setConfirmed} /><p className="text-[12px] text-muted-foreground">CLI 默认账号由 Pi 管理，这里只读引用。新会话需要明确选择模型。</p>{c.snapshot?.capabilities?.accounts?.apiKey && <AccountSettings connected={c.connected} tasks={c.snapshot.tasks} onChanged={c.account.refreshAccounts} />}<label className="block space-y-1 text-[13px]"><span>外观</span><select aria-label="外观" className={fieldClass} value={c.appearance.theme} onChange={e => c.setAppearance({ ...c.appearance, theme: e.target.value as typeof c.appearance.theme })}><option value="system">跟随系统</option><option value="light">日间</option><option value="dark">夜间</option></select></label><label className="block space-y-1 text-[13px]"><span>阅读字号</span><select aria-label="阅读字号" className={fieldClass} value={readSize} onChange={e => setReadSize(Number(e.target.value))}><option value={15}>小</option><option value={16.5}>标准</option><option value={18}>大</option></select></label><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={c.appearance.reduceMotion} onChange={e => c.setAppearance({ ...c.appearance, reduceMotion: e.target.checked })} />减少动效</label></NativeDialog>
      <NativeDialog open={c.detailsOpen} onOpenChange={c.setDetailsOpen} title="会话详情" description="来自当前 Host 的项目、会话与本轮运行信息。"><dl className="space-y-3 text-[13px]">{Object.entries({ 项目: c.project?.path, 会话: c.selectedSession?.sessionId ?? c.visibleTask?.sessionId, 任务: c.currentSummary?.taskId, 模型: c.currentSummary?.model, 状态: c.currentSummary ? runLabels[c.currentSummary.status] : "尚未运行", 运行栈: c.snapshot?.runtime.stackId }).map(([key, value]) => <div key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-all font-mono text-[12px]">{value ?? "未报告"}</dd></div>)}</dl></NativeDialog>
    </div>
  </MotionConfig></NativeTheme.Provider>;
}

function Sidebar({ session: c, open, mobile = false, onToggle, onPalette }: { session: NativeSession; open: boolean; mobile?: boolean; onToggle: () => void; onPalette: () => void }) {
  const theme = useContext(NativeTheme);
  const tasks = c.projectTasks.filter(t => !t.sessionId || !c.history.sessions.some(s => s.sessionId === t.sessionId));
  function selectedSession(session: Session) { return c.selectedKey === session.sessionKey || c.visibleTask?.sessionId === session.sessionId; }
  return <motion.nav initial={false} animate={{ width: open ? (mobile ? "100%" : 256) : 56 }} transition={{ type: "spring", bounce: 0, duration: 0.35 }} className={`${mobile ? "flex" : "hidden md:flex"} shrink-0 flex-col overflow-hidden`} aria-label={mobile ? "选择项目与会话" : "项目与会话"}>
    <div className="flex items-center gap-2 px-3 pt-4 pb-3"><Tip label={open ? "收起侧栏" : "展开侧栏"} kbd="⌘B"><Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={open ? "收起侧栏" : "展开侧栏"} onClick={onToggle}><PanelLeft className="size-4" /></Button></Tip>{open && <span className="font-read text-[17px] whitespace-nowrap italic">Only My Pi</span>}</div>
    <div className="px-3"><DropdownMenu><DropdownMenuTrigger asChild><button aria-label="选择项目" className={`flex w-full items-center gap-2.5 rounded-xl bg-card py-2 text-left shadow-[0_0_0_1px_var(--line)] ${open ? "px-3" : "justify-center"}`}><FolderGit2 className="size-4 shrink-0 text-primary" />{open && <><span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] font-medium">{c.project?.name ?? "选择项目"}</span><span className="block truncate font-mono text-[11px] text-muted-foreground" title={c.project?.path}>{c.project?.path ?? "添加本机目录"}</span></span><ChevronDown className="size-3.5 text-muted-foreground" /></>}</button></DropdownMenuTrigger><DropdownMenuContent align="start" className={`${theme} w-72`}><DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换项目</DropdownMenuLabel>{c.snapshot?.projects.map(project => <DropdownMenuItem key={project.projectId} onSelect={() => c.navigate(project.projectId)} className="items-start"><FolderGit2 className="mt-0.5 size-4" /><span className="min-w-0 flex-1"><span className="block">{project.name}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{project.path}</span></span>{project.projectId === c.projectId && <Check className="size-3.5" />}</DropdownMenuItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { c.setNavigationOpen(false); c.setAddOpen(true); }}><Plus className="size-4" />添加本机目录</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <div className={`mt-2 ${!open ? "flex flex-col items-center" : "space-y-0.5"}`}><Button variant="ghost" className={`h-8 ${open ? "w-full justify-start" : "w-8 px-0"}`} disabled={!c.project} aria-label="新建会话" onClick={() => c.navigate(c.projectId)}><Plus className="size-4" />{open && <><span>新会话</span><kbd className="ml-auto text-[11px] text-muted-foreground">⌘N</kbd></>}</Button><Button variant="ghost" className={`h-8 ${open ? "w-full justify-start" : "w-8 px-0"}`} aria-label="搜索与命令" onClick={onPalette}><Search className="size-4" />{open && <><span>搜索与命令</span><kbd className="ml-auto text-[11px] text-muted-foreground">⌘K</kbd></>}</Button></div>
    </div>
    {open && <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3 scrollbar-thin"><div className="mb-2 flex items-center justify-between px-2 text-[12px] text-muted-foreground"><span>会话历史</span><button aria-label="刷新会话列表" disabled={!c.connected || !c.project} onClick={c.history.refresh}><RefreshCw className="size-3.5" /></button></div><nav aria-label="会话列表" className="space-y-0.5">
      {tasks.map(task => <button key={task.taskId} onClick={() => c.navigate(c.projectId, task.taskId)} aria-current={c.taskId === task.taskId ? "page" : undefined} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] ${c.taskId === task.taskId ? "bg-secondary" : "hover:bg-secondary/60"}`}><span className="min-w-0 flex-1 truncate">{task.prompt || "新会话"}</span><span className="text-[11px] text-muted-foreground">{runLabels[task.status]}</span></button>)}
      {c.history.sessions.map(session => { const running = c.projectTasks.find(t => t.sessionId === session.sessionId && isTaskActive(t.status)); return <button key={session.sessionKey} onClick={() => c.openSession(session)} aria-current={selectedSession(session) ? "page" : undefined} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] ${selectedSession(session) ? "bg-secondary" : "hover:bg-secondary/60"}`} title={c.sessionTitle(session)}><span className="min-w-0 flex-1 truncate">{c.sessionTitle(session)}</span><span className="shrink-0 text-[11px] text-muted-foreground">{running ? runLabels[running.status] : "查看历史"}</span></button>; })}
      {!tasks.length && !c.history.sessions.length && <p className="px-2 py-3 text-[12.5px] text-muted-foreground">新建一个会话，从这里开始。</p>}
    </nav></div>}
    <div className="mt-auto px-3 pb-3 pt-3"><Button variant="ghost" className={open ? "h-8 w-full justify-start" : "size-8 px-0"} aria-label="设置" onClick={() => { c.setNavigationOpen(false); c.setSettingsOpen(true); }}><Settings2 className="size-4" />{open && <><span>设置</span><kbd className="ml-auto text-[11px] text-muted-foreground">⌘,</kbd></>}</Button></div>
  </motion.nav>;
}

function Home({ session: c }: { session: NativeSession }) {
  return <div className="pt-[6vh] pb-5"><p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground"><FolderGit2 className="size-3.5 text-primary" />{c.project?.name ?? "本机编程工作区"}</p><h2 className="mt-3 font-read text-[34px] leading-tight font-semibold tracking-tight">{c.project ? `在 ${c.project.name} 里做什么？` : "从一个项目开始。"}</h2><p className="mt-3 font-read text-[15.5px] leading-relaxed text-muted-foreground">选择项目、账号和模型，再开始一次原生 Pi 会话。修改项目需要你的明确审批。</p>{!c.project && <Button className="mt-5 rounded-full" onClick={() => c.setAddOpen(true)}><Plus className="size-4" />添加本机目录</Button>}<div className="mt-6 space-y-2">{[
    ["介绍这个项目", "梳理目录结构、核心模块和主要入口", "请只读介绍这个项目的目录结构、核心模块和主要入口。"],
    ["找出潜在问题", "只读检查，给出依据与验证建议", "请只读检查这个项目中的潜在问题，说明依据和验证建议，暂不修改文件。"],
    ["规划改动", "先把想法变成可讨论的实施步骤", "请先只读分析并给出实施计划，暂不修改文件。"],
  ].map(([title, body, prompt]) => <button key={title} disabled={!c.project} className="flex w-full items-start gap-3 rounded-xl border border-line px-4 py-3 text-left hover:bg-card disabled:opacity-50" onClick={() => c.suggest(prompt)}><BookOpen className="mt-0.5 size-4 shrink-0 text-primary" /><span><span className="block text-[13.5px] font-medium">{title}</span><span className="block text-[12.5px] text-muted-foreground">{body}</span></span></button>)}</div></div>;
}
