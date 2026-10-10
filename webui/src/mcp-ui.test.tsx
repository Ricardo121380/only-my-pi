import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskControl } from "./TaskControl";
import { McpPanel } from "./McpPanel";
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

it("MCP OAuth opens only after explicit login and exposes cancellation without storing an authorization URL", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  let started = false;
  const flow = { flowId: "flow", name: "remote", projectPath: "/project", targetDigest: "target", ref: null, kind: "login", status: "waiting", events: [], authorizationOrigin: "https://issuer.example" };
  const configuration = () => ({ protocol: 1, revision: 1, projectPath: "/project", servers: [{ name: "remote", transport: "streamable-http", url: "https://mcp.example/mcp", enabled: false, credentialRefs: {}, tools: [], source: "project", targetDigest: "target" }], authentication: { remote: { state: "not_connected", ref: null, ...(started ? { flow } : {}) } } });
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body));
    if (input.type === "oauthStart") { started = true; return { ok: true, json: async () => flow }; }
    return { ok: true, json: async () => input.type === "list" ? configuration() : { protocol: 1, runs: [] } };
  }); vi.stubGlobal("fetch", fetch);
  render(<McpPanel projectId="project" onClose={() => {}} />);
  await screen.findByText("开始 OAuth 登录");
  expect(fetch.mock.calls.some(([, init]) => String(init?.body).includes("oauthStart"))).toBe(false);
  expect(screen.queryByText("打开授权页面")).toBeNull();
  fireEvent.click(screen.getByText("开始 OAuth 登录")); fireEvent.click(screen.getByText("开始 OAuth 登录"));
  const link = await screen.findByText("打开授权页面");
  expect(link.getAttribute("href")).toBe("/api/mcp-oauth/open?flowId=flow");
  expect(screen.getByText("取消 OAuth 登录")).toBeTruthy();
  expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes("oauthStart"))).toHaveLength(1);
});
it("readonly MCP cannot approve when disconnected or after cancellation", () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const { rerender } = render(<TaskControl task={task} connected={false} />);
  expect((screen.getByText("本任务") as HTMLButtonElement).disabled).toBe(true);
  rerender(<TaskControl task={{ ...task, status: "cancelled" }} connected />);
  fireEvent.click(screen.getByText("本任务")); expect(fetch).not.toHaveBeenCalled();
});
it("an orphaned write distinguishes unknown application from unchecked byte changes", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => JSON.parse(String(init?.body)).type === "list"
    ? { protocol: 1, revision: 1, projectPath: "/project", servers: [] }
    : { protocol: 1, runs: [{ runId: "orphan", taskId: "task", projectPath: "/project", revision: 1, status: "reconciliation", processes: [], calls: [{ callId: "write", server: "local", tool: "write_file", effect: "write", status: "unknown", application: "unknown", verification: "not_run", target: "/project/README.md" }] }] } })));
  render(<McpPanel projectId="project" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByText(/应用结果未知/)).toBeTruthy());
  expect(screen.getByText(/字节变化尚未核对/)).toBeTruthy();
  expect(screen.queryByText(/尚未应用|未观测字节变化/)).toBeNull();
});
