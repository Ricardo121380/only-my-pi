import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { InputContentV1, InputRecordV1, TaskSummary } from "../../../packages/host/contracts";
import { sameInput } from "../../../webui/src/inputApi";
import { useInputQueue } from "../../../webui/src/useInputQueue";
import { isTaskActive } from "../../../webui/src/useNativeSession";
import { fieldClass, Notice } from "./ui";

const messages: Record<string, string> = {
  INPUT_BINDING_CHANGED: "任务的账号、模型或配置已变化，输入未投递。请核对后明确处理。",
  INPUT_REVISION_CONFLICT: "队列已被其他操作更新，编辑内容已保留。请先核对当前版本。",
  INPUT_RESULT_UNCONFIRMED: "请求结果未知，正在按原编号回查；不会自动重发。",
  INPUT_RESPONSE_INVALID: "Host 输入响应无法确认，请核对队列状态。",
  TASK_NOT_RUNNING: "任务已结束或正在停止，补充不会转换为新任务。请核对队列。",
  INPUT_RECONCILIATION_REQUIRED: "队列存在尚待核对的输入，请先核对消费回执。",
  AUTH_REQUIRED: "Host 配对已失效，请重新配对后核对输入。",
};
const hasReceipt = (item: InputRecordV1) => !!item.consumedEntryId && /^sha256:[a-f0-9]{64}$/.test(item.contentDigest);
const pending = (item: InputRecordV1) => item.state !== "removed" && (item.state !== "consumed" || !hasReceipt(item));
function stateLabel(item: InputRecordV1) {
  if (item.state === "consumed") return hasReceipt(item) ? "Pi 已消费" : "消费凭据待核对";
  return { draft: "未提交", queued: "已保存，等待执行", dispatching: "正在投递", accepted: "Pi 已接收，等待消费凭据", paused: "已暂停", unknown: "结果未知，待核对", removed: "已移除，未投递" }[item.state];
}

