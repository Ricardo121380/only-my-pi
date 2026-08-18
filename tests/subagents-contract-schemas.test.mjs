import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  BACKEND_CAPABILITY_KEYS,
  bindBackendRun,
  createAgentRunHandle,
  createAgentTemplate,
  createBackendCapabilityV2,
  createResolvedAgentSpec,
  createTaskAssignment,
  createTerminalReceipt,
  digestValue,
} from "../packages/subagents/domain/index.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";

function validator(name) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.resolve("schemas", `${name}.schema.json`), "utf8")));
}

function domainFixture() {
  const template = createAgentTemplate({
    id: "reviewer",
    version: "1.0.0",
    backendAgentId: "omp-reviewer",
    sourceHash: digestValue("reviewer-source"),
    promptHash: digestValue("reviewer-prompt"),
    tools: { allow: ["read", "grep"], deny: ["bash", "edit", "write"] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "read-only",
      mutation: "none",
      approval: "ask",
      egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" },
    },
    modelRole: "review",
    inputSchema: null,
    outputSchema: { type: "object", required: ["verdict"] },
    writer: false,
    continuable: true,
    resumable: true,
    timeoutSeconds: 60,
    redaction: { secrets: "omit" },
  });
  const agentSpec = createResolvedAgentSpec({
    template,
    id: "reviewer-resolved",
    effectivePolicy: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "allow-listed", extension: "deny" },
    },
  });
  const assignment = createTaskAssignment({
    assignmentId: "review-01",
    agentSpec,
    task: "Review the supplied artifact and return a verdict.",
    ownership: { writer: false, workspace: "read-only", allowedPaths: ["src/index.mjs"] },
    idempotency: { class: "read-only" },
    context: { mode: "fresh", artifactRefs: ["artifact://source"] },
  });
  return { template, agentSpec, assignment };
}

test("runtime AgentTemplate v2, ResolvedAgentSpec v1, and TaskAssignment v1 validate their exact schemas", () => {
  const values = domainFixture();
  for (const [schemaName, value] of [
    ["agent-template-v2", values.template],
    ["resolved-agent-spec-v1", values.agentSpec],
    ["task-assignment-v1", values.assignment],
  ]) {
    const validate = validator(schemaName);
    assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...value, unknown: true }), false, `${schemaName} accepted an unknown field`);
    assert.equal(validate({ ...value, formatVersion: 99 }), false, `${schemaName} accepted a wrong version`);
  }
});

test("BackendCapabilityV2 and TerminalReceiptV2 runtime values validate without weakening proof", () => {
  const unavailable = Object.fromEntries(BACKEND_CAPABILITY_KEYS.map((key) => [key, {
    state: "UNAVAILABLE",
    reasonCode: "fixture-unavailable",
    evidence: ["contract-test"],
    constraints: {},
  }]));
  const matrix = createBackendCapabilityV2({
    backendId: "fixture-backend",
    backendVersion: "1.0.0",
    protocol: { name: "fixture", version: 1 },
    observedAt: 1,
    capabilities: unavailable,
  });
  const matrixValidator = validator("backend-capability-v2");
  assert.equal(matrixValidator(matrix), true, JSON.stringify(matrixValidator.errors));

  const { agentSpec, assignment } = domainFixture();
  const local = createAgentRunHandle({ runId: "run-01", nodeId: "review", attemptId: "attempt-01", agentSpec, assignment });
  const handle = bindBackendRun(local, {
    backendId: "fixture-backend",
    backendVersion: "1.0.0",
    protocolVersion: 1,
    requestId: "request-01",
    backendRunId: "backend-run-01",
  });
  const receipt = createTerminalReceipt({
    handle,
    outcome: "completed",
    startedAt: 1,
    settledAt: 2,
    completion: { runId: "backend-run-01", state: "completed" },
    processTerminal: {
      version: 1,
      state: "observed",
      runId: "backend-run-01",
      runnerProcessInstanceId: "runner-01",
      observedAt: 2,
      instances: [{ processInstanceId: "runner-01", exitCode: 0 }],
    },
    result: { verdict: "pass" },
  });
  const receiptValidator = validator("terminal-receipt-v2");
  assert.equal(receiptValidator(receipt), true, JSON.stringify(receiptValidator.errors));
  assert.equal(receiptValidator({ ...receipt, authoritative: false, unknown: true }), false);
});

test("persisted event records and homogeneous BatchSwarm documents have strict schemas", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "omp-event-schema-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 18);
  const journal = createEventJournal({ rootDir: root, filesystem: fsp, clock: () => new Date(now += 1) });
  const lease = await journal.acquireWriter("schema-run", { writerId: "schema-writer", ttlMs: 10_000 });
  const current = await journal.read("schema-run");
  await journal.append("schema-run", { eventId: "run-planned", type: "RunPlanned", revision: 0, payload: { planDigest: digestValue("plan") } }, {
    lease,
    expectedSeq: current.lastSeq,
    expectedDigest: current.lastEventDigest,
  });
  const [record] = (await journal.read("schema-run")).events;
  const eventValidator = validator("workflow-event-v1");
  assert.equal(eventValidator(record), true, JSON.stringify(eventValidator.errors));
  assert.equal(eventValidator({ ...record, seq: 0 }), false);

  const batch = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/batch-swarm-v1.schema.json",
    formatVersion: 1,
    contractStatus: "contract-preview",
    kind: "batch-swarm",
    id: "review-files",
    agentSpecRef: "reviewer-resolved",
    agentSpecHash: digestValue("agent-spec"),
    policyHash: digestValue("policy"),
    promptTemplateRef: "review-file",
    promptTemplateHash: digestValue("prompt-template"),
    itemsFrom: "artifact://changed-files",
    concurrency: { initial: 2, max: 4, rampEveryMs: 700, adaptiveRateLimit: false },
    failurePolicy: { kind: "all-required" },
    retryPolicy: { maxAttempts: 2, maxDelayMs: 1000, deadlineMs: 60_000 },
    outputSchemaRef: "review-result",
    outputSchemaHash: digestValue("review-result"),
    budgetRef: "medium",
  };
  const batchValidator = validator("batch-swarm-v1");
  assert.equal(batchValidator(batch), true, JSON.stringify(batchValidator.errors));
  assert.equal(batchValidator({ ...batch, secondAgentSpecRef: "writer" }), false);
});
