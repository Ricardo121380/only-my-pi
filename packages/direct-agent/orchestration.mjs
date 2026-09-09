import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

import {
  applyWriterPatch,
  captureWriterPatch,
  createManagedClone,
  writerScopeOverlapsDirtyPaths,
} from "./managed-clone.mjs";
import { normalizeRelativePath, pathMatchesScope } from "./workspace.mjs";

export const DIRECT_DELEGATION_EVENTS = Object.freeze({
  request: "prompt-template:subagent:request",
  started: "prompt-template:subagent:started",
  update: "prompt-template:subagent:update",
  response: "prompt-template:subagent:response",
  cancel: "prompt-template:subagent:cancel",
});

export const DIRECT_RUNTIME_EVENT = "only-my-pi:direct-runtime:v1";

export const DIRECT_READ_ONLY_AGENTS = Object.freeze([
  "omp-explorer",
  "omp-reviewer",
  "omp-scout",
  "omp-security-reviewer",
  "omp-test-analyst",
  "omp-verifier",
  "omp-researcher",
  "omp-source-verifier",
]);

const READ_ONLY_AGENT_SET = new Set(DIRECT_READ_ONLY_AGENTS);
const WEB_AGENTS = new Set(["omp-researcher", "omp-source-verifier"]);
const TERMINAL_STATUSES = new Set([
  "acceptance_failed", "cancelled", "completed", "duplicate_node", "failed",
  "interrupted", "invalid_request", "structured_output_failed", "timed_out",
  "tool_budget_exhausted", "turn_budget_exhausted", "unavailable_context",
]);
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MAX_TASK_BYTES = 128 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;

const WRITER_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["completed", "blocked"] },
    changedPaths: { type: "array", maxItems: 64, items: { type: "string", minLength: 1, maxLength: 512 } },
    summary: { type: "string", minLength: 1, maxLength: 8000 },
    verification: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 1000 } },
    followUp: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 1000 } },
  },
  required: ["status", "changedPaths", "summary", "verification", "followUp"],
});

const REVIEW_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "fail", "blocked"] },
    findings: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 2000 } },
    tested: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 1000 } },
    unverified: { type: "array", maxItems: 16, items: { type: "string", minLength: 1, maxLength: 1000 } },
  },
  required: ["verdict", "findings", "tested", "unverified"],
});

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function boundedText(value, label, maximumBytes = MAX_TASK_BYTES) {
  if (typeof value !== "string" || value.trim().length === 0 || /[\0\r]/u.test(value) || Buffer.byteLength(value, "utf8") > maximumBytes) {
    fail("DIRECT_ORCHESTRATION_INPUT_INVALID", `${label} must be non-empty and at most ${maximumBytes} UTF-8 bytes`);
  }
  return value.trim();
}

function boundedResult(value) {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > MAX_RESULT_BYTES) fail("DIRECT_CHILD_RESULT_TOO_LARGE", "child result exceeds the 64 KiB OMP boundary");
  return structuredClone(value);
}

function modelReference(model) {
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string") return undefined;
  const value = `${model.provider}/${model.id}`;
  return value.length <= 512 && !/[\0\r\n]/u.test(value) ? value : undefined;
}

function exactIdentity(value, expected) {
  return value?.requestId === expected.requestId && value?.ownerRunId === expected.ownerRunId && value?.nodeId === expected.nodeId;
}

function keyOf(value) { return JSON.stringify([value.requestId, value.ownerRunId, value.nodeId]); }

function normalizeScope(scope) {
  if (!Array.isArray(scope) || scope.length === 0 || scope.length > 64) fail("DIRECT_WRITER_SCOPE_INVALID", "writer scope must contain 1-64 project-relative entries");
  const values = scope.map((entry) => normalizeRelativePath(entry, "writer scope"));
  if (new Set(values).size !== values.length) fail("DIRECT_WRITER_SCOPE_INVALID", "writer scope may not contain duplicates");
  return values;
}

