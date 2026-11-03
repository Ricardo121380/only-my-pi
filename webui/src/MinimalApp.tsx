import { useEffect, useRef, useState } from "react";
import type { HostCommand, HostTask, Project, Session, TaskStatus } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";
import { useHost } from "./useHost";
import { useAccountModels } from "./useAccountModels";
import { useSessionHistory } from "./useSessionHistory";
import { MessageView, SafeMarkdown } from "./Messages";
import { HostDialog } from "./HostDialog";
import { TaskControl } from "./TaskControl";
import { MinimalComposer } from "./MinimalComposer";
import { Icon } from "./Icon";
import { AppearanceSettings, SessionDetails, ToolActivity, runLabels as labels, type Appearance } from "./MinimalPanels";

type Submission = Extract<HostCommand, { type: "startTask" }>;
const selectionKey = "omp.minimal.selection.v1", submissionKey = "omp.minimal.submission.v1", ownerKey = "omp.minimal.submission-owner.v1";
const active = (s?: TaskStatus) => s === "starting" || s === "running" || s === "cancelling";
const appearanceKey = "omp.minimal.appearance.v1";
function readAppearance(): Appearance {
  try { const saved = JSON.parse(localStorage.getItem(appearanceKey) || "null");
    return { theme: ["light", "dark", "system"].includes(saved?.theme) ? saved.theme : "system", reduceMotion: saved?.reduceMotion === true };
  } catch { return { theme: "system", reduceMotion: false }; }
}
function restore<T>(key: string): T | null { try { return JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; } }

