import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HostTask, InputContentV1, InputRecordV1, QueueShardV1 } from "../../packages/host/contracts";
import { SettingsQueue } from "./SettingsQueue";

const task: HostTask = { taskId: "task-a", requestId: "request", projectId: "project-a", sessionId: "session-a", model: "fixture/model", accountId: "account", thinkingLevel: "off", mode: "readonly", resourceRevision: 1, status: "running", prompt: "test", messages: [], createdAt: "", updatedAt: "" };
const binding = { accountId: "account", modelId: "fixture/model", thinking: "off" as const, mode: "readonly" as const, resourceRevision: 1 };
const empty = (own = task): QueueShardV1 => ({ schemaVersion: 1, kind: "queue", revision: 0, scope: { projectId: own.projectId, sessionId: own.sessionId }, items: [] });
const record = (input: InputContentV1, state: InputRecordV1["state"] = "queued"): InputRecordV1 => ({ ...input, ...empty().scope, schemaVersion: 1, revision: 1, taskId: task.taskId, state, contentDigest: "fixture-digest", consumedEntryId: null, pauseReason: null, createdAt: "", updatedAt: "" });
const read = (queue: QueueShardV1) => ({ protocol: 1, admission: "ready", draft: { schemaVersion: 1, kind: "draft", revision: 0, scope: queue.scope, draft: null }, queue });
const response = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains a new queue draft while a previous enqueue response is delayed", async () => {
  const held = deferred<Response>(); let input!: InputContentV1;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const command = JSON.parse(init.body);
    if (command.type === "getInputs") return response(read(empty()));
    input = command.input; return held.promise;
  }));
  render(<SettingsQueue task={task} />);
  fireEvent.change(screen.getByLabelText("下一任务消息"), { target: { value: "original" } });
  await waitFor(() => expect(screen.getByText("留待下一任务").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByText("留待下一任务"));
  fireEvent.change(screen.getByLabelText("下一任务消息"), { target: { value: "new draft" } });
  await act(async () => held.resolve(response({ ...empty(), revision: 1, items: [record(input)] })));
  expect((screen.getByLabelText("下一任务消息") as HTMLTextAreaElement).value).toBe("new draft");
});

it("reconciles an enqueue delivery error by its saved identity without another write", async () => {
  let queue = empty(), writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const command = JSON.parse(init.body);
    if (command.type === "getInputs") return response(read(queue));
    writes++; queue = { ...queue, revision: 1, items: [record(command.input)] };
    throw new TypeError("controlled response delivery failure");
  }));
  render(<SettingsQueue task={task} />);
  fireEvent.change(screen.getByLabelText("下一任务消息"), { target: { value: "saved once" } });
  await waitFor(() => expect(screen.getByText("留待下一任务").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByText("留待下一任务"));
  await waitFor(() => expect((screen.getByLabelText("下一任务消息") as HTMLTextAreaElement).value).toBe(""));
  expect(writes).toBe(1); expect(screen.queryByRole("alert")).toBeNull();
});

it("does not project a retired task mutation into the next task scope", async () => {
  const held = deferred<Response>(); let input!: InputContentV1;
  const other = { ...task, taskId: "task-b", projectId: "project-b", sessionId: "session-b" };
  const otherQueue = { ...empty(other), revision: 1, items: [{ ...record({ inputId: "b", delivery: "queue", text: "belongs to B", materialSnapshotIds: [], binding }), ...empty(other).scope }] };
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const command = JSON.parse(init.body);
    if (command.type === "getInputs") return response(read(command.target.taskId === task.taskId ? empty() : otherQueue));
    input = command.input; return held.promise;
  }));
  const view = render(<SettingsQueue task={task} />);
  fireEvent.change(screen.getByLabelText("下一任务消息"), { target: { value: "belongs to A" } });
  await waitFor(() => expect(screen.getByText("留待下一任务").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByText("留待下一任务")); view.rerender(<SettingsQueue task={other} />);
  await screen.findByText(/belongs to B ·/);
  await act(async () => held.resolve(response({ ...empty(), revision: 1, items: [record(input)] })));
  expect(screen.queryByText(/belongs to A ·/)).toBeNull();
  expect(screen.getByText(/belongs to B ·/)).toBeTruthy();
});

it("retains edits made while a reviewed queue item is being saved", async () => {
  const held = deferred<Response>(), original = record({ inputId: "queued", delivery: "queue", text: "paused", materialSnapshotIds: [], binding }, "paused");
  let input!: InputContentV1;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const command = JSON.parse(init.body);
    if (String(url) === "/api/settings") return response({ resourceRevision: 2, resources: [] });
    if (command.type === "getInputs") return response(read({ ...empty(), revision: 1, items: [original] }));
    input = command.input; return held.promise;
  }));
  render(<SettingsQueue task={{ ...task, status: "succeeded" }} />);
  fireEvent.click(await screen.findByText("核对当前配置与消息"));
  fireEvent.change(await screen.findByLabelText("核对消息"), { target: { value: "first edit" } });
  fireEvent.click(screen.getByText("保存已核对的待投递消息"));
  fireEvent.change(screen.getByLabelText("核对消息"), { target: { value: "new edit" } });
  await act(async () => held.resolve(response({ ...empty(), revision: 2, items: [{ ...record(input, "paused"), revision: 2 }] })));
  expect((screen.getByLabelText("核对消息") as HTMLTextAreaElement).value).toBe("new edit");
});

it("freezes both review revisions until the user explicitly adopts a changed queue", async () => {
  const original = record({ inputId: "queued", delivery: "queue", text: "paused", materialSnapshotIds: [], binding }, "paused");
  let queue = { ...empty(), revision: 1, items: [original] }; const writes: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    const command = JSON.parse(init.body);
    if (String(url) === "/api/settings") return response({ resourceRevision: 2, resources: [] });
    if (command.type === "getInputs") return response(read(queue));
    writes.push(command); queue = { ...queue, revision: 3, items: [{ ...record(command.input, "paused"), revision: 3 }] }; return response(queue);
  }));
  const done = { ...task, status: "succeeded" as const }, view = render(<SettingsQueue task={done} inputRevision={0} />);
  fireEvent.click(await screen.findByText("核对当前配置与消息"));
  fireEvent.change(await screen.findByLabelText("核对消息"), { target: { value: "retained edit" } });
  queue = { ...queue, revision: 2, items: [{ ...original, revision: 2, text: "other window" }] };
  view.rerender(<SettingsQueue task={done} inputRevision={1} />);
  await screen.findByText("队列版本已变化，编辑内容已保留。请比较当前消息后明确采用新版本。");
  expect(screen.getByText("保存已核对的待投递消息").hasAttribute("disabled")).toBe(true);
  expect((screen.getByLabelText("核对消息") as HTMLTextAreaElement).value).toBe("retained edit"); expect(writes).toHaveLength(0);
  fireEvent.click(screen.getByText("已核对，采用当前队列版本")); fireEvent.click(screen.getByText("保存已核对的待投递消息"));
  await waitFor(() => expect(writes).toHaveLength(1));
  expect(writes[0]).toMatchObject({ expectedRevision: 2, expectedInputRevision: 2, input: { text: "retained edit" } });
});
