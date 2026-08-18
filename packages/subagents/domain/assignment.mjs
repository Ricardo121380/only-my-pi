import {
  assertDomainId,
  assertRecord,
  assertRelativePath,
  assertSha256,
  assertString,
  digestValue,
  immutable,
  normalizeStringSet,
} from "./shared.mjs";
import { fail } from "./errors.mjs";

const IDEMPOTENCY_CLASSES = new Set(["read-only", "idempotent", "side-effect"]);
const WORKSPACE_CANONICAL = Object.freeze({
  none: "none",
  "read-only": "shared-read-only",
  "shared-read-only": "shared-read-only",
  "guarded-write": "shared-guarded",
  "shared-guarded": "shared-guarded",
  "worktree-write": "managed-worktree",
  "managed-worktree": "managed-worktree",
});
const WORKSPACE_RANK = Object.freeze({ none: 0, "shared-read-only": 1, "shared-guarded": 2, "managed-worktree": 3 });

function normalizeTask(value) {
  const input = typeof value === "string" ? { text: value } : assertRecord(value, "TaskAssignment.task");
  const text = assertString(input.text, "TaskAssignment.task.text", { maximum: 128 * 1024 });
  const digest = digestValue(text);
  if (input.digest !== undefined && assertSha256(input.digest, "TaskAssignment.task.digest") !== digest) {
    fail("TaskAssignment task digest mismatch", "ASSIGNMENT_TASK_DIGEST_MISMATCH", { category: "validation" });
  }
  return {
    text,
    digest,
    ...(input.ref === undefined ? {} : { ref: assertString(input.ref, "TaskAssignment.task.ref", { maximum: 512 }) }),
  };
}

function normalizeOwnership(value, agentSpec) {
  const input = value === undefined ? {} : assertRecord(value, "TaskAssignment.ownership");
  const writer = input.writer === undefined ? agentSpec.writer : input.writer === true;
  if (writer && !agentSpec.writer) fail("TaskAssignment cannot promote a read-only AgentSpec to writer", "ASSIGNMENT_WRITER_ESCALATION", { category: "policy" });
  const requestedWorkspace = input.workspace ?? agentSpec.effectivePolicy.workspace;
  if (!Object.hasOwn(WORKSPACE_CANONICAL, requestedWorkspace)) throw new TypeError("TaskAssignment.ownership.workspace is invalid");
  const workspace = WORKSPACE_CANONICAL[requestedWorkspace];
  if (WORKSPACE_RANK[workspace] > WORKSPACE_RANK[agentSpec.effectivePolicy.workspace]) {
    fail("TaskAssignment cannot widen the AgentSpec workspace policy", "ASSIGNMENT_WORKSPACE_ESCALATION", {
      category: "policy",
      details: { requested: workspace, ceiling: agentSpec.effectivePolicy.workspace },
    });
  }
  const allowedPaths = (input.allowedPaths ?? []).map((entry, index) => assertRelativePath(entry, `TaskAssignment.ownership.allowedPaths[${index}]`));
  if (new Set(allowedPaths).size !== allowedPaths.length) throw new TypeError("TaskAssignment.ownership.allowedPaths must not contain duplicates");
  const fileClaims = (input.fileClaims ?? []).map((entry, index) => assertRelativePath(entry, `TaskAssignment.ownership.fileClaims[${index}]`));
  if (new Set(fileClaims).size !== fileClaims.length) throw new TypeError("TaskAssignment.ownership.fileClaims must not contain duplicates");
  return {
    writer,
    workspace,
    allowedPaths: allowedPaths.sort(),
    fileClaims: fileClaims.sort(),
    ...(input.baseCommit === undefined ? {} : { baseCommit: assertString(input.baseCommit, "TaskAssignment.ownership.baseCommit", { maximum: 128 }) }),
  };
}

