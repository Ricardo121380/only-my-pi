import fs from "node:fs/promises";
import path from "node:path";
import { AccountCatalog } from "../host/accounts.mjs";
import { listModels } from "../host/models.mjs";
import { CLI_ACCOUNT_ID, hostError } from "../host/contracts.mjs";
import { ModelCallStore, MODEL_BUDGET, IMAGE_BUDGET } from "./store.mjs";
import { imageArtifactCommand } from "./artifact-commands.mjs";

export async function classifierCommand({ configRoot, stack, projectPath, args, kind = "classifier" }) {
  const prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
  const project = await fs.realpath(projectPath);
  if (!(await fs.stat(project)).isDirectory()) throw hostError(`${prefix}_PROJECT_INVALID`);
  const store = new ModelCallStore(configRoot);
  const models = accountId => listModels({ stack, configRoot, accountId, modelType: kind });
  if (args.length === 1 && args[0] === "status") return store.status(project);
  if (kind === "image" && ["history", "download", "export"].includes(args[0])) return imageArtifactCommand({ configRoot, projectPath: project, args });
  if (args[0] === "list" && args.length === 2) return { models: await models(args[1]) };
  if (args[0] === "apply" && args.length === 2 && path.isAbsolute(args[1])) {
    const stat = await fs.lstat(args[1]);
    if (!stat.isFile() || stat.size > 65536) throw hostError(`${prefix}_CONFIG_INVALID`);
    const input = JSON.parse(await fs.readFile(args[1], "utf8"));
    if (Object.keys(input).sort().join() !== [kind, "revision"].sort().join()) throw hostError("MODEL_CONFIG_INVALID");
    return store.save(project, input.revision, input[kind], models, kind);
  }
  throw hostError(`${prefix}_COMMAND_USAGE: ${kind} list ACCOUNT | status | apply /absolute/config.json --project /absolute/project`);
}
export async function runClassifierCli({ configRoot, stack, argv, kind = "classifier" }) {
  const index = argv.indexOf("--project"), projectPath = argv[index + 1];
  if (index < 0 || !path.isAbsolute(projectPath ?? "") || argv.indexOf("--project", index + 1) >= 0) throw hostError(kind === "image" ? "IMAGE_PROJECT_REQUIRED" : "CLASSIFIER_PROJECT_REQUIRED");
  return classifierCommand({ configRoot, stack, projectPath, kind, args: [...argv.slice(0, index), ...argv.slice(index + 2)] });
}
export function registerClassifierCommand(pi, { configRoot, sdkFile, kind = "classifier" }) {
  const root = path.resolve(sdkFile, "../../.."), stack = { root, nodePath: process.execPath };
  const label = kind === "image" ? "生图" : "分类";
  const prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
  pi.registerCommand(`omp-${kind}`, { description: `项目${label}账号、模型、预算与持久请求账本`, handler: async (args, ctx) => {
    if (!ctx.hasUI) throw hostError(`${prefix}_UI_REQUIRED`);
    try {
      if (args.trim()) {
        if (kind === "image" && args.trim() === "history") {
          const file = ctx.sessionManager.getSessionFile(); if (!file) throw hostError("IMAGE_SESSION_REQUIRED");
          await ctx.ui.editor("会话图片来源（只读，不重新生成）", JSON.stringify(await imageArtifactCommand({ configRoot, projectPath: await fs.realpath(ctx.cwd), args: ["history", file] }), null, 2)); return;
        }
        const match = /^(status|list [^\s]+|apply \/[^\0\r\n]+)$/u.exec(args.trim());
        if (!match) throw hostError(`${prefix}_COMMAND_USAGE`);
        const [command, ...rest] = args.trim().split(" ");
        const result = await classifierCommand({ configRoot, stack, kind, projectPath: ctx.cwd, args: command === "apply" ? [command, rest.join(" ")] : [command, ...rest] });
        await ctx.ui.editor(`${label}配置与请求账本（只读，关闭不会重发）`, JSON.stringify(result, null, 2)); return;
      }
      const store = new ModelCallStore(configRoot), config = await store.config(ctx.cwd);
      const action = await ctx.ui.select(`项目${label} · 保存仅影响后续任务；停用立即拒绝新请求`, ["选择账号和模型", "查看请求账本", `停用${label}`, "取消"]);
      if (action === "查看请求账本") { await ctx.ui.editor(`${label}请求账本（只读）`, JSON.stringify(await store.status(ctx.cwd), null, 2)); return; }
      if (action === `停用${label}`) { await store.save(ctx.cwd, config.revision, null, undefined, kind); ctx.ui.notify(`${label}已停用；未知请求保留占额。`, "info"); return; }
      if (action !== "选择账号和模型") return;
      const accounts = [{ accountId: CLI_ACCOUNT_ID, name: "CLI 只读引用" }, ...await new AccountCatalog(configRoot).list()];
      const accountLabel = await ctx.ui.select(`选择${label}账号`, accounts.map(a => `${a.name} · ${a.accountId}`));
      const account = accounts.find(a => `${a.name} · ${a.accountId}` === accountLabel); if (!account) return;
      const models = await listModels({ stack, configRoot, accountId: account.accountId, modelType: kind });
      const selected = await ctx.ui.select(`选择${label}模型（不继承聊天模型）`, models.filter(m => m.supported).map(m => m.id)); if (!selected) return;
      const value = await ctx.ui.editor("任务共享预算 · 次数/并发/输入输出字节/超时；生图另含图片数和存储；费用未知需每任务授权", JSON.stringify(config[kind]?.budget ?? (kind === "image" ? IMAGE_BUDGET : MODEL_BUDGET), null, 2)); if (!value) return;
      await store.save(ctx.cwd, config.revision, { accountId: account.accountId, model: selected, budget: JSON.parse(value) }, async () => models, kind);
      ctx.ui.notify(`项目${label}配置已保存；每个新任务仍需授权。`, "info");
    } catch (error) { ctx.ui.notify(error.code ?? `${prefix}_CONFIG_INVALID`, "error"); }
  } });
}
