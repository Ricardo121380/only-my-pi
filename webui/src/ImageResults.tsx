import { useEffect, useState } from "react";
import type { ModelLedger, ModelRequest, SessionImage } from "../../packages/model-calls/contracts";
import { api, query } from "./api";
import "./classification.css";

const states: Record<ModelRequest["status"], string> = { reserved: "已预占 · 未发出", dispatched: "生图请求已发出 · 等待回执", unknown: "生图结果未知 · 继续占额", not_sent: "生图未发出", completed: "Provider 生图请求已完成", failed: "Provider 生图请求失败" };
const storageStates = { saved: "图片已保存为会话产物", partial: "部分图片已保存 · 输出不完整", failed: "本地保存失败 · 不重新生成", unknown: "本地保存结果待核对 · 不重新生成", invalid: "没有通过校验的图片" };
export function SessionImageView({ projectId, artifact }: { projectId: string; artifact: SessionImage }) {
  const [state, setState] = useState("正在读取会话图片…");
  const url = query("image-artifact", { projectId, requestId: artifact.requestId, index: String(artifact.index) });
  return <figure className="session-image">
    <img src={url} width={artifact.width} height={artifact.height} loading="lazy" alt={`生成图片 ${artifact.index + 1} · ${artifact.model}`} onLoad={() => setState("")} onError={() => { void api(url).then(() => setState("图片无法显示，请核对内容状态。")).catch(error => setState(`会话图片不可用（${error instanceof Error ? error.message : "IMAGE_ARTIFACT_UNAVAILABLE"}）。原请求和来源保留，不重新生成。`)); }} />
    {state && <p role="status">{state}</p>}
    <figcaption>{artifact.width} × {artifact.height} · {artifact.bytes} 字节 · PNG<p className="metric-fine">来源请求 {artifact.requestId} · 账号 {artifact.accountId}<br />SHA-256 {artifact.sha256}</p></figcaption>
  </figure>;
}
export function ImageResults({ projectId, taskId, sessionId, running = false }: { projectId: string; taskId?: string; sessionId?: string; running?: boolean }) {
  const [ledger, setLedger] = useState<ModelLedger | null>(null), [error, setError] = useState(""), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const next = await api<ModelLedger>(query("model-calls", { projectId }), undefined, controller.signal); if (!controller.signal.aborted) { setLedger(next); setError(""); } }
      catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "MODEL_LEDGER_UNAVAILABLE"); }
      finally { if (running && !controller.signal.aborted) timer = setTimeout(() => void load(), 1000); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, taskId, sessionId, running, refresh]);
  const tasks = ledger?.tasks.filter(task => (taskId ? task.taskId === taskId : sessionId ? task.sessionId === sessionId : false) && task.snapshot.image) ?? [];
  if (!tasks.length && !error) return null;
  return <section className="classification-results" aria-label="生图结果与会话产物"><div className="between"><h3>生图结果与会话产物</h3><button className="linkbtn" onClick={() => setRefresh(n => n + 1)}>核对生图账本</button></div>
    <p>图片保存在 OMP 会话范围。核对只读取已有结果，未知请求继续占额，不自动重试或重新生成。</p>{error && <p role="alert">读取未完成（{error}）。保留原数据。</p>}
    {tasks.map(task => { const binding = task.snapshot.image!; const requests = task.requests.filter(request => request.kind === "image");
      return <article key={task.taskId}><p>固定绑定：{binding.model} · 账号 {binding.accountId} · 版本 {task.snapshot.revision}</p>
        <p>请求 {requests.length}/{binding.budget.requests} · 占用并发 {requests.filter(r => ["reserved", "dispatched", "unknown"].includes(r.status)).length}/{binding.budget.concurrency}</p>
        <p>图片已预占 {requests.reduce((n, r) => n + (r.reservation.images ?? 0), 0)}/{binding.budget.images} 张 · 存储已预占 {requests.reduce((n, r) => n + (r.reservation.storageBytes ?? 0), 0)}/{binding.budget.storageBytes} 字节</p>
        {!requests.length && <p>尚无生图请求；项目配置不代表本任务已授权。</p>}
        {requests.map(request => <details open className={`classifier-request ${request.status}`} key={request.requestId}><summary>{states[request.status]}</summary>
          <p className="metric-fine">请求 {request.requestId} · 父脚本 {request.parentToolCallId}</p>
          {request.storage && <p>{storageStates[request.storage.status]} · 已保存 {request.storage.bytes} 字节</p>}
          {request.error && <p role="status">{request.error}；远端请求和本地保存分别记录。</p>}
          {request.storage?.artifacts.map(artifact => <SessionImageView key={`${artifact.requestId}:${artifact.index}`} projectId={projectId} artifact={artifact} />)}
          <p>{request.usage.tokens ? `Provider 回报 token：输入 ${request.usage.tokens.input} · 输出 ${request.usage.tokens.output}` : "Provider 用量未知，不能记为零"} · {request.usage.estimatedCost === null ? "费用未知" : `SDK 估算 $${request.usage.estimatedCost.toFixed(6)}（非账单）`}</p>
          {!request.usage.tokens && request.usage.coverage && (request.usage.coverage.input !== null || request.usage.coverage.output !== null) && <p>部分回报：输入 {request.usage.coverage.input ?? "未知"} · 输出 {request.usage.coverage.output ?? "未知"}；缺字段不补零。</p>}
          {request.priceSnapshot && <details><summary>价格快照与来源</summary><p>{request.priceSnapshot.source} · {request.priceSnapshot.at} · {request.priceSnapshot.currency} · 费用上限未知</p><pre>{request.priceSnapshot.value ? JSON.stringify(request.priceSnapshot.value, null, 2) : "目录价格未知；SDK 估算不是账单。"}</pre></details>}
        </details>)}
      </article>;
    })}
  </section>;
}
