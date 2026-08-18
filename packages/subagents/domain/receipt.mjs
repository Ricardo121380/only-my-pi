import {
  assertSafeInteger,
  boundedProjection,
  digestValue,
  immutable,
  isRecord,
} from "./shared.mjs";
import { activeBackendBinding, assertBackendCorrelation } from "./handle.mjs";
import { errorReceiptProjection, fail } from "./errors.mjs";

export const AGENT_TERMINAL_OUTCOMES = Object.freeze([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "orphaned",
  "timed-out",
  "budget-exhausted",
  "unavailable",
]);

const REQUIRES_OBSERVED_PROCESS = new Set(["completed", "failed", "cancelled", "timed-out", "budget-exhausted"]);

function terminalProofProjection(proof, binding) {
  if (proof === undefined || proof === null) return null;
  if (!isRecord(proof) || proof.version !== 1 || !["observed", "unknown"].includes(proof.state)) {
    throw new TypeError("terminal proof must be a terminal ProcessTerminalV1 projection");
  }
  const proofRunId = proof.runId;
  if (proofRunId !== binding.backendRunId && proofRunId !== binding.backendAsyncId) fail("process terminal proof is not correlated", "TERMINAL_PROOF_CORRELATION_MISMATCH", { category: "correlation" });
  if (proof.state === "observed") {
    if (typeof proof.runnerProcessInstanceId !== "string" || proof.runnerProcessInstanceId.length === 0
      || !Number.isSafeInteger(proof.observedAt)
      || !Array.isArray(proof.instances)) {
      throw new TypeError("observed terminal proof is incomplete");
    }
    if (!proof.instances.some((instance) => instance?.processInstanceId === proof.runnerProcessInstanceId)) {
      throw new TypeError("observed terminal proof does not contain its runner process instance");
    }
  } else if (typeof proof.reason !== "string" || proof.reason.length === 0) {
    throw new TypeError("unknown terminal proof requires a reason");
  }
  return boundedProjection(proof, 32 * 1024);
}

export function createTerminalReceipt(input = {}) {
  const { handle } = input;
  const binding = input.bindingId === undefined
    ? activeBackendBinding(handle)
    : handle.backendBindings.find((entry) => entry.bindingId === input.bindingId);
  if (!binding) fail("terminal receipt binding is unknown", "TERMINAL_BINDING_UNKNOWN", { category: "correlation" });
  if (!AGENT_TERMINAL_OUTCOMES.includes(input.outcome)) throw new TypeError("terminal receipt outcome is invalid");
  if (input.completion !== undefined && input.completion !== null) assertBackendCorrelation(handle, input.completion, { bindingId: binding.bindingId });
  const processTerminal = terminalProofProjection(input.processTerminal, binding);
  const authoritative = processTerminal?.state === "observed" && input.completion !== undefined && input.completion !== null;
  if (REQUIRES_OBSERVED_PROCESS.has(input.outcome) && !authoritative) {
    fail(`terminal outcome ${input.outcome} requires correlated completion and observed process proof`, "TERMINAL_PROOF_REQUIRED", { category: "correlation" });
  }
  const settledAt = assertSafeInteger(input.settledAt, "terminal receipt.settledAt");
  const startedAt = input.startedAt === undefined || input.startedAt === null
    ? null
    : assertSafeInteger(input.startedAt, "terminal receipt.startedAt");
  if (startedAt !== null && settledAt < startedAt) throw new TypeError("terminal receipt settledAt precedes startedAt");
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/terminal-receipt-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    kind: "agent-terminal-receipt",
    handleId: handle.handleId,
    runId: handle.local.runId,
    nodeId: handle.local.nodeId,
    attemptId: handle.local.attemptId,
    assignmentId: handle.local.assignmentId,
    assignmentHash: handle.local.assignmentHash,
    agentSpecHash: handle.local.agentSpecHash,
    backendId: binding.backendId,
    bindingId: binding.bindingId,
    backendRunId: binding.backendRunId,
    outcome: input.outcome,
    authoritative,
    startedAt,
    settledAt,
    completion: input.completion === undefined ? null : boundedProjection(input.completion, 64 * 1024),
    processTerminal,
    result: input.result === undefined ? null : boundedProjection(input.result, 64 * 1024),
    error: input.error === undefined ? null : errorReceiptProjection(input.error),
  };
  return immutable({ ...value, receiptId: digestValue(value) });
}
