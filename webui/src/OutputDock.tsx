import type { Message } from "../../packages/host/contracts";
import { Icon } from "./Icon";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
const TerminalPane = lazy(() => import("./TerminalPane"));
export function OutputDock({ messages, onClose, projectId, terminalAvailable = false }: { messages: Message[]; onClose: () => void; projectId?: string; terminalAvailable?: boolean }) {
  const [tab, setTab] = useState<"output" | "terminal">("output");
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
  const content = <>{!mobile && <div className="dock-grip" role="separator" tabIndex={0} aria-label="调整底部输出高度" aria-orientation="horizontal" aria-valuemin={160} aria-valuemax={Math.min(500, window.innerHeight * .55)} aria-valuenow={height} onPointerDown={(e) => { drag.current = { y:e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (drag.current) setHeight(limit(drag.current.height + drag.current.y - e.clientY)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={(e) => { const value = e.key === "ArrowUp" ? height + 24 : e.key === "ArrowDown" ? height - 24 : e.key === "Home" ? 160 : e.key === "End" ? 500 : null; if (value !== null) { e.preventDefault(); setHeight(limit(value)); } }} />}<header className="dock-header"><div className="dock-label"><Icon name="terminal" /><span>输出与终端</span></div><div className="dock-tabs"><button className="dock-tab" aria-pressed={tab === "output"} onClick={() => setTab("output")}>Agent 输出</button><button className="dock-tab" aria-pressed={tab === "terminal"} disabled={!terminalAvailable || !projectId} title={!projectId ? "请先选择项目" : !terminalAvailable ? "当前 Host 尚未开放" : "本机交互终端"} onClick={() => setTab("terminal")}>终端</button></div><div className="dock-tools"><button className="iconbtn" aria-label="关闭底部输出" title="收起面板，命令继续运行" onClick={onClose}><Icon name="x" /></button></div></header>
    {tab === "terminal" && projectId ? <Suspense fallback={<p className="dock-log-note">加载终端…</p>}><TerminalPane key={projectId} projectId={projectId} /></Suspense> : <div className="dock-output" tabIndex={0}>{outputs.length ? outputs.map((message) => <div key={message.id}><strong>{message.toolName || "工具输出"}{message.isError ? " · 失败" : ""}</strong><pre>{message.text}</pre>{message.outputAvailable && <p className="muted">更多内容请在对话中展开此工具结果。</p>}</div>) : <p className="muted">还没有工具输出。运行中的公开工具结果会显示在这里。</p>}</div>}
    <p className="dock-log-note">收起面板不会停止命令。Agent 任务请在输入区取消；人工终端请使用“结束终端”。</p></>;
  return mobile ? <dialog ref={dialog} className="host-dock-dialog" aria-label="Agent 输出" onCancel={(event) => { event.preventDefault(); onClose(); }}>{content}</dialog> : <section className="dock" aria-label="Agent 输出">{content}</section>;
}
