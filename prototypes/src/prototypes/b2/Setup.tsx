// First-run setup for B2: a model account, a runtime check, then the first
// project. Each step keeps B's margin notes for what the user should know.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle, ArrowLeft, Check, Copy, Eye, EyeOff, FolderGit2, FolderOpen, Globe, KeyRound, Laptop, Loader2, RotateCcw, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShinyText } from "@/components/magic";
import { projects, thinkingLevels } from "@/data/mock";
import { useProto } from "@/store";
import { cn } from "@/lib/utils";
import { projectFacts, useLayout, type SetupAccount } from "@/prototypes/b2/layout";
import { useAccounts } from "@/prototypes/b2/accounts";

type Method = "key" | "oauth" | "none";

const providers: { id: string; name: string; hint: string; methods: Method[]; url?: string; models: string[] }[] = [
  { id: "deepseek", name: "DeepSeek", hint: "API Key", methods: ["key"], models: ["deepseek-v4-pro", "deepseek-v4-flash"] },
  { id: "anthropic", name: "Anthropic", hint: "浏览器登录或 API Key", methods: ["oauth", "key"], models: ["claude-sonnet-5-5", "claude-opus-5-5"] },
  { id: "compatible", name: "OpenAI 兼容", hint: "Base URL 与 API Key", methods: ["key"], url: "", models: ["qwen3-coder-plus", "glm-5"] },
  { id: "local", name: "本机模型", hint: "LM Studio、Ollama，无需密钥", methods: ["none"], url: "http://127.0.0.1:1234/v1", models: ["qwen3-coder"] },
];

const steps = ["模型账号", "运行环境", "第一个项目"];

