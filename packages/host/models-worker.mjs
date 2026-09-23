import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { AccountCatalog } from "./accounts.mjs";
import { CLI_ACCOUNT_ID } from "./contracts.mjs";
const [stackRoot, configRoot, accountId] = process.argv.slice(2);
try {
  if (![stackRoot, configRoot].every((p) => typeof p === "string" && path.isAbsolute(p))) throw new Error("invalid runtime paths");
  const sdk = pathToFileURL(path.join(stackRoot, "pi/dist/index.js"));
  const { ModelRuntime } = await import(sdk.href);
  const { getSupportedThinkingLevels } = await import(pathToFileURL(createRequire(sdk).resolve("@earendil-works/pi-ai/compat")).href);
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === undefined || accountId === CLI_ACCOUNT_ID ? null : await catalog.get(accountId);
  const paths = account ? await catalog.runtimePaths(account.accountId) : { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"),
    modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") };
  const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, ...(accountId ? { refreshOnCreate: false } : {}) });
  let available;
  if (account) {
    const stored = (await runtime.listCredentials()).some((entry) => entry.providerId === account.providerId && entry.type === account.authType);
    if (stored) { await runtime.refresh({ allowNetwork: false }); available = runtime.getAvailableSnapshot().filter((m) => m.provider === account.providerId); }
    else available = [];
  } else if (accountId === CLI_ACCOUNT_ID) {
    const stored = new Set((await runtime.listCredentials()).map((entry) => entry.providerId));
    await runtime.refresh({ allowNetwork: false }); available = runtime.getAvailableSnapshot().filter((m) => stored.has(m.provider));
  } else available = runtime.getAvailableSnapshot();
  const models = available.map((m) => ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id).slice(0, 256), provider: m.provider,
    thinkingLevels: m.reasoning ? getSupportedThinkingLevels(m) : [], contextWindow: m.contextWindow }));
  process.stdout.write(JSON.stringify({ models }) + "\n");
} catch { process.stdout.write(JSON.stringify({ code: "MODEL_CATALOG_UNAVAILABLE" }) + "\n"); process.exitCode = 1; }
