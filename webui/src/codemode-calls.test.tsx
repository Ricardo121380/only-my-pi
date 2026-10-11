import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HostTask } from "../../packages/host/contracts";
import { TaskControl } from "./TaskControl";
afterEach(cleanup);

it("keeps a failed child and its result visible when the parent script completes", () => {
  const task: HostTask = { taskId: "t", requestId: "r", projectId: "p", model: "fixture/one", prompt: "combine tools", status: "succeeded", sessionId: "s", messages: [], createdAt: "now", updatedAt: "now", mode: "readonly", codemode: { enabled: true, classifier: false, image: false }, toolCalls: [
    { toolCallId: "script", parentToolCallId: null, name: "codemode", status: "completed", startedAt: "now", durationMs: 1250, result: "Script completed; one child rejected" },
    { toolCallId: "script/1", parentToolCallId: "script", name: "read", status: "failed", startedAt: "now", durationMs: 200, result: "CODEMODE_CALL_DENIED" },
  ] };
  render(<TaskControl task={task} connected />);
  expect(screen.getByText(/read · 失败 · 0.20 秒/)).toBeTruthy();
  expect(screen.getByText("CODEMODE_CALL_DENIED")).toBeTruthy();
  expect(screen.getByText(/分类须先配置项目模型并取得本任务许可.*图片生成尚未启用/)).toBeTruthy();
  expect(screen.getByText(/子调用 script\/1 · 父调用 script/)).toBeTruthy();
});
