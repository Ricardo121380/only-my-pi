import { createContext, useContext, useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";

export const NativeTheme = createContext("proto-b");
export const fieldClass = "w-full rounded-xl border border-line bg-card px-3 py-2 text-[13px] outline-none focus:border-primary";

export function Tip({ label, kbd, children }: { label: string; kbd?: string; children: ReactNode }) {
  const theme = useContext(NativeTheme);
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className={theme}>
    {label}{kbd && <Kbd className="ml-2">{kbd}</Kbd>}
  </TooltipContent></Tooltip>;
}

export function NativeDialog({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode;
}) {
  const theme = useContext(NativeTheme), opener = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className={`${theme} max-h-[85vh] overflow-y-auto rounded-2xl`}
    onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }}
    onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
    <DialogTitle className="font-read text-[26px]">{title}</DialogTitle>
    <DialogDescription className="text-[13px] text-muted-foreground">{description}</DialogDescription>
    {children}
  </DialogContent></Dialog>;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-7 py-12 text-center">
    <p className="text-[14px] font-medium">{title}</p>
    <div className="font-read text-[14.5px] leading-relaxed text-muted-foreground">{children}</div>
  </div>;
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div role={error ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-[13px] ${error ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-line bg-muted/50 text-muted-foreground"}`}>{children}</div>;
}
