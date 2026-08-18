import crypto from "node:crypto";

import {
  digestWorkflowValue,
  validateWorkflowPlan,
} from "../plan-compiler/index.mjs";
import { assertPlainJson } from "../../state/codec.mjs";
import { createApprovalVerifier } from "../../policy/approval-receipt.mjs";

const TERMINAL_RUN_STATES = new Set([
  "completed", "failed", "cancelled", "interrupted", "orphaned",
  "timed-out", "budget-exhausted", "unavailable",
]);
const SUCCESS_NODE_OUTCOMES = new Set(["completed", "pass"]);
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
const MAX_RUN_INPUT_BYTES = 256 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const EXECUTION_TARGET_KINDS = new Set(["workflow", "swarm"]);

export class RunCoordinatorError extends Error {
  constructor(message, code = "RUN_COORDINATOR_ERROR", details = {}) {
    super(`run-coordinator: ${message}`);
    this.name = "RunCoordinatorError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new RunCoordinatorError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function immutable(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) immutable(child);
  return value;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
}

function normalizeRunInput(value) {
  let input;
  try {
    input = assertPlainJson(value ?? {}, "workflow run input");
  } catch (cause) {
    fail(cause.message, "INVALID_RUN_INPUT", { cause });
  }
  const bytes = byteLength(input);
  if (bytes > MAX_RUN_INPUT_BYTES) fail("workflow run input exceeds 256 KiB", "RUN_INPUT_TOO_LARGE", { bytes });
  return immutable(input);
}

function normalizeConditions(value) {
  if (!Array.isArray(value) || value.length > 128) fail("execution conditions must be a bounded array", "INVALID_EXECUTION_ENVELOPE");
  const conditions = value.map((condition) => {
    if (typeof condition !== "string" || condition.length === 0 || condition.length > 256 || /[\0\r\n]/u.test(condition)) {
      fail("execution condition is invalid", "INVALID_EXECUTION_ENVELOPE");
    }
    return condition;
  });
  if (new Set(conditions).size !== conditions.length) fail("execution conditions must be unique", "INVALID_EXECUTION_ENVELOPE");
  return conditions.sort();
}

function executionEnvelopePayload(value) {
  return {
    formatVersion: 1,
    runId: value.runId,
    planDigest: value.planDigest,
    sourceHash: value.sourceHash,
    runInputDigest: value.runInputDigest,
    target: value.target,
    conditions: value.conditions,
  };
}

export function createExecutionEnvelope(plan, options = {}) {
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
  const inputDigest = options.runInputDigest
    ?? digestWorkflowValue(normalizeRunInput(options.input));
  const runId = canonicalRunId(options.runId);
  const target = options.target ?? { kind: "workflow", id: plan.id };
  if (!object(target)
    || !EXECUTION_TARGET_KINDS.has(target.kind)
    || typeof target.id !== "string"
    || target.id.length === 0
    || target.id.length > 128
    || Object.keys(target).some((key) => !["kind", "id"].includes(key))) {
    fail("execution target is invalid", "INVALID_EXECUTION_ENVELOPE");
  }
  const payload = executionEnvelopePayload({
    runId,
    planDigest: options.planDigest ?? plan.planDigest,
    sourceHash: options.sourceHash ?? plan.definitionDigest,
    runInputDigest: inputDigest,
    target: { kind: target.kind, id: target.id },
    conditions: normalizeConditions(options.conditions ?? []),
  });
  if (payload.planDigest !== plan.planDigest) fail("execution plan digest differs", "EXECUTION_PLAN_DRIFT");
  if (!SHA256.test(payload.sourceHash ?? "")) fail("execution source hash is invalid", "INVALID_EXECUTION_ENVELOPE");
  if (!SHA256.test(payload.runInputDigest ?? "")) fail("execution input digest is invalid", "INVALID_EXECUTION_ENVELOPE");
  const executionEnvelopeDigest = digestWorkflowValue(payload);
  if (options.executionEnvelopeDigest !== undefined && options.executionEnvelopeDigest !== executionEnvelopeDigest) {
    fail("execution envelope digest differs", "EXECUTION_ENVELOPE_DRIFT");
  }
  return immutable({ ...payload, executionEnvelopeDigest });
}

function safeProjection(value, maxBytes = 32 * 1024) {
  if (!object(value) && !Array.isArray(value)) return value ?? null;
  const copy = clone(value);
  const sensitive = new Set(["prompt", "promptText", "reasoning", "rawOutput", "credentials", "token", "secret", "env", "task", "content"]);
  const scrub = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(scrub);
    if (!object(candidate)) return candidate;
    return Object.fromEntries(Object.entries(candidate).filter(([key]) => !sensitive.has(key)).map(([key, child]) => [key, scrub(child)]));
  };
  const scrubbed = scrub(copy);
  if (byteLength(scrubbed) <= maxBytes) return scrubbed;
  return { truncated: true, digest: digestWorkflowValue(scrubbed), bytes: byteLength(scrubbed) };
}

function boundedOutputProjection(value, maxOutputBytes) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let bytes = 0;
  let nodes = 0;
  let failure = null;
  const add = (amount) => {
    bytes += amount;
    if (bytes > maxOutputBytes) failure = "OUTPUT_LIMIT_EXCEEDED";
  };
  while (stack.length > 0 && failure === null) {
    const current = stack.pop();
    const candidate = current.value;
    nodes += 1;
    if (nodes > 10_000 || current.depth > 64) {
      failure = "OUTPUT_LIMIT_EXCEEDED";
      break;
    }
    if (candidate === null) { add(4); continue; }
    if (typeof candidate === "string") {
      const rawBytes = Buffer.byteLength(candidate, "utf8");
      if (rawBytes > maxOutputBytes - bytes) {
        bytes = Math.max(maxOutputBytes + 1, bytes + rawBytes + 2);
        failure = "OUTPUT_LIMIT_EXCEEDED";
        break;
      }
      add(Buffer.byteLength(JSON.stringify(candidate), "utf8"));
      continue;
    }
    if (["number", "boolean"].includes(typeof candidate)) {
      const encoded = JSON.stringify(candidate);
      if (encoded === undefined) { failure = "OUTPUT_LIMIT_EXCEEDED"; break; }
      add(Buffer.byteLength(encoded, "utf8"));
      continue;
    }
    if (!object(candidate) && !Array.isArray(candidate)) {
      failure = "OUTPUT_LIMIT_EXCEEDED";
      break;
    }
    if (seen.has(candidate)) {
      failure = "OUTPUT_LIMIT_EXCEEDED";
      break;
    }
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      add(2 + Math.max(0, candidate.length - 1));
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push({ value: candidate[index], depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) {
      failure = "OUTPUT_LIMIT_EXCEEDED";
      break;
    }
    const entries = Object.entries(candidate);
    add(2 + Math.max(0, entries.length - 1));
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      add(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  if (failure !== null) {
    const observedBytes = Math.max(maxOutputBytes + 1, bytes);
    const digest = digestWorkflowValue({ code: failure, observedBytes, nodes, type: Array.isArray(value) ? "array" : typeof value });
    return immutable({
      projection: { truncated: true, code: failure, observedBytes, digest },
      rawOutputBytes: observedBytes,
      errorCode: failure,
      digest,
    });
  }
  return immutable({
    projection: safeProjection(value),
    rawOutputBytes: bytes,
    errorCode: null,
    digest: digestWorkflowValue(value),
  });
}

function canonicalRunId(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,127}$/u.test(value)) fail("runId is invalid", "INVALID_RUN_ID");
  return value;
}

function nodeMutates(node) {
  return node.policy?.mutation !== "none" || node.policy?.tools?.allow?.some((tool) => MUTATING_TOOLS.has(tool));
}

