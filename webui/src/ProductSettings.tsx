import { useEffect, useRef, useState } from "react";
import { HostDialog } from "./HostDialog";
import "./mcp.css";

type Resource = { id: string; kind: string; origin: string; version: string; name?: string; enabled: boolean; required?: boolean; source: string; parameters: Record<string, string>; schema: unknown };
type Loaded = { revision: number; taskId: string; resources: Resource[] };
type Settings = { revision: number; resourceRevision?: number; resources: Resource[]; pending: boolean; lastLoaded: Loaded | null; lastFailure: { code: string; revision: number } | null; loadError?: string };
type Source = { kind: string; origin: string; content: string };
type Preview = { revision: number; digest: string; source: { origin: string; contentDigest: string }; differences: { id: string; before: Resource | null; after: Resource }[] };
export async function settingsApi<T>(input: object, projectId?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/settings", { method: "POST", signal, credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-settings-protocol": "1" }, body: JSON.stringify({ ...input, ...(projectId ? { projectId } : {}) }) });
  const value = await response.json(); if (!response.ok) throw new Error(value.code ?? "SETTINGS_REQUEST_FAILED"); return value;
}
export function ProductSettings({ projectId, projectName, onClose, onUseSkill }: { projectId?: string; projectName?: string; onClose: () => void; onUseSkill?: (name: string) => void }) {
  const [scope, setScope] = useState(projectId ? "project" : "default"), [state, setState] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<{ id: string; label: string; revision: number } | null>(null);
  const [source, setSource] = useState<Source | null>(null), [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const pending = useRef(false), selected = scope === "project" ? projectId : undefined;
  useEffect(() => {
    const controller = new AbortController(); setState(null); setDraft(null); setPreview(null); setSource(null); setError("");
    const read = async () => { try { const next = await settingsApi<Settings>({ type: "list" }, selected, controller.signal); if (!controller.signal.aborted && !pending.current) setState(next); } catch (cause) { if (!controller.signal.aborted) setError(String(cause instanceof Error ? cause.message : cause)); } };
    void read(); const timer = setInterval(() => { if (!pending.current) void read(); }, 1500);
    return () => { controller.abort(); clearInterval(timer); };
  }, [selected]);
  async function act(input: object) {
    if (pending.current) return; pending.current = true; setBusy(true); setError(""); setNotice("");
    try { const next = await settingsApi<Settings>(input, selected); setState(next); setNotice("请求值已保存。下一任务加载；活动任务继续使用其启动快照。停用立即阻止后续调用。"); return next; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "SETTINGS_REQUEST_FAILED"); }
    finally { pending.current = false; setBusy(false); }
  }
  return <HostDialog open title="产品工具与技能设置" onClose={onClose} className="mcp-dialog"><div className="mcp-panel product-settings">
    <p>CLI 与图形端共用产品默认和项目覆盖。原 Pi / 外部文件仅显式导入；保存、启用、认证和执行授权分别处理。</p>
    <label className="field">设置范围<select aria-label="产品设置范围" value={scope} disabled={busy} onChange={e => setScope(e.target.value)}><option value="default">产品默认</option><option value="project" disabled={!projectId}>当前项目：{projectName ?? "未选择"}</option></select></label>
    {error && <p role="alert">{error === "SETTINGS_REVISION_CONFLICT" ? "配置版本已变化，未覆盖。请求输入已保留；请比较当前值，再明确采用当前版本保存。" : error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!state ? <p role="status">正在读取共享设置…</p> : <>
      <p>请求版本 <strong>{state.revision}</strong> · {state.lastFailure || state.loadError ? "加载失败，保留最近有效版本" : state.pending ? "待下一任务加载" : "最近任务已加载此版本"}</p>
      <p>实际加载：{state.lastLoaded ? `版本 ${state.lastLoaded.revision} · 任务 ${state.lastLoaded.taskId}` : "尚无真实 Pi 加载回执"}</p>
      {(state.lastFailure || state.loadError) && <p role="alert">加载失败：{state.lastFailure?.code ?? state.loadError}。保留最近有效配置，失败请求未标为已加载。</p>}
      <ul className="mcp-servers">{state.resources.map(resource => <li key={resource.id}>
        <div className="between"><strong>{resource.id} · {resource.enabled ? "请求启用" : "请求停用"}</strong><span>{resource.required ? "必需集合" : resource.source === "project" ? "项目覆盖" : "继承产品默认"}</span></div>
        <p>来源：{resource.origin} · {resource.version.slice(0, 16)}</p>
        <p>已保存参数：{Object.keys(resource.parameters).length ? JSON.stringify(resource.parameters) : "无声明参数"}；实际加载：{state.lastLoaded?.resources.find(r => r.id === resource.id)?.enabled ? JSON.stringify(state.lastLoaded.resources.find(r => r.id === resource.id)?.parameters) : "未加载 / 停用"}</p>
        <div className="account-actions"><button className="softbtn" disabled={busy || resource.required} onClick={() => void act({ type: "set", id: resource.id, revision: state.revision, enabled: !resource.enabled })}>{resource.enabled ? "停用" : "启用"} {resource.id}</button>
          {resource.kind === "skill" && resource.enabled && scope === "project" && <button className="softbtn" disabled={busy} onClick={() => { onUseSkill?.(resource.name!); onClose(); }}>准备使用技能 {resource.name}</button>}
          {resource.schema ? <button className="softbtn" disabled={busy} onClick={() => setDraft({ id: resource.id, label: resource.parameters.label, revision: state.revision })}>编辑声明参数</button> : <span>未声明 Schema，不支持参数编辑</span>}
          {scope === "project" && resource.source === "project" && <button className="softbtn" disabled={busy} onClick={() => void act({ type: "reset", id: resource.id, revision: state.revision })}>重置覆盖 {resource.id}</button>}</div>
      </li>)}</ul>
      {draft && <section aria-label="声明参数编辑"><h3>{draft.id} 参数</h3><p>请求基于版本 {draft.revision}；当前保存值：{JSON.stringify(state.resources.find(r => r.id === draft.id)?.parameters)}</p><label className="field">诊断标签<input aria-label="诊断标签" value={draft.label} minLength={1} maxLength={32} pattern="[A-Za-z0-9 _-]+" onChange={e => setDraft({ ...draft, label: e.target.value })} /></label><p>1–32 个英文字母、数字、空格、下划线或连字符。</p><div className="account-actions"><button className="softbtn" disabled={busy || !/^[A-Za-z0-9 _-]{1,32}$/.test(draft.label)} onClick={() => void act({ type: "set", id: draft.id, revision: draft.revision, parameters: { label: draft.label } }).then(value => { if (value) setDraft(null); })}>保存声明参数</button>{draft.revision !== state.revision && <button className="softbtn" disabled={busy} onClick={() => setDraft({ ...draft, revision: state.revision })}>已核对，采用当前版本 {state.revision}</button>}<button className="softbtn" onClick={() => setDraft(null)}>取消编辑</button></div></section>}
      <details><summary>显式导入本地技能</summary><p>仅接收 Markdown 技能，须声明 name、description 和 compatibility: pi-1.3.0。保存独立副本且默认停用；不会启动工具、登录或授予执行许可。外部扩展代码和未知来源暂不准入。</p><label className="field">选择 SKILL.md<input aria-label="选择技能文件" type="file" accept=".md" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; setPreview(null); if (file) { if (file.size > 131072) { setError("技能超过 128 KiB"); return; } setSource({ kind: "local-skill", origin: file.name, content: await file.text() }); } }} /></label>
        {source && <><pre>{source.content}</pre><button className="softbtn" disabled={busy} onClick={() => { setError(""); void settingsApi<Preview>({ type: "previewImport", source }, selected).then(setPreview).catch(cause => setError(cause.message)); }}>预览来源与差异</button></>}
        {preview && <div><p>来源：{preview.source.origin} · 摘要 {preview.source.contentDigest}</p>{preview.differences.map(diff => <p key={diff.id}>{diff.id}：{diff.before ? "已有同名资源，导入会拒绝" : "新增技能，默认停用"}</p>)}<button className="softbtn" disabled={busy} onClick={() => void act({ type: "import", source, revision: preview.revision, digest: preview.digest }).then(value => { if (value) { setPreview(null); setSource(null); } })}>确认导入并停用</button></div>}
      </details>
    </>}
  </div></HostDialog>;
}
