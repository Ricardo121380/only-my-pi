import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_CAPABILITY_KEYS,
  SubagentsError,
  activeBackendBinding,
  assignmentPathClaimCovered,
  bindBackendRun,
  createAgentRunHandle,
  createAgentTemplate,
  createBackendCapabilityEntry,
  createBackendCapabilityV2,
  createResolvedAgentSpec,
  createTaskAssignment,
  createTerminalReceipt,
  digestValue,
  errorReceiptProjection,
  requireBackendCapability,
} from "../packages/subagents/domain/index.mjs";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;

function readOnlyTemplate(overrides = {}) {
  return createAgentTemplate({
    id: "source-verifier",
    version: "1.0.0",
    backendAgentId: "omp-source-verifier",
    sourceHash: SHA_A,
    promptHash: SHA_B,
    tools: { allow: ["read", "grep", "find"], deny: ["bash", "edit", "write"] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "read-only",
      mutation: "none",
      approval: "ask",
      egress: { web: "allow-listed", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "research",
    inputSchema: "task-input-v1",
    outputSchema: { type: "object", required: ["verdict"] },
    writer: false,
    continuable: true,
    resumable: true,
    timeoutSeconds: 60,
    redaction: { rawPrompts: "omit" },
    ...overrides,
  });
}

function resolvedSpec(template = readOnlyTemplate(), overrides = {}) {
  return createResolvedAgentSpec({
    template,
    id: "source-verifier-run",
    tools: { allow: ["read", "grep"], deny: ["find"] },
    requiredCapabilities: ["workspace-read"],
    effectivePolicy: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "allow-listed", extension: "deny" },
    },
    specialization: { prompt: "Check only the supplied source artifact." },
    ...overrides,
  });
}

