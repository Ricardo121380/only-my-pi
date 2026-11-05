import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeApp from "./App";
import { ApprovalDock } from "./Conversation";
import { TooltipProvider } from "../components/ui/tooltip";
import type { HostSnapshot, HostTask } from "../../../packages/host/contracts";
import { useNativeSession } from "../../../webui/src/shared/useNativeSession";

const project = { projectId: "project", name: "真实项目", path: "/fixture", available: true };
const session = { sessionKey: "history-key", sessionId: "session", projectId: "project", name: "原生会话", timestamp: "", readOnly: true };
const snapshot: HostSnapshot = { protocol: 2, version: "phase2-v1", epoch: "b2-fixture", seq: 1, indexing: false, runtime: { stackId: "fixture", sourceCommit: null }, capabilities: { minimal: true, controlled: true, inspector: { protocol: 1 } }, projects: [project], tasks: [], diagnostics: [] };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
class Socket {
  static all: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  close() {}
  constructor() { Socket.all.push(this); }
}
let posts: Record<string, unknown>[], task: HostTask, sequence: number;
let override: (url: URL, init?: RequestInit) => Promise<Response> | undefined;
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Socket.all = []; posts = []; sequence = 1; override = () => undefined;
  task = { taskId: "task", requestId: "request", projectId: "project", accountId: "cli-readonly", model: "fixture/one", prompt: "read project", mode: "controlled", access: "inspect", status: "running", sessionId: "session", messages: [], createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:00Z" };
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://fixture"), result = override(url, init); if (result) return result;
    if (url.pathname === "/api/state") return json(snapshot);
    if (url.pathname === "/api/accounts") return json({ protocol: 1, authentication: "api_key", cliReference: { accountId: "cli-readonly", name: "CLI 配置", readOnly: true }, accounts: [] });
    if (url.pathname === "/api/models") return json({ models: [{ id: "fixture/one", name: "本地模型", provider: "fixture", thinkingLevels: ["off", "high"] }] });
    if (url.pathname === "/api/sessions") return json({ sessions: [session] });
    if (url.pathname === "/api/history") return json({ messages: [{ id: "pi-entry", role: "assistant", text: "原生历史正文" }], nextOffset: null });
    if (url.pathname === "/api/tool-output") return json({ text: "完整的真实工具回执", nextOffset: null });
    if (url.pathname === "/api/files") return json({ entries: [], truncated: false });
    if (url.pathname === "/api/file") return json({ path: url.searchParams.get("path"), text: "export const total = 597;", bytes: 25, version: "sha256:fixture" });
    if (url.pathname === "/api/diff") return json({ available: true, text: "", truncated: false });
    if (url.pathname === "/api/task") return json(task);
    if (url.pathname === "/api/command") {
      const body = JSON.parse(String(init?.body)); posts.push(body);
      if (body.type === "startTask") task = { ...task, ...body, messages: [{ id: "user", role: "user", text: body.prompt }] };
      if (body.type === "cancelTask") task = { ...task, status: "cancelling" };
      return json(task);
    }
    throw new Error(url.pathname);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount() {
  const view = render(<TooltipProvider><NativeApp /></TooltipProvider>);
  await waitFor(() => expect(Socket.all.length).toBeGreaterThan(0));
  act(() => Socket.all.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "snapshot", ...snapshot }) }));
  await screen.findByRole("button", { name: /原生会话.*查看历史/ });
  return view;
}
async function chooseModel() {
  fireEvent.click(screen.getByRole("button", { name: "选择账号与模型" }));
  const account = await screen.findByLabelText("账号") as HTMLSelectElement;
  if (account.value !== "cli-readonly") fireEvent.change(account, { target: { value: "cli-readonly" } });
  await screen.findByRole("option", { name: "本地模型" });
  fireEvent.change(screen.getByLabelText("模型"), { target: { value: "fixture/one" } });
  fireEvent.click(screen.getByRole("button", { name: "完成选择" }));
}
function emit(changes: Partial<HostTask>) {
  task = { ...task, ...changes };
  act(() => Socket.all.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "task", epoch: snapshot.epoch, seq: ++sequence, data: task }) }));
}

it("B2 reads native history without executing, then requires explicit model and resume choices", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: /原生会话.*查看历史/ }));
  await screen.findByText("原生历史正文"); expect(posts).toHaveLength(0);
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "continue" } });
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  await chooseModel();
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "继续会话" }));
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ type: "startTask", projectId: "project", accountId: "cli-readonly", model: "fixture/one", resumeSessionKey: "history-key", prompt: "continue", mode: "readonly" });
});

