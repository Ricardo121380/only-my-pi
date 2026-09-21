import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { hostError } from "./contracts.mjs";
export function accountWorkerEnvironment(env) {
  // Allow operational settings, never ambient provider identities or Node injection.
  const names = ["HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR"];
  return Object.fromEntries(names.filter((name) => typeof env[name] === "string").map((name) => [name, env[name]]));
}
export async function listModels({ stack, configRoot, accountId, env = process.env, signal }) {
  try {
    const { stdout } = await promisify(execFile)(stack.nodePath, [fileURLToPath(new URL("./models-worker.mjs", import.meta.url)), stack.root, configRoot, ...(accountId === undefined ? [] : [accountId])],
      { env: { ...(accountId === undefined ? env : accountWorkerEnvironment(env)), PI_CODING_AGENT_DIR: configRoot }, signal, timeout: 20000, maxBuffer: 1024 * 1024 });
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.models)) throw hostError("MODEL_CATALOG_UNAVAILABLE");
    return result.models;
  } catch { throw hostError("MODEL_CATALOG_UNAVAILABLE", 503); }
}
