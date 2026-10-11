import { useEffect, useRef, useState } from "react";
import type { AccountDirectory } from "../../packages/host/contracts";
import type { ClassifierChoice, ClassifierConfig, ModelBudget, ImageBudget, ModelLedger } from "../../packages/model-calls/contracts";
import { api, query } from "./api";
import { HostDialog } from "./HostDialog";
import "./classification.css";

const defaults: ModelBudget = { requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 8192, inputBytes: 32768, outputBytes: 32768, timeoutMs: 10000 };
const fields: [keyof ModelBudget, string, number][] = [["requests", "任务请求次数", 32], ["concurrency", "任务并发数", 4], ["maxInputBytes", "单次输入字节", 32768], ["maxOutputBytes", "单次输出字节", 65536], ["inputBytes", "任务输入字节", 1048576], ["outputBytes", "任务输出字节", 2097152], ["timeoutMs", "单次超时毫秒", 60000]];
const imageDefaults: ImageBudget = { ...defaults, maxOutputBytes: 2097152, outputBytes: 8388608, maxImagesPerRequest: 1, images: 4, maxStorageBytes: 1048576, storageBytes: 4194304 };
const imageFields: [keyof ImageBudget, string, number][] = [...fields.map(([key, label, max]): [keyof ImageBudget, string, number] => [key, label, key === "maxOutputBytes" ? 16777216 : key === "outputBytes" ? 67108864 : max]), ["maxImagesPerRequest", "单次返回图片上限", 4], ["images", "任务图片预占上限", 32], ["maxStorageBytes", "单次图片存储字节", 10485760], ["storageBytes", "任务存储预占字节", 67108864]];
const explain = (cause: unknown) => {
  const code = cause instanceof Error ? cause.message : "MODEL_LEDGER_UNAVAILABLE";
  const messages: Record<string, string> = { CLASSIFIER_REVISION_CONFLICT: "配置已被其他页面更新。请重新打开后核对；本次没有覆盖。", IMAGE_REVISION_CONFLICT: "配置已被其他页面更新。请重新打开后核对；本次没有覆盖。", CLASSIFIER_UNAVAILABLE: "所选分类模型或凭据不可用，请核对账号并刷新目录。", IMAGE_UNAVAILABLE: "所选生图模型或凭据不可用，请核对账号并刷新目录。", CLASSIFIER_CONFIG_INVALID: "配置无效，请检查所有有限额度。", IMAGE_CONFIG_INVALID: "生图配置无效，请检查所有有限额度。", AUTH_REQUIRED: "连接授权已失效，请从终端重新配对。" };
  return messages[code] ?? `未完成（${code}）。请核对状态；请求不会自动重发。`;
};
export function ClassifierPanel({ projectId, projectName, onClose, kind = "classifier" }: { projectId: string; projectName?: string; onClose: () => void; kind?: "classifier" | "image" }) {
  const label = kind === "image" ? "生图" : "分类", initialBudget = kind === "image" ? imageDefaults : defaults;
  const [config, setConfig] = useState<ClassifierConfig | null>(null), [accounts, setAccounts] = useState<AccountDirectory | null>(null);
  const [accountId, setAccountId] = useState(""), [model, setModel] = useState(""), [models, setModels] = useState<ClassifierChoice[]>([]);
  const [budget, setBudget] = useState<ModelBudget | ImageBudget>(initialBudget), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loadingModels, setLoadingModels] = useState(false), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([api<ModelLedger>(query("model-calls", { projectId }), undefined, controller.signal), api<AccountDirectory>("/api/accounts", undefined, controller.signal)])
      .then(([ledger, directory]) => { if (controller.signal.aborted) return; setConfig(ledger.config); setAccounts(directory); setAccountId(ledger.config[kind]?.accountId ?? ""); setModel(ledger.config[kind]?.model ?? ""); setBudget(ledger.config[kind]?.budget ?? initialBudget); })
      .catch(cause => { if (!controller.signal.aborted) setError(explain(cause)); });
    return () => controller.abort();
  }, [projectId, kind]);
  useEffect(() => {
    const controller = new AbortController(); setModels([]);
    if (!accountId) { setLoadingModels(false); return; }
    setLoadingModels(true);
    void api<{ models: ClassifierChoice[] }>(query("models", { accountId, type: kind }), undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setModels(data.models); })
      .catch(cause => { if (!controller.signal.aborted) setError(explain(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, [accountId, refresh, kind]);
  async function save(disable = false) {
    if (!config || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/model-calls", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify({ type: "save", projectId, revision: config.revision, [kind]: disable ? null : { accountId, model, budget } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.code);
      setConfig(result); setNotice(disable ? `${label}已停用；后续请求将被拒绝，未知请求继续占额。` : `项目${label}配置已保存，下一任务使用新绑定。每个任务仍须单独授权。`);
    } catch (cause) { setError(explain(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  const selected = models.find(item => item.id === model);
  const budgetFields = kind === "image" ? imageFields : fields;
  return <HostDialog open title={`项目${label}模型`} onClose={onClose} className="classifier-dialog">
    <p><strong>{projectName ?? projectId}</strong> · 配置版本 {config?.revision ?? "…"}</p>
    <p>{label}账号与聊天账号{kind === "image" ? "、分类账号" : ""}分别选择。任务创建时固定绑定；修改供下一任务使用，停用立即阻止新请求。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!config || !accounts ? <p role="status">正在读取{label}配置…</p> : <form onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
      <legend>账号与原生{label}模型</legend>
      <label className="field">{label}账号<select required value={accountId} onChange={event => { setAccountId(event.target.value); setModel(""); setError(""); }}><option value="">请选择{label}账号</option>{accountId && accountId !== accounts.cliReference.accountId && !accounts.accounts.some(a => a.accountId === accountId) && <option value={accountId}>已不可用 · {accountId}</option>}<option value={accounts.cliReference.accountId}>{accounts.cliReference.name}</option>{accounts.accounts.map(item => <option value={item.accountId} key={item.accountId}>{item.name}</option>)}</select></label>
      <label className="field">{label}模型<select required value={model} disabled={loadingModels || !accountId} onChange={event => setModel(event.target.value)}><option value="">请选择{label}模型</option>{model && !models.some(item => item.id === model) && <option value={model} disabled>不可用 · {model}</option>}{models.map(item => <option key={item.id} value={item.id} disabled={!item.supported}>{item.name} · {item.id}{item.supported ? "" : ` · ${item.unavailableReason}`}</option>)}</select></label>
      <button type="button" className="linkbtn" disabled={!accountId || loadingModels} onClick={() => { setError(""); setRefresh(n => n + 1); }}>刷新{label}目录</button>
      {loadingModels ? <p role="status">正在读取{label}目录…</p> : accountId && !models.length && <p>此账号没有可用{label}模型。请在账号管理配置对应协议与凭据后刷新。</p>}
      <p className="classifier-warning">费用上限未知。当前原生协议不能保证单次费用上限，每个任务需明确同意按其他额度运行。{selected?.price ? "目录价格只用于估算，不是账单。" : "目录价格未知，费用不会显示为零。"}</p>
      <fieldset className="classifier-budgets"><legend>任务共享预算</legend>{budgetFields.map(([key, label, max]) => <label className="field" key={key}>{label}<input required type="number" min={1} max={max} step={1} value={(budget as ImageBudget)[key]} onChange={event => setBudget({ ...budget, [key]: Number(event.target.value) })} /></label>)}</fieldset>
      {kind === "image" && <p>支持原生 openrouter-images 文本／所选模型支持的 PNG 输入及非交错 8-bit RGB/RGBA PNG 输出，最多 4 MP。原生协议未提供尺寸和质量参数，不接受脚本扩参。图片只保留在会话，不自动写项目；全局存储预占上限 256 MiB。</p>}
      <p>所有脚本共享这些额度，发送前预占单次输入和输出上限。字节限制控制请求及接收内容，不能保证 Provider 实际生成量或扣费。未知结果继续占额，不自动重试。</p>
      <div className="classifier-actions"><button className="softbtn primary" disabled={!selected?.supported || loadingModels}>保存项目{label}配置</button><button type="button" className="softbtn" disabled={!config[kind]} onClick={() => void save(true)}>停用{label}</button></div>
    </fieldset></form>}
  </HostDialog>;
}
const statuses = { reserved: "已预占 · 未发出", dispatched: "请求已发出 · 等待回执", unknown: "结果未知 · 继续占额", not_sent: "未发出", completed: "分类完成", failed: "分类失败" };
export function ClassificationResults({ projectId, taskId, sessionId, running = false }: { projectId: string; taskId?: string; sessionId?: string; running?: boolean }) {
  const [ledger, setLedger] = useState<ModelLedger | null>(null), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const value = await api<ModelLedger>(query("model-calls", { projectId }), undefined, controller.signal); if (!controller.signal.aborted) { setLedger(value); setError(""); } }
      catch (cause) { if (!controller.signal.aborted) setError(explain(cause)); }
      finally { if (running && !controller.signal.aborted) timer = setTimeout(() => void load(), 1000); }
    };
    void load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, taskId, sessionId, running, revision]);
  const tasks = ledger?.tasks.filter(task => task.snapshot.classifier && (taskId ? task.taskId === taskId : sessionId ? task.sessionId === sessionId : false)) ?? [];
  if (!tasks.length && !error) return null;
  return <section className="classification-results" aria-label="分类结果与用量"><div className="between"><h3>分类结果与用量</h3><button className="linkbtn" onClick={() => setRevision(n => n + 1)}>核对分类账本</button></div>
    <p className="metric-fine">未知结果继续占额，不自动重试。核对只读取账本；父脚本不再累计一次分类用量。</p>{error && <p role="alert">{error}</p>}
    {tasks.map(original => { const task = { ...original, requests: original.requests.filter(request => (request.kind ?? "classifier") === "classifier") }; const binding = task.snapshot.classifier; if (!binding) return null;
      const reserved = task.requests.filter(request => ["reserved", "dispatched", "unknown"].includes(request.status));
      return <article key={task.taskId}>
        <p>固定绑定：{binding.model} · 账号 {binding.accountId} · 版本 {task.snapshot.revision}</p>
        <p>请求 {task.requests.length}/{binding.budget.requests} · 占用并发 {reserved.length}/{binding.budget.concurrency}</p>
        <p>输入已预占 {task.requests.reduce((n, r) => n + r.reservation.inputBytes, 0)}/{binding.budget.inputBytes} 字节 · 输出已预占 {task.requests.reduce((n, r) => n + r.reservation.outputBytes, 0)}/{binding.budget.outputBytes} 字节</p>
        {!task.requests.length && <p>尚无分类请求；配置保存不代表任务已授权。</p>}
        {task.requests.map(request => <details key={request.requestId} open className={`classifier-request ${request.status}`}><summary>{statuses[request.status]}</summary>
          <p className="metric-fine">请求 {request.requestId} · 父脚本 {request.parentToolCallId}</p>
          {request.result?.answers && Object.keys(request.result.answers).length > 0 && <pre aria-label="结构化分类结果">{JSON.stringify(request.result.answers, null, 2)}</pre>}
          <p>{request.usage.tokens ? `Provider 回报 token：输入 ${request.usage.tokens.input} · 输出 ${request.usage.tokens.output}` : "Provider 用量未知，不能记为零"} · {request.usage.estimatedCost === null ? "费用未知" : `SDK 估算 $${request.usage.estimatedCost.toFixed(6)}（非账单）`}</p>
          {!request.usage.tokens && request.usage.coverage && (request.usage.coverage.input !== null || request.usage.coverage.output !== null) && <p>部分回报：输入 {request.usage.coverage.input ?? "未知"} · 输出 {request.usage.coverage.output ?? "未知"}；未报告的字段不补零。</p>}
          {request.priceSnapshot && <details><summary>价格快照与来源</summary><p>来源：{request.priceSnapshot.source} · {request.priceSnapshot.at} · {request.priceSnapshot.currency} · 不构成费用硬上限</p><pre>{request.priceSnapshot.value ? JSON.stringify(request.priceSnapshot.value, null, 2) : "价格未提供；用量覆盖与估算费用分别记录。"}</pre></details>}
          {request.error && <p>{request.error}</p>}
        </details>)}
      </article>;
    })}
  </section>;
}
