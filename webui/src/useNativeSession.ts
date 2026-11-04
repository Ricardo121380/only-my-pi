import { useEffect, useRef, useState } from "react";
import type { HostCommand, HostTask, Project, Session, TaskStatus } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";
import { useHost } from "./useHost";
import { useAccountModels } from "./useAccountModels";
import { useSessionHistory } from "./useSessionHistory";
import type { Appearance } from "./MinimalPanels";

type Submission = Extract<HostCommand, { type: "startTask" }>;
const selectionKey = "omp.minimal.selection.v1", submissionKey = "omp.minimal.submission.v1", ownerKey = "omp.minimal.submission-owner.v1";
export const isTaskActive = (s?: TaskStatus) => s === "starting" || s === "running" || s === "cancelling";
const appearanceKey = "omp.minimal.appearance.v1";
function readAppearance(): Appearance {
  try { const saved = JSON.parse(localStorage.getItem(appearanceKey) || "null");
    return { theme: ["light", "dark", "system"].includes(saved?.theme) ? saved.theme : "system", reduceMotion: saved?.reduceMotion === true };
  } catch { return { theme: "system", reduceMotion: false }; }
}
function restore<T>(key: string): T | null { try { return JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { return null; } }

// Shared native-session behavior for the minimal and B2 views.
export function useNativeSession() {
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
  const pendingRef = useRef(pending), navigation = useRef(initial?.viewId ?? crypto.randomUUID()), sending = useRef<string | null>(null), cancelling = useRef(new Set<string>());
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
  const sessionRunning = selectedSession && projectTasks.some(t => t.sessionId === selectedSession.sessionId && isTaskActive(t.status));
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
    if (!visibleTask || isTaskActive(visibleTask.status) || !visibleTask.sessionId) return;
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
    if (sending.current === command.requestId) sending.current = null;
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
    if (sending.current) throw new Error("INPUT_NOT_READY");
    if (pendingRef.current?.requestId !== command.requestId) {
      pendingView.current = navigation.current; sessionStorage.setItem(ownerKey, navigation.current);
    }
    const version = pendingView.current; sending.current = command.requestId;
    try { remember(command); accept(await api<HostTask>("/api/command", command), command, version); }
    catch (cause) {
      // A lookup may already have accepted this request while its POST was in
      // flight. Its late failure cannot change a newer submission's notice.
      if (pendingRef.current?.requestId !== command.requestId) throw cause;
      if (cause instanceof Error && "status" in cause && Number(cause.status) >= 400 && Number(cause.status) < 500) {
        if (pendingRef.current?.requestId === command.requestId) remember(null);
        setSubmissionNotice("");
      } else setSubmissionNotice("提交结果尚未确认。请先核对，或重试同一请求；不会自动重发。");
      if (navigation.current === version) setError(errorText(cause)); throw cause;
    } finally { if (sending.current === command.requestId) sending.current = null; }
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
    const running = projectTasks.find(t => t.sessionId === s.sessionId && isTaskActive(t.status));
    navigate(projectId, running?.taskId ?? null, running ? "" : s.sessionKey);
  }
  async function stop() {
    if (!visibleTask || cancelling.current.has(visibleTask.taskId)) return;
    cancelling.current.add(visibleTask.taskId); setTask({ ...visibleTask, status: "cancelling" });
    try { const result = await api<HostTask>("/api/command", { type: "cancelTask", taskId: visibleTask.taskId }); setTask(current => current?.taskId === result.taskId && isTaskActive(current.status) ? result : current); }
    catch (cause) { setError(errorText(cause)); setTask(current => current?.taskId === visibleTask.taskId && isTaskActive(current.status) ? visibleTask : current); }
    finally { cancelling.current.delete(visibleTask.taskId); }
  }
  async function addProject(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault(); if (addPending.current) return; addPending.current = true; setAdding(true); setAddError("");
    try { const p = await api<Project>("/api/command", { type: "addProject", path: projectPath }); navigate(p.projectId); setAddOpen(false); setProjectPath(""); }
    catch (cause) { setAddError(errorText(cause)); } finally { addPending.current = false; setAdding(false); }
  }
  const historyReady = !!selectedSession && history.session?.sessionKey === selectedKey && !history.busy;
  const title = selectedSession ? sessionTitle(selectedSession) : visibleTask?.prompt || "新会话";
  function toggleNavigation() {
    if (window.matchMedia?.("(max-width: 759px)").matches) setNavigationOpen(true); else setCollapsed(value => !value);
  }
  function suggest(text: string) { setSuggestion({ id: crypto.randomUUID(), text }); }
  return { projectId, taskId, selectedKey, host, snapshot, task, setTask, setError, connection, connected, account, history, appearance, setAppearance, settingsOpen, setSettingsOpen, detailsOpen, setDetailsOpen, navigationOpen, setNavigationOpen, collapsed, suggestion, armed, setArmed, composerVersion, pending, acknowledged, reconciling, submissionNotice, addOpen, setAddOpen, projectPath, setProjectPath, addError, adding, scroller, follow, setFollow, project, projectTasks, visibleTask, taskLoading, selectedSession, currentSummary, sessionRunning, messages, sessionTitle, lookup, dispatch, send, navigate, openSession, stop, addProject, historyReady, title, toggleNavigation, suggest, sending };
}
export type NativeSession = ReturnType<typeof useNativeSession>;
