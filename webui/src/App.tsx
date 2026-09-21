import { useEffect, useRef, useState } from "react";
import type { AccountDirectory, HostTask, Message, ModelChoice, Project, Session, TaskStatus } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";
import { useHost } from "./useHost";
import { Inspector } from "./Inspector";
import { MessageView, SafeMarkdown } from "./Messages";
import { Composer } from "./Composer";
import { BrandLogo, Icon } from "./Icon";
import { Appearance } from "./Appearance";
import { OutputDock } from "./OutputDock";
import { ProjectHome } from "./ProjectHome";
import { HostDialog } from "./HostDialog";
import { TaskControl } from "./TaskControl";

const labels: Record<TaskStatus, string> = { starting: "正在启动", running: "运行中", cancelling: "正在取消", succeeded: "已完成", failed: "任务失败", cancelled: "已取消", interrupted: "运行已中断" };
const active = (status?: TaskStatus) => status === "starting" || status === "running" || status === "cancelling";
interface HistoryPage { messages: Message[]; nextOffset: number | null }
export function App() {
  const [projectId, setProjectId] = useState(""), [session, setSession] = useState<Session | null>(null), [taskId, setTaskId] = useState<string | null>(() => sessionStorage.getItem("omp.selectedTask"));
  const { snapshot, task, connection, error, setError, setTask } = useHost(taskId);
  const [selectedModel, setSelectedModel] = useState("");
  const [resumeSessionKey, setResumeSessionKey] = useState<string | undefined>();
  const [accounts, setAccounts] = useState<AccountDirectory | null>(null), [accountId, setAccountId] = useState("");
  const [accountRevision, setAccountRevision] = useState(0);
  const [addError, setAddError] = useState(""), [exploreOpen, setExploreOpen] = useState(false);
  const [models, setModels] = useState<ModelChoice[]>([]), [sessions, setSessions] = useState<Session[]>([]), [historyPage, setHistoryPage] = useState<HistoryPage>({ messages: [], nextOffset: null });
  const [historyBusy, setHistoryBusy] = useState(false), [pageOffset, setPageOffset] = useState(0), [projectPath, setProjectPath] = useState(""), [adding, setAdding] = useState(false), [addOpen, setAddOpen] = useState(false), [panel, setPanel] = useState("chat"), [follow, setFollow] = useState(true), [revision, setRevision] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), pending = useRef<{ model: string; prompt: string; projectId: string; accountId: string; requestId: string; resumeSessionKey?: string } | null>(null);
  const cancelPending = useRef(false);
  const [inspectOpen, setInspectOpen] = useState(() => window.innerWidth > 1100), [dockOpen, setDockOpen] = useState(false), [search, setSearch] = useState("");
  const [width, setWidth] = useState(window.innerWidth), [sidebarHidden, setSidebarHidden] = useState(false), [partitionOpen, setPartitionOpen] = useState(true), [folded, setFolded] = useState(false), [feedTab, setFeedTab] = useState("chat");
  const [suggestion, setSuggestion] = useState<{ text: string; key: number } | undefined>();
  const searchDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const resize = () => setWidth(window.innerWidth); window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (document.querySelector("dialog[open]")) return; if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchDialog.current?.showModal(); } if (e.ctrlKey && e.code === "Backquote") { e.preventDefault(); setDockOpen((open) => !open); setPanel("chat"); if (window.innerWidth <= 1100) setInspectOpen(false); } }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);
  const dockButton = useRef<HTMLButtonElement>(null);
  function closeDock() { setDockOpen(false); requestAnimationFrame(() => dockButton.current?.focus()); }
  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  const visibleTask = task?.projectId === projectId && !session ? task : null;
  const projectTasks = snapshot?.tasks.filter((item) => item.projectId === projectId) ?? [];
  const connected = connection === "已连接";
  const modelRequest = useRef(0);
  async function loadModels() {
    const version = ++modelRequest.current;
    if (!accountId) { setModels([]); return; }
    try { const result = await api<{ models: ModelChoice[] }>(query("models", { accountId })); if (version === modelRequest.current) setModels(result.models); }
    catch (cause) { if (version === modelRequest.current) { setModels([]); setError(errorText(cause)); } }
  }
  useEffect(() => {
    const controller = new AbortController();
    if (connected) void api<AccountDirectory>("/api/accounts", undefined, controller.signal).then((value) => { if (!controller.signal.aborted) { setAccounts(value); setAccountId((id) => id === value.cliReference.accountId || value.accounts.some((a) => a.accountId === id) ? id : ""); } }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [connected, accountRevision]);
  useEffect(() => { setModels([]); setSelectedModel(""); if (connected) void loadModels(); return () => { modelRequest.current++; }; }, [connected, accountId, accountRevision]);
  useEffect(() => {
    if (!snapshot || projectId) return;
    const restored = snapshot.tasks.find((item) => item.taskId === taskId);
    setProjectId(restored?.projectId ?? snapshot.projects[0]?.projectId ?? "");
  }, [snapshot, projectId, taskId]);
  useEffect(() => { if (taskId) sessionStorage.setItem("omp.selectedTask", taskId); else sessionStorage.removeItem("omp.selectedTask"); }, [taskId]);
  useEffect(() => {
    if (!projectId || !connected) return;
    const controller = new AbortController();
    void api<{ sessions: Session[] }>(query("sessions", { projectId }), undefined, controller.signal).then((data) => { if (!controller.signal.aborted) setSessions(data.sessions); }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [projectId, connected, visibleTask?.status, snapshot?.projects, revision]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController(); setHistoryBusy(true); setHistoryPage({ messages: [], nextOffset: null });
    void api<HistoryPage>(query("history", { sessionKey: session.sessionKey, offset: pageOffset }), undefined, controller.signal).then((data) => { if (!controller.signal.aborted) setHistoryPage(data); }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setHistoryBusy(false); });
    return () => controller.abort();
  }, [session, pageOffset, revision]);
  useEffect(() => { if (follow && visibleTask && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [visibleTask, follow]);
  function chooseProject(item: Project) { setResumeSessionKey(undefined); setProjectId(item.projectId); setSession(null); setTaskId(null); setSessions([]); setSuggestion(undefined); pending.current = null; setPanel("chat"); }
  function fresh() { setResumeSessionKey(undefined); setSession(null); setTaskId(null); setSuggestion({text:"",key:Date.now()}); pending.current = null; setPanel("chat"); requestAnimationFrame(() => document.getElementById("prompt")?.focus()); }
  async function send(model: string, prompt: string) {
    if (!project) throw new Error("PROJECT_REQUIRED");
    if (!accountId) throw new Error("ACCOUNT_BINDING_REQUIRED");
    const previous = pending.current;
    const resumeKey = session?.sessionKey === resumeSessionKey ? resumeSessionKey : undefined;
    const command = previous?.model === model && previous.prompt === prompt && previous.projectId === projectId && previous.accountId === accountId && previous.resumeSessionKey === resumeKey ? previous : { model, prompt, projectId, accountId, requestId: crypto.randomUUID(), ...(resumeKey ? { resumeSessionKey: resumeKey } : {}) };
    pending.current = command;
    try { const result = await api<HostTask>("/api/command", { type: "startTask", ...command }); setResumeSessionKey(undefined); setSession(null); setTaskId(result.taskId); setTask(result); setFollow(true); pending.current = null; setError(""); }
    catch (cause) { setError(errorText(cause)); throw cause; }
  }
  async function cancel() { if (!visibleTask || cancelPending.current) return; cancelPending.current = true; setTask({ ...visibleTask, status: "cancelling" }); try { const result = await api<HostTask>("/api/command", { type: "cancelTask", taskId: visibleTask.taskId }); setTask((current) => current?.taskId === result.taskId && active(current.status) ? result : current); } catch (cause) { setError(errorText(cause)); setTask((current) => current?.taskId === visibleTask.taskId && active(current.status) ? visibleTask : current); } finally { cancelPending.current = false; } }
  async function addProject(event: React.SubmitEvent<HTMLFormElement>) { event.preventDefault(); if (adding) return; setAdding(true); setAddError(""); try { const item = await api<Project>("/api/command", { type: "addProject", path: projectPath }); chooseProject(item); setAddOpen(false); setProjectPath(""); } catch (cause) { setAddError(errorText(cause)); } finally { setAdding(false); } }
  const messages = session ? historyPage.messages : visibleTask?.messages ?? [];
  const overlayTarget = width <= 760 && panel === "projects" ? "sidebar" : width <= 1100 && inspectOpen ? "inspector" : null;
  useEffect(() => {
    if (!overlayTarget) return;
    const target = document.querySelector<HTMLElement>(`.app > .${overlayTarget}`), previous = document.activeElement as HTMLElement | null;
    if (!target) return;
    target.setAttribute("role", "dialog"); target.setAttribute("aria-modal", "true");
    const focusables = () => [...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]')].filter((n) => n.getClientRects().length > 0);
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => { if (document.querySelector("dialog[open]")) return; if (e.key === "Escape") { e.preventDefault(); setPanel("chat"); setInspectOpen(false); } if (e.key === "Tab") { const items = focusables(), first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } };
    window.addEventListener("keydown", key); return () => { window.removeEventListener("keydown", key); target.removeAttribute("role"); target.removeAttribute("aria-modal"); requestAnimationFrame(() => previous?.isConnected && previous.focus()); };
  }, [overlayTarget]);
  function openHistory(item: Session) { setResumeSessionKey(undefined); setSession(item); setTaskId(null); setPageOffset(0); setPanel("chat"); }
  function toggleNavigation() { if (width <= 760) { setPanel(panel === "projects" ? "chat" : "projects"); setInspectOpen(false); } else setSidebarHidden(!sidebarHidden); }
  const showSidebar = width <= 760 ? panel === "projects" : !sidebarHidden;
  const overlay = width <= 760 && showSidebar ? "sidebar" : width <= 1100 && inspectOpen ? "inspector" : null;
  return <div className={`app ${!inspectOpen ? "no-inspector" : ""} ${!showSidebar ? "no-sidebar" : ""} ${overlay ? overlay + "-overlay" : ""} ${dockOpen ? "dock-open" : ""}`}>
    <aside className="sidebar" aria-label="分区、项目与会话" inert={!showSidebar || overlay === "inspector"}>
      <div className="brand"><div className="brand-logo"><BrandLogo /></div><div className="grow"><div className="brand-name">Pi Agent</div><div className="brand-sub">GLACIER · AGENT WEBUI</div></div><button className="iconbtn small" aria-label="收起侧栏" onClick={toggleNavigation}><Icon name="sidebar" /></button></div>
      <button className="searchbutton" onClick={() => searchDialog.current?.showModal()}><Icon name="search" /><span>搜索分区、项目或会话</span><kbd>⌘ K</kbd></button>
      <nav className="primary-nav" aria-label="主要操作"><button className="nav-item" onClick={fresh} disabled={!project}><Icon name="plus-circle" />新建会话</button><button className="nav-item" onClick={() => setExploreOpen(true)}><Icon name="compass" />探索</button><button className="nav-item" disabled title="插件管理尚未接入"><Icon name="box" />插件与工具（未开放）</button></nav>
      <div className="tree-label between"><span>分区</span><button className="iconbtn small" disabled aria-label="新建分区（尚未接入）"><Icon name="plus" /></button></div>
      <nav className="tree" aria-label="分区 → 项目 → 会话"><section className="partition"><div className="partition-row"><button className="partition-main" aria-expanded={partitionOpen} onClick={() => setPartitionOpen(!partitionOpen)}><Icon name="home" /><span>本机</span><span className={`chevron ${partitionOpen ? "open" : ""}`}><Icon name="chevron" /></span></button><button className="iconbtn small" onClick={() => setAddOpen(true)} aria-label="添加项目"><Icon name="plus" /></button></div>
      {partitionOpen && <div className="projects">{snapshot?.projects.map((item) => <div className="project-group" key={item.projectId}><div className={`project-row ${item.projectId === projectId ? "selected" : ""}`}><button className="project-fold" aria-expanded={item.projectId === projectId && !folded} aria-label={`展开或收起${item.name}会话`} onClick={() => { if (item.projectId !== projectId) { chooseProject(item); setFolded(false); } else setFolded(!folded); }}><span className={`chevron ${item.projectId === projectId && !folded ? "open" : ""}`}><Icon name="chevron" /></span></button><button className="project-pick" title={item.path} onClick={() => { chooseProject(item); setFolded(false); }}><Icon name="folder" /><span className="cut">{item.name}</span></button><button className="iconbtn small" aria-label={`在${item.name}中新建会话`} onClick={() => { chooseProject(item); fresh(); }}><Icon name="plus" /></button></div>
      {item.projectId === projectId && !folded && <div className="sessions">{projectTasks.slice(0, 15).map((item) => <button className={`session-item ${taskId === item.taskId && !session ? "selected" : ""}`} key={item.taskId} onClick={() => { setSession(null); setTaskId(item.taskId); setPanel("chat"); }}><Icon name="file" /><span className="grow"><span className="session-name cut host-block">{item.prompt || "只读分析"}</span><span className="session-meta">{labels[item.status]}</span></span>{active(item.status) && <span className="dot accent" />}</button>)}
      <div className="between host-history-label"><span>完整历史</span><button className="linkbtn" onClick={() => setRevision((n) => n + 1)}>刷新</button></div>
      {sessions.map((item) => <button className={`session-item ${session?.sessionKey === item.sessionKey ? "selected" : ""}`} key={item.sessionKey} onClick={() => openHistory(item)}><Icon name="file" /><span className="grow"><span className="session-name cut host-block">{item.name}</span><span className="session-meta">只读历史</span></span></button>)}{!sessions.length && !projectTasks.length && <div className="empty-tree">还没有会话</div>}</div>}</div>)}{!snapshot?.projects.length && <button className="linkbtn" onClick={() => setAddOpen(true)}>+ 新建第一个项目</button>}</div>}</section></nav>
      <div className="profile"><div className="avatar">O</div><div className="grow"><div className="profile-name">OMP</div><div className="profile-sub">本机运行 · 只读分析</div></div><Appearance onAccountsChanged={() => setAccountRevision((n) => n + 1)} /></div>
    </aside>
    <main className="canvas" inert={!!overlay}>
      <header className="main-header"><button className="iconbtn round" aria-label="切换导航" aria-expanded={showSidebar} onClick={toggleNavigation}><Icon name="sidebar" /></button><div className="grow"><h1 className="main-title cut">{session?.name || visibleTask?.prompt || project?.name || "Pi Agent"}</h1><div className="breadcrumbs"><span>本机</span><span className="crumb-divider">/</span><button className="crumb cut" onClick={fresh}>{project?.name || "选择项目"}</button><span className="crumb-divider">/</span><span>{session || visibleTask ? "会话" : "概览"}</span></div></div><div className="header-actions"><span className="status-pill" role="status"><span className={`dot ${connected ? "" : "attention"}`} />{connection}</span><button className="iconbtn round" aria-label="会话操作（尚未接入）" disabled><Icon name="more" /></button><div className="view-controls" aria-label="面板控制"><button className="iconbtn round" ref={dockButton} aria-label="切换底部输出" aria-expanded={dockOpen} onClick={() => { setDockOpen(!dockOpen); if (width <= 1100) { setInspectOpen(false); setPanel("chat"); } }}><Icon name="panel-bottom" /></button><span className="control-divider" /><button className="iconbtn round" aria-label="切换项目检查" aria-expanded={inspectOpen} onClick={() => { setInspectOpen(!inspectOpen); setPanel("chat"); }}><Icon name="panel-right" /></button></div></div></header>
      {error && <div className="host-notice" role="alert">{error}<button className="iconbtn small" onClick={() => setError("")} aria-label="关闭错误提示"><Icon name="x" /></button></div>}
      {!!snapshot?.diagnostics.length && <p className="host-notice">部分历史未能索引（{snapshot.diagnostics.length} 项）。</p>}
      {project && !project.available && <p className="host-notice">项目目录不可访问，仍可查看历史。</p>}
      <section className="view" ref={scroller} aria-label="项目概览与对话" onScroll={() => { const node = scroller.current; if (node) setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 80); }}>
        {!session && !visibleTask ? <ProjectHome hasProject={!!project} projectName={project?.name} onSuggest={(text) => setSuggestion({ text, key: Date.now() })} recent={sessions.slice(0,3)} onHistory={openHistory} onAdd={() => setAddOpen(true)} /> : <div className="feed"><div className="feed-banner"><div className="feed-tabs" aria-label="会话视图"><button aria-pressed={feedTab === "chat"} aria-selected={feedTab === "chat"} onClick={() => setFeedTab("chat")}>对话</button><button aria-pressed={feedTab === "trace"} aria-selected={feedTab === "trace"} onClick={() => setFeedTab("trace")}>执行记录</button></div><span className="trace-note"><Icon name="shield" />{visibleTask?.mode === "controlled" ? "受控执行 · 逐项审批" : "只读分析"}</span></div>
        {session && <div className="between host-history-label"><span>只读历史 · 第 {Math.floor(pageOffset / 50) + 1} 页</span><div><button className="linkbtn" disabled={pageOffset === 0 || historyBusy} onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}>上一页</button><button className="linkbtn" disabled={historyPage.nextOffset === null || historyBusy} onClick={() => setPageOffset(historyPage.nextOffset!)}>下一页</button></div></div>}
        <div className="chat-content">{historyBusy ? <p className="muted">正在读取历史…</p> : (feedTab === "trace" ? messages.filter((m) => m.role === "toolResult") : messages).map((message) => <MessageView key={`${session?.sessionKey || visibleTask?.taskId}:${message.id}`} message={message} sessionKey={session?.sessionKey} />)}
        {feedTab === "trace" && !messages.some((m) => m.role === "toolResult") && <div className="empty-state">暂无公开工具执行记录。</div>}
        {feedTab === "chat" && visibleTask?.partial && <article className="assistant-message"><div className="agent-mark"><Icon name="spark" /></div><div className="assistant-content"><div className="sender"><b>Pi Agent</b><span>OMP</span></div><SafeMarkdown text={visibleTask.partial} /></div></article>}
        {visibleTask && <div className="run-status task-status" role="status"><Icon name={active(visibleTask.status) ? "clock" : visibleTask.status === "succeeded" ? "check" : "info"} /><span>{labels[visibleTask.status]}{visibleTask.tool ? ` · 正在调用 ${visibleTask.tool.name}` : ""}{visibleTask.error && <p>{errorText(new Error(visibleTask.error))}</p>}</span></div>}</div></div>}
        {visibleTask && <TaskControl key={visibleTask.taskId} task={visibleTask} connected={connected} />}
      </section>
      {!follow && visibleTask && <button className="pill host-latest" onClick={() => setFollow(true)}>回到最新</button>}
      {session && <div className="account-picker"><button className="softbtn" disabled={!connected || snapshot?.tasks.some((item) => item.sessionId === session.sessionId && active(item.status))} onClick={() => { setResumeSessionKey(resumeSessionKey ? undefined : session.sessionKey); pending.current = null; }}>{resumeSessionKey ? "取消续接" : "续接此会话（只读）"}</button><span role="status">{resumeSessionKey ? "下一条消息续接此历史；请明确选择账号和模型，不恢复旧授权。" : "当前仅查看历史；发送默认创建新会话。"}</span></div>}
      <div className="account-picker"><label>运行账号<select aria-label="运行账号" value={accountId} disabled={!connected || active(visibleTask?.status)} onChange={(e) => { setAccountId(e.target.value); setModels([]); setSelectedModel(""); pending.current = null; }}><option value="">请选择账号（不自动回退）</option>{accounts && <option value={accounts.cliReference.accountId}>{accounts.cliReference.name}</option>}{accounts?.accounts.map((item) => <option key={item.accountId} value={item.accountId}>{item.name} · {item.providerId}</option>)}</select></label>{visibleTask && <span className="metric-fine">本次绑定：{accounts?.accounts.find((a) => a.accountId === visibleTask.accountId)?.name ?? (visibleTask.accountId === "cli-readonly" ? "CLI 只读引用" : visibleTask.accountId ?? "历史未绑定")}</span>}</div>
      <Composer key={projectId} projectName={project?.name} suggestion={suggestion} selectedModel={selectedModel} onSelectModel={setSelectedModel} models={models} disabled={!project?.available || !connected || !accountId} running={active(visibleTask?.status)} cancelling={visibleTask?.status === "cancelling"} onSend={send} onCancel={cancel} onModels={loadModels} />
    </main>
    <Inspector key={projectId} projectId={projectId} projectName={project?.name} projectPath={project?.path} sessionId={session?.sessionId || visibleTask?.sessionId} hidden={!inspectOpen || overlay === "sidebar"} onClose={() => setInspectOpen(false)} />
    {dockOpen && <OutputDock messages={messages} onClose={closeDock} />}
    {overlay && <button className="overlay" aria-label="关闭展开面板" onClick={() => { setPanel("chat"); setInspectOpen(false); }} />}
    <dialog className="dialog" ref={searchDialog} aria-label="搜索项目与会话"><div className="dialog-head"><h2>搜索</h2><button className="iconbtn round" onClick={() => searchDialog.current?.close()} aria-label="关闭搜索"><Icon name="x" /></button></div><div className="dialog-body"><label className="search-input"><Icon name="search" /><input aria-label="搜索项目与会话" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索分区、项目或会话" /></label>{snapshot?.projects.filter((p) => p.name.includes(search)).map((p) => <button className="search-result" key={p.projectId} onClick={() => { chooseProject(p); searchDialog.current?.close(); }}><Icon name="folder" /><span className="grow"><b>{p.name}</b><p>{p.path}</p></span></button>)}{!snapshot?.projects.some((p) => p.name.includes(search)) && !sessions.some((s) => s.name.includes(search)) && <p role="status">没有匹配结果。仅搜索项目名称与当前项目的会话名称。</p>}{sessions.filter((s) => s.name.includes(search)).map((s) => <button className="search-result" key={s.sessionKey} onClick={() => { openHistory(s); searchDialog.current?.close(); }}><Icon name="file" /><b>{s.name}</b></button>)}</div></dialog>
    <HostDialog open={exploreOpen} onClose={() => setExploreOpen(false)} title="探索（尚未开放）"><p>独立探索功能尚未接入。可以使用主页的只读分析建议；关闭此说明会保留当前会话和草稿。</p></HostDialog>
    <HostDialog open={addOpen} onClose={() => setAddOpen(false)} title="添加项目">{addError && <p role="alert">{addError}</p>}<form onSubmit={addProject}><label className="field">本机绝对路径<input value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="输入完整项目目录" /></label><div className="dialog-footer"><button className="softbtn primary" disabled={adding || !projectPath || !connected}>{adding ? "正在添加…" : "添加项目"}</button></div></form></HostDialog>
  </div>;
}
