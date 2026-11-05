import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { HostTask, InputContentV1, InputRecordV1, QueueShardV1 } from "../../packages/host/contracts";
import { inputApi } from "./shared/inputApi";
import { INPUT_RECONCILE_MS, useInputQueue } from "./shared/useInputQueue";

const task: HostTask = { taskId: "task", requestId: "request", projectId: "p", sessionId: "s", model: "fixture/model", status: "running", prompt: "fixture", messages: [], createdAt: "", updatedAt: "" };
const input: InputContentV1 = { inputId: "stable", delivery: "queue", text: "saved", materialSnapshotIds: [], binding: { accountId: "account", modelId: "fixture/model", thinking: "off", mode: "readonly", resourceRevision: 1 } };
const empty: QueueShardV1 = { schemaVersion: 1, kind: "queue", revision: 0, scope: { projectId: "p", sessionId: "s" }, items: [] };
const item: InputRecordV1 = { ...input, ...empty.scope, schemaVersion: 1, revision: 1, taskId: "task", state: "queued", contentDigest: "fixture", consumedEntryId: null, pauseReason: null, createdAt: "", updatedAt: "" };
const envelope = (queue = empty) => ({ protocol: 1, admission: "ready", draft: { schemaVersion: 1, kind: "draft", revision: 0, scope: queue.scope, draft: null }, queue });
const response = (value: unknown) => new Response(JSON.stringify(value));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains an unconfirmed input identity, blocks writes and only confirms complete matching content", async () => {
  let queue = empty, writes = 0;
  const fetch = vi.fn(async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command.type === "getInputs") return response(envelope(queue));
    writes++; throw new TypeError("response lost");
  });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(() => useInputQueue(task)); await waitFor(() => expect(result.current.queue).toEqual(empty));
  await act(async () => { await result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input }); });
  expect(result.current.uncertain).toBe(true);
  await act(async () => { await result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input: { ...input, inputId: "another" } }); });
  expect(writes).toBe(1);
  queue = { ...empty, revision: 1, items: [{ ...item, text: "different content" }] };
  await act(async () => { await result.current.refresh(); }); expect(result.current.uncertain).toBe(true);
  queue = { ...queue, revision: 2, items: [item] };
  await act(async () => { await result.current.refresh(); });
  expect(result.current.uncertain).toBe(false); expect(result.current.confirmed?.command).toMatchObject({ input: { inputId: "stable" } }); expect(writes).toBe(1);
});

it("does not replace a mutation with an earlier read or a lower shard revision", async () => {
  const held = deferred<Response>(); let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const command = JSON.parse(options.body);
    if (command.type !== "getInputs") return response({ ...empty, revision: 2, items: [item] });
    reads++; return reads === 2 ? held.promise : response(envelope(empty));
  }));
  const { result } = renderHook(() => useInputQueue(task)); await waitFor(() => expect(result.current.queue).toBeTruthy());
  let stale!: Promise<unknown>; act(() => { stale = result.current.refresh(); });
  await act(async () => { await result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input }); });
  await act(async () => { held.resolve(response(envelope({ ...empty, revision: 1 }))); await stale; });
  expect(result.current.queue?.revision).toBe(2); expect(result.current.queue?.items[0].text).toBe("saved");
});

it("reconciles a dropped last dirty hint on a bounded read interval without polling every second", async () => {
  let queue = empty, reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => { reads++; return response(envelope(queue)); }));
  vi.useFakeTimers();
  const { result } = renderHook(() => useInputQueue(task)); await act(async () => {}); expect(result.current.queue).toBeTruthy();
  queue = { ...empty, revision: 1, items: [item] };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(reads).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(INPUT_RECONCILE_MS - 1000); });
  expect(reads).toBe(2); expect(result.current.queue?.revision).toBe(1);
});