it("B2 consumes real stream/tool/approval state and waits for Host stop confirmation", async () => {
  await mount(); await chooseModel();
  fireEvent.change(screen.getByLabelText("执行模式"), { target: { value: "controlled" } });
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "read project" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  await screen.findByRole("button", { name: "停止" });
  emit({ partial: "来自真实事件的部分回复", toolCalls: [{ toolCallId: "read-call", parentToolCallId: null, name: "read", status: "running", startedAt: "", output: "正在读取的内容" }] });
  await screen.findByText("来自真实事件的部分回复");
  expect((await screen.findAllByText("正在读取的内容")).length).toBeGreaterThan(0);
  const approval = { approvalId: "approval", kind: "select" as const, title: "明确的真实审批", message: "只允许当前动作", options: ["Allow this exact action", "拒绝"], expiresAt: new Date(Date.now() + 60000).toISOString() };
  emit({ approvals: [approval] });
  fireEvent.click(await screen.findByRole("button", { name: "Allow this exact action" }));
  await waitFor(() => expect(posts[1]).toEqual({ type: "answerApproval", taskId: "task", approvalId: "approval", value: "Allow this exact action" }));
  expect(screen.queryByText("本次进程已获编程授权")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  await waitFor(() => expect(posts[2]).toEqual({ type: "cancelTask", taskId: "task" }));
  expect(screen.queryByText("已停止")).toBeNull();
  expect((await screen.findByRole("button", { name: "正在停止" }) as HTMLButtonElement).disabled).toBe(true);
  emit({ status: "cancelled", access: "inspect", approvals: [] });
  await screen.findByText("已停止");
});

it("reselecting the current account keeps its models available for an explicit choice", async () => {
  await mount(); await chooseModel();
  fireEvent.click(screen.getByRole("button", { name: "选择账号与模型" }));
  fireEvent.change(await screen.findByLabelText("账号"), { target: { value: "cli-readonly" } });
  expect(screen.getByRole("option", { name: "本地模型" })).toBeTruthy();
  expect((screen.getByLabelText("模型") as HTMLSelectElement).value).toBe("fixture/one");
  expect(posts).toHaveLength(0);
});

it("B2 keeps a new conversation draft when an older submission is accepted late", async () => {
  let resolve!: (value: Response) => void;
  override = (url, init) => url.pathname === "/api/command" ? (posts.push(JSON.parse(String(init?.body))), new Promise(r => { resolve = r; })) : undefined;
  await mount(); await chooseModel();
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "old" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "新的草稿" } });
  await act(async () => resolve(json(task)));
  expect((screen.getByRole("textbox", { name: "回复 Pi" }) as HTMLTextAreaElement).value).toBe("新的草稿");
  expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
  expect(posts).toHaveLength(1);
});

it("B2 preserves an error tool receipt even when the overall task finished successfully", async () => {
  override = url => url.pathname === "/api/history" ? Promise.resolve(json({ messages: [{ id: "failed-entry", role: "toolResult", toolName: "write", text: "只读拒绝写入", isError: true, outputAvailable: true }], nextOffset: null })) : undefined;
  await mount(); fireEvent.click(screen.getByRole("button", { name: /原生会话.*查看历史/ }));
  const receipts = await screen.findAllByRole("button", { name: /write.*执行失败/ });
  fireEvent.click(receipts[0]);
  await screen.findByText("完整的真实工具回执");
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("entryId=failed-entry") && String(url).includes("sessionKey=history-key"))).toBe(true);
  expect(posts).toHaveLength(0);
});

it("a native history tool target opens the current project file without executing a task", async () => {
  override = url => url.pathname === "/api/history" ? Promise.resolve(json({ messages: [{ id: "tool-entry", role: "toolResult", toolName: "edit", toolCallId: "pi-call", filePath: "src/total.mjs", text: "edit receipt" }], nextOffset: null })) : undefined;
  await mount(); fireEvent.click(screen.getByRole("button", { name: /原生会话.*查看历史/ }));
  fireEvent.click(await within(screen.getByRole("region", { name: "对话" })).findByRole("button", { name: "查看文件 src/total.mjs" }));
  await screen.findByLabelText("文件内容 src/total.mjs");
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("projectId=project") && String(url).includes("path=src%2Ftotal.mjs"))).toBe(true);
  expect(posts).toHaveLength(0);
});

it("approval buttons reject expired/disconnected decisions and deduplicate a rapid answer", async () => {
  const approval = { approvalId: "one", kind: "confirm" as const, title: "真实命令", message: "当前任务", expiresAt: new Date(Date.now() - 1000).toISOString() };
  const view = render(<ApprovalDock task={{ ...task, approvals: [approval] }} connected />);
  expect((screen.getByRole("button", { name: "允许本次操作" }) as HTMLButtonElement).disabled).toBe(true);
  const live = { ...task, approvals: [{ ...approval, expiresAt: new Date(Date.now() + 60000).toISOString() }] };
  view.rerender(<ApprovalDock task={live} connected={false} />);
  expect((screen.getByRole("button", { name: "允许本次操作" }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(<ApprovalDock task={live} connected />);
  fireEvent.click(screen.getByRole("button", { name: "允许本次操作" }));
  fireEvent.click(screen.getByRole("button", { name: "允许本次操作" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ type: "answerApproval", taskId: "task", approvalId: "one", value: true });
});

it("a reconciled submission releases its pending POST before another conversation sends", async () => {
  let resolveFirst!: (value: Response) => void;
  let firstTask: HostTask;
  override = (url, init) => {
    if (url.pathname !== "/api/command") return undefined;
    const body = JSON.parse(String(init?.body)); posts.push(body);
    if (posts.length === 1) {
      firstTask = task = { ...task, ...body, status: "succeeded" };
      return new Promise(resolve => { resolveFirst = resolve; });
    }
    return Promise.resolve(json({ ...task, ...body, taskId: "second-task", status: "running" }));
  };
  await mount(); await chooseModel();
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "first" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "核对提交结果" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "核对提交结果" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
  await chooseModel();
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "second" } });
  fireEvent.click(screen.getByRole("button", { name: "发送" }));
  try {
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].prompt).toBe("second");
    expect(posts[1].requestId).not.toBe(posts[0].requestId);
  } finally { await act(async () => resolveFirst(json(firstTask!))); }
});

