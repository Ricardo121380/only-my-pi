import {
  assertDomainId,
  assertOpaqueId,
  assertRecord,
  assertString,
  digestValue,
  immutable,
} from "./shared.mjs";
import { fail } from "./errors.mjs";

function assertHandle(handle) {
  if (handle?.formatVersion !== 1 || handle?.kind !== "agent-run-handle" || typeof handle.handleId !== "string") {
    throw new TypeError("handle must be an AgentRunHandle");
  }
  return handle;
}

export function createAgentRunHandle(input = {}) {
  assertRecord(input, "AgentRunHandle");
  const assignment = input.assignment;
  const agentSpec = input.agentSpec;
  if (assignment?.kind !== "task-assignment") throw new TypeError("AgentRunHandle.assignment must be a TaskAssignment");
  if (agentSpec?.kind !== "resolved-agent-spec") throw new TypeError("AgentRunHandle.agentSpec must be a ResolvedAgentSpec");
  if (assignment.agentSpecHash !== agentSpec.specHash) fail("AgentRunHandle assignment/spec mismatch", "HANDLE_AGENT_SPEC_MISMATCH", { category: "correlation" });
  const local = {
    runId: assertDomainId(input.runId, "AgentRunHandle.runId"),
    nodeId: assertDomainId(input.nodeId, "AgentRunHandle.nodeId"),
    attemptId: assertDomainId(input.attemptId, "AgentRunHandle.attemptId"),
    assignmentId: assignment.assignmentId,
    assignmentHash: assignment.assignmentHash,
    agentSpecId: agentSpec.id,
    agentSpecHash: agentSpec.specHash,
  };
  const handleId = digestValue({ kind: "agent-run-handle", ...local });
  return immutable({
    formatVersion: 1,
    kind: "agent-run-handle",
    handleId,
    local,
    continuable: agentSpec.continuable,
    resumable: agentSpec.resumable,
    backendId: null,
    backendBindings: [],
    activeBindingId: null,
  });
}

export function bindBackendRun(handle, input = {}) {
  assertHandle(handle);
  assertRecord(input, "backend binding");
  const backendId = assertDomainId(input.backendId, "backend binding.backendId");
  if (handle.backendId !== null && handle.backendId !== backendId) fail("AgentRunHandle cannot switch backend", "HANDLE_BACKEND_MISMATCH", { category: "correlation" });
  const lifecycle = input.lifecycle ?? (handle.backendBindings.length === 0 ? "launch" : "resume");
  if (lifecycle !== "launch" && lifecycle !== "resume") throw new TypeError("backend binding.lifecycle must be launch or resume");
  if (lifecycle === "launch" && handle.backendBindings.length !== 0) fail("AgentRunHandle already has an initial backend binding", "HANDLE_ALREADY_BOUND", { category: "correlation" });
  if (lifecycle === "resume" && handle.backendBindings.length === 0) fail("resume binding requires an initial backend binding", "HANDLE_RESUME_WITHOUT_PARENT", { category: "correlation" });
  const requestId = assertOpaqueId(input.requestId, "backend binding.requestId");
  const backendRunId = assertOpaqueId(input.backendRunId, "backend binding.backendRunId");
  const parentBindingId = lifecycle === "resume" ? (input.parentBindingId ?? handle.activeBindingId) : null;
  if (lifecycle === "resume" && !handle.backendBindings.some((entry) => entry.bindingId === parentBindingId)) fail("resume binding parent is unknown", "HANDLE_BINDING_PARENT_UNKNOWN", { category: "correlation" });
  const value = {
    backendId,
    backendVersion: assertString(input.backendVersion, "backend binding.backendVersion", { maximum: 128 }),
    protocolVersion: input.protocolVersion,
    lifecycle,
    requestId,
    backendRunId,
    ...(input.backendAsyncId === undefined ? {} : { backendAsyncId: assertOpaqueId(input.backendAsyncId, "backend binding.backendAsyncId") }),
    ...(input.backendSessionId === undefined ? {} : { backendSessionId: assertOpaqueId(input.backendSessionId, "backend binding.backendSessionId") }),
    ...(parentBindingId === null ? {} : { parentBindingId }),
  };
  if (!Number.isSafeInteger(value.protocolVersion) || value.protocolVersion < 1) throw new TypeError("backend binding.protocolVersion must be a positive integer");
  const bindingId = digestValue({ handleId: handle.handleId, ...value });
  const duplicateRequest = handle.backendBindings.find((entry) => entry.requestId === requestId);
  if (duplicateRequest) {
    if (duplicateRequest.bindingId === bindingId) return handle;
    fail("backend request id is already mapped to a different run", "HANDLE_REQUEST_ID_CONFLICT", { category: "correlation" });
  }
  const binding = { ...value, bindingId };
  return immutable({
    ...handle,
    backendId,
    backendBindings: [...handle.backendBindings, binding],
    activeBindingId: bindingId,
  });
}

export function activeBackendBinding(handle) {
  assertHandle(handle);
  if (!handle.activeBindingId) fail("AgentRunHandle is not bound to a backend run", "HANDLE_BACKEND_UNBOUND", { category: "correlation" });
  const binding = handle.backendBindings.find((entry) => entry.bindingId === handle.activeBindingId);
  if (!binding) fail("AgentRunHandle active binding is missing", "HANDLE_BINDING_MISSING", { category: "correlation" });
  return binding;
}

export function assertBackendCorrelation(handle, event, { bindingId } = {}) {
  assertHandle(handle);
  assertRecord(event, "backend event");
  const binding = bindingId === undefined
    ? activeBackendBinding(handle)
    : handle.backendBindings.find((entry) => entry.bindingId === bindingId);
  if (!binding) fail("backend event references an unknown binding", "BACKEND_EVENT_BINDING_UNKNOWN", { category: "correlation" });
  const runId = event.runId ?? event.id ?? event.asyncId;
  if (runId !== binding.backendRunId && runId !== binding.backendAsyncId) {
    fail("backend event run id does not match the stable handle", "BACKEND_EVENT_CORRELATION_MISMATCH", {
      category: "correlation",
      details: { handleId: handle.handleId, bindingId: binding.bindingId, expectedRunId: binding.backendRunId, actualRunId: runId },
    });
  }
  return binding;
}
