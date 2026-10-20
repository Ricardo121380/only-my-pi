import path from "node:path";
import { pathToFileURL } from "node:url";
import { findPackageJSON } from "node:module";
import fs from "node:fs/promises";
import { AccountCatalog } from "./accounts.mjs";
import { CLI_ACCOUNT_ID } from "./contracts.mjs";
import { hasAccountCredential } from "./account-credential.mjs";
import { classifierChoice, registerClassifiers, imageChoice, registerImages } from "../model-calls/models.mjs";
const [stackRoot, configRoot, accountId, modelType = "llm"] = process.argv.slice(2);
try {
  if (![stackRoot, configRoot].every((p) => typeof p === "string" && path.isAbsolute(p))) throw new Error("invalid runtime paths");
  const sdk = pathToFileURL(path.join(stackRoot, "pi/dist/index.js"));
  const { ModelRuntime } = await import(sdk.href);
  // pi-ai exposes this entry only under the ESM import condition. CommonJS
  // require.resolve cannot resolve it, even though Pi itself can import it.
  const aiPackage = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(await fs.realpath(sdk)));
  const aiManifest = JSON.parse(await fs.readFile(aiPackage, "utf8"));
  const { getSupportedThinkingLevels } = await import(new URL(aiManifest.exports["./compat"].import, pathToFileURL(aiPackage)).href);
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === undefined || accountId === CLI_ACCOUNT_ID ? null : await catalog.get(accountId);
  const paths = account ? await catalog.runtimePaths(account.accountId) : { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"),
    modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") };
  const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, ...(accountId ? { refreshOnCreate: false } : {}) });
  if (modelType === "classifier") await registerClassifiers(runtime, configRoot, paths.modelsPath, path.join(stackRoot, "pi/dist/index.js"));
  if (modelType === "image") await registerImages(runtime, configRoot, paths.modelsPath, path.join(stackRoot, "pi/dist/index.js"));
  let available;
  if (account) {
    const stored = (await runtime.listCredentials()).some((entry) => entry.providerId === account.providerId && entry.type === account.authType);
    if (stored) { await runtime.refresh({ allowNetwork: false }); available = (modelType !== "llm" ? await runtime.getAvailableOfType(modelType) : runtime.getAvailableSnapshot()).filter((m) => m.provider === account.providerId); }
    else available = [];
  } else if (accountId === CLI_ACCOUNT_ID) {
    const admitted = new Set();
    for (const provider of runtime.getProviders()) if (await hasAccountCredential(runtime, accountId, { providerId: provider.id })) admitted.add(provider.id);
    await runtime.refresh({ allowNetwork: false }); available = (modelType !== "llm" ? await runtime.getAvailableOfType(modelType) : runtime.getAvailableSnapshot()).filter((m) => admitted.has(m.provider));
  } else available = (modelType !== "llm" ? await runtime.getAvailableOfType(modelType) : runtime.getAvailableSnapshot());
  if (!["llm", "classifier", "image"].includes(modelType)) throw new Error();
  const models = available.map((m) => modelType === "classifier" ? classifierChoice(m) : modelType === "image" ? imageChoice(m) : ({ id: `${m.provider}/${m.id}`, name: String(m.name ?? m.id).slice(0, 256), provider: m.provider,
    thinkingLevels: m.reasoning ? getSupportedThinkingLevels(m) : [], contextWindow: m.contextWindow }));
  process.stdout.write(JSON.stringify({ models }) + "\n");
} catch { process.stdout.write(JSON.stringify({ code: "MODEL_CATALOG_UNAVAILABLE" }) + "\n"); process.exitCode = 1; }
