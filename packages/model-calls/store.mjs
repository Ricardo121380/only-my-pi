import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Ajv from "ajv";
import { acquireConfigLock, atomicWriteJson, canonicalJson, readJsonObject } from "../config-runtime/index.mjs";
import { processIdentity } from "../host/ownership.mjs";
import { hostError } from "../host/contracts.mjs";
import { digest } from "../mcp/catalog.mjs";

export const MODEL_BUDGET = Object.freeze({ requests: 4, concurrency: 1, maxInputBytes: 8192, maxOutputBytes: 8192, inputBytes: 32768, outputBytes: 32768, timeoutMs: 10000 });
const ceilings = { requests: 32, concurrency: 4, maxInputBytes: 32768, maxOutputBytes: 65536, inputBytes: 1048576, outputBytes: 2097152, timeoutMs: 60000 };
export const IMAGE_BUDGET = Object.freeze({ ...MODEL_BUDGET, maxOutputBytes: 2097152, outputBytes: 8388608, maxImagesPerRequest: 1, images: 4, maxStorageBytes: 1048576, storageBytes: 4194304 });
const imageCeilings = { ...ceilings, maxOutputBytes: 16777216, outputBytes: 67108864, maxImagesPerRequest: 4, images: 32, maxStorageBytes: 10485760, storageBytes: 67108864 };
const bindingValidator = limits => new Ajv({ strict: true }).compile({ type: "object", additionalProperties: false, required: ["accountId", "model", "budget"], properties: {
  accountId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" }, model: { type: "string", pattern: "^[^\\s/]+/.{1,256}$" }, budget: { type: "object", additionalProperties: false, required: Object.keys(limits), properties: Object.fromEntries(Object.entries(limits).map(([key, maximum]) => [key, { type: "integer", minimum: 1, maximum }])) },
} });
const validateBinding = bindingValidator(ceilings), validateImageBinding = bindingValidator(imageCeilings);
const now = () => new Date().toISOString();
const active = request => ["reserved", "dispatched", "unknown"].includes(request.status);
const integer = value => Number.isSafeInteger(value) && value >= 0;
function validUsage(usage) {
  return usage && ["reported", "unknown"].includes(usage.status)
    && (!usage.coverage || [usage.coverage.input, usage.coverage.output].every(value => value === null || integer(value)))
    && (usage.status === "unknown" ? usage.tokens === null : usage.tokens && integer(usage.tokens.input) && integer(usage.tokens.output) && usage.tokens.totalTokens === usage.tokens.input + usage.tokens.output)
    && (usage.estimatedCost === null || typeof usage.estimatedCost === "number" && Number.isFinite(usage.estimatedCost) && usage.estimatedCost >= 0);
}
function validConfig(config) {
  if (!config || typeof config.projectPath !== "string" || !path.isAbsolute(config.projectPath) || !integer(config.revision) || !integer(config.revocation) || config.imageRevocation !== undefined && !integer(config.imageRevocation)) return false;
  return ["classifier", "image"].every(kind => {
    const binding = config[kind];
    if (binding === null || kind === "image" && binding === undefined) return true;
    return binding && (kind === "image" ? validateImageBinding : validateBinding)({ accountId: binding.accountId, model: binding.model, budget: binding.budget }) && binding.choice?.supported === true
      && binding.choice.definition?.type === kind && binding.choice.definitionDigest === digest(canonicalJson(binding.choice.definition))
      && binding.model === `${binding.choice.definition.provider}/${binding.choice.definition.id}`;
  });
}
function validStorage(storage, task, request, budget) {
  if (!storage) return true;
  if (!["saved", "partial", "failed", "unknown", "invalid"].includes(storage.status) || !Array.isArray(storage.artifacts) || !integer(storage.bytes) || storage.bytes > budget.maxStorageBytes || storage.artifacts.length > budget.maxImagesPerRequest) return false;
  if (["saved", "partial"].includes(storage.status) && !storage.artifacts.length || ["failed", "invalid"].includes(storage.status) && storage.artifacts.length) return false;
  if (storage.bytes !== storage.artifacts.reduce((sum, image) => sum + image.bytes, 0)) return false;
  return storage.artifacts.every((image, index) => image.index === index && image.requestId === request.requestId && image.projectPath === task.projectPath && image.sessionId === task.sessionId && image.taskId === task.taskId && image.accountId === request.accountId && image.model === request.model && image.parentToolCallId === request.parentToolCallId && image.inputDigest === request.inputDigest && image.createdAt === request.createdAt
    && /^[0-9a-f]{64}$/u.test(image.sha256 ?? "") && integer(image.bytes) && image.bytes > 0 && integer(image.width) && image.width > 0 && integer(image.height) && image.height > 0 && image.width * image.height <= 4000000 && image.mimeType === "image/png");
}
function validState(state) {
  if (![1, 2].includes(state.version) || !Array.isArray(state.projects) || !Array.isArray(state.tasks) || state.tasks.length > 1000 || state.projects.length > 1000 || !state.projects.every(validConfig)) return false;
  const taskIds = new Set(), requestIds = new Set();
  if (new Set(state.projects.map(item => item.projectPath)).size !== state.projects.length) return false;
  if (state.version === 1 && (state.projects.some(config => Object.hasOwn(config, "image")) || state.tasks.some(task => Object.hasOwn(task.snapshot ?? {}, "image")))) return false;
  return state.tasks.every(task => {
    if (typeof task.taskId !== "string" || taskIds.has(task.taskId) || !validConfig(task.snapshot) || !task.snapshot.classifier && !task.snapshot.image || task.projectPath !== task.snapshot.projectPath || !Number.isSafeInteger(task.ownerPid) || task.ownerPid < 1 || typeof task.ownerIdentity !== "string" || !["active", "stopped"].includes(task.status) || !Array.isArray(task.requests)) return false;
    taskIds.add(task.taskId);
    if (["classifier", "image"].some(kind => {
      const requests = task.requests.filter(r => r.kind === kind), budget = task.snapshot[kind]?.budget;
      return requests.length > (budget?.requests ?? 0) || requests.length && (requests.length * budget.maxInputBytes > budget.inputBytes || requests.length * budget.maxOutputBytes > budget.outputBytes || requests.filter(active).length > budget.concurrency || kind === "image" && (requests.length * budget.maxImagesPerRequest > budget.images || requests.length * budget.maxStorageBytes > budget.storageBytes));
    })) return false;
    return task.requests.every(request => {
      const binding = task.snapshot[request.kind], budget = binding?.budget;
      if (!["classifier", "image"].includes(request.kind) || !binding || typeof request.requestId !== "string" || requestIds.has(request.requestId) || typeof request.parentToolCallId !== "string" || !["reserved", "dispatched", "unknown", "completed", "failed", "not_sent"].includes(request.status) || request.accountId !== binding.accountId || request.model !== binding.model || request.definitionDigest !== binding.choice.definitionDigest
        || request.reservation?.requests !== 1 || request.reservation?.concurrency !== 1 || request.reservation.inputBytes !== budget.maxInputBytes || request.reservation.outputBytes !== budget.maxOutputBytes || request.reservation.money !== null || !validUsage(request.usage)) return false;
      if (request.kind === "image" && (request.reservation.images !== budget.maxImagesPerRequest || request.reservation.storageBytes !== budget.maxStorageBytes)) return false;
      if (request.kind === "image" && !validStorage(request.storage, task, request, budget)) return false;
      requestIds.add(request.requestId); return true;
    });
  });
}

