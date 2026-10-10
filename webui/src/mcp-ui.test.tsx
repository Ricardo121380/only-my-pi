import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskControl } from "./TaskControl";
import type { HostTask } from "../../packages/host/contracts";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const task: HostTask = { taskId: "task", requestId: "request", projectId: "project", model: "fixture/one", prompt: "read", status: "running", sessionId: "session", messages: [], createdAt: "now", updatedAt: "now", mode: "readonly", mcp: { protocol: 1, revision: 7, enabled: true }, approvals: [{ approvalId: "mcp-approval", kind: "select", title: "MCP · local/read_file · 只读", message: "", options: ["拒绝", "仅本次", "本任务"], expiresAt: "2099-01-01T00:00:00Z" }] };
it("readonly MCP has explicit decisions, blocks duplicate answers and claims no execution", async () => {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => task })); vi.stubGlobal("fetch", fetch);
  render(<TaskControl task={task} connected />); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("仅本次")); fireEvent.click(screen.getByText("仅本次"));
  await waitFor(() => expect(screen.getByText(/决定已提交/)).toBeTruthy());
  expect(fetch).toHaveBeenCalledTimes(1); expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ type: "answerApproval", taskId: "task", approvalId: "mcp-approval", value: "仅本次" });
  expect(screen.queryByText("已完成")).toBeNull();
});
it("readonly MCP cannot approve when disconnected or after cancellation", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<TaskControl task={task} connected={false} />);
  expect((screen.getByText("本任务") as HTMLButtonElement).disabled).toBe(true);
  rerender(<TaskControl task={{ ...task, status: "cancelled" }} connected />);
  fireEvent.click(screen.getByText("本任务")); expect(fetch).not.toHaveBeenCalled();
});
