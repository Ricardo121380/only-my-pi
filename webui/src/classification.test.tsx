import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ClassifierPanel, ClassificationResults } from "./ClassifierPanel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const budget = { requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 8192, inputBytes: 32768, outputBytes: 32768, timeoutMs: 10000 };
it("selects a classifier explicitly and saves quotas without granting a task permission", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.body) { const input = JSON.parse(init.body); writes.push(input); return new Response(JSON.stringify({ revision: 1, classifier: input.classifier })); }
    return new Response(JSON.stringify(String(url).startsWith("/api/accounts") ? { cliReference: { accountId: "cli-readonly", name: "CLI" }, accounts: [{ accountId: "class", name: "分类账号" }] }
      : String(url).startsWith("/api/models") ? { models: [{ id: "native/sentiment", name: "Sentiment", supported: true, price: null }] }
      : { config: { revision: 0, classifier: null }, tasks: [] }));
  }));
  render(<ClassifierPanel projectId="p" projectName="Project" onClose={() => {}} />);
  await screen.findByLabelText("分类账号");
  expect((screen.getByLabelText("分类账号") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("分类账号"), { target: { value: "class" } });
  await screen.findByRole("option", { name: "Sentiment · native/sentiment" });
  fireEvent.change(screen.getByLabelText("分类模型"), { target: { value: "native/sentiment" } });
  fireEvent.click(screen.getByText("保存项目分类配置"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toEqual({ type: "save", projectId: "p", revision: 0, classifier: { accountId: "class", model: "native/sentiment", budget } });
});
it("unknown receipts keep reservations visible and refresh does not replay", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ config: { revision: 1 }, tasks: [{ taskId: "t", snapshot: { revision: 1, classifier: { accountId: "class", model: "native/sentiment", budget } }, requests: [{ requestId: "stable", parentToolCallId: "parent", status: "unknown", reservation: { inputBytes: 8192, outputBytes: 8192 }, usage: { status: "unknown", tokens: null, estimatedCost: null } }] }] })));
  vi.stubGlobal("fetch", fetch);
  render(<ClassificationResults projectId="p" taskId="t" />);
  await screen.findByText("结果未知 · 继续占额");
  expect(screen.getByText(/未知结果继续占额，不自动重试/)).toBeTruthy();
  expect(screen.getByText(/输入已预占 8192/)).toBeTruthy();
  fireEvent.click(screen.getByText("核对分类账本"));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch.mock.calls.every((call: unknown[]) => !((call[1] as RequestInit)?.body))).toBe(true);
  expect(screen.queryByText("重试请求")).toBeNull();
});
