import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostSnapshot, HostTask } from "../../packages/host/contracts";
import { MinimalApp } from "./MinimalApp";
import { MinimalComposer } from "./MinimalComposer";
const project = { projectId: "project", name: "Project", path: "/fixture", available: true };
const session = { sessionKey: "key", sessionId: "session", projectId: project.projectId, name: "原生会话", timestamp: "", readOnly: true };
const task: HostTask = { taskId: "task", requestId: "request", projectId: project.projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "first", status: "running", sessionId: "session", createdAt: "", updatedAt: "", messages: [] };
const snapshot: HostSnapshot = { protocol: 2, version: "phase2-v1", epoch: "fixture", seq: 1, indexing: false, runtime: { stackId: "fixture", sourceCommit: null }, capabilities: { minimal: true, controlled: true }, projects: [project], tasks: [], diagnostics: [] };
const accounts = { protocol: 1 as const, authentication: "api_key" as const, cliReference: { accountId: "cli-readonly" as const, name: "CLI 配置", readOnly: true as const }, accounts: [] };
const models = [{ id: "fixture/one", name: "本地模型", provider: "fixture" }];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
class Socket { static all: Socket[] = []; onmessage?: (e: { data: string }) => void; close() {} constructor() { Socket.all.push(this); } }
let posts: unknown[], route: (url: URL, init?: RequestInit) => Promise<Response> | undefined;
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); Socket.all = []; posts = []; route = () => undefined;
  vi.stubGlobal("WebSocket", Socket);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://fixture"); const override = route(url, init); if (override) return override;
    if (url.pathname === "/api/state") return json(snapshot);
    if (url.pathname === "/api/accounts") return json(accounts);
    if (url.pathname === "/api/models") return json({ models });
    if (url.pathname === "/api/sessions") return json({ sessions: [session] });
    if (url.pathname === "/api/history") return json({ messages: [{ id: "message", role: "assistant", text: "原生历史正文" }], nextOffset: null });
    if (url.pathname === "/api/task") return json(task);
    if (url.pathname === "/api/command") { posts.push(JSON.parse(String(init?.body))); return json(task); }
    throw new Error(url.pathname);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function mount() { const view = render(<MinimalApp />); await waitFor(() => expect(Socket.all.length).toBeGreaterThan(0)); act(() => Socket.all.at(-1)?.onmessage?.({ data: JSON.stringify({ type: "snapshot", ...snapshot }) })); await screen.findByRole("option", { name: "CLI 配置" }); return view; }
