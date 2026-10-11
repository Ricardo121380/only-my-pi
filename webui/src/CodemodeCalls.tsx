import type { HostTask } from "../../packages/host/contracts";

const labels = { running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消", unknown: "结果未知，需核对" };

export function CodemodeCalls({ task }: { task: HostTask }) {
  const calls = task.toolCalls ?? [];
  const parents = calls.filter((call) => call.name === "codemode" && call.parentToolCallId === null);
  if (!parents.length) return null;
  const children = new Map<string, typeof calls>();
  for (const call of calls) {
    if (call.parentToolCallId) children.set(call.parentToolCallId, [...(children.get(call.parentToolCallId) ?? []), call]);
  }
  return <details aria-label="工具组合调用" style={{ overflowWrap: "anywhere" }}>
    <summary>工具组合 · {parents.length} 次脚本 · 展开嵌套调用</summary>
    <p>每个工具分别授权；脚本结束不代表全部子调用成功。分类须先配置项目模型并取得本任务许可，结果和用量见分类账本。图片生成尚未启用。</p>
    {parents.map((parent) => <section key={parent.toolCallId} aria-label="脚本及子调用">
      <strong>脚本 · {labels[parent.status]}{parent.durationMs == null ? "" : ` · ${(parent.durationMs / 1000).toFixed(2)} 秒`}</strong>
      <p>调用 {parent.toolCallId}</p>
      <ul>{(children.get(parent.toolCallId) ?? []).map((child) => <li key={child.toolCallId}>
        <details><summary>{child.name} · {labels[child.status]}{child.durationMs == null ? "" : ` · ${(child.durationMs / 1000).toFixed(2)} 秒`}</summary>
          <p>子调用 {child.toolCallId} · 父调用 {child.parentToolCallId}</p>
          <pre>{child.result || child.error || "尚无最终结果；等待审批或执行回执。"}</pre>
        </details>
      </li>)}</ul>
      <details><summary>脚本结果与错误</summary><pre>{parent.result || parent.error || "尚无最终结果"}</pre></details>
    </section>)}
  </details>;
}
