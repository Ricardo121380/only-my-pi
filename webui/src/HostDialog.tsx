import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
export function HostDialog({ open, title, onClose, children, className = "" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null, dialog = ref.current;
    if (!dialog?.open) dialog?.showModal();
    return () => {
      dialog?.close();
      const available = (node: HTMLElement | null) => !!node?.isConnected && !node.closest("[inert]") && !node.matches(":disabled") && node.getClientRects().length > 0;
      // At a narrow breakpoint main may be inert behind an active sidebar or
      // inspector. Restore to that visible panel instead of an inert button.
      const target = available(previous) ? previous : [...document.querySelectorAll<HTMLElement>("main button, aside button")].find(available);
      target?.focus();
    };
  }, [open]);
  // A modal must not disappear when its sidebar/composer ancestor becomes hidden
  // at a responsive breakpoint. Native dialog still owns Escape and focus trapping.
  return createPortal(<dialog ref={ref} className={`dialog ${className}`} aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}><div className="dialog-head"><h2>{title}</h2><button className="iconbtn round" aria-label="关闭对话框" onClick={onClose}><Icon name="x" /></button></div><div className="dialog-body">{children}</div></dialog>, document.body);
}
