import type { McpDiscovery, McpRun } from "../../packages/mcp/contracts";

const state = (entry: McpDiscovery) => ({ discovering: "正在发现", ready: "已发现", stale: "定义已失效", failed: "发现失败", disconnected: "连接已断开" }[entry.status]);
export function McpDiscoveryPanel({ run, busy, canDiscover, onDiscover }: { run: McpRun; busy: boolean; canDiscover: boolean; onDiscover: (name: string) => void }) {
  if (!run.discoveries?.length) return null;
  return <section aria-label="实际 MCP 发现"><h4>实际发现 · {run.taskId.slice(0, 8)}</h4>
    {run.discoveries.map((entry) => <div key={entry.server}>
      <p><strong>{entry.server}</strong> · {state(entry)} · 变化版本 {entry.epoch} · {entry.live ? "当前连接" : "历史记录"}<br />{entry.discoveredAt && <time dateTime={entry.discoveredAt}>{new Date(entry.discoveredAt).toLocaleString()}</time>}{entry.code && <> · {entry.code}</>}</p>
      <ul>{entry.tools.map((tool) => <li key={tool.name}>{tool.name} · {tool.exposure} · {entry.status !== "ready" || !entry.live ? "上次发现，当前不可调用" : tool.active ? "可调用，仍需授权" : "隐藏或已撤回"}</li>)}</ul>
      <ul>{entry.resources.map((resource) => <li key={resource.uri}>{resource.uri} · {resource.mimeType} · {resource.size === undefined ? "服务未声明大小" : `${resource.size} 字节`} · {entry.status === "ready" && entry.live ? "读取仍需授权" : "上次发现，当前不可读取"}</li>)}</ul>
      {!entry.resources.length && <p>没有精确准入且实际发现的资源。</p>}
      {entry.events.length > 0 && <p>实际变化：{entry.events.slice(-4).map((event) => `${event.type}（${new Date(event.at).toLocaleTimeString()}）`).join("；")}</p>}
      <button className="softbtn" disabled={busy || !canDiscover || !entry.live || run.status !== "running"} onClick={() => onDiscover(entry.server)}>重新发现 {entry.server}</button>
    </div>)}
  </section>;
}
