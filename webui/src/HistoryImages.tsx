import { useEffect, useState } from "react";
import type { ImageExport, ImageReference, SessionImagesView } from "../../packages/model-calls/contracts";
import { api, query } from "./api";
import { HostDialog } from "./HostDialog";
import { SessionImageView } from "./ImageResults";

class ExportRejection extends Error {}
async function exportAction(input: object): Promise<ImageExport> {
  const response = await fetch("/api/image-export", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-image-export-protocol": "1" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) {
    const code = data.code ?? "IMAGE_EXPORT_FAILED";
    if (["IMAGE_EXPORT_TARGET_CHANGED", "IMAGE_EXPORT_WRITE_PERMISSION_REQUIRED", "IMAGE_EXPORT_OVERWRITE_REQUIRED", "IMAGE_EXPORT_PATH_DENIED", "FILE_PATH_DENIED", "FILE_SYMLINK_DENIED", "OWNERSHIP_HELD", "IMAGE_SOURCE_UNAVAILABLE"].includes(code)) throw new ExportRejection(code);
    throw new Error(code);
  }
  return data;
}
const statusText = { prepared: "目标已核对，等待明确写入", dispatched: "导出回执待核对，不自动重放", unknown: "导出结果未知，写入占用保留，不自动重放", completed: "项目导出已完成", failed: "项目导出失败，保留原记录", cancelled: "导出已取消" };
export function HistoryImages({ projectId, projectName, sessionKey, connected, revision = 0 }: { projectId: string; projectName?: string; sessionKey: string; connected: boolean; revision?: number }) {
  const [view, setView] = useState<SessionImagesView | null>(null), [exports, setExports] = useState<ImageExport[]>([]), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ImageReference | null>(null), [relative, setRelative] = useState(""), [plan, setPlan] = useState<ImageExport | null>(null), [write, setWrite] = useState(false), [overwrite, setOverwrite] = useState(false), [busy, setBusy] = useState(false), [exportError, setExportError] = useState(""), [receiptLost, setReceiptLost] = useState(false), [rejected, setRejected] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setView(null); setExports([]); setError("");
    void Promise.all([api<SessionImagesView>(query("session-images", { projectId, sessionKey }), undefined, controller.signal), api<{ exports: ImageExport[] }>(query("image-exports", { projectId }), undefined, controller.signal)]).then(([next, operations]) => { if (!controller.signal.aborted) { setView(next); setExports(operations.exports); } }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "IMAGE_HISTORY_UNAVAILABLE"); });
    return () => controller.abort();
  }, [projectId, sessionKey, refresh, revision]);
  function choose(reference: ImageReference) { setSelected(reference); setRelative(`image-${reference.artifact.requestId.slice(0, 8)}-${reference.artifact.index}.png`); setPlan(null); setWrite(false); setOverwrite(false); setExportError(""); setReceiptLost(false); setRejected(false); }
  async function prepare() {
    if (!selected || busy) return; setBusy(true); setExportError("");
    try { setPlan(await exportAction({ type: "prepare", projectId, sessionKey, entryId: selected.entryId, requestId: selected.artifact.requestId, index: selected.artifact.index, path: relative })); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "IMAGE_EXPORT_FAILED"); }
    finally { setBusy(false); }
  }
  async function commit() {
    if (!plan || busy || receiptLost) return; setBusy(true); setExportError("");
    try { setPlan(await exportAction({ type: "commit", operationId: plan.operationId, codingAuthorized: write, overwrite })); setRefresh(n => n + 1); }
    catch (cause) { if (cause instanceof ExportRejection) { setRejected(true); setExportError(`导出被拒绝（${cause.message}），选定目标未发布；重新核对后再明确写入。`); } else { setReceiptLost(true); setExportError(`回执未确认（${cause instanceof Error ? cause.message : "IMAGE_EXPORT_UNKNOWN"}）。先核对原操作，不再次提交。`); } }
    finally { setBusy(false); }
  }
  async function replan() {
    if (!plan || busy) return; setBusy(true);
    try { await exportAction({ type: "cancel", operationId: plan.operationId }); setPlan(null); setWrite(false); setOverwrite(false); setRejected(false); setExportError(""); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "IMAGE_EXPORT_UNKNOWN"); }
    finally { setBusy(false); }
  }
  async function check() {
    if (!plan || busy) return; setBusy(true); setExportError("");
    try { const result = await api<{ exports: ImageExport[] }>(query("image-exports", { projectId })); const record = result.exports.find(r => r.operationId === plan.operationId); if (!record) throw new Error("IMAGE_EXPORT_NOT_FOUND"); setPlan(record); setReceiptLost(false); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "IMAGE_EXPORT_UNKNOWN"); }
    finally { setBusy(false); }
  }
  async function reconcile(operationId: string) {
    setBusy(true); setExportError("");
    try { const record = await exportAction({ type: "reconcile", operationId }); if (plan?.operationId === operationId) setPlan(record); setRefresh(n => n + 1); }
    catch (cause) { setExportError(cause instanceof Error ? cause.message : "IMAGE_EXPORT_UNKNOWN"); }
    finally { setBusy(false); }
  }
  return <section className="classification-results" aria-label="历史会话图片"><div className="between"><h3>历史会话图片</h3><button className="linkbtn" disabled={busy} onClick={() => setRefresh(n => n + 1)}>核对已有产物</button></div>
    <p>恢复、下载和核对只读取原图片，不重新生成。分支保留原来源，不继承模型、MCP 或写入授权。</p>
    {error && <p role="alert">读取未完成（{error}）。保留原历史与图片；需要兼容的 reader 后再核对。</p>}
    {!selected && exportError && <p role="alert">{exportError}；原导出记录保留。</p>}
    {!view && !error && <p role="status">正在读取分支引用…</p>}
    {view && <><p>当前分支引用 {view.images.length} 张 · {view.space.referencedBytes} 字节 · 可用空间 {view.space.availableBytes === null ? "未知" : `${Math.floor(view.space.availableBytes / 1048576)} MiB`}</p><p className="metric-fine">清理需显式处理并核对共享引用；此处保留历史、共享图片和项目原件。</p>{!view.images.length && <p>此分支位置没有图片引用。</p>}</>}
    {view?.images.map(reference => { const artifact = reference.artifact, values = { projectId, sessionKey, entryId: reference.entryId, requestId: artifact.requestId, index: artifact.index };
      return <article key={`${reference.entryId}:${artifact.index}`}><p>{reference.shared ? "共享原会话图片" : "原会话图片"} · 原会话 {artifact.sessionId}<br />分支位置 {reference.entryId} · {artifact.model}</p>
        {reference.storageStatus === "unknown" && <p role="status">本地保存确认待核对；原请求与图片引用保留，不重新生成。</p>}
        {reference.state === "available" ? <><SessionImageView projectId={projectId} artifact={artifact} sessionKey={sessionKey} entryId={reference.entryId} /><div className="image-actions"><a className="softbtn" href={query("image-artifact", { ...values, download: "1" })} download={`image-${artifact.requestId}-${artifact.index}.png`}>下载 PNG</a><button className="softbtn" disabled={!connected || !view.exportAvailable || busy} onClick={() => choose(reference)}>导出到项目…</button></div></> : <p role="status">图片引用保留，内容不可用（{reference.error}）。不重新生成；修复存储后可重新核对。</p>}
      </article>;
    })}
    {exports.filter(record => view?.images.some(reference => reference.artifact.requestId === record.source.requestId)).map(record => <p key={record.operationId} role="status">{statusText[record.status]} · {record.target.path} · 操作 {record.operationId}{record.error && ` · ${record.error}`}{["unknown", "dispatched"].includes(record.status) && <button className="linkbtn" disabled={busy || !connected} onClick={() => void reconcile(record.operationId)}>明确核对目标字节</button>}</p>)}
    <HostDialog open={!!selected} title="显式导出图片到项目" onClose={() => { if (!busy) setSelected(null); }}>
      <p>目标项目：{projectName ?? projectId}。下载由浏览器保存；此操作会写入所选项目。</p><label className="field">项目内 PNG 路径<input value={relative} disabled={busy || !!plan} onChange={event => setRelative(event.target.value)} placeholder="images/result.png（父目录需已存在）" /></label>
      {!plan && <button className="softbtn" disabled={busy || !connected || !relative} onClick={() => void prepare()}>核对源图片与目标</button>}
      {plan && <><p role="status">{statusText[plan.status]} · 操作 {plan.operationId}</p><p>目标：{plan.target.path}<br />源 SHA-256：{plan.source.sha256}</p>{plan.target.exists && <p>已有目标 {plan.target.beforeBytes} 字节 · SHA-256 {plan.target.beforeSha256}</p>}
        {plan.status === "prepared" && !receiptLost && !rejected && <><label className="image-confirm"><input type="checkbox" checked={write} disabled={busy} onChange={e => setWrite(e.target.checked)} />允许将此图片写入当前项目的选定路径</label>{plan.target.exists && <label className="image-confirm"><input type="checkbox" checked={overwrite} disabled={busy} onChange={e => setOverwrite(e.target.checked)} />确认覆盖以上版本的已有目标</label>}<button className="softbtn primary" disabled={busy || !connected || !write || plan.target.exists && !overwrite} onClick={() => void commit()}>确认写入项目</button></>}
        {rejected && <button className="softbtn" disabled={busy || !connected} onClick={() => void replan()}>重新核对目标</button>}
        {(receiptLost || ["unknown", "dispatched"].includes(plan.status)) && <button className="softbtn" disabled={busy || !connected} onClick={() => void check()}>核对原导出记录</button>}
      </>}
      {exportError && <p role="alert">{exportError}</p>}{busy && <p role="status">正在核对，请保留此窗口…</p>}
    </HostDialog>
  </section>;
}
