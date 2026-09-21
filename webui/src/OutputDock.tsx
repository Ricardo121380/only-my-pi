import type { Message } from "../../packages/host/contracts";
import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
export function OutputDock({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [height, setHeight] = useState(244);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const limit = (value: number) => Math.max(160, Math.min(Math.min(500, window.innerHeight * .55), value));
  useEffect(() => { const app = document.querySelector<HTMLElement>(".app"); app?.style.setProperty("--dock-height", `${height}px`); return () => { app?.style.removeProperty("--dock-height"); }; }, [height]);
  const [mobile, setMobile] = useState(() => window.matchMedia?.("(max-width: 760px)").matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update); return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => { if (mobile && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [mobile]);
  const outputs = messages.filter((message) => message.role === "toolResult");
  const content = <>{!mobile && <div className="dock-grip" role="separator" tabIndex={0} aria-label="调整底部 Terminal 高度" aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={Math.min(500, window.innerHeight * .55)} aria-valuenow={height} onPointerDown={(e) => { drag.current = { y:e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (drag.current) setHeight(limit(drag.current.height + drag.current.y - e.clientY)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={(e) => { const value = e.key === "ArrowUp" ? height + 24 : e.key === "ArrowDown" ? height - 24 : e.key === "Home" ? 160 : e.key === "End" ? 500 : null; if (value !== null) { e.preventDefault(); setHeight(limit(value)); } }} />}<header className="dock-header"><div className="dock-label"><Icon name="terminal" /><span>Terminal</span></div><div className="dock-tabs"><span className="dock-tab"><span className="dot" />Agent 输出</span><button className="dock-tab" disabled title="手动终端尚未接入">终端</button></div><div className="dock-tools"><button className="iconbtn" disabled aria-label="新建终端（尚未接入）"><Icon name="plus" /></button><button className="iconbtn" disabled aria-label="关闭终端标签（尚未接入）"><Icon name="trash" /></button><button className="iconbtn" aria-label="关闭底部输出" onClick={onClose}><Icon name="x" /></button></div></header>
    <div className="dock-output" tabIndex={0}>{outputs.length ? outputs.map((message) => <div key={message.id}><strong>{message.toolName || "工具输出"}{message.isError ? " · 失败" : ""}</strong><pre>{message.text}</pre>{message.outputAvailable && <p className="muted">更多内容请在对话中展开此工具结果。</p>}</div>) : <p className="muted">还没有工具输出。运行中的公开工具结果会显示在这里。</p>}</div>
    <p className="dock-log-note">手动终端尚未接入。收起面板不会停止任务；取消请使用输入区的取消按钮。</p></>;
  return mobile ? <dialog ref={dialog} className="host-dock-dialog" aria-label="Agent 输出" onCancel={(event) => { event.preventDefault(); onClose(); }}>{content}</dialog> : <section className="dock" aria-label="Agent 输出">{content}</section>;
}