export function MinimalApp() {
  const [initial] = useState(() => restore<{ projectId?: string; taskId?: string; sessionKey?: string; viewId?: string }>(selectionKey));
  const [projectId, setProjectId] = useState(initial?.projectId ?? ""), [taskId, setTaskId] = useState<string | null>(initial?.taskId ?? null);
  const [selectedKey, setSelectedKey] = useState(initial?.sessionKey ?? "");
  const host = useHost(taskId), { snapshot, task, setTask, setError, connection } = host;
  const connected = connection === "已连接";
  const account = useAccountModels(connected, setError);
  const history = useSessionHistory({ projectId, connected, taskStatus: task?.status, projects: snapshot?.projects, onError: setError });
  const [appearance, setAppearance] = useState(readAppearance);
  const [settingsOpen, setSettingsOpen] = useState(false), [detailsOpen, setDetailsOpen] = useState(false), [navigationOpen, setNavigationOpen] = useState(false), [collapsed, setCollapsed] = useState(false);
  const [suggestion, setSuggestion] = useState<{ id: string; text: string }>();
  useEffect(() => {
    document.documentElement.dataset.ompTheme = appearance.theme;
    document.documentElement.dataset.ompMotion = appearance.reduceMotion ? "reduce" : "system";
    try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch { /* In-memory preferences still work when storage is unavailable. */ }
    return () => { delete document.documentElement.dataset.ompTheme; delete document.documentElement.dataset.ompMotion; };
  }, [appearance]);
  const [armed, setArmed] = useState(false), [composerVersion, setComposerVersion] = useState(0);
  const [pending, setPending] = useState<Submission | null>(() => restore<Submission>(submissionKey));
  const pendingRef = useRef(pending), navigation = useRef(initial?.viewId ?? crypto.randomUUID()), sending = useRef(false), cancelling = useRef(false);
  const pendingView = useRef(sessionStorage.getItem(ownerKey) ?? navigation.current);
  const [acknowledged, setAcknowledged] = useState<{ prompt: string; requestId: string }>();
  const [reconciling, setReconciling] = useState(false), [submissionNotice, setSubmissionNotice] = useState("");
  const [addOpen, setAddOpen] = useState(false), [projectPath, setProjectPath] = useState(""), [addError, setAddError] = useState(""), [adding, setAdding] = useState(false);
  const addPending = useRef(false), scroller = useRef<HTMLDivElement>(null), [follow, setFollow] = useState(true);
  const project = snapshot?.projects.find(p => p.projectId === projectId);
  const projectTasks = snapshot?.tasks.filter(t => t.projectId === projectId) ?? [];
  const visibleTask = task?.taskId === taskId && task?.projectId === projectId && !selectedKey ? task : null;
  const taskLoading = !!taskId && !visibleTask;
  const selectedSession = history.sessions.find(s => s.sessionKey === selectedKey);
  const currentSummary = selectedSession ? projectTasks.filter(t => t.sessionId === selectedSession.sessionId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : visibleTask;
  const sessionRunning = selectedSession && projectTasks.some(t => t.sessionId === selectedSession.sessionId && active(t.status));
  const messages = (selectedKey ? history.page.messages : visibleTask?.messages ?? []).filter(m => m.role !== "assistant" || m.text.trim());
  const sessionTitle = (session: Session) => /^\d{4}-\d{2}-\d{2}T/.test(session.name)
    ? projectTasks.filter(t => t.sessionId === session.sessionId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.prompt || session.name
    : session.name;

  useEffect(() => { sessionStorage.setItem(selectionKey, JSON.stringify({ projectId, taskId, sessionKey: selectedKey, viewId: navigation.current })); }, [projectId, taskId, selectedKey, composerVersion]);
  useEffect(() => {
    if (snapshot && !projectId) setProjectId(snapshot.tasks.find(t => t.taskId === taskId)?.projectId ?? snapshot.projects[0]?.projectId ?? "");
  }, [snapshot, projectId, taskId]);
  useEffect(() => {
    if (selectedSession && history.session?.sessionKey !== selectedKey) history.open(selectedSession);
  }, [selectedSession, selectedKey, history.session?.sessionKey]);
  useEffect(() => {
    // Once execution is settled, render Pi history instead of the bounded task projection.
    if (!visibleTask || active(visibleTask.status) || !visibleTask.sessionId) return;
    const session = history.sessions.find(s => s.sessionId === visibleTask.sessionId);
    if (session) { setSelectedKey(session.sessionKey); setTaskId(null); setArmed(false); }
  }, [visibleTask, history.sessions]);
  useEffect(() => { if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, [messages, visibleTask?.partial, visibleTask?.tool, follow]);

  function remember(command: Submission | null) {
    // Store before POST. Reload/reconnect can only look up this identity, never replay it.
    if (command) sessionStorage.setItem(submissionKey, JSON.stringify(command)); else sessionStorage.removeItem(submissionKey);
    pendingRef.current = command; setPending(command);
  }
  function accept(result: HostTask, command: Submission, version: string) {
    if (pendingRef.current?.requestId !== command.requestId) return;
    remember(null); setSubmissionNotice("");
    if (navigation.current === version) {
      setAcknowledged({ prompt: command.prompt, requestId: command.requestId });
      history.leave(); setSelectedKey(""); setProjectId(result.projectId); setTaskId(result.taskId); setTask(result); setArmed(false); setFollow(true); setError("");
    }
  }
  async function lookup() {
    const command = pendingRef.current; if (!command) return;
    const version = pendingView.current; setReconciling(true);
    try { accept(await api<HostTask>(query("task", { requestId: command.requestId })), command, version); }
    catch (cause) { setSubmissionNotice(cause instanceof Error && cause.message === "TASK_NOT_FOUND" ? "尚未查到此请求。可以再次核对，或明确重试同一请求；请求编号保持不变。" : "暂时无法确认是否已接收。连接恢复后请核对，系统不会自动重发。"); }
    finally { setReconciling(false); }
  }
  useEffect(() => { if (connected && pendingRef.current) void lookup(); }, [connected]);
  async function dispatch(command: Submission) {
    if (sending.current) return;
    if (pendingRef.current?.requestId !== command.requestId) {
      pendingView.current = navigation.current; sessionStorage.setItem(ownerKey, navigation.current);
    }
    const version = pendingView.current; sending.current = true;
    try { remember(command); accept(await api<HostTask>("/api/command", command), command, version); }
    catch (cause) {
      if (cause instanceof Error && "status" in cause && Number(cause.status) >= 400 && Number(cause.status) < 500) {
        if (pendingRef.current?.requestId === command.requestId) remember(null);
        setSubmissionNotice("");
      } else setSubmissionNotice("提交结果尚未确认。请先核对，或重试同一请求；不会自动重发。");
      if (navigation.current === version) setError(errorText(cause)); throw cause;
    } finally { sending.current = false; }
  }
  async function send(prompt: string, mode: "readonly" | "controlled") {
    if (!project?.available || taskId || pendingRef.current || !account.accountId || !account.selectedModel || (selectedKey && !armed)) throw new Error("INPUT_NOT_READY");
    await dispatch({ type: "startTask", requestId: crypto.randomUUID(), projectId, accountId: account.accountId, model: account.selectedModel, prompt, mode, ...(account.thinkingLevel ? { thinkingLevel: account.thinkingLevel } : {}),
      ...(selectedKey ? { resumeSessionKey: selectedKey } : {}) });
  }
  function navigate(nextProject: string, nextTask: string | null = null, nextSession = "") {
    setSuggestion(undefined); setNavigationOpen(false);
    navigation.current = crypto.randomUUID(); setArmed(false); history.leave(); setSelectedKey(nextSession); setTaskId(nextTask);
    if (nextProject !== projectId) history.clearSessions();
    setProjectId(nextProject); setComposerVersion(v => v + 1); setFollow(true); setError("");
  }
  function openSession(s: Session) {
    const running = projectTasks.find(t => t.sessionId === s.sessionId && active(t.status));
    navigate(projectId, running?.taskId ?? null, running ? "" : s.sessionKey);
  }
  async function stop() {
    if (!visibleTask || cancelling.current) return;
    cancelling.current = true; setTask({ ...visibleTask, status: "cancelling" });
    try { const result = await api<HostTask>("/api/command", { type: "cancelTask", taskId: visibleTask.taskId }); setTask(current => current?.taskId === result.taskId && active(current.status) ? result : current); }
    catch (cause) { setError(errorText(cause)); setTask(current => current?.taskId === visibleTask.taskId && active(current.status) ? visibleTask : current); }
    finally { cancelling.current = false; }
  }
  async function addProject(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault(); if (addPending.current) return; addPending.current = true; setAdding(true); setAddError("");
    try { const p = await api<Project>("/api/command", { type: "addProject", path: projectPath }); navigate(p.projectId); setAddOpen(false); setProjectPath(""); }
    catch (cause) { setAddError(errorText(cause)); } finally { addPending.current = false; setAdding(false); }
  }
  const historyReady = !!selectedSession && history.session?.sessionKey === selectedKey && !history.busy;
  if (snapshot && snapshot.capabilities?.minimal !== true) return <main className="notice" role="alert">此页面需要最小会话 Host。请使用 omp web --minimal 启动并配对。</main>;
  const title = selectedSession ? sessionTitle(selectedSession) : visibleTask?.prompt || "新会话";
  function toggleNavigation() {
    if (window.matchMedia?.("(max-width: 759px)").matches) setNavigationOpen(true); else setCollapsed(value => !value);
  }
  function suggest(text: string) { setSuggestion({ id: crypto.randomUUID(), text }); }
  const sessionNavigation = <nav className="session-nav" aria-label="会话列表">
    {projectTasks.filter(t => !t.sessionId || !history.sessions.some(s => s.sessionId === t.sessionId)).map(t => <button key={t.taskId} className={t.taskId === taskId ? "selected" : ""} aria-current={t.taskId === taskId ? "page" : undefined} onClick={() => navigate(projectId, t.taskId)}><span>{t.prompt || "新会话"}</span><small>{labels[t.status]}</small></button>)}
    {history.sessions.map(s => { const running = projectTasks.find(t => t.sessionId === s.sessionId && active(t.status)); const selected = selectedKey === s.sessionKey || visibleTask?.sessionId === s.sessionId; return <button key={s.sessionKey} className={selected ? "selected" : ""} aria-current={selected ? "page" : undefined} onClick={() => openSession(s)}><span>{sessionTitle(s)}</span><small>{running ? labels[running.status] : "查看历史"}</small></button>; })}
    {!projectTasks.length && !history.sessions.length && <p className="empty-hint">新建一个会话，从这里开始。</p>}
  </nav>;
  const navigationContent = <>
    <button className="new-session" aria-label="新建会话" title="新建会话" disabled={!project} onClick={() => navigate(projectId)}><Icon name="plus" /><span>新建会话</span></button>
    <div className="sidebar-scroll"><div className="sidebar-heading"><h2>项目</h2><div><button disabled={!project || !connected} onClick={history.refresh} aria-label="刷新会话列表" title="刷新会话列表"><Icon name="clock" /></button><button aria-label="添加项目" title="添加项目" onClick={() => { setNavigationOpen(false); setAddOpen(true); }}><Icon name="plus" /></button></div></div>
      <nav aria-label="选择项目">{snapshot?.projects.map(p => <div key={p.projectId} className="project-tree"><button className={`project-button ${p.projectId === projectId ? "is-current" : ""}`} aria-current={p.projectId === projectId ? "true" : undefined} title={p.path} onClick={() => navigate(p.projectId)}><Icon name={p.projectId === projectId ? "chevron-down" : "chevron"} /><Icon name="folder" /><span>{p.name}</span>{!p.available && <Icon name="info" />}</button>{p.projectId === projectId && sessionNavigation}</div>)}</nav>
      {!snapshot?.projects.length && <p className="empty-hint">添加本机目录，开始第一个会话。</p>}
    </div>
    <div className="sidebar-bottom"><div className="workspace-card"><span className="project-emblem"><Icon name="folder" /></span><div><strong>{project?.name || "本地工作区"}</strong><small><i className={connected ? "connected-dot" : "offline-dot"} />{connection}</small></div></div><button className="settings-button" aria-label="界面设置" title="界面设置" onClick={() => { setNavigationOpen(false); setSettingsOpen(true); }}><Icon name="settings" /><span>界面设置</span></button></div>
  </>;
  return <div className={`minimal-app ${collapsed ? "nav-collapsed" : ""}`}>
    <aside className="minimal-sidebar" aria-label="项目与会话">
      <div className="minimal-brand"><span className="brand-emblem" aria-hidden="true">π</span><strong>Only My Pi</strong><button className="icon-button" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} title={collapsed ? "展开侧栏" : "收起侧栏"} onClick={toggleNavigation}><Icon name="sidebar" /></button></div>
      {navigationContent}
    </aside>
    <main className="minimal-main">
      <header className="minimal-header"><button className="icon-button mobile-navigation" aria-label="打开项目与会话" onClick={() => setNavigationOpen(true)}><Icon name="sidebar" /></button><h1 title={title}>{title}</h1><div className="header-actions">{currentSummary && <span className={`run-label ${active(currentSummary.status) ? "is-running" : ""}`} role="status">{labels[currentSummary.status]}</span>}<button className="icon-button" aria-label="查看会话详情" title="查看会话详情" onClick={() => setDetailsOpen(true)}><Icon name="panel-right" /></button></div></header>
      {host.error && <div className="notice" role="alert">{host.error}<button onClick={() => setError("")} aria-label="关闭错误提示">×</button></div>}
      {!!snapshot?.diagnostics.length && <p className="notice">部分历史无法读取，请检查会话文件。</p>}
      {project && !project.available && <p className="notice">项目目录不可访问，仍可查看历史。</p>}
      {pending && <div className="notice" role="status"><div>{submissionNotice || "正在核对上次提交…"}<small>项目：{snapshot?.projects.find(p => p.projectId === pending.projectId)?.name || pending.projectId} · 模型：{pending.model} · {pending.mode === "controlled" ? "受控编程" : "只读分析"}</small><pre>{pending.prompt}</pre><small>请求 {pending.requestId}</small></div><button disabled={!connected || reconciling} onClick={() => void lookup()}>核对提交结果</button><button disabled={!connected || reconciling || sending.current} onClick={() => void dispatch(pending).catch(() => {})}>重试同一请求</button></div>}
      <section ref={scroller} className={`minimal-conversation ${!selectedKey && !visibleTask && !taskLoading ? "is-home" : ""}`} aria-label="对话" onScroll={() => { const n = scroller.current; if (n) setFollow(n.scrollHeight - n.scrollTop - n.clientHeight < 80); }}>
        {taskLoading ? <p className="loading-state" role="status">正在读取运行状态，请稍候…</p> : !selectedKey && !visibleTask ? <div className="home-content"><div className="conversation-empty"><div className="home-emblem" aria-hidden="true"><span>π</span><i /><i /></div><p className="home-greeting">你的想法，下一步就开始。</p><h2>让每一个想法，<br /><span>都有一个好的开始。</span></h2>{project ? <div className="home-project" title={project.path}><Icon name="folder" />{project.name}</div> : <button className="home-project" onClick={() => setAddOpen(true)}><Icon name="plus" />添加项目</button>}<p className="home-capabilities"><span><Icon name="code" />理解代码</span><span><Icon name="layers" />梳理思路</span><span><Icon name="shield" />受控执行</span></p></div><div className="starter-grid">
          <button disabled={!project} onClick={() => suggest("请阅读这个项目，介绍目录结构、核心模块和主要入口。")}><span className="starter-icon"><Icon name="code" /></span><strong>读懂这个项目</strong><small>梳理项目结构与关键模块</small><Icon name="arrow-up" /></button>
          <button disabled={!project} onClick={() => suggest("请只读检查这个项目中的潜在问题，说明依据与验证建议，不修改文件。")}><span className="starter-icon"><Icon name="bug" /></span><strong>检查潜在问题</strong><small>寻找遗漏，核对边界情况</small><Icon name="arrow-up" /></button>
          <button disabled={!project} onClick={() => suggest("请先帮我梳理实施思路，列出需要明确的问题和建议步骤，暂不修改文件。")}><span className="starter-icon"><Icon name="layers" /></span><strong>把想法变成计划</strong><small>从一个清晰的下一步开始</small><Icon name="arrow-up" /></button>
        </div></div> : <div className="minimal-feed">
          {selectedKey && !historyReady ? <p role="status">正在读取会话历史…</p> : messages.map(m => <MessageView key={`${selectedKey || taskId}:${m.id}`} message={m} sessionKey={selectedKey || undefined} branded />)}
          {visibleTask?.partial && <article className="assistant-message"><div className="agent-mark pi-emblem" aria-hidden="true">π</div><div className="assistant-content"><div className="sender"><b>Only My Pi</b><span>正在回复</span></div><SafeMarkdown text={visibleTask.partial} /></div></article>}
          {visibleTask?.toolCalls?.filter(call => call.status === "running").map(call => <details className="live-tool" key={call.toolCallId} open><summary><Icon name="activity" />{call.name}<span>运行中</span></summary>{call.output && <pre>{call.output}</pre>}</details>)}
          {active(visibleTask?.status) && !visibleTask?.partial && <div className="working-indicator" role="status"><span className="working-pixels" aria-hidden="true"><i /><i /><i /><i /></span>{visibleTask?.approvals?.length ? "等待你的决定" : "Pi 正在处理…"}</div>}
          {visibleTask && <TaskControl key={visibleTask.taskId} task={visibleTask} connected={connected} />}
          {currentSummary?.error && <p className="notice" role="alert">{errorText(new Error(currentSummary.error))}</p>}
          {selectedKey && <div className="history-actions"><button disabled={!historyReady || history.offset === 0} onClick={() => history.setOffset(Math.max(0, history.offset - 50))}>上一页</button><span>第 {Math.floor(history.offset / 50) + 1} 页</span><button disabled={!historyReady || history.page.nextOffset === null} onClick={() => history.setOffset(history.page.nextOffset!)}>下一页</button></div>}
        </div>}
      </section>
      {!follow && <button className="latest" onClick={() => setFollow(true)}><Icon name="chevron-down" />回到最新</button>}
      <div className="minimal-input-area">
        {currentSummary && <ToolActivity key={currentSummary.taskId} task={currentSummary} />}
        {selectedKey && <div className="resume-bar"><span>{armed ? "下一条消息将继续此会话，旧授权不继承。" : "正在查看历史，尚未继续执行。"}</span><button disabled={armed || !connected || !historyReady || !!sessionRunning || !!pending || !project?.available} onClick={() => { setArmed(true); document.getElementById("minimal-prompt")?.focus(); }}>{armed ? "已选择继续" : "继续会话"}<Icon name="arrow-right" /></button></div>}
        <MinimalComposer key={`${projectId}:${composerVersion}`} accounts={account.accounts} accountId={account.accountId} models={account.models} model={account.selectedModel} onAccount={account.selectAccount} onModel={account.selectModel}
          projectName={project?.name} suggestion={suggestion} thinkingLevel={account.thinkingLevel} onThinking={account.setThinkingLevel}
          acknowledged={acknowledged} onSend={send} onCancel={() => void stop()} disabled={!connected || !!taskId || !project?.available || !!pending || !!selectedKey && !armed} running={active(visibleTask?.status)} cancelling={visibleTask?.status === "cancelling"} controlled={snapshot?.capabilities?.controlled === true} />
        <footer className="workspace-status"><span role="status"><Icon name="monitor" />本地<i className={connected ? "connected-dot" : "offline-dot"} />{connection}</span>{currentSummary ? <button onClick={() => setDetailsOpen(true)} title="查看本轮模型用量"><Icon name="database" />{currentSummary.usage?.tokens ? `${currentSummary.usage.tokens.totalTokens.toLocaleString()} tokens` : "用量未报告"}</button> : <span>由 Pi 驱动</span>}</footer>
      </div>
    </main>
    <HostDialog open={navigationOpen} onClose={() => setNavigationOpen(false)} title="项目与会话" className="minimal-navigation-dialog">{navigationOpen && navigationContent}</HostDialog>
    <AppearanceSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} value={appearance} onChange={setAppearance} />
    <SessionDetails open={detailsOpen} onClose={() => setDetailsOpen(false)} project={project} task={currentSummary} sessionId={selectedSession?.sessionId || visibleTask?.sessionId} />
    <HostDialog open={addOpen} onClose={() => setAddOpen(false)} title="添加项目" className="minimal-dialog"><form onSubmit={addProject}><label htmlFor="project-directory">本机目录的绝对路径</label><input id="project-directory" value={projectPath} placeholder="项目目录的绝对路径" onChange={e => setProjectPath(e.target.value)} required /><p>选择已有目录。添加项目不会修改目录内容。</p>{addError && <p role="alert">{addError}</p>}<button className="primary" disabled={adding || !projectPath.trim()}>{adding ? "正在添加…" : "添加"}</button></form></HostDialog>
  </div>;
}
