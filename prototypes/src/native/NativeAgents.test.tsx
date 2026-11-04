import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { HostTask } from "../../../packages/host/contracts";
import { NativeAgents } from "./NativeAgents";

afterEach(cleanup);
function task(status: HostTask["status"]): HostTask {
  return { taskId: "task", requestId: "request", projectId: "project", model: "commandcode/deepseek/deepseek-v4.1-flash", prompt: "read", status,
    sessionId: "session", messages: [], createdAt: "", updatedAt: "", orchestration: { maximumConcurrency: 2, maximumChildren: 4, totalChildren: 1, writerUsed: false,
      budget: { scope: "process-child-delegations", mainAgentIncluded: false, status: "BOUNDED", limits: {}, used: {} },
      children: [{ label: "读取项目", agent: "omp-explorer", status: "running", toolCount: null, tokens: null }] } };
}
it("shows a running child with the exact selected model", () => {
  render(<NativeAgents task={task("running")} />);
  expect(screen.getByRole("status").textContent).toContain("1 位只读助手正在工作");
  expect(screen.getByText("commandcode/deepseek/deepseek-v4.1-flash")).toBeTruthy();
});
it("a stale running snapshot after parent failure stays unknown", () => {
  render(<NativeAgents task={task("failed")} />);
  expect(screen.getByText("待核对")).toBeTruthy();
  expect(screen.queryByText(/正在工作/)).toBeNull();
  expect(screen.queryByText("已完成")).toBeNull();
});
it("a confirmed cancellation is retained without a running badge", () => {
  const value = task("cancelled"); value.orchestration!.children[0].status = "cancelled";
  render(<NativeAgents task={value} />);
  expect(screen.getByText("已取消")).toBeTruthy();
  expect(screen.queryByText(/正在工作/)).toBeNull();
});
