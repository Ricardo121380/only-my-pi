import { useState } from "react";
import type { Project, TaskSummary } from "../../../packages/host/contracts";
import { HostDialog } from "./HostDialog";
import { Icon } from "./Icon";

export const runLabels = { starting: "正在启动", running: "正在回复", cancelling: "正在停止", succeeded: "本轮结束", failed: "本轮失败", cancelled: "已停止", interrupted: "运行已中断" };
const toolLabels = { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消", unknown: "结果未知" };

export function ToolActivity({ task }: { task: TaskSummary }) {
  const [open, setOpen] = useState(false);
  const calls = task.toolCalls ?? [];
  if (!calls.length) return null;
  const completed = calls.filter(call => call.status === "completed").length;
  const running = calls.some(call => call.status === "running");
  return <section className="activity-dock" aria-label="本轮工具记录">
    <button className="activity-toggle" aria-expanded={open} aria-controls="minimal-tool-records" onClick={() => setOpen(value => !value)}>
      <Icon name={running ? "activity" : "layers"} /><span>本轮工具记录</span><small>{completed} / {calls.length} 已完成</small><Icon name="chevron-down" />
    </button>
    <div className={`activity-disclosure ${open ? "is-open" : ""}`} inert={!open} aria-hidden={!open} id="minimal-tool-records"><div>
      <ul>{calls.map(call => <li key={call.toolCallId} data-state={call.status}><Icon name={call.status === "completed" ? "check" : call.status === "running" ? "activity" : "info"} /><span>{call.name}</span><small>{toolLabels[call.status]}{call.durationMs == null ? "" : ` · ${(call.durationMs / 1000).toFixed(1)}s`}</small></li>)}</ul>
      <p>统计本轮已记录的工具调用；执行结果见对话中的工具输出。</p>
    </div></div>
  </section>;
}

export function SessionDetails({ open, onClose, project, task, sessionId }: { open: boolean; onClose: () => void; project?: Project; task?: TaskSummary | null; sessionId?: string | null }) {
  const usage = task?.usage;
  const unavailable = sessionId ? "未报告" : "尚未执行";
  const time = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("zh-CN") : "未报告";
  return <HostDialog open={open} onClose={onClose} title="会话详情" className="minimal-drawer">
    <div className="details-project"><span className="project-emblem"><Icon name="folder" /></span><div><strong>{project?.name || "尚未选择项目"}</strong><p>{project?.path || "添加本机目录后开始"}</p></div></div>
    <h3>当前会话</h3><dl className="session-facts"><dt>会话 ID</dt><dd>{sessionId || "发送后创建"}</dd><dt>执行状态</dt><dd>{task ? runLabels[task.status] : unavailable}</dd><dt>模型</dt><dd>{task?.model || unavailable}</dd><dt>账号</dt><dd>{task?.accountId || unavailable}</dd><dt>执行模式</dt><dd>{task ? task.mode === "controlled" ? "受控编程" : "只读分析" : unavailable}</dd><dt>开始时间</dt><dd>{time(task?.createdAt)}</dd><dt>最近更新</dt><dd>{time(task?.updatedAt)}</dd></dl>
    {sessionId && !task && <p className="details-note">此原生会话没有可用的 Host 轮次记录；可查看历史正文，运行信息暂缺。</p>}
    <h3>本轮模型用量</h3><dl className="session-facts"><dt>模型回复</dt><dd>{usage?.responses ?? "未报告"}</dd><dt>工具调用</dt><dd>{usage?.tools ?? "未报告"}</dd><dt>总 Token</dt><dd>{usage?.tokens?.totalTokens?.toLocaleString() ?? "未报告"}</dd><dt>输入 / 输出</dt><dd>{usage?.tokens ? `${usage.tokens.input.toLocaleString()} / ${usage.tokens.output.toLocaleString()}` : "未报告"}</dd><dt>估算费用</dt><dd>{usage?.estimatedCost == null ? "未报告" : `$${usage.estimatedCost.toFixed(6)}`}</dd></dl>
    <p className="details-note">仅统计当前选中会话的最近一轮。模型用量可能不完整，估算费用不是实际账单。</p>
    <div className="details-permission"><Icon name="shield" /><p>查看或继续历史不继承编程授权。修改项目仍使用现有审批流程。</p></div>
  </HostDialog>;
}

export type Appearance = { theme: "light" | "dark" | "system"; reduceMotion: boolean };
export function AppearanceSettings({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: Appearance; onChange: (value: Appearance) => void }) {
  return <HostDialog open={open} onClose={onClose} title="界面设置" className="minimal-settings">
    <label className="setting-row"><span><strong>外观</strong><small>只影响当前浏览器中的界面</small></span><select aria-label="外观" value={value.theme} onChange={e => onChange({ ...value, theme: e.target.value as Appearance["theme"] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    <label className="setting-row"><span><strong>减少动态效果</strong><small>系统设置为减少动效时也会生效</small></span><input type="checkbox" checked={value.reduceMotion} onChange={e => onChange({ ...value, reduceMotion: e.target.checked })} /></label>
  </HostDialog>;
}
