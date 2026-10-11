import fs from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { canonicalJson, readJsonObject } from "../config-runtime/index.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "../host/accounts.mjs";
import { hasAccountCredential } from "../host/account-credential.mjs";
import { CLI_ACCOUNT_ID, hostError } from "../host/contracts.mjs";
import { digest } from "../mcp/catalog.mjs";

export const CLASSIFIER_APIS = ["typesafe-system-one", "openai-decisions", "cloudflare-workers-ai-system-one"];
export const IMAGE_APIS = ["openrouter-images"];
export function classifierChoice(model) {
  const definition = { provider: model.provider, id: model.id, type: model.type, api: model.api, baseUrl: model.baseUrl, input: model.input ?? ["text"], contextWindow: model.contextWindow, cost: model.cost ?? null };
  const supported = CLASSIFIER_APIS.includes(model.api) && typeof model.baseUrl === "string";
  return { id: `${model.provider}/${model.id}`, name: String(model.name ?? model.id).slice(0, 256), provider: model.provider, type: "classifier", contextWindow: model.contextWindow,
    definition, definitionDigest: digest(canonicalJson(definition)), supported, unavailableReason: supported ? null : "该分类协议尚不支持单请求预算控制", hardCostLimit: false, price: model.cost ?? null };
}
export function imageChoice(model) {
  const definition = { provider: model.provider, id: model.id, type: model.type, api: model.api, baseUrl: model.baseUrl, input: model.input ?? ["text"], output: model.output, cost: model.cost ?? null };
  const supported = IMAGE_APIS.includes(model.api) && typeof model.baseUrl === "string" && model.output?.includes("image");
  return { id: `${model.provider}/${model.id}`, name: String(model.name ?? model.id).slice(0, 256), provider: model.provider, type: "image", definition, definitionDigest: digest(canonicalJson(definition)), supported,
    unavailableReason: supported ? null : "该生图协议尚不支持受控单请求", hardCostLimit: false, price: model.cost ?? null, parameters: { input: definition.input, output: ["image/png"], size: false, quality: false, imageCount: "返回图片上限，非 Provider 生成数量保证" } };
}
export async function registerClassifiers(runtime, configRoot, modelsPath, sdkFile) {
  const file = path.join(path.dirname(modelsPath), "classifiers.json");
  const config = await readJsonObject(configRoot, file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!config) return;
  if (!config.providers || typeof config.providers !== "object") throw hostError("CLASSIFIER_CONFIG_INVALID");
  const aiPackage = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(await fs.realpath(sdkFile)));
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!CLASSIFIER_APIS.includes(provider.api) || !Array.isArray(provider.models) || provider.models.length > 100 || provider.models.some(model => model.type !== "classifier")) throw hostError("CLASSIFIER_CONFIG_INVALID");
    const adapter = await import(pathToFileURL(path.join(path.dirname(aiPackage), "dist/api", `${provider.api}.js`)).href);
    runtime.registerProvider(providerId, { baseUrl: provider.baseUrl, models: provider.models.map(model => ({ ...model, api: provider.api })), classifiers: { [provider.api]: { classify: adapter.classify } } });
  }
}
export async function registerImages(runtime, configRoot, modelsPath, sdkFile) {
  const file = path.join(path.dirname(modelsPath), "images.json");
  const config = await readJsonObject(configRoot, file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!config) return;
  if (!config.providers || typeof config.providers !== "object") throw hostError("IMAGE_CONFIG_INVALID");
  const aiPackage = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(await fs.realpath(sdkFile)));
  const manifest = JSON.parse(await fs.readFile(aiPackage, "utf8"));
  for (const [providerId, provider] of Object.entries(config.providers)) {
    if (!IMAGE_APIS.includes(provider.api) || !Array.isArray(provider.models) || provider.models.length > 100 || provider.models.some(model => model.type !== "image")) throw hostError("IMAGE_CONFIG_INVALID");
    const publicEntry = manifest.exports["./api/*"].import.replace("*", provider.api);
    const adapter = await import(new URL(publicEntry, pathToFileURL(aiPackage)).href);
    runtime.registerProvider(providerId, { baseUrl: provider.baseUrl, models: provider.models.map(model => ({ ...model, api: provider.api })), images: { [provider.api]: { generateImages: adapter.generateImages } } });
  }
}
export async function classifierRuntime({ configRoot, sdkFile, accountId, modelId, kind = "classifier" }) {
  const prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
  const catalog = new AccountCatalog(configRoot);
  const account = accountId === CLI_ACCOUNT_ID ? { providerId: modelId.split("/")[0] } : await catalog.get(accountId);
  if (!modelId.startsWith(`${account.providerId}/`)) throw hostError(`${prefix}_ACCOUNT_MISMATCH`, 409);
  const paths = accountId === CLI_ACCOUNT_ID ? { authPath: path.join(configRoot, "auth.json"), modelsPath: path.join(configRoot, "models.json"), modelsStorePath: path.join(configRoot, "only-my-pi/host/cli-models-store.json") } : await catalog.runtimePaths(accountId);
  const sdk = await import(pathToFileURL(sdkFile).href);
  const runtime = await sdk.ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  await (kind === "image" ? registerImages : registerClassifiers)(runtime, configRoot, paths.modelsPath, sdkFile);
  if (!await hasAccountCredential(runtime, accountId, account)) throw hostError(`${prefix}_CREDENTIAL_MISSING`, 409);
  await runtime.refresh({ allowNetwork: false });
  const model = runtime.getModelOfType(kind, account.providerId, modelId.slice(account.providerId.length + 1));
  const choice = kind === "image" ? imageChoice : classifierChoice;
  if (!model || !choice(model).supported) throw hostError(`${prefix}_UNAVAILABLE`, 409);
  return { runtime, model, choice: choice(model) };
}
