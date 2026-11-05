// B2 settings. Accounts get the most depth: every account is an explicit, named
// identity with a real state, and nothing ever switches accounts on its own.
import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, ArrowLeft, Bot, Check, ChevronDown, ChevronRight, Eye, EyeOff, Globe, Image as ImageIcon, KeyRound, Laptop, Loader2,
  Lock, MonitorSmartphone, Palette, Pencil, Plug, Plus, RotateCcw, Server, Shapes, Tags, Trash2, Wallet, Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShinyText } from "@/components/magic";
import { fmtK } from "@/components/shared";
import { cn } from "@/lib/utils";
import { authCopy, statusCopy, useAccounts, usable, type Binding, type ProductAccount } from "@/prototypes/b2/accounts";
import { useLayout, useTheme, type SettingsPage } from "@/prototypes/b2/layout";

const pages: { id: SettingsPage; label: string; icon: typeof Bot }[] = [
  { id: "accounts", label: "账号与模型", icon: Bot },
  { id: "tools", label: "工具与技能", icon: Wrench },
  { id: "mcp", label: "MCP 连接", icon: Plug },
  { id: "budget", label: "子代理预算", icon: Wallet },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "runtime", label: "运行环境", icon: Server },
];

export default function Settings() {
  const { settingsPage, openSettings, closeSettings, returnTo } = useLayout();
  const problems = useAccounts((s) => s.accounts.filter((a) => a.status === "invalid" || a.status === "expired").length);
  return (
    <section className="@container h-full overflow-hidden rounded-2xl bg-background shadow-[0_0_0_1px_var(--line)]" aria-label="设置">
      <div className="flex h-full flex-col @[720px]:flex-row">
      <aside className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-card/50 px-3 py-2 scrollbar-thin @[720px]:w-52 @[720px]:flex-col @[720px]:items-stretch @[720px]:gap-0 @[720px]:overflow-visible @[720px]:border-r @[720px]:border-b-0 @[720px]:py-4">
        <button onClick={closeSettings} aria-label={returnTo === "home" ? "返回新会话" : "返回会话"} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground @[720px]:mb-4">
          <ArrowLeft className="size-3.5" /><span className="hidden @[720px]:inline">{returnTo === "home" ? "返回新会话" : "返回会话"}</span>
        </button>
        <p className="hidden px-2 pb-2 font-read text-[19px] font-semibold @[720px]:block">设置</p>
        <nav className="flex gap-0.5 @[720px]:block @[720px]:space-y-0.5" aria-label="设置分类">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => openSettings(p.id)}
              aria-current={settingsPage === p.id ? "page" : undefined}
              className={cn("flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13.5px] whitespace-nowrap @[720px]:w-full", settingsPage === p.id ? "bg-secondary font-medium" : "text-foreground/80 hover:bg-secondary/60")}
            >
              <p.icon className="size-4 text-muted-foreground" />{p.label}
              {p.id === "accounts" && problems > 0 && <span className="ml-auto rounded-full bg-planning/15 px-1.5 text-[11px] text-planning">{problems}</span>}
            </button>
          ))}
        </nav>
        <p className="mt-auto hidden px-2 text-[11.5px] leading-relaxed text-muted-foreground @[720px]:block">这里的设置对 CLI 和桌面端共用。原 Pi 配置保留由 Pi 管理。</p>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto scrollbar-thin">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={settingsPage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="mx-auto max-w-[760px] px-5 py-7 @[720px]:px-10 @[720px]:py-9">
            {settingsPage === "accounts" && <AccountsPage />}
            {settingsPage === "tools" && <ToolsPage />}
            {settingsPage === "mcp" && <McpPage />}
            {settingsPage === "budget" && <BudgetPage />}
            {settingsPage === "appearance" && <AppearancePage />}
            {settingsPage === "runtime" && <RuntimePage />}
          </motion.div>
        </AnimatePresence>
      </div>
      </div>
    </section>
  );
}

