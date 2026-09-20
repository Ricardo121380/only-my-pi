import { useRef, useState } from "react";
import type { ModelChoice } from "../../packages/host/contracts";
export function Composer({ models, disabled, running, cancelling, onSend, onCancel, onModels }: { models: ModelChoice[]; disabled: boolean; running: boolean; cancelling: boolean; onSend: (model: string, prompt: string) => Promise<void>; onCancel: () => void; onModels: () => void }) {
  const [prompt, setPrompt] = useState(""), [chosen, setChosen] = useState(""), [sending, setSending] = useState(false);
  const busy = useRef(false), composing = useRef(false);
  const model = models.some((m) => m.id === chosen) ? chosen : models[0]?.id ?? "";
  async function submit() {
    if (busy.current || disabled || running || !prompt.trim() || !model || composing.current) return;
    busy.current = true; setSending(true);
    try { await onSend(model, prompt); setPrompt(""); } catch { /* Parent renders the actionable error; keep input. */ }
    finally { busy.current = false; setSending(false); }
  }
  return <form className="composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <label htmlFor="prompt">新的只读分析</label>
    <textarea id="prompt" value={prompt} maxLength={16000} placeholder="描述你想了解的代码、结构或风险…" onChange={(event) => setPrompt(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && !composing.current) { event.preventDefault(); void submit(); } }} />
    <div className="composer-actions"><div className="model-control"><label htmlFor="model">模型</label><select id="model" value={model} disabled={running || sending} onChange={(event) => setChosen(event.target.value)}>{!models.length && <option value="">暂无可用模型</option>}{models.map((choice) => <option key={choice.id} value={choice.id}>{choice.name} / {choice.provider}</option>)}</select><button type="button" className="quiet" onClick={onModels} aria-label="刷新模型列表">刷新</button></div>
      {running ? <button type="button" className="cancel" disabled={cancelling} onClick={onCancel}>{cancelling ? "正在取消…" : "取消任务"}</button> : <button className="primary" disabled={disabled || sending || !model || !prompt.trim()}>{sending ? "正在提交…" : "开始分析"}</button>}</div>
    <p className="composer-hint">每次发送都会新建会话，不修改项目文件。⌘ / Ctrl + Enter 发送</p>
  </form>;
}