it("refreshes after dirty or connection recovery and stops reads while disconnected", async () => {
  let reads = 0, queue = empty;
  vi.stubGlobal("fetch", vi.fn(async () => { reads++; return response(envelope(queue)); }));
  const view = renderHook(({ version, connected }) => useInputQueue(task, version, connected), { initialProps: { version: 0, connected: true } });
  await waitFor(() => expect(view.result.current.queue).toBeTruthy());
  queue = { ...empty, revision: 1, items: [item] }; view.rerender({ version: 1, connected: true });
  await waitFor(() => expect(view.result.current.queue?.revision).toBe(1));
  view.rerender({ version: 1, connected: false }); const stopped = reads;
  vi.useFakeTimers(); await act(async () => { await vi.advanceTimersByTimeAsync(INPUT_RECONCILE_MS * 2); }); expect(reads).toBe(stopped);
  queue = { ...queue, revision: 2 }; view.rerender({ version: 2, connected: true });
  await act(async () => { await Promise.resolve(); }); expect(view.result.current.queue?.revision).toBe(2);
});

it("rejects malformed input envelopes and resolves the session scope before applying a queue", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => response({ protocol: 1, queue: { ...empty, revision: -1 } })));
  await expect(inputApi({ type: "getInputs", target: { projectId: "p", taskId: "task" } })).rejects.toMatchObject({ message: "INPUT_RESPONSE_INVALID", uncertain: false });
  vi.stubGlobal("fetch", vi.fn(async () => response(envelope({ ...empty, scope: { projectId: "p", sessionId: "wrong" } }))));
  const { result } = renderHook(() => useInputQueue(task)); await waitFor(() => expect(result.current.error).toBe("INPUT_SCOPE_MISMATCH"));
  expect(result.current.queue).toBeNull();
});

it("requires the complete submitted content in a successful queue response before clearing its source", async () => {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => response(JSON.parse(options.body).type === "getInputs" ? envelope() : empty)));
  const { result } = renderHook(() => useInputQueue(task)); await waitFor(() => expect(result.current.queue).toBeTruthy());
  await act(async () => { await result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input }); });
  expect(result.current.uncertain).toBe(true); expect(result.current.confirmed).toBeNull();
});

it("does not start a stale recovery read when an in-flight write finishes after disconnect", async () => {
  const held = deferred<Response>(); let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (JSON.parse(options.body).type === "getInputs") { reads++; return response(envelope()); }
    return held.promise;
  }));
  const view = renderHook(({ connected }) => useInputQueue(task, 0, connected), { initialProps: { connected: true } });
  await waitFor(() => expect(view.result.current.queue).toBeTruthy());
  let mutation!: Promise<unknown>; act(() => { mutation = view.result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input }); });
  view.rerender({ connected: false }); const stopped = reads;
  await act(async () => { held.resolve(response({ ...empty, revision: 1, items: [item] })); await mutation; });
  expect(reads).toBe(stopped); expect(view.result.current.queue?.revision).toBe(1);
});

it("coalesces dirty hints and slow read intervals, then reconciles once without starving updates", async () => {
  const held = deferred<Response>(); let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async () => { reads++; return reads === 1 ? held.promise : response(envelope({ ...empty, revision: 1, items: [item] })); }));
  vi.useFakeTimers();
  const view = renderHook(({ version }) => useInputQueue(task, version), { initialProps: { version: 0 } });
  expect(reads).toBe(1); view.rerender({ version: 1 }); expect(reads).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(INPUT_RECONCILE_MS * 2); }); expect(reads).toBe(1);
  await act(async () => { held.resolve(response(envelope())); });
  expect(reads).toBe(2); expect(view.result.current.queue?.revision).toBe(1);
});

it("clears a recovered read failure while retaining a rejected mutation's CAS error", async () => {
  let reads = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (JSON.parse(options.body).type !== "getInputs") return new Response(JSON.stringify({ code: "INPUT_REVISION_CONFLICT" }), { status: 409 });
    if (++reads === 1) throw new TypeError("controlled read failure");
    return response(envelope());
  }));
  const { result } = renderHook(() => useInputQueue(task));
  await waitFor(() => expect(result.current.error).toBe("INPUT_RESULT_UNCONFIRMED"));
  await act(async () => { await result.current.refresh(); }); expect(result.current.error).toBe("");
  await act(async () => { await result.current.act({ type: "enqueueInput", predecessorTaskId: "task", expectedRevision: 0, input }); });
  await act(async () => { await result.current.refresh(); }); expect(result.current.error).toBe("INPUT_REVISION_CONFLICT");
});
