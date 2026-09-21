import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
export function HostDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null, dialog = ref.current;
    if (!dialog?.open) dialog?.showModal();
    return () => {
      dialog?.close();
      const target = previous?.isConnected && previous.getClientRects().length ? previous : document.querySelector<HTMLElement>("main button");
      target?.focus();
    };
  }, [open]);
  // A modal must not disappear when its sidebar/composer ancestor becomes hidden
  // at a responsive breakpoint. Native dialog still owns Escape and focus trapping.
  return createPortal(<dialog ref={ref} className="dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}><div className="dialog-head"><h2>{title}</h2><button className="iconbtn round" aria-label="关闭对话框" onClick={onClose}><Icon name="x" /></button></div><div className="dialog-body">{children}</div></dialog>, document.body);
}
