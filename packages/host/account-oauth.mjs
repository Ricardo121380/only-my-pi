import { spawnAuthProcess } from "./auth-process.mjs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { accountWorkerEnvironment } from "./models.mjs";
import { hostError } from "./contracts.mjs";

const terminal = (status) => ["stored", "stored_sync_failed", "failed", "cancelled", "timed_out"].includes(status);
const safeUrl = (input) => {
  if (typeof input !== "string" || input.length > 8192) throw new Error();
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error();
  return url.href;
};

// Only the current flow is retained, in memory; no prompt answers or tokens enter a snapshot.
export class AccountOAuth {
  constructor({ stack, configRoot, accounts, env = process.env, timeoutMs = 300000 }) {
    Object.assign(this, { stack, configRoot, accounts, env, timeoutMs });
    this.children = new Set(); this.closing = false;
  }
  async spawn(accountId, reservation) {
    if (this.closing) throw hostError("HOST_STOPPING", 503);
    const child = await spawnAuthProcess(this.configRoot, this.stack.nodePath, [fileURLToPath(new URL("./account-oauth-worker.mjs", import.meta.url)), this.stack.root, this.configRoot, accountId], { env: accountWorkerEnvironment(this.env), stdio: ["ignore", "ignore", "ignore", "ipc"] }, reservation);
    if (this.closing) {
      await new Promise((resolve) => { child.once("close", resolve); child.kill("SIGKILL"); });
      throw hostError("HOST_STOPPING", 503);
    }
    this.children.add(child); child.on("error", () => {});
    child.once("close", () => this.children.delete(child));
    return child;
  }
  async providers() {
    if (this.discovery) return this.discovery;
    const child = await this.spawn("--providers");
    this.discovery = new Promise((resolve, reject) => {
      let providers;
      const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
      child.on("message", (message) => {
        if (message?.type !== "providers" || !Array.isArray(message.providers) || message.providers.length > 256) return;
        if (!message.providers.every((p) => /^[a-zA-Z0-9_-]{1,128}$/.test(p.providerId) && typeof p.name === "string" && p.name.length <= 256)) return;
        providers = message.providers.map(({ providerId, name }) => ({ providerId, name }));
      });
      child.on("close", (code) => { clearTimeout(timer); this.discovery = null; if (code === 0 && providers) resolve(providers); else reject(hostError("ACCOUNT_PROVIDER_DISCOVERY_FAILED", 503)); });
      child.send({ type: "begin" }, (error) => { if (error) child.kill("SIGKILL"); });
    });
    return this.discovery;
  }
  snapshot(flowId) {
    if (!this.flow || this.flow.flowId !== flowId) throw hostError("ACCOUNT_AUTH_FLOW_EXPIRED", 404);
    return structuredClone(this.flow);
  }
  async start(accountId) {
    if (this.closing) throw hostError("HOST_STOPPING", 503);
    if (this.running) throw hostError("ACCOUNT_AUTH_BUSY", 409);
    const flow = { flowId: randomUUID(), accountId, status: "starting", prompt: null, event: null };
    this.flow = flow;
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let finalStatus = "failed";
    const operation = this.accounts.change(accountId, async (account, reservation) => {
      if (account.authType !== "oauth") throw hostError("ACCOUNT_AUTH_TYPE_MISMATCH", 409);
      if (flow.status === "cancelling") throw hostError("ACCOUNT_AUTH_CANCELLED", 409);
      const child = await this.spawn(accountId, reservation); this.child = child;
      readyResolve();
      await new Promise((resolve) => {
        let result = "failed", bytes = 0, timedOut = false;
        const timer = setTimeout(() => { timedOut = true; flow.status = "cancelling"; flow.prompt = null; flow.event = null; child.kill("SIGKILL"); }, this.timeoutMs);
        child.on("message", (message) => {
          if (terminal(flow.status) || flow.status === "cancelling") return;
          try {
            bytes += Buffer.byteLength(JSON.stringify(message)); if (bytes > 262144) throw new Error();
            if (message.type === "result") { if (!["stored", "stored_sync_failed", "failed"].includes(message.status)) throw new Error(); result = message.status; }
            else if (message.type === "prompt_cancelled") { if (flow.prompt?.promptId === message.promptId) { flow.prompt = null; flow.status = "waiting"; } }
            else if (message.type === "prompt") {
              const { prompt } = message;
              if (!["text", "secret", "manual_code", "select"].includes(prompt.type) || typeof message.promptId !== "string" || message.promptId.length > 128) throw new Error();
              if (prompt.type === "select" && (!Array.isArray(prompt.options) || prompt.options.length > 100 || !prompt.options.every((o) => typeof o.id === "string" && o.id.length <= 1024 && typeof o.label === "string" && o.label.length <= 1024))) throw new Error();
              flow.prompt = { promptId: message.promptId, type: prompt.type, ...(prompt.type === "select" ? { options: prompt.options.map(({ id, label }) => ({ id, label })) } : {}) }; flow.status = "awaiting_input";
            } else if (message.type === "notify") {
              const event = message.event;
              if (event.type === "auth_url") flow.event = { type: "auth_url", url: safeUrl(event.url) };
              else if (event.type === "device_code") {
                if (typeof event.userCode !== "string" || event.userCode.length > 256) throw new Error();
                flow.event = { type: "device_code", url: safeUrl(event.verificationUri), userCode: event.userCode };
              }
              if (!flow.prompt) flow.status = "waiting";
            }
          } catch { result = "failed"; child.kill("SIGKILL"); }
        });
        child.on("close", (code) => {
          clearTimeout(timer); flow.prompt = null; flow.event = null;
          finalStatus = timedOut ? "timed_out" : flow.status === "cancelling" ? "cancelled" : code === 0 ? result : "failed";
          resolve();
        });
        if (this.closing || flow.status === "cancelling") child.kill("SIGKILL");
        else child.send({ type: "begin" }, (error) => { if (error) child.kill("SIGKILL"); });
      });
    });
    const running = operation.then(() => { flow.status = finalStatus; }).catch((error) => { flow.status = flow.status === "cancelling" ? "cancelled" : "failed"; flow.prompt = null; flow.event = null; readyReject(error); }).finally(() => { if (this.running === running) { this.running = null; this.child = null; } });
    this.running = running;
    // Await account validation without waiting for the external login interaction.
    await ready;
    return this.snapshot(flow.flowId);
  }
  answer(flowId, promptId, value) {
    const flow = this.flow;
    if (!flow || flow.flowId !== flowId || flow.status !== "awaiting_input" || flow.prompt?.promptId !== promptId || !this.child?.connected) throw hostError("ACCOUNT_AUTH_FLOW_EXPIRED", 409);
    if (typeof value !== "string" || !value || value.length > 16384 || (flow.prompt.type === "select" && !flow.prompt.options.some((o) => o.id === value))) throw hostError("ACCOUNT_INPUT_INVALID");
    const child = this.child;
    child.send({ type: "answer", promptId, value }, (error) => { if (error) child.kill("SIGKILL"); });
    flow.prompt = null; flow.status = "waiting";
    return this.snapshot(flowId);
  }
  async cancel(flowId) {
    this.snapshot(flowId);
    if (this.running) {
      this.flow.status = "cancelling"; this.flow.prompt = null; this.flow.event = null;
      this.child?.kill("SIGKILL");
      await this.running.catch(() => {});
    }
    return this.snapshot(flowId);
  }
  async stop() {
    this.closing = true;
    if (this.flow && this.running) this.flow.status = "cancelling";
    const children = [...this.children];
    await Promise.all(children.map((child) => new Promise((resolve) => { child.once("close", resolve); child.kill("SIGKILL"); })));
    await this.running?.catch(() => {});
  }
}