export function NativeInputs({ task, inputRevision, connected, text, textVersion, isComposing, onAccepted, onBlocked }: {
  task: TaskSummary; inputRevision: number; connected: boolean; text: string; textVersion: number;
  isComposing: () => boolean; onAccepted: (text: string, version: number) => void; onBlocked: (blocked: boolean) => void;
}) {
  const { queue, busy, uncertain, error, confirmed, act, refresh } = useInputQueue(task, inputRevision, connected);
  const submitted = useRef<{ input: InputContentV1; version: number } | null>(null), editingVersion = useRef(0), delivering = useRef(false);
  const [review, setReview] = useState<{ input: InputContentV1; queueRevision: number; revision: number; version: number } | null>(null);
  const editing = useRef<{ input: InputContentV1; version: number } | null>(null);
  const active = isTaskActive(task.status), locked = busy || uncertain || !connected;
  const deliveryBlocked = !!queue?.items.some(item => item.state === "unknown");
  const bound = !!task.accountId && !!task.thinkingLevel && task.resourceRevision !== undefined;
  const unprocessed = queue?.items.some(pending) ?? true;
  useEffect(() => { onBlocked(!queue || busy || uncertain || !!error || unprocessed); }, [queue, busy, uncertain, error, unprocessed, onBlocked]);
  useEffect(() => {
    if (!confirmed) return;
    const command = confirmed.command;
    if ((command.type === "enqueueInput" || command.type === "deliverSupplement") && submitted.current && sameInput(submitted.current.input, command.input)) {
      onAccepted(submitted.current.input.text, submitted.current.version); submitted.current = null;
    }
    if (command.type === "editQueuedInput" && editing.current && sameInput(editing.current.input, command.input) && editing.current.version === editingVersion.current) {
      setReview(null); editing.current = null;
    }
  }, [confirmed, onAccepted]);
  function deliver(delivery: "steer" | "queue") {
    if (delivering.current || locked || deliveryBlocked || !queue || !text.trim() || text.length > 32768 || isComposing() || task.status !== "running" || !bound || review) return;
    const input: InputContentV1 = { inputId: crypto.randomUUID(), delivery, text, materialSnapshotIds: [], binding: { accountId: task.accountId!, modelId: task.model, thinking: task.thinkingLevel!, mode: task.mode ?? "readonly", resourceRevision: task.resourceRevision! } };
    submitted.current = { input, version: textVersion };
    delivering.current = true;
    void act(delivery === "steer" ? { type: "deliverSupplement", taskId: task.taskId, input, expectedRevision: queue.revision } : { type: "enqueueInput", predecessorTaskId: task.taskId, input, expectedRevision: queue.revision }).finally(() => { delivering.current = false; });
  }
  const reviewed = queue?.items.find(item => item.inputId === review?.input.inputId);
  const changed = !!review && (review.queueRevision !== queue?.revision || review.revision !== reviewed?.revision);
  return <section className="mx-auto mt-2 max-w-[660px] space-y-2 text-[12px]" aria-label="即时补充与排队">
    {active && <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="outline" size="sm" className="h-7 rounded-full text-[12px]" disabled={locked || deliveryBlocked || !queue || !bound || !text.trim() || task.status !== "running" || !!review} onClick={() => deliver("steer")}>即时补充</Button><Button type="button" variant="outline" size="sm" className="h-7 rounded-full text-[12px]" disabled={locked || deliveryBlocked || !queue || !bound || !text.trim() || task.status !== "running" || !!review} onClick={() => deliver("queue")}>留待下一任务</Button><span className="text-[11px] text-muted-foreground">使用上方输入；补充在 Pi 可接收的位置生效。</span></div>}
    {error && <Notice error>{messages[error] ?? `输入操作未完成（${error}）。请核对状态，原文保留。`}</Notice>}
    {uncertain && <p role="status" className="text-planning">结果待核对，不会自动重发，也不会开始另一条输入。</p>}
    <details className="rounded-xl border border-line bg-card/60" open={unprocessed || undefined}><summary className="cursor-pointer px-3 py-2 text-muted-foreground">消息队列与消费回执{queue ? ` · ${queue.items.filter(pending).length} 条待处理` : " · 正在读取"}</summary><div className="max-h-64 space-y-3 overflow-auto px-3 pb-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">排队消息在当前任务成功后逐条运行；后续任务从只读状态开始。Pi 已消费表示输入进入原生历史，不表示回答或工具已完成。</p>
      <Button type="button" size="sm" variant="ghost" className="h-7 text-[12px]" disabled={busy || !connected} onClick={() => void refresh()}>核对输入状态</Button>
      {queue?.items.slice(-20).map(item => <article key={item.inputId} className="space-y-1 rounded-lg bg-muted/60 p-2.5"><p className="flex flex-wrap gap-x-2 gap-y-1"><span>{item.delivery === "steer" ? "即时补充" : item.delivery === "queue" ? "排队消息" : "会话输入"}</span><span role="status" className={item.state === "unknown" || item.state === "paused" ? "text-planning" : "text-muted-foreground"}>{stateLabel(item)}</span></p><pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words font-sans">{item.text}</pre><p className="break-all text-[10.5px] text-muted-foreground">{item.binding.modelId} · {item.binding.thinking} · {item.binding.mode === "controlled" ? "修改需审批" : "只读"}</p>{item.pauseReason && <p className="text-[11px] text-planning">{messages[item.pauseReason] ?? `暂停原因：${item.pauseReason}`}</p>}
        {["queued", "paused"].includes(item.state) && <div className="flex gap-2"><button type="button" className="text-primary underline disabled:opacity-50" disabled={locked} onClick={() => { if (!queue) return; const { inputId, delivery, text, materialSnapshotIds, binding } = item; const version = ++editingVersion.current; setReview({ input: { inputId, delivery, text, materialSnapshotIds, binding }, queueRevision: queue.revision, revision: item.revision, version }); }}>编辑未投递消息</button><button type="button" className="text-muted-foreground underline disabled:opacity-50" disabled={locked} onClick={() => { if (queue) void act({ type: "removeQueuedInput", inputId: item.inputId, expectedRevision: queue.revision, expectedInputRevision: item.revision }); }}>移除未投递消息</button></div>}
        {["unknown", "accepted", "dispatching"].includes(item.state) && <button type="button" className="text-primary underline disabled:opacity-50" disabled={locked} onClick={() => void act({ type: "reconcileInput", inputId: item.inputId })}>核对消费回执</button>}
      </article>)}
      {queue && !queue.items.length && <p className="text-muted-foreground">没有排队消息或补充记录。</p>}
      {queue && review && <div className="space-y-2 rounded-lg border border-line p-2"><label className="block space-y-1"><span>编辑待投递消息</span><textarea aria-label="编辑待投递消息" className={fieldClass} rows={3} maxLength={32768} value={review.input.text} onChange={event => { const version = ++editingVersion.current; setReview({ ...review, version, input: { ...review.input, text: event.target.value } }); }} /></label>{changed && <Notice>队列版本已变化，编辑内容已保留。请比较当前消息后采用新版本。</Notice>}<div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked || changed || !review.input.text.trim()} onClick={() => { editing.current = { input: review.input, version: review.version }; void act({ type: "editQueuedInput", input: review.input, expectedRevision: review.queueRevision, expectedInputRevision: review.revision }); }}>保存待投递消息</Button>{changed && reviewed && ["queued", "paused"].includes(reviewed.state) && <Button type="button" size="sm" variant="outline" disabled={locked} onClick={() => setReview({ ...review, queueRevision: queue.revision, revision: reviewed.revision })}>已核对，采用当前版本</Button>}<Button type="button" size="sm" variant="ghost" onClick={() => { editingVersion.current++; setReview(null); }}>关闭编辑</Button></div></div>}
      {!active && queue?.items.some(item => ["queued", "paused"].includes(item.state)) && <Button type="button" size="sm" variant="outline" disabled={locked || !!review || queue.items.some(item => ["unknown", "dispatching", "accepted"].includes(item.state))} onClick={() => void act({ type: "resumeQueue", expectedRevision: queue.revision })}>明确投递队列</Button>}
    </div></details>
  </section>;
}