async function chooseModel() { fireEvent.change(screen.getByLabelText("账号"), { target: { value: "cli-readonly" } }); await screen.findByRole("option", { name: "本地模型" }); fireEvent.change(screen.getByLabelText("模型"), { target: { value: "fixture/one" } }); }
it("requires explicit model choice and explicit resume; reading/restoring history does not POST", async () => {
  await mount(); fireEvent.click(await screen.findByRole("button", { name: /原生会话\s*查看历史/ })); await screen.findByText("原生历史正文");
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: "cli-readonly" } }); await screen.findByRole("option", { name: "本地模型" });
  fireEvent.change(screen.getByLabelText("消息"), { target: { value: "continue" } });
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("模型"), { target: { value: "fixture/one" } });
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "继续会话" })); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1)); expect(posts[0]).toMatchObject({ resumeSessionKey: "key", prompt: "continue", mode: "readonly" });
});
it("reload after lost POST acknowledgement looks up the saved request without replay", async () => {
  route = (url, init) => { if (url.pathname === "/api/command") { posts.push(JSON.parse(String(init?.body))); return Promise.reject(new Error("lost")); } };
  const view = await mount(); await chooseModel(); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "hello" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "核对提交结果" }); expect(posts).toHaveLength(1); const saved = JSON.parse(sessionStorage.getItem("omp.minimal.submission.v1")!);
  expect(saved.prompt).toBe("hello"); view.unmount(); Socket.all = []; await mount();
  await waitFor(() => expect(sessionStorage.getItem("omp.minimal.submission.v1")).toBeNull()); expect(posts).toHaveLength(1);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes(`requestId=${saved.requestId}`))).toBe(true);
});
it("late acceptance cannot replace a new conversation or its draft", async () => {
  let resolve!: (value: Response) => void;
  route = (url, init) => { if (url.pathname === "/api/command") { posts.push(JSON.parse(String(init?.body))); return new Promise(r => { resolve = r; }); } };
  await mount(); await chooseModel(); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "old" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  fireEvent.click(screen.getByRole("button", { name: "新建会话" })); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "new draft" } });
  await act(async () => resolve(json(task))); expect((screen.getByLabelText("消息") as HTMLTextAreaElement).value).toBe("new draft"); expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
});
it("IME composition and rapid clicks cannot double send; newer draft survives delayed ACK", async () => {
  let resolve!: () => void; const send = vi.fn(() => new Promise<void>(r => { resolve = r; }));
  render(<MinimalComposer accounts={accounts} accountId="cli-readonly" models={models} model="fixture/one" onAccount={() => {}} onModel={() => {}} onSend={send} onCancel={() => {}} disabled={false} running={false} cancelling={false} controlled />);
  const input = screen.getByLabelText("消息"); fireEvent.change(input, { target: { value: "中文" } }); fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true, isComposing: true }); expect(send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); fireEvent.click(screen.getByRole("button", { name: "正在提交…" })); expect(send).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "新草稿" } }); await act(async () => resolve()); expect((input as HTMLTextAreaElement).value).toBe("新草稿");
});
it("reconnection reconciliation does not steal navigation or a newer draft", async () => {
  let accepted = false;
  route = (url, init) => {
    if (url.pathname === "/api/command") { posts.push(JSON.parse(String(init?.body))); return Promise.reject(new Error("lost")); }
    if (url.pathname === "/api/task") return accepted ? Promise.resolve(json(task)) : Promise.resolve(json({ code: "TASK_NOT_FOUND" }, 404));
  };
  await mount(); await chooseModel(); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "old" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "核对提交结果" });
  fireEvent.click(screen.getByRole("button", { name: "新建会话" })); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "new draft" } });
  accepted = true; fireEvent.click(screen.getByRole("button", { name: "核对提交结果" }));
  await waitFor(() => expect(sessionStorage.getItem("omp.minimal.submission.v1")).toBeNull());
  expect((screen.getByLabelText("消息") as HTMLTextAreaElement).value).toBe("new draft"); expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
});
it.each([false, true])("reconciled acknowledgement clears only the submitted draft (edited=%s)", async edited => {
  route = (url, init) => { if (url.pathname === "/api/command") { posts.push(JSON.parse(String(init?.body))); return Promise.reject(new Error("lost")); } };
  await mount(); await chooseModel(); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "old" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await screen.findByRole("button", { name: "核对提交结果" });
  if (edited) fireEvent.change(screen.getByLabelText("消息"), { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "核对提交结果" })); await waitFor(() => expect(sessionStorage.getItem("omp.minimal.submission.v1")).toBeNull());
  await waitFor(() => expect((screen.getByLabelText("消息") as HTMLTextAreaElement).value).toBe(edited ? "new" : ""));
});
it("loading a selected task cannot silently start a new session", async () => {
  sessionStorage.setItem("omp.minimal.selection.v1", JSON.stringify({ projectId: "project", taskId: "task" }));
  route = url => url.pathname === "/api/task" ? new Promise(() => {}) : undefined;
  await mount(); await chooseModel(); fireEvent.change(screen.getByLabelText("消息"), { target: { value: "duplicate" } });
  expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(screen.getByLabelText("消息"), { key: "Enter", ctrlKey: true }); expect(posts).toHaveLength(0);
});
it("starter cards append to an existing draft without submitting or losing focus", async () => {
  await mount(); await chooseModel(); const input = screen.getByLabelText("消息") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "保留草稿" } });
  fireEvent.click(screen.getByRole("button", { name: /读懂这个项目/ }));
  expect(input.value).toBe("保留草稿\n\n请阅读这个项目，介绍目录结构、核心模块和主要入口。");
  expect(document.activeElement).toBe(input); expect(posts).toHaveLength(0);
});
it("appearance and sidebar changes preserve the composer node and draft", async () => {
  await mount(); const input = screen.getByLabelText("消息") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "保留输入" } });
  fireEvent.click(screen.getByRole("button", { name: "界面设置" }));
  fireEvent.change(screen.getByLabelText("外观"), { target: { value: "dark" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(JSON.parse(localStorage.getItem("omp.minimal.appearance.v1")!)).toEqual({ theme: "dark", reduceMotion: true });
  fireEvent.click(screen.getByRole("button", { name: "关闭对话框" }));
  fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
  expect(screen.getByLabelText("消息")).toBe(input); expect(input.value).toBe("保留输入"); expect(posts).toHaveLength(0);
});
it("uses only supported thinking choices and resets the choice when switching models", async () => {
  route = url => url.pathname === "/api/models" ? Promise.resolve(json({ models: [
    { ...models[0], thinkingLevels: ["off", "high"] }, { id: "fixture/two", name: "另一个模型", provider: "fixture" },
  ] })) : undefined;
  await mount(); await chooseModel();
  fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "high" } });
  fireEvent.change(screen.getByLabelText("模型"), { target: { value: "fixture/two" } });
  expect(screen.queryByLabelText("推理强度")).toBeNull();
  fireEvent.change(screen.getByLabelText("模型"), { target: { value: "fixture/one" } });
  expect((screen.getByLabelText("推理强度") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("推理强度"), { target: { value: "high" } });
  fireEvent.change(screen.getByLabelText("消息"), { target: { value: "think" } }); fireEvent.click(screen.getByRole("button", { name: "发送" }));
  await waitFor(() => expect(posts).toHaveLength(1)); expect(posts[0]).toMatchObject({ thinkingLevel: "high", model: "fixture/one", mode: "readonly" });
});
it("defers suggestions until IME ends and applies each suggestion once", async () => {
  const send = vi.fn(async () => {});
  const props = { accounts, accountId: "cli-readonly", models, model: "fixture/one", onAccount() {}, onModel() {}, onSend: send, onCancel() {}, disabled: false, running: false, cancelling: false, controlled: true };
  const view = render(<MinimalComposer {...props} />); const input = screen.getByLabelText("消息") as HTMLTextAreaElement;
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: "输入中" } });
  const suggestion = { id: "one", text: "建议" };
  view.rerender(<MinimalComposer {...props} suggestion={suggestion} />); expect(input.value).toBe("输入中");
  fireEvent.compositionEnd(input); expect(input.value).toBe("输入中\n\n建议");
  view.rerender(<MinimalComposer {...props} suggestion={{ ...suggestion }} />); expect(input.value).toBe("输入中\n\n建议"); expect(send).not.toHaveBeenCalled();
});
