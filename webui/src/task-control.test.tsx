import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HostTask } from "../../packages/host/contracts";
import { TaskControl } from "./TaskControl";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const task: HostTask = { taskId: "task", requestId: "request", projectId: "project", model: "fixture/model", prompt: "Fixture", status: "running", sessionId: "session", messages: [], createdAt: "now", updatedAt: "now", mode: "controlled", access: "inspect", approvals: [{ approvalId: "approval", kind: "confirm", title: "Run exact fixture verification?", message: "Project: fixture", expiresAt: "2099-01-01T00:00:00Z" }] };

it("never auto-approves, prevents repeated decisions and does not claim verification", async () => {
  let finish!: (value: unknown) => void;
  const fetch = vi.fn((_url: string, _init?: RequestInit) => new Promise((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetch);
  render(<TaskControl task={task} connected />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("允许本次验证")); fireEvent.click(screen.getByText("允许本次验证"));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ type: "answerApproval", taskId: "task", approvalId: "approval", value: true });
  finish({ ok: true, json: async () => task });
  await waitFor(() => expect(screen.getByText(/决定已提交/)).toBeTruthy());
  expect((screen.getByText("允许本次验证") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("验证通过")).toBeNull();
});

it("disables decisions while disconnected and reports expired approvals", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ code: "APPROVAL_EXPIRED" }) })));
  const { rerender } = render(<TaskControl task={task} connected={false} />);
  expect((screen.getByText("允许本次验证") as HTMLButtonElement).disabled).toBe(true);
  rerender(<TaskControl task={task} connected />);
  fireEvent.click(screen.getByText("拒绝"));
  await waitFor(() => expect(screen.getByText(/此审批已失效/)).toBeTruthy());
});