function planNeedsApproval(plan) {
  return plan.nodes.some((node) => node.kind === "approval" || nodeMutates(node));
}

function terminalRunStatus(outcome) {
  const mapping = {
    completed: "completed",
    pass: "completed",
    failed: "failed",
    fail: "failed",
    cancelled: "cancelled",
    interrupted: "interrupted",
    orphaned: "orphaned",
    "timed-out": "timed-out",
    "budget-exhausted": "budget-exhausted",
    unavailable: "unavailable",
  };
  return mapping[outcome] ?? "failed";
}

function terminalEventType(status) {
  const mapping = {
    completed: "RunCompleted",
    failed: "RunFailed",
    cancelled: "RunCancelled",
    interrupted: "RunInterrupted",
    orphaned: "RunOrphaned",
    "timed-out": "RunFailed",
    "budget-exhausted": "RunFailed",
    unavailable: "RunFailed",
  };
  return mapping[status] ?? "RunFailed";
}

function normalizeTerminal(value, { runId, nodeId, attemptId, fallbackOutcome = "failed", maxOutputBytes = 32 * 1024 } = {}) {
  const receipt = value?.terminal ?? value?.receipt ?? value;
  const rawResult = receipt?.result ?? receipt?.data ?? null;
  const output = boundedOutputProjection(rawResult, maxOutputBytes);
  const usage = boundedOutputProjection(receipt?.usage ?? value?.usage ?? null, 4096);
  const error = boundedOutputProjection(receipt?.error ?? value?.error ?? null, 4096);
  const handle = boundedOutputProjection(value?.handle ?? receipt?.handle ?? null, 16 * 1024);
  const observed = {
    rawOutputBytes: output.rawOutputBytes,
    elapsedMs: receipt?.usage?.elapsedMs ?? value?.usage?.elapsedMs ?? 0,
    tokens: receipt?.usage?.tokens ?? value?.usage?.tokens ?? 0,
    cost: receipt?.usage?.costUsd ?? receipt?.usage?.cost ?? value?.usage?.costUsd ?? value?.usage?.cost ?? 0,
  };
  const outcome = receipt?.outcome
    ?? (receipt?.status === "PASS" ? "completed" : receipt?.status === "FAIL" ? "failed" : fallbackOutcome);
  // A terminal state is authoritative only when the backend/domain receipt says
  // so explicitly. Local timeouts, abort races, and incomplete adapters must
  // never be promoted to a proven child-process terminal state by default.
  const authoritative = receipt?.authoritative === true;
  if (receipt?.runId !== undefined && receipt.runId !== runId) fail("terminal receipt run correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  if (receipt?.nodeId !== undefined && receipt.nodeId !== nodeId) fail("terminal receipt node correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  if (receipt?.attemptId !== undefined && receipt.attemptId !== attemptId) fail("terminal receipt attempt correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  const receiptId = typeof receipt?.receiptId === "string" && SHA256.test(receipt.receiptId)
    ? receipt.receiptId
    : digestWorkflowValue({
      runId,
      nodeId,
      attemptId,
      outcome,
      authoritative,
      resultDigest: output.digest,
      usageDigest: usage.digest,
      errorDigest: error.digest,
    });
  return immutable({
    outcome,
    authoritative,
    receiptId,
    result: output.projection,
    usage: usage.projection,
    error: error.projection,
    handle: handle.errorCode === null ? handle.projection : null,
    observed,
    budgetOverrun: false,
    outputErrorCode: output.errorCode,
    outputDigest: output.digest,
  });
}

function emptyProjection(runId, plan) {
  return {
    formatVersion: 1,
    runId,
    planId: plan.id,
    planDigest: plan.planDigest,
    activeRevision: plan.revision.number,
    status: "planned",
    admissionClosed: false,
    approval: null,
    runInputDigest: null,
    executionEnvelopeDigest: null,
    executionEnvelope: null,
    nodes: Object.fromEntries(plan.nodes.map((node) => [node.id, {
      nodeId: node.id,
      kind: node.kind,
      status: "planned",
      attempts: [],
      resultDigest: null,
      outcome: null,
    }])),
    terminal: null,
  };
}

export function projectWorkflowRun(events, plan, runId) {
  const state = emptyProjection(runId, plan);
  for (const event of events) {
    if (event.runId !== runId) fail("journal contains a foreign run event", "RUN_EVENT_CORRELATION_MISMATCH");
    if (event.revision > state.activeRevision && event.type !== "RevisionActivated") fail("event references an inactive revision", "INACTIVE_REVISION_EVENT");
    const node = event.nodeId === null ? null : state.nodes[event.nodeId];
    if (event.nodeId !== null && !node) fail(`event references unknown node ${event.nodeId}`, "UNKNOWN_NODE_EVENT");
    switch (event.type) {
      case "RunPlanned":
        if (event.payload.planDigest !== plan.planDigest) fail("durable plan digest differs from requested plan", "PLAN_DRIFT");
        state.runInputDigest = event.payload.runInputDigest ?? null;
        if (state.runInputDigest === null) fail("durable run has no bound input digest", "RUN_INPUT_UNBOUND");
        if (!object(event.payload.executionEnvelope) || !event.payload.executionEnvelopeDigest) {
          fail("durable run has no bound execution envelope", "EXECUTION_ENVELOPE_UNBOUND");
        }
        if (event.payload.executionEnvelope.runId !== runId) fail("durable execution envelope is bound to a different run", "RUN_ID_DRIFT");
        state.executionEnvelope = createExecutionEnvelope(plan, {
          ...(event.payload.executionEnvelope ?? {}),
          runId,
          runInputDigest: state.runInputDigest,
          executionEnvelopeDigest: event.payload.executionEnvelopeDigest,
        });
        state.executionEnvelopeDigest = state.executionEnvelope.executionEnvelopeDigest;
        state.status = "planned";
        break;
      case "ApprovalRequested": state.status = "awaiting-approval"; break;
      case "RunApproved":
        if (event.payload.executionEnvelopeDigest !== state.executionEnvelopeDigest) fail("approval references a different execution envelope", "EXECUTION_ENVELOPE_DRIFT");
        state.approval = clone(event.payload);
        state.status = "admitted";
        break;
      case "RevisionActivated": state.activeRevision = event.revision; break;
      case "RunStarted": state.status = "running"; break;
      case "RunPaused": state.status = "paused"; state.admissionClosed = true; break;
      case "RunResumed": state.status = "running"; state.admissionClosed = false; break;
      case "RunStopping": state.status = "stopping"; state.admissionClosed = true; break;
      case "NodeQueued":
        if (event.payload.recovery === true) {
          node.status = "queued";
          node.outcome = null;
          node.resultDigest = null;
        } else if (node.status === "planned") node.status = "queued";
        break;
      case "NodeAdmitted":
        node.status = "running";
        if (!node.attempts.some((attempt) => attempt.attemptId === event.attemptId)) {
          node.attempts.push({
            attemptId: event.attemptId,
            status: "admitted",
            childId: null,
            reservationId: event.payload.reservationId ?? null,
            attemptNumber: event.payload.attemptNumber ?? null,
            terminal: null,
          });
        }
        break;
      case "ChildStarted": {
        const attempt = node.attempts.find((candidate) => candidate.attemptId === event.attemptId);
        if (!attempt) fail("ChildStarted has no admitted attempt", "ATTEMPT_EVENT_ORDER");
        attempt.status = "running";
        attempt.childId = event.childId;
        break;
      }
      case "ChildTerminal": {
        const attempt = node.attempts.find((candidate) => candidate.attemptId === event.attemptId);
        if (!attempt) fail("ChildTerminal has no admitted attempt", "ATTEMPT_EVENT_ORDER");
        attempt.status = event.payload.outcome;
        attempt.terminal = clone(event.payload);
        break;
      }
      case "GateEvaluated": node.status = event.payload.outcome === "completed" ? "running" : "failed"; break;
      case "NodeSettled":
        if (event.payload.recovery === true) {
          node.status = "queued";
          node.outcome = null;
          node.resultDigest = null;
        } else {
          node.status = event.payload.outcome;
          node.outcome = event.payload.outcome;
          node.resultDigest = event.payload.resultDigest ?? null;
        }
        break;
      case "RunCompleted":
      case "RunFailed":
      case "RunCancelled":
      case "RunInterrupted":
      case "RunOrphaned":
        state.status = event.payload.status;
        state.terminal = clone(event.payload);
        state.admissionClosed = true;
        break;
      default:
        break;
    }
  }
  return immutable(state);
}

function usageVector(node, terminal) {
  const vector = {};
  if (["agent", "batch-swarm"].includes(node.kind)) vector.assignments = 1;
  vector.rawOutputBytes = terminal.observed.rawOutputBytes;
  vector.elapsedMs = terminal.observed.elapsedMs;
  if (node.budget.maxTokens !== null) vector.tokens = terminal.observed.tokens;
  if (node.budget.maxCostUsd !== null) vector.cost = terminal.observed.cost;
  return vector;
}

function budgetOverruns(node, terminal) {
  const limits = {
    elapsedMs: node.budget.timeoutMs,
    rawOutputBytes: node.budget.maxOutputBytes,
    ...(node.budget.maxTokens === null ? {} : { tokens: node.budget.maxTokens }),
    ...(node.budget.maxCostUsd === null ? {} : { cost: node.budget.maxCostUsd }),
  };
  const overruns = [];
  for (const [resource, limit] of Object.entries(limits)) {
    const observed = terminal.observed[resource];
    if (typeof observed !== "number"
      || !Number.isFinite(observed)
      || observed < 0
      || (resource !== "cost" && !Number.isSafeInteger(observed))
      || observed > limit) {
      overruns.push({ resource, limit, observed: Number.isFinite(observed) ? observed : null });
    }
  }
  return overruns;
}

function asBudgetOverrunTerminal(terminal, node, { outcome = "budget-exhausted", overruns = budgetOverruns(node, terminal), authoritative = terminal.authoritative } = {}) {
  if (terminal.budgetOverrun === true) return terminal;
  if (overruns.length === 0) return terminal;
  const error = {
    code: "BUDGET_OVERRUN",
    causeCode: terminal.outputErrorCode ?? null,
    outcome,
    overruns,
  };
  return immutable({
    ...terminal,
    outcome,
    authoritative,
    receiptId: digestWorkflowValue({ priorReceiptId: terminal.receiptId, outcome, error }),
    error,
    budgetOverrun: true,
  });
}

function reservationVector(node) {
  const vector = {
    // Admission is per attempt. A retry must obtain a new durable reservation
    // before its next child spawn, so reserving the full retry envelope again
    // here would reject otherwise fundable attempts without adding safety.
    elapsedMs: node.budget.timeoutMs,
    rawOutputBytes: node.budget.maxOutputBytes,
  };
  if (["agent", "batch-swarm"].includes(node.kind)) vector.assignments = 1;
  if (node.budget.maxTokens !== null) vector.tokens = node.budget.maxTokens;
  if (node.budget.maxCostUsd !== null) vector.cost = node.budget.maxCostUsd;
  return vector;
}

export class RunCoordinator {
  constructor(options = {}) {
    if (!options.eventJournal || typeof options.eventJournal.append !== "function") throw new TypeError("RunCoordinator requires createEventJournal() manager");
    if (!options.budgetLedger || typeof options.budgetLedger.reserve !== "function") throw new TypeError("RunCoordinator requires createBudgetLedger() manager");
    this.eventJournal = options.eventJournal;
    this.budgetLedger = options.budgetLedger;
    this.planStore = options.planStore ?? null;
    if (this.planStore !== null
      && (typeof this.planStore.put !== "function" || typeof this.planStore.get !== "function")) {
      throw new TypeError("RunCoordinator planStore must implement put() and get()");
    }
    this.nodeExecutor = options.nodeExecutor ?? {};
    this.gateRunner = options.gateRunner ?? null;
    this.approvalVerifier = options.approvalVerifier ?? createApprovalVerifier();
    this.approvalEvidenceProvider = options.approvalEvidenceProvider ?? options.evidenceProvider ?? null;
    this.checkpointService = options.checkpointService ?? null;
    this.loopController = options.loopController ?? null;
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.writerId = options.writerId ?? "only-my-pi-run-coordinator";
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs < 2) {
      throw new TypeError("RunCoordinator leaseTtlMs must be a safe integer >= 2");
    }
    this.leaseRenewalIntervalMs = options.leaseRenewalIntervalMs
      ?? Math.max(1, Math.floor(this.leaseTtlMs / 3));
    if (!Number.isSafeInteger(this.leaseRenewalIntervalMs)
      || this.leaseRenewalIntervalMs < 1
      || this.leaseRenewalIntervalMs >= this.leaseTtlMs) {
      throw new TypeError("RunCoordinator leaseRenewalIntervalMs must be a positive safe integer below leaseTtlMs");
    }
    this.scheduler = options.scheduler ?? {
      setTimeout: (...args) => setTimeout(...args),
      clearTimeout: (...args) => clearTimeout(...args),
    };
    if (typeof this.scheduler.setTimeout !== "function" || typeof this.scheduler.clearTimeout !== "function") {
      throw new TypeError("RunCoordinator scheduler requires setTimeout and clearTimeout");
    }
    this.active = new Map();
  }

  async #verifyApproval(active, receipt, node = null, stage = "run", nodeApproval = false) {
    if (!this.approvalEvidenceProvider) {
      return { ok: false, code: "APPROVAL_CONTEXT_UNAVAILABLE", message: "a live approval evidence provider is required" };
    }
    let verifier = this.approvalVerifier;
    let evidence = null;
    try {
      evidence = await this.approvalEvidenceProvider({
        runId: active.runId,
        plan: active.plan,
        executionEnvelope: active.executionEnvelope,
        node,
        stage,
      });
    } catch (cause) {
      return { ok: false, code: cause?.code ?? "APPROVAL_CONTEXT_UNAVAILABLE", message: "current approval evidence could not be resolved" };
    }
    if (!evidence || typeof evidence !== "object") {
      return { ok: false, code: "APPROVAL_CONTEXT_UNAVAILABLE", message: "current approval evidence is unavailable" };
    }
    if (evidence.approvalVerifier) verifier = evidence.approvalVerifier;
    else {
      try {
        verifier = createApprovalVerifier({
          repo: evidence.repo,
          capabilityEnvelopeHash: evidence.capabilityEnvelopeHash,
          scope: evidence.scope,
          executionEnvelopeDigest: active.executionEnvelope.executionEnvelopeDigest,
        });
      } catch (cause) {
        return { ok: false, code: cause?.code ?? "APPROVAL_CONTEXT_UNAVAILABLE", message: "current approval evidence is invalid" };
      }
    }
    const context = {
      ...(evidence ?? {}),
      expectedExecutionEnvelopeDigest: active.executionEnvelope.executionEnvelopeDigest,
      executionEnvelopeDigest: active.executionEnvelope.executionEnvelopeDigest,
      runId: active.runId,
      node,
      stage,
    };
    try {
      let verdict;
      if (nodeApproval && node && typeof verifier?.verifyNode === "function") {
        verdict = await verifier.verifyNode(receipt, node.approval, active.plan, context);
      } else if (typeof verifier?.verify === "function") {
        verdict = await verifier.verify(receipt, active.plan, context);
      } else {
        return { ok: false, code: "APPROVAL_VERIFIER_UNAVAILABLE", message: "approval verifier is unavailable" };
      }
      if (!verdict?.ok) return verdict;
      return immutable({
        ...verdict,
        authorization: {
          formatVersion: 1,
          repo: clone(receipt.repo),
          scope: clone(receipt.scope),
          receiptId: receipt.receiptId,
          executionEnvelopeDigest: active.executionEnvelope.executionEnvelopeDigest,
        },
      });
    } catch (cause) {
      return { ok: false, code: cause?.code ?? "APPROVAL_CONTEXT_UNAVAILABLE", message: "approval evidence validation failed" };
    }
  }

  async #requestApproval(active, verdict, { nodeId = null, stage = "run" } = {}) {
    await this.#append(active, this.#event(active, "ApprovalRequested", {
      eventId: this.idFactory("approval-requested", { runId: active.runId, nodeId }),
      payload: {
        planDigest: active.plan.planDigest,
        policyDigest: active.plan.policyDigest,
        revision: active.plan.revision.number,
        executionEnvelopeDigest: active.executionEnvelope.executionEnvelopeDigest,
        nodeId,
        stage,
        code: verdict?.code ?? "APPROVAL_REQUIRED",
      },
    }));
    const { projection } = await this.#project(active);
    await this.#snapshot(active, projection);
    return projection;
  }

  async #lease(runId) {
    return this.eventJournal.acquireWriter(runId, {
      writerId: this.writerId,
      ttlMs: this.leaseTtlMs,
      provePreviousWriterDead: async (lease) => {
        const proof = await this.nodeExecutor.proveWriterDead?.(lease);
        return proof === true;
      },
    });
  }

  #assertLeaseHealthy(active) {
    if (active.leaseFailure) {
      const failure = active.leaseFailure;
      fail(
        "writer lease renewal failed; refusing to append after fencing may have changed",
        failure.code === "STALE_WRITER" ? "STALE_WRITER" : "LEASE_RENEWAL_FAILED",
        { cause: failure },
      );
    }
  }

  #recordLeaseFailure(active, cause) {
    if (active.leaseFailure) return;
    active.leaseFailure = cause;
    active.rejectLeaseFailure?.(cause);
    active.controller.abort();
  }

  async #renewLease(active) {
    this.#assertLeaseHealthy(active);
    if (typeof this.eventJournal.renewWriter !== "function") {
      const error = new RunCoordinatorError("event journal cannot renew writer leases", "LEASE_RENEWAL_UNAVAILABLE");
      this.#recordLeaseFailure(active, error);
      throw error;
    }
    try {
      const renewed = await this.eventJournal.renewWriter(active.runId, {
        lease: active.lease,
        ttlMs: this.leaseTtlMs,
      });
      active.lease = renewed;
      return renewed;
    } catch (cause) {
      this.#recordLeaseFailure(active, cause);
      throw cause;
    }
  }

  async #ensureLeaseForWrite(active) {
    this.#assertLeaseHealthy(active);
    const now = this.clock();
    const nowMs = now instanceof Date ? now.valueOf() : Number(now);
    const expiresAt = Date.parse(active.lease.expiresAt);
    if (Number.isFinite(nowMs) && Number.isFinite(expiresAt)
      && expiresAt - nowMs <= this.leaseRenewalIntervalMs) {
      await this.#renewLease(active);
    }
    this.#assertLeaseHealthy(active);
  }

  async #awaitWithLease(active, operation) {
    this.#assertLeaseHealthy(active);
    return Promise.race([Promise.resolve(operation), active.leaseFailurePromise]);
  }

  async #stopActiveHandles(active, signal) {
    if (active.stopPromise) return active.stopPromise;
    active.stopPromise = (async () => {
      const stopResults = [];
      for (const [nodeId, handle] of active.handles) {
        try {
          const result = await this.nodeExecutor.stop?.(handle, { runId: active.runId, nodeId, signal });
          stopResults.push({ nodeId, status: "STOP_SENT", receiptId: result?.terminal?.receiptId ?? result?.receiptId ?? null });
        } catch (cause) {
          stopResults.push({ nodeId, status: "STOP_FAILED", code: cause?.code ?? "STOP_FAILED" });
        }
      }
      return stopResults;
    })();
    return active.stopPromise;
  }

  async #pollCancel(active) {
    if (!this.planStore?.getCancelRequest || active.cancelRequested) return;
    try {
      const request = await this.planStore.getCancelRequest(active.runId);
      if (!request) return;
      active.cancelRequested = true;
      active.cancelReason = request.reason;
      active.cancelRequest = request;
      active.controller.abort(new RunCoordinatorError("durable cancel request observed", "CANCEL_REQUEST_OBSERVED"));
      // A backend stop call is advisory and may never resolve.  Heartbeat
      // renewal must not be held behind it: the coordinator has already
      // closed admission and will settle orphaned unless a correlated
      // terminal proof arrives.  Keep the stop promise observable for the
      // explicit cancel() API without making the journal writer stale.
      void this.#stopActiveHandles(active, active.controller.signal).catch((cause) => {
        active.stopError = cause;
      });
    } catch (cause) {
      // A malformed control request must never be silently ignored. Abort the
      // active run and let the normal non-authoritative/orphan path settle it.
      active.cancelRequested = true;
      active.cancelReason = "cancel-request-invalid";
      active.cancelError = cause;
      active.controller.abort(cause);
    }
  }

  #startLeaseHeartbeat(active) {
    let stopped = false;
    const tick = async () => {
      if (stopped || active.leaseFailure) return;
      await this.#pollCancel(active);
      const renewal = this.#renewLease(active);
      active.leaseRenewal = renewal;
      try {
        await renewal;
      } catch {
        // #renewLease records the fencing/renewal failure and aborts children.
        return;
      } finally {
        if (active.leaseRenewal === renewal) active.leaseRenewal = null;
      }
      if (!stopped && !active.leaseFailure) {
        active.leaseTimer = this.scheduler.setTimeout(tick, this.leaseRenewalIntervalMs);
      }
    };
    active.stopLeaseHeartbeat = async () => {
      stopped = true;
      if (active.leaseTimer !== undefined) this.scheduler.clearTimeout(active.leaseTimer);
      await active.leaseRenewal?.catch(() => {});
    };
    active.leaseTimer = this.scheduler.setTimeout(tick, this.leaseRenewalIntervalMs);
  }

  #writer(active) {
    if (active.writeTail) return;
    active.writeTail = Promise.resolve();
  }

  async #append(active, event) {
    this.#assertLeaseHealthy(active);
    this.#writer(active);
    const operation = active.writeTail.then(async () => {
      await this.#ensureLeaseForWrite(active);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await this.#ensureLeaseForWrite(active);
        const current = await this.eventJournal.read(active.runId, { repairTrailingPartial: true, lease: active.lease });
        try {
          const result = await this.eventJournal.append(active.runId, event, {
            lease: active.lease,
            expectedSeq: current.lastSeq,
            expectedDigest: current.lastEventDigest,
          });
          return result;
        } catch (cause) {
          if (cause?.code !== "JOURNAL_CAS_MISMATCH" || attempt === 7) throw cause;
        }
      }
      fail("event append retry exhausted", "EVENT_APPEND_RETRY_EXHAUSTED");
    });
    active.writeTail = operation.catch(() => {});
    return operation;
  }

  #event(active, type, values = {}) {
    return {
      eventId: values.eventId ?? this.idFactory(type.toLowerCase(), { runId: active.runId, nodeId: values.nodeId ?? null }),
      type,
      revision: values.revision ?? active.plan.revision.number,
      nodeId: values.nodeId ?? null,
      attemptId: values.attemptId ?? null,
      childId: values.childId ?? null,
      swarmRunId: values.swarmRunId ?? null,
      payload: safeProjection(values.payload ?? {}, 48 * 1024),
    };
  }

  async #snapshot(active, projection) {
    await this.#ensureLeaseForWrite(active);
    const current = await this.eventJournal.read(active.runId, { repairTrailingPartial: true, lease: active.lease });
    return this.eventJournal.writeSnapshot(active.runId, {
      activeRevision: active.plan.revision.number,
      state: projection,
    }, {
      lease: active.lease,
      expectedSeq: current.lastSeq,
      expectedDigest: current.lastEventDigest,
    });
  }

  async #project(active) {
    await this.#ensureLeaseForWrite(active);
    const recovered = await this.eventJournal.read(active.runId, { repairTrailingPartial: true, lease: active.lease });
    return { recovered, projection: projectWorkflowRun(recovered.events, active.plan, active.runId) };
  }

  async #settleRoot(active, outcome, details = {}) {
    const status = terminalRunStatus(outcome);
    const eventType = terminalEventType(status);
    await this.#append(active, this.#event(active, eventType, {
      eventId: `run-terminal:${active.plan.revision.number}`,
      payload: {
        status,
        outcome,
        planDigest: active.plan.planDigest,
        details: safeProjection(details, 8192),
      },
    }));
    const { projection } = await this.#project(active);
    await this.#snapshot(active, projection);
    return projection;
  }

  async #settleCancellation(active, projection) {
    if (projection.status !== "stopping") {
      await this.#append(active, this.#event(active, "RunStopping", {
        eventId: `run-stopping:${active.plan.revision.number}`,
        payload: { reason: active.cancelReason ?? "cancel-requested" },
      }));
    }
    return this.#settleRoot(active, "orphaned", {
      reason: active.cancelReason ?? "terminal-proof-unavailable-after-cancel",
    });
  }

  #nodeDeadline(active, node) {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(active.controller.signal.reason);
    if (active.controller.signal.aborted) forwardAbort();
    else active.controller.signal.addEventListener("abort", forwardAbort, { once: true });
    let rejectTimeout;
    const timeoutPromise = new Promise((_, reject) => { rejectTimeout = reject; });
    timeoutPromise.catch(() => {});
    const timer = this.scheduler.setTimeout(() => {
      const error = new RunCoordinatorError(`node ${node.id} exceeded its ${node.budget.timeoutMs}ms deadline`, "NODE_TIMEOUT", {
        nodeId: node.id,
        timeoutMs: node.budget.timeoutMs,
      });
      rejectTimeout(error);
      controller.abort(error);
    }, node.budget.timeoutMs);
    return {
      signal: controller.signal,
      wait: (operation) => this.#awaitWithLease(active, Promise.race([Promise.resolve(operation), timeoutPromise])),
      dispose: () => {
        this.scheduler.clearTimeout(timer);
        active.controller.signal.removeEventListener("abort", forwardAbort);
      },
    };
  }

  async #runPrimitive(active, node, attemptId, approvalReceipt, execution = {}, authorization = null) {
    this.#assertLeaseHealthy(active);
    const normalize = (value, extra = {}) => normalizeTerminal(value, {
      runId: active.runId,
      nodeId: node.id,
      attemptId,
      maxOutputBytes: node.budget.maxOutputBytes,
      ...extra,
    });
    const signal = execution.signal ?? active.controller.signal;
    const wait = execution.wait ?? ((operation) => this.#awaitWithLease(active, operation));
    const leaseContext = {
      renewLease: () => this.#renewLease(active),
    };
    if (node.kind === "agent") {
      if (typeof this.nodeExecutor.startAgent === "function") {
        const childId = `${node.id}:${attemptId}`;
        await this.#append(active, this.#event(active, "ChildStarted", {
          eventId: `child-started:${attemptId}`,
          nodeId: node.id,
          attemptId,
          childId,
          payload: { handleId: null, backendId: null, startRequested: true },
        }));
        active.physicalAttempts.set(node.id, (active.physicalAttempts.get(node.id) ?? 0) + 1);
        const started = await wait(this.nodeExecutor.startAgent(node, {
          runId: active.runId,
          revision: active.plan.revision.number,
          attemptId,
          input: active.input,
          inputDigest: active.inputDigest,
          signal,
          authorization,
          ...leaseContext,
        }));
        const handle = started?.handle ?? null;
        if (handle) active.handles.set(node.id, handle);
        const value = await wait(started.terminal);
        return normalize(value);
      }
      if (typeof this.nodeExecutor.runAgent !== "function") return normalize({ outcome: "unavailable", authoritative: false }, { fallbackOutcome: "unavailable" });
      await this.#append(active, this.#event(active, "ChildStarted", {
        eventId: `child-started:${attemptId}`,
        nodeId: node.id,
        attemptId,
        childId: `${node.id}:${attemptId}`,
        payload: { localOnly: true },
      }));
      active.physicalAttempts.set(node.id, (active.physicalAttempts.get(node.id) ?? 0) + 1);
      const value = await wait(this.nodeExecutor.runAgent(node, {
        runId: active.runId,
        revision: active.plan.revision.number,
        attemptId,
        input: active.input,
        inputDigest: active.inputDigest,
        signal,
        authorization,
        ...leaseContext,
      }));
      return normalize(value);
    }
    if (node.kind === "batch-swarm") {
      if (typeof this.nodeExecutor.runBatch !== "function") return normalize({ outcome: "unavailable", authoritative: false }, { fallbackOutcome: "unavailable" });
      await this.#append(active, this.#event(active, "ChildStarted", {
        eventId: `child-started:${attemptId}`,
        nodeId: node.id,
        attemptId,
        childId: `${node.id}:${attemptId}`,
        payload: { localOnly: true, batch: true },
      }));
      active.physicalAttempts.set(node.id, (active.physicalAttempts.get(node.id) ?? 0) + 1);
      return normalize(await wait(this.nodeExecutor.runBatch(node, { runId: active.runId, revision: active.plan.revision.number, attemptId, input: active.input, inputDigest: active.inputDigest, signal, authorization, ...leaseContext })));
    }
    if (node.kind === "gate") {
      if (!this.gateRunner?.run) return normalize({ status: "FAIL", error: { code: "GATE_RUNNER_UNAVAILABLE" } });
      const result = await wait(this.gateRunner.run(node.gateId, { runId: active.runId, input: active.input, inputDigest: active.inputDigest, signal, ...leaseContext }));
      const outcome = result?.status === "PASS" ? "completed" : "failed";
      await this.#append(active, this.#event(active, "GateEvaluated", {
        eventId: `gate-evaluated:${attemptId}`,
        nodeId: node.id,
        attemptId,
        payload: { outcome, gateId: node.gateId, receiptDigest: result?.digest ?? result?.receiptDigest ?? digestWorkflowValue(safeProjection(result)) },
      }));
      return normalize({ ...result, outcome, authoritative: true });
    }
    if (node.kind === "checkpoint") {
      if (!this.checkpointService?.create) return normalize({ outcome: "unavailable", authoritative: false }, { fallbackOutcome: "unavailable" });
      const result = await wait(this.checkpointService.create(node.checkpoint, { runId: active.runId, input: active.input, inputDigest: active.inputDigest, signal, ...leaseContext }));
      return normalize({ outcome: "completed", authoritative: true, result });
    }
    if (node.kind === "approval") {
      const verdict = await wait(this.#verifyApproval(active, approvalReceipt, node, "approval-node", true));
      return normalize({ outcome: verdict.ok ? "completed" : "failed", authoritative: true, result: verdict });
    }
    if (node.kind === "loop-controller") {
      if (!this.loopController?.evaluate) return normalize({ outcome: "unavailable", authoritative: false }, { fallbackOutcome: "unavailable" });
      const result = await wait(this.loopController.evaluate(node.loop, { runId: active.runId, input: active.input, inputDigest: active.inputDigest, signal, ...leaseContext }));
      return normalize({ outcome: result?.settled ? "completed" : "failed", authoritative: true, result });
    }
    return normalize({ outcome: "unavailable", authoritative: false }, { fallbackOutcome: "unavailable" });
  }

  async #runNode(active, node, approvalReceipt) {
    await this.#append(active, this.#event(active, "NodeQueued", {
      eventId: `node-queued:${active.plan.revision.number}:${node.id}`,
      nodeId: node.id,
      payload: { nodeDigest: digestWorkflowValue(node), needs: node.needs },
    }));
    let lastTerminal = null;
    const historicalAttempts = active.physicalAttempts.get(node.id) ?? 0;
    for (let localAttempt = 1; localAttempt <= node.budget.maxAttempts - historicalAttempts; localAttempt += 1) {
      const attemptNumber = historicalAttempts + localAttempt;
      if (active.cancelRequested || active.pauseRequested) return { outcome: active.cancelRequested ? "cancelled" : "interrupted", terminal: null };
      let authorization = null;
      if (nodeMutates(node)) {
        const verdict = await this.#verifyApproval(active, approvalReceipt, node, "mutating-node-admission");
        if (!verdict?.ok) return { outcome: "awaiting-approval", terminal: null, verdict };
        if (this.nodeExecutor.capabilities?.pathEnforcement !== "ENFORCED") {
          const terminal = normalizeTerminal({
            outcome: "unavailable",
            authoritative: true,
            error: { code: "WRITER_PATH_ENFORCEMENT_UNAVAILABLE" },
          }, { runId: active.runId, nodeId: node.id, attemptId: `${node.id}:path-enforcement-unavailable`, maxOutputBytes: node.budget.maxOutputBytes });
          await this.#append(active, this.#event(active, "NodeSettled", {
            eventId: `node-settled:${active.plan.revision.number}:${node.id}`,
            nodeId: node.id,
            payload: { outcome: "unavailable", resultDigest: null, errorCode: "WRITER_PATH_ENFORCEMENT_UNAVAILABLE" },
          }));
          return { outcome: "unavailable", terminal };
        }
        authorization = verdict.authorization;
      }
      const attemptId = `${node.id}:attempt-${attemptNumber}:${this.idFactory("attempt").slice(-12)}`;
      const reservationId = `${node.id}:reservation-${attemptNumber}:${attemptId.slice(-12)}`;
      try {
        await this.#ensureLeaseForWrite(active);
        await this.budgetLedger.reserve(active.runId, {
          reservationId,
          ownerId: node.id,
          nodeId: node.id,
          attemptId,
          worstCase: reservationVector(node),
        }, { lease: active.lease, revision: active.plan.revision.number });
      } catch (cause) {
        if (["BUDGET_EXHAUSTED", "METERING_UNAVAILABLE"].includes(cause?.code)) {
          const outcome = cause.code === "BUDGET_EXHAUSTED" ? "budget-exhausted" : "unavailable";
          await this.#append(active, this.#event(active, "NodeSettled", {
            eventId: `node-settled:${active.plan.revision.number}:${node.id}`,
            nodeId: node.id,
            payload: { outcome, resultDigest: null, errorCode: cause.code },
          }));
          return { outcome, terminal: null };
        }
        throw cause;
      }
      await this.#append(active, this.#event(active, "NodeAdmitted", {
        eventId: `node-admitted:${attemptId}`,
        nodeId: node.id,
        attemptId,
        payload: { reservationId, attemptNumber },
      }));
      let terminal;
      const deadline = this.#nodeDeadline(active, node);
      try {
        terminal = await deadline.wait(this.#runPrimitive(active, node, attemptId, approvalReceipt, deadline, authorization));
      } catch (cause) {
        const timedOut = cause?.code === "NODE_TIMEOUT";
        terminal = normalizeTerminal({
          outcome: timedOut ? "timed-out" : active.cancelRequested ? "orphaned" : "failed",
          authoritative: false,
          error: {
            code: timedOut ? "BUDGET_OVERRUN" : cause.code ?? "NODE_EXECUTION_ERROR",
            reason: timedOut ? "NODE_TIMEOUT" : undefined,
            message: cause.message,
          },
        }, { runId: active.runId, nodeId: node.id, attemptId, maxOutputBytes: node.budget.maxOutputBytes });
        if (timedOut) {
          terminal = asBudgetOverrunTerminal(terminal, node, {
            outcome: "timed-out",
            overruns: [{ resource: "elapsedMs", limit: node.budget.timeoutMs, observed: null }],
          });
        }
      } finally {
        deadline.dispose();
      }
      terminal = asBudgetOverrunTerminal(terminal, node);
      lastTerminal = terminal;
      const settledOutcome = terminal.authoritative === true
        || ["orphaned", "interrupted", "unavailable"].includes(terminal.outcome)
        ? terminal.outcome
        : "orphaned";
      if (["agent", "batch-swarm"].includes(node.kind)) {
        await this.#append(active, this.#event(active, "ChildTerminal", {
          eventId: `child-terminal:${attemptId}`,
          nodeId: node.id,
          attemptId,
          childId: terminal.handle?.handleId ?? `${node.id}:${attemptId}`,
          payload: {
            outcome: terminal.outcome,
            authoritative: terminal.authoritative,
            receiptId: terminal.receiptId,
            resultDigest: digestWorkflowValue(terminal.result),
            errorCode: terminal.error?.code ?? null,
          },
        }));
      }
      await this.#ensureLeaseForWrite(active);
      await this.budgetLedger.settle(active.runId, reservationId, {
        consumed: terminal.budgetOverrun ? reservationVector(node) : usageVector(node, terminal),
        revision: active.plan.revision.number,
        nodeId: node.id,
        attemptId,
      }, { lease: active.lease });
      const retryable = !SUCCESS_NODE_OUTCOMES.has(terminal.outcome)
        && settledOutcome === "failed"
        && attemptNumber < node.budget.maxAttempts
        && node.idempotency !== "none";
      if (retryable) continue;
      await this.#append(active, this.#event(active, "NodeSettled", {
        eventId: `node-settled:${active.plan.revision.number}:${node.id}`,
        nodeId: node.id,
        payload: {
          outcome: settledOutcome,
          authoritative: terminal.authoritative,
          receiptId: terminal.receiptId,
          resultDigest: digestWorkflowValue(terminal.result),
          attempts: attemptNumber,
          errorCode: terminal.error?.code ?? null,
        },
      }));
      active.handles.delete(node.id);
      return { outcome: settledOutcome, terminal };
    }
    return { outcome: lastTerminal?.outcome ?? "failed", terminal: lastTerminal };
  }

  async execute(plan, options = {}) {
    const checked = validateWorkflowPlan(plan);
    if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
    const runId = canonicalRunId(options.runId ?? this.idFactory("workflow-run"));
    const input = normalizeRunInput(options.input);
    const inputDigest = digestWorkflowValue(input);
    const suppliedEnvelope = options.executionEnvelope ?? options.execution ?? null;
    if (suppliedEnvelope?.runId !== undefined && suppliedEnvelope.runId !== runId) {
      fail("execution envelope is bound to a different run", "RUN_ID_DRIFT");
    }
    const executionEnvelope = createExecutionEnvelope(plan, {
      ...(suppliedEnvelope ?? {}),
      runId,
      runInputDigest: inputDigest,
    });
    if (this.active.has(runId)) fail(`run is already active: ${runId}`, "RUN_ALREADY_ACTIVE");
    if (this.planStore) {
      await this.planStore.put({
        runId,
        plan,
        inputDigest,
        sourceHash: executionEnvelope.sourceHash,
        executionEnvelope,
        executionEnvelopeDigest: executionEnvelope.executionEnvelopeDigest,
      });
    }
    const lease = await this.#lease(runId);
    let resolveDone;
    let rejectLeaseFailure;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const leaseFailurePromise = new Promise((_, reject) => { rejectLeaseFailure = reject; });
    leaseFailurePromise.catch(() => {});
    const active = {
      runId,
      plan,
      input,
      inputDigest,
      executionEnvelope,
      lease,
      controller: new AbortController(),
      handles: new Map(),
      physicalAttempts: new Map(),
      cancelRequested: false,
      pauseRequested: false,
      writeTail: Promise.resolve(),
      done,
      resolveDone,
      leaseFailurePromise,
      rejectLeaseFailure,
    };
    this.active.set(runId, active);
    this.#startLeaseHeartbeat(active);
    const onAbort = () => { active.cancelRequested = true; active.controller.abort(); };
    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      let { recovered, projection } = await this.#project(active);
      await this.#pollCancel(active);
      if (recovered.events.length === 0) {
        await this.#append(active, this.#event(active, "RunPlanned", {
          eventId: `run-planned:${plan.revision.number}`,
          payload: {
            planId: plan.id,
            planDigest: plan.planDigest,
            policyDigest: plan.policyDigest,
            runInputDigest: inputDigest,
            executionEnvelopeDigest: executionEnvelope.executionEnvelopeDigest,
            executionEnvelope,
          },
        }));
        ({ recovered, projection } = await this.#project(active));
      } else {
        if (projection.planDigest !== plan.planDigest) fail("requested plan differs from the durable run plan", "PLAN_DRIFT");
        if (projection.runInputDigest === null) fail("durable run has no bound input digest", "RUN_INPUT_UNBOUND");
        if (projection.runInputDigest !== inputDigest) fail("requested input differs from the durable run input", "RUN_INPUT_DRIFT");
        if (projection.executionEnvelopeDigest === null) fail("durable run has no bound execution envelope", "EXECUTION_ENVELOPE_UNBOUND");
        if (projection.executionEnvelopeDigest !== executionEnvelope.executionEnvelopeDigest) fail("requested execution envelope differs from the durable run envelope", "EXECUTION_ENVELOPE_DRIFT");
      }
      if (TERMINAL_RUN_STATES.has(projection.status)) return projection;
      if (active.cancelRequested) return await this.#settleCancellation(active, projection);

      const admittedAttemptIds = new Set(recovered.events
        .filter((event) => event.type === "NodeAdmitted")
        .map((event) => event.attemptId));
      const settledReservationIds = new Set(recovered.events
        .filter((event) => ["BudgetConsumed", "BudgetRefunded"].includes(event.type))
        .map((event) => event.payload.reservationId));
      const outstandingReservations = new Map(recovered.events
        .filter((event) => event.type === "BudgetReserved" && !settledReservationIds.has(event.payload.reservationId))
        .map((event) => [event.payload.reservationId, event]));
      for (const event of recovered.events.filter((candidate) => candidate.type === "ChildStarted")) {
        active.physicalAttempts.set(event.nodeId, (active.physicalAttempts.get(event.nodeId) ?? 0) + 1);
      }

      // A reservation without NodeAdmitted proves that no executor boundary was
      // crossed. Refund this crash window before admission so it cannot pin the
      // parent budget forever.
      for (const [reservationId, event] of outstandingReservations) {
        if (admittedAttemptIds.has(event.attemptId)) continue;
        await this.#ensureLeaseForWrite(active);
        await this.budgetLedger.refund(active.runId, reservationId, {
          lease: active.lease,
          revision: plan.revision.number,
          nodeId: event.nodeId,
          attemptId: event.attemptId,
        });
        outstandingReservations.delete(reservationId);
      }
      ({ recovered, projection } = await this.#project(active));
      const recoveryNodes = Object.values(projection.nodes).filter((node) => node.status === "running" && node.outcome === null);
      for (const projectedNode of recoveryNodes) {
        const node = plan.nodes.find((candidate) => candidate.id === projectedNode.nodeId);
        const unfinishedAttempts = projectedNode.attempts.filter((attempt) => ["admitted", "running"].includes(attempt.status)
          || (attempt.reservationId && outstandingReservations.has(attempt.reservationId)));
        for (const attempt of unfinishedAttempts) {
          const childStarted = attempt.childId !== null;
          if (childStarted && attempt.status !== "interrupted") {
            await this.#append(active, this.#event(active, "ChildTerminal", {
              eventId: `recovery-terminal:${attempt.attemptId}`,
              nodeId: node.id,
              attemptId: attempt.attemptId,
              childId: attempt.childId ?? `${node.id}:${attempt.attemptId}`,
              payload: { outcome: "interrupted", authoritative: false, receiptId: null, resultDigest: null, reason: "coordinator-recovery" },
            }));
          }
          const reservation = attempt.reservationId ? outstandingReservations.get(attempt.reservationId) : null;
          if (reservation) {
            await this.#ensureLeaseForWrite(active);
            if (childStarted) {
              // Once ChildStarted is durable, consumption is unknown. Charge
              // the full reservation; refunding would allow repeated physical
              // assignments to escape maxAssignments across resumes.
              await this.budgetLedger.settle(active.runId, attempt.reservationId, {
                consumed: reservation.payload.worstCase,
                revision: plan.revision.number,
                nodeId: node.id,
                attemptId: attempt.attemptId,
              }, { lease: active.lease });
            } else {
              await this.budgetLedger.refund(active.runId, attempt.reservationId, {
                lease: active.lease,
                revision: plan.revision.number,
                nodeId: node.id,
                attemptId: attempt.attemptId,
              });
            }
            outstandingReservations.delete(attempt.reservationId);
          }
        }
        const replayable = node.idempotency === "content-addressed" && !nodeMutates(node);
        const attemptsExhausted = (active.physicalAttempts.get(node.id) ?? 0) >= node.budget.maxAttempts;
        if (!replayable || attemptsExhausted) {
          const reason = !replayable ? "side-effect-replay-forbidden" : "max-attempts-exhausted-after-recovery";
          await this.#append(active, this.#event(active, "NodeSettled", {
            eventId: `recovery-node-settled:${plan.revision.number}:${node.id}`,
            nodeId: node.id,
            payload: {
              outcome: "interrupted",
              authoritative: false,
              receiptId: null,
              resultDigest: null,
              reason,
            },
          }));
          return await this.#settleRoot(active, "interrupted", { nodeId: node.id, reason });
        }
        await this.#append(active, this.#event(active, "NodeQueued", {
          eventId: `recovery-node-requeued:${plan.revision.number}:${node.id}`,
          nodeId: node.id,
          payload: { nodeDigest: digestWorkflowValue(node), needs: node.needs, recovery: true },
        }));
      }

      await this.#pollCancel(active);
      if (active.cancelRequested) {
        ({ projection } = await this.#project(active));
        return await this.#settleCancellation(active, projection);
      }

      if (planNeedsApproval(plan)) {
        const verdict = await this.#verifyApproval(active, options.approval ?? null, null, "resume");
        if (!verdict?.ok) return await this.#requestApproval(active, verdict, { stage: "resume" });
        if (projection.approval?.receiptDigest !== (verdict.receiptDigest ?? options.approval?.receiptId ?? null)) {
          await this.#append(active, this.#event(active, "RunApproved", {
            eventId: this.idFactory("run-approved", { runId: active.runId }),
            payload: {
              planDigest: plan.planDigest,
              policyDigest: plan.policyDigest,
              revision: plan.revision.number,
              receiptDigest: verdict.receiptDigest ?? options.approval?.receiptId ?? digestWorkflowValue(options.approval),
              executionEnvelopeDigest: executionEnvelope.executionEnvelopeDigest,
            },
          }));
        }
      }
      ({ recovered, projection } = await this.#project(active));
      await this.#pollCancel(active);
      if (active.cancelRequested) return await this.#settleCancellation(active, projection);
      const hadStarted = recovered.events.some((event) => event.type === "RunStarted");
      if (projection.status === "paused" || hadStarted) {
        await this.#append(active, this.#event(active, "RunResumed", { eventId: this.idFactory("run-resumed", { runId: active.runId }), payload: { planDigest: plan.planDigest, executionEnvelopeDigest: executionEnvelope.executionEnvelopeDigest } }));
      } else if (projection.status !== "running") {
        await this.#append(active, this.#event(active, "RevisionActivated", { eventId: `revision-activated:${plan.revision.number}`, payload: { planDigest: plan.planDigest } }));
        await this.#append(active, this.#event(active, "RunStarted", { eventId: `run-started:${plan.revision.number}`, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: executionEnvelope.executionEnvelopeDigest } }));
      }

      while (true) {
        ({ projection } = await this.#project(active));
        await this.#pollCancel(active);
        if (active.cancelRequested) return await this.#settleCancellation(active, projection);
        if (active.pauseRequested) {
          await this.#append(active, this.#event(active, "RunPaused", { eventId: `run-paused:${plan.revision.number}`, payload: { reason: "pause-requested" } }));
          ({ projection } = await this.#project(active));
          await this.#snapshot(active, projection);
          return projection;
        }
        const settled = new Set(Object.values(projection.nodes).filter((node) => SUCCESS_NODE_OUTCOMES.has(node.outcome)).map((node) => node.nodeId));
        if (settled.size === plan.nodes.length) return await this.#settleRoot(active, "completed", { terminalNodeId: plan.terminalNodeId });
        const ready = plan.nodes.filter((node) => {
          const current = projection.nodes[node.id];
          return !current.outcome && !["running"].includes(current.status) && node.needs.every((dependency) => settled.has(dependency));
        });
        if (ready.length === 0) return await this.#settleRoot(active, "failed", { reason: "no-ready-node", projectionDigest: digestWorkflowValue(projection) });
        const results = await Promise.all(ready.map((node) => this.#runNode(active, node, options.approval ?? null)));
        const reapproval = results.find((result) => result.outcome === "awaiting-approval");
        if (reapproval) return await this.#requestApproval(active, reapproval.verdict, { nodeId: ready[results.indexOf(reapproval)]?.id ?? null, stage: "mutating-node-admission" });
        const failure = results.find((result) => !SUCCESS_NODE_OUTCOMES.has(result.outcome));
        if (failure) return await this.#settleRoot(active, failure.outcome, {
          receiptId: failure.terminal?.receiptId ?? null,
          errorCode: failure.terminal?.error?.code ?? null,
        });
      }
    } finally {
      options.signal?.removeEventListener?.("abort", onAbort);
      active.resolveDone?.();
      await active.stopLeaseHeartbeat?.();
      this.active.delete(runId);
      await this.eventJournal.releaseWriter(runId, { lease }).catch(() => {});
    }
  }

  async pause(runId) {
    canonicalRunId(runId);
    const active = this.active.get(runId);
    if (!active) return immutable({ status: "RUN_NOT_ACTIVE", runId });
    active.pauseRequested = true;
    return immutable({ status: "PAUSE_REQUESTED", runId });
  }

  async cancel(runId, options = {}) {
    canonicalRunId(runId);
    const active = this.active.get(runId);
    if (!active) {
      if (!this.planStore?.requestCancel) return immutable({ status: "RUN_NOT_ACTIVE", runId });
      const existing = await this.planStore.get?.(runId);
      if (!existing) return immutable({ status: "RUN_NOT_FOUND", runId });
      const current = await this.inspect(runId, existing.plan);
      if (TERMINAL_RUN_STATES.has(current.projection.status)) {
        return immutable({ status: "RUN_ALREADY_TERMINAL", durable: false, runId, runStatus: current.projection.status });
      }
      const request = await this.planStore.requestCancel(runId, {
        reason: options.reason ?? "cancel-requested",
        requestId: options.requestId,
      });
      return immutable({ status: "CANCEL_REQUESTED", durable: true, runId, request: request.request });
    }
    active.cancelRequested = true;
    active.cancelReason = options.reason ?? "cancel-requested";
    active.controller.abort(new RunCoordinatorError("cancel requested", "CANCEL_REQUESTED"));
    let request = null;
    if (this.planStore?.requestCancel) {
      request = (await this.planStore.requestCancel(runId, {
        reason: active.cancelReason,
        requestId: options.requestId,
      })).request;
    }
    const graceMs = options.graceMs ?? 1000;
    if (!Number.isSafeInteger(graceMs) || graceMs < 0) fail("cancel graceMs must be a non-negative safe integer", "INVALID_CANCEL_GRACE");
    const stopPromise = this.#stopActiveHandles(active, options.signal);
    let stopResults = null;
    let stopTimer;
    try {
      const stopOutcome = await Promise.race([
        stopPromise.then((value) => ({ completed: true, value })),
        new Promise((resolve) => {
          stopTimer = setTimeout(() => resolve({ completed: false }), graceMs);
        }),
      ]);
      stopResults = stopOutcome.completed
        ? stopOutcome.value
        : [...active.handles.keys()].map((nodeId) => ({ nodeId, status: "STOP_PENDING" }));
    } finally {
      if (stopTimer !== undefined) clearTimeout(stopTimer);
    }
    let doneTimer;
    try {
      await Promise.race([
        active.done,
        new Promise((resolve) => { doneTimer = setTimeout(resolve, graceMs); }),
      ]);
    } finally {
      if (doneTimer !== undefined) clearTimeout(doneTimer);
    }
    return immutable({ status: "CANCEL_REQUESTED", durable: Boolean(request), runId, stopResults, request });
  }

  async inspect(runId, plan = undefined) {
    canonicalRunId(runId);
    if (plan === undefined) {
      if (!this.planStore?.get) fail("a durable plan store is required for restart-safe inspection", "PLAN_STORE_UNAVAILABLE");
      const record = await this.planStore.get(runId);
      if (record === null) fail("no durable plan is bound to this run", "PLAN_NOT_FOUND", { runId });
      plan = record.plan;
    }
    const checked = validateWorkflowPlan(plan);
    if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
    const recovered = await this.eventJournal.read(runId);
    return immutable({ recovered, projection: projectWorkflowRun(recovered.events, plan, runId) });
  }

  async resume(runId, options = {}) {
    canonicalRunId(runId);
    if (!this.planStore?.get) fail("a durable plan store is required for resume", "PLAN_STORE_UNAVAILABLE");
    if (!Object.prototype.hasOwnProperty.call(options, "input")) {
      fail("resume requires the original input to be supplied again", "RUN_INPUT_REQUIRED_FOR_RESUME");
    }
    const record = await this.planStore.get(runId);
    if (record === null) fail("no durable plan is bound to this run", "PLAN_NOT_FOUND", { runId });
    const envelope = options.executionEnvelope ?? record.executionEnvelope;
    if (envelope.executionEnvelopeDigest !== record.executionEnvelopeDigest) fail("resume execution envelope differs from durable plan", "EXECUTION_ENVELOPE_DRIFT");
    return this.execute(record.plan, {
      ...options,
      runId,
      input: options.input,
      executionEnvelope: envelope,
    });
  }
}

export function createRunCoordinator(options = {}) {
  return new RunCoordinator(options);
}

export { TERMINAL_RUN_STATES };