function scopeIsSubset(candidate, approved) {
  return candidate.every((entry) => approved.some((parent) => {
    if (/[*?]/u.test(entry)) return entry === parent;
    return entry === parent || pathMatchesScope(entry, [parent]);
  }));
}

function relativeArtifact(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("DIRECT_WRITER_ARTIFACT_ESCAPE", "writer patch artifact escaped the private OMP root");
  }
  return relative.split(path.sep).join("/");
}

function normalizeUsage(value) {
  if (!value || typeof value !== "object") return null;
  const keys = ["input", "output", "cacheRead", "cacheWrite", "cost", "turns", "toolCalls", "durationMs"];
  if (keys.some((key) => !Number.isFinite(value[key]) || value[key] < 0)) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function terminalError(response) {
  const suffix = String(response?.status ?? "unknown").toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
  return `DIRECT_CHILD_${suffix}`;
}

class DirectDelegationClient {
  constructor({ transport, maximumConcurrency = 2, maximumChildren = 8, defaultTimeoutMs = 1_800_000, idFactory = randomUUID, onStatus = () => {} } = {}) {
    if (typeof transport?.subscribe !== "function" || typeof transport?.emit !== "function") throw new TypeError("direct delegation requires the shared Pi event transport");
    if (!Number.isSafeInteger(maximumConcurrency) || maximumConcurrency < 1 || maximumConcurrency > 2) throw new TypeError("direct delegation concurrency must be 1 or 2");
    if (!Number.isSafeInteger(maximumChildren) || maximumChildren < 1 || maximumChildren > 8) throw new TypeError("direct delegation child limit must be 1-8");
    this.transport = transport;
    this.maximumConcurrency = maximumConcurrency;
    this.maximumChildren = maximumChildren;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.idFactory = idFactory;
    this.onStatus = onStatus;
    this.active = 0;
    this.total = 0;
    this.pending = new Map();
    this.waiters = [];
    this.disposed = false;
    this.unsubscribers = [
      transport.subscribe(DIRECT_DELEGATION_EVENTS.started, (value) => this.capture("started", value)),
      transport.subscribe(DIRECT_DELEGATION_EVENTS.update, (value) => this.capture("update", value)),
      transport.subscribe(DIRECT_DELEGATION_EVENTS.response, (value) => this.capture("response", value)),
    ].filter((entry) => typeof entry === "function");
  }

  capture(kind, value) {
    if (!value || typeof value !== "object") return;
    const attempt = this.pending.get(keyOf(value));
    if (!attempt || !exactIdentity(value, attempt.request)) return;
    if (kind === "started") {
      attempt.status = "running";
      this.onStatus(attempt.label, "running", value);
      return;
    }
    if (kind === "update") {
      this.onStatus(attempt.label, "running", value);
      return;
    }
    if (!TERMINAL_STATUSES.has(value.status)) {
      attempt.reject(Object.assign(new Error("pi-subagents returned an invalid terminal status"), { code: "DIRECT_CHILD_RESPONSE_INVALID" }));
      return;
    }
    attempt.resolve(value);
  }

  async acquire(signal) {
    if (this.disposed) fail("DIRECT_ORCHESTRATOR_DISPOSED", "direct orchestrator is disposed");
    if (this.total >= this.maximumChildren) fail("DIRECT_CHILD_BUDGET_EXHAUSTED", "this OMP process reached its child-agent limit");
    this.total += 1;
    if (this.active < this.maximumConcurrency) { this.active += 1; return; }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      const abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index === -1) return;
        this.waiters.splice(index, 1);
        this.total -= 1;
        reject(Object.assign(new Error("delegation cancelled while waiting for concurrency"), { code: "DIRECT_CHILD_CANCELLED" }));
      };
      waiter.abort = abort;
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
      if (signal?.aborted) abort();
    });
  }

  release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.signal?.removeEventListener?.("abort", waiter.abort);
      waiter.resolve();
    } else {
      this.active = Math.max(0, this.active - 1);
    }
  }

  async execute({ ownerRunId, nodeId, label, agent, task, cwd, model, thinking, timeoutMs, maximumTurns = 8, maximumToolCalls = 16, blockedTools = [], result = { kind: "text" }, signal } = {}) {
    await this.acquire(signal);
    const request = {
      requestId: this.idFactory(),
      ownerRunId: boundedText(ownerRunId, "ownerRunId", 256),
      nodeId: boundedText(nodeId, "nodeId", 256),
      agent: boundedText(agent, "agent", 1024),
      task: boundedText(task, "task"),
      context: "fresh",
      cwd: path.resolve(boundedText(cwd, "cwd", 32 * 1024)),
      ...(model ? { model } : {}),
      ...(THINKING.has(thinking) ? { thinking } : {}),
      timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
      turnBudget: { maxTurns: maximumTurns },
      toolBudget: { hard: maximumToolCalls, block: [...new Set(blockedTools)].sort() },
      skill: false,
      artifacts: false,
      result,
    };
    const attemptKey = keyOf(request);
    let timer;
    let abort;
    try {
      const response = await new Promise((resolve, reject) => {
        this.pending.set(attemptKey, { request, label, resolve, reject, status: "queued" });
        this.onStatus(label, "queued", request);
        abort = () => {
          this.transport.emit(DIRECT_DELEGATION_EVENTS.cancel, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId });
        };
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => {
          abort();
          reject(Object.assign(new Error("delegated child exceeded its OMP wall-time limit"), { code: "DIRECT_CHILD_TIMEOUT" }));
        }, request.timeoutMs);
        timer.unref?.();
        this.transport.emit(DIRECT_DELEGATION_EVENTS.request, request);
      });
      if (response.status !== "completed" || response.exitCode !== 0) fail(terminalError(response), `delegated ${label} did not complete`);
      const resultValue = response.result?.kind === "structured" ? response.result.value : response.result?.text;
      const normalized = Object.freeze({ status: "completed", agent, result: boundedResult(resultValue), usage: normalizeUsage(response.usage), model: response.model ?? null, thinking: response.thinking ?? null });
      this.onStatus(label, "completed", normalized);
      return normalized;
    } catch (error) {
      this.onStatus(label, error?.code === "DIRECT_CHILD_CANCELLED" ? "cancelled" : "failed", { code: error?.code ?? "DIRECT_CHILD_FAILED" });
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      this.pending.delete(attemptKey);
      this.release();
    }
  }

  cancelAll() {
    for (const attempt of this.pending.values()) this.transport.emit(DIRECT_DELEGATION_EVENTS.cancel, {
      requestId: attempt.request.requestId,
      ownerRunId: attempt.request.ownerRunId,
      nodeId: attempt.request.nodeId,
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelAll();
    for (const attempt of this.pending.values()) {
      attempt.reject(Object.assign(new Error("direct orchestrator disposed"), { code: "DIRECT_ORCHESTRATOR_DISPOSED" }));
    }
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    for (const waiter of this.waiters.splice(0)) waiter.reject(Object.assign(new Error("direct orchestrator disposed"), { code: "DIRECT_ORCHESTRATOR_DISPOSED" }));
  }
}

export class DirectCodingOrchestrator {
  constructor({ transport, configRoot, getContext, budget = {}, webAuthorizer = null, webEnabled = false, verifyWriter = null, cloneService = {}, idFactory = randomUUID, now = () => new Date().toISOString() } = {}) {
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("DirectCodingOrchestrator requires absolute configRoot");
    if (typeof getContext !== "function") throw new TypeError("DirectCodingOrchestrator requires getContext()");
    this.configRoot = path.resolve(configRoot);
    this.getContext = getContext;
    this.idFactory = idFactory;
    this.now = now;
    this.webAuthorizer = webAuthorizer;
    this.webEnabled = webEnabled;
    this.budget = structuredClone(budget);
    this.verifyWriter = verifyWriter;
    this.cloneService = {
      create: cloneService.create ?? createManagedClone,
      capture: cloneService.capture ?? captureWriterPatch,
      apply: cloneService.apply ?? applyWriterPatch,
    };
    this.children = new Map();
    this.writerUsed = false;
    this.writerActive = false;
    this.disposed = false;
    this.client = new DirectDelegationClient({
      transport,
      maximumConcurrency: Math.min(2, budget.maxConcurrency ?? 2),
      maximumChildren: Math.min(8, budget.maxChildren ?? 8),
      defaultTimeoutMs: Math.min(1_800_000, (budget.maxWallSeconds ?? 1800) * 1000),
      idFactory,
      onStatus: (label, status, data) => {
        const prior = this.children.get(label) ?? { label, agent: data?.agent ?? null };
        this.children.set(label, { ...prior, status, updatedAt: this.now(), toolCount: data?.toolCount ?? prior.toolCount ?? null, tokens: data?.tokens ?? prior.tokens ?? null });
        this.render();
      },
    });
  }

  render() {
    const ctx = this.getContext();
    if (ctx?.mode !== "tui") return;
    const active = [...this.children.values()].filter((entry) => ["queued", "running"].includes(entry.status));
    if (active.length === 0) {
      ctx.ui.setWidget("omp-direct-agents", undefined);
      return;
    }
    ctx.ui.setWidget("omp-direct-agents", [
      `OMP · ${active.length} agent${active.length === 1 ? "" : "s"}`,
      ...active.map((entry) => `  ${entry.label.padEnd(14)} ${entry.status}`),
    ], { placement: "aboveEditor" });
  }

  snapshot() {
    return Object.freeze({
      formatVersion: 1,
      physicalRuntimeOwner: "pi-subagents",
      maximumConcurrency: this.client.maximumConcurrency,
      maximumChildren: this.client.maximumChildren,
      totalChildren: this.client.total,
      writerUsed: this.writerUsed,
      children: Object.freeze([...this.children.values()].map((entry) => Object.freeze({ ...entry }))),
    });
  }

  async delegateReadOnly({ agent, task, label, signal } = {}) {
    if (!READ_ONLY_AGENT_SET.has(agent)) fail("DIRECT_AGENT_NOT_ALLOWED", `read-only delegation does not allow ${agent}`);
    const ctx = this.getContext();
    if (!ctx) fail("DIRECT_SESSION_CONTEXT_UNAVAILABLE", "direct session context is unavailable");
    const childLabel = label ? boundedText(label, "label", 128) : `${agent.replace(/^omp-/u, "")}-${this.client.total + 1}`;
    const web = WEB_AGENTS.has(agent);
    const ownerRunId = `direct-${this.idFactory()}`;
    task = boundedText(task, "task", 32_768);
    try {
      if (web) {
        if (!this.webEnabled || !this.webAuthorizer) fail("DIRECT_WEB_UNAVAILABLE", "Enable the Web overlay in a new session before research delegation");
        if (ctx.mode !== "tui" || typeof ctx.ui?.confirm !== "function") fail("PUBLIC_WEB_APPROVAL_REQUIRED", "Public Web requires interactive approval for this research task");
        const role = agent.replace(/^omp-/u, "");
        const plan = await this.webAuthorizer.plan({ runId: ownerRunId, roles: [role], objectiveDigest: `sha256:${createHash("sha256").update(task).digest("hex")}`, budget: this.budget, providerIds: [ctx.model?.provider].filter(Boolean) });
        if (!await ctx.ui.confirm("Allow public Web for this research task?", `${task}\n\nRole: ${role}\nModel: ${modelReference(ctx.model)}\nBudget: ${JSON.stringify(plan.budget)}\nThe task may be sent to public internet providers. Browser cookies are disabled; private and reserved destinations are blocked.`)) fail("PUBLIC_WEB_DENIED", "Public Web was declined; no child was launched");
        if (signal?.aborted) fail("DIRECT_CHILD_CANCELLED", "Research was cancelled before launch");
        await this.webAuthorizer.grant(plan);
        this.webAuthorizer.require(ownerRunId, role);
      }
      return await this.client.execute({
        ownerRunId,
        nodeId: `${childLabel}-${this.idFactory()}`,
        label: childLabel,
        agent,
        task,
        cwd: ctx.cwd,
        model: modelReference(ctx.model),
        thinking: ctx.thinkingLevel,
        maximumTurns: 8,
        maximumToolCalls: 16,
        blockedTools: ["bash", "edit", "write", "subagent", "web", ...(web ? [] : ["web_search", "fetch_content", "get_search_content", "source_check"])],
        result: { kind: "text" },
        signal,
      });
    } finally {
      if (web) this.webAuthorizer?.reset(ownerRunId);
    }
  }

  async delegateWriter({ task, plan, scope, verification = [], baseline, approvedScope, signal } = {}) {
    if (this.writerUsed || this.writerActive) fail("DIRECT_WRITER_LIMIT_REACHED", "only one managed-clone writer is allowed in an OMP process");
    const ctx = this.getContext();
    if (!ctx) fail("DIRECT_SESSION_CONTEXT_UNAVAILABLE", "direct session context is unavailable");
    if (baseline?.status !== "GIT_REPOSITORY" || typeof baseline.head !== "string") fail("DIRECT_WRITER_GIT_REQUIRED", "managed-clone writer requires an approved Git repository baseline");
    const writerScope = normalizeScope(scope);
    if (!scopeIsSubset(writerScope, approvedScope ?? [])) fail("DIRECT_WRITER_SCOPE_EXPANSION", "writer scope exceeds the approved coding scope");
    const overlap = writerScopeOverlapsDirtyPaths(baseline, writerScope);
    if (overlap.length > 0) return Object.freeze({ status: "MAIN_AGENT_FALLBACK_DIRTY_OVERLAP", overlap, message: "The main Agent must implement this scope in the original dirty worktree." });
    this.writerActive = true;
    this.writerUsed = true;
    const runId = `direct-writer-${this.idFactory()}`;
    try {
      const managed = await this.cloneService.create({
        repositoryRoot: ctx.cwd,
        runId,
        baseCommit: baseline.head,
        runsRoot: path.join(this.configRoot, "only-my-pi", "runs"),
      });
      const writerTask = [
        "Implement the approved project-local plan in this managed ordinary Git clone.",
        `Task: ${boundedText(task, "task", 16_384)}`,
        `Approved plan:\n${boundedText(plan, "plan", 32_768)}`,
        `Exact scope: ${JSON.stringify(writerScope)}`,
        `Requested verification: ${JSON.stringify(Array.isArray(verification) ? verification.slice(0, 16) : [])}`,
        "Your verification summary is advisory. Automatic integration requires runtime-executed, user-approved project gates; do not modify the gate manifest to obtain a passing result.",
        "Do not commit, push, delegate, use Web, modify .git, or write outside the clone. Return the exact structured result.",
      ].join("\n\n");
      const writer = await this.client.execute({
        ownerRunId: runId,
        nodeId: "writer-1",
        label: "writer-1",
        agent: "omp-implementer",
        task: writerTask,
        cwd: managed.cloneRoot,
        model: modelReference(ctx.model),
        thinking: ctx.thinkingLevel,
        maximumTurns: 8,
        maximumToolCalls: 16,
        blockedTools: ["subagent", "web", "web_search", "fetch_content", "get_search_content", "source_check"],
        result: { kind: "structured", schema: WRITER_RESULT_SCHEMA },
        signal,
      });
      if (writer.result?.status !== "completed") return Object.freeze({ status: "WRITER_BLOCKED", summary: writer.result?.summary ?? "Writer reported a blocked implementation." });
      const capture = { cloneRoot: managed.cloneRoot, baseCommit: baseline.head, scope: writerScope, patchRoot: managed.patchRoot, runId, nodeId: "writer-1" };
      const patch = await this.cloneService.capture(capture);
      if (patch.status === "NO_CHANGES") return Object.freeze({ status: "WRITER_NO_CHANGES", summary: writer.result.summary, usage: writer.usage });
      const reported = [...new Set((writer.result.changedPaths ?? []).map((entry) => normalizeRelativePath(entry, "writer reported path")))].sort();
      if (JSON.stringify(reported) !== JSON.stringify([...patch.changedPaths].sort())) fail("DIRECT_WRITER_REPORT_DRIFT", "writer-reported paths do not match the captured patch");
      const blocked = (code, receipt = null) => Object.freeze({ status: "WRITER_VERIFICATION_BLOCKED", code, patchDigest: patch.sha256, artifact: relativeArtifact(this.configRoot, patch.patchPath), verificationReceipt: receipt });
      if (!this.verifyWriter) return blocked("WRITER_VERIFIER_UNAVAILABLE");
      const verified = await this.verifyWriter({ cloneRoot: managed.cloneRoot, patch, requestedVerification: verification, signal });
      if (verified?.status !== "PASS" || verified.patchDigest !== patch.sha256 || verified.baseCommit !== baseline.head || !Array.isArray(verified.results) || verified.results.length === 0 || verified.results.some((result) => result.status !== "PASS" || result.exitCode !== 0 || result.killed !== false)) {
        return blocked(verified?.code ?? "WRITER_TESTS_NOT_VERIFIED", verified);
      }
      const unchanged = async () => {
        const current = await this.cloneService.capture({ ...capture, nodeId: "verification-check" });
        return current.status === "READY" && current.sha256 === patch.sha256 && JSON.stringify(current.changedPaths) === JSON.stringify(patch.changedPaths);
      };
      if (signal?.aborted || !await unchanged()) return blocked("WRITER_VERIFIED_PATCH_DRIFT", verified);
      const review = await this.client.execute({
        ownerRunId: runId,
        nodeId: "reviewer-1",
        label: "reviewer-1",
        agent: "omp-reviewer",
        task: `Freshly review the uncommitted writer changes in this clone against the approved task and scope. Do not modify files.\n\nTask: ${task}\n\nScope: ${JSON.stringify(writerScope)}\n\nPatch digest: ${patch.sha256}\n\nRuntime verification receipt: ${JSON.stringify(verified)}`,
        cwd: managed.cloneRoot,
        model: modelReference(ctx.model),
        thinking: ctx.thinkingLevel,
        maximumTurns: 6,
        maximumToolCalls: 12,
        blockedTools: ["bash", "edit", "write", "subagent", "web", "web_search", "fetch_content", "get_search_content", "source_check"],
        result: { kind: "structured", schema: REVIEW_RESULT_SCHEMA },
        signal,
      });
      if (review.result?.verdict !== "pass") {
        return Object.freeze({
          status: "WRITER_REVIEW_BLOCKED",
          patchDigest: patch.sha256,
          changedPaths: patch.changedPaths,
          findings: review.result?.findings ?? [],
          artifact: relativeArtifact(this.configRoot, patch.patchPath),
        });
      }
      if (signal?.aborted || !await unchanged()) return blocked("WRITER_VERIFIED_PATCH_DRIFT", verified);
      const applied = await this.cloneService.apply({ patch, repositoryRoot: ctx.cwd, scope: writerScope, baseline });
      return Object.freeze({
        status: "WRITER_PATCH_APPLIED_REQUIRES_REAL_WORKSPACE_VERIFICATION",
        patchDigest: applied.patchDigest,
        changedPaths: applied.changedPaths,
        summary: writer.result.summary,
        cloneVerification: writer.result.verification,
        verificationReceipt: verified,
        reviewer: { verdict: review.result.verdict, findings: review.result.findings, unverified: review.result.unverified },
        requiredVerification: Array.isArray(verification) ? verification.slice(0, 16) : [],
      });
    } finally {
      this.writerActive = false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.client.dispose();
    this.getContext()?.ui?.setWidget?.("omp-direct-agents", undefined);
  }
}

export function createDirectCodingOrchestrator(options = {}) { return new DirectCodingOrchestrator(options); }
