import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { hostError } from "./contracts.mjs";
export async function listModels({ stack, configRoot, env = process.env, signal }) {
  try {
    const { stdout } = await promisify(execFile)(stack.nodePath, [fileURLToPath(new URL("./models-worker.mjs", import.meta.url)), stack.root, configRoot],
      { env: { ...env, PI_CODING_AGENT_DIR: configRoot }, signal, timeout: 20000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.models)) throw hostError("MODEL_CATALOG_UNAVAILABLE");
    return result.models;
  } catch { throw hostError("MODEL_CATALOG_UNAVAILABLE", 503); }
}
