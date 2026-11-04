// Product accounts for B2 settings. Each account is an explicit, named identity
// for one provider; sessions bind to one and never rotate to another on failure.
import { create } from "zustand";

export type AuthKind = "key" | "oauth" | "cli" | "none";
export type AccountStatus = "ok" | "testing" | "invalid" | "expired";

export interface ProductAccount {
  id: string;
  provider: "DeepSeek" | "Anthropic" | "OpenAI 兼容" | "本机模型";
  label: string;
  auth: AuthKind;
  status: AccountStatus;
  problem?: string;
  models: string[];
  defaultModel: string;
  endpoint?: string;
  lastUsed: string;
  sessions: string[];
  running: boolean;
  monthTokens: number;
  monthCost: number | null;
}

export interface Binding { accountId: string; model: string }

const seed: ProductAccount[] = [
  {
    id: "ds-personal", provider: "DeepSeek", label: "个人", auth: "key", status: "ok",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"], defaultModel: "deepseek-v4-pro", lastUsed: "刚刚",
    sessions: ["会话列表支持归档", "梳理 minimal-services 的装配", "Pi 1.5.0 升级预检", "备份脚本加校验"], running: true,
    monthTokens: 1_240_000, monthCost: 3.8,
  },
  {
    id: "ds-team", provider: "DeepSeek", label: "团队试用", auth: "key", status: "invalid",
    problem: "服务商拒绝了保存的密钥（401），可能已被撤销或过期。", models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultModel: "deepseek-v4-flash", lastUsed: "10月21日", sessions: ["CI 失败排查"], running: false, monthTokens: 82_000, monthCost: 0.24,
  },
  {
    id: "anthropic-work", provider: "Anthropic", label: "工作", auth: "oauth", status: "expired",
    problem: "登录已过期，需要在浏览器里重新登录。", models: ["claude-sonnet-5-5", "claude-opus-5-5"], defaultModel: "claude-sonnet-5-5",
    lastUsed: "12 分钟前", sessions: ["排查 Host 重启后历史丢失", "定价页响应式修复"], running: false, monthTokens: 640_000, monthCost: 5.12,
  },
  {
    id: "local", provider: "本机模型", label: "LM Studio", auth: "none", status: "ok", endpoint: "http://127.0.0.1:1234/v1",
    models: ["qwen3-coder"], defaultModel: "qwen3-coder", lastUsed: "周一", sessions: ["导出笔记为静态站点"], running: false,
    monthTokens: 310_000, monthCost: null,
  },
  {
    id: "cli", provider: "DeepSeek", label: "CLI 默认", auth: "cli", status: "ok",
    models: ["deepseek-v4-flash"], defaultModel: "deepseek-v4-flash", lastUsed: "昨天", sessions: [], running: false,
    monthTokens: 0, monthCost: 0,
  },
];

interface AccountsState {
  accounts: ProductAccount[];
  defaultId: string;
  classifier: Binding;
  image: Binding;
  setDefault: (id: string) => void;
  setDefaultModel: (id: string, model: string) => void;
  rename: (id: string, label: string) => void;
  test: (id: string) => void;
  relogin: (id: string) => void;
  replaceKey: (id: string) => void;
  remove: (id: string) => void;
  add: (account: Omit<ProductAccount, "id" | "status" | "lastUsed" | "sessions" | "running" | "monthTokens" | "monthCost">) => void;
  setBinding: (kind: "classifier" | "image", binding: Binding) => void;
}

const patch = (list: ProductAccount[], id: string, fn: (a: ProductAccount) => ProductAccount) => list.map((a) => (a.id === id ? fn(a) : a));

export const useAccounts = create<AccountsState>((set, get) => ({
  accounts: seed,
  defaultId: "ds-personal",
  classifier: { accountId: "ds-personal", model: "deepseek-v4-flash" },
  image: { accountId: "anthropic-work", model: "claude-sonnet-5-5" },

  setDefault: (defaultId) => set({ defaultId }),
  setDefaultModel: (id, model) => set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, defaultModel: model })) })),
  rename: (id, label) => set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, label: label.trim() || a.label })) })),

  test: (id) => {
    const before = get().accounts.find((a) => a.id === id);
    if (!before) return;
    set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: "testing" })) }));
    window.setTimeout(() => set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: before.status === "testing" ? "ok" : before.status })) })), 1100);
  },
  relogin: (id) => {
    set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: "testing", problem: "已在浏览器打开登录页，完成后回到这里" })) }));
    window.setTimeout(() => set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: "ok", problem: undefined })) })), 2000);
  },
  replaceKey: (id) => {
    set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: "testing", problem: undefined })) }));
    window.setTimeout(() => set((s) => ({ accounts: patch(s.accounts, id, (a) => ({ ...a, status: "ok" })) })), 1100);
  },
  remove: (id) => set((s) => {
    const accounts = s.accounts.filter((a) => a.id !== id);
    return {
      accounts,
      defaultId: s.defaultId === id ? accounts.find((a) => a.status === "ok")?.id ?? "" : s.defaultId,
      classifier: s.classifier.accountId === id ? { accountId: "", model: "" } : s.classifier,
      image: s.image.accountId === id ? { accountId: "", model: "" } : s.image,
    };
  }),
  add: (account) => set((s) => ({
    accounts: [...s.accounts, { ...account, id: `acc-${Date.now()}`, status: "ok", lastUsed: "从未使用", sessions: [], running: false, monthTokens: 0, monthCost: account.provider === "本机模型" ? null : 0 }],
  })),
  setBinding: (kind, binding) => set({ [kind]: binding } as Pick<AccountsState, "classifier" | "image">),
}));

export const usable = (a: ProductAccount) => a.status === "ok";
export const authCopy: Record<AuthKind, string> = { key: "API Key", oauth: "浏览器登录", cli: "终端 Pi 管理", none: "无需密钥" };
export const statusCopy: Record<AccountStatus, string> = { ok: "可用", testing: "正在检查", invalid: "密钥被拒绝", expired: "登录已过期" };
