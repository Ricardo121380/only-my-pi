import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { AccountCatalog } from "./accounts.mjs";
import { ensureConfigDirectory } from "../config-runtime/index.mjs";
import { awaitAuthStart } from "./auth-process.mjs";

const send = (value) => process.send?.(value);
const controller = new AbortController();
let pending, finished = false;
process.on("message", (message) => {
  if (message?.type === "cancel") controller.abort();
  if (message?.type === "answer" && pending?.id === message.promptId && typeof message.value === "string") pending.resolve(message.value);
});
process.on("disconnect", () => { if (!finished) { controller.abort(); process.exit(1); } });
try {
  await awaitAuthStart();
  const [stackRoot, configRoot, accountId] = process.argv.slice(2);
  const { ModelRuntime } = await import(pathToFileURL(path.join(stackRoot, "pi/dist/index.js")).href);
  let paths, account;
  if (accountId === "--providers") {
    const directory = await ensureConfigDirectory(configRoot, "only-my-pi/host/provider-catalog");
    paths = { authPath: path.join(directory, "auth.json"), modelsPath: path.join(directory, "models.json"), modelsStorePath: path.join(directory, "models-store.json") };
  } else {
    const catalog = new AccountCatalog(configRoot);
    account = await catalog.get(accountId); paths = await catalog.runtimePaths(accountId);
  }
  const runtime = await ModelRuntime.create({ ...paths, allowModelNetwork: false, refreshOnCreate: false });
  if (!account) {
    send({ type: "providers", providers: runtime.getProviders().filter((p) => p.auth.oauth).map((p) => ({ providerId: p.id, name: p.auth.oauth.name })) });
  } else {
    if (account.authType !== "oauth" || !runtime.getProviders().some((p) => p.id === account.providerId && p.auth.oauth)) throw new Error();
    try {
      await runtime.login(account.providerId, "oauth", {
        signal: controller.signal,
        notify(event) { send({ type: "notify", event }); },
        prompt(prompt) {
          return new Promise((resolve, reject) => {
            if (pending || controller.signal.aborted || prompt.signal?.aborted) { reject(new Error()); return; }
            const id = randomUUID();
            const cleanup = () => { controller.signal.removeEventListener("abort", cancel); prompt.signal?.removeEventListener("abort", cancel); pending = undefined; };
            const cancel = () => { cleanup(); send({ type: "prompt_cancelled", promptId: id }); reject(new Error()); };
            pending = { id, resolve(value) { cleanup(); resolve(value); } };
            controller.signal.addEventListener("abort", cancel, { once: true }); prompt.signal?.addEventListener("abort", cancel, { once: true });
            send({ type: "prompt", promptId: id, prompt: { type: prompt.type, ...(prompt.type === "select" ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : {}) } });
          });
        },
      });
      send({ type: "result", status: "stored" });
    } catch (error) {
      if (error.name !== "CredentialSynchronizationError") throw error;
      send({ type: "result", status: "stored_sync_failed" });
    }
  }
  finished = true; process.disconnect();
} catch { send({ type: "result", status: "failed" }); finished = true; process.exitCode = 1; process.disconnect?.(); }
