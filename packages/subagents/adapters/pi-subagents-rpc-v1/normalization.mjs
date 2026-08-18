import {
  createTerminalReceipt,
  SubagentsError,
} from "../../domain/index.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function extractPiSubagentsBackendRunMapping(data) {
  const details = data?.details;
  if (!isRecord(details)) {
    throw new SubagentsError("spawn/resume reply is missing structured details", {
      code: "PI_SUBAGENTS_BACKEND_ID_MISSING",
      category: "correlation",
      details: { dataShape: isRecord(data) ? Object.keys(data).sort() : typeof data },
    });
  }
  const backendRunId = nonEmpty(details.runId)
    ? details.runId
    : (nonEmpty(details.asyncId) ? details.asyncId : null);
  if (backendRunId === null) {
    throw new SubagentsError("spawn/resume reply details do not contain a backend run id", {
      code: "PI_SUBAGENTS_BACKEND_ID_MISSING",
      category: "correlation",
      details: { detailKeys: Object.keys(details).sort() },
    });
  }
  return Object.freeze({
    backendRunId,
    ...(nonEmpty(details.asyncId) ? { backendAsyncId: details.asyncId } : {}),
    ...(nonEmpty(details.sessionId) ? { backendSessionId: details.sessionId } : {}),
  });
}

export function piSubagentsEventRunId(value) {
  const event = unwrapPiSubagentsEvent(value);
  for (const candidate of [event?.runId, event?.id, event?.asyncId]) {
    if (nonEmpty(candidate)) return candidate;
  }
  return null;
}

export function unwrapPiSubagentsEvent(value) {
  if (!isRecord(value)) return value;
  if (piSubagentsDirectRunId(value) !== null) return value;
  if (isRecord(value.data) && piSubagentsDirectRunId(value.data) !== null) return value.data;
  if (isRecord(value.detail) && piSubagentsDirectRunId(value.detail) !== null) return value.detail;
  return value;
}

function piSubagentsDirectRunId(value) {
  for (const candidate of [value?.runId, value?.id, value?.asyncId]) {
    if (nonEmpty(candidate)) return candidate;
  }
  return null;
}

export function normalizePiSubagentsTerminalEvidence(value) {
  if (!isRecord(value)) return { completion: null, processTerminal: null };
  const directProof = value.version === 1 && ["observed", "unknown"].includes(value.state);
  const directCompletion = !directProof && piSubagentsEventRunId(value) !== null;
  const completionCandidate = value.completion ?? value.asyncComplete ?? (directCompletion ? value : null);
  const proofCandidate = value.processTerminal
    ?? value.processTerminalProof
    ?? value.terminalProof
    ?? (directProof ? value : null);
  const completion = isRecord(completionCandidate) ? unwrapPiSubagentsEvent(completionCandidate) : null;
  const processTerminal = isRecord(proofCandidate) ? unwrapPiSubagentsEvent(proofCandidate) : null;
  return { completion, processTerminal };
}

function normalizedState(completion) {
  const state = completion?.state ?? completion?.status ?? completion?.outcome;
  return typeof state === "string" ? state.toLowerCase().replaceAll("_", "-") : "";
}

export function classifyPiSubagentsTerminalOutcome({ completion, processTerminal, intent = "run" } = {}) {
  if (processTerminal?.state !== "observed" || !isRecord(completion)) return "orphaned";
  const state = normalizedState(completion);
  if (completion.timedOut === true || state === "timed-out" || state === "timeout") return "timed-out";
  if (completion.budgetExhausted === true || state === "budget-exhausted") return "budget-exhausted";
  if (completion.success === true || ["completed", "complete", "succeeded", "success"].includes(state)) return "completed";
  if (state === "cancelled" || state === "canceled" || (intent === "stop" && state === "stopped")) return "cancelled";
  if (["interrupted", "paused", "stopped"].includes(state)) return "interrupted";
  return "failed";
}

function resultProjection(completion) {
  if (!isRecord(completion)) return null;
  return completion.results ?? completion.result ?? completion.output ?? completion.details ?? null;
}

function terminalError(completion, processTerminal, outcome) {
  if (outcome === "orphaned") {
    return new SubagentsError(
      processTerminal?.state === "unknown"
        ? "pi-subagents process-terminal observer reported unknown state"
        : "pi-subagents terminal evidence is incomplete",
      {
        code: processTerminal?.state === "unknown"
          ? "PI_SUBAGENTS_PROCESS_TERMINAL_UNKNOWN"
          : "PI_SUBAGENTS_TERMINAL_EVIDENCE_INCOMPLETE",
        category: "correlation",
        retryable: true,
        details: {
          hasCompletion: isRecord(completion),
          processTerminalState: processTerminal?.state ?? "missing",
          reason: processTerminal?.reason,
        },
      },
    );
  }
  if (outcome !== "failed") return undefined;
  const upstream = completion?.error;
  return new SubagentsError(upstream?.message ?? "pi-subagents child failed", {
    code: upstream?.code ?? "PI_SUBAGENTS_CHILD_FAILED",
    category: "backend",
    retryable: upstream?.retryable === true,
    details: { upstream },
  });
}

export function createPiSubagentsTerminalReceipt({
  handle,
  bindingId,
  evidence,
  intent = "run",
  startedAt = null,
  settledAt,
} = {}) {
  const { completion, processTerminal } = normalizePiSubagentsTerminalEvidence(evidence);
  const outcome = classifyPiSubagentsTerminalOutcome({ completion, processTerminal, intent });
  return createTerminalReceipt({
    handle,
    bindingId,
    outcome,
    startedAt,
    settledAt,
    completion,
    processTerminal,
    result: resultProjection(completion),
    error: terminalError(completion, processTerminal, outcome),
  });
}