it("a delayed stop response for one project does not block stopping another project's task", async () => {
  const second = { ...task, taskId: "other-task", projectId: "other-project", sessionId: null };
  let resolveFirst!: (value: Response) => void;
  override = (url, init) => {
    if (url.pathname === "/api/task") return Promise.resolve(json(url.searchParams.get("taskId") === second.taskId ? second : task));
    if (url.pathname !== "/api/command") return undefined;
    const body = JSON.parse(String(init?.body)); posts.push(body);
    return body.taskId === task.taskId ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(json({ ...second, status: "cancelling" }));
  };
  const { result } = renderHook(() => useNativeSession());
  await waitFor(() => expect(Socket.all.length).toBeGreaterThan(0));
  act(() => Socket.all.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "snapshot", ...snapshot, projects: [project, { ...project, projectId: second.projectId, name: "第二个项目" }], tasks: [task, second] }) }));
  act(() => result.current.navigate(project.projectId, task.taskId));
  await waitFor(() => expect(result.current.visibleTask?.taskId).toBe(task.taskId));
  act(() => { void result.current.stop(); });
  await waitFor(() => expect(posts).toHaveLength(1));
  act(() => result.current.navigate(second.projectId, second.taskId));
  await waitFor(() => expect(result.current.visibleTask?.taskId).toBe(second.taskId));
  try {
    await act(async () => result.current.stop());
    expect(posts).toEqual([{ type: "cancelTask", taskId: task.taskId }, { type: "cancelTask", taskId: second.taskId }]);
  } finally { await act(async () => resolveFirst(json({ ...task, status: "cancelled" }))); }
});

it("a rejected supplement preserves its error but fresh empty queue readback unlocks history resume", async () => {
  const inputSnapshot: HostSnapshot = { ...snapshot, capabilities: { ...snapshot.capabilities!, inputs: { protocol: 1, materials: false, resourceRevision: 0 } } };
  let rejected = 0;
  let finishRead!: (value: Response) => void;
  override = (url, init) => {
    if (url.pathname !== "/api/input-command") return undefined;
    const command = JSON.parse(String(init?.body));
    if (command.type !== "getInputs") { rejected++; return Promise.resolve(json({ code: "INPUT_REVISION_CONFLICT" }, 409)); }
    if (rejected) return new Promise(resolve => { finishRead = resolve; });
    const scope = { projectId: "project", sessionId: "session" };
    return Promise.resolve(json({ protocol: 1, admission: "ready", draft: { schemaVersion: 1, kind: "draft", scope, revision: 0, draft: null }, queue: { schemaVersion: 1, kind: "queue", scope, revision: 1, items: [] } }));
  };
  await mount();
  act(() => Socket.all.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "snapshot", ...inputSnapshot }) }));
  await chooseModel(); fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "read project" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1)); emit({ resourceRevision: 0, thinkingLevel: "off" });
  fireEvent.change(screen.getByRole("textbox", { name: "回复 Pi" }), { target: { value: "supplement" } });
  await waitFor(() => expect((screen.getByRole("button", { name: "即时补充" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "即时补充" }));
  await screen.findByText("队列已被其他操作更新，编辑内容已保留。请先核对当前版本。");
  emit({ status: "succeeded" });
  await screen.findByText("原生历史正文");
  expect((screen.getByRole("button", { name: "继续会话" }) as HTMLButtonElement).disabled).toBe(true);
  const scope = { projectId: "project", sessionId: "session" };
  await act(async () => finishRead(json({ protocol: 1, admission: "ready", draft: { schemaVersion: 1, kind: "draft", scope, revision: 0, draft: null }, queue: { schemaVersion: 1, kind: "queue", scope, revision: 1, items: [] } })));
  await waitFor(() => expect((screen.getByRole("button", { name: "继续会话" }) as HTMLButtonElement).disabled).toBe(false));
  screen.getByText("队列已被其他操作更新，编辑内容已保留。请先核对当前版本。");
  expect(rejected).toBe(1); expect(posts).toHaveLength(1);
});
