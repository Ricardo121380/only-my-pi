import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { accountApi, api, errorText, query } from "../../../webui/src/api";
import type { AccountAction, AccountDirectory, AccountProbeResult, GuiAccount, ModelChoice, StaticProvider, ThinkingLevel } from "../../../packages/accounts/contracts";
import type { TaskSummary } from "../../../packages/host/contracts";
import { isTaskActive } from "../../../webui/src/useNativeSession";
import { fieldClass, Notice } from "./ui";

const clientRejected = (error: unknown) => error instanceof Error && "status" in error && Number(error.status) >= 400 && Number(error.status) < 500;
function Field({ title, children }: { title: string; children: ReactNode }) {
  return <label className="block space-y-1 text-[12px] text-muted-foreground"><span>{title}</span>{children}</label>;
}

export function AccountSettings({ connected, tasks, onChanged }: { connected: boolean; tasks: TaskSummary[]; onChanged: () => void }) {
  const [directory, setDirectory] = useState<AccountDirectory | null>(null), [selected, setSelected] = useState("");
  const [providerId, setProviderId] = useState(""), [name, setName] = useState("");
  const [error, setError] = useState(""), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [unknownCreate, setUnknownCreate] = useState(false);
  const creating = useRef(false), mounted = useRef(true);
  const account = directory?.accounts.find(a => a.accountId === selected);
  async function reload(signal?: AbortSignal) {
    setLoading(true);
    try { const value = await api<AccountDirectory>("/api/accounts", undefined, signal); if (!signal?.aborted && mounted.current) setDirectory(value); }
    catch (cause) { if (!signal?.aborted && mounted.current) setError(errorText(cause)); }
    finally { if (!signal?.aborted && mounted.current) setLoading(false); }
  }
  useEffect(() => {
    mounted.current = true; const controller = new AbortController();
    if (connected) void reload(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [connected]);
  async function create(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (creating.current || busy || unknownCreate || !connected) return;
    creating.current = true; setBusy(true); setError("");
    try {
      const value = await accountApi<{ account: GuiAccount }>({ providerId: providerId.trim(), name: name.trim(), authType: "api_key" });
      if (mounted.current) { await reload(); setSelected(value.account.accountId); setProviderId(""); setName(""); onChanged(); }
    } catch (cause) {
      if (mounted.current) { setError(errorText(cause)); if (!clientRejected(cause)) setUnknownCreate(true); }
    } finally { creating.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="space-y-4" aria-label="管理产品账号">
    <div><h3 className="font-read text-[20px]">管理账号与模型</h3><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">产品账号使用各自的 Pi 凭据存储。CLI 配置保持只读引用，登录和保存配置不授予编程权限。</p></div>
    {error && <Notice error>{error}</Notice>}
    <div className="flex flex-wrap gap-2" aria-label="产品账号列表">{directory?.accounts.map(item => <Button key={item.accountId} type="button" size="sm" variant={selected === item.accountId ? "default" : "outline"} className="h-auto max-w-full whitespace-normal rounded-full" disabled={busy || !connected} aria-pressed={selected === item.accountId} onClick={() => { setSelected(item.accountId); setError(""); }}>{item.name}<span className="text-[11px] opacity-70">{item.providerId}</span></Button>)}</div>
    {!directory?.accounts.length && <p className="text-[12px] text-muted-foreground">{loading ? "正在读取账号…" : "添加一个产品账号，再配置模型和凭据。"}</p>}
    <Button type="button" variant="ghost" size="sm" disabled={busy || loading || !connected} onClick={() => { setError(""); void reload(); }}><RefreshCw className="size-3.5" />刷新账号列表</Button>
    {unknownCreate && <Notice>创建结果未确认，请先刷新列表核对。系统不会自动再创建。<button type="button" className="mt-2 block text-primary underline" onClick={() => setUnknownCreate(false)}>已核对列表，继续创建</button></Notice>}
    <details className="rounded-xl border border-line p-3" open={!directory?.accounts.length || undefined}><summary className="cursor-pointer text-[13px] font-medium">添加 API Key 账号</summary>
      <form onSubmit={create} className="mt-3 space-y-3"><fieldset disabled={busy || !connected || unknownCreate} className="space-y-3">
        <Field title="服务商标识"><input className={fieldClass} aria-label="服务商标识" value={providerId} onChange={e => setProviderId(e.target.value)} required pattern="[a-zA-Z0-9_-]{1,128}" placeholder="例如 commandcode、deepseek" /></Field>
        <Field title="账号名称"><input className={fieldClass} aria-label="账号名称" value={name} onChange={e => setName(e.target.value)} required maxLength={128} placeholder="便于识别的名称" /></Field>
        <Button type="submit" size="sm" className="rounded-full" disabled={!providerId.trim() || !name.trim()}><Plus className="size-3.5" />添加账号</Button>
      </fieldset></form>
    </details>
    {account && <AccountDetails key={account.accountId} account={account} connected={connected} active={tasks.some(t => t.accountId === account.accountId && isTaskActive(t.status))} onBusy={setBusy}
      onChanged={() => { onChanged(); void reload(); }} onRemoved={() => { setSelected(""); onChanged(); void reload(); }} />}
  </section>;
}

type ChatModel = Extract<StaticProvider["models"][number], { type?: "llm" }>;
type FormModel = ChatModel & { localId: string };
const newModel = (): FormModel => ({ localId: crypto.randomUUID(), id: "", name: "", contextWindow: 32000, maxTokens: 4096, reasoning: false });
const chatApis = ["openai-completions", "openai-responses", "anthropic-messages"];

function AccountDetails({ account, connected, active, onBusy, onChanged, onRemoved }: {
  account: GuiAccount; connected: boolean; active: boolean; onBusy: (busy: boolean) => void; onChanged: () => void; onRemoved: () => void;
}) {
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [stored, setStored] = useState<string>("unknown"), [key, setKey] = useState(""), [name, setName] = useState(account.name), [confirmRemove, setConfirmRemove] = useState(false);
  const [baseUrl, setBaseUrl] = useState(""), [protocol, setProtocol] = useState<StaticProvider["api"]>("openai-responses"), [models, setModels] = useState<FormModel[]>([newModel()]);
  const [configLoaded, setConfigLoaded] = useState(false), [unsupported, setUnsupported] = useState(false), [choices, setChoices] = useState<ModelChoice[]>([]);
  const [probeModel, setProbeModel] = useState(""), [thinking, setThinking] = useState<ThinkingLevel | "">(""), [result, setResult] = useState<AccountProbeResult | null>(null);
  const running = useRef(false), alive = useRef(true), dirty = useRef(false), operation = useRef<AbortController | null>(null);
  const locked = busy || loading || !connected || active;
  const levels = choices.find(m => m.id === probeModel)?.thinkingLevels ?? [];
  async function loadModels(signal?: AbortSignal) {
    const value = await api<{ models: ModelChoice[] }>(query("models", { accountId: account.accountId }), undefined, signal);
    if (!signal?.aborted && alive.current) { setChoices(value.models); setProbeModel(id => value.models.some(m => m.id === id) ? id : ""); }
  }
  useEffect(() => {
    alive.current = true; const controller = new AbortController();
    if (connected) {
      setLoading(true); setError("");
      void Promise.allSettled([
        accountApi<{ config: StaticProvider | null }>({ accountId: account.accountId, action: { type: "configuration" } }, controller.signal),
        accountApi<{ status: string }>({ accountId: account.accountId, action: { type: "status" } }, controller.signal),
        loadModels(controller.signal),
      ]).then(([configuration, status, catalog]) => {
        if (controller.signal.aborted) return;
        if (configuration.status === "fulfilled") {
          setConfigLoaded(true);
          if (!dirty.current) {
            const c = configuration.value.config;
            setUnsupported(!!c && (!chatApis.includes(c.api) || c.models.some(m => m.type && m.type !== "llm")));
            setBaseUrl(c?.baseUrl ?? ""); setProtocol(c?.api ?? "openai-responses");
            setModels(c?.models.filter((m): m is ChatModel => !m.type || m.type === "llm").map(m => ({ ...m, localId: crypto.randomUUID() })) ?? [newModel()]);
          }
        } else setError(errorText(configuration.reason));
        if (status.status === "fulfilled") setStored(status.value.status); else setError(errorText(status.reason));
        if (catalog.status === "rejected") setError(errorText(catalog.reason));
        setLoading(false);
      });
    }
    return () => { alive.current = false; controller.abort(); operation.current?.abort(); onBusy(false); };
  }, [account.accountId, connected, onBusy]);
  function editModel(localId: string, change: Partial<FormModel>) { dirty.current = true; setResult(null); setModels(list => list.map(m => m.localId === localId ? { ...m, ...change } : m)); }
  async function execute(action: AccountAction) {
    if (running.current || !connected || active || loading) return;
    running.current = true; setBusy(true); onBusy(true); setError(""); setNotice(""); setResult(null);
    const controller = new AbortController(); operation.current = controller;
    if (action.type === "apiKey") setKey("");
    try {
      const value = await accountApi<{ status?: string } | AccountProbeResult>({ accountId: account.accountId, action }, controller.signal);
      if (!alive.current) return;
      if (action.type === "probe") { setResult(value as AccountProbeResult); return; }
      if (action.type === "remove") { onRemoved(); return; }
      if (action.type === "status") { setStored(value.status ?? "unknown"); setNotice(value.status === "stored" ? "凭据已存储；实际可用性请明确测试连接。" : "当前没有存储凭据。"); return; }
      if (action.type === "apiKey") { setStored("stored"); setNotice(value.status === "stored_sync_failed" ? "凭据已保存，模型同步尚未完成。请刷新模型列表。" : "凭据已保存。请明确选择模型并测试连接。"); }
      if (action.type === "configure") { dirty.current = false; setNotice("模型配置已保存，不会自动发送请求。"); }
      if (action.type === "rename") setNotice("账号名称已更新。");
      if (action.type === "logout") { setStored("missing"); setNotice("已登出，私有凭据已移除；账号与历史保留。"); }
      onChanged();
      try { await loadModels(controller.signal); } catch { if (alive.current) setError("设置已保存，但模型列表未刷新。请明确刷新后重选模型。"); }
    } catch (cause) {
      if (!alive.current) return;
      if (controller.signal.aborted) setNotice(action.type === "probe" ? "连接测试已请求取消；已发请求的结果可能未知，不会自动重试。" : "已停止等待，操作结果尚未确认；请刷新状态核对，不会自动重发。");
      else setError(action.type === "apiKey" && !clientRejected(cause) ? "保存结果尚未确认，密钥输入已清空。请查询凭据状态，系统不会自动重发。" : `${errorText(cause)}${action.type === "apiKey" ? " 密钥输入已清空。" : ""}`);
    } finally { running.current = false; if (alive.current) { setBusy(false); onBusy(false); } }
  }
  const reasonText = result?.status === "connected" ? "连接可用：所选账号与模型已返回有效文字。"
    : result?.status === "unknown" ? result.reason === "timeout" ? "连接测试超时，结果未知；不会自动重试。" : "服务已响应，但未得到完整文字；请检查模型设置后明确重试。"
    : result?.status === "rejected" ? result.reason === "authentication" ? "服务拒绝了此账号（401/403）。请更换凭据，或检查账号套餐与模型权限。" : result.reason === "rate_limited" ? "服务限流或额度不足（429）。请稍后明确重试，不会换用其他账号。" : "模型服务未完成请求。请检查地址、协议或服务状态。" : "";
  return <div className="space-y-4 border-t border-line pt-4" aria-label="所选产品账号">
    <div><h4 className="text-[14px] font-medium">{account.name}</h4><p className="mt-1 text-[12px] text-muted-foreground">{account.providerId} · {stored === "stored" ? "凭据已存储" : stored === "missing" ? "尚未保存凭据" : "凭据状态未确认"}</p></div>
    {active && <Notice>此账号正在执行任务。请停止任务并等待进程退出后修改设置。</Notice>}
    {error && <Notice error>{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    <form onSubmit={e => { e.preventDefault(); void execute({ type: "rename", name }); }} className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field title="显示名称"><input aria-label="显示名称" className={fieldClass} value={name} disabled={locked} onChange={e => setName(e.target.value)} required maxLength={128} /></Field></div><Button size="sm" variant="outline" disabled={locked || !name.trim()} className="rounded-full">保存名称</Button></form>
    {account.authType === "api_key" ? <form onSubmit={e => { e.preventDefault(); void execute({ type: "apiKey", key }); }} className="space-y-2"><Field title="API Key"><input aria-label="API Key" className={fieldClass} type="password" autoComplete="off" spellCheck={false} value={key} disabled={locked} onChange={e => setKey(e.target.value)} maxLength={16384} /></Field><div className="flex flex-wrap gap-2"><Button size="sm" className="rounded-full" disabled={locked || !key.trim()}>保存凭据</Button><Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void execute({ type: "status" })}>查询凭据状态</Button></div></form> : <Notice>此账号使用 OAuth。当前基础界面只提供 API Key 配置，OAuth 登录请在原认证入口完成。</Notice>}
    <details className="rounded-xl border border-line p-3"><summary className="cursor-pointer text-[13px] font-medium">服务地址与模型配置</summary><p className="mt-2 text-[12px] text-muted-foreground">使用自定义网关时填写。保存会替换此账号的聊天模型列表；下方保留全部已读取的模型。</p>
      {unsupported ? <Notice>此配置包含其他模型类型，请使用原配置入口管理。</Notice> : <form onSubmit={e => { e.preventDefault(); void execute({ type: "configure", config: { baseUrl: baseUrl.trim(), api: protocol, models: models.map(({ localId: _id, ...model }) => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })) } }); }} className="mt-3 space-y-3"><fieldset disabled={locked || !configLoaded} className="space-y-3">
        <Field title="服务地址"><input aria-label="服务地址" className={fieldClass} type="url" required value={baseUrl} onChange={e => { dirty.current = true; setBaseUrl(e.target.value); setResult(null); }} placeholder="https://api.example.com/v1" /></Field>
        <Field title="API 协议"><select aria-label="API 协议" className={fieldClass} value={protocol} onChange={e => { dirty.current = true; setProtocol(e.target.value as StaticProvider["api"]); setResult(null); }}><option value="openai-responses">OpenAI Responses</option><option value="openai-completions">OpenAI Chat Completions</option><option value="anthropic-messages">Anthropic Messages</option></select></Field>
        {models.map((model, index) => <div key={model.localId} className="space-y-2 rounded-xl bg-muted/60 p-3"><div className="flex items-center justify-between text-[12px]"><span>模型 {index + 1}</span><button type="button" aria-label={`移除模型 ${index + 1}`} disabled={models.length === 1} onClick={() => { dirty.current = true; setModels(list => list.filter(m => m.localId !== model.localId)); setResult(null); }}><Trash2 className="size-3.5" /></button></div>
          <Field title="模型 ID"><input aria-label={`模型 ID ${index + 1}`} className={fieldClass} required maxLength={256} value={model.id} onChange={e => editModel(model.localId, { id: e.target.value })} placeholder="deepseek/deepseek-v4.1-flash" /></Field>
          <Field title="模型名称"><input aria-label={`模型名称 ${index + 1}`} className={fieldClass} maxLength={256} value={model.name} onChange={e => editModel(model.localId, { name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2"><Field title="上下文窗口"><input aria-label={`上下文窗口 ${index + 1}`} className={fieldClass} type="number" min={1} max={10000000} required value={model.contextWindow} onChange={e => editModel(model.localId, { contextWindow: Number(e.target.value) })} /></Field><Field title="最大输出 Token"><input aria-label={`最大输出 Token ${index + 1}`} className={fieldClass} type="number" min={1} max={1000000} required value={model.maxTokens ?? 4096} onChange={e => editModel(model.localId, { maxTokens: Number(e.target.value) })} /></Field></div>
          <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={model.reasoning === true} onChange={e => editModel(model.localId, { reasoning: e.target.checked })} />支持思考强度选择</label>
        </div>)}
        <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="ghost" disabled={models.length >= 100} onClick={() => { dirty.current = true; setModels(list => [...list, newModel()]); }}>添加模型</Button><Button size="sm" variant="outline" className="rounded-full">保存模型配置</Button></div>
      </fieldset></form>}
    </details>
    <section className="space-y-3 rounded-xl border border-line p-3" aria-label="连接测试"><p className="text-[13px] font-medium">测试连接</p><p className="text-[12px] text-muted-foreground">明确发送一次短文本请求，最多 512 个输出 Token，可能计费。不执行工具，不写入会话历史，不自动重试。</p>
      <Field title="测试模型"><select aria-label="测试模型" className={fieldClass} disabled={locked} value={probeModel} onChange={e => { setProbeModel(e.target.value); setThinking(""); setResult(null); }}><option value="">明确选择模型</option>{choices.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      {!!levels.length && <Field title="测试思考强度"><select aria-label="测试思考强度" className={fieldClass} value={thinking} disabled={locked} onChange={e => { setThinking(e.target.value as ThinkingLevel | ""); setResult(null); }}><option value="">模型默认</option>{levels.map(level => <option key={level} value={level}>{level}</option>)}</select></Field>}
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" className="rounded-full" disabled={locked || !probeModel} onClick={() => void execute({ type: "probe", model: probeModel, ...(thinking ? { thinkingLevel: thinking } : {}) })}>{busy ? "正在处理…" : "发送连接测试"}</Button><Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => { setError(""); void loadModels().catch(cause => setError(errorText(cause))); }}>刷新可选模型</Button>{busy && <Button type="button" size="sm" variant="ghost" onClick={() => operation.current?.abort()}>取消当前请求</Button>}</div>
      {result && <Notice error={result.status === "rejected"}>{reasonText}</Notice>}
    </section>
    <div className="flex flex-wrap gap-2"><Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => void execute({ type: "logout" })}>登出账号</Button>{confirmRemove ? <div role="group" aria-label="确认删除产品账号" className="space-y-2"><p className="text-[12px]">删除此账号及其私有凭据？历史仍保留。</p><Button type="button" size="sm" variant="destructive" disabled={locked} onClick={() => void execute({ type: "remove" })}>确认删除账号</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>保留账号</Button></div> : <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => setConfirmRemove(true)}>删除账号…</Button>}</div>
  </div>;
}
