import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostCommand, HostSnapshot, HostTask, Session } from "../../packages/host/contracts";
import { App } from "./App";

// Keep App, useHost, Composer and ProductSettings real. Unrelated panels have
// their own suites; this fixture controls only HTTP/WS, never a real Provider.
vi.mock("./Inspector", () => ({ Inspector: () => null }));
vi.mock("./TaskControl", () => ({ TaskControl: () => null }));
vi.mock("./SettingsQueue", () => ({ SettingsQueue: () => null }));
vi.mock("./HistoryImages", () => ({ HistoryImages: () => null }));
vi.mock("./ImageResults", () => ({ ImageResults: () => null }));
vi.mock("./ClassifierPanel", async (original) => ({ ...await original<object>(), ClassificationResults: () => null }));

const projects = ["Alpha", "Beta"].map(name => ({ projectId: name, name, path: `/fixture/${name}`, available: true }));
const sessions: Session[] = ["A", "B"].map(name => ({ sessionKey: `key-${name}`, sessionId: `session-${name}`, projectId: "Alpha", timestamp: "", name: `历史 ${name}`, readOnly: true }));
const task: HostTask = { taskId: "task", requestId: "initial", projectId: "Alpha", accountId: "account-a", model: "fixture/one", prompt: "已有任务", status: "succeeded", sessionId: "task-session", createdAt: "", updatedAt: "", messages: [{ id: "live", role: "assistant", text: "任务正文" }] };
const snapshot: HostSnapshot = { protocol: 2, version: "phase2-v1", epoch: "fixture", seq: 1, indexing: false, runtime: { stackId: "fixture", sourceCommit: null }, projects, tasks: [task], diagnostics: [] };
const directory = { cliReference: { accountId: "cli-readonly", name: "CLI 配置" }, accounts: ["a", "b"].map(id => ({ accountId: `account-${id}`, name: `账号 ${id}`, providerId: "fixture", authType: "api_key" })) };
const models = [{ id: "fixture/one", name: "模型一", provider: "fixture", thinkingLevels: ["off", "low", "high"] }, { id: "fixture/two", name: "模型二", provider: "fixture", thinkingLevels: ["off", "low", "high"] }];
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  close() {}
  constructor() { Socket.instances.push(this); }
}
type Start = Extract<HostCommand, { type: "startTask" }>;
let commands: Start[], settingsReads: { body: { type: string; projectId?: string }; signal?: AbortSignal | null }[];
let route: (url: URL, init?: RequestInit) => Promise<Response> | undefined;
beforeEach(() => {
  sessionStorage.removeItem("omp.selectedTask"); Socket.instances = []; commands = []; settingsReads = []; route = () => undefined;
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("innerWidth", 1280);
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://fixture");
    const override = route(url, init); if (override) return override;
    if (url.pathname === "/api/state") return json(snapshot);
    if (url.pathname === "/api/task") return json(task);
    if (url.pathname === "/api/accounts") return json(directory);
    if (url.pathname === "/api/models") return json({ models });
    if (url.pathname === "/api/sessions") return json({ sessions: url.searchParams.get("projectId") === "Alpha" ? sessions : [] });
    if (url.pathname === "/api/history") return json({ messages: [{ id: "history", role: "assistant", text: `${url.searchParams.get("sessionKey")} 第 ${url.searchParams.get("offset")} 条` }], nextOffset: 50 });
    if (url.pathname === "/api/settings") {
      settingsReads.push({ body: JSON.parse(String(init?.body)), signal: init?.signal });
      return json({ revision: 1, resources: [], pending: true, lastLoaded: null, lastFailure: null });
    }
    if (url.pathname === "/api/command") { commands.push(JSON.parse(String(init?.body))); return json({ code: "OWNERSHIP_HELD" }, 409); }
    throw new Error(`Unexpected fixture route: ${url.pathname}`);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.removeItem("omp.selectedTask"); });
