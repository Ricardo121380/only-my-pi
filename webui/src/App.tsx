import { useEffect, useRef, useState } from "react";
import type { HostTask, Message, ModelChoice, Project, Session, TaskStatus } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";
import { useHost } from "./useHost";
import { Inspector } from "./Inspector";
import { MessageView, SafeMarkdown } from "./Messages";
import { Composer } from "./Composer";

const labels: Record<TaskStatus, string> = { starting: "正在启动", running: "分析中", cancelling: "正在取消", succeeded: "已完成", failed: "任务失败", cancelled: "已取消", interrupted: "运行已中断" };
const active = (status?: TaskStatus) => status === "starting" || status === "running" || status === "cancelling";
interface HistoryPage { messages: Message[]; nextOffset: number | null }
export function App() {
  const [projectId, setProjectId] = useState(""), [session, setSession] = useState<Session | null>(null), [taskId, setTaskId] = useState<string | null>(() => sessionStorage.getItem("omp.selectedTask"));
  const { snapshot, task, connection, error, setError, setTask } = useHost(taskId);
  const [models, setModels] = useState<ModelChoice[]>([]), [sessions, setSessions] = useState<Session[]>([]), [historyPage, setHistoryPage] = useState<HistoryPage>({ messages: [], nextOffset: null });
  const [historyBusy, setHistoryBusy] = useState(false), [pageOffset, setPageOffset] = useState(0), [projectPath, setProjectPath] = useState(""), [adding, setAdding] = useState(false), [addOpen, setAddOpen] = useState(false), [panel, setPanel] = useState("chat"), [follow, setFollow] = useState(true), [revision, setRevision] = useState(0);
  const scroller = useRef<HTMLDivElement>(null), pending = useRef<{ model: string; prompt: string; projectId: string; requestId: string } | null>(null);
  const cancelPending = useRef(false);
  const project = snapshot?.projects.find((item) => item.projectId === projectId);
  const visibleTask = task?.projectId === projectId && !session ? task : null;
  const projectTasks = snapshot?.tasks.filter((item) => item.projectId === projectId) ?? [];
  const connected = connection === "已连接";
  async function loadModels() { try { setModels((await api<{ models: ModelChoice[] }>("/api/models")).models); } catch (cause) { setError(errorText(cause)); } }
  useEffect(() => { if (connected) void loadModels(); }, [connected]);
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
  function chooseProject(item: Project) { setProjectId(item.projectId); setSession(null); setTaskId(null); setSessions([]); pending.current = null; setPanel("chat"); }
  function fresh() { setSession(null); setTaskId(null); pending.current = null; setPanel("chat"); requestAnimationFrame(() => document.getElementById("prompt")?.focus()); }
  async function send(model: string, prompt: string) {
    if (!project) throw new Error("PROJECT_REQUIRED");
    const previous = pending.current;
    const command = previous?.model === model && previous.prompt === prompt && previous.projectId === projectId ? previous : { model, prompt, projectId, requestId: crypto.randomUUID() };
    pending.current = command;
    try { const result = await api<HostTask>("/api/command", { type: "startTask", ...command }); setSession(null); setTaskId(result.taskId); setTask(result); setFollow(true); pending.current = null; setError(""); }
    catch (cause) { setError(errorText(cause)); throw cause; }
  }
  async function cancel() { if (!visibleTask || cancelPending.current) return; cancelPending.current = true; setTask({ ...visibleTask, status: "cancelling" }); try { const result = await api<HostTask>("/api/command", { type: "cancelTask", taskId: visibleTask.taskId }); setTask((current) => current?.taskId === result.taskId && active(current.status) ? result : current); } catch (cause) { setError(errorText(cause)); setTask((current) => current?.taskId === visibleTask.taskId && active(current.status) ? visibleTask : current); } finally { cancelPending.current = false; } }
  async function addProject(event: React.SubmitEvent<HTMLFormElement>) { event.preventDefault(); if (adding) return; setAdding(true); try { const item = await api<Project>("/api/command", { type: "addProject", path: projectPath }); chooseProject(item); setAddOpen(false); setProjectPath(""); } catch (cause) { setError(errorText(cause)); } finally { setAdding(false); } }
  const messages = session ? historyPage.messages : visibleTask?.messages ?? [];
  return <div className={`workspace panel-${panel}`}>
    <header className="app-bar"><a className="brand" href="#" onClick={(event) => event.preventDefault()} aria-label="OMP 只读工作台"><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M5 7h18v14H5zM10 7v14M18 7v14" /></svg><strong>OMP</strong><span>只读工作台</span></a><div className={`connection ${connected ? "online" : ""}`} role="status"><span aria-hidden="true" />{connection}</div><button className="inspect-toggle" onClick={() => setPanel(panel === "inspect" ? "chat" : "inspect")}>{panel === "inspect" ? "返回对话" : "检查项目"}</button></header>
    <nav className="mobile-nav" aria-label="工作区页面">{[["projects", "项目"], ["chat", "对话"], ["inspect", "检查"]].map(([id, name]) => <button key={id} aria-pressed={panel === id} onClick={() => setPanel(id)}>{name}</button>)}</nav>
    <aside className="sidebar" aria-label="项目与历史"><div className="section-heading"><h2>项目</h2><button onClick={() => setAddOpen(!addOpen)} aria-expanded={addOpen}>添加</button></div>
      {addOpen && <form className="add-project" onSubmit={addProject}><label htmlFor="project-path">本机绝对路径</label><input id="project-path" value={projectPath} onChange={(event) => setProjectPath(event.target.value)} placeholder="输入完整项目目录" autoFocus /><button disabled={adding || !projectPath || !connected}>{adding ? "正在添加…" : "添加项目"}</button></form>}
      <div className="project-list">{snapshot?.projects.map((item) => <button className="project-row" key={item.projectId} aria-pressed={projectId === item.projectId} title={item.path} onClick={() => chooseProject(item)}><span className="project-symbol" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span><span>{item.name}{!item.available && <small>项目不可访问</small>}</span></button>)}{snapshot && !snapshot.projects.length && <p className="muted">没有历史项目。添加本机目录开始分析。</p>}</div>
      <button className="new-task" onClick={fresh} disabled={!project}>＋ 新建只读分析</button>
      <div className="section-heading"><h2>最近任务</h2></div><div className="task-list">{projectTasks.slice(0, 15).map((item) => <button key={item.taskId} aria-pressed={taskId === item.taskId && !session} onClick={() => { setSession(null); setTaskId(item.taskId); setPanel("chat"); }}><span>{item.prompt || "只读分析"}</span><small>{labels[item.status]}</small></button>)}{!projectTasks.length && <p className="muted">新任务将在这里显示。</p>}</div>
      <div className="section-heading"><h2>只读历史</h2><button onClick={() => setRevision((n) => n + 1)}>刷新</button></div><div className="session-list">{sessions.map((item) => <button key={item.sessionKey} aria-pressed={session?.sessionKey === item.sessionKey} onClick={() => { setSession(item); setTaskId(null); setPageOffset(0); setPanel("chat"); }}><span>{item.name}</span><small>查看历史，不续接</small></button>)}{!sessions.length && <p className="muted">此项目暂无历史会话。</p>}</div><footer className="sidebar-footer">本机运行 <span>Pi 0.85.1</span></footer>
    </aside>
    <main className="conversation"><div className="conversation-heading"><div><h1>{project?.name || "选择你的项目"}</h1><p title={project?.path}>{project?.path || "从左侧添加本机项目，或查看已有历史"}</p></div><span className="readonly-badge">只读</span></div>
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误提示">×</button></div>}
      {snapshot?.diagnostics.length ? <p className="notice">部分历史未能索引（{snapshot.diagnostics.length} 项），已保留可读取的会话。</p> : null}
      {project && !project.available && <p className="notice">项目目录不可访问，仍可查看历史；恢复目录后刷新项目。</p>}
      <div className="conversation-scroll" ref={scroller} onScroll={() => { const node = scroller.current; if (node) setFollow(node.scrollHeight - node.scrollTop - node.clientHeight < 80); }}>
        {session && <div className="history-heading"><span>只读历史 · 第 {Math.floor(pageOffset / 50) + 1} 页</span><div><button disabled={pageOffset === 0 || historyBusy} onClick={() => setPageOffset(Math.max(0, pageOffset - 50))}>上一页</button><button disabled={historyPage.nextOffset === null || historyBusy} onClick={() => setPageOffset(historyPage.nextOffset!)}>下一页</button></div></div>}
        {historyBusy && session ? <p className="muted">正在读取历史…</p> : !messages.length && !visibleTask ? <div className="empty-conversation"><div className="empty-mark" aria-hidden="true">{project ? "⌘" : "+"}</div><h2>{session ? "此页没有对话正文" : "先理解，再动手"}</h2><p>{session ? "历史中的元数据和内部事件不会作为对话展示。" : "询问项目结构、梳理调用链，或检查代码风险。分析不会修改你的项目文件。"}</p>{!project && <button onClick={() => { setAddOpen(true); setPanel("projects"); }}>添加本机项目</button>}</div> : messages.map((message) => <MessageView key={`${session?.sessionKey || visibleTask?.taskId}:${message.id}`} message={message} sessionKey={session?.sessionKey} />)}
        {visibleTask?.partial && <article className="message assistant"><div className="speaker">OMP</div><div className="prose"><SafeMarkdown text={visibleTask.partial} /></div></article>}
        {visibleTask && <div className="task-status" role="status">{labels[visibleTask.status]}{visibleTask.tool ? ` · 正在调用 ${visibleTask.tool.name}` : ""}{visibleTask.error && <p>{errorText(new Error(visibleTask.error))}</p>}</div>}
      </div>
      {!follow && visibleTask && <button className="latest" onClick={() => { setFollow(true); }}>回到最新</button>}
      <Composer key={projectId} models={models} disabled={!project?.available || !connected} running={active(visibleTask?.status)} cancelling={visibleTask?.status === "cancelling"} onSend={send} onCancel={cancel} onModels={loadModels} />
    </main>
    {project ? <Inspector key={projectId} projectId={projectId} sessionId={session?.sessionId || visibleTask?.sessionId} /> : <aside className="inspector empty-inspector"><h2>项目证据</h2><p>选择项目后，在这里查看文件、Git diff 与验证回执。</p></aside>}
  </div>;
}
