import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Accounts } from "./Accounts";
import { OAuthLogin } from "./OAuthLogin";
import { HostDialog } from "./HostDialog";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const account = { accountId: "fixture-account", providerId: "fixture", name: "Fixture", authType: "api_key" };
const directory = { protocol: 1, authentication: "api_key", cliReference: { accountId: "cli-readonly", name: "CLI 配置（只读引用）", readOnly: true }, accounts: [account] };
it("clears submitted secrets on failure, reports busy, and requires explicit deletion confirmation", async () => {
  const actions: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (!options?.body) return new Response(JSON.stringify(directory));
    const input = JSON.parse(options.body); actions.push(input.action);
    if (input.action.type === "apiKey") return new Response(JSON.stringify({ code: "ACCOUNT_BUSY" }), { status: 409 });
    return new Response(JSON.stringify({ status: "removed" }));
  }));
  render(<Accounts />);
  fireEvent.click(await screen.findByRole("button", { name: "Fixture · fixture" }));
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "fixture-secret" } });
  fireEvent.click(screen.getByRole("button", { name: "保存凭据" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("正在被任务"));
  expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
  expect(document.body.textContent).not.toContain("fixture-secret");
  expect(localStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "删除账号…" }));
  expect(actions).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "保留账号" }));
  expect(actions).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "删除账号…" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除账号" }));
  await waitFor(() => expect(actions).toHaveLength(2));
  expect(actions[1]).toEqual({ type: "remove" });
});

it("shows directory failure and retries without guessing a default account", async () => {
  let count = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ++count === 1 ? new Response(JSON.stringify({ code: "ACCOUNT_STORE_INVALID" }), { status: 500 }) : new Response(JSON.stringify({ ...directory, accounts: [] }))));
  render(<Accounts />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "刷新账号" }));
  await screen.findByText(/还没有产品账号/);
  expect(screen.queryByLabelText("API Key")).toBeNull();
});

it("logout reports credential removal without claiming the account was deleted", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => new Response(JSON.stringify(options?.body ? { status: "missing" } : directory))));
  render(<Accounts />);
  fireEvent.click(await screen.findByRole("button", { name: "Fixture · fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "登出账号" }));
  await screen.findByText("已登出，账号保留，私有凭据已移除。");
  expect(screen.getByRole("button", { name: "Fixture · fixture" })).toBeTruthy();
});

it("OAuth submits bound one-time input and clears it on cancellation", async () => {
  const initial = { flowId: "flow", accountId: "account", status: "awaiting_input", prompt: { promptId: "prompt", type: "manual_code" }, event: { type: "auth_url", url: "https://example.invalid/login" } };
  let state = initial; const actions: { type: string; flowId?: string; promptId?: string; value?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.body) {
      const { action } = JSON.parse(options.body); actions.push(action);
      if (action.type === "oauthAnswer") state = { ...initial, status: "waiting" };
      if (action.type === "oauthCancel") state = { ...initial, status: "cancelled" };
    }
    return new Response(JSON.stringify(state));
  }));
  render(<OAuthLogin accountId="account" />);
  fireEvent.click(screen.getByRole("button", { name: "开始 OAuth 登录" }));
  const input = await screen.findByLabelText("授权码或回调地址");
  fireEvent.change(input, { target: { value: "fixture-onetime-code" } });
  fireEvent.click(screen.getByRole("button", { name: "提交认证输入" }));
  await waitFor(() => expect(actions).toContainEqual({ type: "oauthAnswer", flowId: "flow", promptId: "prompt", value: "fixture-onetime-code" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "取消认证" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "取消认证" }));
  await screen.findByText("认证已取消");
  expect(document.body.textContent).not.toContain("fixture-onetime-code");
});

it("modal is outside hidden responsive ancestors and restores focus to a visible fallback", () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { rerender, container } = render(<><main><button>导航</button></main><aside hidden><HostDialog open title="账号" onClose={() => {}}>账号内容</HostDialog></aside></>);
  const dialog = screen.getByRole("dialog", { name: "账号" });
  expect(dialog.parentElement).toBe(document.body);
  expect(container.querySelector("aside dialog")).toBeNull();
  rerender(<><main><button>导航</button></main><aside hidden><HostDialog open={false} title="账号" onClose={() => {}}>账号内容</HostDialog></aside></>);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "导航" }));
});
