import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostTask, InputContentV1, InputRecordV1, QueueShardV1 } from "../../../packages/host/contracts";
import { NativeInputs } from "./NativeInputs";

const task: HostTask = { taskId: "task", requestId: "request", projectId: "project", sessionId: "session", accountId: "selected-deepseek-account", model: "commandcode/deepseek/deepseek-v4.1-flash", thinkingLevel: "low", resourceRevision: 0, mode: "readonly", status: "running", prompt: "read", messages: [], createdAt: "", updatedAt: "" };
const json = (value: unknown) => new Response(JSON.stringify(value));
let queue: QueueShardV1, posts: Record<string, any>[], mutate: (command: Record<string, any>) => Promise<Response>;
const record = (input: InputContentV1, state: InputRecordV1["state"] = "accepted", revision = 1): InputRecordV1 => ({ ...input, schemaVersion: 1, projectId: "project", sessionId: "session", taskId: "task", revision, contentDigest: `sha256:${"a".repeat(64)}`, state, consumedEntryId: state === "consumed" ? "native-entry" : null, pauseReason: null, createdAt: "", updatedAt: "" });
const content = (inputId = "queued-one"): InputContentV1 => ({ inputId, delivery: "queue", text: "old queued text", materialSnapshotIds: [], binding: { accountId: task.accountId!, modelId: task.model, thinking: "low", mode: "readonly", resourceRevision: 0 } });
beforeEach(() => {
  queue = { schemaVersion: 1, kind: "queue", scope: { projectId: "project", sessionId: "session" }, revision: 0, items: [] }; posts = [];
  mutate = async command => { queue = { ...queue, revision: queue.revision + 1, items: [...queue.items, record(command.input)] }; return json(queue); };
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body));
    if (command.type === "getInputs") return json({ protocol: 1, admission: "ready", draft: { schemaVersion: 1, kind: "draft", scope: queue.scope, revision: 0, draft: null }, queue });
    posts.push(command); return mutate(command);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = () => ({ task, inputRevision: 0, connected: true, text: "补充正文", textVersion: 1, isComposing: () => false, onAccepted: vi.fn(), onBlocked: vi.fn() });

it("uses the executing task binding, deduplicates rapid steering and separates acceptance from consumption", async () => {
  const p = props(), view = render(<NativeInputs {...p} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "即时补充" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "即时补充" })); fireEvent.click(screen.getByRole("button", { name: "即时补充" }));
  await screen.findByText("Pi 已接收，等待消费凭据");
  expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ type: "deliverSupplement", taskId: "task", target: { projectId: "project", taskId: "task" }, expectedRevision: 0, input: { delivery: "steer", text: "补充正文", binding: content().binding } });
  expect(screen.queryByText("Pi 已消费")).toBeNull(); expect(p.onAccepted).toHaveBeenCalledWith("补充正文", 1);
  queue = { ...queue, revision: 2, items: queue.items.map(item => ({ ...item, state: "consumed", consumedEntryId: "native-entry" })) };
  view.rerender(<NativeInputs {...p} inputRevision={1} />);
  await screen.findByText("Pi 已消费");
  await waitFor(() => expect(p.onBlocked).toHaveBeenLastCalledWith(false));
});

it("unknown mutation is only read back, retains draft identity and never automatically resends", async () => {
  const p = props(); mutate = async () => { throw new TypeError("lost response"); };
  render(<NativeInputs {...p} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "留待下一任务" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "留待下一任务" }));
  await screen.findByText("结果待核对，不会自动重发，也不会开始另一条输入。");
  expect(p.onAccepted).not.toHaveBeenCalled(); expect(posts).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "留待下一任务" })); expect(posts).toHaveLength(1);
  queue = { ...queue, revision: 1, items: [record(posts[0].input, "consumed")] };
  fireEvent.click(screen.getByRole("button", { name: "核对输入状态" }));
  await screen.findByText("Pi 已消费"); expect(posts).toHaveLength(1);
  await waitFor(() => expect(p.onAccepted).toHaveBeenCalledWith("补充正文", 1));
});

it("IME composition prevents delivery and late acceptance retains the submitted text version", async () => {
  const p = props(); let finish!: (value: Response) => void;
  mutate = async () => new Promise(resolve => { finish = resolve; });
  const view = render(<NativeInputs {...p} isComposing={() => true} />);
  await waitFor(() => expect((screen.getByRole("button", { name: "即时补充" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "即时补充" })); expect(posts).toHaveLength(0);
  view.rerender(<NativeInputs {...p} />); fireEvent.click(screen.getByRole("button", { name: "即时补充" }));
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(<NativeInputs {...p} text="后续输入" textVersion={2} />);
  queue = { ...queue, revision: 1, items: [record(posts[0].input)] };
  await act(async () => finish(json(queue)));
  expect(p.onAccepted).toHaveBeenCalledWith("补充正文", 1); expect(posts).toHaveLength(1);
});

it("editing and removing a queued item send both CAS revisions", async () => {
  queue = { ...queue, revision: 5, items: [record(content(), "queued", 2)] };
  mutate = async command => {
    queue = { ...queue, revision: queue.revision + 1, items: queue.items.map(item => command.type === "editQueuedInput" ? record(command.input, "queued", 3) : { ...item, revision: 4, state: "removed" }) };
    return json(queue);
  };
  render(<NativeInputs {...props()} />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑未投递消息" }));
  fireEvent.change(screen.getByLabelText("编辑待投递消息"), { target: { value: "edited queue text" } });
  fireEvent.click(screen.getByRole("button", { name: "保存待投递消息" }));
  await waitFor(() => expect(screen.queryByLabelText("编辑待投递消息")).toBeNull());
  expect(posts[0]).toMatchObject({ type: "editQueuedInput", expectedRevision: 5, expectedInputRevision: 2, input: { inputId: "queued-one", text: "edited queue text" } });
  fireEvent.click(screen.getByRole("button", { name: "移除未投递消息" }));
  await screen.findByText("已移除，未投递");
  expect(posts[1]).toMatchObject({ type: "removeQueuedInput", inputId: "queued-one", expectedRevision: 6, expectedInputRevision: 3 });
});

it("a consumed label without receipt metadata stays blocked and is not called Pi consumption", async () => {
  queue = { ...queue, revision: 1, items: [{ ...record(content(), "consumed"), consumedEntryId: null }] };
  const p = props(); render(<NativeInputs {...p} />);
  await screen.findByText("消费凭据待核对"); expect(screen.queryByText("Pi 已消费")).toBeNull();
  expect(p.onBlocked).toHaveBeenLastCalledWith(true);
});