function normalizeIdempotency(value, writer) {
  const input = value === undefined ? { class: writer ? "side-effect" : "read-only" } : assertRecord(value, "TaskAssignment.idempotency");
  if (!IDEMPOTENCY_CLASSES.has(input.class)) throw new TypeError("TaskAssignment.idempotency.class is invalid");
  if (input.class === "read-only" && writer) fail("writer assignment cannot be classified read-only", "ASSIGNMENT_IDEMPOTENCY_CONFLICT", { category: "validation" });
  if (input.class === "idempotent" && input.key === undefined) throw new TypeError("idempotent assignment requires idempotency.key");
  return {
    class: input.class,
    ...(input.key === undefined ? {} : { key: assertString(input.key, "TaskAssignment.idempotency.key", { maximum: 512 }) }),
  };
}

function normalizeOutput(value, agentSpec) {
  if (value === undefined && agentSpec.outputSchema === null) return null;
  const input = value === undefined ? agentSpec.outputSchema : value;
  if (input?.hash && (input.value !== undefined || input.ref !== undefined)) return input;
  if (typeof input === "string") return { ref: input, hash: digestValue(input) };
  assertRecord(input, "TaskAssignment.output");
  if (input.schema !== undefined) return { schema: input.schema, hash: digestValue(input.schema) };
  if (input.ref !== undefined) return { ref: assertString(input.ref, "TaskAssignment.output.ref", { maximum: 512 }), hash: input.hash ?? digestValue(input.ref) };
  return { schema: input, hash: digestValue(input) };
}

export function createTaskAssignment(input = {}) {
  assertRecord(input, "TaskAssignment");
  const agentSpec = input.agentSpec;
  if (agentSpec?.kind !== "resolved-agent-spec" || agentSpec?.formatVersion !== 1) throw new TypeError("TaskAssignment.agentSpec must be a ResolvedAgentSpec");
  const task = normalizeTask(input.task);
  const ownership = normalizeOwnership(input.ownership, agentSpec);
  const idempotency = normalizeIdempotency(input.idempotency, ownership.writer);
  const contextInput = input.context === undefined ? {} : assertRecord(input.context, "TaskAssignment.context");
  const contextMode = contextInput.mode ?? "fresh";
  if (contextMode !== "fresh" && contextMode !== "fork") throw new TypeError("TaskAssignment.context.mode must be fresh or fork");
  const artifactRefs = normalizeStringSet(contextInput.artifactRefs ?? [], "TaskAssignment.context.artifactRefs", { maximumItems: 256 });
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/task-assignment-v1.schema.json",
    formatVersion: 1,
    contractStatus: "contract-preview",
    kind: "task-assignment",
    assignmentId: assertDomainId(input.assignmentId, "TaskAssignment.assignmentId"),
    agentSpecId: agentSpec.id,
    agentSpecHash: agentSpec.specHash,
    task,
    dependencies: normalizeStringSet(input.dependencies ?? [], "TaskAssignment.dependencies", { id: true }),
    ownership,
    idempotency,
    context: { mode: contextMode, artifactRefs },
    budget: input.budget === undefined ? {} : assertRecord(input.budget, "TaskAssignment.budget"),
    output: normalizeOutput(input.output, agentSpec),
  };
  const hashProjection = { ...value, task: { digest: task.digest, ...(task.ref ? { ref: task.ref } : {}) } };
  return immutable({ ...value, assignmentHash: digestValue(hashProjection) });
}

export function assignmentReceiptProjection(assignment) {
  if (assignment?.kind !== "task-assignment") throw new TypeError("assignment must be a TaskAssignment");
  return immutable({
    assignmentId: assignment.assignmentId,
    assignmentHash: assignment.assignmentHash,
    agentSpecId: assignment.agentSpecId,
    agentSpecHash: assignment.agentSpecHash,
    taskDigest: assignment.task.digest,
    dependencies: assignment.dependencies,
    ownership: assignment.ownership,
    idempotency: assignment.idempotency,
    context: assignment.context,
    outputHash: assignment.output?.hash ?? null,
  });
}
