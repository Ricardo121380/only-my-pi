import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "./accounts.mjs";
import { CLI_ACCOUNT_ID } from "./contracts.mjs";
import { createControlledExtension } from "./controlled-extension.mjs";
import { hasAccountCredential } from "./account-credential.mjs";
import { createPiInputBridge } from "./pi-input-bridge.mjs";
import { openValidatedSession } from "../direct-agent/session-history.mjs";
import { INPUT_PROTOCOL } from "./input-protocol.mjs";
import { disableOmpCacheWarming } from "../direct-agent/cache-warming-policy.mjs";
import { mcpToolNames } from "../mcp/catalog.mjs";
import { hostProjectAuthority } from "./project-authority.mjs";
import { applyOmpRequestPolicy } from "../direct-agent/request-policy.mjs";
import { awaitAuthStart } from "./auth-process.mjs";
import { ProductSettings, settingsError } from "../product-settings/catalog.mjs";
import { productLoaderOptions, confirmProductLoad, filterSettingsTools, settingsToolNames } from "../product-settings/runtime.mjs";
import { openProductAccount } from "./account-runtime.mjs";

// Host-owned arguments contain identities and audited paths, never credentials.
try {
  // The Host records this worker in every account reservation before begin.
  await awaitAuthStart();
  const [stackRoot, configRoot, accountId, modelId, sessionRoot, mode, resumeFile, ...extensions] = process.argv.slice(2);
  if (!["readonly", "controlled"].includes(mode)) throw new Error();
  const controlled = mode === "controlled";
  const settingsSnapshot = process.env.OMP_PRODUCT_SETTINGS_SNAPSHOT ? JSON.parse(process.env.OMP_PRODUCT_SETTINGS_SNAPSHOT) : null;
  const mcpSnapshot = process.env.OMP_HOST_MCP_SNAPSHOT ? JSON.parse(process.env.OMP_HOST_MCP_SNAPSHOT) : null;
  const mcpNames = mcpToolNames(mcpSnapshot);
  if (controlled && !process.send) throw new Error();
  if (![stackRoot, configRoot, sessionRoot, ...extensions].every((p) => typeof p === "string" && path.isAbsolute(p)) || !extensions.length) throw new Error();
  if (controlled) {
    const direct = extensions.filter((p) => p.endsWith(`${path.sep}extensions${path.sep}omp-direct${path.sep}index.ts`));
    if (direct.length !== 1) throw new Error();
    const childEntry = path.resolve(path.dirname(direct[0]), "../../bin/omp-account-child.mjs");
    await fs.access(childEntry, fs.constants.X_OK);
    // These metadata values are fixed for this account-owned worker lifetime,
    // never temporarily swapped around concurrent child launches.
    process.env.OMP_HOST_ACCOUNT_CONFIG_ROOT = configRoot;
    process.env.OMP_HOST_ACCOUNT_ID = accountId;
    process.env.PI_SUBAGENT_PI_BINARY = childEntry;
    process.env.PATH = `${path.join(stackRoot, "node/bin")}${path.delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`;
  }
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === CLI_ACCOUNT_ID ? { accountId, providerId: modelId.split("/")[0] } : await catalog.get(accountId);
  if (!modelId.startsWith(`${account.providerId}/`)) throw new Error();
  const sdkFile = await fs.realpath(path.join(stackRoot, "pi/dist/index.js"));
  process.env.OMP_MCP_SDK_FILE = sdkFile;
  const sdk = await import(pathToFileURL(sdkFile).href);
  // The SDK service factory does not perform the CLI's process-level theme setup.
  // Audited permission extensions still use theme helpers during RPC session_start.
  sdk.initTheme(undefined, false);
  const paths = accountId === CLI_ACCOUNT_ID ? { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"), modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") } : await catalog.runtimePaths(accountId);
  const productAccount = accountId === CLI_ACCOUNT_ID ? undefined : await openProductAccount({ sdk, configRoot, accountId });
  const modelRuntime = productAccount?.runtime ?? await sdk.ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  if (!await hasAccountCredential(modelRuntime, accountId, account)) throw new Error();
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
    if (settingsSnapshot) await new ProductSettings(configRoot).verify(settingsSnapshot, path.resolve(extensions.find(p => p.endsWith("extensions/omp-direct/index.ts")), "../../.."));
    const services = await sdk.createAgentSessionServices({
      cwd, agentDir: configRoot, modelRuntime,
      settingsManager: applyOmpRequestPolicy(sdk.SettingsManager.create(cwd, configRoot, { projectTrusted: false })),
      extensionFlagValues: new Map([["perm", controlled ? "build" : "plan"]]),
      resourceLoaderOptions: { ...(settingsSnapshot ? productLoaderOptions({ sdk, configRoot, snapshot: settingsSnapshot }) : {}), noExtensions: true, additionalExtensionPaths: extensions, extensionFactories: [
        (pi) => pi.events.emit("only-my-pi:host-session-owner:v1", { ownsSession: (ctx) => ctx.mode === "rpc" && ctx.sessionManager.getSessionId() === sessionManager.getSessionId(), verifyProject: hostProjectAuthority({ configRoot, taskId: process.env.OMP_HOST_INPUT_TASK_ID, sessionManager }) }),
        (pi) => { if (settingsSnapshot) pi.events.emit("only-my-pi:product-task:v1", settingsSnapshot); },
        (pi) => { if (mcpSnapshot) pi.events.emit("only-my-pi:mcp-task:v1", { snapshot: mcpSnapshot }); },
        ...(controlled ? [createControlledExtension()] : []),
        disableOmpCacheWarming,
      ] },
    }).catch(async () => { const error = settingsError("RESOURCE_LOAD_FAILED", 409); if (settingsSnapshot) await new ProductSettings(configRoot).recordLoad(settingsSnapshot, error, process.env.OMP_HOST_INPUT_TASK_ID); throw error; });
    if (services.diagnostics.some((d) => d.type === "error") || services.resourceLoader.getExtensions().errors.length) { const error = settingsError("RESOURCE_LOAD_FAILED", 409); if (settingsSnapshot) await new ProductSettings(configRoot).recordLoad(settingsSnapshot, error, process.env.OMP_HOST_INPUT_TASK_ID); throw error; }
    const model = modelRuntime.getAvailableSnapshot().find((m) => `${m.provider}/${m.id}` === modelId);
    if (!model) throw new Error();
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, tools: [...(controlled ? ["read", "grep", "find", "ls", "edit", "write", "bash", "request_coding_access", "delegate_readonly_agent", "delegate_managed_writer"] : ["read", "grep", "find", "ls"]), ...mcpNames, "codemode", ...(settingsSnapshot ? settingsToolNames(settingsSnapshot).filter(n => n === "context_snapshot") : [])].filter(name => !settingsSnapshot || filterSettingsTools([name], settingsSnapshot).length) });
    if (created.modelFallbackMessage || `${created.session.model?.provider}/${created.session.model?.id}` !== modelId) throw new Error();
    if (settingsSnapshot) {
      const data = await confirmProductLoad({ services, session: created.session, configRoot, snapshot: settingsSnapshot, taskId: process.env.OMP_HOST_INPUT_TASK_ID });
      if (process.connected) process.send({ type: "product_settings_loaded", data }, () => {});
    }
    sessionManager.appendCustomEntry("omp-account-binding", { version: 1, accountId: account.accountId, providerId: account.providerId });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const cwd = process.cwd();
  if (resumeFile && !path.isAbsolute(resumeFile)) throw new Error();
  const sessionManager = resumeFile ? await openValidatedSession(resumeFile, sdk, sessionRoot, cwd, configRoot) : sdk.SessionManager.create(cwd, sessionRoot);
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: configRoot, sessionManager });
  const taskId = process.env.OMP_HOST_INPUT_TASK_ID;
  if (taskId !== undefined) {
    if (!process.send || !/^[a-zA-Z0-9_-]{1,128}$/u.test(taskId)) throw new Error();
    const send = (frame) => { if (process.connected) process.send(frame, () => {}); };
    const bridge = createPiInputBridge({ session: runtime.session, taskId, accountId, modelId, mode, resourceRevision: settingsSnapshot?.resourceRevision ?? 0, send });
    process.on("message", (frame) => {
      if (frame?.type !== "omp_input_command") return;
      try {
        if (frame.protocol !== INPUT_PROTOCOL || typeof frame.id !== "string" || frame.id.length > 128 || !["deliver", "lookup"].includes(frame.operation) || Object.keys(frame).sort().join() !== "id,operation,protocol,record,type") throw new Error();
        const data = frame.operation === "deliver" ? bridge.deliver(frame.record) : bridge.lookup(frame.record);
        send({ type: "omp_input_response", protocol: INPUT_PROTOCOL, id: frame.id, success: true, data });
      } catch (error) {
        const code = ["TASK_NOT_RUNNING", "INPUT_BINDING_CHANGED", "INPUT_ID_CONFLICT", "INPUT_STATE_INVALID", "INPUT_QUEUE_LIMIT"].includes(error?.code) ? error.code : "INPUT_DELIVERY_UNCONFIRMED";
        send({ type: "omp_input_response", protocol: INPUT_PROTOCOL, id: frame?.id, success: false, code });
      }
    });
    send({ type: "omp_input_ready", protocol: INPUT_PROTOCOL, taskId });
  }
  await sdk.runRpcMode(runtime);
  await productAccount?.release();
} catch {
  process.stdout.write(JSON.stringify({ type: "extension_error", code: "ACCOUNT_RPC_START_FAILED" }) + "\n");
  process.exitCode = 1;
}