async function mount() {
  render(<App />);
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  act(() => Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: "snapshot", ...snapshot }) }));
  await screen.findByRole("option", { name: "账号 a · fixture" });
  await historyButton("A");
}
const historyButton = (name: string) => screen.findByRole("button", { name: new RegExp(`^历史 ${name}\\s*只读历史$`) });
function selectAccount(id = "a") { fireEvent.change(screen.getByLabelText("运行账号"), { target: { value: `account-${id}` } }); }
async function readyAccount() { selectAccount(); await waitFor(() => expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型一")); }
async function sendFailure() {
  const count = commands.length;
  fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
  await waitFor(() => { expect(commands).toHaveLength(count + 1); expect((screen.getByRole("button", { name: "开始分析" }) as HTMLButtonElement).disabled).toBe(false); });
}

it.each(["history", "task", "fresh", "project"] as const)("a delayed submission cannot take over later %s navigation or its draft", async destination => {
  const response = deferred<Response>();
  const created = { ...task, taskId: "created", prompt: "已提交的问题" };
  let signal: AbortSignal | null | undefined;
  route = (url, init) => {
    if (url.pathname === "/api/command") { commands.push(JSON.parse(String(init?.body))); signal = init?.signal; return response.promise; }
    if (url.pathname === "/api/task" && url.searchParams.get("taskId") === created.taskId) return Promise.resolve(json(created));
  };
  await mount(); await readyAccount();
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: created.prompt } });
  fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
  await waitFor(() => expect(commands).toHaveLength(1));
  if (destination === "history") { fireEvent.click(await historyButton("B")); await screen.findByText("key-B 第 0 条"); }
  else if (destination === "task") { fireEvent.click(screen.getByRole("button", { name: /^已有任务\s*已完成$/ })); await screen.findByText("任务正文"); }
  else if (destination === "fresh") fireEvent.click(screen.getByRole("button", { name: "新建会话" }));
  else fireEvent.click(screen.getByTitle("/fixture/Beta"));
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "后来编辑的草稿" } });
  // Host owns the created task independently of the submission response/view.
  act(() => Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: "task", epoch: snapshot.epoch, seq: 2, data: created }) }));
  await act(async () => response.resolve(json(created)));
  const expected = { history: "历史 B", task: "已有任务", fresh: "Alpha", project: "Beta" }[destination];
  expect(document.querySelector(".main-title")?.textContent).toBe(expected);
  expect(sessionStorage.getItem("omp.selectedTask")).toBe(destination === "task" ? task.taskId : null);
  expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe("后来编辑的草稿");
  expect(signal?.aborted).not.toBe(true); expect(commands).toHaveLength(1);
  if (destination === "project") fireEvent.click(screen.getByTitle("/fixture/Alpha"));
  fireEvent.click(screen.getByRole("button", { name: /^已提交的问题\s*已完成$/ }));
  await waitFor(() => expect(document.querySelector(".main-title")?.textContent).toBe(created.prompt));
});

it.each(["success", "failure"] as const)("an old submission's %s cannot erase a newer project's retry identity or error", async ending => {
  const old = deferred<Response>();
  route = (url, init) => {
    if (url.pathname !== "/api/command") return;
    const command = JSON.parse(String(init?.body)) as Start; commands.push(command);
    return command.projectId === "Alpha" ? old.promise : Promise.resolve(json({ code: "OWNERSHIP_HELD" }, 409));
  };
  await mount(); await readyAccount();
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "Alpha 提交" } });
  fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
  await waitFor(() => expect(commands).toHaveLength(1));
  fireEvent.click(screen.getByTitle("/fixture/Beta"));
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "Beta 重试" } });
  await sendFailure();
  const error = screen.getByRole("alert").textContent;
  await act(async () => old.resolve(ending === "success" ? json({ ...task, taskId: "old", prompt: "Alpha 提交" }) : json({ code: "ACCOUNT_BUSY" }, 409)));
  expect(document.querySelector(".main-title")?.textContent).toBe("Beta");
  expect(screen.getByRole("alert").textContent).toBe(error);
  await sendFailure();
  expect(commands[2]).toEqual(commands[1]); expect(commands).toHaveLength(3);
});

it("an old failed submission does not report an error in a newly selected history", async () => {
  const old = deferred<Response>();
  route = url => url.pathname === "/api/command" ? old.promise : undefined;
  await mount(); await readyAccount();
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "未确认的问题" } });
  fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
  fireEvent.click(await historyButton("B")); await screen.findByText("key-B 第 0 条");
  await act(async () => old.reject(new Error("OLD_SUBMISSION_FAILED")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe("未确认的问题");
});

it("a current successful submission selects its task, clears only its submitted draft and retires its request ID", async () => {
  const created = { ...task, taskId: "created", prompt: "正常提交" };
  route = (url, init) => {
    if (url.pathname === "/api/command") { commands.push(JSON.parse(String(init?.body))); return Promise.resolve(json(created)); }
    if (url.pathname === "/api/task") return Promise.resolve(json(created));
  };
  await mount(); await readyAccount();
  for (let i = 1; i <= 2; i++) {
    fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: created.prompt } });
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
    await waitFor(() => { expect(commands).toHaveLength(i); expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe(""); });
    expect(document.querySelector(".main-title")?.textContent).toBe(created.prompt);
    expect(sessionStorage.getItem("omp.selectedTask")).toBe(created.taskId);
  }
  expect(commands[1].requestId).not.toBe(commands[0].requestId);
});

