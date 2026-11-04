import { memo, useContext, useEffect, useRef, useState } from "react";
import { ArrowUp, AtSign, ChevronDown, FileCode2, Loader2, Lock, Slash, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MessageView, SafeMarkdown } from "../../../webui/src/Messages";
import { api, errorText } from "../../../webui/src/api";
import { isTaskActive, type NativeSession } from "../../../webui/src/useNativeSession";
import type { HostTask, Message } from "../../../packages/host/contracts";
import type { ThinkingLevel } from "../../../packages/accounts/contracts";
import { fieldClass, NativeTheme, Notice, Tip } from "./ui";

export const NativeMessage = memo(function NativeMessage({ message, sessionKey }: { message: Message; sessionKey?: string }) {
  if (message.role === "toolResult") return <div className="native-tool"><MessageView message={message} sessionKey={sessionKey} /></div>;
  if (message.role === "user") return <div className="ml-auto max-w-[88%] whitespace-pre-wrap rounded-2xl bg-secondary px-4 py-3 text-[14.5px] leading-relaxed">{message.text}{message.truncated && <p className="text-[12px] text-muted-foreground">当前预览已截断</p>}</div>;
  return <article className="native-prose font-read text-[length:var(--read-size,16.5px)] leading-[1.75] text-foreground/90">
    <SafeMarkdown text={message.text} />{message.truncated && <p className="text-[12px] text-muted-foreground">当前预览已截断</p>}
  </article>;
});

