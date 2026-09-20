import { memo, useState } from "react";
import Markdown from "react-markdown";
import type { Message } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";

export const SafeMarkdown = memo(function SafeMarkdown({ text }: { text: string }) {
  return <Markdown skipHtml components={{ img: ({ alt }) => <span className="muted">[图片未自动加载：{alt || "图片"}]</span>, a: ({ href, children }) => href && /^https?:\/\//.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span> }}>{text}</Markdown>;
});
export const MessageView = memo(function MessageView({ message, sessionKey }: { message: Message; sessionKey?: string }) {
  const [expanded, setExpanded] = useState(false), [output, setOutput] = useState<string | null>(null), [offset, setOffset] = useState<number | null>(0), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function load() {
    if (!sessionKey || offset === null || busy) return;
    setBusy(true); setError("");
    try { const data = await api<{ text: string; nextOffset: number | null }>(query("tool-output", { sessionKey, entryId: message.id, offset })); setOutput((old) => (old ?? "") + data.text); setOffset(data.nextOffset); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  if (message.role === "toolResult") return <article className="tool-message">
    <button className="tool-toggle" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); if (!expanded && output === null) void load(); }}><span aria-hidden="true">{expanded ? "−" : "+"}</span> {message.toolName || "工具结果"}<span className="muted">{message.isError ? "执行失败" : "查看输出"}</span></button>
    {expanded && <div><pre>{output ?? message.text}</pre>{error && <p role="alert">{error}</p>}{sessionKey && offset !== null && <button onClick={load} disabled={busy}>{busy ? "正在读取…" : error ? "重试读取" : "继续读取输出"}</button>}{!sessionKey && <p className="muted">完整工具输出可在任务结束后的历史会话中查看。</p>}</div>}
  </article>;
  return <article className={`message ${message.role}`}><div className="speaker">{message.role === "user" ? "你" : "OMP"}</div><div className="prose"><SafeMarkdown text={message.text} />{message.truncated && <p className="muted">当前消息预览已截断。</p>}</div></article>;
});
