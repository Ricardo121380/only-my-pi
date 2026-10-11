import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Accounts } from "./Accounts";
import { ClassifierPanel } from "./ClassifierPanel";
import { ImageResults } from "./ImageResults";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const account = { accountId: "image", name: "生图账号", providerId: "native", authType: "api_key" };
it("configures the native image protocol in account management without granting task permission", async () => {
  const writes: { action: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    if (init?.body) { writes.push(JSON.parse(init.body)); return new Response(JSON.stringify({ status: "configured" })); }
    return new Response(JSON.stringify({ cliReference: { name: "CLI" }, accounts: [account] }));
  }));
  render(<Accounts />); fireEvent.click(await screen.findByText("生图账号 · native"));
  fireEvent.click(screen.getByText("自定义静态 Provider"));
  fireEvent.change(screen.getByLabelText("API 协议"), { target: { value: "openrouter-images" } });
  fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://example.invalid/v1" } });
  fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "draw" } });
  fireEvent.click(screen.getByText("保存静态配置"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0].action).toMatchObject({ type: "configure", config: { api: "openrouter-images", models: [{ type: "image", input: ["text"], output: ["image", "text"] }] } });
  expect(screen.queryByLabelText("最大输出 token")).toBeNull();
});
it("selects image models independently and saves bounded image and storage quotas", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.body) { const input = JSON.parse(init.body); writes.push(input); return new Response(JSON.stringify({ revision: 1, image: input.image })); }
    return new Response(JSON.stringify(String(url).startsWith("/api/accounts") ? { cliReference: { accountId: "cli-readonly", name: "CLI" }, accounts: [account] } : String(url).startsWith("/api/models") ? { models: [{ id: "native/draw", name: "Draw", supported: true, price: null }] } : { config: { revision: 0, classifier: null }, tasks: [] }));
  }));
  render(<ClassifierPanel kind="image" projectId="p" projectName="Project" onClose={() => {}} />);
  await screen.findByLabelText("生图账号"); expect((screen.getByLabelText("生图账号") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("生图账号"), { target: { value: "image" } }); await screen.findByRole("option", { name: "Draw · native/draw" });
  fireEvent.change(screen.getByLabelText("生图模型"), { target: { value: "native/draw" } }); fireEvent.click(screen.getByText("保存项目生图配置"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ type: "save", projectId: "p", revision: 0, image: { accountId: "image", model: "native/draw", budget: { maxImagesPerRequest: 1, images: 4, maxStorageBytes: 1048576, storageBytes: 4194304 } } });
});
it("shows remote completion, local save failure and partial usage separately with read-only refresh", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ config: { revision: 1 }, tasks: [{ taskId: "t", snapshot: { revision: 1, image: { accountId: "image", model: "native/draw", budget: { requests: 4, concurrency: 1, images: 4, storageBytes: 4194304 } } }, requests: [{ kind: "image", requestId: "stable", parentToolCallId: "parent", status: "completed", error: "IMAGE_DISK_FULL", reservation: { images: 1, storageBytes: 1048576 }, storage: { status: "failed", bytes: 0, artifacts: [] }, usage: { tokens: null, coverage: { input: 12, output: null }, estimatedCost: null } }] }] })));
  vi.stubGlobal("fetch", fetch); render(<ImageResults projectId="p" taskId="t" />);
  await screen.findByText("Provider 生图请求已完成"); expect(screen.getByText(/本地保存失败/)).toBeTruthy(); expect(screen.getByText(/部分回报：输入 12 · 输出 未知/)).toBeTruthy();
  fireEvent.click(screen.getByText("核对生图账本")); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls.every((call: unknown[]) => !((call[1] as RequestInit)?.body))).toBe(true); expect(screen.queryByText("重新生成")).toBeNull();
});
