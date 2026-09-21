import { useEffect, useState } from "react";
import { api, errorText, query } from "./api";
import { Icon } from "./Icon";
import { RunReceipts, type RunReceipt } from "./RunReceipts";
import type { EditorProps } from "./EditorWorkspace";
interface Entry { name: string; path: string; directory: boolean }
export function Inspector({ projectId, projectName, projectPath, sessionId, hidden, onClose }: { projectId: string; projectName?: string; projectPath?: string; sessionId?: string | null; hidden?: boolean; onClose: () => void }) {
  const [tab, setTab] = useState("files"), [directory, setDirectory] = useState(""), [file, setFile] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]), [text, setText] = useState(""), [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  const [runs, setRuns] = useState<RunReceipt[]>([]);
  const [Editor, setEditor] = useState<React.ComponentType<EditorProps> | null>(null), [editorOpen, setEditorOpen] = useState(false), [editorLoading, setEditorLoading] = useState(false);
  async function openEditor() {
    if (editorLoading) return;
    if (Editor) { setEditorOpen(true); return; }
    setEditorLoading(true);
    try { const module = await import("./EditorWorkspace"); setEditor(() => module.default); setEditorOpen(true); }
    catch { setError("编辑器加载失败，请检查连接后重新打开。"); }
    finally { setEditorLoading(false); }
  }
  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController(); setBusy(true); setError(""); setText(""); setEntries([]); setNotice(""); setRuns([]);
    async function load() {
      try {
        if (tab === "files" && !file) { const data = await api<{ entries: Entry[]; truncated: boolean }>(query("files", { projectId, path: directory }), undefined, controller.signal); setEntries(data.entries); if (data.truncated) setNotice("目录较大，仅显示前 1000 项。"); }
        else if (tab === "files") { const data = await api<{ text: string }>(query("file", { projectId, path: file }), undefined, controller.signal); setText(data.text); }
        else if (tab === "diff") { const data = await api<{ text: string; available: boolean; truncated?: boolean }>(query("diff", { projectId }), undefined, controller.signal); setText(data.text); setNotice(!data.available ? "Git diff 不可用：项目可能不是 Git 仓库，或输出超过限制。" : data.truncated ? "diff 预览已截断。" : !data.text ? "当前没有已跟踪文件的改动。" : "包含暂存和未暂存改动；不含未跟踪文件。"); }
        else if (!sessionId) setNotice("选择会话后查看关联回执；不会按时间猜测关联。");
        else { const data = await api<{ runs: RunReceipt[] }>(query("runs", { projectId, sessionId }), undefined, controller.signal); if (!data.runs.length) setNotice("此会话没有关联的 OMP 验证回执。"); else setRuns(data.runs); }
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [projectId, sessionId, tab, directory, file, revision]);
  return <aside className="inspector" aria-label="项目面板" inert={hidden}>
    <header className="inspector-header"><div className="segments" style={{ "--active-index": tab==="files"?0:tab==="diff"?1:2 } as React.CSSProperties} aria-label="项目面板内容">{([["files","预览","preview"],["diff","变更","file"],["runs","活动","activity"]] as const).map(([id,label,icon])=><button key={id} className={`segment ${tab===id?"active":""}`} aria-pressed={tab===id} onClick={()=>setTab(id)}><Icon name={icon} />{label}</button>)}</div><button className="iconbtn round" aria-label="关闭项目面板" onClick={onClose}><Icon name="panel" /></button></header>
    <div className="inspector-content">
    <button className="softbtn" disabled={!projectId || editorLoading} onClick={() => void openEditor()}>{editorLoading ? "正在加载编辑器…" : "打开编辑工作区"}</button>
    {editorOpen && Editor && <Editor key={projectId} projectId={projectId} projectName={projectName || "项目"} onClose={() => setEditorOpen(false)} />}
    <section className="inspector-section"><div className="between"><h2>项目速览</h2><span className="tag">本机项目</span></div><div className="project-card"><div className="row"><span className="tile-icon"><Icon name="folder" /></span><div className="grow"><div className="name">{projectName || "尚未选择项目"}</div><div className="path cut" title={projectPath}>{projectPath || "添加本机目录后开始"}</div></div><button className="iconbtn small" disabled aria-label="项目设置（尚未接入）"><Icon name="settings" /></button></div><div className="project-meta"><span className="branch"><Icon name="shield" />只读</span><span className="vline" /><span>本机分区</span></div></div></section>
    <section className="inspector-section"><div className="between"><h2>{tab==="files"?"项目文件":tab==="diff"?"值得你过目":"执行与验证"}</h2><button className="linkbtn" disabled={busy || !projectId} onClick={()=>setRevision((n)=>n+1)}>刷新</button></div>
    {tab==="files" && (file || directory) && <div className="between"><button className="linkbtn" onClick={()=>file?setFile(""):setDirectory(directory.split("/").slice(0,-1).join("/"))}>上一级</button><span className="cut muted">{file || directory}</span></div>}
    <div aria-busy={busy}>{busy?<div className="empty-state">正在读取…</div>:error?<p role="alert">{error}</p>:<>{notice && <p className="preview-note">{notice}</p>}{tab==="files"&&!file ? entries.length ? <div className="changes-list">{entries.map((entry)=><button className="change-row" key={entry.path} onClick={()=>entry.directory?setDirectory(entry.path):setFile(entry.path)}><span className="file-icon"><Icon name={entry.directory?"folder":"file"} /></span><span className="grow"><span className="file-name">{entry.name}</span><span className="file-parent">{entry.directory?"目录":directory||"项目根目录"}</span></span><Icon name="chevron" /></button>)}</div>:<div className="empty-state">没有可预览的文件。</div>:text?<div className="code-container"><div className="code-header"><span>{file || (tab==="diff"?"Git diff":"OMP 回执")}</span><span>只读</span></div><div className="code-body"><pre className="host-source source-text">{text}</pre></div></div>:null}</>}</div>
    {tab==="runs" && !busy && !error && <RunReceipts runs={runs} />}
    {tab==="files"&&<button className="review-all" onClick={()=>setTab("diff")}><span>打开变更审阅</span><Icon name="arrow-right" /></button>}</section>
    {tab==="files"&&!file&&<><section className="inspector-section"><div className="between"><h2>预览与验证</h2><span className="tag">只读模式</span></div><div className="quick-actions"><button disabled title="测试执行尚未接入"><Icon name="flask" />测试</button><button disabled title="构建执行尚未接入"><Icon name="terminal" />构建</button></div><p className="preview-note">网页预览与执行入口尚未接入。文件内容可以在上方直接查看。</p></section><section className="inspector-section"><div className="between"><h2>可用能力</h2></div><div className="capability-list"><span className="capability-chip enabled"><Icon name="file" />文件预览<span className="dot" /></span><span className="capability-chip enabled"><Icon name="branch" />Git diff<span className="dot" /></span><span className="capability-chip enabled"><Icon name="shield" />验证回执<span className="dot" /></span></div><p className="preview-note">预览不会修改文件，也不授予执行权限。</p></section></>}
    </div>
  </aside>;
}
