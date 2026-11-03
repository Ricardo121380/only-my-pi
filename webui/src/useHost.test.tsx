import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HostEvent, HostSnapshot, HostTask, InputDirtyEventV1 } from "../../packages/host/contracts";
import { useHost } from "./useHost";

const running: HostTask = { taskId: "task", requestId: "request", projectId: "project", model: "fixture/model", prompt: "test", status: "running", sessionId: null, createdAt: "", updatedAt: "", messages: [] };
const completed: HostTask = { ...running, status: "succeeded", messages: [{ id: "result", role: "assistant", text: "finished" }] };
const initial: HostSnapshot = { protocol: 2, version: "phase2-v1", epoch: "initial", seq: 1, indexing: false, runtime: { stackId: "fixture", sourceCommit: null }, projects: [], tasks: [running], diagnostics: [] };
class Socket {
  static instances: Socket[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  closeCalls = 0;
  url: string;
  constructor(url: string) { this.url = url; Socket.instances.push(this); }
  close() { this.closeCalls++; this.onclose?.(); }
  emit(event: HostEvent | InputDirtyEventV1) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
let fetchedTask: HostTask;
beforeEach(() => {
  Socket.instances = []; fetchedTask = running;
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input, "http://fixture");
    if (url.pathname === "/api/state") return new Response(JSON.stringify(initial));
    if (url.pathname === "/api/task") return new Response(JSON.stringify(fetchedTask));
    throw new Error(`Unexpected route: ${url.pathname}`);
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function connected() {
  const view = renderHook(() => useHost("task"));
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  await act(async () => Socket.instances[0].emit({ ...initial, type: "snapshot" }));
  expect(view.result.current.connection).toBe("已连接");
  expect(view.result.current.task?.status).toBe("running");
  return view;
}

it.each([1, 2])("rejects a task frame at seq %i from both the snapshot and selected-task projection", async seq => {
  const { result } = await connected(), socket = Socket.instances[0];
  act(() => socket.emit({ type: "task", epoch: initial.epoch, seq: 2, data: completed }));
  expect(result.current.task).toEqual(completed);
  act(() => socket.emit({ type: "task", epoch: initial.epoch, seq, data: running }));
  expect(result.current.snapshot?.seq).toBe(2);
  expect(result.current.snapshot?.tasks[0].status).toBe("succeeded");
  expect(result.current.task).toEqual(completed);
  expect(socket.closeCalls).toBe(0);
});

it("keeps the shared cursor across projects and task events and still accepts the next task", async () => {
  const { result } = await connected(), socket = Socket.instances[0];
  act(() => socket.emit({ type: "projects", epoch: initial.epoch, seq: 2, data: [] }));
  act(() => socket.emit({ type: "task", epoch: initial.epoch, seq: 2, data: completed }));
  expect(result.current.task).toEqual(running);
  act(() => socket.emit({ type: "task", epoch: initial.epoch, seq: 3, data: completed }));
  expect(result.current.snapshot?.seq).toBe(3); expect(result.current.task).toEqual(completed);
});

it.each(["gap", "epoch"] as const)("recovers from an event %s and ignores every retired socket callback", async invalid => {
  const { result } = await connected(), old = Socket.instances[0];
  vi.useFakeTimers();
  act(() => old.emit({ type: "task", epoch: invalid === "epoch" ? "wrong" : initial.epoch, seq: invalid === "gap" ? 4 : 2, data: completed }));
  expect(old.closeCalls).toBe(1);
  expect(result.current.connection).toBe("连接中断，正在重连");
  expect(result.current.task).toEqual(running);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(Socket.instances).toHaveLength(2);
  const fresh = Socket.instances[1]; fetchedTask = completed;
  await act(async () => fresh.emit({ ...initial, type: "snapshot", epoch: "restarted", seq: 0, tasks: [completed] }));
  expect(result.current.connection).toBe("已连接"); expect(result.current.task).toEqual(completed);
  await act(async () => {
    old.emit({ ...initial, type: "snapshot" });
    old.emit({ type: "task", epoch: initial.epoch, seq: 2, data: running });
    old.onerror?.(); old.onclose?.();
  });
  expect(result.current.snapshot?.epoch).toBe("restarted");
  expect(result.current.task).toEqual(completed);
  expect(result.current.connection).toBe("已连接"); expect(fresh.closeCalls).toBe(0);
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(Socket.instances).toHaveLength(2);
});

it("ignores a retired task query failure after the same task reconnects successfully", async () => {
  const previousFetch = globalThis.fetch;
  let rejectOld!: (error: Error) => void, queries = 0;
  const delayed = new Promise<Response>((_resolve, reject) => { rejectOld = reject; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input).includes("/api/task") && ++queries === 1) return delayed;
    return previousFetch(input, options);
  }));
  const { result } = await connected();
  vi.useFakeTimers();
  act(() => Socket.instances[0].close());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  fetchedTask = completed;
  await act(async () => Socket.instances[1].emit({ ...initial, type: "snapshot", epoch: "new", seq: 0, tasks: [completed] }));
  expect(result.current.connection).toBe("已连接"); expect(result.current.task).toEqual(completed);
  await act(async () => rejectOld(new Error("retired request failed")));
  expect(result.current.error).toBe("");
  expect(result.current.task).toEqual(completed);
});

it("subscribes to independent input dirty hints, ignores repeats and invalidates across input gaps", async () => {
  const { result } = await connected(), socket = Socket.instances[0], start = result.current.inputRevision;
  expect(socket.url).toContain("protocol=2&inputs=1");
  const dirty: InputDirtyEventV1 = { type: "inputs", inputProtocol: 1, epoch: initial.epoch, inputSeq: 5, data: { scope: { projectId: "project", sessionId: "session" } } };
  act(() => socket.emit(dirty)); expect(result.current.inputRevision).toBe(start + 1);
  act(() => socket.emit({ ...dirty, inputSeq: 4 })); act(() => socket.emit(dirty));
  expect(result.current.inputRevision).toBe(start + 1);
  act(() => socket.emit({ ...dirty, inputSeq: 8 })); expect(result.current.inputRevision).toBe(start + 2);
  expect(result.current.snapshot?.seq).toBe(1); expect(result.current.task).toEqual(running); expect(socket.closeCalls).toBe(0);
  act(() => socket.emit({ type: "task", epoch: initial.epoch, seq: 2, data: completed }));
  expect(result.current.task).toEqual(completed);
});

it("invalidates input reads on a reconnect snapshot and rejects retired input callbacks", async () => {
  const { result } = await connected(), old = Socket.instances[0], start = result.current.inputRevision;
  vi.useFakeTimers(); act(() => old.close());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  const fresh = Socket.instances[1];
  await act(async () => fresh.emit({ ...initial, type: "snapshot", epoch: "new", seq: 0 }));
  expect(result.current.inputRevision).toBe(start + 1);
  act(() => old.emit({ type: "inputs", inputProtocol: 1, epoch: initial.epoch, inputSeq: 99, data: { scope: { projectId: "project", sessionId: "session" } } }));
  expect(result.current.inputRevision).toBe(start + 1);
  act(() => fresh.emit({ type: "inputs", inputProtocol: 1, epoch: "new", inputSeq: 1, data: { scope: { projectId: "project", sessionId: "session" } } }));
  expect(result.current.inputRevision).toBe(start + 2);
});