export function ModelFields({ session: c, disabled = false, onChoose }: { session: NativeSession; disabled?: boolean; onChoose: (confirmed: boolean) => void }) {
  const a = c.account, levels = a.models.find(m => m.id === a.selectedModel)?.thinkingLevels ?? [];
  return <div className="space-y-3">
    <label className="block space-y-1 text-[12px] text-muted-foreground"><span>账号</span><select aria-label="账号" className={fieldClass} value={a.accountId} disabled={disabled || !c.connected} onChange={e => { a.selectAccount(e.target.value); onChoose(false); }}>
      <option value="">选择账号</option>{a.accounts && <option value={a.accounts.cliReference.accountId}>{a.accounts.cliReference.name}</option>}{a.accounts?.accounts.map(account => <option key={account.accountId} value={account.accountId}>{account.name}</option>)}
    </select></label>
    <label className="block space-y-1 text-[12px] text-muted-foreground"><span>模型</span><select aria-label="模型" className={fieldClass} value={a.selectedModel} disabled={disabled || !c.connected || !a.accountId} onChange={e => { a.selectModel(e.target.value); onChoose(!!e.target.value); }}>
      <option value="">选择模型</option>{a.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select></label>
    {!!levels.length && <label className="block space-y-1 text-[12px] text-muted-foreground"><span>思考强度</span><select aria-label="推理强度" className={fieldClass} value={a.thinkingLevel ?? ""} disabled={disabled} onChange={e => a.setThinkingLevel(e.target.value ? e.target.value as ThinkingLevel : null)}>
      <option value="">模型默认</option>{levels.map(level => <option key={level} value={level}>{level}</option>)}
    </select></label>}
  </div>;
}

export function NativeComposer({ session: c, confirmed, onChoose }: { session: NativeSession; confirmed: boolean; onChoose: (confirmed: boolean) => void }) {
  const theme = useContext(NativeTheme), [text, setText] = useState(""), [mode, setMode] = useState<"readonly" | "controlled">("readonly");
  const [modelOpen, setModelOpen] = useState(false), [sending, setSending] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null), composing = useRef(false), busy = useRef(false), revision = useRef(0);
  const submitted = useRef<{ text: string; revision: number } | null>(null), seenSuggestion = useRef("");
  const running = isTaskActive(c.visibleTask?.status), controlled = c.snapshot?.capabilities?.controlled === true;
  const disabled = !c.connected || !!c.taskId || !c.project?.available || !!c.pending || !!c.selectedKey && !c.armed;
  const model = c.account.models.find(m => m.id === c.account.selectedModel);
  function applySuggestion() {
    if (!c.suggestion || composing.current || seenSuggestion.current === c.suggestion.id) return;
    seenSuggestion.current = c.suggestion.id; revision.current++;
    setText(current => current.trim() ? `${current}\n\n${c.suggestion!.text}` : c.suggestion!.text); area.current?.focus();
  }
  useEffect(applySuggestion, [c.suggestion]);
  useEffect(() => {
    if (c.acknowledged && submitted.current?.text === c.acknowledged.prompt) {
      if (submitted.current.revision === revision.current) setText("");
      submitted.current = null;
    }
  }, [c.acknowledged]);
  async function send() {
    if (busy.current || composing.current || disabled || running || !confirmed || !text.trim() || !model || !c.account.accountId) return;
    busy.current = true; setSending(true); const version = revision.current; submitted.current = { text, revision: version };
    try { await c.send(text, controlled ? mode : "readonly"); if (revision.current === version) setText(""); }
    catch { /* The controller preserves the request identity, draft and error. */ }
    finally { busy.current = false; setSending(false); }
  }
  return <form className="relative shrink-0 px-5 pt-3 pb-4" onSubmit={e => { e.preventDefault(); void send(); }}>
    {c.selectedKey && <div className="mx-auto mb-3 flex max-w-[660px] items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2 text-[12.5px]">
      <span>{c.armed ? "下一条消息将继续此会话，旧授权不继承。" : "正在查看历史，尚未继续执行。"}</span>
      <Button type="button" size="sm" variant="outline" className="shrink-0 rounded-full" disabled={c.armed || !c.connected || !c.historyReady || !!c.sessionRunning || !!c.pending || !c.project?.available} onClick={() => { c.setArmed(true); area.current?.focus(); }}>{c.armed ? "已选择继续" : "继续会话"}</Button>
    </div>}
    {!!c.visibleTask?.approvals?.length && <div className="mx-auto mb-3 max-w-[660px]"><ApprovalDock key={c.visibleTask.taskId} task={c.visibleTask} connected={c.connected} /></div>}
    {c.visibleTask?.access === "coding" && <div className="mx-auto mb-2 flex max-w-[660px] items-center justify-between text-[12px] text-coding"><span>本次进程已获编程授权</span><Revoke task={c.visibleTask} connected={c.connected} /></div>}
    <div className="mx-auto max-w-[660px] rounded-[22px] border border-line bg-card px-4 pt-3 pb-2.5 shadow-[0_10px_30px_-18px_rgba(30,34,29,0.35)] focus-within:border-primary/40">
      <div className="mb-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground"><FileCode2 className="size-3" />{c.project?.name ?? "尚未选择项目"}</div>
      <textarea ref={area} id="native-prompt" aria-label="回复 Pi" value={text} rows={2} maxLength={32768}
        placeholder={running ? "正在执行，你可以先准备下一条消息" : "回复 Pi，Enter 发送，Shift+Enter 换行"}
        className="block w-full resize-none bg-transparent font-read text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
        onChange={e => { revision.current++; setText(e.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; applySuggestion(); }}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composing.current) { e.preventDefault(); void send(); } }} />
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Tip label="文件引用将在后续接入"><span><Button type="button" size="icon" variant="ghost" className="size-8 rounded-full" disabled aria-label="引用文件暂不可用"><AtSign className="size-4" /></Button></span></Tip>
        <Popover><PopoverTrigger asChild><Button type="button" size="icon" variant="ghost" className="size-8 rounded-full" aria-label="命令"><Slash className="size-4" /></Button></PopoverTrigger><PopoverContent side="top" className={`${theme} space-y-1 p-2`}>
          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-secondary" onClick={() => c.suggest("请先只读分析并给出实施计划，暂不修改文件。")}>规划改动，填入草稿</button>
          <button type="button" className="w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-secondary" onClick={() => c.navigate(c.projectId)}>新建会话</button>
        </PopoverContent></Popover>
        <label className="text-[12px] text-muted-foreground"><span className="sr-only">执行模式</span><select aria-label="执行模式" className="max-w-32 rounded-full bg-transparent px-2 py-1" value={controlled ? mode : "readonly"} disabled={running || sending} onChange={e => setMode(e.target.value as typeof mode)}>
          <option value="readonly">检查与提问</option>{controlled && <option value="controlled">受控编程</option>}
        </select></label>
        <Popover open={modelOpen} onOpenChange={setModelOpen}><PopoverTrigger asChild><button type="button" aria-label="选择账号与模型" className="ml-auto flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-secondary">
          <span className="max-w-48 truncate">{model?.name ?? "选择账号与模型"}</span><ChevronDown className="size-3" />
        </button></PopoverTrigger><PopoverContent align="end" side="top" className={`${theme} space-y-3`}>
          <p className="text-[13px] font-medium">本次会话使用的账号与模型</p><ModelFields session={c} disabled={running || sending} onChoose={onChoose} />
          <Button type="button" size="sm" variant="outline" className="w-full rounded-full" onClick={() => setModelOpen(false)}>完成选择</Button>
        </PopoverContent></Popover>
        {running ? <Tip label="停止当前任务，等待执行进程退出"><Button type="button" size="icon" variant="outline" className="size-8 rounded-full" aria-label={c.visibleTask?.status === "cancelling" ? "正在停止" : "停止"} disabled={c.visibleTask?.status === "cancelling" || !c.connected} onClick={() => void c.stop()}><Square className="size-3 fill-current" /></Button></Tip>
          : <Button type="submit" size="icon" className="size-8 rounded-full" aria-label={sending ? "正在提交" : "发送"} disabled={disabled || sending || !confirmed || !c.account.accountId || !model || !text.trim()}>{sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}</Button>}
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span>{controlled && mode === "controlled" ? "只读起步，修改仍需明确审批" : "只读工具，不修改项目"}</span>
        {!confirmed && model && <span>上次用的是 {model.name} <button type="button" className="text-primary underline" onClick={() => onChoose(true)}>使用</button></span>}
      </div>
    </div>
  </form>;
}

