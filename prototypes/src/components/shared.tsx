import { Fragment, type ReactNode } from "react";
import {
  Check, ChevronDown, CircleDashed, FilePen, FilePlus, FileText, FolderTree, Loader2, Search, SquareTerminal, X, ListTree,
} from "lucide-react";
import { accounts, thinkingLevels, type DiffFile, type RunStatus, type ToolName } from "@/data/mock";
import { useProto } from "@/store";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const toolIcon: Record<ToolName, typeof FileText> = {
  read: FileText,
  grep: Search,
  find: ListTree,
  ls: FolderTree,
  bash: SquareTerminal,
  edit: FilePen,
  write: FilePlus,
};

export function StatusGlyph({ status, className }: { status: RunStatus; className?: string }) {
  if (status === "running") return <Loader2 className={cn("size-3.5 animate-spin text-primary", className)} aria-label="运行中" />;
  if (status === "done") return <Check className={cn("size-3.5 text-coding", className)} aria-label="完成" />;
  if (status === "failed") return <X className={cn("size-3.5 text-destructive", className)} aria-label="失败" />;
  return <CircleDashed className={cn("size-3.5 text-muted-foreground", className)} aria-label="排队" />;
}

export const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
export const fmtSec = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
export const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/** Renders inline `code` spans and paragraph breaks from mock assistant text. */
export function Prose({ text, className, codeClassName }: { text: string; className?: string; codeClassName?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      {text.split("\n\n").map((para, i) => (
        <p key={i}>
          {para.split(/(`[^`]+`)/).map((part, j) =>
            part.startsWith("`") ? (
              <code key={j} className={cn("rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]", codeClassName)}>{part.slice(1, -1)}</code>
            ) : (
              <Fragment key={j}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export function DiffView({ file, className, wrap = false }: { file: DiffFile; className?: string; wrap?: boolean }) {
  return (
    <div className={cn("overflow-x-auto font-mono text-[12px] leading-[1.65] scrollbar-thin", className)}>
      <table className="w-full border-collapse">
        <tbody>
          {file.lines.map((line, i) =>
            line.type === "hunk" ? (
              <tr key={i} className="bg-accent/60 text-accent-foreground">
                <td colSpan={3} className="px-3 py-0.5">{line.text}</td>
              </tr>
            ) : (
              <tr
                key={i}
                className={cn(
                  line.type === "add" && "bg-coding/10",
                  line.type === "del" && "bg-destructive/10",
                )}
              >
                <td className="w-10 select-none px-2 text-right text-muted-foreground/70">{line.n}</td>
                <td className={cn("w-4 select-none", line.type === "add" ? "text-coding" : line.type === "del" ? "text-destructive" : "text-transparent")}>
                  {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
                </td>
                <td className={cn("pr-4", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>{line.text || " "}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Account → model → thinking picker. One explicit choice; nothing switches silently. */
export function ModelMenu({ trigger, align = "start", contentClassName }: { trigger: ReactNode; align?: "start" | "end"; contentClassName?: string }) {
  const { accountId, model, thinking, setModel, setThinking } = useProto();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn("w-64", contentClassName)}>
        {accounts.map((account) => (
          <DropdownMenuGroup key={account.id}>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {account.provider}，{account.label}
            </DropdownMenuLabel>
            {account.models.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => setModel(account.id, m)} className="justify-between">
                <span className="font-mono text-[12.5px]">{m}</span>
                {account.id === accountId && m === model && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">思考强度</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={thinking} onValueChange={setThinking}>
          {thinkingLevels.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>{level}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModelChip({ className }: { className?: string }) {
  const { model, thinking } = useProto();
  return (
    <ModelMenu
      trigger={
        <button className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground", className)}>
          <span className="font-mono">{model}</span>
          <span className="opacity-60">思考 {thinking}</span>
          <ChevronDown className="size-3" />
        </button>
      }
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}
