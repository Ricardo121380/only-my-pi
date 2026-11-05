import { fileURLToPath } from "node:url";
import { spawnAuthProcess } from "./auth-process.mjs";
import { accountError, CLI_ACCOUNT_ID } from "./contracts.mjs";
import { accountWorkerEnvironment } from "../process-runtime/account-environment.mjs";

// A probe is one explicit model request, with no Agent, tools or session history.
// Its account reservation outlives cancellation until the actual child closes.
export async function probeAccount({ stack, configRoot, accounts, accountId, model, thinkingLevel, env = process.env, signal }) {
  if (accountId === CLI_ACCOUNT_ID) throw accountError("ACCOUNT_READ_ONLY", 403);
  if (typeof model !== "string" || model.length > 512 || !model.includes("/") || thinkingLevel !== undefined && !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingLevel)) throw accountError("ACCOUNT_INPUT_INVALID");
  if (signal?.aborted) throw accountError("ACCOUNT_PROBE_CANCELLED", 409);
  const release = await accounts.beginUse(accountId);
  try {
    const account = await accounts.get(accountId);
    if (!model.startsWith(`${account.providerId}/`)) throw accountError("ACCOUNT_MODEL_MISMATCH", 409);
    const child = await spawnAuthProcess(configRoot, stack.nodePath,
      [fileURLToPath(new URL("./probe-worker.mjs", import.meta.url)), stack.root, configRoot, accountId],
      { env: accountWorkerEnvironment(env), stdio: ["pipe", "pipe", "pipe", "ipc"] }, release);
    return await new Promise((resolve, reject) => {
      let output = "", failed = false, timedOut = false;
      const kill = () => child.kill("SIGKILL");
      signal?.addEventListener("abort", kill, { once: true });
      if (signal?.aborted) kill();
      const timer = setTimeout(() => { timedOut = true; kill(); }, 30000);
      child.stdout.on("data", bytes => { output += bytes; if (output.length > 65536) { failed = true; kill(); } });
      child.stderr.resume(); child.stdin.on("error", () => {}); child.on("error", () => { failed = true; });
      child.once("close", code => {
        clearTimeout(timer); signal?.removeEventListener("abort", kill);
        if (signal?.aborted) { reject(accountError("ACCOUNT_PROBE_CANCELLED", 409)); return; }
        if (timedOut) { resolve({ status: "unknown", reason: "timeout", model }); return; }
        try {
          const value = JSON.parse(output);
          if (failed || code !== 0) throw new Error();
          if (value.code && ["ACCOUNT_CREDENTIAL_MISSING", "MODEL_UNAVAILABLE", "THINKING_LEVEL_UNAVAILABLE"].includes(value.code)) { reject(accountError(value.code, 409)); return; }
          if (value.model !== model || !(value.status === "connected" && Object.keys(value).sort().join() === "model,status"
            || value.status === "rejected" && ["authentication", "rate_limited", "unavailable"].includes(value.reason)
            || value.status === "unknown" && ["timeout", "incomplete"].includes(value.reason))) throw new Error();
          // Whitelist fields even if a worker emits unexpected metadata.
          resolve({ status: value.status, ...(value.reason ? { reason: value.reason } : {}), model });
        } catch { reject(accountError("ACCOUNT_PROBE_FAILED", 503)); }
      });
      if (!signal?.aborted) {
        child.send({ type: "begin" }, error => { if (error) { failed = true; kill(); } });
        child.stdin.end(JSON.stringify({ model, thinkingLevel }));
      }
    });
  } finally { await release(); }
}
