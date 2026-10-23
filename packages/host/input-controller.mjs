// @ts-check
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { inputDigest, inputError } from "./input-contracts.mjs";
import { validateInputCommand, validateReceipt } from "./input-protocol.mjs";
import { terminal } from "./contracts.mjs";
import { supportsThinking } from "./models.mjs";

/** @typedef {import('./contracts.d.ts').InputScopeV1} Scope */
/** @typedef {import('./contracts.d.ts').InputRecordV1} RecordV1 */
/** @typedef {import('./contracts.d.ts').InputContentV1} Content */
/** @typedef {import('./contracts.d.ts').QueueShardV1} Queue */
/** @typedef {{ taskId: string; projectId: string; sessionId: string|null; accountId?: string|null; model: string; thinkingLevel?: string|null; mode?: string; status: string; inputRevoked?: boolean; resourceRevision?: number; worker?: unknown }} Task */
/** @typedef {{ scope: Scope; taskId: string|null; paused: boolean }} Lane */
/** @param {Scope} scope */
const key = (scope) => JSON.stringify([scope.projectId, scope.sessionId]);

/** Serial admission owns only delivery intent. HostTasks still owns workers,
 * leases and grants; Pi history still owns executed conversation.
 */
export class HostInputController extends EventEmitter {
  /** @type {Promise<void>} */ #pending = Promise.resolve();
  /** @type {Map<string, Lane>} */ #lanes = new Map();
  /** @type {Set<string>} */ #finishing = new Set();
  /** @type {Set<Promise<void>>} */ #settling = new Set();
  #closing = false;
  #failed = false;
  /** @param {{ store: import('./input-store.mjs').HostInputStore; tasks: import('./tasks.mjs').HostTasks; catalog: import('./catalog.mjs').ProjectCatalog; resourceRevision?: (projectId: string) => number | Promise<number> }} options */
  constructor({ store, tasks, catalog, resourceRevision = () => 0 }) {
    super(); this.store = store; this.tasks = tasks; this.catalog = catalog; this.resourceRevision = resourceRevision;
    this.onChange = (/** @type {Task} */ task) => {
      task = tasks.tasks.get(task.taskId) ?? task;
      if (task.status === "cancelling" || task.inputRevoked) this.#background(() => this.#pauseTask(task.taskId, task.inputRevoked ? "AUTHORIZATION_REVOKED" : "TASK_CANCELLED"));
      if (terminal(task.status) && !this.#finishing.has(task.taskId)) {
        this.#finishing.add(task.taskId);
        const work = (async () => {
          // `change` is emitted before the final persist/scan finishes. Do not
          // start another worker until the predecessor's whole run has settled.
          await tasks.running.get(task.taskId);
          await this.#serial(() => this.#finished(task));
        })().catch(() => this.#fail()).finally(() => this.#settling.delete(work));
        this.#settling.add(work);
      }
    };
    this.onInput = (/** @type {{ taskId: string; receipt: import('./contracts.d.ts').InputReceiptV1 }} */ event) => this.#background(async () => {
      const task = /** @type {Task | undefined} */ (tasks.tasks.get(event.taskId));
      if (!task?.sessionId || event.receipt.taskId !== task.taskId) throw inputError("INPUT_RECEIPT_CONFLICT");
      const scope = { projectId: task.projectId, sessionId: task.sessionId };
      const queue = await store.readQueue(scope), record = queue.items.find((item) => item.inputId === event.receipt.inputId);
      if (!record || record.taskId !== task.taskId) throw inputError("INPUT_RECEIPT_CONFLICT");
      validateReceipt(event.receipt, record);
      await this.#reconcile(scope, record.inputId);
    });
    this.onAccepted = (/** @type {{ taskId: string; inputId: string }} */ event) => this.#background(async () => {
      const task = tasks.tasks.get(event.taskId);
      if (!task?.sessionId) throw inputError("INPUT_SESSION_REQUIRED");
      const scope = { projectId: task.projectId, sessionId: task.sessionId };
      const item = (await store.readQueue(scope)).items.find((record) => record.inputId === event.inputId);
      if (!item || item.taskId !== event.taskId) throw inputError("INPUT_RECEIPT_CONFLICT");
      if (item.state === "dispatching") await this.#transition(scope, item.inputId, "accepted");
    });
    tasks.on("change", this.onChange); tasks.on("input", this.onInput); tasks.on("inputAccepted", this.onAccepted);
  }
  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  #serial(operation) {
    const result = this.#pending.then(operation);
    this.#pending = result.then(() => {}, () => {});
    return result;
  }
  /** @param {() => Promise<unknown>} operation */
  #background(operation) { void this.#serial(operation).catch(() => this.#fail()); }
  #fail() { this.#failed = true; for (const lane of this.#lanes.values()) { lane.paused = true; this.#changed(lane.scope); } }
  /** @param {Scope} scope */
  #changed(scope) { this.emit("change", { scope }); }
  /** @param {import('./contracts.d.ts').InputTargetV1} target @returns {Promise<Scope>} */
  async #scope(target) {
    const project = this.catalog.project(target.projectId);
    if (!project.available) throw inputError("PROJECT_UNAVAILABLE");
    if ("taskId" in target) {
      const task = /** @type {Task | undefined} */ (this.tasks.tasks.get(target.taskId));
      if (!task || task.projectId !== target.projectId || !task.sessionId) throw inputError("INPUT_SESSION_REQUIRED");
      return { projectId: target.projectId, sessionId: task.sessionId };
    }
    return { projectId: target.projectId, sessionId: target.sessionKey === null ? null : (await this.catalog.resume(target.sessionKey, target.projectId)).sessionId };
  }
  /** @param {Scope} scope @param {string} id @returns {Task} */
  #active(scope, id) {
    const task = /** @type {Task | undefined} */ (this.tasks.tasks.get(id));
    if (!task || task.projectId !== scope.projectId || task.sessionId !== scope.sessionId || task.status !== "running" || task.inputRevoked || !this.tasks.workers.get(id)?.deliverInput) throw inputError("TASK_NOT_RUNNING");
    return task;
  }
  /** @param {Content} input @param {Task} [task] @param {string} [projectId] */
  async #binding(input, task, projectId = task?.projectId ?? "") {
    if (input.materialSnapshotIds.length) throw inputError("INPUT_MATERIALS_UNAVAILABLE");
    if (input.binding.resourceRevision !== await this.resourceRevision(projectId)) throw inputError("INPUT_BINDING_CHANGED");
    if (task && (input.binding.accountId !== task.accountId || input.binding.modelId !== task.model || input.binding.thinking !== task.thinkingLevel || input.binding.mode !== (task.mode ?? "readonly") || input.binding.resourceRevision !== (task.resourceRevision ?? 0))) throw inputError("INPUT_BINDING_CHANGED");
    const model = (await this.tasks.models(input.binding.accountId)).find((/** @type {{id: string; thinkingLevels?: string[]}} */ model) => model.id === input.binding.modelId);
    if (input.binding.resourceRevision !== await this.resourceRevision(projectId)) throw inputError("INPUT_BINDING_CHANGED");
    if (!model || !supportsThinking(model, input.binding.thinking)) throw inputError("INPUT_BINDING_CHANGED");
  }
  /** @param {Scope} scope @param {Content} input @returns {Promise<Queue|null>} */
  async #prior(scope, input) {
    const queue = await this.store.readQueue(scope), record = queue.items.find((item) => item.inputId === input.inputId);
    if (!record) return null;
    if (record.contentDigest !== inputDigest(scope, input)) throw inputError("INPUT_ID_CONFLICT");
    return queue; // A repeated HTTP admission never makes another worker call.
  }
  /** @param {Scope} scope @param {string} id @param {import('./contracts.d.ts').InputTransition['state']} state @param {{taskId?: string; consumedEntryId?: string; pauseReason?: string}} [extra] */
  async #transition(scope, id, state, extra = {}) {
    const queue = await this.store.readQueue(scope), item = queue.items.find((record) => record.inputId === id);
    if (!item) throw inputError("INPUT_NOT_FOUND", 404);
    const result = await this.store.transition(scope, id, { expectedRevision: queue.revision, expectedInputRevision: item.revision, state, ...extra });
    this.#changed(scope); return result;
  }
  /** Reads only the canonical, persisted CURRENT branch. A child event by itself
   * is not durable; an absent entry never licenses a resend.
   * @param {Scope} scope @param {string} id */
  async #reconcile(scope, id) {
    const queue = await this.store.readQueue(scope), item = queue.items.find((record) => record.inputId === id);
    if (!item) throw inputError("INPUT_NOT_FOUND", 404);
    if (!["dispatching", "accepted", "unknown"].includes(item.state)) return queue;
    if (!this.catalog.listSessions(scope.projectId).some((session) => session.sessionId === scope.sessionId)) await this.catalog.scan();
    const receipt = await this.catalog.inputReceipt(item);
    if (!receipt) return queue;
    return this.#transition(scope, id, "consumed", { consumedEntryId: receipt.entryId });
  }
  /** @param {Scope} scope @param {string} reason */
  async #pause(scope, reason) {
    const lane = this.#lanes.get(key(scope)); if (lane) lane.paused = true;
    for (const item of (await this.store.readQueue(scope)).items) if (item.state === "queued") await this.#transition(scope, item.inputId, "paused", { pauseReason: reason });
  }
  /** @param {string} taskId @param {string} reason */
  async #pauseTask(taskId, reason) {
    for (const lane of this.#lanes.values()) if (lane.taskId === taskId) await this.#pause(lane.scope, reason);
  }
  /** @param {Scope} scope @param {RecordV1} record */
  async #deliver(scope, record) {
    const worker = this.tasks.workers.get(record.taskId);
    try {
      if (this.#closing || this.tasks.closing) throw inputError("HOST_STOPPING");
      this.#active(scope, /** @type {string} */ (record.taskId));
      // Once `dispatching` is published, any missing/rejected ACK is uncertain.
      // Lookup is allowed; retrying the operation is not.
      const response = await worker.deliverInput(record);
      if (!["accepted", "consumed"].includes(response?.status)) throw inputError("INPUT_DELIVERY_UNCONFIRMED");
      if (response.status === "consumed") validateReceipt(response.receipt, record);
      await this.tasks.recordInputFeedback(record.taskId, record.inputId, response.feedback);
      await this.#transition(scope, record.inputId, "accepted");
      return await this.#reconcile(scope, record.inputId);
    } catch (error) {
      try {
        const found = await worker?.lookupInput?.(record);
        if (["accepted", "consumed"].includes(found?.status)) await this.tasks.recordInputFeedback(record.taskId, record.inputId, found.feedback);
        if (found?.status === "consumed") { validateReceipt(found.receipt, record); const reconciled = await this.#reconcile(scope, record.inputId); if (reconciled.items.find((item) => item.inputId === record.inputId)?.state === "consumed") return reconciled; }
      } catch { /* A failed read-only lookup never licenses retransmission. */ }
      const late = error && typeof error === "object" && "code" in error && error.code === "TASK_NOT_RUNNING";
      await this.#transition(scope, record.inputId, "unknown", { pauseReason: late ? "TASK_NOT_RUNNING" : "INPUT_DELIVERY_UNCONFIRMED" });
      await this.#pause(scope, "INPUT_RECONCILIATION_REQUIRED");
      if (late) throw inputError("TASK_NOT_RUNNING");
      return this.store.readQueue(scope);
    }
  }
  /** @param {Task} task */
  async #finished(task) {
    if (!task.sessionId) return;
    const scope = { projectId: task.projectId, sessionId: task.sessionId };
    let uncertain = false;
    await this.catalog.scan();
    for (const item of (await this.store.readQueue(scope)).items) if (item.taskId === task.taskId && ["dispatching", "accepted", "unknown"].includes(item.state)) {
      const current = (await this.#reconcile(scope, item.inputId)).items.find((record) => record.inputId === item.inputId);
      if (current?.state !== "consumed") {
        uncertain = true;
        if (current && current.state !== "unknown") await this.#transition(scope, item.inputId, "unknown", { pauseReason: "INPUT_NOT_CONFIRMED_CONSUMED" });
      }
    }
    const lane = this.#lanes.get(key(scope));
    if (!lane || lane.taskId !== task.taskId) return;
    // A failed pre-publication dispatch may leave a known-unsubmitted steer.
    // It must not remain looking eligible after its target task has ended.
    for (const item of (await this.store.readQueue(scope)).items) if (item.state === "queued" && item.delivery === "steer") await this.#transition(scope, item.inputId, "paused", { pauseReason: "TASK_NOT_RUNNING" });
    if (this.#closing || uncertain || task.status !== "succeeded" || task.inputRevoked || task.worker) return this.#pause(scope, uncertain ? "INPUT_RECONCILIATION_REQUIRED" : task.inputRevoked ? "AUTHORIZATION_REVOKED" : "PREDECESSOR_NOT_SUCCEEDED");
    if (!lane.paused) await this.#pump(lane, task);
  }
  /** @param {Lane} lane @param {Task} [predecessor] */
  async #pump(lane, predecessor) {
    if (this.#closing || this.#failed || lane.paused) return;
    const queue = await this.store.readQueue(lane.scope);
    if (queue.items.some((item) => ["paused", "unknown", "dispatching", "accepted"].includes(item.state))) return this.#pause(lane.scope, "INPUT_RECONCILIATION_REQUIRED");
    const input = queue.items.find((item) => item.state === "queued" && item.delivery === "queue");
    if (!input) { this.#lanes.delete(key(lane.scope)); return; }
    try {
      await this.#binding(input, predecessor, lane.scope.projectId);
      if (this.#closing || this.tasks.closing || this.#failed) throw inputError("HOST_STOPPING");
      const sessions = this.catalog.listSessions(lane.scope.projectId).filter((session) => session.sessionId === lane.scope.sessionId);
      if (sessions.length !== 1) throw inputError("INPUT_SESSION_REQUIRED");
      // HostTasks persists a fresh inspect-only task, then invokes this hook
      // BEFORE worker creation. No coding approval is inherited.
      await this.tasks.start({ type: "startTask", requestId: `input-${createHash("sha256").update(input.inputId).digest("hex")}`, projectId: input.projectId, accountId: input.binding.accountId, model: input.binding.modelId, thinkingLevel: input.binding.thinking, mode: input.binding.mode, prompt: input.text, resumeSessionKey: sessions[0].sessionKey }, { inputRecord: input, beforeRun: async (/** @type {Task} */ task) => {
        lane.taskId = task.taskId;
        const state = await this.#transition(lane.scope, input.inputId, "dispatching", { taskId: task.taskId });
        return state.items.find((item) => item.inputId === input.inputId);
      } });
    } catch {
      await this.#pause(lane.scope, "INPUT_BINDING_OR_START_FAILED");
    }
  }
  /** Transfer a saved draft into a task-bound ledger record before any Pi
   * prompt. A new session changes scope, so it receives a deterministic new
   * input ID; the task retains the original draft ID for crash reconciliation.
   * @param {Extract<import('./contracts.d.ts').InputCommandV1, {type:'submitPrompt'}>} command
   * @param {Scope} scope @param {() => void} authorized */
  async #submitPrompt(command, scope, authorized) {
    const originalId = command.input.inputId;
    const boundId = scope.sessionId === null ? createHash("sha256").update(JSON.stringify(["new-session-input-v1", command.requestId, scope.projectId, originalId])).digest("hex") : originalId;
    const submission = { inputId: boundId, originDraftInputId: originalId, originDraftSessionId: scope.sessionId };
    const start = { type: "startTask", requestId: command.requestId, projectId: scope.projectId, accountId: command.input.binding.accountId,
      model: command.input.binding.modelId, thinkingLevel: command.input.binding.thinking, mode: command.input.binding.mode, prompt: command.input.text,
      ...(command.target.sessionKey === null ? {} : { resumeSessionKey: command.target.sessionKey }) };
    const options = { submission, beforePrompt: (/** @type {Task} */ task) => this.#serial(async () => {
      authorized();
      if (!task.sessionId || task.status === "cancelling") throw inputError("TASK_NOT_RUNNING");
      await this.#binding(command.input, task, scope.projectId);
      authorized();
      const actual = { projectId: scope.projectId, sessionId: task.sessionId };
      const input = { ...command.input, inputId: boundId };
      const current = await this.store.readQueue(actual);
      const queued = await this.store.enqueue(actual, input, { expectedRevision: current.revision });
      const saved = queued.items.find((item) => item.inputId === boundId);
      if (!saved || saved.state !== "queued" || saved.contentDigest !== inputDigest(actual, input)) throw inputError("INPUT_ID_CONFLICT");
      authorized();
      const dispatched = await this.#transition(actual, boundId, "dispatching", { taskId: task.taskId });
      const draft = await this.store.readDraft(scope);
      // If the user edited a newer draft while the worker was starting, do not
      // clear it. The submitted text remains the original immutable snapshot.
      if (draft.revision === command.expectedRevision && draft.draft?.revision === command.expectedInputRevision && draft.draft?.inputId === originalId) {
        await this.store.clearDraft(scope, { expectedRevision: draft.revision }); this.#changed(scope);
      }
      return /** @type {RecordV1} */ (dispatched.items.find((item) => item.inputId === boundId));
    }) };
    if (this.tasks.requests.has(command.requestId)) return this.tasks.start(start, options);
    const draft = await this.store.readDraft(scope);
    if (draft.revision !== command.expectedRevision || draft.draft?.revision !== command.expectedInputRevision) throw inputError("INPUT_REVISION_CONFLICT");
    if (draft.draft.inputId !== originalId || draft.draft.contentDigest !== inputDigest(scope, command.input) || !command.input.text.trim()) throw inputError("INPUT_CONTENT_INVALID", 400);
    if (scope.sessionId !== null) {
      const queue = await this.store.readQueue(scope);
      if (queue.items.some((item) => !["consumed", "removed"].includes(item.state))) throw inputError("INPUT_RECONCILIATION_REQUIRED");
    }
    if ([...this.tasks.tasks.values()].some((task) => task.projectId === scope.projectId && task.originDraftSessionId === scope.sessionId && task.originDraftInputId === originalId)) throw inputError("INPUT_ID_CONFLICT");
    await this.#binding(command.input, undefined, scope.projectId); authorized();
    return this.tasks.start(start, options);
  }
  /** @param {unknown} value @param {{isAuthorized?: () => boolean}} [options] */
  command(value, { isAuthorized = () => true } = {}) {
    const command = structuredClone(validateInputCommand(value));
    return this.#serial(async () => {
      if (this.#closing || this.tasks.closing) throw inputError("HOST_STOPPING", 503);
      if (this.#failed && !["getInputs", "reconcileInput"].includes(command.type)) throw inputError("INPUT_RECONCILIATION_REQUIRED", 503);
      const scope = await this.#scope(command.target);
      const authorized = () => { if (!isAuthorized()) throw inputError("AUTH_REQUIRED", 401); if (this.#closing || this.tasks.closing) throw inputError("HOST_STOPPING", 503); };
      authorized();
      if (command.type === "getInputs") return { protocol: 1, admission: this.#failed ? "reconciliation_required" : "ready", draft: await this.store.readDraft(scope), queue: await this.store.readQueue(scope) };
      if (command.type === "saveDraft") { const result = await this.store.saveDraft(scope, command.input, command); this.#changed(scope); return result; }
      if (command.type === "clearDraft") { const result = await this.store.clearDraft(scope, command); this.#changed(scope); return result; }
      if (command.type === "submitPrompt") return this.#submitPrompt(command, scope, authorized);
      if (!scope.sessionId) throw inputError("INPUT_SESSION_REQUIRED");
      if (command.type === "reconcileInput") return this.#reconcile(scope, command.inputId);
      if (command.type === "removeQueuedInput") { const result = await this.store.transition(scope, command.inputId, { ...command, state: "removed" }); this.#changed(scope); return result; }
      if (command.type === "editQueuedInput") { await this.#binding(command.input, undefined, scope.projectId); authorized(); const result = await this.store.editQueued(scope, command.input, command); this.#changed(scope); return result; }
      if (command.type === "resumeQueue") {
        const queue = await this.store.readQueue(scope);
        if (queue.revision !== command.expectedRevision) throw inputError("INPUT_REVISION_CONFLICT");
        if (queue.items.some((item) => ["dispatching", "accepted", "unknown"].includes(item.state) || (item.delivery === "steer" && ["paused", "queued"].includes(item.state))) || [...this.tasks.tasks.values()].some((task) => task.sessionId === scope.sessionId && (!terminal(task.status) || task.worker))) throw inputError("INPUT_RECONCILIATION_REQUIRED");
        const eligible = queue.items.filter((item) => item.delivery === "queue" && ["paused", "queued"].includes(item.state));
        for (const item of eligible) await this.#binding(item, undefined, scope.projectId);
        authorized();
        for (const item of eligible) if (item.state === "paused") await this.#transition(scope, item.inputId, "queued");
        const lane = { scope, taskId: null, paused: false }; this.#lanes.set(key(scope), lane);
        await this.#pump(lane); return this.store.readQueue(scope);
      }
      const prior = await this.#prior(scope, command.input); if (prior) return prior;
      const taskId = command.type === "deliverSupplement" ? command.taskId : command.predecessorTaskId;
      const task = this.#active(scope, taskId);
      if (command.input.delivery !== (command.type === "deliverSupplement" ? "steer" : "queue")) throw inputError("INPUT_DELIVERY_CONFLICT");
      await this.#binding(command.input, task);
      authorized();
      // Model discovery is asynchronous. Check the exact running task again.
      this.#active(scope, taskId);
      let lane = this.#lanes.get(key(scope));
      if (lane && (lane.taskId !== taskId || lane.paused)) throw inputError("INPUT_QUEUE_PAUSED");
      const queue = await this.store.enqueue(scope, command.input, command);
      if (!lane) { lane = { scope, taskId, paused: false }; this.#lanes.set(key(scope), lane); }
      this.#changed(scope);
      if (command.type === "enqueueInput") return queue;
      const state = await this.#transition(scope, command.input.inputId, "dispatching", { taskId });
      return this.#deliver(scope, /** @type {RecordV1} */ (state.items.find((item) => item.inputId === command.input.inputId)));
    });
  }
  /** Stop admission/launch first; task stop/reconciliation can still drain. */
  beginStop() { this.#closing = true; }
  async close() {
    this.beginStop();
    await Promise.all([...this.#settling]); await this.#pending;
    this.tasks.off("change", this.onChange); this.tasks.off("input", this.onInput); this.tasks.off("inputAccepted", this.onAccepted);
  }
}
