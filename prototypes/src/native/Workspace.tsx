import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { BookOpen, ChevronDown, ChevronRight, FileCode2, FileDiff, FolderOpen, RefreshCw, SquareTerminal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, errorText, query } from "../../../webui/src/api";
import type { FileListing, FilePreview, GitDiff, Message } from "../../../packages/host/contracts";
import type { NativeSession } from "../../../webui/src/useNativeSession";
import { NativeMessage } from "./Conversation";
import { Empty, Notice, Tip } from "./ui";

export type WorkTab = "plan" | "changes" | "files" | "terminal";
export interface FileRequest { projectId: string; path: string; nonce: string }
const tabs = [{ id: "plan", label: "计划", icon: BookOpen }, { id: "changes", label: "改动", icon: FileDiff }, { id: "files", label: "文件", icon: FolderOpen }, { id: "terminal", label: "终端", icon: SquareTerminal }] as const;

export function Workspace({ session: c, tab, onTab, onClose, fileRequest, onOpenFile }: {
  session: NativeSession; tab: WorkTab; onTab: (tab: WorkTab) => void; onClose: () => void; fileRequest: FileRequest | null; onOpenFile: (path: string) => void;
}) {
  const inspector = c.snapshot?.capabilities?.inspector?.protocol === 1;
  return <section className="@container flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]" aria-label="工作区">
    <header className="flex h-12 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-2" role="tablist" aria-label="工作区标签">{tabs.map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap ${tab === item.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`} onClick={() => onTab(item.id)}>{tab === item.id && <motion.span layoutId="native-b2-tab" className="absolute inset-0 rounded-lg bg-secondary" transition={{ type: "spring", bounce: 0.15, duration: 0.4 }} />}<item.icon className="relative size-3.5" /><span className="relative">{item.label}</span></button>)}<Tip label="收起工作区" kbd="⌘J"><Button size="icon" variant="ghost" className="ml-auto size-8 shrink-0" aria-label="收起工作区" onClick={onClose}><X className="size-4" /></Button></Tip></header>
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" role="tabpanel" aria-label={tabs.find(item => item.id === tab)?.label}>
      {tab === "plan" ? <Empty title="会话计划">Pi 的分析和计划显示在左侧对话中。当前会话没有独立的计划产物。</Empty>
        : tab === "terminal" ? <ToolReceipts session={c} kind="terminal" onOpenFile={onOpenFile} />
        : !c.project ? <Empty title="项目工作区">选择项目后查看文件、改动和工具回执。</Empty>
        : <><div className="min-h-0 flex-1">{!inspector ? <Empty title="文件检查尚不可用">当前 Host 未提供此接口，请更新 Host 后重新连接。</Empty>
          : tab === "files" ? <FileBrowser key={c.projectId} projectId={c.projectId} connected={c.connected} request={fileRequest?.projectId === c.projectId ? fileRequest : null} />
          : <ProjectDiff key={c.projectId} projectId={c.projectId} connected={c.connected} />}</div>
          <details className="max-h-[45%] shrink-0 overflow-auto border-t border-line"><summary className="cursor-pointer px-4 py-3 text-[12.5px] text-muted-foreground">{tab === "changes" ? "写入工具回执" : "当前页工具回执"}</summary><ToolReceipts session={c} kind={tab} onOpenFile={onOpenFile} /></details></>}
    </div>
  </section>;
}

function Directory({ projectId, path = "", connected, selected, onSelect, root = false }: {
  projectId: string; path?: string; connected: boolean; selected: string; onSelect: (path: string) => void; root?: boolean;
}) {
  const [open, setOpen] = useState(root), [listing, setListing] = useState<FileListing | null>(null), [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    if (open && connected) {
      setListing(null); setError("");
      void api<FileListing>(query("files", { projectId, path }), undefined, controller.signal).then(value => { if (!controller.signal.aborted) setListing(value); }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    }
    return () => controller.abort();
  }, [projectId, path, open, connected, retry]);
  return <>
    {!root && <button type="button" aria-expanded={open} aria-label={`${open ? "收起" : "展开"} ${path}`} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-secondary disabled:opacity-50" disabled={!connected} onClick={() => setOpen(value => !value)}>{open ? <ChevronDown className="size-3 shrink-0" /> : <ChevronRight className="size-3 shrink-0" />}<FolderOpen className="size-3.5 shrink-0 text-primary" /><span className="truncate">{path.split("/").at(-1)}</span></button>}
    {open && <div className={root ? "" : "ml-3 border-l border-line pl-1"}>
      {error ? <div role="alert" className="p-2 text-[12px] text-destructive">{error}<button type="button" disabled={!connected} className="mt-1 block underline" onClick={() => setRetry(value => value + 1)}>重试目录</button></div>
        : !listing ? <p role="status" className="p-2 text-[12px] text-muted-foreground">{connected ? "正在读取目录…" : "连接断开，等待重新连接。"}</p>
        : <>{!listing.entries.length && <p className="px-2 py-1 text-[12px] text-muted-foreground">空目录</p>}<ul>{listing.entries.map(entry => <li key={entry.path}>{entry.directory ? <Directory projectId={projectId} path={entry.path} connected={connected} selected={selected} onSelect={onSelect} />
          : <button type="button" aria-label={`查看 ${entry.path}`} aria-current={selected === entry.path ? "page" : undefined} disabled={!connected} className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] ${selected === entry.path ? "bg-accent text-accent-foreground" : "hover:bg-secondary"}`} onClick={() => onSelect(entry.path)}><FileCode2 className="size-3.5 shrink-0" /><span className="truncate" title={entry.path}>{entry.name}</span></button>}</li>)}</ul>{listing.truncated && <p className="p-2 text-[11px] text-muted-foreground">此目录只显示前 1,000 项。</p>}</>}
    </div>}
  </>;
}

