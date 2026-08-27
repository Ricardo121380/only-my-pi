import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalReceiptSemanticFindings,
  approvalReceiptId,
  createApprovalReceipt,
  createApprovalVerifier,
  validateApprovalReceipt,
} from "../packages/subagents/policy/approval-receipt.mjs";
import {
  compileWorkflowDefinition,
  digestWorkflowPolicyEnvelope,
  digestWorkflowValue,
} from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createSchemaRegistry } from "../scripts/lib/schema-registry.mjs";

function plan(id = "approval-fixture", { nodeWeb = "deny" } = {}) {
  return compileWorkflowDefinition({
    $schema: "../../schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id,
    version: "2.0.0",
    description: "Approval runtime fixture",
    policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: "ask", mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "read", "write"], deny: [] } },
    budget: { maxNodes: 3, maxParallel: 1, maxDepth: 3, maxAttemptsPerNode: 1, maxWallTimeMs: 10_000, maxOutputBytes: 8192, maxAssignments: 1, maxTokens: null, maxCostUsd: null },
    flow: {
      kind: "sequence",
      steps: [
        { kind: "approval", id: "approve", approval: { origin: "user", scopeDigest: `sha256:${"a".repeat(64)}` }, policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"], deny: ["bash", "edit", "write"] } }, budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 1024 }, cache: { mode: "never", keyInputs: [] }, idempotency: "receipt" },
        { kind: "agent", id: "write", agentTemplateRef: "implementer", assignment: { taskTemplateRef: "write-safe" }, outputSchemaRef: null, policy: { workspace: "managed-worktree", mutation: "guarded", egress: { web: nodeWeb, mcp: "deny", provider: "allow" }, tools: { allow: ["edit", "write"], deny: [] } }, budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 }, cache: { mode: "never", keyInputs: [] }, idempotency: "receipt" },
      ],
    },
  });
}

function readOnlyPlan() {
  return compileWorkflowDefinition({
    $schema: "../../schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: "approval-read-only",
    version: "2.0.0",
    description: "Read-only approval fixture",
    policy: { workspace: "shared-read-only", mutation: "none", egress: { web: "deny", mcp: "deny", provider: "allow" }, tools: { allow: ["read"], deny: ["bash", "edit", "write"] } },
    budget: { maxNodes: 1, maxParallel: 4, maxDepth: 1, maxAttemptsPerNode: 1, maxWallTimeMs: 10_000, maxOutputBytes: 8192, maxAssignments: 1, maxTokens: null, maxCostUsd: null },
    flow: { kind: "agent", id: "read", agentTemplateRef: "reader", assignment: {}, outputSchemaRef: null, policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"], deny: ["bash", "edit", "write"] } }, budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096 }, cache: { mode: "content-addressed", keyInputs: ["input"] }, idempotency: "content-addressed" },
  });
}

const repo = Object.freeze({ identity: "github.com/example/only-my-pi", baseCommit: "0123456789abcdef0123456789abcdef01234567", allowedPaths: ["packages/subagents"], writerClaims: ["packages/subagents"] });
const capabilityEnvelopeHash = `sha256:${"c".repeat(64)}`;
const executionEnvelopeDigest = `sha256:${"d".repeat(64)}`;

test("ApprovalReceipt runtime matches the versioned schema vocabulary and exact plan envelope", () => {
  const workflowPlan = plan();
  const receipt = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, origin: "explicit-cli-yes", approvedAt: "2026-08-18T00:00:00.000Z" });
  assert.equal(receipt.effectivePolicyHash, digestWorkflowPolicyEnvelope(workflowPlan));
  assert.equal(receipt.executionEnvelopeDigest, executionEnvelopeDigest);
  assert.equal(receipt.budgetEnvelopeHash, digestWorkflowValue(workflowPlan.budget));
  assert.equal(receipt.approvedPlanRevision, workflowPlan.revision.number);
  assert.equal(receipt.receiptId, approvalReceiptId(receipt));
  assert.equal(Object.isFrozen(receipt), true);
  assert.deepEqual(validateApprovalReceipt(receipt, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }), { ok: true, receiptDigest: receipt.receiptId });
});