export default function Setup() {
  const [step, setStep] = useState(0);
  const [account, setAccount] = useState<SetupAccount | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const finishSetup = useLayout((s) => s.finishSetup);
  const setModel = useProto((s) => s.setModel);
  const setThinking = useProto((s) => s.setThinking);
  const page = useRef<HTMLDivElement>(null);
  useEffect(() => { page.current?.scrollTo({ top: 0 }); }, [step]);

  const finish = (skip = false) => {
    if (account && !skip) {
      const id = ({ DeepSeek: "ds-personal", Anthropic: "anthropic-work", 本机模型: "local" } as Record<string, string>)[account.provider];
      if (id) useAccounts.setState((st) => ({ accounts: st.accounts.map((a) => (a.id === id ? { ...a, status: "ok", problem: undefined, defaultModel: account.model } : a)), defaultId: id }));
      setModel(({ DeepSeek: "ds-personal", Anthropic: "anthropic-work", 本机模型: "local" } as Record<string, string>)[account.provider] ?? account.provider, account.model);
      setThinking(account.thinking);
    }
    finishSetup(skip ? null : account, projectId ?? "omp");
  };

  return (
    <div ref={page} className="flex h-full flex-col overflow-y-auto bg-canvas text-foreground scrollbar-thin">
      <header className="flex shrink-0 items-center gap-6 px-8 pt-6">
        <span className="font-read text-[19px] italic">Only My Pi</span>
        <ol className="mx-auto flex items-center gap-2" aria-label="配置步骤">
          {steps.map((label, i) => (
            <li key={label} className="flex items-center gap-2">
              {i > 0 && <span className={cn("h-px w-8", i <= step ? "bg-primary" : "bg-line")} />}
              <span className={cn("flex items-center gap-2 text-[13px]", i === step ? "text-foreground" : "text-muted-foreground")} aria-current={i === step ? "step" : undefined}>
                <span className={cn("grid size-6 place-items-center rounded-full text-[12px] tabular-nums", i < step ? "bg-coding text-[var(--coding-foreground)]" : i === step ? "bg-primary text-primary-foreground" : "bg-secondary")}>
                  {i < step ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span className="hidden sm:inline">{label}</span>
              </span>
            </li>
          ))}
        </ol>
        <button onClick={() => finish(true)} className="text-[13px] text-muted-foreground hover:text-foreground">稍后再说</button>
      </header>

      <main className="mx-auto w-full max-w-[980px] flex-1 px-8 py-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            {step === 0 && <AccountStep value={account} onChange={setAccount} />}
            {step === 1 && <DoctorStep />}
            {step === 2 && <ProjectStep value={projectId} onChange={setProjectId} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="sticky bottom-0 shrink-0 border-t border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[980px] items-center gap-3 px-8 py-4">
          {step > 0 && <Button variant="ghost" className="rounded-full" onClick={() => setStep(step - 1)}><ArrowLeft className="size-4" />上一步</Button>}
          <span className="ml-auto text-[12.5px] text-muted-foreground">
            {step === 0 && !account && "测试连接并选择默认模型后继续"}
            {step === 2 && !projectId && "选择一个本机目录后继续"}
          </span>
          {step < 2 ? (
            <Button className="rounded-full px-6" disabled={step === 0 && !account} onClick={() => setStep(step + 1)}>继续</Button>
          ) : (
            <Button className="rounded-full px-6" disabled={!projectId} onClick={() => finish()}>开始第一个会话</Button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Two columns: the step itself, and B's margin notes beside it. */
function StepLayout({ title, lead, children, notes }: { title: string; lead: string; children: ReactNode; notes: { title: string; body: string }[] }) {
  return (
    <div className="grid gap-x-10 gap-y-6 md:grid-cols-[minmax(0,1fr)_14rem]">
      <section>
        <h1 className="font-read text-[32px] leading-tight font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-[36rem] font-read text-[16.5px] leading-relaxed text-muted-foreground">{lead}</p>
        <div className="mt-8">{children}</div>
      </section>
      <aside className="space-y-5 self-start md:sticky md:top-6 md:pt-24" aria-label="说明">
        {notes.map((n) => (
          <p key={n.title} className="border-l-2 border-primary/40 pl-3 text-[12.5px] leading-relaxed text-muted-foreground">
            <span className="block font-medium text-foreground">{n.title}</span>{n.body}
          </p>
        ))}
      </aside>
    </div>
  );
}

/* ───────────── Step 1: model account ───────────── */

type Test = { state: "idle" | "testing" | "ok" | "error"; message?: string };

function AccountStep({ value, onChange }: { value: SetupAccount | null; onChange: (a: SetupAccount | null) => void }) {
  const [providerId, setProviderId] = useState("deepseek");
  const provider = providers.find((p) => p.id === providerId)!;
  const [method, setMethod] = useState<Method>(provider.methods[0]);
  const [label, setLabel] = useState("个人");
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [url, setUrl] = useState(provider.url ?? "");
  const [test, setTest] = useState<Test>({ state: value ? "ok" : "idle" });
  const [model, setModel] = useState(value?.model ?? "");
  const [thinking, setThinking] = useState(value?.thinking ?? "高");
  const [imported, setImported] = useState(false);

  const pick = (id: string) => {
    const next = providers.find((p) => p.id === id)!;
    setProviderId(id); setMethod(next.methods[0]); setUrl(next.url ?? ""); setTest({ state: "idle" }); setModel(""); setImported(false); onChange(null);
  };
  const ok = (m = provider.models[0]) => { setTest({ state: "ok" }); setModel(m); };

  // Keep the parent's account in sync once a connection is verified and a model chosen.
  useEffect(() => {
    if (test.state === "ok" && model) onChange({ provider: provider.name, label: imported ? "CLI 默认" : label || "未命名", model, thinking });
    else onChange(null);
  }, [test.state, model, thinking, label, imported, provider.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const runTest = () => {
    if (method === "key" && !key.trim()) return setTest({ state: "error", message: "先填写 API Key。" });
    if (provider.url !== undefined && !url.trim()) return setTest({ state: "error", message: "先填写服务地址。" });
    setTest({ state: "testing" });
    window.setTimeout(() => {
      if (method === "key" && key.trim().length < 12) {
        setTest({ state: "error", message: `${provider.name} 拒绝了这个密钥（401）。检查是否复制完整，或在服务商控制台重新生成后再试。` });
      } else ok();
    }, 1100);
  };
  const login = () => {
    setTest({ state: "testing", message: "已在浏览器打开 Anthropic 登录页，完成后回到这里" });
    window.setTimeout(() => ok(), 2200);
  };
  const importCli = () => { pick("deepseek"); setImported(true); window.setTimeout(() => ok("deepseek-v4-pro"), 0); };

  return (
    <StepLayout
      title="连接一个模型账号"
      lead="Only My Pi 用你自己的模型账号工作。选择服务商并完成认证，再选一个默认模型；之后每个会话开始时都可以改。"
      notes={[
        { title: "密钥保存在哪里", body: "只写入 Pi 的账号存储，Only My Pi 不复制密钥，也不会写进日志或会话历史。" },
        { title: "登录不等于授权", body: "账号只决定用哪个模型。修改项目仍需要你在每个进程里单独批准。" },
        { title: "多个账号", body: "同一服务商可以保存多个账号。会话会记住所选账号，额度用尽也不会自动换成别的账号。" },
      ]}
    >
      <div role="radiogroup" aria-label="服务商" className="grid gap-2.5 sm:grid-cols-2">
        {providers.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={providerId === p.id}
            onClick={() => pick(p.id)}
            className={cn(
              "flex items-start gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-shadow",
              providerId === p.id ? "border-primary shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_15%,transparent)]" : "border-line hover:border-primary/40",
            )}
          >
            <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border", providerId === p.id ? "border-primary" : "border-line")}>
              {providerId === p.id && <span className="size-2 rounded-full bg-primary" />}
            </span>
            <span>
              <span className="block text-[14.5px] font-medium">{p.name}</span>
              <span className="block text-[12.5px] text-muted-foreground">{p.hint}</span>
            </span>
          </button>
        ))}
      </div>

      <button onClick={importCli} className="mt-3 text-[13px] text-primary hover:underline">已经在终端里用过 Pi？使用 CLI 默认账号（只读引用，不复制凭据）</button>

      <div className="mt-6 space-y-4 rounded-2xl border border-line bg-card p-5">
        {imported ? (
          <p className="flex items-center gap-2 text-[14px]"><Laptop className="size-4 text-primary" />使用终端里的 Pi 默认账号。原配置保持由 Pi 管理，Only My Pi 只引用它。</p>
        ) : (
          <>
            {provider.methods.length > 1 && (
              <div className="flex gap-1 rounded-xl bg-secondary p-1" role="tablist" aria-label="认证方式">
                {provider.methods.map((m) => (
                  <button key={m} role="tab" aria-selected={method === m} onClick={() => { setMethod(m); setTest({ state: "idle" }); }} className={cn("flex-1 rounded-lg px-3 py-1.5 text-[13px]", method === m ? "bg-card shadow-sm" : "text-muted-foreground")}>
                    {m === "oauth" ? "在浏览器中登录" : "使用 API Key"}
                  </button>
                ))}
              </div>
            )}
            <Field label="账号名称" hint="用来区分同一服务商的多个账号">
              <input value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
            </Field>
            {provider.url !== undefined && (
              <Field label="服务地址" hint={provider.id === "local" ? "LM Studio 默认是 1234 端口，Ollama 是 11434" : "兼容 OpenAI Chat Completions 的地址"}>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1" className={cn(inputClass, "font-mono text-[13px]")} />
              </Field>
            )}
            {method === "key" && (
              <Field label="API Key" hint="只用于连接测试和之后的请求">
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={key}
                    onChange={(e) => { setKey(e.target.value); if (test.state !== "testing") setTest({ state: "idle" }); }}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="粘贴服务商控制台生成的密钥"
                    className={cn(inputClass, "pr-10 font-mono text-[13px]")}
                  />
                  <button onClick={() => setShow((v) => !v)} aria-label={show ? "隐藏密钥" : "显示密钥"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground">
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {method === "oauth" ? (
                <Button variant="outline" className="rounded-full" onClick={login} disabled={test.state === "testing"}><Globe className="size-4" />在浏览器中登录</Button>
              ) : (
                <Button variant="outline" className="rounded-full" onClick={runTest} disabled={test.state === "testing"}>
                  {test.state === "testing" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}测试连接
                </Button>
              )}
              {test.state === "testing" && <span className="text-[13px] text-muted-foreground"><ShinyText>{test.message ?? "正在连接…"}</ShinyText></span>}
              {test.state === "error" && <span role="alert" className="text-[13px] text-destructive">{test.message}</span>}
              {test.state === "ok" && <span className="flex items-center gap-1.5 text-[13px] text-coding"><Check className="size-4" />{method === "oauth" ? "已登录" : "连接成功"}，找到 {provider.models.length} 个可用模型</span>}
            </div>
          </>
        )}

        <AnimatePresence initial={false}>
          {test.state === "ok" && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="overflow-hidden">
              <div className="space-y-4 border-t border-line pt-4">
                <Field label="默认模型">
                  <div role="radiogroup" aria-label="默认模型" className="flex flex-wrap gap-2">
                    {provider.models.map((m) => (
                      <button key={m} role="radio" aria-checked={model === m} onClick={() => setModel(m)} className={cn("rounded-full border px-3 py-1.5 font-mono text-[12.5px]", model === m ? "border-primary bg-accent text-accent-foreground" : "border-line hover:border-primary/40")}>
                        {m}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="思考强度" hint="越高越慢，费用也越高">
                  <div className="flex gap-1 rounded-xl bg-secondary p-1" role="radiogroup" aria-label="思考强度">
                    {thinkingLevels.map((t) => (
                      <button key={t} role="radio" aria-checked={thinking === t} onClick={() => setThinking(t)} className={cn("flex-1 rounded-lg py-1.5 text-[13px]", thinking === t ? "bg-card shadow-sm" : "text-muted-foreground")}>{t}</button>
                    ))}
                  </div>
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StepLayout>
  );
}

const inputClass = "h-10 w-full rounded-xl border border-line bg-background px-3 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_14%,transparent)]";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2 text-[13px] font-medium">{label}{hint && <span className="font-normal text-muted-foreground">{hint}</span>}</span>
      {children}
    </label>
  );
}

/* ───────────── Step 2: runtime check ───────────── */

const checks = [
  { id: "node", label: "Node.js", detail: "24.19.0，符合 >=24.19.0 <25" },
  { id: "pi", label: "Pi", detail: "1.3.0，已验证的版本", info: "上游已发布 1.5.0，兼容验收尚未完成，暂时保留 1.3.0。" },
  { id: "git", label: "Git", detail: "2.47.1，用于记录基线和受管克隆" },
  { id: "sandbox", label: "命令沙箱", detail: "pi-permission-modes 2.2.0，macOS 沙箱可用" },
  { id: "perm", label: "权限模式", detail: "build。YOLO 模式会让编程授权失效" },
  { id: "rg", label: "ripgrep", detail: "未找到。搜索仍然可用，大项目会变慢", warn: true, fix: "brew install ripgrep" },
  { id: "host", label: "本机 Host", detail: "127.0.0.1:4317，只监听本机，已配对" },
];

function DoctorStep() {
  const [progress, setProgress] = useState(0);
  const [round, setRound] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setProgress(0);
    const id = window.setInterval(() => setProgress((p) => (p >= checks.length ? p : p + 1)), 420);
    return () => window.clearInterval(id);
  }, [round]);
  const done = progress >= checks.length;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ } };

  return (
    <StepLayout
      title="检查运行环境"
      lead="编程授权依赖本机的命令沙箱和权限设置。这里逐项确认；有问题会写明影响和修复方法。"
      notes={[
        { title: "为什么检查这些", body: "命令沙箱或 build 权限模式任一不满足时，Only My Pi 只提供只读检查，不会开放编程。" },
        { title: "版本差距", body: "运行版本只在完成兼容验收后升级。落后于上游时会明确显示，不会悄悄换成未验证的版本。" },
      ]}
    >
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
        {checks.map((c, i) => {
          const state = i < progress ? (c.warn ? "warn" : "ok") : i === progress ? "checking" : "pending";
          return (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <span className="mt-0.5">
                {state === "ok" && <Check className="size-4 text-coding" />}
                {state === "warn" && <AlertTriangle className="size-4 text-planning" />}
                {state === "checking" && <Loader2 className="size-4 animate-spin text-primary" />}
                {state === "pending" && <span className="block size-4 rounded-full border border-line" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">{c.label}</p>
                <p className={cn("text-[13px] text-muted-foreground", state === "pending" && "opacity-50")}>{state === "pending" || state === "checking" ? "等待检查" : c.detail}</p>
                {state !== "pending" && state !== "checking" && c.info && <p className="mt-1 text-[12.5px] text-planning">{c.info}</p>}
                {state === "warn" && c.fix && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="rounded-lg bg-secondary px-2.5 py-1 font-mono text-[12.5px]">{c.fix}</code>
                    <button onClick={() => copy(c.fix!)} className="flex items-center gap-1 text-[12.5px] text-primary hover:underline"><Copy className="size-3.5" />{copied ? "已复制" : "复制命令"}</button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center gap-3 text-[13px]">
        {done ? (
          <span className="flex items-center gap-1.5"><ShieldCheck className="size-4 text-coding" />6 项通过，1 项建议处理。不影响继续。</span>
        ) : (
          <span className="text-muted-foreground"><ShinyText>正在检查 {Math.min(progress + 1, checks.length)} / {checks.length}</ShinyText></span>
        )}
        {done && <button onClick={() => setRound((r) => r + 1)} className="ml-auto flex items-center gap-1 text-primary hover:underline"><RotateCcw className="size-3.5" />重新检查</button>}
      </div>
    </StepLayout>
  );
}

/* ───────────── Step 3: first project ───────────── */

type Inspection =
  | { state: "idle" }
  | { state: "inspecting" }
  | { state: "git"; projectId: string; branch: string; dirty: number; agents: boolean }
  | { state: "plain"; path: string };

function ProjectStep({ value, onChange }: { value: string | null; onChange: (id: string | null) => void }) {
  const [path, setPath] = useState(value ? projects.find((p) => p.id === value)?.path ?? "" : "");
  const [inspection, setInspection] = useState<Inspection>(value ? { state: "git", projectId: value, branch: "", dirty: 0, agents: true } : { state: "idle" });

  const inspect = (next: string) => {
    setPath(next);
    onChange(null);
    if (!next.trim()) return setInspection({ state: "idle" });
    setInspection({ state: "inspecting" });
    window.setTimeout(() => {
      const known = projects.find((p) => next.trim() === p.path || next.includes(p.name));
      if (known) {
        setInspection({ state: "git", projectId: known.id, branch: known.branch, dirty: known.id === "omp" ? projectFacts.dirty.length : known.dirty, agents: known.id === "omp" });
        onChange(known.id);
      } else {
        setInspection({ state: "plain", path: next });
      }
    }, 900);
  };
  const known = inspection.state === "git" ? projects.find((p) => p.id === inspection.projectId) : undefined;

  return (
    <StepLayout
      title="选择第一个项目"
      lead="选一个本机目录。Only My Pi 先读取它的 Git 状态和项目规则，不会修改任何文件。"
      notes={[
        { title: "从只读开始", body: "新会话总是先只读检查。要修改项目时，Pi 会给出范围和验证方式，由你批准。" },
        { title: "你的未提交改动", body: "开始编程前会记录当前基线。与这些文件重叠的工作不会交给子代理，只由主 Agent 在原处处理。" },
      ]}
    >
      <div className="flex gap-2">
        <div className="relative flex-1">
          <FolderOpen className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") inspect(path); }}
            onBlur={() => path && inspection.state === "idle" && inspect(path)}
            placeholder="本机目录的绝对路径，例如 ~/AgentProjects/my-app"
            aria-label="项目目录"
            className={cn(inputClass, "pl-9 font-mono text-[13px]")}
          />
        </div>
        <Button variant="outline" className="h-10 rounded-xl" onClick={() => inspect(projects[0].path)}>选择文件夹</Button>
      </div>

      <p className="mt-5 mb-2 text-[13px] text-muted-foreground">最近在终端里用过的目录</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {projects.map((p) => (
          <li key={p.id}>
            <button onClick={() => inspect(p.path)} className={cn("flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left", path === p.path ? "border-primary" : "border-line hover:border-primary/40")}>
              <FolderGit2 className="size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block truncate text-[14px]">{p.name}</span>
                <span className="block truncate font-mono text-[11.5px] text-muted-foreground">{p.path}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 min-h-[8rem]" aria-live="polite">
        {inspection.state === "inspecting" && <p className="text-[14px] text-muted-foreground"><ShinyText>正在读取 Git 状态和项目规则…</ShinyText></p>}
        {inspection.state === "plain" && (
          <div className="rounded-2xl border border-planning/40 bg-card p-5">
            <p className="flex items-center gap-2 text-[14.5px] font-medium"><AlertTriangle className="size-4 text-planning" />这个目录不是 Git 仓库</p>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              仍然可以只读检查，但无法记录基线，受管克隆写入会被禁用。可以先在终端运行 <code className="rounded bg-secondary px-1.5 font-mono text-[12.5px]">git init</code>，或换一个目录。
            </p>
          </div>
        )}
        {inspection.state === "git" && known && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border border-line bg-card p-5">
            <p className="flex items-center gap-2 text-[15px] font-medium"><Check className="size-4 text-coding" />{known.name}</p>
            <dl className="mt-3 grid grid-cols-[6rem_1fr] gap-y-2 text-[13.5px]">
              <dt className="text-muted-foreground">分支</dt><dd className="font-mono text-[12.5px]">{known.branch}</dd>
              <dt className="text-muted-foreground">未提交改动</dt>
              <dd>{(known.id === "omp" ? projectFacts.dirty.length : known.dirty) || "无"}{known.id === "omp" && <span className="ml-2 text-muted-foreground">{projectFacts.dirty.map((d) => d.path.split("/").pop()).join("，")}</span>}</dd>
              <dt className="text-muted-foreground">项目规则</dt><dd>{known.id === "omp" ? "找到 AGENTS.md，每个会话都会读取" : "没有 AGENTS.md"}</dd>
              <dt className="text-muted-foreground">验证命令</dt>
              <dd className="flex flex-wrap gap-1.5">
                {(known.id === "omp" ? projectFacts.checks : ["npm test"]).map((c) => <code key={c} className="rounded-lg bg-secondary px-2 py-0.5 font-mono text-[12px]">{c}</code>)}
              </dd>
            </dl>
          </motion.div>
        )}
      </div>
    </StepLayout>
  );
}
