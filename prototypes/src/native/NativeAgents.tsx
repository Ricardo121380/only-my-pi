import { Bot, Check, CircleAlert, Loader2 } from "lucide-react";
import type { HostTask } from "../../../packages/host/contracts";

const labels: Record<string, string> = { running: "运行中", completed: "已完成", cancelled: "已取消", interrupted: "已停止", failed: "失败", unknown: "待核对", "timed-out": "已超时", "budget-exhausted": "达到本次上限" };

export function NativeAgents({ task }: { task: HostTask | null }) {
  const children = task?.orchestration?.children;
  if (!children?.length) return null;
  const parentEnded = !!task && ["succeeded", "failed", "cancelled", "interrupted"].includes(task.status);
  const running = parentEnded ? 0 : children.filter(child => child.status === "running").length;
  return <section aria-label="子代理" className="mx-auto mb-3 max-w-[660px] rounded-xl bg-muted px-3 py-2 text-[12.5px]">
    <p role="status" aria-atomic="true" className="mb-2 flex items-center gap-2"><Bot aria-hidden="true" className="size-4" />{running ? `${running} 位只读助手正在工作` : "只读助手工作记录"}</p>
    <div className="grid gap-2 sm:grid-cols-2">{children.map((child, index) => { const status = parentEnded && child.status === "running" ? "unknown" : child.status; return <div key={index} className="min-w-0 rounded-lg border border-line bg-card px-3 py-2">
      <p className="flex items-center gap-2">{status === "running" ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-primary motion-reduce:animate-none" /> : status === "completed" ? <Check aria-hidden="true" className="size-3.5 text-coding" /> : <CircleAlert aria-hidden="true" className="size-3.5 text-planning" />}<span className="min-w-0 flex-1 break-words">{child.label}</span><span>{labels[status] ?? "待核对"}</span></p>
      <p className="mt-1 break-all font-mono text-[11.5px] text-muted-foreground">{child.model ?? task?.model}</p>
      <p className="mt-1 text-muted-foreground">只读，不再委派{child.toolCount !== null ? `，${child.toolCount} 次工具调用` : ""}{child.tokens !== null ? `，${child.tokens} Token` : ""}</p>
    </div>; })}</div>
  </section>;
}
