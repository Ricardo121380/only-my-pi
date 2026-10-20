import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/register.all";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { api, errorText, query } from "./api";
import { HostDialog } from "./HostDialog";
import { Icon } from "./Icon";
import "./editor.css";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
interface FileData { path: string; text: string; version: string }
interface Entry { name: string; path: string; directory: boolean }
interface OpenFile {
  path: string; version: string; baseline: string;
  model: monaco.editor.ITextModel; original: monaco.editor.ITextModel;
  listener: monaco.IDisposable; dirty: boolean; view: monaco.editor.ICodeEditorViewState | null;
}
export interface EditorProps { projectId: string; projectName: string; onClose: () => void }
const modelText = (model: monaco.editor.ITextModel) => model.getValue(monaco.editor.EndOfLinePreference.TextDefined, true);
function languageFor(file: string) {
  const extension = file.includes(".") ? `.${file.split(".").at(-1)}` : "";
  return monaco.languages.getLanguages().find((language) => language.filenames?.includes(file.split("/").at(-1)!) || language.extensions?.includes(extension))?.id ?? "plaintext";
}

export default function EditorWorkspace({ projectId, projectName, onClose }: EditorProps) {
  const files = useRef(new Map<string, OpenFile>()), editorRoot = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null), diffEditor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const [tabs, setTabs] = useState<{ path: string; dirty: boolean }[]>([]), [active, setActive] = useState("");
  const [directory, setDirectory] = useState(""), [entries, setEntries] = useState<Entry[]>([]), [directoryBusy, setDirectoryBusy] = useState(false);
  const [manualId, setManualId] = useState<string | null>(null), [available, setAvailable] = useState(false);
  const [diff, setDiff] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), busyRef = useRef(false), mounted = useRef(true);
  const [confirmation, setConfirmation] = useState<{ label: string; run: () => void } | null>(null);
  const refreshTabs = () => setTabs([...files.current.values()].map(({ path, dirty }) => ({ path, dirty })));
  useEffect(() => {
    mounted.current = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ([...files.current.values()].some((file) => file.dirty) || busyRef.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const controller = new AbortController();
    void api<{ available: boolean; workspaces: { projectId: string; manualId: string }[] }>("/api/manual", undefined, controller.signal).then((data) => {
      setAvailable(data.available); setManualId(data.workspaces.find((entry) => entry.projectId === projectId)?.manualId ?? null);
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => {
      mounted.current = false; controller.abort(); window.removeEventListener("beforeunload", beforeUnload);
      for (const file of files.current.values()) { file.listener.dispose(); file.model.dispose(); file.original.dispose(); }
      files.current.clear();
    };
  }, [projectId]);
  useEffect(() => {
    const controller = new AbortController(); setDirectoryBusy(true);
    void api<{ entries: Entry[]; truncated: boolean }>(query("files", { projectId, path: directory }), undefined, controller.signal).then((data) => {
      setEntries(data.entries); if (data.truncated) setNotice("目录仅显示前 1000 项。");
    }).catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setDirectoryBusy(false); });
    return () => controller.abort();
  }, [projectId, directory]);
  useEffect(() => {
    const root = editorRoot.current, file = files.current.get(active);
    if (!root || !file) return;
    const options = { automaticLayout: true, fontSize: 13, minimap: { enabled: false }, readOnly: !manualId, scrollBeyondLastLine: false, accessibilitySupport: "auto" as const, theme: document.documentElement.dataset.theme === "dark" ? "vs-dark" : "vs", ariaLabel: `${active} 文件内容` };
    if (diff) {
      const instance = monaco.editor.createDiffEditor(root, { ...options, originalEditable: false, renderSideBySide: true });
      instance.setModel({ original: file.original, modified: file.model }); diffEditor.current = instance;
      return () => { instance.dispose(); diffEditor.current = null; };
    }
    const instance = monaco.editor.create(root, { ...options, model: file.model }); editor.current = instance;
    if (file.view) instance.restoreViewState(file.view);
    return () => { file.view = instance.saveViewState(); instance.dispose(); editor.current = null; };
  }, [active, diff, manualId]);
  async function operate(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function openFile(filePath: string) {
    if (files.current.has(filePath)) { setActive(filePath); return; }
    void operate(async () => {
      if (files.current.size >= 12) throw new Error("EDITOR_TAB_LIMIT");
      const data = await api<FileData>(query("file", { projectId, path: filePath }));
      if (!mounted.current) return;
      const language = languageFor(filePath), uri = monaco.Uri.parse(`omp://${projectId}/${filePath}`);
      const model = monaco.editor.createModel(data.text, language, uri);
      const original = monaco.editor.createModel(data.text, language);
      const record: OpenFile = { path: filePath, version: data.version, baseline: data.text, model, original, dirty: false, view: null, listener: { dispose() {} } };
      record.listener = model.onDidChangeContent(() => {
        const dirty = modelText(model) !== record.baseline;
        if (dirty !== record.dirty) { record.dirty = dirty; refreshTabs(); }
      });
      files.current.set(filePath, record); refreshTabs(); setActive(filePath);
    });
  }
  function guard(label: string, dirty: boolean, run: () => void) {
    if (busyRef.current) return;
    if (dirty) setConfirmation({ label, run }); else run();
  }
  function closeFile(filePath: string) {
    const file = files.current.get(filePath)!;
    guard(`放弃 ${filePath} 的未保存修改？`, file.dirty, () => {
      files.current.delete(filePath);
      // Detach the active model before disposal; switching tabs keeps undo/view state.
      if (active === filePath) { editor.current?.setModel(null); diffEditor.current?.setModel(null); setActive(files.current.keys().next().value ?? ""); }
      file.listener.dispose(); file.model.dispose(); file.original.dispose(); refreshTabs();
    });
  }
  function closeWorkspace() {
    guard("放弃所有未保存修改并关闭编辑工作区？", tabs.some((tab) => tab.dirty), () => void operate(async () => {
      if (manualId) await api("/api/command", { type: "leaveManual", projectId, manualId });
      onClose();
    }));
  }
  function save() {
    const file = files.current.get(active);
    if (!file || !manualId || !file.dirty) return;
    const text = modelText(file.model);
    void operate(async () => {
      const result = await api<{ version: string }>("/api/command", { type: "saveFile", projectId, manualId, path: file.path, version: file.version, text });
      file.version = result.version; file.baseline = text; file.original.setValue(text); file.dirty = modelText(file.model) !== text;
      refreshTabs(); setNotice(`已保存 ${file.path}`);
    });
  }
  function reload() {
    const file = files.current.get(active); if (!file) return;
    guard("放弃当前草稿并重新读取磁盘版本？", file.dirty, () => void operate(async () => {
      const result = await api<FileData>(query("file", { projectId, path: file.path }));
      file.version = result.version; file.baseline = result.text; file.original.setValue(result.text); file.model.setValue(result.text); file.dirty = false;
      refreshTabs(); setNotice("已读取磁盘版本。");
    }));
  }
  return <HostDialog open title={`${projectName} · 编辑工作区`} className="editor-dialog" onClose={closeWorkspace}>
    <section className="editor-workspace" onKeyDownCapture={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); if (!confirmation) save(); } }}>
      <div className="editor-toolbar" inert={!!confirmation}>
        <span className="tag">{manualId ? "手动模式 · 项目写锁已持有" : "只读预览"}</span>
        {!manualId ? <button className="softbtn" disabled={busy || !available} onClick={() => void operate(async () => {
          const result = await api<{ manualId: string }>("/api/command", { type: "enterManual", projectId }); setManualId(result.manualId);
        })}>进入手动编辑</button> : <button className="softbtn" disabled={busy} onClick={() => guard("未保存修改仍保留在此页面，退出手动模式后不能保存。继续？", tabs.some((tab) => tab.dirty), () => void operate(async () => {
          await api("/api/command", { type: "leaveManual", projectId, manualId }); setManualId(null);
        }))}>退出手动模式</button>}
        <button className="softbtn" disabled={!active || busy} aria-pressed={diff} onClick={() => setDiff(!diff)}>草稿差异</button>
        <button className="softbtn" disabled={!active} onClick={() => void (diffEditor.current?.getModifiedEditor() ?? editor.current)?.getAction("actions.find")?.run()}>文件内搜索</button>
        <button className="softbtn" disabled={!active || busy} onClick={reload}>重新读取</button>
        <button className="softbtn primary" disabled={!manualId || !tabs.find((tab) => tab.path === active)?.dirty || busy} onClick={save}>{busy ? "处理中…" : "保存 ⌘/Ctrl S"}</button>
      </div>
      {error && <p className="editor-notice" role="alert">{error}</p>}
      {notice && <p className="editor-notice" role="status">{notice}</p>}
      {confirmation && <div className="editor-confirm" role="alert"><span>{confirmation.label}</span><button className="softbtn" autoFocus onClick={() => setConfirmation(null)}>保留草稿</button><button className="softbtn" onClick={() => { const action = confirmation.run; setConfirmation(null); action(); }}>确认继续</button></div>}
      <div className="editor-layout" inert={!!confirmation}>
        <nav className="editor-tree" aria-label="编辑器项目文件">
          <div className="editor-directory"><button disabled={!directory || directoryBusy} onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}>上一级</button><span title={directory}>{directory || "项目根目录"}</span></div>
          {directoryBusy ? <p role="status">正在读取目录…</p> : entries.map((entry) => <button className="editor-file" key={entry.path} disabled={busy} title={entry.path} onClick={() => entry.directory ? setDirectory(entry.path) : openFile(entry.path)}><Icon name={entry.directory ? "folder" : "file"} /><span>{entry.name}</span></button>)}
          {!directoryBusy && !entries.length && <p>没有可显示的文件。</p>}
        </nav>
        <div className="editor-main">
          <div className="editor-tabs" aria-label="已打开文件">{tabs.map((tab) => <div className="editor-tab" key={tab.path}><button aria-pressed={active === tab.path} title={tab.path} onClick={() => setActive(tab.path)}>{tab.path.split("/").at(-1)}{tab.dirty ? " · 未保存" : ""}</button><button aria-label={`关闭 ${tab.path}`} disabled={busy} onClick={() => closeFile(tab.path)}><Icon name="x" /></button></div>)}</div>
          {active ? <div ref={editorRoot} className="editor-canvas" /> : <div className="editor-empty"><Icon name="file" /><h3>从左侧打开文件</h3><p>最多 12 个标签 · UTF-8 文本 ≤512KB<br />编辑前显式取得手动模式；不会自动授予 Agent 写权限。</p></div>}
        </div>
      </div>
      <footer className="editor-footnote">{diff ? "左侧：最近读取/保存版本 · 右侧：当前草稿。不是 Git HEAD 差异。" : "草稿仅存于此页面。刷新前请保存；关闭编辑工作区会退出手动模式。"}</footer>
    </section>
  </HostDialog>;
}
