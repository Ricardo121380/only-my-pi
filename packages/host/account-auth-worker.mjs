import path from "node:path";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "./accounts.mjs";
import { awaitAuthStart } from "./auth-process.mjs";
import { registerClassifiers } from "../model-calls/models.mjs";

let finished = false;
process.on("disconnect", () => { if (!finished) process.exit(1); });

try {
  await awaitAuthStart();
  const [stackRoot, configRoot, accountId] = process.argv.slice(2);
  const catalog = new AccountCatalog(configRoot), account = await catalog.get(accountId);
  let raw = "";
  for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 65536) throw new Error(); }
  const input = JSON.parse(raw);
  const { ModelRuntime } = await import(pathToFileURL(path.join(stackRoot, "pi/dist/index.js")).href);
  const paths = await catalog.runtimePaths(accountId);
  const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  await registerClassifiers(runtime, configRoot, paths.modelsPath, path.join(stackRoot, "pi/dist/index.js"));
  let status;
  if (input.type === "status") {
    const credentials = await runtime.listCredentials();
    status = credentials.some((c) => c.providerId === account.providerId && c.type === account.authType) ? "stored" : "missing";
  } else if (input.type === "logout") {
    try { await runtime.logout(account.providerId); status = "missing"; }
    catch (error) { if (error.name !== "CredentialSynchronizationError") throw error; status = "removed_sync_failed"; }
  } else if (input.type === "apiKey" && account.authType === "api_key" && typeof input.key === "string" && input.key.length > 0 && input.key.length <= 16384) {
    let prompted = false;
    try {
      await runtime.login(account.providerId, "api_key", { signal: AbortSignal.timeout(20000),
        prompt: async (prompt) => { if (prompted || prompt.type !== "secret") throw new Error(); prompted = true; return input.key; }, notify() {} });
      status = "stored";
    } catch (error) { if (error.name !== "CredentialSynchronizationError") throw error; status = "stored_sync_failed"; }
  } else throw new Error();
  process.stdout.write(JSON.stringify({ status }) + "\n");
} catch { process.stdout.write(JSON.stringify({ code: "ACCOUNT_AUTH_FAILED" }) + "\n"); process.exitCode = 1; }
finally { finished = true; if (process.connected) process.disconnect(); }
