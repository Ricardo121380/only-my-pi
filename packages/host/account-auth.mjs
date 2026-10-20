import { spawnAuthProcess } from "./auth-process.mjs";
import { fileURLToPath } from "node:url";
import { accountWorkerEnvironment } from "./models.mjs";
import { hostError } from "./contracts.mjs";

export async function accountAuth({ stack, configRoot, accounts, accountId, input, env = process.env, signal, readSecret }) {
  if (!input || !["status", "apiKey", "logout"].includes(input.type) || Object.keys(input).some((key) => !["type", ...(input.type === "apiKey" ? ["key"] : [])].includes(key))) throw hostError("ACCOUNT_INPUT_INVALID");
  if (input.type === "apiKey" && !readSecret && (typeof input.key !== "string" || !input.key.trim() || input.key.length > 16384)) throw hostError("ACCOUNT_INPUT_INVALID");
  const operation = async (_account, reservation) => {
    const request = readSecret && input.type === "apiKey" ? { type: "apiKey", key: await readSecret() } : input;
    if (request.type === "apiKey" && (typeof request.key !== "string" || !request.key.trim() || request.key.length > 16384)) throw hostError("ACCOUNT_INPUT_INVALID");
    if (signal?.aborted) throw hostError("ACCOUNT_AUTH_CANCELLED", 409);
    const child = await spawnAuthProcess(configRoot, stack.nodePath, [fileURLToPath(new URL("./account-auth-worker.mjs", import.meta.url)), stack.root, configRoot, accountId], { env: accountWorkerEnvironment(env), stdio: ["pipe", "pipe", "pipe", "ipc"] }, reservation);
    return new Promise((resolve, reject) => {
    let output = "", failed = false;
    const cancel = () => { failed = true; child.kill("SIGKILL"); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 25000);
    child.stdout.on("data", (chunk) => { output += chunk; if (output.length > 65536) { failed = true; child.kill("SIGKILL"); } });
    child.stderr.resume(); child.stdin.on("error", () => {});
    child.on("error", () => { failed = true; });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) { reject(hostError("ACCOUNT_AUTH_CANCELLED", 409)); return; }
      try {
        if (failed || code !== 0) throw new Error();
        const value = JSON.parse(output);
        if (!["stored", "missing", "stored_sync_failed", "removed_sync_failed"].includes(value.status)) throw new Error();
        resolve({ status: value.status });
      } catch { reject(hostError("ACCOUNT_AUTH_FAILED", 503)); }
    });
    if (!signal?.aborted) {
      child.send({ type: "begin" }, (error) => { if (error) cancel(); });
      child.stdin.end(JSON.stringify(request));
    }
    });
  };
  if (input.type !== "status") return accounts.change(accountId, operation);
  const release = await accounts.beginUse(accountId);
  try { return await operation(await accounts.get(accountId), release); }
  finally { await release(); }
}