function writerSpec() {
  const template = createAgentTemplate({
    id: "implementer",
    version: "1.0.0",
    backendAgentId: "omp-implementer",
    sourceHash: SHA_A,
    promptHash: SHA_B,
    tools: { allow: ["read", "edit", "write"], deny: [] },
    requiredCapabilities: ["workspace-write"],
    policyCeiling: {
      workspace: "managed-worktree",
      mutation: "guarded",
      approval: "ask",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "build",
    writer: true,
    continuable: true,
    resumable: true,
    timeoutSeconds: 60,
  });
  return createResolvedAgentSpec({ template, id: "implementer-run" });
}

function assignment(spec = resolvedSpec(), overrides = {}) {
  return createTaskAssignment({
    assignmentId: "verify-source-01",
    agentSpec: spec,
    task: "Verify source A and return a structured verdict.",
    dependencies: ["collect-source"],
    ownership: { writer: false, workspace: "read-only", allowedPaths: ["docs/source-a.md"] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: ["artifact://source-a"] },
    budget: { maxTurns: 4 },
    ...overrides,
  });
}

function boundHandle() {
  const spec = resolvedSpec();
  const task = assignment(spec);
  const initial = createAgentRunHandle({ runId: "root-01", nodeId: "verify", attemptId: "attempt-01", assignment: task, agentSpec: spec });
  return bindBackendRun(initial, {
    backendId: "pi-subagents-rpc-v1",
    backendVersion: "0.45.2",
    protocolVersion: 1,
    lifecycle: "launch",
    requestId: "rpc-spawn-1",
    backendRunId: "backend-run-1",
    backendAsyncId: "backend-run-1",
  });
}

test("AgentTemplate and ResolvedAgentSpec are immutable, stable, and monotonic", () => {
  const template = readOnlyTemplate();
  const first = resolvedSpec(template);
  const second = resolvedSpec(template);
  assert.equal(first.specHash, second.specHash);
  assert.equal(first.templateHash, template.templateHash);
  assert.deepEqual(first.tools, { allow: ["grep", "read"], deny: ["bash", "edit", "find", "write"] });
  assert.equal(first.overlayRequirements.tools, true);
  assert.equal(first.effectivePolicy.workspace, "shared-read-only");
  assert.equal(first.effectivePolicy.egress.web, "deny");
  assert.equal(Object.isFrozen(first), true);
  assert.throws(() => { first.writer = true; }, TypeError);

  assert.throws(
    () => resolvedSpec(template, { tools: { allow: ["read", "bash"], deny: [] } }),
    (error) => error instanceof SubagentsError && error.code === "AGENT_SPEC_TOOL_ESCALATION",
  );
  assert.throws(
    () => resolvedSpec(template, { effectivePolicy: { ...template.policyCeiling, workspace: "guarded-write" } }),
    (error) => error instanceof SubagentsError && error.code === "AGENT_SPEC_POLICY_ESCALATION",
  );
  assert.throws(
    () => resolvedSpec(template, { requiredCapabilities: ["workspace-read", "web-egress"] }),
    (error) => error instanceof SubagentsError && error.code === "AGENT_SPEC_CAPABILITY_ESCALATION",
  );
});

test("TaskAssignment binds exact task/spec digests without using raw task in its stable hash", () => {
  const spec = resolvedSpec();
  const first = assignment(spec);
  const second = assignment(spec, { task: { text: first.task.text, digest: first.task.digest } });
  assert.equal(first.assignmentHash, second.assignmentHash);
  assert.equal(first.task.digest, digestValue(first.task.text));
  assert.equal(first.agentSpecHash, spec.specHash);
  assert.equal(Object.isFrozen(first), true);
  assert.throws(
    () => assignment(spec, { task: { text: "different", digest: first.task.digest } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_TASK_DIGEST_MISMATCH",
  );
  assert.throws(() => assignment(spec, { ownership: { writer: false, allowedPaths: ["../secret"] } }), /contained relative path/);
  assert.throws(
    () => assignment(spec, { ownership: { writer: true } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_WRITER_ESCALATION",
  );
  assert.throws(
    () => assignment(spec, { ownership: { writer: false, workspace: "worktree-write" } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_WORKSPACE_ESCALATION",
  );
});

test("TaskAssignment ownership binds every file claim and requires complete writer evidence", () => {
  const spec = resolvedSpec();
  assert.equal(assignmentPathClaimCovered("src/index.mjs", ["src"]), true);
  assert.equal(assignmentPathClaimCovered("src-other/index.mjs", ["src"]), false);
  const claimed = assignment(spec, {
    ownership: { writer: false, workspace: "read-only", allowedPaths: ["docs"], fileClaims: ["docs/source-a.md"] },
  });
  assert.deepEqual(claimed.ownership.fileClaims, ["docs/source-a.md"]);
  assert.throws(
    () => assignment(spec, { ownership: { writer: false, workspace: "read-only", allowedPaths: ["docs"], fileClaims: ["secrets/private"] } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_FILE_CLAIM_OUTSIDE_PATHS",
  );

  const writer = writerSpec();
  const writerInput = {
    assignmentId: "implement-safe-01",
    agentSpec: writer,
    task: "Apply the approved patch.",
    ownership: { writer: true, workspace: "managed-worktree", allowedPaths: ["src"] },
  };
  assert.throws(
    () => createTaskAssignment(writerInput),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_WRITER_CLAIMS_REQUIRED",
  );
  assert.throws(
    () => createTaskAssignment({ ...writerInput, ownership: { ...writerInput.ownership, fileClaims: ["src/index.mjs"] } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_WRITER_BASE_COMMIT_REQUIRED",
  );
  assert.throws(
    () => createTaskAssignment({ ...writerInput, ownership: { ...writerInput.ownership, fileClaims: ["src/index.mjs"], baseCommit: "main" } }),
    (error) => error instanceof SubagentsError && error.code === "ASSIGNMENT_BASE_COMMIT_INVALID",
  );
  const valid = createTaskAssignment({
    ...writerInput,
    ownership: {
      ...writerInput.ownership,
      fileClaims: ["src/index.mjs"],
      baseCommit: "0123456789abcdef0123456789abcdef01234567",
    },
  });
  assert.equal(valid.ownership.writer, true);
  assert.deepEqual(valid.ownership.fileClaims, ["src/index.mjs"]);
});

test("stable AgentRunHandle retains local identity across explicit backend resume mappings", () => {
  const initial = boundHandle();
  const initialBinding = activeBackendBinding(initial);
  const resumed = bindBackendRun(initial, {
    backendId: "pi-subagents-rpc-v1",
    backendVersion: "0.45.2",
    protocolVersion: 1,
    lifecycle: "resume",
    requestId: "rpc-resume-2",
    backendRunId: "backend-run-2",
    backendAsyncId: "backend-run-2",
    parentBindingId: initialBinding.bindingId,
  });
  assert.equal(resumed.handleId, initial.handleId);
  assert.equal(resumed.backendBindings.length, 2);
  assert.equal(activeBackendBinding(resumed).backendRunId, "backend-run-2");
  assert.equal(activeBackendBinding(resumed).parentBindingId, initialBinding.bindingId);
  assert.throws(
    () => bindBackendRun(resumed, {
      backendId: "other-backend",
      backendVersion: "1",
      protocolVersion: 1,
      requestId: "rpc-other",
      backendRunId: "other-run",
    }),
    (error) => error instanceof SubagentsError && error.code === "HANDLE_BACKEND_MISMATCH",
  );
});

test("terminal receipts require correlated completion and observed process proof", () => {
  const handle = boundHandle();
  const completion = { runId: "backend-run-1", state: "complete", success: true, resultCount: 1 };
  const proof = {
    version: 1,
    state: "observed",
    runId: "backend-run-1",
    runnerProcessInstanceId: "runner-1",
    observedAt: 200,
    instances: [{ processInstanceId: "runner-1", kind: "runner", closeObservedAt: 200, exitCode: 0, signal: null }],
  };
  const receipt = createTerminalReceipt({ handle, outcome: "completed", completion, processTerminal: proof, startedAt: 100, settledAt: 200, result: { verdict: "pass" } });
  assert.equal(receipt.authoritative, true);
  assert.equal(receipt.backendRunId, "backend-run-1");
  assert.match(receipt.receiptId, /^sha256:/);

  assert.throws(
    () => createTerminalReceipt({ handle, outcome: "completed", completion, settledAt: 200 }),
    (error) => error instanceof SubagentsError && error.code === "TERMINAL_PROOF_REQUIRED",
  );
  assert.throws(
    () => createTerminalReceipt({ handle, outcome: "failed", completion: { ...completion, runId: "wrong" }, processTerminal: proof, settledAt: 200 }),
    (error) => error instanceof SubagentsError && error.code === "BACKEND_EVENT_CORRELATION_MISMATCH",
  );
  assert.throws(
    () => createTerminalReceipt({
      handle,
      outcome: "completed",
      completion,
      processTerminal: { ...proof, instances: [] },
      settledAt: 200,
    }),
    /does not contain its runner process instance/,
  );
  const orphaned = createTerminalReceipt({
    handle,
    outcome: "orphaned",
    completion,
    processTerminal: { version: 1, state: "unknown", runId: "backend-run-1", runnerProcessInstanceId: "runner-1", reason: "observer-unavailable" },
    settledAt: 250,
  });
  assert.equal(orphaned.authoritative, false);
});

test("BackendCapabilityV2 is exhaustive and capability gates respect degradation", () => {
  const capabilities = Object.fromEntries(BACKEND_CAPABILITY_KEYS.map((key) => [key, createBackendCapabilityEntry({
    state: key === "rateLimitSignal" ? "UNAVAILABLE" : key === "foreground" ? "DEGRADED" : "SUPPORTED",
    reasonCode: key === "rateLimitSignal" ? "not-advertised" : key === "foreground" ? "async-wait" : "rpc-advertised",
    evidence: [`fixture:${key}`],
    constraints: {},
  })]));
  const matrix = createBackendCapabilityV2({
    backendId: "pi-subagents-rpc-v1",
    backendVersion: "0.45.2",
    protocol: { name: "extension-rpc", version: 1 },
    capabilities,
    observedAt: 123,
  });
  assert.equal(matrix.formatVersion, 2);
  assert.match(matrix.capabilityHash, /^sha256:/);
  assert.equal(requireBackendCapability(matrix, "background").state, "SUPPORTED");
  assert.equal(requireBackendCapability(matrix, "foreground", { allowDegraded: true }).state, "DEGRADED");
  assert.throws(
    () => requireBackendCapability(matrix, "rateLimitSignal"),
    (error) => error instanceof SubagentsError && error.category === "unavailable",
  );
  const incomplete = { ...capabilities };
  delete incomplete.stop;
  assert.throws(() => createBackendCapabilityV2({ backendId: "x", backendVersion: "1", protocol: { name: "x", version: 1 }, capabilities: incomplete }), /capabilities.stop is required/);
});

test("structured errors redact sensitive details before receipts", () => {
  const projection = errorReceiptProjection(new SubagentsError("backend failed", {
    code: "BACKEND_FAILED",
    category: "backend",
    retryable: true,
    details: { token: "do-not-leak", nested: { apiKey: "also-secret", safe: "kept" } },
  }));
  assert.equal(projection.retryable, true);
  assert.equal(projection.details.token, "[redacted]");
  assert.equal(projection.details.nested.apiKey, "[redacted]");
  assert.equal(projection.details.nested.safe, "kept");
});
