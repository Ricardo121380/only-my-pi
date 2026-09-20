import { useEffect, useState } from "react";
import { api, errorText, query } from "./api";
interface Entry { name: string; path: string; directory: boolean }
export function Inspector({ projectId, sessionId }: { projectId: string; sessionId?: string | null }) {
  const [tab, setTab] = useState("files"), [directory, setDirectory] = useState(""), [file, setFile] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]), [text, setText] = useState(""), [notice, setNotice] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setText(""); setEntries([]); setNotice("");
    async function load() {
      try {
        if (tab === "files" && !file) { const data = await api<{ entries: Entry[]; truncated: boolean }>(query("files", { projectId, path: directory }), undefined, controller.signal); setEntries(data.entries); if (data.truncated) setNotice("目录较大，仅显示前 1000 项。"); }
        else if (tab === "files") { const data = await api<{ text: string }>(query("file", { projectId, path: file }), undefined, controller.signal); setText(data.text); }
        else if (tab === "diff") { const data = await api<{ text: string; available: boolean; truncated?: boolean }>(query("diff", { projectId }), undefined, controller.signal); setText(data.text); setNotice(!data.available ? "Git diff 不可用：项目可能不是 Git 仓库，或输出超过限制。" : data.truncated ? "diff 预览已截断。" : !data.text ? "当前没有已跟踪文件的改动。" : "包含暂存和未暂存改动；不含未跟踪文件。"); }
        else if (!sessionId) setNotice("选择会话后查看关联回执；不会按时间猜测关联。");
        else { const data = await api<{ runs: unknown[] }>(query("runs", { projectId, sessionId }), undefined, controller.signal); if (!data.runs.length) setNotice("此会话没有关联的 OMP 验证回执。"); else setText(JSON.stringify(data.runs, null, 2)); }
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    void load(); return () => controller.abort();
  }, [projectId, sessionId, tab, directory, file, revision]);
  return <aside className="inspector" aria-label="项目检查">
    <div className="inspector-tabs" aria-label="检查内容">{[["files", "文件"], ["diff", "Git diff"], ["runs", "回执"]].map(([id, name]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{name}</button>)}</div>
    <div className="inspector-toolbar"><span>只读预览</span><button onClick={() => setRevision((n) => n + 1)} disabled={busy}>刷新</button></div>
    {tab === "files" && <div className="file-path"><button disabled={!directory && !file} onClick={() => { if (file) setFile(""); else setDirectory(directory.split("/").slice(0, -1).join("/")); }}>上一级</button><code>{file || directory || "/"}</code></div>}
    <div className="inspection-content" aria-busy={busy}>{busy ? <p className="muted">正在读取…</p> : error ? <p role="alert">{error}</p> : <>{notice && <p className="muted">{notice}</p>}{tab === "files" && !file ? entries.length ? entries.map((entry) => <button className="file-row" key={entry.path} onClick={() => entry.directory ? setDirectory(entry.path) : setFile(entry.path)}><span aria-hidden="true">{entry.directory ? "▸" : "·"}</span>{entry.name}<span className="sr-only">{entry.directory ? "目录" : "文件"}</span></button>) : <p className="muted">没有可预览的文件。</p> : text ? <pre className="source-text">{text}</pre> : null}</>}</div>
  </aside>;
}