test("approval validation fails closed on missing runtime context, tampering, and plan drift", () => {
  const workflowPlan = plan();
  const receipt = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  assert.equal(validateApprovalReceipt(receipt, { plan: workflowPlan }).code, "APPROVAL_CONTEXT_UNAVAILABLE");
  const tampered = structuredClone(receipt);
  tampered.scope.delivery = "push";
  assert.equal(validateApprovalReceipt(tampered, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).code, "APPROVAL_RECEIPT_TAMPERED");
  const otherPlan = plan("approval-other");
  assert.equal(validateApprovalReceipt(receipt, { plan: otherPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).code, "APPROVAL_PLAN_DRIFT");
  assert.equal(validateApprovalReceipt(receipt, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: `sha256:${"e".repeat(64)}` }).code, "APPROVAL_EXECUTION_DRIFT");
  assert.throws(() => createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash }), /executionEnvelopeDigest/);
});

test("one exact plan receipt also binds its explicit approval nodes", () => {
  const workflowPlan = plan();
  const receipt = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  const verifier = createApprovalVerifier({ repo, capabilityEnvelopeHash, executionEnvelopeDigest });
  const approval = workflowPlan.nodes.find((node) => node.kind === "approval").approval;
  assert.equal(verifier.verify(receipt, workflowPlan).ok, true);
  assert.equal(verifier.verifyNode(receipt, approval, workflowPlan).ok, true);
  assert.equal(verifier.verifyNode(receipt, { scopeDigest: `sha256:${"b".repeat(64)}` }, workflowPlan).code, "NODE_APPROVAL_SCOPE_DRIFT");
});

