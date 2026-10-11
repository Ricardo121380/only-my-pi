import { useEffect, useRef, useState } from "react";
import type { McpAction, McpPreview, McpServer, McpSnapshot, McpStatus } from "../../packages/mcp/contracts";
import { HostDialog } from "./HostDialog";
import { McpOAuthControls } from "./McpOAuthControls";
import { McpDiscoveryPanel } from "./McpDiscoveryPanel";
import "./mcp.css";

export async function mcpApi<T>(action: McpAction, projectId?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/mcp", { method: "POST", signal, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-mcp-protocol": "1" }, body: JSON.stringify({ ...action, ...(projectId ? { projectId } : {}) }) });
  const data = await response.json(); if (!response.ok) throw new Error(data.code ?? "MCP_REQUEST_FAILED"); return data;
}
const template: McpServer = { name: "local", transport: "stdio", command: "", args: [], codePaths: [], cwd: ".", env: {}, credentialRefs: {}, tools: [{ name: "read_file", effect: "read", pathArgument: "path", paths: ["README.md"] }], enabled: false };
const httpTemplate: McpServer = { name: "remote", transport: "streamable-http", url: "https://example.com/mcp", credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false };
const editable = (server: McpServer): McpServer => server.transport === "streamable-http"
  ? { name: server.name, transport: server.transport, url: server.url, credentialRefs: server.credentialRefs, tools: server.tools, resources: server.resources, enabled: false }
  : { name: server.name, transport: server.transport, command: server.command, args: server.args, codePaths: server.codePaths, cwd: server.cwd ?? ".", env: server.env, credentialRefs: server.credentialRefs, tools: server.tools, resources: server.resources, enabled: false };
const label = (value: string) => ({ running: "运行中", stopped: "已停止", starting: "正在启动", stopping: "正在停止", reconciliation: "进程待核对，继续阻断", checking: "检查中", awaiting_approval: "等待决定", completed: "已完成", failed: "失败", rejected: "已拒绝", dispatched: "已发出，等待结果", unknown: "结果未知，不会自动重试" }[value] ?? value);

