import { useEffect, useRef, useState } from "react";
import type { AccountAction, AccountDirectory, GuiAccount, StaticProvider } from "../../packages/host/contracts";
import { accountApi, api, errorText } from "./api";
import { OAuthLogin } from "./OAuthLogin";

export function Accounts({ onChanged }: { onChanged?: () => void }) {
  const [directory, setDirectory] = useState<AccountDirectory | null>(null);
  const [selected, setSelected] = useState(""), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [provider, setProvider] = useState(""), [name, setName] = useState("");
  const [authType, setAuthType] = useState<"api_key" | "oauth">("api_key");
  const [providers, setProviders] = useState<{ providerId: string; name: string }[]>([]), [discovering, setDiscovering] = useState(false);
  const [rename, setRename] = useState(""), [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(""), [modelId, setModelId] = useState("");
  const [protocol, setProtocol] = useState<StaticProvider["api"]>("openai-completions");
  const classifier = ["typesafe-system-one", "openai-decisions", "cloudflare-workers-ai-system-one"].includes(protocol);
  const [contextWindow, setContextWindow] = useState(32768), [maxTokens, setMaxTokens] = useState(4096);
  const pending = useRef(false);
  const account = directory?.accounts.find((item) => item.accountId === selected);
  async function reload(signal?: AbortSignal) {
    setLoading(true); setError("");
    try { const value = await api<AccountDirectory>("/api/accounts", undefined, signal); if (!signal?.aborted) setDirectory(value); }
    catch (cause) { if (!signal?.aborted) setError(errorText(cause)); }
    finally { if (!signal?.aborted) setLoading(false); }
  }
  useEffect(() => { const controller = new AbortController(); void reload(controller.signal); return () => controller.abort(); }, []);
  function select(value: GuiAccount) {
    setSelected(value.accountId); setRename(value.name); setKey(""); setNotice(""); setError(""); setConfirm(false);
    setBaseUrl(""); setModelId("");
  }
  async function execute(action: AccountAction) {
    if (!account || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    // Never retain a submitted secret in component state, including failed requests.
    if (action.type === "apiKey") setKey("");
    try {
      const result = await accountApi<{ status?: string }>({ accountId: account.accountId, action });
      const messages: Record<string, string> = { stored: "凭据已保存。可在模型选择中刷新列表。", missing: "当前未存储凭据。", stored_sync_failed: "凭据已保存，但模型同步失败；请检查网络并刷新模型列表。", removed_sync_failed: "凭据已移除，但模型同步失败。", configured: "静态 Provider 已保存，请刷新模型列表。", removed: "账号与其私有凭据已删除，历史记录保留。" };
      setNotice(action.type === "logout" && ["removed", "missing"].includes(result.status ?? "") ? "已登出，账号保留，私有凭据已移除。"
        : action.type === "status" && result.status === "stored" ? "当前已存储凭据；实际可用性以模型请求结果为准。"
        : result.status ? messages[result.status] ?? "操作已完成。" : "名称已更新。");
      if (action.type === "remove") { setSelected(""); setConfirm(false); }
      await reload(); onChanged?.();
    } catch (cause) { setError(errorText(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function create(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await accountApi<{ account: GuiAccount }>({ providerId: provider.trim(), name: name.trim(), authType });
      await reload(); select(result.account); setProvider(""); setName(""); onChanged?.();
    } catch (cause) { setError(errorText(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <section className="account-settings" aria-label="账号管理" aria-busy={busy || loading}>
    <h3>账号与模型</h3><p className="metric-fine">GUI 账号独立存储。CLI 仅只读引用，不会复制或修改其默认凭据。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {loading ? <p role="status">正在读取账号…</p> : <>
      <p className="metric-fine">{directory?.cliReference.name}</p>
      {!directory?.accounts.length && <p>还没有 GUI 账号。添加后配置凭据，再选择账号和模型。</p>}
      <div className="account-list">{directory?.accounts.map((item) => <button type="button" className="softbtn" aria-pressed={selected === item.accountId} disabled={busy} key={item.accountId} onClick={() => select(item)}>{item.name} · {item.providerId}</button>)}</div>
    </>}
    <button type="button" className="linkbtn" disabled={busy || loading} onClick={() => void reload()}>刷新账号</button>
    <form onSubmit={create}><fieldset disabled={busy}><legend>添加账号</legend>
      <label className="field">认证方式<select value={authType} onChange={(e) => { setAuthType(e.target.value as "api_key" | "oauth"); setProvider(""); }}><option value="api_key">API Key</option><option value="oauth">OAuth</option></select></label>
      {authType === "api_key" ? <label className="field">Provider ID<input required pattern="[a-zA-Z0-9_-]{1,128}" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="例如 openai，或自定义 ID" /></label> : <>
        <button type="button" className="softbtn" disabled={discovering} onClick={async () => { setDiscovering(true); setError(""); try { setProviders((await api<{ providers: { providerId: string; name: string }[] }>("/api/oauth-providers")).providers); } catch (cause) { setError(errorText(cause)); } finally { setDiscovering(false); } }}>{discovering ? "正在读取支持列表…" : "读取支持的 OAuth Provider"}</button>
        <label className="field">OAuth Provider<select required value={provider} onChange={(e) => setProvider(e.target.value)}><option value="">请选择受支持的 Provider</option>{providers.map((p) => <option value={p.providerId} key={p.providerId}>{p.name}</option>)}</select></label>
      </>}
      <label className="field">账号名称<input required maxLength={128} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="softbtn" disabled={!provider.trim() || !name.trim()}>添加账号</button>
    </fieldset></form>
    {account && <div key={account.accountId}><fieldset disabled={busy}><legend>{account.name}</legend>
      <form onSubmit={(e) => { e.preventDefault(); void execute({ type: "rename", name: rename }); }}><label className="field">显示名称<input required maxLength={128} value={rename} onChange={(e) => setRename(e.target.value)} /></label><button className="softbtn">保存名称</button></form>
      {account.authType === "api_key" && <form onSubmit={(e) => { e.preventDefault(); void execute({ type: "apiKey", key }); }}><label className="field">API Key<input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} maxLength={16384} /></label><button className="softbtn primary" disabled={!key.trim()}>保存凭据</button></form>}
      {account.authType === "oauth" && <OAuthLogin accountId={account.accountId} onChanged={onChanged} />}
      <div className="account-actions"><button className="softbtn" onClick={() => void execute({ type: "status" })}>查询认证状态</button><button className="softbtn" onClick={() => void execute({ type: "logout" })}>登出账号</button></div>
      <details><summary>自定义静态 Provider</summary><p className="metric-fine">仅在需要覆盖端点时配置；保存会替换此账号的自定义模型列表。无自定义命令执行。</p>
        <form onSubmit={(e) => { e.preventDefault(); void execute({ type: "configure", config: { baseUrl, api: protocol, models: [{ id: modelId, name: modelId, contextWindow, ...(classifier ? { type: "classifier" } : { maxTokens }) }] } }); }}>
          <label className="field">Base URL<input required type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" /></label>
          <label className="field">API 协议<select value={protocol} onChange={(e) => setProtocol(e.target.value as StaticProvider["api"])}><option value="openai-completions">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option><option value="typesafe-system-one">分类 · TypeSafe System One</option><option value="openai-decisions">分类 · OpenAI Decisions</option><option value="cloudflare-workers-ai-system-one">分类 · Cloudflare System One</option></select></label>
          <label className="field">模型 ID<input required maxLength={256} value={modelId} onChange={(e) => setModelId(e.target.value)} /></label>
          <label className="field">上下文窗口<input type="number" required min={1} max={10000000} value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} /></label>
          {!classifier && <label className="field">最大输出 token<input type="number" required min={1} max={1000000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} /></label>}
          {classifier && <p>分类协议没有单次生成 token 硬上限；项目预算在“分类模型”中配置。每个任务首次分类时仍需单独授权。分类与聊天模型列表分别保存。</p>}
          <button className="softbtn">保存静态配置</button>
        </form>
      </details>
      {confirm ? <div role="group" aria-label="确认删除账号"><p>删除“{account.name}”及其私有凭据？历史记录会保留。此操作不可撤销。</p><button className="softbtn" onClick={() => void execute({ type: "remove" })}>确认删除账号</button><button className="softbtn" onClick={() => setConfirm(false)}>保留账号</button></div> : <button className="linkbtn" onClick={() => setConfirm(true)}>删除账号…</button>}
    </fieldset></div>}
  </section>;
}
