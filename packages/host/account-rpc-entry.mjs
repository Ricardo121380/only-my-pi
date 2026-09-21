import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "./accounts.mjs";
import { CLI_ACCOUNT_ID } from "./contracts.mjs";
import { createControlledExtension } from "./controlled-extension.mjs";

// Host-owned arguments contain identities and audited paths, never credentials.
try {
  const [stackRoot, configRoot, accountId, modelId, sessionRoot, mode, ...extensions] = process.argv.slice(2);
  if (!["readonly", "controlled"].includes(mode)) throw new Error();
  const controlled = mode === "controlled";
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
  const sdk = await import(pathToFileURL(path.join(stackRoot, "pi/dist/index.js")).href);
  // The SDK service factory does not perform the CLI's process-level theme setup.
  // Audited permission extensions still use theme helpers during RPC session_start.
  sdk.initTheme(undefined, false);
  const paths = accountId === CLI_ACCOUNT_ID ? { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"), modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") } : await catalog.runtimePaths(accountId);
  const modelRuntime = await sdk.ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  const stored = (await modelRuntime.listCredentials()).some((entry) => entry.providerId === account.providerId && (accountId === CLI_ACCOUNT_ID || entry.type === account.authType));
  if (!stored) throw new Error();
  const createRuntime = async ({ cwd, sessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({
      cwd, agentDir: configRoot, modelRuntime,
      settingsManager: sdk.SettingsManager.create(cwd, configRoot, { projectTrusted: false }),
      extensionFlagValues: new Map([["perm", controlled ? "build" : "plan"]]),
      resourceLoaderOptions: { noExtensions: true, additionalExtensionPaths: extensions, ...(controlled ? { extensionFactories: [createControlledExtension()] } : {}) },
    });
    if (services.diagnostics.some((d) => d.type === "error") || services.resourceLoader.getExtensions().errors.length) throw new Error();
    const model = modelRuntime.getAvailableSnapshot().find((m) => `${m.provider}/${m.id}` === modelId);
    if (!model) throw new Error();
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, tools: controlled ? ["read", "grep", "find", "ls", "edit", "write", "bash", "request_coding_access"] : ["read", "grep", "find", "ls"] });
    if (created.modelFallbackMessage || `${created.session.model?.provider}/${created.session.model?.id}` !== modelId) throw new Error();
    sessionManager.appendCustomEntry("omp-account-binding", { version: 1, accountId: account.accountId, providerId: account.providerId });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const cwd = process.cwd();
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, { cwd, agentDir: configRoot, sessionManager: sdk.SessionManager.create(cwd, sessionRoot) });
  await sdk.runRpcMode(runtime);
} catch {
  process.stdout.write(JSON.stringify({ type: "extension_error", code: "ACCOUNT_RPC_START_FAILED" }) + "\n");
  process.exitCode = 1;
}