export function McpPanel({ projectId, projectName, onClose }: { projectId?: string; projectName?: string; onClose: () => void }) {
  const [scope, setScope] = useState(projectId ? "project" : "default"), [snapshot, setSnapshot] = useState<McpSnapshot | null>(null), [status, setStatus] = useState<McpStatus | null>(null);
  const [source, setSource] = useState(""), [preview, setPreview] = useState<McpPreview | null>(null), [serverText, setServerText] = useState(JSON.stringify(template, null, 2));
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const [credentialServer, setCredentialServer] = useState(""), [envName, setEnvName] = useState("MCP_TOKEN"), [secret, setSecret] = useState("");
  const pending = useRef(false), activeScope = useRef("");
  const selectedId = scope === "project" ? projectId : undefined;
  activeScope.current = selectedId ?? "default";
  useEffect(() => {
    const controller = new AbortController(); setSnapshot(null); setPreview(null); setError(""); setNotice(""); setSecret("");
    const load = async () => {
      try {
        const [configuration, runs] = await Promise.all([mcpApi<McpSnapshot>({ type: "list" }, selectedId, controller.signal), mcpApi<McpStatus>({ type: "status" }, selectedId, controller.signal)]);
        if (!controller.signal.aborted && !pending.current) { setSnapshot(configuration); setStatus(runs); }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "MCP_REQUEST_FAILED"); }
    };
    void load(); const timer = setInterval(() => { if (!pending.current) void load(); }, 2000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selectedId]);
  async function act<T>(action: McpAction, message: string): Promise<T | undefined> {
    if (pending.current) return; pending.current = true; setBusy(true); setError(""); setNotice("");
    const binding = selectedId ?? "default";
    try {
      const value = await mcpApi<T>(action, selectedId);
      const configuration = action.type.startsWith("oauth") ? await mcpApi<McpSnapshot>({ type: "list" }, selectedId) : value as McpSnapshot;
      if (binding === activeScope.current) { if (action.type === "discover") setStatus(value as McpStatus); else if (action.type !== "previewImport") setSnapshot(configuration); setNotice(message); }
      return value;
    } catch (cause) { if (binding === activeScope.current) setError(cause instanceof Error ? cause.message : "MCP_REQUEST_FAILED"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function saveServer() {
    try {
      const server = JSON.parse(serverText) as McpServer;
      if (server.enabled !== false) { setError("新保存的配置必须停用；保存后请明确启用。"); return; }
      await act({ type: "save", revision: snapshot!.revision, server }, "配置已保存且停用。启用后仅新任务使用此版本。");
    } catch { setError("配置 JSON 无效，请核对括号、字段和路径。"); }
  }
  return <HostDialog open title="MCP 工具" onClose={onClose} className="mcp-dialog"><div className="mcp-panel">
    <p>支持本地 stdio 与 Streamable HTTP。保存与导入不会启动或连接服务器；新任务只使用启动时的配置，每次调用仍需你的决定。远程操作可能产生外部效果；本机写入还须当前编程授权与项目写入所有权。</p>
    <p>发现只展示当前任务已准入服务器的实际定义。隐藏、撤回或定义变化会使旧许可失效。资源使用 resources 中的精确 mcp://服务器/ URI、mimeTypes 与 stdio 读路径；最多 64 KiB，只返回数据，不运行 HTML 或 MCP Apps。</p>
    <label className="field">配置范围<select aria-label="MCP 配置范围" value={scope} disabled={busy} onChange={(event) => setScope(event.target.value)}><option value="default">OMP 默认配置</option><option value="project" disabled={!projectId}>当前项目：{projectName ?? "未选择"}</option></select></label>
    {error && <p role="alert">{error === "MCP_REVISION_CONFLICT" ? "配置版本已变化，输入仍保留。请核对已保存版本再操作。" : error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!snapshot ? <p role="status">正在读取配置…</p> : <>
      <h3>服务器 <small>配置版本 {snapshot.revision}</small></h3>
      {!snapshot.servers.length && <p>还没有服务器。可导入本地配置，或填写下方服务器配置。</p>}
      <ul className="mcp-servers">{snapshot.servers.map((server) => <li key={server.name}><div className="between"><strong>{server.name} · {server.enabled ? "已启用" : "已停用"}</strong><span>{server.source === "project" ? "项目覆盖" : "OMP 默认"}</span></div><p>{server.transport === "streamable-http" ? server.url : `${server.command} ${server.args.join(" ")}`}</p><p>{server.transport === "stdio" && <>工作目录：{server.cwd ?? "."}；</>}工具范围：{server.tools.map((tool) => "paths" in tool ? `${tool.name}（${tool.effect === "write" ? "写入" : "只读"}）：${tool.paths.join("、")}` : `${tool.name}（远程操作）`).join("；") || "尚未配置"}</p><div className="account-actions"><button className="softbtn" disabled={busy} onClick={() => void act({ type: "enable", revision: snapshot.revision, name: server.name, enabled: !server.enabled }, server.enabled ? "已停用并撤销现有工具许可，正在关闭本机连接与核对本地进程退出。" : "已启用；下一个任务使用此配置，尚未取得工具许可。")}>{server.enabled ? "停用并撤权" : "启用服务器"}</button><button className="softbtn" disabled={busy} onClick={() => setServerText(JSON.stringify(editable(server), null, 2))}>编辑配置</button>{server.source === "project" && scope === "project" && <button className="softbtn" disabled={busy} onClick={() => void act({ type: "reset", revision: snapshot.revision, name: server.name }, "已移除项目覆盖；后续任务恢复 OMP 默认配置。")}>恢复默认</button>}</div>{server.transport === "streamable-http" && scope === "project" && <McpOAuthControls name={server.name} revision={snapshot.revision} authentication={snapshot.authentication?.[server.name]} busy={busy} onAction={(action, message) => void act(action, message)} />}</li>)}</ul>
      <details><summary>导入本地 MCP 配置</summary><p>粘贴 mcpServers JSON。导入保留原文件字节，全部服务器默认停用；同名项需要先核对。</p><label className="field">原配置 JSON<textarea aria-label="原 MCP 配置 JSON" value={source} onChange={(event) => { setSource(event.target.value); setPreview(null); }} /></label><button className="softbtn" disabled={busy || !source} onClick={() => void act<McpPreview>({ type: "previewImport", source }, "预览完成，尚未保存或启动。").then((value) => { if (value) setPreview(value); })}>预览导入</button>{preview && <div><ul>{preview.differences.map((entry) => <li key={entry.name}>{entry.name}：{entry.status === "new" ? "新增，默认停用" : "同名配置，需核对"}</li>)}</ul><button className="softbtn" disabled={busy} onClick={() => void act({ type: "import", source, digest: preview.digest, revision: preview.revision }, "已导入且全部停用，没有启动进程。")}>确认导入并停用</button></div>}</details>
      <details><summary>保存服务器配置</summary><div className="account-actions"><button className="softbtn" onClick={() => setServerText(JSON.stringify(template, null, 2))}>本地 stdio 示例</button><button className="softbtn" onClick={() => setServerText(JSON.stringify(httpTemplate, null, 2))}>Streamable HTTP 示例</button></div><p>HTTP 使用明确 URL，凭据通过 MCP_TOKEN 引用发送，拒绝重定向和旧 SSE；remote 工具不授予本机项目写入。stdio 的 command 与 codePaths 使用本机绝对路径，cwd 位于项目内，env 只传明确非秘密值。写入需 effect 为 write、writeMode 为 descriptor，只准入已有普通单链接文件。enabled 必须为 false。</p><label className="field">服务器 JSON<textarea aria-label="MCP 服务器 JSON" value={serverText} onChange={(event) => setServerText(event.target.value)} /></label><button className="softbtn" disabled={busy} onClick={() => void saveServer()}>保存并停用</button></details>
      {scope === "project" && <details><summary>项目凭据引用</summary><p>凭据只绑定当前项目与服务器目标，界面只回读引用；改变目标后需重新设置凭据。</p><label className="field">服务器名称<input value={credentialServer} onChange={(event) => setCredentialServer(event.target.value)} /></label><label className="field">凭据环境变量<input value={envName} onChange={(event) => setEnvName(event.target.value)} /></label><label className="field">凭据值<input type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} /></label><button className="softbtn" disabled={busy || !credentialServer || !secret} onClick={() => { const value = secret; setSecret(""); void act({ type: "credential", name: credentialServer, envName, value, revision: snapshot.revision }, "已保存项目凭据引用，原值不会回显。"); }}>保存凭据引用</button></details>}
      {scope === "project" && snapshot.servers.some((server) => Object.keys(server.credentialRefs).length > 0) && <section aria-label="已绑定的项目凭据"><h3>已绑定凭据</h3>{snapshot.servers.flatMap((server) => Object.keys(server.credentialRefs).map((key) => <p key={`${server.name}:${key}`}>{server.name} · {key} <button className="softbtn" disabled={busy} onClick={() => void act({ type: "revokeCredential", revision: snapshot.revision, name: server.name, envName: key }, "凭据已撤销；现有任务后续调用被阻断，正在关闭本机连接与核对本地进程。")}>撤销此凭据</button></p>))}</section>}
    </>}
    <h3>运行记录</h3><p>关闭页面不会取消已授权任务。停止任务会关闭本机连接并结束本地服务进程；远端执行状态须另行核对。停用会撤销后续调用。结果未知时先核对记录，不会自动重试或回滚。</p>
    {status?.runs.slice(-8).reverse().map((run) => <details key={run.runId}><summary>版本 {run.revision} · {label(run.status)} · {run.taskId.slice(0, 8)}</summary><McpDiscoveryPanel run={run} busy={busy} canDiscover={scope === "project"} onDiscover={(name) => void act({ type: "discover", taskId: run.taskId, name }, "已重新读取实际定义；调用仍需独立授权。")} /><ul>{run.processes.map((process, index) => <li key={index}>{process.server} · {process.transport === "streamable-http" ? <>HTTP 连接：{label(process.status)}；远端执行状态不可由本机关闭确认</> : <>PID {process.pid ?? "尚未启动"} · {label(process.status)} · {process.alive ? "仍存在" : "未发现进程组"}</>}</li>)}</ul>{run.calls.map((call) => <p key={call.callId}>{call.server}/{call.tool}：{label(call.status)}<br />{call.target}{call.effect === "write" && <><br />{call.application === "unknown" ? "应用结果未知" : call.application === "applied" ? "已应用" : "尚未应用"} · {call.observedChange === undefined ? "字节变化尚未核对" : call.observedChange ? "已观测字节变化" : "未观测字节变化"} · 项目验证未运行</>}{call.code && <><br />{call.code}</>}</p>)}</details>)}
    {!status?.runs.length && <p>尚无实际运行记录。</p>}
  </div></HostDialog>;
}
