import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpPanel } from "./McpPanel";
import { McpDiscoveryPanel } from "./McpDiscoveryPanel";
import type { McpRun } from "../../packages/mcp/contracts";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("discovery refresh is bound to an actual live project task and preserves the configuration response", async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    const action = JSON.parse(String(init?.body));
    return { ok: true, json: async () => action.type === "list" ? { protocol: 1, revision: 7, servers: [] } : { protocol: 1, runs: [{ runId: "real", taskId: "actual-task", revision: 7, status: "running", processes: [], calls: [], discoveries: [{ server: "remote", epoch: action.type === "discover" ? 2 : 1, live: true, status: "ready", tools: [{ name: "echo", exposure: "hidden", active: false }], resources: [{ uri: "mcp://remote/readme", mimeType: "text/plain", size: 24 }], events: [] }] }] } };
  }); vi.stubGlobal("fetch", fetch);
  render(<McpPanel projectId="project" onClose={() => {}} />);
  const button = await screen.findByText("重新发现 remote"); fireEvent.click(button); fireEvent.click(button);
  await waitFor(() => expect(screen.getByText(/变化版本 2/)).toBeTruthy());
  expect(fetch.mock.calls.filter(([, init]) => String(init?.body).includes('"type":"discover"'))).toHaveLength(1);
  expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toEqual({ type: "discover", projectId: "project", taskId: "actual-task", name: "remote" });
  expect(screen.getByText(/配置版本 7/)).toBeTruthy(); expect(screen.getByText(/隐藏或已撤回/)).toBeTruthy();
});
it("stale and historical definitions never claim current callable or readable capabilities", () => {
  const run: McpRun = { runId: "past", taskId: "actual-task", projectPath: "/project", revision: 1, status: "stopped", processes: [], calls: [], discoveries: [{ server: "remote", targetDigest: "target", epoch: 2, live: false, status: "stale", tools: [{ name: "echo", exposure: "deferred", active: true, definitionDigest: "old" }], resources: [{ name: "README", uri: "mcp://remote/readme", mimeType: "text/plain", definitionDigest: "old" }], events: [] }] };
  render(<McpDiscoveryPanel run={run} busy={false} canDiscover onDiscover={() => {}} />);
  expect(screen.getByText(/上次发现，当前不可调用/)).toBeTruthy(); expect(screen.getByText(/上次发现，当前不可读取/)).toBeTruthy();
  expect((screen.getByText("重新发现 remote") as HTMLButtonElement).disabled).toBe(true);
});
