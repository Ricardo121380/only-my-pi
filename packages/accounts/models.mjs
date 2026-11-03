import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { accountError } from "./contracts.mjs";
import { accountWorkerEnvironment } from "../process-runtime/account-environment.mjs";
/** Empty levels explicitly mean a non-reasoning model, not an unknown catalog.
 * @param {{thinkingLevels?: string[]}} model @param {string} level */
export function supportsThinking(model, level) {
  return Array.isArray(model.thinkingLevels) && (model.thinkingLevels.includes(level) || model.thinkingLevels.length === 0 && level === "off");
}
export async function listModels({ stack, configRoot, accountId, modelType = "llm", env = process.env, signal }) {
  try {
    const { stdout } = await promisify(execFile)(stack.nodePath, [fileURLToPath(new URL("./models-worker.mjs", import.meta.url)), stack.root, configRoot, ...(accountId === undefined ? [] : [accountId, modelType])],
      { env: { ...(accountId === undefined ? env : accountWorkerEnvironment(env)), PI_CODING_AGENT_DIR: configRoot }, signal, timeout: 20000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.models)) throw accountError("MODEL_CATALOG_UNAVAILABLE");
    return result.models;
  } catch { throw accountError("MODEL_CATALOG_UNAVAILABLE", 503); }
}
