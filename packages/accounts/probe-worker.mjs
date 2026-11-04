import path from "node:path";
import fs from "node:fs/promises";
import { findPackageJSON } from "node:module";
import { pathToFileURL } from "node:url";
import { AccountCatalog } from "./catalog.mjs";
import { hasAccountCredential } from "./credential.mjs";
import { awaitAuthStart } from "./auth-process.mjs";

let finished = false;
process.on("disconnect", () => { if (!finished) process.exit(1); });
let model;
const failure = error => {
  const text = String(error?.status ?? error?.errorMessage ?? error?.message ?? "");
  // Provider bodies can echo credentials. Never return their text or headers.
  const status = text.match(/\b([45]\d{2})\b/)?.[1];
  const reason = status ? status === "429" ? "rate_limited" : ["401", "403"].includes(status) ? "authentication" : "unavailable"
    : /unauthori[sz]ed|authentication_error/i.test(text) ? "authentication" : /rate.?limit/i.test(text) ? "rate_limited" : "unavailable";
  return { status: "rejected", reason, model };
};
try {
  await awaitAuthStart();
  const [stackRoot, configRoot, accountId] = process.argv.slice(2);
  let raw = ""; for await (const bytes of process.stdin) { raw += bytes; if (raw.length > 4096) throw new Error(); }
  const input = JSON.parse(raw); model = input.model;
  const catalog = new AccountCatalog(configRoot), account = await catalog.get(accountId);
  const sdkFile = path.join(stackRoot, "pi/dist/index.js"), { ModelRuntime } = await import(pathToFileURL(sdkFile).href);
  const runtime = await ModelRuntime.create({ ...await catalog.runtimePaths(accountId), allowModelNetwork: false, refreshOnCreate: false });
  let value;
  if (!await hasAccountCredential(runtime, accountId, account)) value = { code: "ACCOUNT_CREDENTIAL_MISSING" };
  else {
    const selected = runtime.getModel(account.providerId, model.slice(account.providerId.length + 1));
    if (!selected) value = { code: "MODEL_UNAVAILABLE" };
    else {
      const manifestPath = findPackageJSON("@earendil-works/pi-ai", pathToFileURL(await fs.realpath(sdkFile)));
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      const { getSupportedThinkingLevels } = await import(new URL(manifest.exports["./compat"].import, pathToFileURL(manifestPath)).href);
      const levels = selected.reasoning ? getSupportedThinkingLevels(selected) : ["off"];
      if (input.thinkingLevel && !levels.includes(input.thinkingLevel)) value = { code: "THINKING_LEVEL_UNAVAILABLE" };
      else {
        const signal = AbortSignal.timeout(28000);
        try {
          const message = await runtime.completeSimple(selected, { messages: [{ role: "user", content: "Reply with OK only. Do not use tools.", timestamp: Date.now() }] },
            { env: {}, signal, maxTokens: 512, maxRetries: 0, ...(input.thinkingLevel && input.thinkingLevel !== "off" ? { reasoning: input.thinkingLevel } : {}) });
          value = signal.aborted ? { status: "unknown", reason: "timeout", model }
            : message.stopReason === "error" ? failure(message)
            : message.stopReason === "stop" && message.content.some(part => part.type === "text" && part.text.trim()) ? { status: "connected", model }
            : { status: "unknown", reason: "incomplete", model };
        } catch (error) { value = signal.aborted ? { status: "unknown", reason: "timeout", model } : failure(error); }
      }
    }
  }
  process.stdout.write(JSON.stringify(value) + "\n");
} catch { process.stdout.write(JSON.stringify({ status: "rejected", reason: "unavailable", model }) + "\n"); }
finally { finished = true; if (process.connected) process.disconnect(); }
