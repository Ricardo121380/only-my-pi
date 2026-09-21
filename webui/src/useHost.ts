import { useEffect, useRef, useState } from "react";
import type { HostEvent, HostSnapshot, HostTask } from "../../packages/host/contracts";
import { api, applyEvent, errorText, query } from "./api";

export function useHost(taskId: string | null) {
  const [snapshot, setSnapshot] = useState<HostSnapshot | null>(null);
  const [task, setTask] = useState<HostTask | null>(null);
  const [connection, setConnection] = useState("正在连接");
  const [error, setError] = useState("");
  const selected = useRef(taskId); selected.current = taskId;
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false, socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout>;
    let current: HostSnapshot | null = null, failures = 0;
    const controller = new AbortController();
    async function connect() {
      try {
        const state = await api<HostSnapshot>("/api/state", undefined, controller.signal);
        if (state.protocol !== 2) throw new Error("PROTOCOL_MISMATCH");
        if (disposed) return;
        socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/events?protocol=2`);
        socket.onmessage = ({ data }) => {
          try {
            const event = JSON.parse(data) as HostEvent;
            current = applyEvent(current, event); setSnapshot(current);
            if (event.type === "snapshot") {
              failures = 0; setConnection("已连接"); setError("");
              const id = selected.current, version = ++generation.current;
              if (id) void api<HostTask>(query("task", { taskId: id }), undefined, controller.signal).then((value) => { if (!disposed && selected.current === id && generation.current === version) setTask(value); }).catch(() => {});
            } else if (event.type === "task" && event.data.taskId === selected.current) { generation.current++; setTask(event.data); }
          } catch { socket?.close(); }
        };
        socket.onclose = () => { if (!disposed) { setConnection("连接中断，正在重连"); timer = setTimeout(connect, Math.min(5000, 500 * 2 ** failures++)); } };
        socket.onerror = () => socket?.close();
      } catch (cause) {
        if (disposed) return;
        setConnection("未连接"); setError(errorText(cause));
        if (!(cause instanceof Error && /AUTH_REQUIRED|PROTOCOL_MISMATCH/.test(cause.message))) timer = setTimeout(connect, 2000);
      }
    }
    async function initialize() {
      const pair = new URLSearchParams(location.hash.slice(1)).get("pair");
      if (pair) {
        history.replaceState(null, "", location.pathname);
        try {
          const response = await fetch("/pair", { method: "POST", signal: controller.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ token: pair }) });
          if (!response.ok) throw new Error((await response.json()).code);
        } catch (cause) { if (!disposed) { setError(errorText(cause)); setConnection("配对失败"); } return; }
      }
      await connect();
    }
    void initialize();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); socket?.close(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), version = ++generation.current;
    setTask(null);
    if (taskId) void api<HostTask>(query("task", { taskId }), undefined, controller.signal).then((value) => { if (generation.current === version) setTask(value); }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [taskId]);
  return { snapshot, task, connection, error, setError, setTask };
}
