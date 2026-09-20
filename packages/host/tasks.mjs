import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { atomicWriteJson, readJsonObject } from "../config-runtime/index.mjs";
import { RpcWorker } from "./rpc-worker.mjs";
import { acquireOwnership } from "./ownership.mjs";
import { hostError, terminal, textContent } from "./contracts.mjs";
import { projectPath } from "./inspector.mjs";

export class HostTasks extends EventEmitter {
  constructor({ configRoot, stack, catalog, models, workerFactory = (options) => new RpcWorker(options), env = process.env }) {
    super(); Object.assign(this, { configRoot, stack, catalog, models, workerFactory, env });
    this.tasks = new Map(); this.workers = new Map(); this.requests = new Map(); this.saving = Promise.resolve(); this.closing = false;
    this.running = new Map();
    this.file = path.join(configRoot, "only-my-pi/host/tasks.json");
  }
  async load() {
    const state = await readJsonObject(this.configRoot, this.file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (state && (!Array.isArray(state.tasks) || state.tasks.length > 1000)) throw hostError("TASK_STATE_INVALID");
    for (const task of state?.tasks ?? []) {
      if (!terminal(task.status)) { task.status = "interrupted"; task.error = "HOST_RESTARTED"; }
      task.worker = null;
      this.tasks.set(task.taskId, task); this.requests.set(task.requestId, task.taskId);
    }
    await this.persist();
  }
  summary(task) { return { taskId: task.taskId, requestId: task.requestId, projectId: task.projectId, model: task.model, prompt: task.prompt.slice(0, 200), status: task.status,
    sessionId: task.sessionId, createdAt: task.createdAt, updatedAt: task.updatedAt, error: task.error ?? null, tool: task.tool ?? null }; }
  public(task) { return structuredClone({ ...this.summary(task), prompt: task.prompt, partial: task.partial ?? "", messages: task.messages.slice(-50).map((m) => ({ ...m, text: m.text.slice(0, 16384) })) }); }
  snapshot() { return [...this.tasks.values()].slice(-100).map((t) => this.summary(t)); }
  persist() {
    const state = { version: 1, tasks: [...this.tasks.values()].map((t) => ({ ...t, prompt: t.prompt.slice(0, 512), partial: t.partial?.slice(0, 1024) ?? "", messages: t.messages.slice(-4).map((m) => ({ ...m, text: m.text.slice(0, 1024) })) })) };
    const copy = structuredClone(state);
    this.saving = this.saving.then(() => atomicWriteJson(this.configRoot, this.file, copy));
    return this.saving;
  }
  changed(task) {
    this.emit("change", this.public(task));
    if (!this.checkpoint) this.checkpoint = setTimeout(() => { this.checkpoint = null; void this.persist().catch(() => { this.persistenceError = true; }); }, 250);
  }
  async start(command) {
    if (this.closing) throw hostError("HOST_STOPPING", 409);
    if (this.persistenceError) throw hostError("HOST_STORAGE_FAILED", 503);
    const prior = this.requests.get(command.requestId);
    const requestDigest = createHash("sha256").update(JSON.stringify([command.projectId, command.model, command.prompt])).digest("hex");
    const existing = (id) => { const task = this.tasks.get(id); if (task.requestDigest !== requestDigest) throw hostError("REQUEST_ID_CONFLICT", 409); return this.public(task); };
    if (prior) return existing(prior);
    if (this.tasks.size >= 1000 || this.workers.size >= 4) throw hostError("TASK_CAPACITY_REACHED", 429);
    const project = this.catalog.project(command.projectId);
    if (!project.available) throw hostError("PROJECT_UNAVAILABLE", 409);
    if (!(await this.models()).some((m) => m.id === command.model)) throw hostError("MODEL_UNAVAILABLE", 409);
    if (this.requests.has(command.requestId)) return existing(this.requests.get(command.requestId));
    if (this.closing) throw hostError("HOST_STOPPING", 409);
    if ([...this.tasks.values()].filter((t) => !terminal(t.status)).length >= 4) throw hostError("TASK_CAPACITY_REACHED", 429);
    const task = { taskId: randomUUID(), requestId: command.requestId, requestDigest, projectId: project.projectId, model: command.model,
      prompt: command.prompt, status: "starting", sessionId: null, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.requests.set(command.requestId, task.taskId); this.tasks.set(task.taskId, task);
    await this.persist(); this.changed(task);
    const running = this.run(task, project).catch(async () => { task.status = "failed"; task.error = "TASK_INTERNAL_FAILURE"; this.changed(task); await this.persist().catch(() => {}); }).finally(() => this.running.delete(task.taskId));
    this.running.set(task.taskId, running);
    return this.public(task);
  }
  async run(task, project) {
    let lease;
    const sessionRoot = path.join(this.catalog.sessionRoot, `omp-${project.projectId}`);
    const worker = this.workerFactory({ stack: this.stack, configRoot: this.configRoot, cwd: project.path, model: task.model, sessionRoot, env: this.env,
      onIdentity: async (identity) => { task.worker = identity; await this.persist(); } });
    this.workers.set(task.taskId, worker);
    let settledResolve, failed = false, stopping = false;
    const settled = new Promise((resolve) => { settledResolve = resolve; });
    const deadline = setTimeout(() => { failed = true; task.error = "TASK_TIME_LIMIT"; settledResolve(); }, 15 * 60 * 1000);
    worker.on("event", (event) => {
      if (terminal(task.status)) return;
      if (event?.type === "message_end" && ["user", "assistant"].includes(event.message?.role)) {
        const message = event.message;
        task.messages.push({ id: randomUUID(), role: message.role, text: textContent(message.content) });
        task.partial = "";
        if (message.stopReason === "error") { failed = true; task.error = "MODEL_REQUEST_FAILED"; }
      } else if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        task.partial = ((task.partial ?? "") + event.assistantMessageEvent.delta).slice(0, 65536);
      } else if (event?.type === "tool_execution_start") {
        task.tool = { name: String(event.toolName).slice(0, 128), status: "running" };
      } else if (event?.type === "tool_execution_end") {
        task.messages.push({ id: randomUUID(), role: "toolResult", toolName: String(event.toolName).slice(0, 128), text: textContent(event.result?.content), isError: event.isError === true });
        task.tool = null;
      } else if (event?.type === "extension_error") { failed = true; task.error = "EXTENSION_FAILED"; settledResolve(); }
      else if (event?.type === "agent_settled") settledResolve();
      task.messages = task.messages.slice(-200);
      task.updatedAt = new Date().toISOString(); this.changed(task);
    });
    worker.on("fault", (e) => { failed = true; task.error = e.code; settledResolve(); });
    worker.on("exit", () => { if (!stopping && !terminal(task.status) && task.status !== "cancelling") { failed = true; task.error = "WORKER_EXITED"; } settledResolve(); });
    try {
      await projectPath(project);
      if (this.closing) { task.status = "cancelling"; throw hostError("HOST_STOPPING"); }
      const state = await worker.start();
      task.worker = worker.identity; task.sessionId = state.sessionId;
      lease = await acquireOwnership(this.configRoot, "session", String(state.sessionId));
      await this.persist();
      if (task.status === "cancelling" || this.closing) { stopping = true; await worker.cancel(); task.status = "cancelled"; return; }
      task.status = "running"; this.changed(task);
      await worker.command("prompt", { message: `只读分析请求。不要修改项目文件。\n\n${task.prompt}` });
      await settled;
      stopping = true;
      await worker.stop();
      task.status = task.status === "cancelling" ? "cancelled" : failed ? "failed" : "succeeded";
      if (task.status === "cancelled") task.error = null;
    } catch (error) { task.status = task.status === "cancelling" ? "cancelled" : "failed"; task.error = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "TASK_FAILED"; }
    finally {
      clearTimeout(deadline);
      stopping = true;
      try { await worker.stop(); task.worker = null; }
      catch { task.status = "failed"; task.error = "RPC_TERMINATION_UNCONFIRMED"; }
      if (!task.worker) try { await lease?.release(); } catch { task.status = "failed"; task.error = "SESSION_RELEASE_FAILED"; }
      this.workers.delete(task.taskId); task.updatedAt = new Date().toISOString(); this.changed(task); await this.persist();
      await this.catalog.scan().catch(() => {});
    }
  }
  async cancel(id) {
    const task = this.tasks.get(id); if (!task) throw hostError("TASK_NOT_FOUND", 404);
    if (terminal(task.status)) return this.public(task);
    task.status = "cancelling"; this.changed(task); await this.persist();
    const worker = this.workers.get(id);
    if (worker?.identity) void worker.cancel().catch(() => { if (!terminal(task.status)) task.error = "RPC_TERMINATION_UNCONFIRMED"; });
    return this.public(task);
  }
  async stop() {
    this.closing = true;
    for (const task of this.tasks.values()) if (!terminal(task.status)) await this.cancel(task.taskId);
    await Promise.all([...this.workers.values()].map((w) => w.stop()));
    await Promise.all([...this.running.values()]);
    clearTimeout(this.checkpoint); this.checkpoint = null;
    await this.saving;
  }
}
