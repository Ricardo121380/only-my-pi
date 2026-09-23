import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { accountWorkerEnvironment } from "./models.mjs";
import { buildDirectPiInvocation, resolveDirectExtensionSet } from "../direct-agent/launcher.mjs";
import { processIdentity, groupAlive } from "./ownership.mjs";
import { hostError } from "./contracts.mjs";
import { ApprovalBridge } from "./approval-bridge.mjs";
import { projectControlState } from "./control-state.mjs";
function waitBounded(promise, ms, required = false) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => required ? reject(hostError("RPC_TERMINATION_UNCONFIRMED")) : resolve(), ms); })]).finally(() => clearTimeout(timer));
}

export class RpcWorker extends EventEmitter {
  constructor({ stack, configRoot, cwd, model, sessionRoot, resumeFile, accountId, controlled = false, env = process.env, onIdentity = async () => {}, spawnImpl = spawn, extensionResolver = resolveDirectExtensionSet }) {
    super(); Object.assign(this, { stack, configRoot, cwd, model, sessionRoot, accountId, controlled, env, onIdentity, spawnImpl, extensionResolver }); this.pending = new Map(); this.child = null; this.stopping = null;
    this.approvals = new ApprovalBridge({ send: (frame) => { if (this.child && !this.closed && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(frame) + "\n"); }, publish: (approvals) => this.emit("approvals", approvals) });
    this.resumeFile = resumeFile;
  }
  async start() {
    if (this.controlled && !this.accountId) throw hostError("ACCOUNT_BINDING_REQUIRED");
    const set = await this.extensionResolver({ stack: this.stack, configRoot: this.configRoot, headless: !this.controlled });
    const invocation = buildDirectPiInvocation({ stack: this.stack, extensionPaths: set.extensions, runtimeOwner: "host",
      argv: ["--mode", "rpc", "--model", this.model, "--session-dir", this.sessionRoot], env: { ...(this.accountId === undefined ? this.env : accountWorkerEnvironment(this.env)), PI_CODING_AGENT_DIR: this.configRoot } });
    if (this.stopRequested) throw hostError("RPC_CANCELLED_BEFORE_START");
    const argv = this.accountId === undefined ? invocation.argv.slice(1) : [fileURLToPath(new URL("./account-rpc-entry.mjs", import.meta.url)), this.stack.root, this.configRoot, this.accountId, this.model, this.sessionRoot, this.controlled ? "controlled" : "readonly", this.resumeFile ?? "", ...set.extensions];
    const child = this.spawnImpl(invocation.executable, argv, { cwd: this.cwd, env: invocation.env, detached: true, stdio: this.controlled ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"] });
    this.child = child;
    if (this.controlled) child.on("message", (message) => {
      if (message?.type === "control_state" && !this.closed && !this.stopRequested) this.emit("control", projectControlState(message.state));
      if (message?.type === "shutdown_confirmed" && message.id === this.shutdownId && message.clean === true) this.shutdownConfirmed = true;
    });
    this.exited = new Promise((resolve) => child.once("close", (code, signal) => { this.closed = true; this.approvals.close(); for (const p of this.pending.values()) { clearTimeout(p.timeout); p.reject(hostError("RPC_WORKER_EXITED")); } this.pending.clear(); this.emit("exit", { code, signal }); resolve({ code, signal }); }));
    child.on("error", () => this.emit("fault", { code: "RPC_SPAWN_FAILED" }));
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => {}); // Never forward raw provider/extension errors or secrets.
    const decoder = new StringDecoder("utf8"); let pending = "";
    child.stdout.on("data", (bytes) => {
      pending += decoder.write(bytes);
      if (Buffer.byteLength(pending) > 8 * 1024 * 1024) { this.emit("fault", { code: "RPC_OUTPUT_LIMIT" }); void this.stop().catch(() => {}); return; }
      let index;
      while ((index = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let value; try { value = JSON.parse(line); if (!value || typeof value !== "object" || typeof value.type !== "string") throw new Error(); } catch { this.emit("fault", { code: "RPC_FRAME_INVALID" }); void this.stop().catch(() => {}); return; }
        if (value?.type === "response" && this.pending.has(value.id)) {
          const waiter = this.pending.get(value.id); this.pending.delete(value.id); clearTimeout(waiter.timeout);
          if (value.success === true && value.command === waiter.type) waiter.resolve(value.data); else waiter.reject(hostError("RPC_COMMAND_REJECTED"));
        } else if (value?.type === "extension_ui_request") {
          if (this.controlled && !this.stopRequested) {
            try { this.approvals.request(value); } catch { this.emit("fault", { code: "APPROVAL_REQUEST_INVALID" }); void this.stop().catch(() => {}); }
          } else if (value.id) child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: value.id, cancelled: true }) + "\n");
        } else this.emit("event", value);
      }
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    this.identity = { pid: child.pid, start: await processIdentity(child.pid) };
    if (!this.identity.start) throw hostError("RPC_WORKER_EXITED");
    await this.onIdentity(this.identity);
    this.state = await this.command("get_state"); return this.state;
  }
  command(type, fields = {}) {
    if (!["get_state", "set_thinking_level", "prompt", "abort", "clear_queue"].includes(type) || !this.child || this.closed) return Promise.reject(hostError("RPC_COMMAND_DENIED"));
    const id = randomUUID();
    if (type === "prompt") this.promptSent = true;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(hostError("RPC_COMMAND_TIMEOUT")); }, 30000);
      this.pending.set(id, { resolve, reject, timeout, type });
      this.child.stdin.write(JSON.stringify({ ...fields, id, type }) + "\n");
    });
  }
  cancel() {
    this.approvals.close();
    this.cancelling ??= (async () => { try { if (!this.closed) { await this.command("clear_queue"); await this.command("abort"); } } finally { await this.stop(); } })();
    return this.cancelling;
  }
  stop() {
    this.stopRequested = true;
    this.approvals.close();
    this.stopping ??= (async () => {
      if (!this.child) return;
      if (this.controlled && this.child.connected && !this.closed) {
        this.shutdownId = randomUUID();
        await waitBounded(new Promise((resolve) => this.child.send({ type: "prepare_shutdown", id: this.shutdownId }, () => resolve())), 500);
      }
      if (!this.closed) this.child.stdin.end();
      await waitBounded(this.exited, 500);
      const pid = this.child.pid;
      const signalGroup = async (signal) => {
        if (!pid || !groupAlive(pid)) return;
        // Never signal a recycled PID or an unidentifiable orphan group.
        if (!this.identity?.start || await processIdentity(pid) !== this.identity.start) throw hostError("RPC_TERMINATION_UNCONFIRMED");
        try { process.kill(-pid, signal); } catch (e) { if (e.code !== "ESRCH") throw e; }
      };
      await signalGroup("SIGTERM");
      await waitBounded(this.exited, 500);
      await signalGroup("SIGKILL");
      await waitBounded(this.exited, 2000, true);
      if (pid && groupAlive(pid)) throw hostError("RPC_TERMINATION_UNCONFIRMED");
      if (this.controlled && this.promptSent && !this.shutdownConfirmed) throw hostError("RPC_TERMINATION_UNCONFIRMED");
    })(); return this.stopping;
  }
  answerApproval(id, value) {
    if (!this.controlled || this.stopRequested) throw hostError("APPROVAL_EXPIRED", 409);
    this.approvals.answer(id, value);
  }
  async revoke() {
    this.approvals.invalidate();
    if (!this.controlled || !this.child?.connected || this.closed) throw hostError("RPC_CONTROL_UNAVAILABLE", 409);
    const id = randomUUID(), child = this.child;
    let listener, timer;
    try {
      await new Promise((resolve, reject) => {
        listener = (message) => { if (message?.type === "revoked" && message.id === id) resolve(); };
        child.on("message", listener);
        timer = setTimeout(() => reject(hostError("RPC_REVOKE_UNCONFIRMED", 503)), 3000);
        child.send({ type: "revoke", id }, (error) => { if (error) reject(hostError("RPC_REVOKE_UNCONFIRMED", 503)); });
      });
    } catch (error) { await this.stop(); throw error; }
    finally { clearTimeout(timer); child.off("message", listener); }
  }
}