// One durable transaction covers the task-wide reservations of every parent
// script. No caller can raise a task's frozen limits or recreate an old task.
export class ModelCallStore {
  constructor(configRoot) { this.root = configRoot; this.file = path.join(configRoot, "only-my-pi/model-calls/state.json"); }
  async read() {
    const stat = await fs.lstat(this.file).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (stat && (!stat.isFile() || stat.size > 16777216)) throw hostError("MODEL_LEDGER_INVALID", 409);
    const state = await readJsonObject(this.root, this.file).catch(error => { if (error.code === "ENOENT") return { version: 1, projects: [], tasks: [] }; throw hostError("MODEL_LEDGER_INVALID", 409); });
    if (!validState(state)) throw hostError("MODEL_LEDGER_INVALID", 409);
    return state;
  }
  async change(fn, afterWrite) {
    let lock;
    for (let i = 0; i < 100; i++) {
      try { lock = await acquireConfigLock(this.root, { lockDirectory: path.join(this.root, "only-my-pi/locks/model-calls.lock") }); break; }
      catch (error) { if (error.code !== "LOCK_HELD" || i === 99) throw error; await delay(20); }
    }
    try {
      const state = await this.read(), result = await fn(state);
      if (!validState(state)) throw hostError("MODEL_LEDGER_INVALID", 409);
      if (Buffer.byteLength(JSON.stringify(state)) > 16777216) throw hostError("MODEL_LEDGER_CAPACITY", 409);
      await atomicWriteJson(this.root, this.file, state);
      afterWrite?.();
      return structuredClone(result);
    } finally { await lock.release(); }
  }
  async config(projectPath) {
    return (await this.read()).projects.find(item => item.projectPath === projectPath) ?? { projectPath, revision: 0, revocation: 0, classifier: null };
  }
  async save(projectPath, revision, classifier, models, kind = "classifier") {
    const prefix = kind === "image" ? "IMAGE" : "CLASSIFIER";
    if (!["classifier", "image"].includes(kind) || !Number.isSafeInteger(revision) || revision < 0 || classifier !== null && !(kind === "image" ? validateImageBinding : validateBinding)(classifier)) throw hostError(`${prefix}_CONFIG_INVALID`);
    let choice;
    if (classifier) {
      choice = (await models(classifier.accountId)).find(model => model.id === classifier.model && model.supported);
      if (!choice) throw hostError(`${prefix}_UNAVAILABLE`, 409);
    }
    return this.change(state => {
      if (kind === "image") state.version = 2; // Earlier readers must refuse new image data, not erase it.
      const prior = state.projects.find(item => item.projectPath === projectPath);
      if ((prior?.revision ?? 0) !== revision) throw hostError(`${prefix}_REVISION_CONFLICT`, 409);
      const revocation = kind === "image" ? "imageRevocation" : "revocation";
      const config = { ...(prior ?? { projectPath, revocation: 0, classifier: null }), revision: revision + 1, [revocation]: (prior?.[revocation] ?? 0) + (classifier === null ? 1 : 0), [kind]: classifier ? { ...structuredClone(classifier), choice } : null };
      if (prior) state.projects[state.projects.indexOf(prior)] = config; else state.projects.push(config);
      return config;
    });
  }
  async begin(taskId, projectPath, snapshot) {
    const ownerIdentity = await processIdentity();
    return this.change(state => {
      const existing = state.tasks.find(task => task.taskId === taskId);
      if (existing) throw hostError("MODEL_TASK_ALREADY_RECORDED", 409);
      if (state.tasks.length >= 1000) throw hostError("MODEL_LEDGER_CAPACITY", 409);
      const task = { taskId, projectPath, sessionId: null, snapshot, ownerPid: process.pid, ownerIdentity, status: "active", permission: null, requests: [], createdAt: now() };
      state.tasks.push(task); return task;
    });
  }
  check(state, taskId, kind = "classifier") {
    const task = state.tasks.find(item => item.taskId === taskId);
    if (!task || task.status !== "active") throw hostError("MODEL_TASK_INACTIVE", 409);
    const config = state.projects.find(item => item.projectPath === task.projectPath);
    const revocation = kind === "image" ? "imageRevocation" : "revocation";
    if (!task.snapshot[kind] || !config?.[kind] || (config[revocation] ?? 0) !== (task.snapshot[revocation] ?? 0)) throw hostError(kind === "image" ? "IMAGE_REVOKED" : "CLASSIFIER_REVOKED", 409);
    return task;
  }
  async authorize(taskId, sessionId, kind = "classifier") {
    return this.change(state => { const task = this.check(state, taskId, kind); task.sessionId = sessionId; task[kind === "image" ? "imagePermission" : "permission"] = { unknownCostAccepted: true, at: now() }; return task; });
  }
  async reserve(taskId, parentToolCallId, context, kind = "classifier") {
    return this.change(state => {
      const task = this.check(state, taskId, kind), binding = task.snapshot[kind];
      if (!task[kind === "image" ? "imagePermission" : "permission"]?.unknownCostAccepted) throw hostError(kind === "image" ? "IMAGE_APPROVAL_REQUIRED" : "CLASSIFIER_APPROVAL_REQUIRED", 409);
      const budget = binding.budget, requests = task.requests.filter(request => request.kind === kind);
      if (task.requests.some(request => request.status === "unknown")) throw hostError("MODEL_RESULT_RECONCILIATION_REQUIRED", 409);
      if (Buffer.byteLength(JSON.stringify(context)) > budget.maxInputBytes) throw hostError("MODEL_INPUT_LIMIT", 409);
      if (requests.length >= budget.requests || requests.filter(active).length >= budget.concurrency || (requests.length + 1) * budget.maxInputBytes > budget.inputBytes || (requests.length + 1) * budget.maxOutputBytes > budget.outputBytes) throw hostError("MODEL_BUDGET_EXHAUSTED", 409);
      if (kind === "image" && ((requests.length + 1) * budget.maxImagesPerRequest > budget.images || (requests.length + 1) * budget.maxStorageBytes > budget.storageBytes)) throw hostError("MODEL_BUDGET_EXHAUSTED", 409);
      if (kind === "image" && state.tasks.flatMap(task => task.requests).reduce((n, r) => n + (r.kind === "image" ? r.reservation.storageBytes : 0), 0) + budget.maxStorageBytes > 268435456) throw hostError("IMAGE_GLOBAL_STORAGE_LIMIT", 409);
      const request = { requestId: randomUUID(), parentToolCallId, kind, status: "reserved", inputDigest: digest(context), accountId: binding.accountId, model: binding.model, definitionDigest: binding.choice.definitionDigest,
        reservation: { requests: 1, concurrency: 1, inputBytes: budget.maxInputBytes, outputBytes: budget.maxOutputBytes, money: null, ...(kind === "image" ? { images: budget.maxImagesPerRequest, storageBytes: budget.maxStorageBytes } : {}) }, priceSnapshot: { value: binding.choice.price, source: "Pi model catalog", at: now(), currency: "USD", hardLimit: false }, createdAt: now(), usage: { status: "unknown", tokens: null, estimatedCost: null, source: "provider receipt" } };
      task.requests.push(request); return request;
    });
  }
  async update(taskId, requestId, change) {
    return this.change(state => {
      const task = state.tasks.find(item => item.taskId === taskId), request = task?.requests.find(item => item.requestId === requestId);
      if (!request) throw hostError("MODEL_REQUEST_NOT_FOUND", 404);
      if (!["reserved", "dispatched", "unknown"].includes(request.status)) throw hostError("MODEL_REQUEST_SETTLED", 409);
      if (change.status === "dispatched") this.check(state, taskId, request.kind);
      Object.assign(request, change, { updatedAt: now() }); return request;
    });
  }
  async dispatch(taskId, requestId, metadata, send) {
    return this.change(state => {
      const task = state.tasks.find(item => item.taskId === taskId), request = task?.requests.find(item => item.requestId === requestId);
      this.check(state, taskId, request?.kind);
      if (task.requests.some(item => item.status === "unknown")) throw hostError("MODEL_RESULT_RECONCILIATION_REQUIRED", 409);
      if (!request || request.status !== "reserved") throw hostError("MODEL_RETRY_DENIED", 409);
      Object.assign(request, metadata, { status: "dispatched", dispatchedAt: now() }); return request;
    }, send); // The marker is durable and the lock remains held until send begins.
  }
  async end(taskId) {
    return this.change(state => { const task = state.tasks.find(item => item.taskId === taskId); if (!task) return null; task.status = "stopped"; task.permission = null; if (task.imagePermission) task.imagePermission = null;
      for (const request of task.requests) if (["reserved", "dispatched"].includes(request.status)) { request.status = request.status === "dispatched" ? "unknown" : "not_sent"; request.error = "EXECUTION_ENDED"; }
      return task;
    });
  }
  async status(projectPath) {
    const state = await this.read();
    const tasks = await Promise.all(state.tasks.filter(task => task.projectPath === projectPath).map(async task => {
      const orphan = task.status === "active" && task.ownerIdentity !== await processIdentity(task.ownerPid);
      return { ...task, permission: undefined, imagePermission: undefined, status: orphan ? "interrupted" : task.status, requests: task.requests.map(request => orphan && ["reserved", "dispatched"].includes(request.status) ? { ...request, status: request.status === "dispatched" ? "unknown" : "not_sent", error: "PROCESS_INTERRUPTED" } : request) };
    }));
    return { protocol: 1, config: await this.config(projectPath), tasks };
  }
}
