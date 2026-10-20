import { useEffect, useRef, useState } from "react";
import type { OAuthFlow } from "../../packages/host/contracts";
import { accountApi, api, errorText, query } from "./api";

const done = (status?: string) => ["stored", "stored_sync_failed", "failed", "cancelled", "timed_out"].includes(status ?? "");
const labels: Record<OAuthFlow["status"], string> = { starting: "正在启动认证", waiting: "等待 Provider 完成认证", awaiting_input: "请完成认证输入", cancelling: "正在取消", stored: "凭据已保存", stored_sync_failed: "凭据已保存，但模型同步失败", failed: "认证失败，请检查网络或重新登录", cancelled: "认证已取消", timed_out: "认证已超时，请重新登录" };
export function OAuthLogin({ accountId, onChanged }: { accountId: string; onChanged?: () => void }) {
  const [flow, setFlow] = useState<OAuthFlow | null>(null), [value, setValue] = useState(""), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useRef<OAuthFlow | null>(null), pending = useRef(false), mounted = useRef(true), changed = useRef(onChanged);
  changed.current = onChanged;
  function update(next: OAuthFlow) { current.current = next; if (mounted.current) setFlow(next); }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const running = current.current;
      if (running && !done(running.status)) void accountApi({ accountId, action: { type: "oauthCancel", flowId: running.flowId } }).catch(() => {});
    };
  }, [accountId]);
  useEffect(() => {
    if (!flow || done(flow.status)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<OAuthFlow>(query("oauth-flow", { flowId: flow!.flowId }), undefined, controller.signal);
        if (controller.signal.aborted) return;
        update(next);
        if (done(next.status)) { setValue(""); changed.current?.(); }
        else timer = setTimeout(poll, 500);
      } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [flow?.flowId]);
  async function action(type: "start" | "answer" | "cancel") {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const input = type === "start" ? { type: "oauthStart" as const } : type === "cancel" ? { type: "oauthCancel" as const, flowId: flow!.flowId } : { type: "oauthAnswer" as const, flowId: flow!.flowId, promptId: flow!.prompt!.promptId, value };
      setValue("");
      const next = await accountApi<OAuthFlow>({ accountId, action: input });
      update(next);
      if (!mounted.current && !done(next.status)) await accountApi({ accountId, action: { type: "oauthCancel", flowId: next.flowId } });
      if (done(next.status)) changed.current?.();
    } catch (cause) { if (mounted.current) setError(errorText(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="OAuth 登录"><p className="metric-fine">仅使用当前 Pi 支持的认证流程。关闭设置会请求取消；最多等待 5 分钟，不会后台切换账号。</p>
    {error && <p role="alert">{error}</p>}
    {flow && <p role="status">{labels[flow.status]}</p>}
    {!flow || done(flow.status) ? <button className="softbtn primary" disabled={busy} onClick={() => void action("start")}>开始 OAuth 登录</button> : <>
      {flow.event && <p><a href={flow.event.url} target="_blank" rel="noopener noreferrer">打开 Provider 授权页面</a>{flow.event.userCode && <span> · 设备验证码：<code>{flow.event.userCode}</code></span>}</p>}
      {flow.prompt && <form onSubmit={(event) => { event.preventDefault(); void action("answer"); }}>
        <label className="field">{flow.prompt.type === "select" ? "认证选项" : flow.prompt.type === "manual_code" ? "授权码或回调地址" : "认证输入"}
          {flow.prompt.type === "select" ? <select value={value} onChange={(e) => setValue(e.target.value)}><option value="">请选择</option>{flow.prompt.options?.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select> : <input type="password" autoComplete="off" spellCheck={false} value={value} maxLength={16384} onChange={(e) => setValue(e.target.value)} />}
        </label><button className="softbtn" disabled={busy || !value}>提交认证输入</button>
      </form>}
      <button className="softbtn" disabled={busy || flow.status === "cancelling"} onClick={() => void action("cancel")}>取消认证</button>
    </>}
  </section>;
}
