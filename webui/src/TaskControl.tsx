import { useRef, useState } from "react";
import type { HostTask } from "../../packages/host/contracts";
import { api, errorText } from "./api";

export function TaskControl({ task, connected }: { task: HostTask; connected: boolean }) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState<string[]>([]);
  const running = task.status === "starting" || task.status === "running";
  async function act(approvalId?: string, value?: string | boolean) {
    if (pending.current || !connected || !running || (approvalId && submitted.includes(approvalId))) return;
    pending.current = true; setBusy(true); setNotice("");
    try {
      await api<HostTask>("/api/command", approvalId
        ? { type: "answerApproval", taskId: task.taskId, approvalId, value: value! }
        : { type: "revokeTask", taskId: task.taskId });
      if (approvalId) setSubmitted((ids) => [...ids, approvalId]);
      setNotice(approvalId ? "决定已提交，等待运行时状态更新；不代表执行完成。" : "运行时已确认撤权；已产生的改动不会回滚。");
    } catch (error) { setNotice(errorText(error)); }
    finally { pending.current = false; setBusy(false); }
  }
  if (task.mode !== "controlled" && !task.mcp?.enabled) return null;
  const orchestration = task.orchestration;
  return <section className="host-control" aria-label="受控执行">
    <div className="between"><strong>{task.mode !== "controlled" ? `MCP 只读 · 配置版本 ${task.mcp?.revision}` : !running ? "本次运行已停止 · 不保留编程授权" : task.access === "coding" ? "本次进程已获编程授权" : "Inspect · 尚无编程授权"}</strong><button className="softbtn" disabled={!running || !connected || busy} onClick={() => void act()}>撤销授权</button></div>
    {!connected && <p role="status">连接已断开，审批暂停；重连后以宿主状态为准。</p>}
    {task.approvals?.map((approval) => <section className="host-approval" key={approval.approvalId} aria-label="待决定的操作">
      <strong>等待你的决定</strong><pre>{approval.title}{approval.message ? `\n${approval.message}` : ""}</pre>
      <p>{approval.title.startsWith("MCP · ") ? "MCP 许可只覆盖上述工具、目标和任务。仅本次只调用一次；本任务许可在任务结束、撤销或定义变化后失效。写入还需有效编程授权、项目写入所有权及受限服务进程。" : "授权范围以上述说明为准；编程授权可持续至本进程结束或撤销。"}关闭页面或等待超时不会同意。</p>
      <div className="account-actions">{(approval.kind === "confirm" ? [{ label: "拒绝", value: false }, { label: "允许本次验证", value: true }] : (approval.options ?? []).map((value) => ({ label: value, value }))).map((choice) => <button className="softbtn" key={String(choice.value)} disabled={busy || !connected || !running || submitted.includes(approval.approvalId) || Date.now() >= Date.parse(approval.expiresAt)} onClick={() => void act(approval.approvalId, choice.value)}>{choice.label}</button>)}</div>
    </section>)}
    {notice && running && <p role="status">{notice}</p>}
    {orchestration && <details><summary>子代理与预算 · {orchestration.totalChildren ?? "未知"} / {orchestration.maximumChildren ?? "未知"}</summary>
      <p>仅统计子代理，不包含主 Agent。状态：{orchestration.budget.status}</p>
      <p>Tokens：{orchestration.budget.used.tokens ?? "未报告"} / {orchestration.budget.limits.maxTotalTokens ?? "未知"} · 费用：{orchestration.budget.used.costUsd == null ? "未报告" : `$${orchestration.budget.used.costUsd.toFixed(6)}`}</p>
      <ul>{orchestration.children.map((child, index) => <li key={`${child.label}-${index}`}>{child.label} · {child.agent ?? "未知角色"} · {child.status}</li>)}</ul>
    </details>}
  </section>;
}
