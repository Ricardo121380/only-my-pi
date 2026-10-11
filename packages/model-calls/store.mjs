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
const validateBinding = new Ajv({ strict: true }).compile({ type: "object", additionalProperties: false, required: ["accountId", "model", "budget"], properties: {
  accountId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,128}$" }, model: { type: "string", pattern: "^[^\\s/]+/.{1,256}$" }, budget: { type: "object", additionalProperties: false, required: Object.keys(ceilings), properties: Object.fromEntries(Object.entries(ceilings).map(([key, maximum]) => [key, { type: "integer", minimum: 1, maximum }])) },
} });
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
  if (!config || typeof config.projectPath !== "string" || !path.isAbsolute(config.projectPath) || !integer(config.revision) || !integer(config.revocation)) return false;
  if (config.classifier === null) return true;
  const binding = config.classifier;
  return binding && validateBinding({ accountId: binding.accountId, model: binding.model, budget: binding.budget }) && binding.choice?.supported === true
    && binding.choice.definition?.type === "classifier" && binding.choice.definitionDigest === digest(canonicalJson(binding.choice.definition))
    && binding.model === `${binding.choice.definition.provider}/${binding.choice.definition.id}`;
}
function validState(state) {
  if (state.version !== 1 || !Array.isArray(state.projects) || !Array.isArray(state.tasks) || state.tasks.length > 1000 || state.projects.length > 1000 || !state.projects.every(validConfig)) return false;
  const taskIds = new Set(), requestIds = new Set();
  if (new Set(state.projects.map(item => item.projectPath)).size !== state.projects.length) return false;
  return state.tasks.every(task => {
    if (typeof task.taskId !== "string" || taskIds.has(task.taskId) || !validConfig(task.snapshot) || !task.snapshot.classifier || task.projectPath !== task.snapshot.projectPath || !Number.isSafeInteger(task.ownerPid) || task.ownerPid < 1 || typeof task.ownerIdentity !== "string" || !["active", "stopped"].includes(task.status) || !Array.isArray(task.requests)) return false;
    taskIds.add(task.taskId);
    const binding = task.snapshot.classifier, budget = binding.budget;
    if (task.requests.length > budget.requests) return false;
    return task.requests.every(request => {
      if (typeof request.requestId !== "string" || requestIds.has(request.requestId) || typeof request.parentToolCallId !== "string" || !["reserved", "dispatched", "unknown", "completed", "failed", "not_sent"].includes(request.status) || request.kind !== "classifier" || request.accountId !== binding.accountId || request.model !== binding.model || request.definitionDigest !== binding.choice.definitionDigest
        || request.reservation?.requests !== 1 || request.reservation?.concurrency !== 1 || request.reservation.inputBytes !== budget.maxInputBytes || request.reservation.outputBytes !== budget.maxOutputBytes || request.reservation.money !== null || !validUsage(request.usage)) return false;
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
  async save(projectPath, revision, classifier, models) {
    if (!Number.isSafeInteger(revision) || revision < 0 || classifier !== null && !validateBinding(classifier)) throw hostError("CLASSIFIER_CONFIG_INVALID");
    let choice;
    if (classifier) {
      choice = (await models(classifier.accountId)).find(model => model.id === classifier.model && model.supported);
      if (!choice) throw hostError("CLASSIFIER_UNAVAILABLE", 409);
    }
    return this.change(state => {
      const prior = state.projects.find(item => item.projectPath === projectPath);
      if ((prior?.revision ?? 0) !== revision) throw hostError("CLASSIFIER_REVISION_CONFLICT", 409);
      const config = { projectPath, revision: revision + 1, revocation: (prior?.revocation ?? 0) + (classifier === null ? 1 : 0), classifier: classifier ? { ...structuredClone(classifier), choice } : null };
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
  check(state, taskId) {
    const task = state.tasks.find(item => item.taskId === taskId);
    if (!task || task.status !== "active") throw hostError("MODEL_TASK_INACTIVE", 409);
    const config = state.projects.find(item => item.projectPath === task.projectPath);
    if (!task.snapshot.classifier || !config?.classifier || config.revocation !== task.snapshot.revocation) throw hostError("CLASSIFIER_REVOKED", 409);
    return task;
  }
  async authorize(taskId, sessionId) {
    return this.change(state => { const task = this.check(state, taskId); task.sessionId = sessionId; task.permission = { unknownCostAccepted: true, at: now() }; return task; });
  }
  async reserve(taskId, parentToolCallId, context) {
    return this.change(state => {
      const task = this.check(state, taskId);
      if (!task.permission?.unknownCostAccepted) throw hostError("CLASSIFIER_APPROVAL_REQUIRED", 409);
      const budget = task.snapshot.classifier.budget, requests = task.requests;
      if (requests.some(request => request.status === "unknown")) throw hostError("MODEL_RESULT_RECONCILIATION_REQUIRED", 409);
      if (Buffer.byteLength(JSON.stringify(context)) > budget.maxInputBytes) throw hostError("MODEL_INPUT_LIMIT", 409);
      if (requests.length >= budget.requests || requests.filter(active).length >= budget.concurrency || (requests.length + 1) * budget.maxInputBytes > budget.inputBytes || (requests.length + 1) * budget.maxOutputBytes > budget.outputBytes) throw hostError("MODEL_BUDGET_EXHAUSTED", 409);
      const request = { requestId: randomUUID(), parentToolCallId, kind: "classifier", status: "reserved", inputDigest: digest(context), accountId: task.snapshot.classifier.accountId, model: task.snapshot.classifier.model, definitionDigest: task.snapshot.classifier.choice.definitionDigest,
        reservation: { requests: 1, concurrency: 1, inputBytes: budget.maxInputBytes, outputBytes: budget.maxOutputBytes, money: null }, priceSnapshot: { value: task.snapshot.classifier.choice.price, source: "Pi model catalog", at: now(), currency: "USD", hardLimit: false }, createdAt: now(), usage: { status: "unknown", tokens: null, estimatedCost: null, source: "provider receipt" } };
      task.requests.push(request); return request;
    });
  }
  async update(taskId, requestId, change) {
    return this.change(state => {
      const task = state.tasks.find(item => item.taskId === taskId), request = task?.requests.find(item => item.requestId === requestId);
      if (!request) throw hostError("MODEL_REQUEST_NOT_FOUND", 404);
      if (!["reserved", "dispatched", "unknown"].includes(request.status)) throw hostError("MODEL_REQUEST_SETTLED", 409);
      if (change.status === "dispatched") this.check(state, taskId);
      Object.assign(request, change, { updatedAt: now() }); return request;
    });
  }
  async dispatch(taskId, requestId, metadata, send) {
    return this.change(state => {
      const task = this.check(state, taskId), request = task.requests.find(item => item.requestId === requestId);
      if (task.requests.some(item => item.status === "unknown")) throw hostError("MODEL_RESULT_RECONCILIATION_REQUIRED", 409);
      if (!request || request.status !== "reserved") throw hostError("MODEL_RETRY_DENIED", 409);
      Object.assign(request, metadata, { status: "dispatched", dispatchedAt: now() }); return request;
    }, send); // The marker is durable and the lock remains held until send begins.
  }
  async end(taskId) {
    return this.change(state => { const task = state.tasks.find(item => item.taskId === taskId); if (!task) return null; task.status = "stopped"; task.permission = null;
      for (const request of task.requests) if (["reserved", "dispatched"].includes(request.status)) { request.status = request.status === "dispatched" ? "unknown" : "not_sent"; request.error = "EXECUTION_ENDED"; }
      return task;
    });
  }
  async status(projectPath) {
    const state = await this.read();
    const tasks = await Promise.all(state.tasks.filter(task => task.projectPath === projectPath).map(async task => {
      const orphan = task.status === "active" && task.ownerIdentity !== await processIdentity(task.ownerPid);
      return { ...task, permission: undefined, status: orphan ? "interrupted" : task.status, requests: task.requests.map(request => orphan && ["reserved", "dispatched"].includes(request.status) ? { ...request, status: request.status === "dispatched" ? "unknown" : "not_sent", error: "PROCESS_INTERRUPTED" } : request) };
    }));
    return { protocol: 1, config: await this.config(projectPath), tasks };
  }
}
