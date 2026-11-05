import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { TaskSummary } from "../../packages/host/contracts";
import { SessionDetails, ToolActivity } from "./shared/MinimalPanels";
import { MessageView } from "./shared/Messages";

const task: TaskSummary = { taskId: "task", requestId: "request", projectId: "project", accountId: "account", model: "fixture/one", prompt: "read", mode: "readonly", status: "succeeded", sessionId: "session", createdAt: "", updatedAt: "" };
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

it("counts only completed tools and distinguishes failed and unknown results", () => {
  render(<ToolActivity task={{ ...task, toolCalls: [
    { toolCallId: "read", parentToolCallId: null, name: "read", status: "completed", startedAt: "" },
    { toolCallId: "write", parentToolCallId: null, name: "write", status: "failed", startedAt: "" },
    { toolCallId: "bash", parentToolCallId: null, name: "bash", status: "unknown", startedAt: "" },
  ] }} />);
  const toggle = screen.getByRole("button", { name: /1 \/ 3 已完成/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false"); fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("失败")).toBeTruthy(); expect(screen.getByText("结果未知")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
it("renders unavailable usage as unreported instead of a zero usage or bill", () => {
  render(<SessionDetails open onClose={() => {}} task={task} sessionId="session" />);
  expect(screen.getByText("总 Token").nextElementSibling?.textContent).toBe("未报告");
  expect(screen.getByText("估算费用").nextElementSibling?.textContent).toBe("未报告");
  expect(screen.getByText(/仅统计当前选中会话的最近一轮/)).toBeTruthy();
});
it("does not call an existing native session unexecuted when Host metadata is absent", () => {
  render(<SessionDetails open onClose={() => {}} sessionId="cli-history" />);
  expect(screen.getByText("执行状态").nextElementSibling?.textContent).toBe("未报告");
  expect(screen.queryByText("尚未执行")).toBeNull();
  expect(screen.getByText(/没有可用的 Host 轮次记录/)).toBeTruthy();
});
it.each([false, true])("failed tools remain failures in either message style (branded=%s)", branded => {
  const { container } = render(<MessageView branded={branded} message={{ id: "failed", role: "toolResult", toolName: "write", text: "Tool write not found", isError: true }} />);
  fireEvent.click(screen.getByRole("button", { name: /^write\s*执行失败$/ }));
  expect(screen.getByText("Tool write not found")).toBeTruthy();
  expect(container.querySelector('[data-state="failed"]')).toBeTruthy();
});
