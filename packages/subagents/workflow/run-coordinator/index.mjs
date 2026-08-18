import crypto from "node:crypto";

import {
  digestWorkflowValue,
  validateWorkflowPlan,
} from "../plan-compiler/index.mjs";

const TERMINAL_RUN_STATES = new Set([
  "completed", "failed", "cancelled", "interrupted", "orphaned",
  "timed-out", "budget-exhausted", "unavailable",
]);
const SUCCESS_NODE_OUTCOMES = new Set(["completed", "pass"]);
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

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

function normalizeTerminal(value, { runId, nodeId, attemptId, fallbackOutcome = "failed" } = {}) {
  const receipt = value?.terminal ?? value?.receipt ?? value;
  const outcome = receipt?.outcome
    ?? (receipt?.status === "PASS" ? "completed" : receipt?.status === "FAIL" ? "failed" : fallbackOutcome);
  const authoritative = receipt?.authoritative ?? !["orphaned", "interrupted"].includes(outcome);
  if (receipt?.runId !== undefined && receipt.runId !== runId) fail("terminal receipt run correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  if (receipt?.nodeId !== undefined && receipt.nodeId !== nodeId) fail("terminal receipt node correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  if (receipt?.attemptId !== undefined && receipt.attemptId !== attemptId) fail("terminal receipt attempt correlation mismatch", "TERMINAL_CORRELATION_MISMATCH");
  return immutable({
    outcome,
    authoritative,
    receiptId: receipt?.receiptId ?? digestWorkflowValue({ runId, nodeId, attemptId, outcome, authoritative, result: safeProjection(receipt?.result ?? receipt) }),
    result: safeProjection(receipt?.result ?? receipt?.data ?? null),
    usage: safeProjection(receipt?.usage ?? value?.usage ?? null, 4096),
    error: safeProjection(receipt?.error ?? value?.error ?? null, 4096),
    handle: value?.handle ?? receipt?.handle ?? null,
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
        state.status = "planned";
        break;
      case "ApprovalRequested": state.status = "awaiting-approval"; break;
      case "RunApproved": state.approval = clone(event.payload); state.status = "admitted"; break;
      case "RevisionActivated": state.activeRevision = event.revision; break;
      case "RunStarted": state.status = "running"; break;
      case "RunPaused": state.status = "paused"; state.admissionClosed = true; break;
      case "RunResumed": state.status = "running"; state.admissionClosed = false; break;
      case "RunStopping": state.status = "stopping"; state.admissionClosed = true; break;
      case "NodeQueued": if (node.status === "planned") node.status = "queued"; break;
      case "NodeAdmitted":
        node.status = "running";
        if (!node.attempts.some((attempt) => attempt.attemptId === event.attemptId)) {
          node.attempts.push({ attemptId: event.attemptId, status: "admitted", childId: null, terminal: null });
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
        node.status = event.payload.outcome;
        node.outcome = event.payload.outcome;
        node.resultDigest = event.payload.resultDigest ?? null;
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

function defaultApprovalVerifier(receipt, plan) {
  if (!object(receipt)) return { ok: false, code: "APPROVAL_REQUIRED" };
  if (receipt.planDigest !== plan.planDigest) return { ok: false, code: "APPROVAL_PLAN_DRIFT" };
  if (receipt.policyDigest !== plan.policyDigest) return { ok: false, code: "APPROVAL_POLICY_DRIFT" };
  if (receipt.revision !== plan.revision.number) return { ok: false, code: "APPROVAL_REVISION_DRIFT" };
  return { ok: true, receiptDigest: receipt.receiptDigest ?? digestWorkflowValue(receipt) };
}

function usageVector(node, terminal) {
  const vector = {};
  if (["agent", "batch-swarm"].includes(node.kind)) vector.assignments = 1;
  const serialized = JSON.stringify(terminal.result ?? null);
  vector.rawOutputBytes = Math.min(node.budget.maxOutputBytes, Buffer.byteLength(serialized, "utf8"));
  if (Number.isFinite(terminal.usage?.elapsedMs)) vector.elapsedMs = Math.min(node.budget.timeoutMs, terminal.usage.elapsedMs);
  else vector.elapsedMs = 0;
  if (node.budget.maxTokens !== null) vector.tokens = Math.min(node.budget.maxTokens, terminal.usage?.tokens ?? 0);
  if (node.budget.maxCostUsd !== null) vector.cost = Math.min(node.budget.maxCostUsd, terminal.usage?.costUsd ?? terminal.usage?.cost ?? 0);
  return vector;
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
    this.nodeExecutor = options.nodeExecutor ?? {};
    this.gateRunner = options.gateRunner ?? null;
    this.approvalVerifier = options.approvalVerifier ?? { verify: defaultApprovalVerifier };
    this.checkpointService = options.checkpointService ?? null;
    this.loopController = options.loopController ?? null;
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? ((prefix) => `${prefix}-${crypto.randomUUID()}`);
    this.writerId = options.writerId ?? "only-my-pi-run-coordinator";
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
    this.active = new Map();
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

  #writer(active) {
    if (active.writeTail) return;
    active.writeTail = Promise.resolve();
  }

  async #append(active, event) {
    this.#writer(active);
    const operation = active.writeTail.then(async () => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
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

  async #runPrimitive(active, node, attemptId, approvalReceipt) {
    if (node.kind === "agent") {
      if (typeof this.nodeExecutor.startAgent === "function") {
        const started = await this.nodeExecutor.startAgent(node, {
          runId: active.runId,
          revision: active.plan.revision.number,
          attemptId,
          signal: active.controller.signal,
        });
        const handle = started?.handle ?? null;
        if (handle) active.handles.set(node.id, handle);
        const childId = handle?.handleId ?? `${node.id}:${attemptId}`;
        await this.#append(active, this.#event(active, "ChildStarted", {
          eventId: `child-started:${attemptId}`,
          nodeId: node.id,
          attemptId,
          childId,
          payload: { handleId: handle?.handleId ?? null, backendId: handle?.backendId ?? null },
        }));
        const value = await started.terminal;
        return normalizeTerminal(value, { runId: active.runId, nodeId: node.id, attemptId });
      }
      if (typeof this.nodeExecutor.runAgent !== "function") return normalizeTerminal({ outcome: "unavailable", authoritative: false }, { runId: active.runId, nodeId: node.id, attemptId, fallbackOutcome: "unavailable" });
      await this.#append(active, this.#event(active, "ChildStarted", {
        eventId: `child-started:${attemptId}`,
        nodeId: node.id,
        attemptId,
        childId: `${node.id}:${attemptId}`,
        payload: { localOnly: true },
      }));
      const value = await this.nodeExecutor.runAgent(node, {
        runId: active.runId,
        revision: active.plan.revision.number,
        attemptId,
        signal: active.controller.signal,
      });
      return normalizeTerminal(value, { runId: active.runId, nodeId: node.id, attemptId });
    }
    if (node.kind === "batch-swarm") {
      if (typeof this.nodeExecutor.runBatch !== "function") return normalizeTerminal({ outcome: "unavailable", authoritative: false }, { runId: active.runId, nodeId: node.id, attemptId, fallbackOutcome: "unavailable" });
      return normalizeTerminal(await this.nodeExecutor.runBatch(node, { runId: active.runId, revision: active.plan.revision.number, attemptId, signal: active.controller.signal }), { runId: active.runId, nodeId: node.id, attemptId });
    }
    if (node.kind === "gate") {
      if (!this.gateRunner?.run) return normalizeTerminal({ status: "FAIL", error: { code: "GATE_RUNNER_UNAVAILABLE" } }, { runId: active.runId, nodeId: node.id, attemptId });
      const result = await this.gateRunner.run(node.gateId, { signal: active.controller.signal });
      const outcome = result?.status === "PASS" ? "completed" : "failed";
      await this.#append(active, this.#event(active, "GateEvaluated", {
        eventId: `gate-evaluated:${attemptId}`,
        nodeId: node.id,
        attemptId,
        payload: { outcome, gateId: node.gateId, receiptDigest: result?.digest ?? result?.receiptDigest ?? digestWorkflowValue(safeProjection(result)) },
      }));
      return normalizeTerminal({ ...result, outcome, authoritative: true }, { runId: active.runId, nodeId: node.id, attemptId });
    }
    if (node.kind === "checkpoint") {
      if (!this.checkpointService?.create) return normalizeTerminal({ outcome: "unavailable", authoritative: false }, { runId: active.runId, nodeId: node.id, attemptId, fallbackOutcome: "unavailable" });
      const result = await this.checkpointService.create(node.checkpoint, { runId: active.runId, signal: active.controller.signal });
      return normalizeTerminal({ outcome: "completed", authoritative: true, result }, { runId: active.runId, nodeId: node.id, attemptId });
    }
    if (node.kind === "approval") {
      const verdict = this.approvalVerifier.verifyNode
        ? await this.approvalVerifier.verifyNode(approvalReceipt, node.approval, active.plan)
        : approvalReceipt?.scopeDigest === node.approval.scopeDigest || approvalReceipt?.scopeDigests?.includes(node.approval.scopeDigest)
          ? { ok: true }
          : { ok: false, code: "NODE_APPROVAL_REQUIRED" };
      return normalizeTerminal({ outcome: verdict.ok ? "completed" : "failed", authoritative: true, result: verdict }, { runId: active.runId, nodeId: node.id, attemptId });
    }
    if (node.kind === "loop-controller") {
      if (!this.loopController?.evaluate) return normalizeTerminal({ outcome: "unavailable", authoritative: false }, { runId: active.runId, nodeId: node.id, attemptId, fallbackOutcome: "unavailable" });
      const result = await this.loopController.evaluate(node.loop, { runId: active.runId, signal: active.controller.signal });
      return normalizeTerminal({ outcome: result?.settled ? "completed" : "failed", authoritative: true, result }, { runId: active.runId, nodeId: node.id, attemptId });
    }
    return normalizeTerminal({ outcome: "unavailable", authoritative: false }, { runId: active.runId, nodeId: node.id, attemptId, fallbackOutcome: "unavailable" });
  }

  async #runNode(active, node, approvalReceipt) {
    await this.#append(active, this.#event(active, "NodeQueued", {
      eventId: `node-queued:${active.plan.revision.number}:${node.id}`,
      nodeId: node.id,
      payload: { nodeDigest: digestWorkflowValue(node), needs: node.needs },
    }));
    let lastTerminal = null;
    for (let attemptNumber = 1; attemptNumber <= node.budget.maxAttempts; attemptNumber += 1) {
      if (active.cancelRequested || active.pauseRequested) return { outcome: active.cancelRequested ? "cancelled" : "interrupted", terminal: null };
      const attemptId = `${node.id}:attempt-${attemptNumber}:${this.idFactory("attempt").slice(-12)}`;
      const reservationId = `${node.id}:reservation-${attemptNumber}:${attemptId.slice(-12)}`;
      try {
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
      try {
        terminal = await this.#runPrimitive(active, node, attemptId, approvalReceipt);
      } catch (cause) {
        terminal = normalizeTerminal({ outcome: active.cancelRequested ? "orphaned" : "failed", authoritative: false, error: { code: cause.code ?? "NODE_EXECUTION_ERROR", message: cause.message } }, { runId: active.runId, nodeId: node.id, attemptId });
      }
      lastTerminal = terminal;
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
          },
        }));
      }
      await this.budgetLedger.settle(active.runId, reservationId, {
        consumed: usageVector(node, terminal),
        revision: active.plan.revision.number,
        nodeId: node.id,
        attemptId,
      }, { lease: active.lease });
      const retryable = !SUCCESS_NODE_OUTCOMES.has(terminal.outcome)
        && terminal.outcome === "failed"
        && attemptNumber < node.budget.maxAttempts
        && node.idempotency !== "none";
      if (retryable) continue;
      await this.#append(active, this.#event(active, "NodeSettled", {
        eventId: `node-settled:${active.plan.revision.number}:${node.id}`,
        nodeId: node.id,
        payload: {
          outcome: terminal.outcome,
          authoritative: terminal.authoritative,
          receiptId: terminal.receiptId,
          resultDigest: digestWorkflowValue(terminal.result),
          attempts: attemptNumber,
        },
      }));
      active.handles.delete(node.id);
      return { outcome: terminal.outcome, terminal };
    }
    return { outcome: lastTerminal?.outcome ?? "failed", terminal: lastTerminal };
  }

  async execute(plan, options = {}) {
    const checked = validateWorkflowPlan(plan);
    if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
    const runId = canonicalRunId(options.runId ?? this.idFactory("workflow-run"));
    if (this.active.has(runId)) fail(`run is already active: ${runId}`, "RUN_ALREADY_ACTIVE");
    const lease = await this.#lease(runId);
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const active = {
      runId,
      plan,
      lease,
      controller: new AbortController(),
      handles: new Map(),
      cancelRequested: false,
      pauseRequested: false,
      writeTail: Promise.resolve(),
      done,
      resolveDone,
    };
    this.active.set(runId, active);
    const onAbort = () => { active.cancelRequested = true; active.controller.abort(); };
    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    try {
      let { recovered, projection } = await this.#project(active);
      if (recovered.events.length === 0) {
        await this.#append(active, this.#event(active, "RunPlanned", {
          eventId: `run-planned:${plan.revision.number}`,
          payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest },
        }));
        ({ recovered, projection } = await this.#project(active));
      } else if (projection.planDigest !== plan.planDigest) {
        fail("requested plan differs from the durable run plan", "PLAN_DRIFT");
      }
      if (TERMINAL_RUN_STATES.has(projection.status)) return projection;

      const unfinishedAttempts = Object.values(projection.nodes).flatMap((node) => node.attempts.filter((attempt) => ["admitted", "running"].includes(attempt.status)).map((attempt) => ({ node, attempt })));
      for (const { node: projectedNode, attempt } of unfinishedAttempts) {
        const node = plan.nodes.find((candidate) => candidate.id === projectedNode.nodeId);
        await this.#append(active, this.#event(active, "ChildTerminal", {
          eventId: `recovery-terminal:${attempt.attemptId}`,
          nodeId: node.id,
          attemptId: attempt.attemptId,
          childId: attempt.childId ?? `${node.id}:${attempt.attemptId}`,
          payload: { outcome: "interrupted", authoritative: false, receiptId: null, resultDigest: null, reason: "coordinator-recovery" },
        }));
        if (node.idempotency === "none" || nodeMutates(node)) {
          await this.#append(active, this.#event(active, "NodeSettled", {
            eventId: `node-settled:${plan.revision.number}:${node.id}`,
            nodeId: node.id,
            payload: { outcome: "interrupted", authoritative: false, receiptId: null, resultDigest: null, reason: "side-effect-replay-forbidden" },
          }));
          return await this.#settleRoot(active, "interrupted", { nodeId: node.id, reason: "side-effect-replay-forbidden" });
        }
      }

      if (planNeedsApproval(plan) && projection.approval === null) {
        await this.#append(active, this.#event(active, "ApprovalRequested", {
          eventId: `approval-requested:${plan.revision.number}`,
          payload: { planDigest: plan.planDigest, policyDigest: plan.policyDigest, revision: plan.revision.number },
        }));
        const verdict = await this.approvalVerifier.verify(options.approval ?? null, plan);
        if (!verdict?.ok) {
          ({ projection } = await this.#project(active));
          await this.#snapshot(active, projection);
          return projection;
        }
        await this.#append(active, this.#event(active, "RunApproved", {
          eventId: `run-approved:${plan.revision.number}`,
          payload: { planDigest: plan.planDigest, policyDigest: plan.policyDigest, revision: plan.revision.number, receiptDigest: verdict.receiptDigest ?? digestWorkflowValue(options.approval) },
        }));
      }
      ({ projection } = await this.#project(active));
      if (projection.status === "paused") {
        await this.#append(active, this.#event(active, "RunResumed", { eventId: `run-resumed:${plan.revision.number}:${recovered.lastSeq}`, payload: { planDigest: plan.planDigest } }));
      } else if (projection.status !== "running") {
        await this.#append(active, this.#event(active, "RevisionActivated", { eventId: `revision-activated:${plan.revision.number}`, payload: { planDigest: plan.planDigest } }));
        await this.#append(active, this.#event(active, "RunStarted", { eventId: `run-started:${plan.revision.number}`, payload: { planDigest: plan.planDigest } }));
      }

      while (true) {
        ({ projection } = await this.#project(active));
        if (active.cancelRequested) {
          await this.#append(active, this.#event(active, "RunStopping", { eventId: `run-stopping:${plan.revision.number}`, payload: { reason: "cancel-requested" } }));
          return await this.#settleRoot(active, "orphaned", { reason: "terminal-proof-unavailable-after-cancel" });
        }
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
        const failure = results.find((result) => !SUCCESS_NODE_OUTCOMES.has(result.outcome));
        if (failure) return await this.#settleRoot(active, failure.outcome, { receiptId: failure.terminal?.receiptId ?? null });
      }
    } finally {
      options.signal?.removeEventListener?.("abort", onAbort);
      active.resolveDone?.();
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
    if (!active) return immutable({ status: "RUN_NOT_ACTIVE", runId });
    active.cancelRequested = true;
    active.controller.abort();
    const stopResults = [];
    for (const [nodeId, handle] of active.handles) {
      try {
        const result = await this.nodeExecutor.stop?.(handle, { runId, nodeId, signal: options.signal });
        stopResults.push({ nodeId, status: "STOP_SENT", receiptId: result?.terminal?.receiptId ?? result?.receiptId ?? null });
      } catch (cause) {
        stopResults.push({ nodeId, status: "STOP_FAILED", code: cause.code ?? "STOP_FAILED" });
      }
    }
    const graceMs = options.graceMs ?? 1000;
    await Promise.race([active.done, new Promise((resolve) => setTimeout(resolve, graceMs))]);
    return immutable({ status: "CANCEL_REQUESTED", runId, stopResults });
  }

  async inspect(runId, plan) {
    canonicalRunId(runId);
    const checked = validateWorkflowPlan(plan);
    if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
    const recovered = await this.eventJournal.read(runId);
    return immutable({ recovered, projection: projectWorkflowRun(recovered.events, plan, runId) });
  }
}

export function createRunCoordinator(options = {}) {
  return new RunCoordinator(options);
}

export { TERMINAL_RUN_STATES };