it.each(["resolve", "reject"] as const)("ignores an old account's delayed model %s without replacing the new models or error", async ending => {
  const old = deferred<Response>();
  route = url => url.pathname === "/api/models" && url.searchParams.get("accountId") === "account-a" ? old.promise : undefined;
  await mount();
  expect((screen.getByLabelText("运行账号") as HTMLSelectElement).value).toBe("");
  selectAccount(); selectAccount("b");
  await waitFor(() => expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型一"));
  await act(async () => { if (ending === "resolve") old.resolve(json({ models: [{ id: "stale/model", name: "过期模型", provider: "stale" }] })); else old.reject(new Error("STALE_MODELS")); });
  expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型一");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("separates viewing history from explicit resume and keeps request identity only for identical failed commands", async () => {
  await mount(); await readyAccount(); fireEvent.click(await historyButton("A"));
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "保留问题" } });
  await sendFailure(); await sendFailure();
  expect(commands[0]).toEqual(commands[1]); expect(commands[0].resumeSessionKey).toBeUndefined();
  expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe("保留问题");
  fireEvent.click(screen.getByRole("button", { name: "续接此会话" })); await sendFailure();
  expect(commands[2].resumeSessionKey).toBe("key-A"); expect(commands[2].requestId).not.toBe(commands[1].requestId);
  fireEvent.click(await historyButton("B")); await sendFailure();
  expect(commands[3].resumeSessionKey).toBeUndefined(); expect(commands[3].requestId).not.toBe(commands[2].requestId);
  selectAccount("b"); await waitFor(() => expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型一")); await sendFailure();
  expect(commands[4].accountId).toBe("account-b"); expect(commands[4].requestId).not.toBe(commands[3].requestId);
});

it("aborts old history pages and ignores their late writes after opening another session", async () => {
  const old = deferred<Response>(); let signal: AbortSignal | null | undefined;
  route = (url, init) => { if (url.pathname === "/api/history" && url.searchParams.get("offset") === "50") { signal = init?.signal; return old.promise; } };
  await mount(); fireEvent.click(await historyButton("A")); await screen.findByText("key-A 第 0 条");
  fireEvent.click(screen.getByRole("button", { name: "下一页" })); await screen.findByText("正在读取历史…");
  fireEvent.click(await historyButton("B")); await screen.findByText("key-B 第 0 条");
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(json({ messages: [{ id: "old", role: "assistant", text: "过期历史" }], nextOffset: null })));
  expect(screen.queryByText("过期历史")).toBeNull(); expect(screen.getByText("只读历史 · 第 1 页")).toBeTruthy();
});

it("leaving an in-flight history request does not hide the selected task behind history loading", async () => {
  const old = deferred<Response>(); let signal: AbortSignal | null | undefined;
  route = (url, init) => { if (url.pathname === "/api/history") { signal = init?.signal; return old.promise; } };
  await mount(); fireEvent.click(await historyButton("A")); await screen.findByText("正在读取历史…");
  fireEvent.click(screen.getByRole("button", { name: /^已有任务\s*已完成$/ }));
  await screen.findByText("任务正文"); expect(screen.queryByText("正在读取历史…")).toBeNull(); expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(json({ messages: [], nextOffset: null })));
  expect(screen.getByText("任务正文")).toBeTruthy();
});

it("reselecting the current project retains its complete history list", async () => {
  await mount(); fireEvent.click(screen.getByTitle("/fixture/Alpha"));
  expect(await historyButton("A")).toBeTruthy(); expect(await historyButton("B")).toBeTruthy();
});

it("settings close/reopen preserves the Composer draft and selection but resets its own scope; project change resets draft and thinking only", async () => {
  await mount(); await readyAccount();
  fireEvent.click(screen.getByRole("button", { name: "选择模型" })); fireEvent.click(screen.getByRole("button", { name: /模型二/ }));
  fireEvent.click(screen.getByRole("button", { name: "选择思考强度" })); fireEvent.click(screen.getByRole("button", { name: "高 · high" }));
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "编辑中的草稿" } });
  fireEvent.click(screen.getByRole("button", { name: "产品工具与技能" }));
  await waitFor(() => expect(settingsReads).toHaveLength(1)); expect(settingsReads[0].body.projectId).toBe("Alpha");
  fireEvent.change(screen.getByLabelText("产品设置范围"), { target: { value: "default" } });
  await waitFor(() => expect(settingsReads).toHaveLength(2)); expect(settingsReads[0].signal?.aborted).toBe(true); expect(settingsReads[1].body.projectId).toBeUndefined();
  fireEvent(screen.getByRole("dialog", { name: "产品工具与技能设置" }), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(settingsReads[1].signal?.aborted).toBe(true);
  expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe("编辑中的草稿");
  fireEvent.click(screen.getByRole("button", { name: "产品工具与技能" }));
  await waitFor(() => expect(settingsReads).toHaveLength(3)); expect(settingsReads[2].body.projectId).toBe("Alpha");
  fireEvent.click(within(screen.getByRole("dialog", { name: "产品工具与技能设置" })).getByRole("button", { name: "关闭对话框" }));
  expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型二");
  expect(screen.getByRole("button", { name: "选择思考强度" }).textContent).toContain("高");
  fireEvent.click(screen.getByTitle("/fixture/Beta"));
  expect((screen.getByLabelText("新的只读分析") as HTMLTextAreaElement).value).toBe("");
  expect(screen.getByRole("button", { name: "选择模型" }).textContent).toContain("模型二");
  expect(screen.getByRole("button", { name: "选择思考强度" }).textContent).toBe("默认强度");
  expect(Socket.instances).toHaveLength(1);
});
