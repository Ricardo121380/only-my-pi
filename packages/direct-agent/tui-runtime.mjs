import path from "node:path";
import fs from "node:fs/promises";
import { ownershipError } from "../host/ownership.mjs";
import { inspectSessionSelection, prepareHeadlessSession } from "./session-selection.mjs";
import { createAdmittedSessionRuntime } from "./session-runtime.mjs";
import { createResumeUiExtension } from "./session-resume-ui.mjs";
import { prepareTuiInput } from "./initial-input.mjs";
import { disableOmpCacheWarming } from "./cache-warming-policy.mjs";
import { McpCatalog, mcpToolNames } from "../mcp/catalog.mjs";
import { applyOmpRequestPolicy } from "./request-policy.mjs";
import { openProductAccount } from "../host/account-runtime.mjs";

// Controlled CLI bootstrap using only Pi's public SDK. All modes share the
// same tool, account, request and session-admission policy.
export function createDirectTuiRuntime(options) { return createDirectRuntime(options, "tui"); }
export function createDirectRpcRuntime(options) { return createDirectRuntime(options, "rpc"); }
export function createDirectPrintRuntime(options) { return createDirectRuntime(options, "print"); }

async function createDirectRuntime({ sdk, args, configRoot, admissions,
  cwd = process.cwd(), env = process.env, selectResume, confirmProjectTrust, confirmSessionCwd, modelRuntime, onFatal }, mode) {
  const parsed = sdk.parseArgs(args);
  if (parsed.diagnostics.some((item) => item.type === "error") || (parsed.provider && !parsed.model))
    throw ownershipError("OMP_AGENT_OPTION_INVALID");
  if ((mode === "tui" && parsed.print) || (mode === "rpc" ? parsed.mode !== "rpc" : !(mode === "print" ? [undefined, "text", "json"] : [undefined, "text"]).includes(parsed.mode)) || parsed.export || parsed.version
    || parsed.help || parsed.apiKey)
    throw ownershipError("TUI_STARTUP_OPTION_NOT_ADMITTED");
  if (mode === "rpc" && (parsed.fileArgs?.length || parsed.messages?.length || parsed.resume))
    throw ownershipError("RPC_STARTUP_OPTION_NOT_ADMITTED");
  if (!parsed.noExtensions || !parsed.extensions?.length || parsed.extensions.some((entry) => !path.isAbsolute(entry))
    || !parsed.tools?.length || parsed.unknownFlags.get("perm") !== (mode === "tui" ? "build" : "plan"))
    throw ownershipError("TUI_CONTROLLED_OPTIONS_REQUIRED");
  const name = parsed.name?.trim();
  if (parsed.name !== undefined && !name) throw ownershipError("OMP_AGENT_OPTION_INVALID");
  const selection = inspectSessionSelection(args);
  if (parsed.noSession && selection.fork) throw ownershipError("OMP_AGENT_OPTION_INVALID");
  const productAccount = env.OMP_PRODUCT_ACCOUNT_ID ? await openProductAccount({ sdk, configRoot, accountId: env.OMP_PRODUCT_ACCOUNT_ID }) : undefined;
  if (productAccount) modelRuntime = productAccount.runtime;
  const prepared = parsed.noSession
    ? { sessionManager: await admissions.createMemory(cwd, { id: selection.id }) }
    : await prepareHeadlessSession({ args, sdk, admissions, configRoot, cwd, env, selectResume });
  if (prepared.cancelled) return { cancelled: true };
  const sessionTrust = new Map();
  let runtime;
  const resolveProjectTrust = async (effectiveCwd, projectTrustContext, initial = false) => {
    // Direct RPC is read-only and never authorizes project resource execution.
    if (mode !== "tui") return false;
    const requiresTrust = sdk.hasTrustRequiringProjectResources(effectiveCwd);
    const decision = new sdk.ProjectTrustStore(configRoot).get(effectiveCwd);
    const globalSettings = sdk.SettingsManager.create(effectiveCwd, configRoot, { projectTrusted: false });
    const defaultTrust = globalSettings.getDefaultProjectTrust();
    let projectTrusted = !requiresTrust || (decision ?? defaultTrust === "always");
    if (requiresTrust && decision === null && defaultTrust === "ask") {
      if (!sessionTrust.has(effectiveCwd)) {
        // Never start a second terminal renderer during session replacement.
        const confirm = projectTrustContext?.hasUI
          ? () => projectTrustContext.ui.confirm("项目资源信任", `仅本次信任 ${effectiveCwd} 的项目设置与资源？这不是编程授权。`)
          : initial && confirmProjectTrust ? () => confirmProjectTrust(effectiveCwd) : undefined;
        if (!confirm) throw ownershipError("TUI_PROJECT_TRUST_CONFIRMATION_REQUIRED");
        sessionTrust.set(effectiveCwd, await confirm() === true);
      }
      projectTrusted = sessionTrust.get(effectiveCwd);
    }
    return projectTrusted;
  };
  const createRuntime = async ({ cwd: effectiveCwd, agentDir, sessionManager, sessionStartEvent, projectTrustContext }) => {
    const priorAccount = sessionManager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === "omp-account-binding")?.data?.accountId;
    if (!productAccount && typeof priorAccount === "string" && priorAccount !== "cli-readonly") throw ownershipError("ACCOUNT_SELECTION_REQUIRED");
    const projectTrusted = await resolveProjectTrust(effectiveCwd, projectTrustContext, !sessionStartEvent);
    const settingsManager = applyOmpRequestPolicy(sdk.SettingsManager.create(effectiveCwd, agentDir, { projectTrusted }));
    if (parsed.useTheme !== undefined) settingsManager.applyOverrides({ theme: parsed.useTheme });
    sdk.initTheme(settingsManager.getTheme(), false);
    const mcpSnapshot = await new McpCatalog(configRoot).snapshot(await fs.realpath(effectiveCwd));
    const mcpNames = mcpToolNames(mcpSnapshot);
    const services = await sdk.createAgentSessionServices({ cwd: effectiveCwd, agentDir, settingsManager,
      modelRuntime, modelRuntimeSignal: AbortSignal.timeout(15_000), extensionFlagValues: parsed.unknownFlags,
      resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: parsed.extensions,
        extensionFactories: [(pi) => pi.events.emit("only-my-pi:direct-session-owner:v1", {
          ownsSession: (ctx) => !admissions.closing && ctx.mode === (mode === "print" ? parsed.mode === "json" ? "json" : "print" : mode) && ctx.sessionManager === sessionManager,
        }), (pi) => pi.events.emit("only-my-pi:mcp-task:v1", { snapshot: mcpSnapshot }),
        ...(mode === "print" ? [(pi) => {
          pi.on("session_before_switch", () => ({ cancel: true }));
          pi.on("session_before_fork", () => ({ cancel: true }));
        }] : []),
        ...(mode === "tui" ? [createResumeUiExtension({ sdk, getRuntime: () => runtime })] : []), disableOmpCacheWarming] } });
    if (services.diagnostics.some((entry) => entry.type === "error") || services.resourceLoader.getExtensions().errors.length)
      throw ownershipError("TUI_EXTENSION_LOAD_FAILED");
    const diagnostics = [...parsed.diagnostics, ...services.diagnostics];
    const patterns = parsed.models ?? settingsManager.getEnabledModels();
    const scope = patterns?.length ? await sdk.resolveModelScopeWithDiagnostics(patterns, services.modelRuntime,
      { signal: AbortSignal.timeout(15_000) }) : { scopedModels: [], diagnostics: [] };
    diagnostics.push(...scope.diagnostics);
    let model, thinkingLevel;
    if (parsed.model) {
      let declaredModel;
      if (productAccount) {
        const provider = productAccount.account.providerId;
        if (parsed.provider && parsed.provider !== provider) throw ownershipError("ACCOUNT_MODEL_MISMATCH");
        const id = parsed.model.startsWith(`${provider}/`) ? parsed.model.slice(provider.length + 1) : parsed.model;
        declaredModel = services.modelRuntime.getModels(provider).find(item => item.id === id);
        // Pi's general CLI supports fuzzy names and fabricated custom IDs.
        // A product account must select an exact model from its own catalog.
        if (!declaredModel) throw ownershipError("ACCOUNT_MODEL_NOT_FOUND");
      }
      const resolved = sdk.resolveCliModel({ cliProvider: parsed.provider, cliModel: parsed.model,
        cliThinking: parsed.thinking, modelRuntime: services.modelRuntime });
      if (resolved.error || !resolved.model) throw ownershipError("TUI_MODEL_NOT_FOUND");
      model = resolved.model; thinkingLevel = resolved.thinkingLevel;
      if (productAccount && (model.provider !== declaredModel.provider || model.id !== declaredModel.id)) throw ownershipError("ACCOUNT_MODEL_MISMATCH");
      if (resolved.warning) diagnostics.push({ type: "warning", message: resolved.warning });
    } else if (scope.scopedModels.length && !sessionManager.buildSessionContext().messages.length) {
      const selected = scope.scopedModels.find(({ model }) => model.provider === settingsManager.getDefaultProvider()
        && model.id === settingsManager.getDefaultModel()) ?? scope.scopedModels[0];
      model = selected.model; thinkingLevel = selected.thinkingLevel;
    }
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model,
      thinkingLevel: parsed.thinking ?? thinkingLevel, scopedModels: scope.scopedModels.length ? scope.scopedModels : undefined,
      tools: [...parsed.tools, ...(mode === "tui" ? ["mcp__*"] : mcpNames)], excludeTools: parsed.excludeTools });
    if (productAccount) {
      if (!model || created.modelFallbackMessage || created.session.model?.provider !== model.provider || created.session.model?.id !== model.id)
        throw ownershipError("ACCOUNT_MODEL_FALLBACK_DENIED");
      sessionManager.appendCustomEntry("omp-account-binding", { version: 1, accountId: productAccount.account.accountId, providerId: productAccount.account.providerId });
    }
    if (!sessionStartEvent && name) sessionManager.appendSessionInfo(name);
    return { ...created, services, diagnostics };
  };
  const initialize = (cwdOverride) => createAdmittedSessionRuntime({ sdk, admissions, createRuntime, cwdOverride, onFatal,
    prepareResume: ({ cwd, projectTrustContext }) => resolveProjectTrust(cwd, projectTrustContext),
    ...(prepared.sessionManager ? { sessionManager: prepared.sessionManager }
      : { sessionFile: prepared.target.file, sessionDir: prepared.target.sessionDir }) });
  try { runtime = await initialize(); }
  catch (error) {
    // Only this read-only preflight failure is recoverable. No migration or
    // extension initialization has happened, and target ownership is retained.
    if (error.code !== "SESSION_CWD_INVALID" || prepared.sessionManager || !confirmSessionCwd) throw error;
    if (await confirmSessionCwd({ file: prepared.target.file, cwd }) !== true) return { cancelled: true };
    runtime = await initialize(cwd);
  }
  if (productAccount) {
    const dispose = runtime.dispose.bind(runtime);
    runtime.dispose = async () => { await dispose(); await productAccount.release(); };
  }
  if (mode === "rpc") return { cancelled: false, runtime };
  let stdinContent = "";
  if (mode === "print" && !process.stdin.isTTY) {
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) stdinContent += chunk;
    stdinContent = stdinContent.trim();
  }
  const input = await prepareTuiInput({ sdk, files: parsed.fileArgs, messages: parsed.messages, cwd,
    autoResizeImages: mode === "tui" && runtime.services.settingsManager.getImageAutoResize() });
  if (mode === "print") return { cancelled: false, runtime, options: { mode: parsed.mode === "json" ? "json" : "text",
    initialMessage: stdinContent || input.initialMessage !== undefined ? stdinContent + (input.initialMessage ?? "") : undefined,
    initialImages: input.initialImages, messages: input.initialMessages } };
  return { cancelled: false, runtime, options: { ...input, verbose: parsed.verbose,
    tuiMode: parsed.tuiMode ?? "fullscreen", initialThemeSetting: parsed.useTheme, startupDiagnostics: runtime.diagnostics,
    modelFallbackMessage: runtime.modelFallbackMessage } };
}
