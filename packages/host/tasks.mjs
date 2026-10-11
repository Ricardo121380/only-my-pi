import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { atomicWriteJson, readJsonObject } from "../config-runtime/index.mjs";
import { RpcWorker } from "./rpc-worker.mjs";
import { acquireOwnership, groupAlive } from "./ownership.mjs";
import { hostError, terminal, textContent, CLI_ACCOUNT_ID } from "./contracts.mjs";
import { projectPath } from "./inspector.mjs";
import { emptyUsage, recordUsage } from "./usage.mjs";
import { INPUT_CARRIER } from "./input-protocol.mjs";
import { supportsThinking } from "./models.mjs";
import { McpCatalog } from "../mcp/catalog.mjs";

const duration = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? { durationMs: value } : {};

export class HostTasks extends EventEmitter {
  constructor({ configRoot, stack, catalog, models, accounts, allowControlled = false, workerFactory = (options) => new RpcWorker(options), env = process.env }) {
    super(); Object.assign(this, { configRoot, stack, catalog, models, accounts, allowControlled, workerFactory, env });
    this.models = models;
    this.tasks = new Map(); this.workers = new Map(); this.requests = new Map(); this.saving = Promise.resolve(); this.closing = false;
    this.running = new Map();
    this.accountReleases = new Map();
    this.leases = new Map();
    this.projectLeases = new Map();
    this.file = path.join(configRoot, "only-my-pi/host/tasks.json");
  }
  async load() {
    const state = await readJsonObject(this.configRoot, this.file).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (state && (!Array.isArray(state.tasks) || state.tasks.length > 1000)) throw hostError("TASK_STATE_INVALID");
    for (const task of state?.tasks ?? []) {
      if (task.mode === "controlled" && task.worker) throw hostError("CONTROLLED_ORPHAN_REQUIRES_RECONCILIATION", 409);
      if (task.worker && (!Number.isSafeInteger(task.worker.pid) || task.worker.pid < 1 || groupAlive(task.worker.pid))) throw hostError("WORKER_RECONCILIATION_REQUIRED", 409);
      if (task.error === "RPC_TERMINATION_UNCONFIRMED" && !task.worker) throw hostError("WORKER_RECONCILIATION_REQUIRED", 409);
      if (!terminal(task.status)) { task.status = "interrupted"; task.error = "HOST_RESTARTED"; }
      task.approvals = []; task.access = "inspect";
      for (const call of task.toolCalls ?? []) if (call.status === "running") { call.status = "unknown"; call.error = "HOST_RESTARTED"; }
      task.worker = null;
      this.tasks.set(task.taskId, task); this.requests.set(task.requestId, task.taskId);
    }
    await this.persist();
  }
  summary(task) { return { taskId: task.taskId, requestId: task.requestId, projectId: task.projectId, accountId: task.accountId ?? null, model: task.model, prompt: task.prompt.slice(0, 200), status: task.status,
    ...(task.mcpSnapshot ? { mcp: { protocol: 1, revision: task.mcpSnapshot.revision, enabled: task.mcpSnapshot.servers.some((server) => server.enabled) } } : {}),
    ...(task.codemode ? { codemode: task.codemode } : {}), toolCalls: task.toolCalls ?? [],
    thinkingLevel: task.thinkingLevel ?? null, requestedThinkingLevel: task.requestedThinkingLevel ?? null, usage: task.usage ?? null,
    mode: task.mode ?? "readonly", access: task.access ?? "inspect", approvals: task.approvals ?? [], orchestration: task.orchestration ?? null, sessionId: task.sessionId, settlement: task.settlement ?? null, inputFeedback: task.inputFeedback ?? null, ...(task.inputId ? { inputId: task.inputId, originDraftInputId: task.originDraftInputId, originDraftSessionId: task.originDraftSessionId } : {}), createdAt: task.createdAt, updatedAt: task.updatedAt, error: task.error ?? null, tool: task.tool ?? null }; }
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
  /** @param {any} command @param {{inputRecord?: import('./contracts.d.ts').InputRecordV1; beforeRun?: (task: any) => Promise<import('./contracts.d.ts').InputRecordV1 | undefined>; submission?: {inputId:string; originDraftInputId:string; originDraftSessionId:string|null}; beforePrompt?: (task: any) => Promise<import('./contracts.d.ts').InputRecordV1>}} [options] */
  async start(command, { inputRecord, beforeRun, submission, beforePrompt } = {}) {
    const mode = command.mode ?? "readonly";
    if (!["readonly", "controlled"].includes(mode) || (mode === "controlled" && !this.allowControlled)) throw hostError("CONTROLLED_MODE_UNAVAILABLE", 409);
    if (this.accounts && (typeof command.accountId !== "string" || !command.accountId)) throw hostError("ACCOUNT_BINDING_REQUIRED", 409);
    if (!this.accounts && command.accountId !== undefined) throw hostError("ACCOUNT_BINDING_UNAVAILABLE", 409);
    if (this.closing) throw hostError("HOST_STOPPING", 409);
    if (this.persistenceError) throw hostError("HOST_STORAGE_FAILED", 503);
    const prior = this.requests.get(command.requestId);
    const requestDigest = createHash("sha256").update(JSON.stringify([command.projectId, command.model, command.prompt, ...(this.accounts ? [command.accountId] : []), ...(mode === "controlled" ? [mode] : []), ...(command.resumeSessionKey ? [command.resumeSessionKey] : []), ...(command.thinkingLevel !== undefined ? [{ thinkingLevel: command.thinkingLevel }] : []), ...(inputRecord ? [inputRecord.contentDigest] : []), ...(submission ? [submission.inputId, submission.originDraftInputId, submission.originDraftSessionId] : [])])).digest("hex");
    const existing = (id) => { const task = this.tasks.get(id); if (task.requestDigest !== requestDigest) throw hostError("REQUEST_ID_CONFLICT", 409); return this.public(task); };
    if (prior) return existing(prior);
    if (this.tasks.size >= 1000 || this.workers.size >= 4) throw hostError("TASK_CAPACITY_REACHED", 429);
    const project = this.catalog.project(command.projectId);
    if (!project.available) throw hostError("PROJECT_UNAVAILABLE", 409);
    const resume = command.resumeSessionKey ? await this.catalog.resume(command.resumeSessionKey, project.projectId) : null;
    if (resume && [...this.tasks.values()].some((task) => task.sessionId === resume.sessionId && (!terminal(task.status) || task.worker))) throw hostError("SESSION_IN_USE", 409);
    const release = this.accounts?.beginUse(command.accountId);
    let transferred = false;
    try {
    if (this.accounts && command.accountId !== CLI_ACCOUNT_ID) {
      const account = await this.accounts.get(command.accountId);
      if (!command.model.startsWith(`${account.providerId}/`)) throw hostError("ACCOUNT_MODEL_MISMATCH", 409);
    }
    const model = (await this.models(command.accountId)).find((m) => m.id === command.model);
    if (!model) throw hostError("MODEL_UNAVAILABLE", 409);
    if (command.thinkingLevel !== undefined && !supportsThinking(model, command.thinkingLevel)) throw hostError("THINKING_LEVEL_UNAVAILABLE", 409);
    const mcpSnapshot = await new McpCatalog(this.configRoot).snapshot(project.path);
    if (this.requests.has(command.requestId)) return existing(this.requests.get(command.requestId));
    if (this.closing) throw hostError("HOST_STOPPING", 409);
    if ([...this.tasks.values()].filter((t) => !terminal(t.status)).length >= 4) throw hostError("TASK_CAPACITY_REACHED", 429);
    const task = { taskId: randomUUID(), requestId: command.requestId, requestDigest, projectId: project.projectId, model: command.model, ...(this.accounts ? { accountId: command.accountId } : {}),
      requestedThinkingLevel: command.thinkingLevel ?? null, thinkingLevel: null, usage: emptyUsage(),
      mode, mcpSnapshot, access: "inspect", approvals: [], resourceRevision: inputRecord?.binding.resourceRevision ?? 0, ...(submission ?? {}), prompt: command.prompt, status: "starting", sessionId: resume?.sessionId ?? null, resumeSessionKey: command.resumeSessionKey ?? null, messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    this.requests.set(command.requestId, task.taskId); this.tasks.set(task.taskId, task);
    try { await this.persist(); }
    catch {
      this.persistenceError = true;
      this.requests.delete(command.requestId); this.tasks.delete(task.taskId);
      throw hostError("HOST_STORAGE_FAILED", 503);
    }
    if (release) { this.accountReleases.set(task.taskId, release); transferred = true; }
    if (beforeRun) {
      try { inputRecord = await beforeRun(task); if (!inputRecord || inputRecord.taskId !== task.taskId || inputRecord.state !== "dispatching") throw hostError("INPUT_STATE_INVALID"); }
      catch (error) {
        task.status = "failed"; task.error = "INPUT_ADMISSION_FAILED";
        this.accountReleases.get(task.taskId)?.(); this.accountReleases.delete(task.taskId);
        await this.persist(); this.changed(task); throw error;
      }
    }
    this.changed(task);
    const running = this.run(task, project, resume, inputRecord, beforePrompt).catch(async () => { task.status = "failed"; task.error = "TASK_INTERNAL_FAILURE"; this.changed(task); await this.persist().catch(() => {}); }).finally(() => this.running.delete(task.taskId));
    this.running.set(task.taskId, running);
    return this.public(task);
    } finally { if (!transferred) release?.(); }
  }
  async recordInputFeedback(taskId, inputId, feedback) {
    if (!feedback) return;
    const task = this.tasks.get(taskId);
    if (!task || !["pi-prompt", "omp-custom-message"].includes(feedback.source) || !["handled", "queued", "started"].includes(feedback.disposition)) throw hostError("INPUT_DELIVERY_UNCONFIRMED");
    task.inputFeedback ??= [];
    const prior = task.inputFeedback.find(item => item.inputId === inputId);
    if (prior && (prior.source !== feedback.source || prior.disposition !== feedback.disposition)) throw hostError("INPUT_RECEIPT_CONFLICT");
    if (!prior) task.inputFeedback.push({ inputId, source: feedback.source, disposition: feedback.disposition });
    await this.persist(); this.changed(task);
  }
  async run(task, project, resume = null, inputRecord, beforePrompt) {
    let lease;
    const sessionRoot = path.join(this.catalog.sessionRoot, `omp-${project.projectId}`);
    let worker;
    try {
      worker = this.workerFactory({ stack: this.stack, configRoot: this.configRoot, cwd: project.path, model: task.model, taskId: task.taskId, accountId: task.accountId, controlled: task.mode === "controlled", mcpSnapshot: task.mcpSnapshot, sessionRoot, resumeFile: resume?.file, env: this.env,
        onIdentity: async (identity) => { task.worker = identity; await this.persist(); } });
    } catch (error) { this.accountReleases.get(task.taskId)?.(); this.accountReleases.delete(task.taskId); throw error; }
    this.workers.set(task.taskId, worker);
    let settledResolve, failed = false, aborted = false, stopping = false;
    const settled = new Promise((resolve) => { settledResolve = resolve; });
    const deadline = setTimeout(() => { failed = true; task.error = "TASK_TIME_LIMIT"; settledResolve(); }, 15 * 60 * 1000);
    worker.on("approvals", (approvals) => { task.approvals = terminal(task.status) || task.status === "cancelling" ? [] : approvals; this.changed(task); });
    worker.on("control", (state) => {
      if (terminal(task.status) || task.status === "cancelling") return;
      task.access = state.access; task.orchestration = state.orchestration; this.changed(task);
    });
    worker.on("input", (receipt) => this.emit("input", { taskId: task.taskId, receipt }));
    worker.on("event", (event) => {
      if (terminal(task.status)) return;
      if (event?.type === "message_end" && (["user", "assistant"].includes(event.message?.role) || (event.message?.role === "custom" && event.message.customType === INPUT_CARRIER))) {
        const message = event.message.role === "custom" ? { ...event.message, role: "user" } : event.message;
        if (message.role === "assistant") recordUsage(task.usage, message);
        task.messages.push({ id: randomUUID(), role: message.role, text: textContent(message.content), ...duration(message.durationMs), ...(message.role === "assistant" ? { stopReason: message.stopReason ?? null } : {}) });
        if (message.stopReason === "aborted") aborted = true;
        task.partial = "";
        if (message.stopReason === "error") { failed = true; task.error = "MODEL_REQUEST_FAILED"; }
      } else if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        task.partial = ((task.partial ?? "") + event.assistantMessageEvent.delta).slice(0, 65536);
      } else if (event?.type === "tool_execution_start") {
        task.usage.tools++;
        task.tool = { name: String(event.toolName).slice(0, 128), status: "running" };
        task.toolCalls ??= [];
        if (typeof event.toolCallId === "string" && !task.toolCalls.some((call) => call.toolCallId === event.toolCallId)) {
          task.toolCalls.push({ toolCallId: event.toolCallId.slice(0, 256), parentToolCallId: typeof event.parentToolCallId === "string" ? event.parentToolCallId.slice(0, 256) : null, name: String(event.toolName).slice(0, 128), status: "running", startedAt: new Date().toISOString() });
          task.toolCalls = task.toolCalls.slice(-128);
        }
      } else if (event?.type === "tool_execution_end") {
        const call = task.toolCalls?.find((item) => item.toolCallId === event.toolCallId);
        if (call) Object.assign(call, { status: event.result?.details?.status === "unknown" ? "unknown" : event.result?.details?.code === "CODEMODE_CANCELLED" ? "cancelled" : event.isError ? "failed" : "completed", completedAt: new Date().toISOString(), result: textContent(event.result?.content).slice(0, 16384), ...duration(event.durationMs) });
        if (event.toolName === "request_coding_access" && event.result?.details?.status === "CODING_ACCESS_GRANTED" && !event.isError) task.access = "coding";
        task.messages.push({ id: randomUUID(), role: "toolResult", toolName: String(event.toolName).slice(0, 128), text: textContent(event.result?.content), isError: event.isError === true, ...duration(event.durationMs) });
        task.tool = null;
      } else if (event?.type === "extension_error") { failed = true; task.error = "EXTENSION_FAILED"; settledResolve(); }
      else if (event?.type === "agent_settled") {
        if (typeof event.aborted === "boolean") { task.settlement = { aborted: event.aborted }; aborted ||= event.aborted; }
        settledResolve();
      }
      task.messages = task.messages.slice(-200);
      task.updatedAt = new Date().toISOString(); this.changed(task);
    });
    worker.on("fault", (e) => { failed = true; task.error = e.code; settledResolve(); });
    worker.on("exit", () => { if (!stopping && !terminal(task.status) && task.status !== "cancelling") { failed = true; task.error = "WORKER_EXITED"; } settledResolve(); });
    try {
      await projectPath(project);
      if (task.mode === "controlled") {
        const projectLease = await acquireOwnership(this.configRoot, "project", project.path);
        this.projectLeases.set(task.taskId, projectLease);
        task.projectPath = project.path; task.projectOwnerToken = projectLease.owner.token;
        await this.persist();
      }
      if (this.closing) { task.status = "cancelling"; throw hostError("HOST_STOPPING"); }
      if (resume) {
        lease = await acquireOwnership(this.configRoot, "session", resume.sessionId);
        this.leases.set(task.taskId, lease);
        const current = await this.catalog.resume(task.resumeSessionKey, task.projectId);
        if (current.sessionId !== resume.sessionId || current.file !== resume.file) throw hostError("SESSION_IDENTITY_CHANGED", 409);
      }
      const state = await worker.start();
      if (worker.codemodeEnabled) task.codemode = { enabled: true, classifier: false, image: false };
      if (resume && state.sessionId !== resume.sessionId) throw hostError("SESSION_IDENTITY_CHANGED", 409);
      task.worker = worker.identity; task.sessionId = state.sessionId;
      lease ??= await acquireOwnership(this.configRoot, "session", String(state.sessionId));
      this.leases.set(task.taskId, lease);
      await this.persist();
      if (task.status === "cancelling" || this.closing) { stopping = true; await worker.cancel(); task.status = "cancelled"; return; }
      if (task.requestedThinkingLevel !== null) {
        await worker.command("set_thinking_level", { level: task.requestedThinkingLevel });
        const effective = await worker.command("get_state");
        if (effective.thinkingLevel !== task.requestedThinkingLevel) throw hostError("THINKING_LEVEL_MISMATCH", 409);
        task.thinkingLevel = effective.thinkingLevel;
      } else task.thinkingLevel = state.thinkingLevel ?? null;
      if (task.status === "cancelling" || this.closing) { stopping = true; await worker.cancel(); task.status = "cancelled"; return; }
      if (beforePrompt) {
        inputRecord = await beforePrompt(task);
        if (!inputRecord || inputRecord.taskId !== task.taskId || inputRecord.sessionId !== task.sessionId || inputRecord.state !== "dispatching") throw hostError("INPUT_STATE_INVALID");
      }
      if (task.status === "cancelling" || this.closing) { stopping = true; await worker.cancel(); task.status = "cancelled"; return; }
      task.status = "running"; this.changed(task);
      if (inputRecord) {
        const response = await worker.deliverInput(inputRecord);
        if (!["accepted", "consumed"].includes(response?.status)) throw hostError("INPUT_DELIVERY_UNCONFIRMED");
        await this.recordInputFeedback(task.taskId, inputRecord.inputId, response.feedback);
        this.emit("inputAccepted", { taskId: task.taskId, inputId: inputRecord.inputId });
      } else {
        const response = await worker.command("prompt", { message: task.mode === "controlled" ? task.prompt : `只读分析请求。不要修改项目文件。\n\n${task.prompt}` });
        if (response?.disposition !== undefined) {
          await this.recordInputFeedback(task.taskId, null, { source: "pi-prompt", disposition: response.disposition });
          if (response.disposition === "handled") settledResolve();
        }
      }
      await settled;
      stopping = true;
      await worker.stop();
      task.status = task.status === "cancelling" || aborted ? "cancelled" : failed ? "failed" : "succeeded";
      if (task.status === "cancelled") task.error = null;
    } catch (error) { task.status = task.status === "cancelling" ? "cancelled" : "failed"; task.error = /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "TASK_FAILED"; }
    finally {
      clearTimeout(deadline);
      stopping = true;
      let terminationConfirmed = false;
      try { await worker.stop(); task.worker = null; terminationConfirmed = true; }
      catch { task.status = "failed"; task.error = "RPC_TERMINATION_UNCONFIRMED"; }
      if (terminationConfirmed) {
        this.accountReleases.get(task.taskId)?.(); this.accountReleases.delete(task.taskId);
        try { await lease?.release(); this.leases.delete(task.taskId); } catch { task.status = "failed"; task.error = "SESSION_RELEASE_FAILED"; }
        try { await this.projectLeases.get(task.taskId)?.release(); this.projectLeases.delete(task.taskId); } catch { task.status = "failed"; task.error = "PROJECT_RELEASE_FAILED"; }
        this.workers.delete(task.taskId);
      }
      task.approvals = []; task.access = "inspect";
      for (const call of task.toolCalls ?? []) if (call.status === "running") call.status = task.status === "cancelled" ? "cancelled" : "unknown";
      task.updatedAt = new Date().toISOString(); this.changed(task); await this.persist();
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
  async answerApproval(id, approvalId, value) {
    const task = this.tasks.get(id), worker = this.workers.get(id);
    if (!task || terminal(task.status) || task.status === "cancelling" || !worker || (task.mode !== "controlled" && !worker.mcpEnabled && !worker.codemodeEnabled)) throw hostError("APPROVAL_EXPIRED", 409);
    worker.answerApproval(approvalId, value);
    return this.public(task);
  }
  async revoke(id) {
    const task = this.tasks.get(id), worker = this.workers.get(id);
    if (!task || terminal(task.status) || task.status === "cancelling" || !worker || (task.mode !== "controlled" && !worker.mcpEnabled && !worker.codemodeEnabled)) throw hostError("RPC_CONTROL_UNAVAILABLE", 409);
    task.inputRevoked = true; this.changed(task);
    await worker.revoke(); task.access = "inspect"; task.approvals = [];
    this.changed(task); await this.persist(); return this.public(task);
  }
  async stop() {
    this.closing = true;
    for (const task of this.tasks.values()) if (!terminal(task.status)) await this.cancel(task.taskId);
    await Promise.all([...this.workers.values()].map((w) => w.stop()));
    await Promise.all([...this.running.values()]);
    // A previously unconfirmed stop can succeed during Host shutdown. Only now
    // release its reservation and persist the reconciled process state.
    for (const [id] of this.workers) {
      const task = this.tasks.get(id); task.worker = null;
      if (task.error === "RPC_TERMINATION_UNCONFIRMED") task.error = "RPC_TERMINATION_RECOVERED";
      this.accountReleases.get(id)?.(); this.accountReleases.delete(id);
      await this.leases.get(id)?.release(); this.leases.delete(id);
      await this.projectLeases.get(id)?.release(); this.projectLeases.delete(id);
      this.workers.delete(id);
    }
    clearTimeout(this.checkpoint); this.checkpoint = null;
    await this.persist();
  }
}
