import type { HostCommand, HostEvent, HostSnapshot } from "../../packages/host/contracts";
export async function api<T>(url: string, command?: HostCommand, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, credentials: "same-origin", cache: "no-store", ...(command ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.code ?? "HOST_REQUEST_FAILED");
  return data;
}
export const query = (route: string, values: Record<string, string | number>) => `/api/${route}?${new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)]))}`;
export const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : "HOST_REQUEST_FAILED";
  const messages: Record<string, string> = { AUTH_REQUIRED: "连接授权已失效，请在终端重新运行 omp web。", PAIR_EXPIRED: "配对链接已过期或已使用，请重新运行 omp web。", FILE_PREVIEW_LIMIT: "文件超过 512KB，暂不提供预览。", FILE_SYMLINK_DENIED: "为保护项目边界，不预览符号链接。", BINARY_PREVIEW_UNAVAILABLE: "二进制文件不支持文本预览。", MODEL_UNAVAILABLE: "所选模型不可用，请刷新模型列表。", REQUEST_CONFLICT: "请求内容已改变，请新建分析。" };
  return messages[code] ?? `操作未完成（${code}），可刷新重试；原输入已保留。`;
};
export function applyEvent(snapshot: HostSnapshot | null, event: HostEvent): HostSnapshot | null {
  if (event.type === "snapshot") { if (event.protocol !== 1) throw new Error("PROTOCOL_MISMATCH"); return event; }
  if (!snapshot || event.epoch !== snapshot.epoch || event.seq > snapshot.seq + 1) throw new Error("EVENT_GAP");
  if (event.seq <= snapshot.seq) return snapshot;
  return { ...snapshot, seq: event.seq, ...(event.type === "projects" ? { projects: event.data } : { tasks: [event.data, ...snapshot.tasks.filter((task) => task.taskId !== event.data.taskId)].slice(0, 100) }) };
}
