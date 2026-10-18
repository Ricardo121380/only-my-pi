import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { accountWorkerEnvironment } from "./models.mjs";
import { buildDirectPiInvocation, resolveDirectExtensionSet } from "../direct-agent/launcher.mjs";
import { processIdentity, groupAlive } from "./ownership.mjs";
import { hostError } from "./contracts.mjs";
import { ApprovalBridge } from "./approval-bridge.mjs";
import { projectControlState } from "./control-state.mjs";
import { INPUT_PROTOCOL, validateDeliveryRecord, validateReceipt } from "./input-protocol.mjs";
import { usesNativePiTools } from "../upstream-compatibility/native-pi.mjs";
function waitBounded(promise, ms, required = false) {
  let timer;
  return Promise.race([promise, new Promise((resolve, reject) => { timer = setTimeout(() => required ? reject(hostError("RPC_TERMINATION_UNCONFIRMED")) : resolve(), ms); })]).finally(() => clearTimeout(timer));
}

export class RpcWorker extends EventEmitter {
  constructor({ stack, configRoot, cwd, model, sessionRoot, resumeFile, accountId, taskId, controlled = false, mcpSnapshot, classifierSnapshot, env = process.env, onIdentity = async () => {}, spawnImpl = spawn, extensionResolver = resolveDirectExtensionSet }) {
    super(); Object.assign(this, { stack, configRoot, cwd, model, sessionRoot, accountId, taskId, controlled, env, onIdentity, spawnImpl, extensionResolver }); this.pending = new Map(); this.inputPending = new Map(); this.inputRecords = new Map(); this.child = null; this.stopping = null;
    this.approvals = new ApprovalBridge({ send: (frame) => { if (this.child && !this.closed && !this.child.stdin.destroyed) this.child.stdin.write(JSON.stringify(frame) + "\n"); }, publish: (approvals) => this.emit("approvals", approvals) });
    this.resumeFile = resumeFile;
    this.classifierSnapshot = classifierSnapshot; this.mcpSnapshot = mcpSnapshot; this.mcpEnabled = mcpSnapshot?.servers.some((server) => server.enabled) === true;
    this.codemodeEnabled = accountId !== undefined;
  }
  async start() {
    if (this.controlled && !this.accountId) throw hostError("ACCOUNT_BINDING_REQUIRED");
    this.codemodeEnabled &&= typeof this.stack.root === "string" && await fs.readFile(path.join(this.stack.root, "pi/package.json"), "utf8").then((raw) => usesNativePiTools(JSON.parse(raw).version), () => false);
    const set = await this.extensionResolver({ stack: this.stack, configRoot: this.configRoot, headless: !this.controlled });
    const invocation = buildDirectPiInvocation({ stack: this.stack, extensionPaths: set.extensions, runtimeOwner: "host",
      argv: ["--mode", "rpc", "--model", this.model, "--session-dir", this.sessionRoot], env: { ...(this.accountId === undefined ? this.env : accountWorkerEnvironment(this.env)), PI_CODING_AGENT_DIR: this.configRoot } });
    if (this.stopRequested) throw hostError("RPC_CANCELLED_BEFORE_START");
    const argv = this.accountId === undefined ? invocation.argv.slice(1) : [fileURLToPath(new URL("./account-rpc-entry.mjs", import.meta.url)), this.stack.root, this.configRoot, this.accountId, this.model, this.sessionRoot, this.controlled ? "controlled" : "readonly", this.resumeFile ?? "", ...set.extensions];
    const childEnv = { ...invocation.env }; delete childEnv.OMP_HOST_INPUT_TASK_ID;
    delete childEnv.OMP_HOST_MCP_SNAPSHOT; delete childEnv.OMP_HOST_CLASSIFIER_SNAPSHOT;
    if (this.accountId && this.classifierSnapshot) childEnv.OMP_HOST_CLASSIFIER_SNAPSHOT = JSON.stringify(this.classifierSnapshot);
    if (this.accountId && this.mcpSnapshot) childEnv.OMP_HOST_MCP_SNAPSHOT = JSON.stringify(this.mcpSnapshot);
    if (this.accountId && this.taskId) childEnv.OMP_HOST_INPUT_TASK_ID = this.taskId;
    const child = this.spawnImpl(invocation.executable, argv, { cwd: this.cwd, env: childEnv, detached: true, stdio: this.controlled || this.accountId !== undefined ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"] });
    this.child = child;
    child.on("message", (message) => {
      if (message?.type === "mcp_initialized") this.mcpInitialized = message;
      if (this.controlled && message?.type === "control_state" && !this.closed && !this.stopRequested) this.emit("control", projectControlState(message.state));
      if (this.controlled && message?.type === "shutdown_confirmed" && message.id === this.shutdownId && message.clean === true) this.shutdownConfirmed = true;
      if (message?.type === "omp_input_ready" && message.protocol === INPUT_PROTOCOL && message.taskId === this.taskId) this.inputReady = true;
      if (message?.type === "omp_input_candidate" && message.protocol === INPUT_PROTOCOL && !this.closed) {
        const record = this.inputRecords.get(message.receipt?.inputId);
        try { if (!record) throw hostError("INPUT_RECEIPT_CONFLICT"); this.emit("input", validateReceipt(message.receipt, record)); }
        catch { this.emit("fault", { code: "INPUT_RECEIPT_CONFLICT" }); }
      }
      if (message?.type === "omp_input_fault") this.emit("fault", { code: "INPUT_DELIVERY_FAILED" });
      if (message?.type === "omp_input_response" && this.inputPending.has(message.id)) {
        const waiter = this.inputPending.get(message.id); this.inputPending.delete(message.id); clearTimeout(waiter.timeout);
        if (message.protocol === INPUT_PROTOCOL && message.success === false && ["TASK_NOT_RUNNING", "INPUT_BINDING_CHANGED", "INPUT_ID_CONFLICT", "INPUT_STATE_INVALID", "INPUT_QUEUE_LIMIT"].includes(message.code)) { waiter.reject(hostError(message.code, 409)); return; }
        try {
          if (message.protocol !== INPUT_PROTOCOL || message.success !== true || !["accepted", "consumed", "unknown"].includes(message.data?.status)) throw hostError("INPUT_DELIVERY_UNCONFIRMED");
          if (message.data.feedback && (message.data.feedback.source !== "omp-custom-message" || message.data.feedback.disposition !== (waiter.record.delivery === "steer" ? "queued" : "started"))) throw hostError("INPUT_DELIVERY_UNCONFIRMED");
          if (message.data.status === "consumed") validateReceipt(message.data.receipt, waiter.record);
          waiter.resolve(message.data);
        } catch { waiter.reject(hostError("INPUT_DELIVERY_UNCONFIRMED")); }
      }
    });
    this.exited = new Promise((resolve) => child.once("close", (code, signal) => { this.closed = true; this.approvals.close(); for (const p of [...this.pending.values(), ...this.inputPending.values()]) { clearTimeout(p.timeout); p.reject(hostError("RPC_WORKER_EXITED")); } this.pending.clear(); this.inputPending.clear(); this.emit("exit", { code, signal }); resolve({ code, signal }); }));
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
          if ((this.controlled || (value.method === "select" && (this.mcpEnabled && value.title?.startsWith("MCP · ") || this.codemodeEnabled && value.title?.startsWith("Codemode · ")))) && !this.stopRequested) {
            try { this.approvals.request(value); } catch { this.emit("fault", { code: "APPROVAL_REQUEST_INVALID" }); void this.stop().catch(() => {}); }
          } else if (value.id) child.stdin.write(JSON.stringify({ type: "extension_ui_response", id: value.id, cancelled: true }) + "\n");
        } else this.emit("event", value);
      }
    });
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    this.identity = { pid: child.pid, start: await processIdentity(child.pid) };
    if (!this.identity.start) throw hostError("RPC_WORKER_EXITED");
    await this.onIdentity(this.identity);
    this.state = await this.command("get_state");
    if (this.mcpEnabled && !this.mcpInitialized?.clean) throw hostError(this.mcpInitialized?.code ?? "MCP_START_UNCONFIRMED", 409);
    if (this.accountId && this.taskId && !this.inputReady) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.off("message", listener); reject(hostError("RPC_INPUT_UNAVAILABLE")); }, 3000);
        const listener = () => { if (this.inputReady) { clearTimeout(timer); child.off("message", listener); resolve(); } }; child.on("message", listener); listener();
      });
    }
    return this.state;
  }
  inputCommand(operation, value) {
    const record = structuredClone(validateDeliveryRecord(value));
    if (!this.inputReady || !this.child?.connected || this.closed || this.stopRequested || record.taskId !== this.taskId) return Promise.reject(hostError("RPC_INPUT_UNAVAILABLE"));
    const prior = this.inputRecords.get(record.inputId);
    if (prior && prior.contentDigest !== record.contentDigest) return Promise.reject(hostError("INPUT_ID_CONFLICT"));
    this.inputRecords.set(record.inputId, record);
    if (operation === "deliver" && record.delivery !== "steer") this.promptSent = true;
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.inputPending.delete(id); reject(hostError("INPUT_DELIVERY_UNCONFIRMED")); }, 5000);
      this.inputPending.set(id, { record, resolve, reject, timeout });
      this.child.send({ type: "omp_input_command", protocol: INPUT_PROTOCOL, id, operation, record }, (error) => { if (error && this.inputPending.delete(id)) { clearTimeout(timeout); reject(hostError("INPUT_DELIVERY_UNCONFIRMED")); } });
    });
  }
  deliverInput(record) { return this.inputCommand("deliver", record); }
  lookupInput(record) { return this.inputCommand("lookup", record); }
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
      // Failed MCP receipts retain ownership, but cannot suppress coding
      // revocation, stdin closure or identity-checked OS termination.
      if (this.mcpEnabled && this.child.connected && !this.closed) await this.mcpControl("mcp_prepare_shutdown").catch(() => {});
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
      if (this.mcpEnabled && !this.mcpStopConfirmed) throw hostError("RPC_TERMINATION_UNCONFIRMED");
      if (this.controlled && this.promptSent && !this.shutdownConfirmed) throw hostError("RPC_TERMINATION_UNCONFIRMED");
    })(); return this.stopping;
  }
  answerApproval(id, value) {
    if ((!this.controlled && !this.mcpEnabled && !this.codemodeEnabled) || this.stopRequested) throw hostError("APPROVAL_EXPIRED", 409);
    this.approvals.answer(id, value);
  }
  async revoke() {
    this.approvals.invalidate();
    if (!this.controlled && (this.mcpEnabled || this.codemodeEnabled)) {
      try { if (this.codemodeEnabled) await this.codemodeRevoke(); if (this.mcpEnabled) await this.mcpControl("mcp_revoke"); }
      catch (error) { await this.stop().catch(() => {}); throw error; }
      return;
    }
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
      if (this.mcpEnabled) await this.mcpControl("mcp_revoke");
    } catch (error) { await this.stop().catch(() => {}); throw error; }
    finally { clearTimeout(timer); child.off("message", listener); }
  }
  async mcpControl(type) {
    const child = this.child, id = randomUUID();
    if (!child?.connected || this.closed) throw hostError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
    let listener, timer;
    try {
      await new Promise((resolve, reject) => {
        listener = (message) => { if (message?.type === "mcp_stopped" && message.id === id) { if (message.clean === true) { this.mcpStopConfirmed = true; resolve(); } else reject(hostError("RPC_TERMINATION_UNCONFIRMED", 409)); } };
        child.on("message", listener); timer = setTimeout(() => reject(hostError("MCP_STOP_UNCONFIRMED", 503)), 4000);
        child.send({ type, id }, (error) => { if (error) reject(hostError("MCP_STOP_UNCONFIRMED", 503)); });
      });
    } finally { clearTimeout(timer); child.off("message", listener); }
  }
  async discoverMcp(name) {
    const child = this.child, id = randomUUID();
    if (!child?.connected || this.closed || this.stopRequested || this.identity?.start !== await processIdentity(child.pid)) throw hostError("MCP_DISCOVERY_UNAVAILABLE", 409);
    let listener, timer;
    try {
      await new Promise((resolve, reject) => {
        listener = (message) => { if (message?.type === "mcp_discovered" && message.id === id) message.clean === true ? resolve() : reject(hostError(message.code ?? "MCP_DISCOVERY_FAILED", 409)); };
        child.on("message", listener); timer = setTimeout(() => reject(hostError("MCP_DISCOVERY_UNCONFIRMED", 503)), 22000);
        child.send({ type: "mcp_discover", id, name }, (error) => { if (error) reject(hostError("MCP_DISCOVERY_UNCONFIRMED", 503)); });
      });
    } finally { clearTimeout(timer); child.off("message", listener); }
  }
  async codemodeRevoke() {
    const child = this.child, id = randomUUID();
    if (!child?.connected || this.closed) throw hostError("RPC_CONTROL_UNAVAILABLE", 409);
    let listener, timer;
    try {
      await new Promise((resolve, reject) => {
        listener = (message) => { if (message?.type === "codemode_revoked" && message.id === id) resolve(); };
        child.on("message", listener); timer = setTimeout(() => reject(hostError("RPC_REVOKE_UNCONFIRMED", 503)), 3000);
        child.send({ type: "codemode_revoke", id }, (error) => { if (error) reject(hostError("RPC_REVOKE_UNCONFIRMED", 503)); });
      });
    } finally { clearTimeout(timer); child.off("message", listener); }
  }
}
