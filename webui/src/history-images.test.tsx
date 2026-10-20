import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HistoryImages } from "./HistoryImages";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const artifact = { requestId: "original-request", index: 0, projectPath: "/selected/project", sessionId: "source-session", taskId: "original-task", accountId: "image-account", model: "image-model", parentToolCallId: "script", inputDigest: "input", sha256: "a".repeat(64), bytes: 253, width: 64, height: 64, mimeType: "image/png", createdAt: "2026-10-11" };
const view = { sessionId: "fork-session", images: [{ entryId: "original-position", artifact, shared: true, state: "available" }], exportAvailable: true, space: { availableBytes: 1048576, referencedBytes: 253, cleanup: "EXPLICIT_ONLY" } };
it("restores shared source references read-only and requires both project write and overwrite confirmation", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
  const writes: Record<string, unknown>[] = [];
  const plan = { operationId: "selected-operation", status: "prepared", source: artifact, target: { path: "selected.png", exists: true, beforeSha256: "b".repeat(64), beforeBytes: 7 } };
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.body) { const command = JSON.parse(init.body); writes.push(command); return new Response(JSON.stringify(command.type === "commit" ? { ...plan, status: "completed" } : plan)); }
    return new Response(JSON.stringify(String(url).startsWith("/api/session-images") ? view : { exports: [] }));
  }));
  render(<HistoryImages projectId="selected-project" sessionKey="selected-session" connected />);
  await screen.findByText(/共享原会话图片/); expect(writes).toHaveLength(0);
  const link = screen.getByRole("link", { name: "下载 PNG" }); expect(link.getAttribute("href")).toContain("sessionKey=selected-session"); expect(link.getAttribute("href")).toContain("entryId=original-position");
  fireEvent.click(screen.getByText("导出到项目…")); fireEvent.change(screen.getByLabelText("项目内 PNG 路径"), { target: { value: "selected.png" } }); fireEvent.click(screen.getByText("核对源图片与目标"));
  const commit = await screen.findByText("确认写入项目"); expect((commit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("允许将此图片写入当前项目的选定路径")); expect((commit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByLabelText("确认覆盖以上版本的已有目标")); fireEvent.click(commit);
  await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1]).toEqual({ type: "commit", operationId: "selected-operation", codingAuthorized: true, overwrite: true });
});
it("losing an export receipt never repeats the write on refresh", async () => {
  const plan = { operationId: "stable", status: "prepared", source: artifact, target: { path: "new.png", exists: false } }; let commits = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (init?.body) { const command = JSON.parse(init.body); if (command.type === "commit") { commits++; throw new Error("synthetic EOF"); } return new Response(JSON.stringify(plan)); }
    return new Response(JSON.stringify(String(url).startsWith("/api/session-images") ? view : { exports: [plan] }));
  }));
  render(<HistoryImages projectId="p" sessionKey="s" connected />); fireEvent.click(await screen.findByText("导出到项目…")); fireEvent.click(screen.getByText("核对源图片与目标"));
  fireEvent.click(await screen.findByLabelText("允许将此图片写入当前项目的选定路径")); fireEvent.click(screen.getByText("确认写入项目")); await screen.findByText(/回执未确认/);
  expect(screen.queryByText("确认写入项目")).toBeNull(); fireEvent.click(screen.getByText("核对原导出记录")); await screen.findByText("确认写入项目"); expect(commits).toBe(1);
});
