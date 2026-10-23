import { useEffect, useRef, useState } from "react";
import type { HostTask, InputContentV1, QueueShardV1 } from "../../packages/host/contracts";
import { settingsApi } from "./ProductSettings";

export function SettingsQueue({ task }: { task: HostTask }) {
  const [queue, setQueue] = useState<QueueShardV1 | null>(null), [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState<{ item: InputContentV1; revision: number; label: string } | null>(null);
  const pending = useRef(false), running = ["starting", "running", "cancelling"].includes(task.status);
  async function command<T>(input: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch("/api/input-command", { method: "POST", signal, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, body: JSON.stringify({ ...input, target: { projectId: task.projectId, taskId: task.taskId } }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.code ?? "INPUT_REQUEST_FAILED"); return value;
  }
  useEffect(() => {
    if (!task.sessionId) return;
    const controller = new AbortController();
    const read = async () => { try { const result = await command<{ queue: QueueShardV1 }>({ type: "getInputs" }, controller.signal); if (!controller.signal.aborted && !pending.current) setQueue(result.queue); } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "INPUT_REQUEST_FAILED"); } };
    void read(); const timer = setInterval(() => { if (!pending.current) void read(); }, 1000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [task.taskId, task.sessionId]);
  async function act(input: object) {
    if (pending.current) return; pending.current = true; setBusy(true); setError("");
    try { const result = await command<QueueShardV1>(input); setQueue(result); return result; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "INPUT_REQUEST_FAILED"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <details className="mcp-panel"><summary>任务配置与消息队列</summary>
    <p>本任务固定资源版本：{task.resourceRevision ?? "旧任务未记录"}；工具设置版本：{task.settingsLoaded?.revision ?? "尚未收到实际加载回执"}。</p>
    {task.settingsSnapshot && <p>本任务参数：{JSON.stringify(task.settingsSnapshot.resources.find(r => r.id === "context-doctor")?.parameters)}；技能：{task.settingsLoaded?.skills.join("、") || "无"}</p>}
    <p>新配置只用于下一任务。旧版本消息会暂停；核对并保存待投递内容后，仍需明确投递。结果未知的消息须先核对，不能重新发送。</p>
    {error && <p role="alert">{error === "INPUT_BINDING_CHANGED" ? "配置或账号绑定已变化。消息未发送，请核对当前配置后明确重新投递。" : error}</p>}
    {running && task.sessionId && <><label className="field">下一任务消息<textarea aria-label="下一任务消息" value={text} maxLength={32768} onChange={e => setText(e.target.value)} /></label><button className="softbtn" disabled={busy || !text.trim() || !queue || task.status !== "running" || !task.accountId || !task.thinkingLevel || task.resourceRevision === undefined} onClick={() => void act({ type: "enqueueInput", predecessorTaskId: task.taskId, expectedRevision: queue!.revision, input: { inputId: crypto.randomUUID(), delivery: "queue", text, materialSnapshotIds: [], binding: { accountId: task.accountId, modelId: task.model, thinking: task.thinkingLevel, mode: task.mode ?? "readonly", resourceRevision: task.resourceRevision } } }).then(value => { if (value) setText(""); })}>留待下一任务</button></>}
    {queue?.items.filter(item => !["consumed", "removed"].includes(item.state)).map(item => <div key={item.inputId}><p>{item.text} · {item.state === "paused" ? "已暂停，待核对" : item.state} · 原资源版本 {item.binding.resourceRevision}</p>{item.pauseReason && <p>{item.pauseReason}</p>}{["paused", "queued"].includes(item.state) && <button className="softbtn" disabled={busy || running} onClick={() => { setError(""); void settingsApi<{ resourceRevision: number; resources: { id: string; parameters: object }[] }>({ type: "list" }, task.projectId).then(current => setReview({ item: { inputId: item.inputId, delivery: item.delivery, text: item.text, materialSnapshotIds: item.materialSnapshotIds, binding: { ...item.binding, resourceRevision: current.resourceRevision } }, revision: item.revision, label: JSON.stringify(current.resources.find(r => r.id === "context-doctor")?.parameters) })).catch(cause => setError(cause.message)); }}>核对当前配置与消息</button>}</div>)}
    {review && queue && <section><p>采用当前参数：{review.label}；新资源版本 {review.item.binding.resourceRevision}。保存后继续暂停。</p><label className="field">核对消息<textarea aria-label="核对消息" value={review.item.text} onChange={e => setReview({ ...review, item: { ...review.item, text: e.target.value } })} /></label><button className="softbtn" disabled={busy || running || !review.item.text.trim()} onClick={() => void act({ type: "editQueuedInput", input: review.item, expectedRevision: queue.revision, expectedInputRevision: review.revision }).then(value => { if (value) setReview(null); })}>保存已核对的待投递消息</button></section>}
    {!running && queue?.items.some(item => ["paused", "queued"].includes(item.state)) && <button className="softbtn" disabled={busy || !!review || queue.items.some(item => ["unknown", "dispatching", "accepted"].includes(item.state))} onClick={() => void act({ type: "resumeQueue", expectedRevision: queue.revision })}>明确投递队列</button>}
    {!queue?.items.some(item => !["consumed", "removed"].includes(item.state)) && <p>没有待投递消息。</p>}
  </details>;
}
