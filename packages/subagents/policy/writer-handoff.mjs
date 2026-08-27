import { assignmentPathClaimCovered } from "../domain/assignment.mjs";
import { digestValue, immutable } from "../domain/index.mjs";
import { assertDomainId, assertRelativePath, normalizeStringSet } from "../domain/shared.mjs";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;

export class WriterHandoffError extends Error {
  constructor(message, code = "WRITER_HANDOFF_ERROR", details = {}) {
    super(`writer-handoff: ${message}`);
    this.name = "WriterHandoffError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new WriterHandoffError(message, code, details);
}

function pathClaim(value, label) {
  try { return assertRelativePath(value, label); }
  catch { fail(`${label} is not a safe relative path`, "WRITER_PATH_INVALID", { value }); }
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

export function assertWriterClaimIsolation(assignments) {
  if (!Array.isArray(assignments)) throw new TypeError("assignments must be an array");
  const claims = [];
  for (const assignment of assignments) {
    if (assignment?.kind !== "task-assignment" || assignment.ownership?.writer !== true) continue;
    for (const raw of assignment.ownership.fileClaims ?? []) {
      const claim = pathClaim(raw, "writer file claim");
      const collision = claims.find((entry) => entry.assignmentId !== assignment.assignmentId && overlaps(entry.claim, claim));
      if (collision) fail("parallel writer file claims overlap", "WRITER_CLAIM_CONFLICT", { left: collision, right: { assignmentId: assignment.assignmentId, claim } });
      claims.push({ assignmentId: assignment.assignmentId, claim });
    }
  }
  return immutable({ ok: true, claims: claims.sort((left, right) => left.claim.localeCompare(right.claim)) });
}

function normalizeGateReceipts(receipts) {
  if (!Array.isArray(receipts)) throw new TypeError("gateReceipts must be an array");
  const result = receipts.map((receipt) => {
    let gateId;
    try { gateId = assertDomainId(receipt?.gateId, "gate receipt id"); } catch { fail("gate receipt is invalid", "WRITER_GATE_RECEIPT_INVALID"); }
    if (!["PASS", "FAIL", "BLOCKED"].includes(receipt.status) || !SHA256.test(receipt.receiptDigest ?? "")) fail("gate receipt is invalid", "WRITER_GATE_RECEIPT_INVALID");
    return { gateId, status: receipt.status, receiptDigest: receipt.receiptDigest };
  }).sort((left, right) => left.gateId.localeCompare(right.gateId));
  if (new Set(result.map((entry) => entry.gateId)).size !== result.length) fail("gate receipts contain duplicate gate ids", "WRITER_GATE_RECEIPT_INVALID");
  return result;
}

export function createWriterHandoff(input) {
  const assignment = input?.assignment;
  if (assignment?.kind !== "task-assignment" || assignment.ownership?.writer !== true) fail("writer handoff requires a writer TaskAssignment", "WRITER_ASSIGNMENT_REQUIRED");
  if (assignment.ownership.workspace !== "managed-worktree") fail("writer handoff requires a managed worktree", "WRITER_WORKTREE_REQUIRED");
  if (!GIT_COMMIT.test(assignment.ownership.baseCommit ?? "")) fail("writer handoff requires an exact base commit", "WRITER_BASE_COMMIT_INVALID");
  const enforcement = input.pathEnforcement;
  if (enforcement?.state !== "ENFORCED" || enforcement.mechanism !== "parent-diff-verification" || !SHA256.test(enforcement.receiptDigest ?? "")) {
    fail("writer handoff requires parent-side diff path enforcement evidence", "WRITER_PATH_ENFORCEMENT_UNAVAILABLE");
  }
  const terminal = input.terminalReceipt;
  if (terminal?.authoritative !== true || !["completed", "succeeded"].includes(terminal.outcome) || !SHA256.test(terminal.receiptId ?? "")) fail("writer handoff requires an authoritative successful terminal receipt", "WRITER_TERMINAL_PROOF_REQUIRED");
  const changedPaths = (input.changedPaths ?? []).map((entry, index) => pathClaim(entry, `changedPaths[${index}]`)).sort();
  if (changedPaths.length < 1 || new Set(changedPaths).size !== changedPaths.length) fail("writer handoff requires unique changed paths", "WRITER_CHANGED_PATHS_INVALID");
  for (const changed of changedPaths) {
    if (!assignmentPathClaimCovered(changed, assignment.ownership.allowedPaths) || !assignmentPathClaimCovered(changed, assignment.ownership.fileClaims)) {
      fail("writer changed a path outside its exact claims", "WRITER_CHANGED_PATH_OUTSIDE_CLAIMS", { changed });
    }
  }
  if (!SHA256.test(input.patchDigest ?? "")) fail("writer handoff patch digest is invalid", "WRITER_PATCH_DIGEST_INVALID");
  const gateReceipts = normalizeGateReceipts(input.gateReceipts ?? []);
  const value = {
    formatVersion: 1,
    kind: "writer-handoff",
    assignmentId: assignment.assignmentId,
    assignmentHash: assignment.assignmentHash,
    baseCommit: assignment.ownership.baseCommit,
    fileClaims: assignment.ownership.fileClaims,
    changedPaths,
    patchDigest: input.patchDigest,
    terminalReceiptId: terminal.receiptId,
    pathEnforcement: {
      state: "ENFORCED",
      mechanism: "parent-diff-verification",
      receiptDigest: enforcement.receiptDigest,
    },
    gateReceipts,
    artifactRefs: normalizeStringSet(input.artifactRefs ?? [], "writer handoff artifactRefs", { id: true, maximumItems: 256 }),
    integration: { state: "HANDOFF_ONLY", automatic: false },
  };
  return immutable({ ...value, handoffDigest: digestValue(value) });
}

export function validateIntegrationHandoff(handoff, options = {}) {
  if (handoff?.kind !== "writer-handoff" || !SHA256.test(handoff.handoffDigest ?? "")) fail("writer handoff is invalid", "WRITER_HANDOFF_INVALID");
  const { handoffDigest, ...projection } = handoff;
  if (digestValue(projection) !== handoffDigest) fail("writer handoff digest mismatch", "WRITER_HANDOFF_TAMPERED");
  if (handoff.baseCommit !== options.currentBaseCommit) fail("worktree base commit drifted before integration", "WRITER_BASE_COMMIT_DRIFT");
  const required = [...new Set(options.requiredGateIds ?? [])].sort();
  for (const gateId of required) {
    const receipt = handoff.gateReceipts.find((entry) => entry.gateId === gateId);
    if (!receipt || receipt.status !== "PASS") fail(`required gate ${gateId} did not pass`, "WRITER_GATE_FAILED", { gateId });
  }
  return immutable({
    ok: true,
    status: "READY_FOR_PARENT_INTEGRATION",
    handoffDigest,
    patchDigest: handoff.patchDigest,
    baseCommit: handoff.baseCommit,
    changedPaths: handoff.changedPaths,
    automaticIntegration: false,
  });
}
