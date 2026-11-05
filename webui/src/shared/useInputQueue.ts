import { useCallback, useEffect, useRef, useState } from "react";
import type { HostTask, QueueShardV1 } from "../../../packages/host/contracts";
import { confirmsQueueCommand, inputApi, InputRequestError, type QueueAction, type QueueCommand } from "./inputApi";

export const INPUT_RECONCILE_MS = 15000;
export function useInputQueue(task: Pick<HostTask, "projectId" | "taskId" | "sessionId">, inputRevision = 0, connected = true) {
  const key = JSON.stringify([task.projectId, task.taskId, task.sessionId]);
  const active = useRef(key); active.current = key;
  const available = useRef(connected); available.current = connected;
  const observedInputRevision = useRef(inputRevision);
  const generation = useRef(0), current = useRef<QueueShardV1 | null>(null);
  const pending = useRef<{ command: QueueCommand; key: string; busy: boolean } | null>(null);
  const reading = useRef<{ key: string; again: boolean; controller: AbortController; promise: Promise<QueueShardV1 | undefined> } | null>(null);
  const [queue, setQueue] = useState<QueueShardV1 | null>(null), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [commandError, setError] = useState(""), [readError, setReadError] = useState("");
  const [confirmed, setConfirmed] = useState<{ command: QueueCommand; queue: QueueShardV1 } | null>(null);
  const [synchronized, setSynchronized] = useState(false);
  const accept = useCallback((value: QueueShardV1) => {
    if (active.current !== key || value.scope.projectId !== task.projectId || value.scope.sessionId !== task.sessionId) return false;
    if (current.current && value.revision < current.current.revision) return false;
    current.current = value; setQueue(value); setReadError(""); setSynchronized(true); return true;
  }, [key, task.projectId, task.sessionId]);
  const refresh = useCallback((): Promise<QueueShardV1 | undefined> => {
    if (!task.sessionId || !available.current || active.current !== key || pending.current?.busy) return Promise.resolve(undefined);
    if (reading.current?.key === key) { reading.current.again = true; return reading.current.promise; }
    const version = ++generation.current, read = { key, again: false, controller: new AbortController(), promise: Promise.resolve<QueueShardV1 | undefined>(undefined) };
    reading.current = read;
    read.promise = (async () => {
      try {
        const value = await inputApi({ type: "getInputs", target: { projectId: task.projectId, taskId: task.taskId } }, read.controller.signal);
        if (value.queue.scope.sessionId !== task.sessionId) throw new InputRequestError("INPUT_SCOPE_MISMATCH");
        if (read.controller.signal.aborted || active.current !== key || version !== generation.current || !accept(value.queue)) return;
        const owner = pending.current;
        if (owner?.key === key && confirmsQueueCommand(value.queue, owner.command)) {
          pending.current = null; setUncertain(false); setError(""); setConfirmed({ command: owner.command, queue: value.queue });
        }
        return value.queue;
      } catch (cause) { if (!read.controller.signal.aborted && active.current === key && version === generation.current) { setSynchronized(false); setReadError(cause instanceof Error ? cause.message : "INPUT_REQUEST_FAILED"); } }
      finally {
        if (reading.current === read) { reading.current = null; if (read.again && !read.controller.signal.aborted) void refresh(); }
      }
    })();
    return read.promise;
  }, [key, task.projectId, task.taskId, task.sessionId, accept]);
  useEffect(() => {
    active.current = key; generation.current++; current.current = null; pending.current = null;
    setQueue(null); setBusy(false); setUncertain(false); setConfirmed(null); setError(""); setReadError(""); setSynchronized(false);
    return () => { generation.current++; if (active.current === key) active.current = ""; };
  }, [key]);
  useEffect(() => {
    observedInputRevision.current = inputRevision;
    void refresh();
    const timer = connected ? setInterval(() => void refresh(), INPUT_RECONCILE_MS) : undefined;
    return () => { if (reading.current?.key === key) { reading.current.controller.abort(); reading.current = null; } clearInterval(timer); };
  }, [refresh, key, connected]);
  useEffect(() => { if (observedInputRevision.current !== inputRevision) { observedInputRevision.current = inputRevision; void refresh(); } }, [refresh, inputRevision]);
  async function act(action: QueueAction) {
    if (pending.current || !available.current || !task.sessionId) return;
    const owner = { command: { ...structuredClone(action), target: { projectId: task.projectId, taskId: task.taskId } } as QueueCommand, key, busy: true };
    pending.current = owner; generation.current++;
    if (reading.current?.key === key) { reading.current.controller.abort(); reading.current = null; }
    setBusy(true); setError(""); setSynchronized(false);
    try {
      const value = await inputApi(owner.command);
      if (active.current !== key || pending.current !== owner) return;
      if (!accept(value) || "input" in owner.command && !confirmsQueueCommand(value, owner.command)) throw new InputRequestError("INPUT_RESPONSE_INVALID", true);
      pending.current = null; setUncertain(false); setConfirmed({ command: owner.command, queue: value });
      return value;
    } catch (cause) {
      if (active.current !== key || pending.current !== owner) return;
      const unknown = cause instanceof InputRequestError && cause.uncertain;
      if (!unknown) pending.current = null;
      setUncertain(unknown); setError(cause instanceof Error ? cause.message : "INPUT_REQUEST_FAILED");
    } finally {
      owner.busy = false;
      if (active.current === key) { setBusy(false); void refresh(); }
    }
  }
  return { queue, busy, uncertain, synchronized, error: commandError || readError, setError, confirmed, act, refresh };
}
