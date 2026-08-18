import {
  digestValue,
  immutable,
  requireBackendCapability,
  SubagentsError,
} from "../../domain/index.mjs";

const MAX_WORKFLOW_SCRIPT_BYTES = 256 * 1024;

function fail(message, code, details) {
  throw new SubagentsError(message, { code, category: "validation", details });
}

function safeJson(value) {
  return JSON.stringify(value).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

function inlineOutputSchema(agentSpec, assignment) {
  const output = assignment.output ?? agentSpec.outputSchema;
  if (output === null || output === undefined) return undefined;
  if (output.schema !== undefined) return output.schema;
  if (output.value !== undefined) return output.value;
  return undefined;
}

function assertInputs(agentSpec, assignment) {
  if (agentSpec?.kind !== "resolved-agent-spec" || agentSpec?.formatVersion !== 1) {
    throw new TypeError("agentSpec must be a ResolvedAgentSpec");
  }
  if (assignment?.kind !== "task-assignment" || assignment?.formatVersion !== 1) {
    throw new TypeError("assignment must be a TaskAssignment");
  }
  if (assignment.agentSpecHash !== agentSpec.specHash || assignment.agentSpecId !== agentSpec.id) {
    fail("TaskAssignment does not bind the supplied AgentSpec", "COMPILER_AGENT_SPEC_MISMATCH", {
      assignmentId: assignment.assignmentId,
    });
  }
}

export function compileAgentAssignmentToPiWorkflowScript({
  agentSpec,
  assignment,
  capabilityMatrix,
  allowWorktree = false,
  allowModelOverlay = false,
} = {}) {
  assertInputs(agentSpec, assignment);
  const invocation = {
    agent: agentSpec.backendAgentId,
    task: assignment.task.text,
  };
  if (agentSpec.overlayRequirements?.tools === true) {
    if (!capabilityMatrix) fail("tool narrowing requires an explicit backend capability matrix", "TOOL_OVERLAY_CAPABILITY_REQUIRED");
    requireBackendCapability(capabilityMatrix, "toolOverlay");
  }
  const outputSchema = inlineOutputSchema(agentSpec, assignment);
  if (outputSchema !== undefined) {
    if (capabilityMatrix) requireBackendCapability(capabilityMatrix, "structuredOutput");
    invocation.outputSchema = outputSchema;
  }
  if (assignment.ownership.workspace === "managed-worktree") {
    if (!allowWorktree) fail("worktree execution requires explicit compiler admission", "WORKTREE_ADMISSION_REQUIRED");
    if (capabilityMatrix) requireBackendCapability(capabilityMatrix, "worktree");
    invocation.worktree = true;
  }
  if (agentSpec.model.id !== undefined || agentSpec.model.provider !== undefined) {
    if (agentSpec.runtimeMode !== "DYNAMIC_OVERLAY") {
      fail("model overlay requires ResolvedAgentSpec runtimeMode:DYNAMIC_OVERLAY", "MODEL_OVERLAY_RUNTIME_MODE_REQUIRED");
    }
    if (!allowModelOverlay) fail("model overlay requires explicit compiler admission", "MODEL_OVERLAY_ADMISSION_REQUIRED");
    if (capabilityMatrix) requireBackendCapability(capabilityMatrix, "modelOverlay", { allowDegraded: true });
    invocation.model = agentSpec.model.provider === undefined
      ? agentSpec.model.id
      : `${agentSpec.model.provider}/${agentSpec.model.id}`;
  }
  const workflowName = `assignment:${assignment.assignmentId}`;
  const workflowScript = `return await runs.run(${safeJson(workflowName)}, ${safeJson(invocation)});`;
  if (Buffer.byteLength(workflowScript, "utf8") > MAX_WORKFLOW_SCRIPT_BYTES) {
    fail("compiled workflowScript exceeds the audited RPC payload limit", "WORKFLOW_SCRIPT_TOO_LARGE");
  }
  return immutable({
    formatVersion: 1,
    kind: "pi-subagents-rpc-v1-compiled-assignment",
    assignmentId: assignment.assignmentId,
    assignmentHash: assignment.assignmentHash,
    agentSpecHash: agentSpec.specHash,
    workflowScript,
    workflowScriptDigest: digestValue(workflowScript),
  });
}

export function compileAgentAssignmentToPiSpawnRequest(input = {}) {
  const compiled = compileAgentAssignmentToPiWorkflowScript(input);
  return immutable({
    formatVersion: 1,
    kind: "pi-subagents-rpc-v1-spawn-request",
    method: "spawn",
    source: {
      extension: "only-my-pi",
      kind: "schema-validated-workflow-compiler",
      schemaValidated: true,
    },
    params: { workflowScript: compiled.workflowScript, async: true },
    assignmentId: compiled.assignmentId,
    assignmentHash: compiled.assignmentHash,
    agentSpecHash: compiled.agentSpecHash,
    workflowScriptDigest: compiled.workflowScriptDigest,
  });
}

export function assertPiSubagentsRpcV1CompiledSpawn(value) {
  if (value?.formatVersion !== 1
    || value?.kind !== "pi-subagents-rpc-v1-spawn-request"
    || value?.method !== "spawn"
    || value?.source?.extension !== "only-my-pi"
    || value?.source?.kind !== "schema-validated-workflow-compiler"
    || value?.source?.schemaValidated !== true
    || value?.params?.async !== true
    || typeof value?.params?.workflowScript !== "string"
    || value.params.workflowScript.trim().length === 0
    || typeof value?.assignmentHash !== "string"
    || typeof value?.agentSpecHash !== "string"
    || typeof value?.workflowScriptDigest !== "string") {
    fail("spawn requires a schema-validated compiler product", "INVALID_COMPILED_SPAWN");
  }
  if (value.workflowScriptDigest !== digestValue(value.params.workflowScript)) {
    fail("compiled workflowScript digest mismatch", "WORKFLOW_SCRIPT_DIGEST_MISMATCH");
  }
  return value;
}