export function ApprovalDock({ task, connected }: { task: HostTask; connected: boolean }) {
  const [busy, setBusy] = useState(false), pending = useRef(false), [notice, setNotice] = useState("");
  const [submitted, setSubmitted] = useState<string[]>([]), [now, setNow] = useState(Date.now);
  const ids = task.approvals?.map(a => a.approvalId).join(":");
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [ids]);
  async function answer(approvalId: string, value: string | boolean) {
    if (pending.current || !connected || !isTaskActive(task.status) || submitted.includes(approvalId)) return;
    pending.current = true; setBusy(true); setNotice("");
    try { await api("/api/command", { type: "answerApproval", taskId: task.taskId, approvalId, value }); setSubmitted(list => [...list, approvalId]); setNotice("决定已提交，等待运行时状态更新。"); }
    catch (cause) { setNotice(errorText(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="space-y-2" aria-label="受控执行">{task.approvals?.map(approval => <section key={approval.approvalId} aria-label="待决定的操作" className="rounded-2xl border border-planning/35 bg-card px-4 py-3 shadow-[0_10px_30px_-18px_rgba(122,83,6,0.45)]">
    <div className="flex items-start gap-3"><Lock className="mt-0.5 size-4 shrink-0 text-planning" /><div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">等待你的决定</p><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap font-sans text-[12.5px] text-muted-foreground">{approval.title}{approval.message ? `\n${approval.message}` : ""}</pre><p className="mt-1 text-[11.5px] text-muted-foreground">授权范围以上述说明为准。关闭页面或等待超时不会同意。</p></div></div>
    <div className="mt-3 flex flex-wrap gap-2 pl-7">{(approval.kind === "confirm" ? [{ label: "允许本次操作", value: true }, { label: "不允许", value: false }] : (approval.options ?? []).map(value => ({ label: value, value }))).map((choice, index) => <Button key={String(choice.value)} type="button" size="sm" variant={index ? "outline" : "default"} className="h-auto max-w-full whitespace-normal rounded-full" disabled={busy || !connected || task.status === "cancelling" || !isTaskActive(task.status) || submitted.includes(approval.approvalId) || now >= Date.parse(approval.expiresAt)} onClick={() => void answer(approval.approvalId, choice.value)}>{choice.label}</Button>)}</div>
  </section>)}{notice && <p role="status" className="px-1 text-[12px] text-muted-foreground">{notice}</p>}</div>;
}

function Revoke({ task, connected }: { task: HostTask; connected: boolean }) {
  const [busy, setBusy] = useState(false), pending = useRef(false), [notice, setNotice] = useState("");
  async function revoke() {
    if (pending.current || !connected) return;
    pending.current = true; setBusy(true);
    try { await api("/api/command", { type: "revokeTask", taskId: task.taskId }); }
    catch (cause) { setNotice(errorText(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div><button type="button" disabled={busy || !connected || task.status === "cancelling"} onClick={() => void revoke()} className="underline">{busy ? "正在收回授权" : "收回授权"}</button>{notice && <Notice error>{notice}</Notice>}</div>;
}