test("ApprovalReceipt effectivePolicyHash changes with a node envelope under the same root ceiling", () => {
  const denied = plan("approval-policy-denied", { nodeWeb: "deny" });
  const asking = plan("approval-policy-asking", { nodeWeb: "ask" });
  const deniedReceipt = createApprovalReceipt({ plan: denied, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  const askingReceipt = createApprovalReceipt({ plan: asking, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  assert.deepEqual(denied.policy, asking.policy);
  assert.notEqual(deniedReceipt.effectivePolicyHash, askingReceipt.effectivePolicyHash);
});

test("a receipt scope cannot understate a mutating node or the plan assignment envelope", () => {
  const workflowPlan = plan();
  const readRepo = { ...repo, writerClaims: [] };
  const valid = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  assert.throws(
    () => createApprovalReceipt({
      plan: workflowPlan,
      repo: readRepo,
      capabilityEnvelopeHash,
      executionEnvelopeDigest,
      scope: { ...valid.scope, mutation: "none", integration: "none" },
    }),
    /APPROVAL_SCOPE_PLAN_DRIFT/,
  );
  assert.throws(
    () => createApprovalReceipt({
      plan: workflowPlan,
      repo,
      capabilityEnvelopeHash,
      executionEnvelopeDigest,
      scope: { ...valid.scope, maxAssignments: 0, maxActiveChildren: 0 },
    }),
    /APPROVAL_SCOPE_PLAN_DRIFT/,
  );
});

test("runtime and contract catalog share ApprovalReceipt cross-field semantics", () => {
  const workflowPlan = plan();
  const base = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  const cases = [
    [{ repo: { ...base.repo, allowedPaths: [], writerClaims: [] } }, "APPROVAL_MUTATING_ALLOWED_PATHS_REQUIRED", "minItems"],
    [{ repo: { ...base.repo, writerClaims: [] } }, "APPROVAL_MUTATING_WRITER_CLAIMS_REQUIRED", "minItems"],
    [{ repo: { ...base.repo, allowedPaths: ["src"], writerClaims: ["secrets/private"] } }, "APPROVAL_WRITER_CLAIM_OUTSIDE_PATHS", "path-claim"],
    [{ repo: { ...base.repo, allowedPaths: ["src", "src/nested"], writerClaims: ["src"] } }, "APPROVAL_ALLOWED_PATHS_OVERLAP", "path-overlap"],
    [{ repo: { ...base.repo, allowedPaths: ["src"], writerClaims: ["src", "src/nested"] } }, "APPROVAL_WRITER_CLAIMS_OVERLAP", "path-overlap"],
    [{ scope: { ...base.scope, maxAssignments: 1, maxActiveChildren: 2 } }, "APPROVAL_ACTIVE_CHILDREN_EXCEED_ASSIGNMENTS", "budget-envelope"],
  ];
  const registry = createSchemaRegistry({ rootDir: process.cwd() });
  for (const [change, runtimeCode, catalogKeyword] of cases) {
    const candidate = { ...structuredClone(base), ...change };
    candidate.receiptId = approvalReceiptId(candidate);
    assert.equal(validateApprovalReceipt(candidate, { plan: workflowPlan, expectedRepo: candidate.repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest, expectedScope: candidate.scope }).code, runtimeCode);
    const catalog = registry.validate("approvalReceipt", candidate);
    assert.equal(catalog.valid, false);
    assert.ok(catalog.errors.some((finding) => finding.keyword === catalogKeyword));
    assert.ok(approvalReceiptSemanticFindings(candidate).some((finding) => finding.code === runtimeCode));
  }
});

test("approval path sets reject directory-prefix overlap at create, runtime, and catalog entry points", () => {
  const workflowPlan = plan();
  const registry = createSchemaRegistry({ rootDir: process.cwd() });
  for (const [invalidRepo, runtimeCode, instancePath] of [
    [{ ...repo, allowedPaths: ["src", "src/nested"], writerClaims: ["src"] }, "APPROVAL_ALLOWED_PATHS_OVERLAP", "/repo/allowedPaths/1"],
    [{ ...repo, allowedPaths: ["src"], writerClaims: ["src", "src/nested"] }, "APPROVAL_WRITER_CLAIMS_OVERLAP", "/repo/writerClaims/1"],
  ]) {
    assert.throws(
      () => createApprovalReceipt({ plan: workflowPlan, repo: invalidRepo, capabilityEnvelopeHash, executionEnvelopeDigest }),
      new RegExp(runtimeCode),
    );
    const valid = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
    const candidate = { ...structuredClone(valid), repo: invalidRepo };
    candidate.receiptId = approvalReceiptId(candidate);
    assert.equal(validateApprovalReceipt(candidate, {
      plan: workflowPlan,
      expectedRepo: invalidRepo,
      expectedCapabilityEnvelopeHash: capabilityEnvelopeHash,
      expectedExecutionEnvelopeDigest: executionEnvelopeDigest,
      expectedScope: candidate.scope,
    }).code, runtimeCode);
    const catalog = registry.validate("approvalReceipt", candidate);
    assert.equal(catalog.valid, false);
    assert.ok(catalog.errors.some((finding) => finding.instancePath === instancePath && finding.keyword === "path-overlap"));
  }
});

test("mutation:guarded requires non-empty allowed paths and writer claims at every approval entry point", () => {
  const workflowPlan = plan();
  const registry = createSchemaRegistry({ rootDir: process.cwd() });
  const invalidRepos = [
    [{ ...repo, allowedPaths: [], writerClaims: [] }, "APPROVAL_MUTATING_ALLOWED_PATHS_REQUIRED", "/repo/allowedPaths"],
    [{ ...repo, writerClaims: [] }, "APPROVAL_MUTATING_WRITER_CLAIMS_REQUIRED", "/repo/writerClaims"],
  ];

  for (const [invalidRepo, runtimeCode, instancePath] of invalidRepos) {
    assert.throws(
      () => createApprovalReceipt({ plan: workflowPlan, repo: invalidRepo, capabilityEnvelopeHash, executionEnvelopeDigest }),
      new RegExp(runtimeCode),
    );

    const candidate = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
    const invalid = { ...structuredClone(candidate), repo: invalidRepo };
    invalid.receiptId = approvalReceiptId(invalid);
    assert.equal(validateApprovalReceipt(invalid, {
      plan: workflowPlan,
      expectedRepo: invalidRepo,
      expectedCapabilityEnvelopeHash: capabilityEnvelopeHash,
      expectedExecutionEnvelopeDigest: executionEnvelopeDigest,
      expectedScope: invalid.scope,
    }).code, runtimeCode);

    const catalog = registry.validate("approvalReceipt", invalid);
    assert.equal(catalog.valid, false);
    assert.ok(catalog.errors.some((finding) => finding.instancePath === instancePath && finding.keyword === "minItems"));
    assert.ok(approvalReceiptSemanticFindings(invalid).some((finding) => finding.instancePath === instancePath && finding.keyword === "approval-path-scope" && finding.code === runtimeCode));
  }
});

test("runtime and contract catalog agree on schema reference, timestamp, and receipt digest", () => {
  const workflowPlan = plan();
  const base = createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  const registry = createSchemaRegistry({ rootDir: process.cwd() });

  const shortSchema = { ...structuredClone(base), $schema: "approval-receipt-v1.schema.json" };
  shortSchema.receiptId = approvalReceiptId(shortSchema);
  assert.equal(validateApprovalReceipt(shortSchema, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).ok, true);
  assert.equal(registry.validate("approvalReceipt", shortSchema).valid, true);

  const dateOnly = { ...structuredClone(base), approvedAt: "2026-08-18" };
  dateOnly.receiptId = approvalReceiptId(dateOnly);
  assert.equal(validateApprovalReceipt(dateOnly, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).code, "APPROVAL_ORIGIN_INVALID");
  assert.equal(registry.validate("approvalReceipt", dateOnly).valid, false);

  const unsafeInteger = { ...structuredClone(base), scope: { ...base.scope, maxAssignments: 1e20 } };
  unsafeInteger.receiptId = approvalReceiptId(unsafeInteger);
  assert.equal(validateApprovalReceipt(unsafeInteger, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).code, "APPROVAL_SCOPE_INVALID");
  assert.equal(registry.validate("approvalReceipt", unsafeInteger).valid, false);

  const tampered = { ...structuredClone(base), approvedAt: "2026-08-18T00:00:01.000Z" };
  assert.equal(validateApprovalReceipt(tampered, { plan: workflowPlan, expectedRepo: repo, expectedCapabilityEnvelopeHash: capabilityEnvelopeHash, expectedExecutionEnvelopeDigest: executionEnvelopeDigest }).code, "APPROVAL_RECEIPT_TAMPERED");
  const catalog = registry.validate("approvalReceipt", tampered);
  assert.equal(catalog.valid, false);
  assert.ok(catalog.errors.some((finding) => finding.keyword === "receipt-digest"));
});

test("mutation:none forbids writer claims and commit or push delivery, and clamps active children", () => {
  const workflowPlan = readOnlyPlan();
  const readRepo = { ...repo, writerClaims: [] };
  const receipt = createApprovalReceipt({ plan: workflowPlan, repo: readRepo, capabilityEnvelopeHash, executionEnvelopeDigest, approvedAt: "2026-08-18T00:00:00.000Z" });
  assert.deepEqual(receipt.scope, { mutation: "none", integration: "none", delivery: "local", maxAssignments: 1, maxActiveChildren: 1 });
  assert.throws(
    () => createApprovalReceipt({ plan: workflowPlan, repo, capabilityEnvelopeHash, executionEnvelopeDigest }),
    /APPROVAL_READ_ONLY_WRITER_CLAIMS/,
  );
  for (const delivery of ["commit", "push"]) {
    assert.throws(
      () => createApprovalReceipt({ plan: workflowPlan, repo: readRepo, capabilityEnvelopeHash, executionEnvelopeDigest, scope: { ...receipt.scope, delivery } }),
      /APPROVAL_READ_ONLY_DELIVERY/,
    );
  }
});
