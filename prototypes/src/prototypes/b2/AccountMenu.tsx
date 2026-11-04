// Account and model picker for B2. It reads the product accounts, shows each
// account's real state, and never offers a broken account as a choice.
import type { ReactNode } from "react";
import { Check, Settings2, Wrench } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { thinkingLevels } from "@/data/mock";
import { useProto } from "@/store";
import { cn } from "@/lib/utils";
import { statusCopy, useAccounts, usable } from "@/prototypes/b2/accounts";
import { useLayout, useTheme } from "@/prototypes/b2/layout";

export function useCurrentAccount() {
  const accountId = useProto((s) => s.accountId);
  return useAccounts((s) => s.accounts.find((a) => a.id === accountId));
}

export function AccountMenu({ trigger, align = "end", onPicked }: { trigger: ReactNode; align?: "start" | "end"; onPicked?: () => void }) {
  const theme = useTheme();
  const accounts = useAccounts((s) => s.accounts);
  const { accountId, model, thinking, setModel, setThinking } = useProto();
  const openSettings = useLayout((s) => s.openSettings);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn(theme, "w-72")}>
        {accounts.map((a) => (
          <DropdownMenuGroup key={a.id}>
            <DropdownMenuLabel className="flex items-center justify-between text-xs font-normal text-muted-foreground">
              <span>{a.provider}，{a.label}</span>
              {!usable(a) && <span className="text-planning">{statusCopy[a.status]}</span>}
            </DropdownMenuLabel>
            {usable(a) ? a.models.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => { setModel(a.id, m); onPicked?.(); }} className="justify-between">
                <span className="font-mono text-[12.5px]">{m}</span>
                {a.id === accountId && m === model && <Check className="size-3.5" />}
              </DropdownMenuItem>
            )) : (
              <DropdownMenuItem onSelect={() => openSettings("accounts")} className="text-[12.5px] text-planning">
                <Wrench className="size-3.5" />{a.status === "expired" ? "去设置重新登录" : "去设置更换密钥"}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">思考强度</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={thinking} onValueChange={(v) => { setThinking(v); onPicked?.(); }}>
          {thinkingLevels.map((level) => <DropdownMenuRadioItem key={level} value={level}>{level}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings("accounts")}><Settings2 className="size-3.5" />管理账号</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
