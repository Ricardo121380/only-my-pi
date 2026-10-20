import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import type { TerminalOutput, TerminalState } from "../../packages/host/contracts";
import { api, errorText, query } from "./api";
import { HostDialog } from "./HostDialog";

export default function TerminalPane({ projectId }: { projectId: string }) {
  const surface = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<TerminalState | null>(null), [error, setError] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [generation, setGeneration] = useState(0);
  const sendRef = useRef<(data: string) => void>(() => {});
  useEffect(() => {
    let disposed = false;
    setLoading(true); setState(null); setError("");
    void api<{ terminals: TerminalState[] }>("/api/terminals").then((result) => {
      if (!disposed) setState(result.terminals.find((entry) => entry.projectId === projectId && entry.status !== "closed") ?? null);
    }).catch((e) => { if (!disposed) setError(errorText(e)); }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [projectId, generation]);
  const id = state?.terminalId;
  useEffect(() => {
    if (!id || !surface.current) return;
    let disposed = false, offset = 0, sequence: number | null = null, failed = false, running = false, queuedBytes = 0;
    let input = Promise.resolve(), pollTimer: ReturnType<typeof setTimeout>, resizeTimer: ReturnType<typeof setTimeout>;
    const terminal = new Terminal({ fontFamily: '"SFMono-Regular", Menlo, monospace', fontSize: 12, scrollback: 3000,
      cursorBlink: true, screenReaderMode: true, disableStdin: true,
      theme: { background: "#f8faff", foreground: "#23334f", cursor: "#4669de", selectionBackground: "#c9d7ff" } });
    // Terminal output must never write the user's clipboard or open links.
    const clipboard = terminal.parser.registerOscHandler(52, () => true);
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(surface.current); fit.fit();
    const theme = () => {
      const css = getComputedStyle(surface.current!);
      terminal.options.theme = { background: css.getPropertyValue("--surface").trim() || "#f8faff", foreground: css.getPropertyValue("--text").trim() || "#23334f", cursor: css.getPropertyValue("--accent").trim() || "#4669de", selectionBackground: "#7897d966" };
    };
    theme();
    const themeObserver = new MutationObserver(theme); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const fail = (e: unknown) => { if (!disposed) { failed = true; terminal.options.disableStdin = true; setError(errorText(e)); } };
    const send = (data: string) => {
      if (disposed || failed || !running || sequence === null) return;
      const bytes = new TextEncoder().encode(data).length;
      if (bytes > 16384 || queuedBytes + bytes > 65536) { fail(new Error("TERMINAL_INPUT_LIMIT")); return; }
      queuedBytes += bytes;
      input = input.then(async () => {
        if (disposed || failed) return;
        sequence = sequence! + 1;
        const seq = sequence;
        await api("/api/command", { type: "writeTerminal", terminalId: id, seq, data });
      }).catch(fail).finally(() => { queuedBytes -= bytes; });
    };
    sendRef.current = send;
    const dataListener = terminal.onData(send);
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed) return;
        fit.fit();
        if (running && !failed) void api("/api/command", { type: "resizeTerminal", terminalId: id, cols: Math.min(300, terminal.cols), rows: Math.min(300, terminal.rows) }).catch(fail);
      }, 120);
    };
    const observer = new ResizeObserver(resize); observer.observe(surface.current);
    const controller = new AbortController();
    const poll = async () => {
      try {
        const output = await api<TerminalOutput>(query("terminal", { terminalId: id, offset }), undefined, controller.signal);
        if (disposed) return;
        running = output.status === "running";
        sequence ??= output.inputSeq;
        terminal.options.disableStdin = !running || failed;
        setState((previous) => previous?.status === output.status && previous.error === output.error ? previous : output);
        if (output.error) setError(errorText(new Error(output.error)));
        if (output.truncated) { terminal.reset(); terminal.writeln("[较早输出已截断，显示最近的终端输出]"); }
        if (output.output) await new Promise<void>((resolve) => terminal.write(output.output, resolve));
        offset = output.end;
        if (!disposed && !failed && (running || output.status === "closing" || output.status === "starting")) pollTimer = setTimeout(() => void poll(), 100);
      } catch (e) { if (!disposed) fail(e); }
    };
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(pollTimer); clearTimeout(resizeTimer); observer.disconnect(); themeObserver.disconnect(); dataListener.dispose(); clipboard.dispose(); terminal.dispose(); };
  }, [id, generation]);
  async function open() {
    if (busy) return; setBusy(true); setError("");
    try { setState(await api<TerminalState>("/api/command", { type: "openTerminal", projectId, cols: 90, rows: 24 })); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function close() {
    if (!state || busy) return; setBusy(true); setConfirm(false);
    try { const result = await api<TerminalState>("/api/command", { type: "closeTerminal", terminalId: state.terminalId }); setState(result); if (result.error) setError(errorText(new Error(result.error))); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const labels = { starting: "启动中", running: "运行中 · 项目已占用", closing: "正在结束", closed: "已结束 · 占用已释放", reconciliation: "清理待核对 · 占用保留" };
  return <div className="terminal-pane">
    <div className="terminal-toolbar"><span role="status">{loading ? "连接终端…" : state ? labels[state.status] : "本机终端"}</span><div>
      {(!state || state.status === "closed") && <button className="softbtn" disabled={busy || loading} onClick={() => void open()}>{busy ? "启动中…" : "启动终端"}</button>}
      {state?.status === "running" && <><button className="softbtn" disabled={busy || !!error} onClick={() => sendRef.current("\x03")}>中断命令</button><button className="softbtn" disabled={busy} onClick={() => setConfirm(true)}>结束终端</button></>}
      {state?.status === "reconciliation" && <button className="softbtn" disabled={busy} onClick={() => void close()}>核对清理结果</button>}
      {error && <button className="softbtn" disabled={busy} onClick={() => setGeneration((value) => value + 1)}>重新连接</button>}
    </div></div>
    {error && <p role="alert" className="terminal-error">{error}</p>}
    {!state && !loading && <p className="terminal-empty">在当前项目运行本机命令。终端占用期间暂停其他 OMP 写入；收起面板不会停止命令。使用本机用户权限，启动时不自动加载 shell 配置。</p>}
    <div ref={surface} className="terminal-surface" aria-label="本机交互终端" hidden={!state} />
    <HostDialog open={confirm} title="结束本机终端" onClose={() => setConfirm(false)}><p>将停止此终端及可跟踪的后台程序，确认清理后解除项目占用。只想保留开发服务器时，请收起面板。</p><div className="dialog-actions"><button className="softbtn" onClick={() => setConfirm(false)}>继续运行</button><button className="softbtn" onClick={() => void close()}>结束并清理</button></div></HostDialog>
  </div>;
}
