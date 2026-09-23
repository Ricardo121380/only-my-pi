import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Composer } from "./Composer";
import { SafeMarkdown } from "./Messages";
import { applyEvent } from "./api";
import { OutputDock } from "./OutputDock";
import type { HostSnapshot, ThinkingLevel } from "../../packages/host/contracts";
afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
const models = [{ id: "fixture/model", name: "Fixture", provider: "fixture" }];
const defaults = { models, disabled: false, running: false, cancelling: false, onSend: async () => {}, onCancel: () => {}, onModels: () => {} };
describe("composer states", () => {
  it("requires a Host capability and explicit choice for controlled mode; failure keeps the draft", async () => {
    const onSend = vi.fn(async () => { throw new Error("OWNERSHIP_HELD"); });
    const { container, rerender } = render(<Composer {...defaults} onSend={onSend} />);
    fireEvent.click(container.querySelector("#modeButton")!);
    expect((screen.getByRole("button", { name: /受控编程 显式审批/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Composer {...defaults} controlledAvailable onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: /受控编程 显式审批/ }));
    const input = screen.getByLabelText("新的受控编程") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "修改临时文件" } });
    fireEvent.click(screen.getByRole("button", { name: "开始受控任务" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("fixture/model", "修改临时文件", "controlled"));
    expect(input.value).toBe("修改临时文件");
    rerender(<Composer {...defaults} onSend={onSend} />);
    expect(screen.getByLabelText("新的只读分析")).toBeTruthy();
  });
  it("opens mode help independently from usage", () => {
    const { container } = render(<Composer {...defaults} />);
    fireEvent.click(container.querySelector("#modeButton")!);
    expect(screen.getByRole("dialog", { name: "选择执行模式" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "运行与用量" })).toBeNull();
  });
  it("keeps the controlled model across project remounts and refuses missing selections", async () => {
    const onSend = vi.fn(async () => {});
    const props = { ...defaults, models: [...models, { id: "fixture/second", name: "Second", provider: "fixture" }], selectedModel: "fixture/second", onSend };
    const { rerender } = render(<Composer key="a" {...props} />);
    rerender(<Composer key="b" {...props} />);
    fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "检查" } });
    fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("fixture/second", "检查", "readonly"));
    rerender(<Composer key="c" {...props} models={models} />);
    fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "检查" } });
    expect((screen.getByRole("button", { name: "开始分析" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("所选模型不可用，请重选")).toBeTruthy();
  });
  it("does not send during Chinese IME composition; Ctrl+Enter sends once", async () => {
    const onSend = vi.fn(async () => {}); render(<Composer {...defaults} onSend={onSend} />);
    const input = screen.getByLabelText("新的只读分析");
    fireEvent.change(input, { target: { value: "检查项目" } }); fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledWith("fixture/model", "检查项目", "readonly");
  });
  it("keeps text after submission failure", async () => {
    render(<Composer {...defaults} onSend={async () => { throw new Error("offline"); }} />);
    const input = screen.getByLabelText("新的只读分析") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "保留这个问题" } }); fireEvent.click(screen.getByText("开始分析"));
    await waitFor(() => expect(screen.getByText("开始分析")).toBeTruthy()); expect(input.value).toBe("保留这个问题");
  });
  it("cancelling is not presented as cancelled", () => {
    const onCancel = vi.fn(); render(<Composer {...defaults} running cancelling onCancel={onCancel} />);
    const button = screen.getByRole("button", { name: "正在取消…" }) as HTMLButtonElement; expect(button.disabled).toBe(true); fireEvent.click(button); expect(onCancel).not.toHaveBeenCalled();
  });
  it("does not send without explicit model or connected project", () => {
    render(<Composer {...defaults} models={[]} disabled />); fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "test" } }); expect((screen.getByRole("button", { name: "开始分析" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
it("Markdown neither executes HTML nor loads remote images or unsafe links", () => {
  const { container } = render(<SafeMarkdown text={'<script>alert(1)</script>\n\n![remote](https://example.com/tracker.png)\n\n[x](javascript:alert(1))\n\n[safe](https://example.com)'} />);
  expect(container.querySelector("script")).toBeNull(); expect(container.querySelector("img")).toBeNull();
  expect(container.querySelectorAll("a").length).toBe(1); expect(container.querySelector("a")?.rel).toBe("noopener noreferrer");
});
const snapshot: HostSnapshot = { protocol: 2, version: "phase2-v1", epoch: "epoch", seq: 1, indexing: false, runtime: { stackId: "fixture", sourceCommit: null }, projects: [], tasks: [], diagnostics: [] };
it("duplicate events are ignored; gap/old host require new snapshot", () => {
  expect(applyEvent(snapshot, { type: "projects", epoch: "epoch", seq: 1, data: [] })).toBe(snapshot);
  expect(() => applyEvent(snapshot, { type: "projects", epoch: "epoch", seq: 4, data: [] })).toThrow("EVENT_GAP");
  expect(() => applyEvent(snapshot, { type: "projects", epoch: "other", seq: 2, data: [] })).toThrow("EVENT_GAP");
  expect(applyEvent(snapshot, { ...snapshot, type: "snapshot", epoch: "fresh", seq: 0 })?.epoch).toBe("fresh");
});
it("10,000 ordered events have bounded task projection", () => {
  let state: HostSnapshot | null = snapshot;
  for (let seq = 2; seq <= 10001; seq++) state = applyEvent(state, { type: "task", epoch: "epoch", seq, data: { taskId: `task-${seq % 150}`, requestId: "r", projectId: "p", model: "m", prompt: "p", status: "running", sessionId: null, createdAt: "", updatedAt: "", messages: [] } });
  expect(state?.seq).toBe(10001); expect(state?.tasks.length).toBe(100);
});
it("usage stays unknown instead of importing prototype metrics", () => {
  render(<Composer {...defaults} />);
  expect(screen.getByText("速率 — tok/s")).toBeTruthy();
  expect(screen.getByText("估算费用 —")).toBeTruthy();
  expect(screen.queryByText(/237 tok\/s/)).toBeNull();
});
it("thinking selection stays independent of past task values and only exposes supported levels", async () => {
  const onSend = vi.fn(async () => {});
  function Fixture() {
    const [level, setLevel] = useState<ThinkingLevel | null>(null);
    return <Composer {...defaults} models={[{ ...models[0], thinkingLevels: ["off", "low", "high"] }]} effectiveThinkingLevel="low" thinkingLevel={level} onThinkingLevel={setLevel} onSend={onSend} />;
  }
  render(<Fixture />);
  expect(screen.getByRole("button", { name: "选择思考强度" }).textContent).toBe("默认强度");
  fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
  expect(screen.queryByRole("button", { name: /极高/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "高 · high" }));
  fireEvent.change(screen.getByLabelText("新的只读分析"), { target: { value: "verify" } });
  fireEvent.click(screen.getByRole("button", { name: "开始分析" }));
  await waitFor(() => expect(onSend).toHaveBeenCalledWith("fixture/model", "verify", "readonly", "high"));
  fireEvent.click(screen.getByRole("button", { name: "选择思考强度" }));
  fireEvent.click(screen.getByRole("button", { name: "使用默认强度" }));
  expect(screen.getByRole("button", { name: "选择思考强度" }).textContent).toBe("默认强度");
});
it("partial usage is labeled and unknown costs are not rendered as free", () => {
  render(<Composer {...defaults} usage={{ scope: "task", responses: 2, tools: 1, reported: 1, priced: 0, tokens: { input: 70, output: 20, cacheRead: 30, cacheWrite: 0, totalTokens: 120 }, estimatedCost: null }} />);
  expect(screen.getByText("部分回执")).toBeTruthy();
  expect(screen.getByText("120 tok")).toBeTruthy();
  expect(screen.getByText("估算费用 —")).toBeTruthy();
  fireEvent.click(screen.getByText("口径"));
  expect(screen.getByText(/以下仅为已收到回执的部分合计/)).toBeTruthy();
});
it("output dock shows only public tool results and closing only calls its view callback", () => {
  const onClose = vi.fn();
  const { container } = render(<OutputDock onClose={onClose} messages={[{ id: "a", role: "assistant", text: "对话正文" }, { id: "t", role: "toolResult", toolName: "read", text: "<script>not executable</script>" }]} />);
  expect(screen.queryByText("对话正文")).toBeNull();
  expect(screen.getByText("<script>not executable</script>")).toBeTruthy();
  expect(container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭底部输出" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
