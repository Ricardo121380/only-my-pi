import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountSettings } from "./AccountSettings";
import type { AccountAction, AccountInput, AccountProbeResult, GuiAccount, StaticProvider } from "../../../packages/accounts/contracts";
import type { TaskSummary } from "../../../packages/host/contracts";

const first: GuiAccount = { accountId: "one", name: "测试账号", providerId: "commandcode", authType: "api_key" };
const config: StaticProvider = { baseUrl: "https://fixture.invalid/v1", api: "openai-responses", models: [
  { id: "deepseek/first", name: "DeepSeek One", contextWindow: 32768, maxTokens: 4096, reasoning: true },
  { id: "deepseek/second", name: "DeepSeek Two", contextWindow: 65536, maxTokens: 8192 },
] };
type Command = AccountInput | { accountId: string; action: AccountAction };
let commands: Command[], accounts: GuiAccount[], probe: AccountProbeResult;
let override: (url: URL, init?: RequestInit) => Promise<Response> | undefined;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  commands = []; accounts = [first]; override = () => undefined;
  probe = { status: "rejected", reason: "authentication", model: "commandcode/deepseek/first" };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://fixture");
    if (init?.method === "POST") commands.push(JSON.parse(String(init.body)));
    const custom = override(url, init); if (custom) return custom;
    if (url.pathname === "/api/accounts" && init?.method !== "POST") return json({ protocol: 1, authentication: "api_key", cliReference: { accountId: "cli-readonly", name: "CLI 只读引用", readOnly: true }, accounts });
    if (url.pathname === "/api/accounts") { const account = { ...commands.at(-1), accountId: "created" } as GuiAccount; accounts.push(account); return json({ account }, 201); }
    if (url.pathname === "/api/models") return json({ models: config.models.map(m => ({ id: `commandcode/${m.id}`, name: m.name, provider: "commandcode", thinkingLevels: m.reasoning ? ["low", "max"] : [] })) });
    if (url.pathname === "/api/account-action") {
      const action = (commands.at(-1) as { action: AccountAction }).action;
      if (action.type === "configuration") return json({ config });
      if (action.type === "status") return json({ status: "stored" });
      if (action.type === "probe") return json(probe);
      return json({ status: action.type === "apiKey" ? "stored" : "configured" });
    }
    throw new Error(url.pathname);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function actions(type: string) { return commands.filter(c => "action" in c && c.action.type === type) as { accountId: string; action: AccountAction }[]; }
async function mount(tasks: TaskSummary[] = []) {
  const view = render(<AccountSettings connected tasks={tasks} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /测试账号/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "查询凭据状态" }) as HTMLButtonElement).disabled).toBe(false));
  return view;
}

it("loads all configured models and preserves them when saving an endpoint change", async () => {
  await mount();
  expect(actions("probe")).toHaveLength(0);
  fireEvent.click(screen.getByText("服务地址与模型配置"));
  expect((screen.getByLabelText("模型 ID 2") as HTMLInputElement).value).toBe("deepseek/second");
  fireEvent.change(screen.getByLabelText("服务地址"), { target: { value: "https://changed.invalid/v1" } });
  fireEvent.click(screen.getByRole("button", { name: "保存模型配置" }));
  await waitFor(() => expect(actions("configure")).toHaveLength(1));
  expect(actions("configure")[0]).toEqual({ accountId: "one", action: { type: "configure", config: { ...config, baseUrl: "https://changed.invalid/v1" } } });
  expect(actions("probe")).toHaveLength(0);
});

it("clears submitted API keys even when saving has an unknown outcome", async () => {
  await mount();
  override = (_url, init) => init?.body && JSON.parse(String(init.body)).action?.type === "apiKey" ? Promise.reject(new TypeError("Failed to fetch")) : undefined;
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-only-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));
  await screen.findByText(/保存结果尚未确认，密钥输入已清空/);
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect(actions("apiKey")).toHaveLength(1);
  expect(actions("probe")).toHaveLength(0);
});

it("probes only after an explicit click and shows upstream auth failure without switching accounts", async () => {
  await mount();
  fireEvent.change(screen.getByLabelText("测试模型"), { target: { value: "commandcode/deepseek/first" } });
  fireEvent.change(screen.getByLabelText("测试思考强度"), { target: { value: "low" } });
  expect(actions("probe")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "发送连接测试" }));
  await screen.findByText(/服务拒绝了此账号.*401\/403/);
  expect(actions("probe")).toEqual([{ accountId: "one", action: { type: "probe", model: "commandcode/deepseek/first", thinkingLevel: "low" } }]);
  expect(commands.some(c => "type" in c && c.type === "startTask")).toBe(false);
});

it("keeps uncertain account creation blocked until the user explicitly reconciles the list", async () => {
  render(<AccountSettings connected tasks={[]} onChanged={vi.fn()} />);
  await screen.findByRole("button", { name: /测试账号/ });
  fireEvent.click(screen.getByText("添加 API Key 账号"));
  fireEvent.change(screen.getByLabelText("服务商标识"), { target: { value: "commandcode" } });
  fireEvent.change(screen.getByLabelText("账号名称"), { target: { value: "新测试账号" } });
  override = (url, init) => url.pathname === "/api/accounts" && init?.method === "POST" ? Promise.reject(new TypeError("Failed to fetch")) : undefined;
  fireEvent.click(screen.getByRole("button", { name: "添加账号" }));
  await screen.findByText(/创建结果未确认/);
  expect(screen.getByRole("button", { name: "添加账号" }).matches(":disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "刷新账号列表" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "刷新账号列表" }) as HTMLButtonElement).disabled).toBe(false));
  expect(commands.filter(c => !("accountId" in c))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "已核对列表，继续创建" }));
  expect(screen.getByRole("button", { name: "添加账号" }).matches(":disabled")).toBe(false);
});

it("locks account changes while a real task holds the account", async () => {
  const task: TaskSummary = { taskId: "task", requestId: "request", projectId: "project", accountId: "one", prompt: "read", model: "commandcode/deepseek/first", status: "running", sessionId: "session", createdAt: "", updatedAt: "" };
  render(<AccountSettings connected tasks={[task]} onChanged={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /测试账号/ }));
  await screen.findByText(/此账号正在执行任务/);
  expect((screen.getByRole("button", { name: "保存凭据" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "发送连接测试" }) as HTMLButtonElement).disabled).toBe(true);
  expect(actions("probe")).toHaveLength(0);
});
