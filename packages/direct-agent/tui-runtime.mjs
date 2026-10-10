import path from "node:path";
import fs from "node:fs/promises";
import { ownershipError } from "../host/ownership.mjs";
import { inspectSessionSelection, prepareHeadlessSession } from "./session-selection.mjs";
import { createAdmittedSessionRuntime } from "./session-runtime.mjs";
import { createResumeUiExtension } from "./session-resume-ui.mjs";
import { prepareTuiInput } from "./initial-input.mjs";
import { disableOmpCacheWarming } from "./cache-warming-policy.mjs";
import { McpCatalog, mcpToolNames } from "../mcp/catalog.mjs";

// Candidate bootstrap using only Pi's public SDK. Not routed from the daily
// launcher until the remaining CLI compatibility cases pass acceptance.
export function createDirectTuiRuntime(options) { return createDirectRuntime(options, "tui"); }
export function createDirectRpcRuntime(options) { return createDirectRuntime(options, "rpc"); }

async function createDirectRuntime({ sdk, args, configRoot, admissions,
  cwd = process.cwd(), env = process.env, selectResume, confirmProjectTrust, confirmSessionCwd, modelRuntime, onFatal }, mode) {
  const parsed = sdk.parseArgs(args);
  if (parsed.diagnostics.some((item) => item.type === "error")) throw ownershipError("OMP_AGENT_OPTION_INVALID");
  if ((mode === "tui" && parsed.print) || (mode === "tui" ? ![undefined, "text"].includes(parsed.mode) : parsed.mode !== "rpc") || parsed.export || parsed.version
    || parsed.help || parsed.apiKey)
    throw ownershipError("TUI_STARTUP_OPTION_NOT_ADMITTED");
  if (mode === "rpc" && (parsed.fileArgs?.length || parsed.messages?.length || parsed.resume))
    throw ownershipError("RPC_STARTUP_OPTION_NOT_ADMITTED");
  if (!parsed.noExtensions || !parsed.extensions?.length || parsed.extensions.some((entry) => !path.isAbsolute(entry))
    || !parsed.tools?.length || parsed.unknownFlags.get("perm") !== (mode === "rpc" ? "plan" : "build"))
    throw ownershipError("TUI_CONTROLLED_OPTIONS_REQUIRED");
  const name = parsed.name?.trim();
  if (parsed.name !== undefined && !name) throw ownershipError("OMP_AGENT_OPTION_INVALID");
  const selection = inspectSessionSelection(args);
  if (parsed.noSession && selection.fork) throw ownershipError("OMP_AGENT_OPTION_INVALID");
  const prepared = parsed.noSession
    ? { sessionManager: await admissions.createMemory(cwd, { id: selection.id }) }
    : await prepareHeadlessSession({ args, sdk, admissions, configRoot, cwd, env, selectResume });
  if (prepared.cancelled) return { cancelled: true };
  const sessionTrust = new Map();
  let runtime;
  const resolveProjectTrust = async (effectiveCwd, projectTrustContext, initial = false) => {
    // Direct RPC is read-only and never authorizes project resource execution.
    if (mode === "rpc") return false;
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
    const projectTrusted = await resolveProjectTrust(effectiveCwd, projectTrustContext, !sessionStartEvent);
    const settingsManager = sdk.SettingsManager.create(effectiveCwd, agentDir, { projectTrusted });
    if (parsed.useTheme !== undefined) settingsManager.applyOverrides({ theme: parsed.useTheme });
    sdk.initTheme(settingsManager.getTheme(), false);
    const mcpSnapshot = await new McpCatalog(configRoot).snapshot(await fs.realpath(effectiveCwd));
    const mcpNames = mcpToolNames(mcpSnapshot);
    const services = await sdk.createAgentSessionServices({ cwd: effectiveCwd, agentDir, settingsManager,
      modelRuntime, modelRuntimeSignal: AbortSignal.timeout(15_000), extensionFlagValues: parsed.unknownFlags,
      resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: parsed.extensions,
        extensionFactories: [(pi) => pi.events.emit("only-my-pi:direct-session-owner:v1", {
          ownsSession: (ctx) => !admissions.closing && ctx.mode === mode && ctx.sessionManager === sessionManager,
        }), (pi) => pi.events.emit("only-my-pi:mcp-task:v1", { snapshot: mcpSnapshot }), ...(mode === "tui" ? [createResumeUiExtension({ sdk, getRuntime: () => runtime })] : []), disableOmpCacheWarming] } });
    if (services.diagnostics.some((entry) => entry.type === "error") || services.resourceLoader.getExtensions().errors.length)
      throw ownershipError("TUI_EXTENSION_LOAD_FAILED");
    const diagnostics = [...parsed.diagnostics, ...services.diagnostics];
    const patterns = parsed.models ?? settingsManager.getEnabledModels();
    const scope = patterns?.length ? await sdk.resolveModelScopeWithDiagnostics(patterns, services.modelRuntime,
      { signal: AbortSignal.timeout(15_000) }) : { scopedModels: [], diagnostics: [] };
    diagnostics.push(...scope.diagnostics);
    let model, thinkingLevel;
    if (parsed.model) {
      const resolved = sdk.resolveCliModel({ cliProvider: parsed.provider, cliModel: parsed.model,
        cliThinking: parsed.thinking, modelRuntime: services.modelRuntime });
      if (resolved.error || !resolved.model) throw ownershipError("TUI_MODEL_NOT_FOUND");
      model = resolved.model; thinkingLevel = resolved.thinkingLevel;
      if (resolved.warning) diagnostics.push({ type: "warning", message: resolved.warning });
    } else if (scope.scopedModels.length && !sessionManager.buildSessionContext().messages.length) {
      const selected = scope.scopedModels.find(({ model }) => model.provider === settingsManager.getDefaultProvider()
        && model.id === settingsManager.getDefaultModel()) ?? scope.scopedModels[0];
      model = selected.model; thinkingLevel = selected.thinkingLevel;
    }
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model,
      thinkingLevel: parsed.thinking ?? thinkingLevel, scopedModels: scope.scopedModels.length ? scope.scopedModels : undefined,
      tools: [...parsed.tools, ...mcpNames], excludeTools: parsed.excludeTools });
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
  if (mode === "rpc") return { cancelled: false, runtime };
  const input = await prepareTuiInput({ sdk, files: parsed.fileArgs, messages: parsed.messages, cwd,
    autoResizeImages: runtime.services.settingsManager.getImageAutoResize() });
  return { cancelled: false, runtime, options: { ...input, verbose: parsed.verbose,
    tuiMode: parsed.tuiMode ?? "fullscreen", initialThemeSetting: parsed.useTheme, startupDiagnostics: runtime.diagnostics,
    modelFallbackMessage: runtime.modelFallbackMessage } };
}
