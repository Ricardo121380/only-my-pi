import { useEffect, useRef, useState } from "react";
import type { AccountDirectory, ModelChoice, ThinkingLevel } from "../../packages/accounts/contracts";
import { Icon } from "./Icon";

export function MinimalComposer({ accounts, accountId, models, model, onAccount, onModel, onSend, onCancel, acknowledged, disabled, running, cancelling, controlled, projectName, suggestion, thinkingLevel, onThinking }: {
  projectName?: string; suggestion?: { id: string; text: string }; thinkingLevel?: ThinkingLevel | null; onThinking?: (value: ThinkingLevel | null) => void;
  acknowledged?: { prompt: string; requestId: string };
  accounts: AccountDirectory | null; accountId: string; models: ModelChoice[]; model: string;
  onAccount: (id: string) => void; onModel: (id: string) => void;
  onSend: (text: string, mode: "readonly" | "controlled") => Promise<void>; onCancel: () => void;
  disabled: boolean; running: boolean; cancelling: boolean; controlled: boolean;
}) {
  const [text, setText] = useState(""), [mode, setMode] = useState<"readonly" | "controlled">("readonly"), [sending, setSending] = useState(false);
  const busy = useRef(false), composing = useRef(false), revision = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null), appliedSuggestion = useRef("");
  const levels = models.find(item => item.id === model)?.thinkingLevels ?? [];
  function applySuggestion() {
    if (!suggestion || suggestion.id === appliedSuggestion.current || composing.current) return;
    appliedSuggestion.current = suggestion.id; revision.current++;
    setText(old => old.trim() ? `${old}\n\n${suggestion.text}` : suggestion.text); input.current?.focus();
  }
  useEffect(applySuggestion, [suggestion]);
  const submittedDraft = useRef<{ text: string; revision: number } | null>(null);
  useEffect(() => {
    const draft = submittedDraft.current;
    if (acknowledged && draft?.text === acknowledged.prompt) {
      if (draft.revision === revision.current) setText("");
      submittedDraft.current = null;
    }
  }, [acknowledged]);
  async function submit() {
    if (busy.current || composing.current || disabled || running || !text.trim() || !model || !accountId) return;
    busy.current = true; setSending(true); const submitted = revision.current; submittedDraft.current = { text, revision: submitted };
    try { await onSend(text, controlled ? mode : "readonly"); if (submitted === revision.current) setText(""); }
    catch { /* The workspace keeps the draft and renders the request outcome. */ }
    finally { busy.current = false; setSending(false); }
  }
  return <form className="minimal-composer" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <div className="composer-context"><Icon name="layers" /><span>上下文</span><span className="context-chip" title={projectName}><Icon name="folder" />{projectName || "尚未选择项目"}</span><span className="composer-ready">{running ? "正在执行" : disabled ? "等待选择" : "准备就绪"}</span></div>
    <label className="sr-only" htmlFor="minimal-prompt">消息</label>
    <textarea ref={input} id="minimal-prompt" placeholder="继续这个任务，或提出新的想法…" value={text} rows={2} maxLength={16000}
      onChange={e => { revision.current++; setText(e.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; applySuggestion(); }}
      onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing && !composing.current) { e.preventDefault(); void submit(); } }} />
    <div className="composer-toolbar">
      <label className="composer-mode"><Icon name="shield" /><span className="sr-only">执行模式</span><select title="执行模式" value={controlled ? mode : "readonly"} disabled={running || sending} onChange={e => setMode(e.target.value as typeof mode)}><option value="readonly">只读分析</option>{controlled && <option value="controlled">受控编程</option>}</select></label>
      <div className="model-fields">
        <label><span className="sr-only">账号</span><select title="账号" value={accountId} disabled={running || sending} onChange={e => onAccount(e.target.value)}><option value="">选择账号</option>{accounts && <option value={accounts.cliReference.accountId}>{accounts.cliReference.name}</option>}{accounts?.accounts.map(a => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></label>
        <label><span className="sr-only">模型</span><select title={models.find(item => item.id === model)?.name || "模型"} value={model} disabled={running || sending || !accountId} onChange={e => onModel(e.target.value)}><option value="">选择模型</option>{models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        {!!levels.length && onThinking && <label className="thinking-field"><span className="sr-only">推理强度</span><select title="推理强度" value={thinkingLevel ?? ""} disabled={running || sending} onChange={e => onThinking(e.target.value ? e.target.value as ThinkingLevel : null)}><option value="">模型默认</option>{levels.map(level => <option key={level} value={level}>{level}</option>)}</select></label>}
      </div>
      {running ? <button type="button" className="send-button stop-button" aria-label={cancelling ? "正在停止…" : "停止"} title="停止" disabled={cancelling} onClick={onCancel}><Icon name="stop" /></button> : <button className="send-button" aria-label={sending ? "正在提交…" : "发送"} title="发送 · ⌘ / Ctrl + Enter" disabled={disabled || sending || !accountId || !model || !text.trim()}><Icon name="arrow-up" /></button>}
    </div>
    <div className="composer-hint"><span>{mode === "controlled" && controlled ? "修改项目仍需明确审批" : "只读工具，不修改项目"}</span><span className="keyboard-hint">⌘ / Ctrl + Enter 发送</span></div>
  </form>;
}