function PageHeader({ title, lead, action }: { title: string; lead: string; action?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <h1 className="font-read text-[28px] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-1.5 max-w-[34rem] font-read text-[15.5px] leading-relaxed text-muted-foreground">{lead}</p>
      </div>
      {action}
    </header>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-[14px] font-semibold">{title}</h2>
      {note && <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">{note}</p>}
      {children}
    </section>
  );
}

/* ───────────── Accounts ───────────── */

function AccountsPage() {
  const { accounts, defaultId, setDefault } = useAccounts();
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const def = accounts.find((a) => a.id === defaultId);
  const problems = accounts.filter((a) => a.status === "invalid" || a.status === "expired");
  const groups = [
    ...(["DeepSeek", "Anthropic", "OpenAI 兼容", "本机模型"] as const).map((p) => ({ title: p, items: accounts.filter((a) => a.provider === p && a.auth !== "cli") })),
    { title: "来自终端", items: accounts.filter((a) => a.auth === "cli") },
  ].filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title="账号与模型"
        lead="调用模型时使用的身份。同一服务商可以有多个账号；会话会记住所选账号，账号失效时会停下来问你，不会自动换成别的。"
        action={<Button className="shrink-0 rounded-full" onClick={() => setAdding(true)}><Plus className="size-4" />添加账号</Button>}
      />

      {problems.length > 0 && (
        <div className="mb-6 rounded-2xl border border-planning/35 bg-planning/8 px-4 py-3">
          <p className="flex items-center gap-2 text-[13.5px] font-medium"><AlertTriangle className="size-4 text-planning" />{problems.length} 个账号需要处理</p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-[13px] text-muted-foreground">
            {problems.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpen(a.id)} className="text-left hover:text-foreground hover:underline">{a.provider}，{a.label}：{a.problem}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Block title="新会话默认使用" note="只作为新会话里的高亮选项，开始前仍需要你确认一次。">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left hover:border-primary/40">
              <Bot className="size-4 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{def ? `${def.provider}，${def.label}` : "未设置"}</span>
                <span className="block font-mono text-[12px] text-muted-foreground">{def?.defaultModel}</span>
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className={cn(theme, "w-[var(--radix-dropdown-menu-trigger-width)]")}>
            {accounts.map((a) => (
              <DropdownMenuItem key={a.id} disabled={!usable(a)} onSelect={() => setDefault(a.id)} className="justify-between">
                <span>{a.provider}，{a.label}<span className="ml-2 font-mono text-[11.5px] text-muted-foreground">{a.defaultModel}</span></span>
                {!usable(a) ? <span className="text-[11.5px] text-planning">{statusCopy[a.status]}</span> : a.id === defaultId && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </Block>

      {groups.map((g) => (
        <Block key={g.title} title={g.title} note={g.title === "来自终端" ? "终端里 Pi 自己的默认账号。Only My Pi 只引用它，凭据仍由 Pi 管理。" : undefined}>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {g.items.map((a) => <AccountRow key={a.id} account={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />)}
          </ul>
        </Block>
      ))}

      <SpecialModels />

      <p className="border-l-2 border-primary/40 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
        账号只决定用哪个模型，不授予修改项目的权限。删除账号不会删除会话历史；绑定它的会话之后只能查看，继续时需要另选账号。
      </p>

      <AddAccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

function StatusDot({ account }: { account: ProductAccount }) {
  if (account.status === "testing") return <Loader2 className="size-3.5 animate-spin text-primary" aria-label="正在检查" />;
  return <span className={cn("size-2 rounded-full", account.status === "ok" ? "bg-coding" : "bg-planning")} aria-label={statusCopy[account.status]} />;
}

function AccountRow({ account: a, open, onToggle }: { account: ProductAccount; open: boolean; onToggle: () => void }) {
  const { defaultId, setDefault, setDefaultModel, rename, test, relogin, remove } = useAccounts();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(a.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [keyDialog, setKeyDialog] = useState(false);
  const broken = a.status === "invalid" || a.status === "expired";
  const isCli = a.auth === "cli";

  const fix = a.status === "invalid" ? (
    <Button size="sm" variant="outline" className="h-7 rounded-full" onClick={(e) => { e.stopPropagation(); setKeyDialog(true); }}><KeyRound className="size-3.5" />更换密钥</Button>
  ) : a.status === "expired" ? (
    <Button size="sm" variant="outline" className="h-7 rounded-full" onClick={(e) => { e.stopPropagation(); relogin(a.id); }}><Globe className="size-3.5" />重新登录</Button>
  ) : null;

  return (
    <li>
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <StatusDot account={a} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[14px] font-medium">{a.label}</span>
              <span className="rounded-full bg-secondary px-1.5 text-[11px] text-muted-foreground">{authCopy[a.auth]}</span>
              {a.id === defaultId && <span className="rounded-full bg-accent px-1.5 text-[11px] text-accent-foreground">默认</span>}
              {a.running && <span className="rounded-full bg-primary/12 px-1.5 text-[11px] text-primary">使用中</span>}
            </span>
            <span className={cn("block truncate text-[12.5px]", broken ? "text-planning" : "text-muted-foreground")}>
              {a.status === "testing" ? <ShinyText>{a.problem ?? "正在测试连接…"}</ShinyText> : broken ? a.problem : <><span className="font-mono">{a.defaultModel}</span>，{a.lastUsed}使用</>}
            </span>
          </span>
        </button>
        {fix}
        <button onClick={onToggle} aria-label={open ? "收起" : "展开"} className="rounded p-1 text-muted-foreground hover:text-foreground">
          <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-4 border-t border-line bg-background/40 px-4 py-4 pl-9">
              <Detail label="默认模型">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`${a.label} 的默认模型`}>
                  {a.models.map((m) => (
                    <button key={m} role="radio" aria-checked={a.defaultModel === m} disabled={isCli} onClick={() => setDefaultModel(a.id, m)}
                      className={cn("rounded-full border px-2.5 py-1 font-mono text-[12px] disabled:opacity-70", a.defaultModel === m ? "border-primary bg-accent text-accent-foreground" : "border-line hover:border-primary/40")}>
                      {m}
                    </button>
                  ))}
                </div>
              </Detail>
              <Detail label="认证">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  {a.auth === "key" && "密钥保存在 Pi 的账号存储里。这里只显示它是否存在，不会再次展示。"}
                  {a.auth === "oauth" && "通过服务商网页登录，令牌由 Pi 保存并按需刷新。"}
                  {a.auth === "cli" && "由终端里的 Pi 管理。这里不能修改或删除它的凭据。"}
                  {a.auth === "none" && <>本机服务 <code className="rounded bg-secondary px-1.5 font-mono text-[12px]">{a.endpoint}</code>，不需要密钥。</>}
                </p>
              </Detail>
              <Detail label="本月用量">
                <p className="text-[13px]">{fmtK(a.monthTokens)} tok{a.monthCost === null ? "，本机模型不计费" : `，约 $${a.monthCost.toFixed(2)}`}</p>
              </Detail>
              <Detail label="绑定的会话">
                {a.sessions.length ? (
                  <ul className="flex flex-wrap gap-1.5">{a.sessions.map((s) => <li key={s} className="rounded-lg bg-secondary px-2 py-0.5 text-[12.5px]">{s}</li>)}</ul>
                ) : <p className="text-[13px] text-muted-foreground">还没有会话使用这个账号。</p>}
              </Detail>

              {renaming && (
                <div className="flex items-center gap-2">
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { rename(a.id, name); setRenaming(false); } if (e.key === "Escape") setRenaming(false); }}
                    aria-label="账号名称" className="h-8 w-56 rounded-lg border border-line bg-background px-2.5 text-[13.5px] outline-none focus:border-primary/60" />
                  <Button size="sm" className="h-8 rounded-full" onClick={() => { rename(a.id, name); setRenaming(false); }}>保存</Button>
                  <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => setRenaming(false)}>取消</Button>
                </div>
              )}

              {confirmDelete ? (
                <div className="rounded-xl border border-destructive/30 bg-destructive/6 px-3.5 py-3 text-[13px]">
                  {a.running ? (
                    <p className="flex items-start gap-2"><Lock className="mt-0.5 size-3.5 shrink-0 text-destructive" />有会话正在使用这个账号。先停止那个会话，才能{isCli ? "停止引用" : "删除"}。</p>
                  ) : (
                    <p className="leading-relaxed">
                      {isCli
                        ? "停止引用后，终端里的 Pi 配置不受影响，可以随时重新引用。"
                        : a.sessions.length
                          ? `${a.sessions.length} 个会话绑定了这个账号。删除后它们只能查看历史，继续时需要另选账号。保存的凭据会从 Pi 的账号存储中移除。`
                          : "保存的凭据会从 Pi 的账号存储中移除。"}
                    </p>
                  )}
                  <div className="mt-2.5 flex gap-2">
                    {!a.running && <Button size="sm" variant="destructive" className="h-7 rounded-full" onClick={() => remove(a.id)}>{isCli ? "停止引用" : `删除“${a.label}”`}</Button>}
                    <Button size="sm" variant="ghost" className="h-7 rounded-full" onClick={() => setConfirmDelete(false)}>{a.running ? "知道了" : "取消"}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={a.status === "testing"} onClick={() => test(a.id)}>
                    {a.status === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}测试连接
                  </Button>
                  {usable(a) && a.id !== defaultId && <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => setDefault(a.id)}>设为默认</Button>}
                  {!isCli && <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => { setName(a.label); setRenaming(true); }}><Pencil className="size-3.5" />重命名</Button>}
                  <Button size="sm" variant="ghost" className="ml-auto h-8 rounded-full text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="size-3.5" />{isCli ? "停止引用" : "删除"}
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <ReplaceKeyDialog account={a} open={keyDialog} onOpenChange={setKeyDialog} />
    </li>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[6rem_1fr] sm:gap-3">
      <p className="text-[12.5px] text-muted-foreground sm:pt-0.5">{label}</p>
      <div>{children}</div>
    </div>
  );
}

const inputClass = "h-10 w-full rounded-xl border border-line bg-background px-3 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_14%,transparent)]";

function KeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false}
        placeholder="粘贴服务商控制台生成的密钥" aria-label="API Key" className={cn(inputClass, "pr-10 font-mono text-[13px]")} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏密钥" : "显示密钥"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function ReplaceKeyDialog({ account, open, onOpenChange }: { account: ProductAccount; open: boolean; onOpenChange: (o: boolean) => void }) {
  const theme = useTheme();
  const replaceKey = useAccounts((s) => s.replaceKey);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const save = () => {
    if (!key.trim()) return setError("先填写新的 API Key。");
    if (key.trim().length < 12) return setError(`${account.provider} 拒绝了这个密钥（401）。检查是否复制完整。`);
    replaceKey(account.id); setKey(""); setError(""); onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setKey(""); setError(""); } }}>
      <DialogContent className={cn(theme, "rounded-2xl border-line bg-popover sm:max-w-[460px]")}>
        <DialogTitle className="font-read text-[20px]">更换“{account.label}”的密钥</DialogTitle>
        <DialogDescription>新密钥保存前会先测试连接。旧密钥会被替换，绑定的会话继续使用这个账号。</DialogDescription>
        <KeyInput value={key} onChange={(v) => { setKey(v); setError(""); }} />
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>取消</Button>
          <Button className="rounded-full" onClick={save}>测试并保存</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const providerOptions = [
  { id: "DeepSeek", hint: "API Key", auth: "key", models: ["deepseek-v4-pro", "deepseek-v4-flash"] },
  { id: "Anthropic", hint: "浏览器登录", auth: "oauth", models: ["claude-sonnet-5-5", "claude-opus-5-5"] },
  { id: "OpenAI 兼容", hint: "Base URL 与 API Key", auth: "key", models: ["qwen3-coder-plus", "glm-5"] },
  { id: "本机模型", hint: "无需密钥", auth: "none", models: ["qwen3-coder"] },
] as const;

function AddAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const theme = useTheme();
  const add = useAccounts((s) => s.add);
  const accounts = useAccounts((s) => s.accounts);
  const [provider, setProvider] = useState<(typeof providerOptions)[number]>(providerOptions[0]);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "oauth">("idle");
  const [error, setError] = useState("");
  const reset = () => { setLabel(""); setKey(""); setEndpoint(""); setState("idle"); setError(""); };
  const duplicate = accounts.some((a) => a.provider === provider.id && a.label === label.trim());

  const save = () => {
    if (!label.trim()) return setError("给这个账号起个名字，方便和同一服务商的其他账号区分。");
    if (duplicate) return setError(`${provider.id} 下已经有叫“${label.trim()}”的账号。`);
    if (provider.auth === "key" && !key.trim()) return setError("先填写 API Key。");
    if (provider.auth === "key" && key.trim().length < 12) return setError(`${provider.id} 拒绝了这个密钥（401）。检查是否复制完整。`);
    if ((provider.id === "OpenAI 兼容" || provider.id === "本机模型") && !endpoint.trim()) return setError("先填写服务地址。");
    setError("");
    setState(provider.auth === "oauth" ? "oauth" : "testing");
    window.setTimeout(() => {
      add({ provider: provider.id, label: label.trim(), auth: provider.auth, models: [...provider.models], defaultModel: provider.models[0], endpoint: endpoint || undefined });
      reset(); onOpenChange(false);
    }, provider.auth === "oauth" ? 1800 : 1000);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className={cn(theme, "rounded-2xl border-line bg-popover sm:max-w-[520px]")}>
        <DialogTitle className="font-read text-[20px]">添加账号</DialogTitle>
        <DialogDescription>保存前会先测试连接。凭据只写入 Pi 的账号存储。</DialogDescription>
        <div role="radiogroup" aria-label="服务商" className="grid grid-cols-2 gap-2">
          {providerOptions.map((p) => (
            <button key={p.id} role="radio" aria-checked={provider.id === p.id} onClick={() => { setProvider(p); setError(""); }}
              className={cn("rounded-xl border px-3 py-2 text-left", provider.id === p.id ? "border-primary bg-accent/50" : "border-line hover:border-primary/40")}>
              <span className="block text-[13.5px] font-medium">{p.id}</span>
              <span className="block text-[12px] text-muted-foreground">{p.hint}</span>
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">账号名称</span>
          <input value={label} onChange={(e) => { setLabel(e.target.value); setError(""); }} placeholder="例如：工作、个人、团队试用" className={inputClass} />
        </label>
        {(provider.id === "OpenAI 兼容" || provider.id === "本机模型") && (
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-medium">服务地址</span>
            <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={provider.id === "本机模型" ? "http://127.0.0.1:1234/v1" : "https://api.example.com/v1"} className={cn(inputClass, "font-mono text-[13px]")} />
          </label>
        )}
        {provider.auth === "key" && <KeyInput value={key} onChange={(v) => { setKey(v); setError(""); }} />}
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        {state !== "idle" && <p className="text-[13px] text-muted-foreground"><ShinyText>{state === "oauth" ? "已在浏览器打开登录页，完成后回到这里" : "正在测试连接…"}</ShinyText></p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>取消</Button>
          <Button className="rounded-full" onClick={save} disabled={state !== "idle"}>{provider.auth === "oauth" ? "在浏览器中登录" : "测试并保存"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SpecialModels() {
  const { classifier, image, setBinding } = useAccounts();
  return (
    <Block title="分类与生图" note="单独选择账号和模型，在每个任务开始时固定。更换聊天模型不会改变它们，也不会互相借用。">
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        <BindingRow icon={Tags} label="分类" detail="给文件、会话或材料打标签" binding={classifier} onChange={(b) => setBinding("classifier", b)} limit="每个任务最多 20 次，$0.05" />
        <BindingRow icon={ImageIcon} label="生图" detail="生成图片作为会话产物" binding={image} onChange={(b) => setBinding("image", b)} limit="每个任务最多 4 张，$0.20" />
      </ul>
    </Block>
  );
}

function BindingRow({ icon: Icon, label, detail, binding, onChange, limit }: { icon: typeof Tags; label: string; detail: string; binding: Binding; onChange: (b: Binding) => void; limit: string }) {
  const theme = useTheme();
  const accounts = useAccounts((s) => s.accounts);
  const bound = accounts.find((a) => a.id === binding.accountId);
  const broken = bound && !usable(bound);
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">{label}</span>
          <span className="block text-[12.5px] text-muted-foreground">{detail}，{limit}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px]", broken ? "border-planning/50 text-planning" : "border-line hover:border-primary/40")}>
              {bound ? <>{bound.label}<span className="font-mono text-muted-foreground">{binding.model}</span></> : "未设置"}<ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={cn(theme, "w-64")}>
            {accounts.map((a) => (
              <div key={a.id}>
                <DropdownMenuLabel className="flex justify-between text-xs font-normal text-muted-foreground">{a.provider}，{a.label}{!usable(a) && <span className="text-planning">{statusCopy[a.status]}</span>}</DropdownMenuLabel>
                {a.models.map((m) => (
                  <DropdownMenuItem key={m} disabled={!usable(a)} onSelect={() => onChange({ accountId: a.id, model: m })} className="justify-between font-mono text-[12.5px]">
                    {m}{a.id === binding.accountId && m === binding.model && <Check className="size-3.5" />}
                  </DropdownMenuItem>
                ))}
              </div>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange({ accountId: "", model: "" })}>不使用{label}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {broken && <p className="mt-2 pl-7 text-[12.5px] text-planning">绑定的账号{statusCopy[bound.status]}。{label}任务会停下来等你处理，不会改用其他账号。</p>}
    </li>
  );
}

/* ───────────── Tools and skills: product defaults with project overrides ───────────── */

type Resource = { id: string; label: string; detail: string; kind: "required" | "tool" | "skill" };
const resources: Resource[] = [
  { id: "permission", label: "权限策略", detail: "pi-permission-modes，命令沙箱与路径保护", kind: "required" },
  { id: "ownership", label: "会话与项目占用", detail: "同一会话同一时刻只有一个执行者", kind: "required" },
  { id: "budget", label: "模型调用预算", detail: "分类、生图与子代理的额度", kind: "required" },
  { id: "grep", label: "grep", detail: "Pi 原生搜索", kind: "tool" },
  { id: "find", label: "find", detail: "Pi 原生文件查找", kind: "tool" },
  { id: "ls", label: "ls", detail: "Pi 原生目录列表", kind: "tool" },
  { id: "context-doctor", label: "context-doctor", detail: "上下文与工具用量诊断，数字为估计值", kind: "tool" },
  { id: "skill:release-notes", label: "release-notes", detail: "导入的 Markdown 技能，用 /skill:release-notes 调用", kind: "skill" },
  { id: "skill:review-checklist", label: "review-checklist", detail: "导入的 Markdown 技能，审查前的检查清单", kind: "skill" },
];
const defaultsSeed: Record<string, boolean> = { grep: true, find: true, ls: true, "context-doctor": false, "skill:release-notes": false, "skill:review-checklist": false };

function ToolsPage() {
  const [scope, setScope] = useState<"product" | "project">("product");
  const [defaults, setDefaults] = useState(defaultsSeed);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({ "context-doctor": true });
  const [revision, setRevision] = useState(14);
  const value = (id: string) => (scope === "project" && id in overrides ? overrides[id] : defaults[id]);
  const toggle = (id: string, next: boolean) => {
    if (scope === "product") setDefaults((d) => ({ ...d, [id]: next }));
    else setOverrides((o) => ({ ...o, [id]: next }));
    setRevision((r) => r + 1);
  };
  const inherit = (id: string) => { setOverrides(({ [id]: _, ...rest }) => rest); setRevision((r) => r + 1); };

  return (
    <>
      <PageHeader title="工具与技能" lead="产品默认对所有项目生效，项目可以单独覆盖。改动在下一个任务加载，运行中的任务保持原来的配置。" />
      <div className="mb-6 flex items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-secondary p-1" role="tablist" aria-label="设置范围">
          {(["product", "project"] as const).map((s) => (
            <button key={s} role="tab" aria-selected={scope === s} onClick={() => setScope(s)} className={cn("rounded-lg px-3 py-1.5 text-[13px]", scope === s ? "bg-card shadow-sm" : "text-muted-foreground")}>
              {s === "product" ? "产品默认" : "项目 only-my-pi"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[12px] text-muted-foreground">配置版本 r{revision}，已保存</span>
      </div>
      {(["required", "tool", "skill"] as const).map((kind) => (
        <Block key={kind} title={{ required: "必需组件", tool: "工具", skill: "技能" }[kind]} note={kind === "skill" ? "从本地 Markdown 显式导入，默认停用。技能指令不授予写入权限。" : kind === "required" ? "保证授权、占用和预算规则成立，不能关闭。" : undefined}>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
            {resources.filter((r) => r.kind === kind).map((r) => {
              const overridden = scope === "project" && r.id in overrides;
              return (
                <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                  <Shapes className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={cn("text-[14px]", kind !== "required" && "font-mono text-[13px]")}>{r.label}</span>
                      {scope === "project" && kind !== "required" && (
                        <span className={cn("rounded-full px-1.5 text-[11px]", overridden ? "bg-planning/15 text-planning" : "bg-secondary text-muted-foreground")}>{overridden ? "已覆盖" : "继承默认"}</span>
                      )}
                    </span>
                    <span className="block text-[12.5px] text-muted-foreground">{r.detail}</span>
                  </span>
                  {overridden && <button onClick={() => inherit(r.id)} className="text-[12.5px] text-primary hover:underline">恢复继承</button>}
                  {kind === "required" ? (
                    <span className="flex items-center gap-1 text-[12px] text-muted-foreground"><Lock className="size-3.5" />必需</span>
                  ) : (
                    <Switch checked={value(r.id)} onCheckedChange={(v) => toggle(r.id, v)} aria-label={`${r.label}${value(r.id) ? "已启用" : "已停用"}`} />
                  )}
                </li>
              );
            })}
          </ul>
        </Block>
      ))}
    </>
  );
}

/* ───────────── MCP ───────────── */

interface McpServer { id: string; name: string; transport: string; status: "ok" | "invalid" | "off"; tools: string[]; enabled: string[]; saved: boolean }
const mcpSeed: McpServer[] = [
  { id: "github", name: "github", transport: "HTTP，浏览器登录", status: "ok", tools: ["search_code", "get_pull_request", "list_issues", "create_issue"], enabled: ["search_code", "get_pull_request"], saved: true },
  { id: "sentry", name: "sentry", transport: "HTTP，访问令牌", status: "invalid", tools: ["list_errors", "get_event"], enabled: ["list_errors"], saved: true },
  { id: "sqlite", name: "local-sqlite", transport: "stdio，本机进程", status: "off", tools: ["query", "schema"], enabled: [], saved: true },
];

function McpPage() {
  const [servers, setServers] = useState(mcpSeed);
  const [open, setOpen] = useState<string | null>("github");
  const toggleTool = (id: string, tool: string) =>
    setServers((list) => list.map((s) => (s.id === id ? { ...s, enabled: s.enabled.includes(tool) ? s.enabled.filter((t) => t !== tool) : [...s.enabled, tool] } : s)));
  return (
    <>
      <PageHeader title="MCP 连接" lead="外部工具服务。保存连接、启用工具、授权调用是三个独立的决定：启用只是让工具可见，每次真实调用仍会逐次问你。" action={<Button variant="outline" className="shrink-0 rounded-full"><Plus className="size-4" />导入配置</Button>} />
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {servers.map((s) => (
          <li key={s.id}>
            <button onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className={cn("size-2 rounded-full", s.status === "ok" ? "bg-coding" : s.status === "invalid" ? "bg-planning" : "bg-line")} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[13.5px]">{s.name}</span>
                <span className={cn("block text-[12.5px]", s.status === "invalid" ? "text-planning" : "text-muted-foreground")}>
                  {s.status === "invalid" ? "访问令牌失效，重新认证前不会加载它的工具" : `${s.transport}，已启用 ${s.enabled.length} / ${s.tools.length} 个工具`}
                </span>
              </span>
              {s.status === "invalid" && <span className="rounded-full border border-line px-2.5 py-0.5 text-[12.5px]">重新认证</span>}
              <ChevronRight className={cn("size-4 text-muted-foreground transition-transform", open === s.id && "rotate-90")} />
            </button>
            {open === s.id && (
              <ul className="space-y-1 border-t border-line bg-background/40 px-4 py-3 pl-9">
                {s.tools.map((t) => (
                  <li key={t} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 font-mono text-[12.5px]">{t}</span>
                    <Switch checked={s.enabled.includes(t)} disabled={s.status === "invalid"} onCheckedChange={() => toggleTool(s.id, t)} aria-label={`${t} 是否启用`} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ───────────── Budget ───────────── */

const budgetFields = [
  { id: "children", label: "子代理数量", unit: "个", value: 8, min: 1, max: 8 },
  { id: "concurrency", label: "同时运行", unit: "个", value: 2, min: 1, max: 2 },
  { id: "tokens", label: "Token 总量", unit: "tok", value: 50000, min: 5000, max: 500000, step: 5000 },
  { id: "cost", label: "费用上限", unit: "$", value: 0.25, min: 0.05, max: 5, step: 0.05 },
  { id: "tools", label: "工具调用", unit: "次", value: 64, min: 8, max: 256, step: 8 },
  { id: "wall", label: "运行时长", unit: "分钟", value: 30, min: 5, max: 120, step: 5 },
];

function BudgetPage() {
  const [values, setValues] = useState(() => Object.fromEntries(budgetFields.map((f) => [f.id, f.value])) as Record<string, number>);
  const changed = budgetFields.some((f) => values[f.id] !== f.value);
  return (
    <>
      <PageHeader title="子代理预算" lead="每个任务里子代理能用的额度。用尽时任务会停下来请你决定，不会自动扩额；结果未知的请求也计入额度。" />
      <div className="grid gap-3 sm:grid-cols-2">
        {budgetFields.map((f) => (
          <label key={f.id} className="rounded-2xl border border-line bg-card px-4 py-3">
            <span className="block text-[13px] text-muted-foreground">{f.label}</span>
            <span className="mt-1 flex items-center gap-2">
              <input type="number" value={values[f.id]} min={f.min} max={f.max} step={f.step ?? 1}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: Math.min(f.max, Math.max(f.min, Number(e.target.value) || f.min)) }))}
                className="w-28 bg-transparent text-[22px] font-semibold tabular-nums outline-none" />
              <span className="text-[13px] text-muted-foreground">{f.unit}</span>
              <span className="ml-auto text-[11.5px] text-muted-foreground">{f.min}–{f.max}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3 text-[12.5px] text-muted-foreground">
        <span>子代理不能再派生子代理；同时运行最多 2 个。</span>
        {changed && <button onClick={() => setValues(Object.fromEntries(budgetFields.map((f) => [f.id, f.value])))} className="ml-auto flex items-center gap-1 text-primary hover:underline"><RotateCcw className="size-3.5" />恢复默认</button>}
      </div>
    </>
  );
}

/* ───────────── Appearance ───────────── */

function AppearancePage() {
  const { night, setNight, readSize, setReadSize } = useLayout();
  const sizes = [{ v: 15, label: "小" }, { v: 16.5, label: "中" }, { v: 18, label: "大" }];
  return (
    <>
      <PageHeader title="外观" lead="只影响这台电脑上的显示。" />
      <Block title="主题">
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="主题">
          {[{ v: false, label: "日间", hint: "纸色与墨蓝" }, { v: true, label: "夜间", hint: "同样的阅读感，暗色背景" }].map((t) => (
            <button key={t.label} role="radio" aria-checked={night === t.v} onClick={() => setNight(t.v)}
              className={cn("overflow-hidden rounded-2xl border text-left", night === t.v ? "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_15%,transparent)]" : "border-line")}>
              <span className={cn("block h-20 px-4 pt-3", t.v ? "bg-[#1b1e21]" : "bg-[#f4f5f1]")}>
                <span className={cn("block h-2 w-2/3 rounded", t.v ? "bg-[#3a4046]" : "bg-[#d9ddd4]")} />
                <span className={cn("mt-2 block h-2 w-1/2 rounded", t.v ? "bg-[#9cb6e3]" : "bg-[#2c4a7c]")} />
              </span>
              <span className="block px-4 py-2.5"><span className="block text-[13.5px] font-medium">{t.label}</span><span className="block text-[12px] text-muted-foreground">{t.hint}</span></span>
            </button>
          ))}
        </div>
      </Block>
      <Block title="阅读字号" note="用于 Pi 的回复和计划文档。">
        <div className="flex gap-1 rounded-xl bg-secondary p-1" role="radiogroup" aria-label="阅读字号">
          {sizes.map((s) => (
            <button key={s.v} role="radio" aria-checked={readSize === s.v} onClick={() => setReadSize(s.v)} className={cn("flex-1 rounded-lg py-1.5 text-[13px]", readSize === s.v ? "bg-card shadow-sm" : "text-muted-foreground")}>{s.label}</button>
          ))}
        </div>
        <p className="mt-4 font-read leading-[1.75] text-foreground/90" style={{ fontSize: readSize }}>
          写入者已经在受管克隆中完成实现，类型检查与 9 个 Host 测试通过。
        </p>
      </Block>
    </>
  );
}

/* ───────────── Runtime ───────────── */

function RuntimePage() {
  const restartSetup = useLayout((s) => s.restartSetup);
  const [browsers, setBrowsers] = useState([
    { id: "b1", name: "这个浏览器", detail: "今天配对，现在使用中", current: true },
    { id: "b2", name: "Ego Lite", detail: "昨天配对", current: false },
  ]);
  const rows = [
    { k: "Only My Pi", v: "0.5.0-dev（开发源码）" },
    { k: "Pi", v: "1.3.0，上游已有 1.5.0，兼容验收未完成" },
    { k: "Node.js", v: "24.19.0" },
    { k: "权限扩展", v: "pi-permission-modes 2.2.0，macOS 沙箱可用" },
    { k: "本机 Host", v: "127.0.0.1:4317，只监听本机" },
  ];
  return (
    <>
      <PageHeader title="运行环境" lead="当前这套运行组合的身份。CLI 和桌面端只有在组合匹配时才能互相接续会话。" action={<Button variant="outline" className="shrink-0 rounded-full" onClick={restartSetup}><RotateCcw className="size-4" />重新检查</Button>} />
      <Block title="版本">
        <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {rows.map((r) => (
            <div key={r.k} className="grid grid-cols-[8rem_1fr] px-4 py-2.5 text-[13.5px]"><dt className="text-muted-foreground">{r.k}</dt><dd>{r.v}</dd></div>
          ))}
        </dl>
      </Block>
      <Block title="已配对的浏览器" note="撤销后需要重新配对才能访问本机 Host。会话历史不受影响。">
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
          {browsers.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-3">
              {b.current ? <Laptop className="size-4 text-primary" /> : <MonitorSmartphone className="size-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1"><span className="block text-[14px]">{b.name}</span><span className="block text-[12.5px] text-muted-foreground">{b.detail}</span></span>
              {b.current ? <span className="text-[12px] text-muted-foreground">当前</span> : (
                <Button size="sm" variant="ghost" className="h-7 rounded-full text-destructive hover:text-destructive" onClick={() => setBrowsers((l) => l.filter((x) => x.id !== b.id))}>撤销</Button>
              )}
            </li>
          ))}
        </ul>
      </Block>
    </>
  );
}
