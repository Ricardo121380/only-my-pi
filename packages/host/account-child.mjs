import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "./accounts.mjs";
import { CLI_ACCOUNT_ID } from "./contracts.mjs";
import { hasAccountCredential } from "./account-credential.mjs";
import { disableOmpCacheWarming } from "../direct-agent/cache-warming-policy.mjs";
import { applyOmpRequestPolicy } from "../direct-agent/request-policy.mjs";
import { openProductAccount } from "./account-runtime.mjs";

// Implements only the bounded JSON-print CLI contract emitted by pi-subagents.
// Unknown CLI modes fail closed instead of falling back to the ordinary Pi CLI.
export async function runAccountChild({ stack, configRoot, accountId, argv, cwd = process.cwd() }) {
  if (!path.isAbsolute(configRoot) || !accountId) throw new Error("CHILD_ACCOUNT_REQUIRED");
  const sdk = await import(pathToFileURL(path.join(stack.root, "pi/dist/index.js")).href);
  const args = sdk.parseArgs(argv);
  const supported = new Set(["mode", "print", "model", "thinking", "tools", "noTools", "noExtensions", "extensions", "noContextFiles", "noSkills", "systemPrompt", "appendSystemPrompt", "noSession", "session", "sessionDir", "messages", "fileArgs", "unknownFlags", "diagnostics"]);
  if (Object.keys(args).some((key) => !supported.has(key)) || args.diagnostics.some((d) => d.type === "error") || args.mode !== "json" || !args.print || !args.noExtensions || (!args.tools && !args.noTools) || !args.model) throw new Error("CHILD_ARGUMENTS_UNSUPPORTED");
  const files = [];
  for (const input of args.fileArgs) {
    const file = path.resolve(cwd, input), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > 1024 * 1024 || !/\.(md|txt)$/.test(file)) throw new Error("CHILD_TASK_FILE_INVALID");
    files.push(await fs.readFile(file, "utf8"));
  }
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === CLI_ACCOUNT_ID ? { accountId, providerId: args.model.split("/")[0] } : await catalog.get(accountId);
  if (!args.model.startsWith(`${account.providerId}/`)) throw new Error("CHILD_ACCOUNT_MODEL_MISMATCH");
  const paths = accountId === CLI_ACCOUNT_ID ? { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"), modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") } : await catalog.runtimePaths(accountId);
  const productAccount = accountId === CLI_ACCOUNT_ID ? undefined : await openProductAccount({ sdk, configRoot, accountId });
  const modelRuntime = productAccount?.runtime ?? await sdk.ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  if (!await hasAccountCredential(modelRuntime, accountId, account)) throw new Error("CHILD_ACCOUNT_UNAVAILABLE");
  sdk.initTheme(undefined, false);
  const sessionManager = args.noSession ? sdk.SessionManager.inMemory(cwd) : args.session ? sdk.SessionManager.open(args.session, args.sessionDir, cwd) : sdk.SessionManager.create(cwd, args.sessionDir);
  const runtime = await sdk.createAgentSessionRuntime(async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd, agentDir: configRoot, modelRuntime, settingsManager: applyOmpRequestPolicy(sdk.SettingsManager.create(cwd, configRoot, { projectTrusted: false })), extensionFlagValues: args.unknownFlags,
      resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: (args.extensions ?? []).map((p) => path.resolve(cwd, p)), noContextFiles: args.noContextFiles, noSkills: args.noSkills, systemPrompt: args.systemPrompt, appendSystemPrompt: args.appendSystemPrompt, extensionFactories: [disableOmpCacheWarming] },
    });
    if (services.diagnostics.some((d) => d.type === "error") || services.resourceLoader.getExtensions().errors.length) throw new Error("CHILD_EXTENSION_FAILED");
    // The subagent contract may append a thinking suffix; exact model IDs win.
    const available = modelRuntime.getAvailableSnapshot().filter((m) => m.provider === account.providerId);
    let model = available.find((m) => `${m.provider}/${m.id}` === args.model), thinkingLevel = args.thinking;
    if (!model) {
      const match = /:(off|minimal|low|medium|high|xhigh)$/.exec(args.model);
      if (match) { model = available.find((m) => `${m.provider}/${m.id}` === args.model.slice(0, -match[0].length)); thinkingLevel ??= match[1]; }
    }
    if (!model) throw new Error("CHILD_MODEL_UNAVAILABLE");
    const result = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, thinkingLevel, tools: args.tools, noTools: args.noTools });
    if (result.modelFallbackMessage || result.session.model?.provider !== model.provider || result.session.model?.id !== model.id) throw new Error("CHILD_MODEL_FALLBACK_DENIED");
    sessionManager.appendCustomEntry("omp-account-binding", { version: 1, accountId, providerId: account.providerId });
    return { ...result, services, diagnostics: services.diagnostics };
  }, { cwd, agentDir: configRoot, sessionManager });
  const result = await sdk.runPrintMode(runtime, { mode: "json", initialMessage: [...files, ...args.messages].join("\n\n") });
  await productAccount?.release();
  return result;
}
