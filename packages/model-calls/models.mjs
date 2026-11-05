import path from "node:path";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "../accounts/catalog.mjs";
import { hasAccountCredential } from "../accounts/credential.mjs";
import { modelCallError } from "./contracts.mjs";
import { CLI_ACCOUNT_ID } from "../accounts/contracts.mjs";
import { classifierChoice, registerClassifiers, imageChoice, registerImages } from "../accounts/model-registry.mjs";

export async function classifierRuntime({ configRoot, sdkFile, accountId, modelId, kind = "classifier" }) {
  const prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === CLI_ACCOUNT_ID ? { providerId: modelId.split("/")[0] } : await catalog.get(accountId);
  if (!modelId.startsWith(`${account.providerId}/`)) throw modelCallError(`${prefix}_ACCOUNT_MISMATCH`, 409);
  const paths = accountId === CLI_ACCOUNT_ID ? { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"), modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") } : await catalog.runtimePaths(accountId);
  const sdk = await import(pathToFileURL(sdkFile).href);
  const runtime = await sdk.ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  await (kind === "image" ? registerImages : registerClassifiers)(runtime, configRoot, paths.modelsPath, sdkFile);
  if (!await hasAccountCredential(runtime, accountId, account)) throw modelCallError(`${prefix}_CREDENTIAL_MISSING`, 409);
  await runtime.refresh({ allowNetwork: false });
  const model = runtime.getModelOfType(kind, account.providerId, modelId.slice(account.providerId.length + 1));
  const choice = kind === "image" ? imageChoice : classifierChoice;
  if (!model || !choice(model).supported) throw modelCallError(`${prefix}_UNAVAILABLE`, 409);
  return { runtime, model, choice: choice(model) };
}
