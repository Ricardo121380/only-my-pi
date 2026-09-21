import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
export function HostDialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !ref.current?.open) ref.current?.showModal(); else if (!open && ref.current?.open) ref.current.close(); }, [open]);
  return <dialog ref={ref} className="dialog" aria-label={title} onCancel={(e) => { e.preventDefault(); onClose(); }}><div className="dialog-head"><h2>{title}</h2><button className="iconbtn round" aria-label="关闭对话框" onClick={onClose}><Icon name="x" /></button></div><div className="dialog-body">{children}</div></dialog>;
}
