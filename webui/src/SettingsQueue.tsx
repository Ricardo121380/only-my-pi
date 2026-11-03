import { useEffect, useRef, useState } from "react";
import type { HostTask, InputContentV1, InputRecordV1 } from "../../packages/host/contracts";
import { settingsApi } from "./settingsApi";
import { sameInput } from "./inputApi";
import { useInputQueue } from "./useInputQueue";
import "./mcp.css";

export function SettingsQueue({ task, inputRevision = 0, connected = true }: { task: HostTask; inputRevision?: number; connected?: boolean }) {
  const { queue, busy, uncertain, error, setError, confirmed, act, refresh } = useInputQueue(task, inputRevision, connected);
  const [text, setText] = useState("");
  const [review, setReview] = useState<{ item: InputContentV1; revision: number; queueRevision: number; label: string } | null>(null);
  const textVersion = useRef(0), reviewVersion = useRef(0);
  const submission = useRef<{ input: InputContentV1; version: number } | null>(null), reviewSubmission = useRef<{ inputId: string; version: number } | null>(null);
  const running = ["starting", "running", "cancelling"].includes(task.status), locked = busy || uncertain || !connected;
  useEffect(() => {
    textVersion.current++; reviewVersion.current++; submission.current = null; reviewSubmission.current = null; setText(""); setReview(null);
  }, [task.projectId, task.taskId]);
  useEffect(() => {
    if (!confirmed) return;
    const command = confirmed.command;
    if (command.type === "enqueueInput" && submission.current && sameInput(submission.current.input, command.input)) {
      if (textVersion.current === submission.current.version) { textVersion.current++; setText(""); }
      submission.current = null;
    }
    if (command.type === "editQueuedInput" && reviewSubmission.current?.inputId === command.input.inputId && reviewVersion.current === reviewSubmission.current.version) {
      setReview(null); reviewSubmission.current = null;
    }
  }, [confirmed]);
  function enqueue() {
    if (!queue || !task.accountId || !task.thinkingLevel || task.resourceRevision === undefined) return;
    const input: InputContentV1 = { inputId: submission.current?.input.inputId ?? crypto.randomUUID(), delivery: "queue", text, materialSnapshotIds: [], binding: { accountId: task.accountId, modelId: task.model, thinking: task.thinkingLevel, mode: task.mode ?? "readonly", resourceRevision: task.resourceRevision } };
    if (submission.current && !sameInput(submission.current.input, input)) input.inputId = crypto.randomUUID();
    submission.current = { input, version: textVersion.current };
    void act({ type: "enqueueInput", predecessorTaskId: task.taskId, expectedRevision: queue.revision, input });
  }
  function openReview(item: InputRecordV1) {
    if (!queue) return;
    const version = ++reviewVersion.current, queueRevision = queue.revision;
    setError("");
    void settingsApi<{ resourceRevision: number; resources: { id: string; parameters: object }[] }>({ type: "list" }, task.projectId).then(current => {
      if (reviewVersion.current !== version) return;
      setReview({ item: { inputId: item.inputId, delivery: item.delivery, text: item.text, materialSnapshotIds: item.materialSnapshotIds, binding: { ...item.binding, resourceRevision: current.resourceRevision } }, revision: item.revision, queueRevision, label: JSON.stringify(current.resources.find(r => r.id === "context-doctor")?.parameters) });
    }).catch(cause => { if (reviewVersion.current === version) setError(cause.message); });
  }
  const reviewedItem = queue?.items.find(item => item.inputId === review?.item.inputId);
  const reviewChanged = !!review && (queue?.revision !== review.queueRevision || reviewedItem?.revision !== review.revision);
  const messages: Record<string, string> = { INPUT_BINDING_CHANGED: "配置或账号绑定已变化。消息未发送，请核对当前配置后明确重新投递。", INPUT_REVISION_CONFLICT: "队列已变化，未覆盖。输入已保留，请核对当前队列版本。", INPUT_RESULT_UNCONFIRMED: "请求结果尚未确认。保留原输入，按原编号核对，不重复发送。", INPUT_RESPONSE_INVALID: "输入响应不符合当前协议，请核对 Host 状态。" };
  return <details className="mcp-panel task-input-queue"><summary>任务配置与消息队列</summary>
    <p>本任务固定资源版本：{task.resourceRevision ?? "旧任务未记录"}；工具设置版本：{task.settingsLoaded?.revision ?? "尚未收到实际加载回执"}。</p>
    {task.settingsSnapshot && <p>本任务参数：{JSON.stringify(task.settingsSnapshot.resources.find(r => r.id === "context-doctor")?.parameters)}；技能：{task.settingsLoaded?.skills.join("、") || "无"}</p>}
    <p>新配置只用于下一任务。旧版本消息会暂停；核对并保存待投递内容后，仍需明确投递。结果未知的消息须先核对，不能重新发送。</p>
    {error && <p role="alert">{messages[error] ?? error}</p>}
    {uncertain && <p role="status">正在按原请求编号核对队列；不会自动重发。</p>}
    <button className="softbtn" disabled={busy || !connected || !task.sessionId} onClick={() => void refresh()}>核对消息队列</button>
    {running && task.sessionId && <><label className="field">下一任务消息<textarea aria-label="下一任务消息" value={text} maxLength={32768} onChange={event => { textVersion.current++; setText(event.target.value); }} /></label><button className="softbtn" disabled={locked || !text.trim() || !queue || task.status !== "running" || !task.accountId || !task.thinkingLevel || task.resourceRevision === undefined} onClick={enqueue}>留待下一任务</button></>}
    {queue?.items.filter(item => !["consumed", "removed"].includes(item.state)).map(item => <div key={item.inputId}><p>{item.text} · {item.state === "paused" ? "已暂停，待核对" : item.state} · 原资源版本 {item.binding.resourceRevision}</p>{item.pauseReason && <p>{item.pauseReason}</p>}{["paused", "queued"].includes(item.state) && <button className="softbtn" disabled={locked || running} onClick={() => openReview(item)}>核对当前配置与消息</button>}</div>)}
    {review && queue && <section><p>采用已核对参数：{review.label}；资源版本 {review.item.binding.resourceRevision}。保存后继续暂停。</p><label className="field">核对消息<textarea aria-label="核对消息" value={review.item.text} onChange={event => { reviewVersion.current++; setReview({ ...review, item: { ...review.item, text: event.target.value } }); }} /></label>
      {reviewChanged && <p role="status">队列版本已变化，编辑内容已保留。请比较当前消息后明确采用新版本。</p>}
      <button className="softbtn" disabled={locked || running || reviewChanged || !review.item.text.trim()} onClick={() => { reviewSubmission.current = { inputId: review.item.inputId, version: reviewVersion.current }; void act({ type: "editQueuedInput", input: review.item, expectedRevision: review.queueRevision, expectedInputRevision: review.revision }); }}>保存已核对的待投递消息</button>
      {reviewChanged && reviewedItem && ["queued", "paused"].includes(reviewedItem.state) && <button className="softbtn" disabled={locked || running} onClick={() => setReview({ ...review, revision: reviewedItem.revision, queueRevision: queue.revision })}>已核对，采用当前队列版本</button>}
    </section>}
    {!running && queue?.items.some(item => ["paused", "queued"].includes(item.state)) && <button className="softbtn" disabled={locked || !!review || queue.items.some(item => ["unknown", "dispatching", "accepted"].includes(item.state))} onClick={() => void act({ type: "resumeQueue", expectedRevision: queue.revision })}>明确投递队列</button>}
    {!queue ? <p>{task.sessionId ? "正在读取输入队列…" : "等待会话就绪。"}</p> : !queue.items.some(item => !["consumed", "removed"].includes(item.state)) && <p>没有待投递消息。</p>}
  </details>;
}