export function FileBrowser({ projectId, connected, request }: { projectId: string; connected: boolean; request: FileRequest | null }) {
  const [selected, setSelected] = useState(request?.path ?? ""), [refresh, setRefresh] = useState(0), [preview, setPreview] = useState<FilePreview | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(false);
  useEffect(() => { if (request) setSelected(request.path); }, [request?.nonce]);
  useEffect(() => {
    const controller = new AbortController(); setPreview(null); setError(""); setLoading(false);
    if (connected && selected) {
      setLoading(true);
      void api<FilePreview>(query("file", { projectId, path: selected }), undefined, controller.signal).then(value => { if (!controller.signal.aborted) setPreview(value); }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [projectId, selected, refresh, connected, request?.nonce]);
  return <section className="flex h-full min-h-0 flex-col" aria-label="项目文件">
    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[11.5px] text-muted-foreground"><span>项目当前文件 · 只读预览</span><button type="button" className="flex items-center gap-1 rounded-md px-1 py-1 hover:bg-secondary disabled:opacity-50" disabled={!connected || loading} aria-label="刷新项目文件" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-3" />刷新</button></div>
    {!connected && <p role="status" className="px-3 py-2 text-[12px] text-muted-foreground">连接断开，重新连接后再读取文件。</p>}
    <div className="flex min-h-0 flex-1 flex-col @min-[560px]:flex-row"><nav aria-label="项目文件树" className="max-h-48 shrink-0 overflow-auto border-b border-line p-2 @min-[560px]:max-h-none @min-[560px]:w-44 @min-[560px]:border-r @min-[560px]:border-b-0"><Directory key={refresh} projectId={projectId} connected={connected} selected={selected} onSelect={setSelected} root /></nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto">{!selected ? <Empty title="选择文件">展开目录，查看项目当前的 UTF-8 文本。支持最大 512 KB 的普通文件。</Empty> : <><div className="shrink-0 border-b border-line px-3 py-2"><p className="break-all font-mono text-[12px]">{selected}</p>{preview?.path === selected && <p className="mt-1 text-[11px] text-muted-foreground">{preview.bytes.toLocaleString()} 字节 · 当前磁盘内容</p>}</div>{error && <div className="p-3"><Notice error>{error}</Notice></div>}{loading && <p role="status" className="p-4 text-[12px] text-muted-foreground">正在读取文件…</p>}{preview?.path === selected && <pre tabIndex={0} aria-label={`文件内容 ${preview.path}`} className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed">{preview.text || "（空文件）"}</pre>}</>}</div>
    </div>
  </section>;
}

export function ProjectDiff({ projectId, connected }: { projectId: string; connected: boolean }) {
  const [diff, setDiff] = useState<GitDiff | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setDiff(null); setError(""); setLoading(false);
    if (connected) {
      setLoading(true);
      void api<GitDiff>(query("diff", { projectId }), undefined, controller.signal).then(value => { if (!controller.signal.aborted) setDiff(value); }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }
    return () => controller.abort();
  }, [projectId, connected, refresh]);
  return <section className="flex h-full min-h-0 flex-col" aria-label="项目 Git 改动"><div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[11.5px] text-muted-foreground"><span>暂存和未暂存改动；不含未跟踪文件及排除文件。</span><button type="button" aria-label="刷新差异" className="flex shrink-0 items-center gap-1 rounded-md px-1 py-1 hover:bg-secondary disabled:opacity-50" disabled={!connected || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-3" />刷新</button></div>
    {!connected ? <Empty title="连接断开">重新连接后再读取项目差异。</Empty> : loading ? <p role="status" className="p-4 text-[12px] text-muted-foreground">正在读取 Git 差异…</p> : error ? <div className="p-4"><Notice error>{error}</Notice></div> : diff && !diff.available ? <Empty title="无法读取 Git 差异">项目可能尚未初始化 Git，或差异超过读取范围。<p className="mt-2 font-mono text-[11px]">{diff.code}</p></Empty> : diff?.text ? <>{diff.truncated && <p className="px-4 py-2 text-[12px] text-muted-foreground">差异已截断，请在本机 Git 中查看完整内容。</p>}<pre tabIndex={0} aria-label="Git diff" className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed">{diff.text}</pre></> : <Empty title="没有可显示的已跟踪改动">当前项目在此读取范围内没有差异。新文件可在文件树查看。</Empty>}
  </section>;
}

function ToolReceipts({ session: c, kind, onOpenFile }: { session: NativeSession; kind: Exclude<WorkTab, "plan">; onOpenFile: (path: string) => void }) {
  const [selected, setSelected] = useState("");
  useEffect(() => { setSelected(""); }, [c.projectId, c.selectedKey, c.taskId, kind]);
  const entries = c.taskLoading || c.selectedKey && !c.historyReady ? [] : c.selectedKey
    ? c.messages.filter(message => message.role === "toolResult").map(message => ({ id: message.id, name: message.toolName ?? "工具", status: message.isError ? "failed" : "completed", text: message.text, filePath: message.filePath, message }))
    : (c.visibleTask?.toolCalls ?? []).map(call => ({ id: call.toolCallId, name: call.name, status: call.status, text: call.result ?? call.output ?? "", filePath: call.filePath, message: undefined as Message | undefined }));
  const filtered = entries.filter(entry => kind === "terminal" ? entry.name === "bash" : kind === "changes" ? ["write", "edit"].includes(entry.name) : true);
  const current = filtered.find(entry => entry.id === selected) ?? filtered[0], labels: Record<string, string> = { running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消", unknown: "结果未知" };
  return !filtered.length ? <Empty title={kind === "terminal" ? "命令输出" : "工具回执"}>当前任务或历史页没有相应工具结果。</Empty> : <div className="flex min-h-0 flex-col @min-[560px]:flex-row"><nav className="max-h-40 shrink-0 overflow-auto border-b border-line p-2 @min-[560px]:max-h-none @min-[560px]:w-40 @min-[560px]:border-r @min-[560px]:border-b-0" aria-label="工具回执列表">{filtered.map(entry => <button key={entry.id} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[12.5px] ${current?.id === entry.id ? "bg-accent text-accent-foreground" : "hover:bg-secondary"}`} onClick={() => setSelected(entry.id)}><FileCode2 className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{entry.name}</span><span className={`shrink-0 whitespace-nowrap text-[11px] ${entry.status === "failed" || entry.status === "unknown" ? "text-destructive" : "text-muted-foreground"}`}>{labels[entry.status]}</span></button>)}</nav><div className="min-w-0 flex-1 overflow-auto p-4">{current && <><p className="mb-3 text-[12px] text-muted-foreground">{current.name}，{labels[current.status]} · 工具回执</p>{current.filePath && !current.message && <button type="button" className="mb-3 break-all text-left font-mono text-[12px] text-primary underline" onClick={() => onOpenFile(current.filePath!)}>查看文件 {current.filePath}</button>}{current.message ? <NativeMessage key={`${c.selectedKey}:${current.id}`} message={current.message} sessionKey={c.selectedKey || undefined} onOpenFile={onOpenFile} /> : <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed">{current.text || "等待工具输出…"}</pre>}</>}</div></div>;
}
