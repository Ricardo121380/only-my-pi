import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentTemplate,
  createBackendCapabilityV2,
  createResolvedAgentSpec,
  digestValue,
} from "../packages/subagents/domain/index.mjs";
import {
  BatchSwarmError,
  createBatchSwarmNodeExecutor,
  digestBatchSwarmDefinition,
  projectBatchSwarmEvents,
  validateBatchSwarmDefinition,
} from "../packages/subagents/batch-swarm/index.mjs";
import { createBudgetLedger } from "../packages/subagents/policy/budget-ledger.mjs";
import { createEventJournal } from "../packages/subagents/state/index.mjs";
import { compileWorkflowDefinition, digestWorkflowValue } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createExecutionEnvelope, createRunCoordinator } from "../packages/subagents/workflow/run-coordinator/index.mjs";

function fixture() {
  const template = createAgentTemplate({
    id: "batch-reviewer",
    version: "1.0.0",
    backendAgentId: "omp-reviewer",
    sourceHash: digestValue("batch-reviewer-source"),
    promptHash: digestValue("batch-reviewer-prompt"),
    tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    requiredCapabilities: ["workspace-read"],
    policyCeiling: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "allow-listed", extension: "deny" },
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
    id: "batch-reviewer-resolved",
    effectivePolicy: {
      workspace: "read-only",
      mutation: "none",
      approval: "deny",
      egress: { web: "deny", mcp: "deny", provider: "allow-listed", extension: "deny" },
    },
  });
  const promptTemplate = "Review item {{index}} ({{itemId}}): {{item}}";
  const definition = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/batch-swarm-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    kind: "batch-swarm",
    id: "review-items",
    agentSpecRef: agentSpec.id,
    agentSpecHash: agentSpec.specHash,
    policyHash: agentSpec.effectivePolicyHash,
    promptTemplateRef: "review-item",
    promptTemplateHash: digestValue(promptTemplate),
    itemsFrom: "artifact://items",
    maxItems: 300,
    concurrency: { initial: 2, max: 4, rampEveryMs: 5, adaptiveRateLimit: false },
    failurePolicy: { kind: "all-required" },
    retryPolicy: { maxAttempts: 2, maxDelayMs: 5, deadlineMs: 60_000 },
    outputSchemaRef: "review-result",
    outputSchemaHash: agentSpec.outputSchema.hash,
    budgetRef: "preview-read-only",
  };
  return { agentSpec, definition, promptTemplate };
}

function capabilities({ adaptive = false } = {}) {
  const keys = [
    "foreground", "background", "continuableResume", "status", "steer", "interrupt",
    "stop", "resume", "dispose", "terminalEvents", "processTerminalProof", "worktree",
    "perItemResult", "usageMeter", "rateLimitSignal", "dynamicConcurrency", "modelOverlay",
    "toolOverlay", "structuredOutput",
  ];
  return createBackendCapabilityV2({
    backendId: "fixture-backend",
    backendVersion: "1.0.0",
    protocol: { name: "fixture", version: 1 },
    observedAt: 1,
    capabilities: Object.fromEntries(keys.map((key) => [key, {
      state: ["rateLimitSignal", "dynamicConcurrency"].includes(key)
        ? (adaptive ? "SUPPORTED" : "UNAVAILABLE")
        : "SUPPORTED",
      reasonCode: adaptive ? "fixture-supported" : "fixture-static",
      evidence: ["test-fixture"],
      constraints: {},
    }])),
  });
}

function node(definition, overrides = {}) {
  return {
    id: "batch-node",
    kind: "batch-swarm",
    batchRef: definition.id,
    batchDigest: digestBatchSwarmDefinition(definition),
    batchMaxItems: definition.maxItems,
    batchMaxAttempts: definition.retryPolicy.maxAttempts,
    budget: {
      maxAttempts: 1,
      timeoutMs: definition.retryPolicy.deadlineMs,
      maxOutputBytes: 1_048_576,
      maxTokens: null,
      maxCostUsd: null,
    },
    ...overrides,
  };
}

function terminal(index, extra = {}) {
  return {
    outcome: "completed",
    authoritative: true,
    receiptId: digestValue({ terminal: index, ...extra }),
    result: { verdict: `pass-${index}` },
    usage: { elapsedMs: 1, tokens: 0, costUsd: 0 },
    handle: { handleId: `handle-${index}` },
    ...extra,
  };
}

function batchWorkflowDefinition(values, { items = 300, attempts = 2 } = {}) {
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "runtime-ready",
    id: "batch-workflow",
    version: "2.0.0",
    description: "BatchSwarm integration fixture",
    policy: {
      workspace: "shared-read-only",
      mutation: "none",
      egress: { web: "deny", mcp: "deny", provider: "allow" },
      tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    },
    budget: {
      maxNodes: 1,
      maxParallel: 1,
      maxDepth: 1,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: values.definition.retryPolicy.deadlineMs,
      maxOutputBytes: 1_048_576,
      maxAssignments: items * attempts,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: {
      kind: "batch-swarm",
      id: "review-batch",
      batchRef: values.definition.id,
      policy: { workspace: "shared-read-only", mutation: "none", tools: { allow: ["read"] } },
      budget: { maxAttempts: 1, timeoutMs: values.definition.retryPolicy.deadlineMs, maxOutputBytes: 1_048_576 },
      cache: { mode: "content-addressed", keyInputs: ["artifacts.items"] },
      idempotency: "content-addressed",
    },
    terminalNodeId: "review-batch",
  };
}

async function seedStartedBatchAttempt({
  eventJournal,
  budgetLedger,
  plan,
  input,
  envelope,
  prepared,
  runId,
  includeTerminal,
}) {
  const nodeId = plan.nodes[0].id;
  const attemptId = `${nodeId}:old-attempt`;
  const reservationId = `${nodeId}:old-reservation`;
  const item = prepared.items[0];
  const assignmentHash = digestValue({ assignment: `${runId}:item-zero` });
  const lease = await eventJournal.acquireWriter(runId, { writerId: "batch-crash-fixture", ttlMs: 1000 });
  let version = await eventJournal.read(runId);
  const append = async (event) => {
    const result = await eventJournal.append(runId, event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue(input), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId, payload: { nodeDigest: digestWorkflowValue(plan.nodes[0]), needs: [] } });
  await budgetLedger.reserve(runId, {
    reservationId,
    ownerId: nodeId,
    nodeId,
    attemptId,
    worstCase: { assignments: prepared.reservation.assignments, elapsedMs: 60_000, rawOutputBytes: 1_048_576 },
  }, { lease, revision: 0 });
  version = await eventJournal.read(runId);
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId, attemptId, payload: { reservationId, attemptNumber: 1 } });
  await append({ eventId: "fixture-child", type: "ChildStarted", revision: 0, nodeId, attemptId, childId: "old-batch-controller", payload: { localOnly: true, batch: true } });
  await append({ eventId: "fixture-batch-started", type: "BatchStarted", revision: 0, nodeId, attemptId, swarmRunId: prepared.batchRunId, payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, itemCount: prepared.itemCount, preparationDigest: prepared.preparationDigest } });
  await append({ eventId: "fixture-item-started", type: "BatchItemStarted", revision: 0, nodeId, attemptId, swarmRunId: prepared.batchRunId, childId: "old-item-handle", payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, index: item.index, itemId: item.itemId, itemDigest: item.itemDigest, itemAttempt: 1, assignmentId: "old-item-assignment", assignmentHash, handleId: "old-item-handle" } });
  if (includeTerminal) {
    await append({ eventId: "fixture-item-terminal", type: "BatchItemTerminal", revision: 0, nodeId, attemptId, swarmRunId: prepared.batchRunId, childId: "old-item-handle", payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, index: item.index, itemId: item.itemId, itemDigest: item.itemDigest, itemAttempt: 1, status: "succeeded", assignmentId: "old-item-assignment", assignmentHash, handleId: "old-item-handle", receiptId: digestValue({ receipt: `${runId}:item-zero` }), authoritative: true, result: { verdict: "pass-0" }, error: null, usage: { elapsedMs: 1, rawOutputBytes: 20, tokens: 0, costUsd: 0 } } });
  }
  await eventJournal.releaseWriter(runId, { lease });
  return { attemptId, reservationId };
}

function createExecutor(overrides = {}) {
  const values = fixture();
  const calls = [];
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async (id) => {
      assert.equal(id, values.definition.id);
      return values.definition;
    },
    resolveAgentSpec: async (id) => {
      assert.equal(id, values.agentSpec.id);
      return values.agentSpec;
    },
    resolvePromptTemplate: async (id) => {
      assert.equal(id, values.definition.promptTemplateRef);
      return values.promptTemplate;
    },
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      calls.push(input);
      return terminal(input.index);
    },
    ...overrides,
  });
  return { ...values, calls, executor };
}

async function execute(executor, definition, items, options = {}) {
  const events = [...(options.priorEvents ?? [])];
  const batchNode = node(definition);
  const context = {
    runId: options.runId ?? "batch-run",
    revision: 0,
    attemptId: options.attemptId ?? "batch-attempt-1",
    input: { artifacts: { items } },
    inputDigest: digestValue(items),
    signal: options.signal,
    priorBatchEvents: events,
    async recordBatchEvent(event) { events.push(event); },
  };
  const prepared = await executor.prepareBatch(batchNode, context);
  const result = await executor.runBatch(batchNode, { ...context, prepared });
  return { prepared, result, events, projection: projectBatchSwarmEvents(events, prepared) };
}

test("BatchSwarm runtime contract rejects invalid envelopes and heterogeneous overrides", async () => {
  const { definition, executor } = createExecutor();
  assert.deepEqual(validateBatchSwarmDefinition(definition), { valid: true, errors: [] });
  assert.equal(validateBatchSwarmDefinition({ ...definition, maxItems: 0 }).valid, false);
  assert.equal(validateBatchSwarmDefinition({ ...definition, concurrency: { ...definition.concurrency, initial: 5 } }).valid, false);
  assert.equal(validateBatchSwarmDefinition({ ...definition, failurePolicy: { kind: "quorum", threshold: 301 } }).valid, false);
  assert.equal(validateBatchSwarmDefinition({ ...definition, retryPolicy: { ...definition.retryPolicy, maxAttempts: 4 } }).errors[0].code, "INVALID_BATCH_ASSIGNMENT_ENVELOPE");

  await assert.rejects(
    () => execute(executor, definition, [{ itemId: "bad", agentSpecRef: "another-agent" }]),
    (error) => error instanceof BatchSwarmError && error.code === "BATCH_HETEROGENEOUS_ITEM_OVERRIDE",
  );
});

test("BatchSwarm binds exact AgentSpec, policy, output schema, and prompt template hashes", async () => {
  const { definition, agentSpec, promptTemplate } = fixture();
  const wrongAgentDefinition = { ...definition, agentSpecHash: digestValue("wrong") };
  for (const [label, candidateDefinition, executor, code] of [
    ["agent", wrongAgentDefinition, createBatchSwarmNodeExecutor({
      resolveBatch: async () => wrongAgentDefinition,
      resolveAgentSpec: async () => agentSpec,
      resolvePromptTemplate: async () => promptTemplate,
      capabilityMatrix: capabilities(),
      executeItem: async () => terminal(0),
    }), "BATCH_AGENT_SPEC_HASH_MISMATCH"],
    ["prompt", definition, createBatchSwarmNodeExecutor({
      resolveBatch: async () => definition,
      resolveAgentSpec: async () => agentSpec,
      resolvePromptTemplate: async () => `${promptTemplate}!`,
      capabilityMatrix: capabilities(),
      executeItem: async () => terminal(0),
    }), "BATCH_PROMPT_TEMPLATE_HASH_MISMATCH"],
  ]) {
    await assert.rejects(
      () => execute(executor, candidateDefinition, [{ value: label }]),
      (error) => error.code === code,
    );
  }

  const tamperedAgent = structuredClone(agentSpec);
  tamperedAgent.tools.allow = ["read", "web"];
  const tamperedExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => tamperedAgent,
    resolvePromptTemplate: async () => promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async () => terminal(0),
  });
  await assert.rejects(
    () => execute(tamperedExecutor, definition, [{ value: "tampered" }]),
    (error) => error.code === "BATCH_AGENT_SPEC_TAMPERED",
  );
});

test("adaptive BatchSwarm fails before dispatch when the pinned backend cannot expose capacity signals", async () => {
  const values = fixture();
  const adaptive = { ...values.definition, concurrency: { ...values.definition.concurrency, adaptiveRateLimit: true } };
  let dispatches = 0;
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => adaptive,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities({ adaptive: false }),
    executeItem: async () => { dispatches += 1; return terminal(0); },
  });
  await assert.rejects(
    () => execute(executor, adaptive, [{ value: 1 }]),
    (error) => error.code === "ADAPTIVE_CAPACITY_UNAVAILABLE",
  );
  assert.equal(dispatches, 0);
});

test("a correlated 429 storm halves adaptive capacity, recovers, and never amplifies retry", async () => {
  const values = fixture();
  const adaptive = {
    ...values.definition,
    concurrency: { initial: 4, max: 4, rampEveryMs: 20, adaptiveRateLimit: true },
  };
  const attempts = new Map();
  let active = 0;
  let maximum = 0;
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => adaptive,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities({ adaptive: true }),
    executeItem: async (input) => {
      active += 1;
      maximum = Math.max(maximum, active);
      attempts.set(input.index, (attempts.get(input.index) ?? 0) + 1);
      await Promise.resolve();
      active -= 1;
      if (input.index < 4 && input.itemAttempt === 1) {
        return {
          ...terminal(input.index),
          outcome: "failed",
          error: { code: "429", retryable: true, retryAfterMs: 1 },
        };
      }
      return terminal(input.index);
    },
  });
  const run = await execute(executor, adaptive, Array.from({ length: 8 }, (_, value) => ({ value })));
  const changes = run.events.filter((event) => event.type === "BatchCapacityChanged");
  assert.equal(run.result.outcome, "completed");
  assert.deepEqual([...attempts.entries()].sort((left, right) => left[0] - right[0]), [
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 1], [5, 1], [6, 1], [7, 1],
  ]);
  assert.equal(run.result.usage.assignments, 12);
  assert.ok(maximum <= adaptive.concurrency.max);
  assert.ok(changes.some((event) => event.payload.previous === 4 && event.payload.current === 2));
  assert.ok(changes.some((event) => event.payload.previous === 2 && event.payload.current === 1));
  assert.deepEqual(run.projection.capacityChanges, changes.map((event) => event.payload));
});

test("journal-first admission never dispatches an item whose queued event was not persisted", async () => {
  const { definition, executor } = createExecutor();
  let dispatches = 0;
  executor.executeItem = async () => {
    dispatches += 1;
    return terminal(0);
  };
  const batchNode = node(definition);
  const context = {
    runId: "append-failure-run",
    revision: 0,
    attemptId: "append-failure-attempt",
    input: { artifacts: { items: [{ value: 0 }, { value: 1 }] } },
    inputDigest: digestValue([{ value: 0 }, { value: 1 }]),
    async recordBatchEvent(event) {
      if (event.type === "BatchItemQueued") throw Object.assign(new Error("journal unavailable"), { code: "JOURNAL_UNAVAILABLE" });
    },
  };
  const prepared = await executor.prepareBatch(batchNode, context);
  await assert.rejects(
    () => executor.runBatch(batchNode, { ...context, prepared }),
    (error) => error.code === "BATCH_EVENT_APPEND_FAILED",
  );
  assert.equal(dispatches, 0);
});

test("zero items settle empty and one item degrades to a single Agent assignment", async () => {
  const { definition, executor, calls } = createExecutor();
  const empty = await execute(executor, definition, []);
  assert.equal(empty.result.outcome, "completed");
  assert.equal(empty.result.result.total, 0);
  assert.equal(empty.result.result.degradedToAgent, false);
  assert.equal(calls.length, 0);

  const one = await execute(executor, definition, [{ value: "alpha" }]);
  assert.equal(one.result.outcome, "completed");
  assert.equal(one.result.result.degradedToAgent, true);
  assert.equal(one.result.result.items.length, 1);
  assert.match(calls[0].assignment.task.text, /Review item 0/);
  assert.match(calls[0].assignment.task.text, /"alpha"/);
  assert.equal(calls[0].agentSpec.specHash, one.prepared.agentSpecHash);
});

test("stable result slots ignore completion order and enforce the static concurrency ceiling", async () => {
  const values = fixture();
  let active = 0;
  let maximum = 0;
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => values.definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, (7 - input.index) % 4));
      active -= 1;
      return terminal(input.index);
    },
  });
  const run = await execute(executor, values.definition, Array.from({ length: 8 }, (_, index) => ({ value: index })));
  assert.equal(run.result.outcome, "completed");
  assert.ok(maximum <= values.definition.concurrency.max, `observed ${maximum}`);
  assert.deepEqual(run.result.result.items.map((item) => item.index), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(run.result.result.items.map((item) => item.result.verdict), Array.from({ length: 8 }, (_, index) => `pass-${index}`));
  assert.equal(run.result.usage.assignments, 8);
});

test("finite retry does not amplify and continue preserves explicit failed slots", async () => {
  const values = fixture();
  const attempts = new Map();
  const definition = { ...values.definition, failurePolicy: { kind: "continue" } };
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      attempts.set(input.index, (attempts.get(input.index) ?? 0) + 1);
      if (input.index === 0 && input.itemAttempt === 1) {
        return { ...terminal(input.index), outcome: "failed", error: { code: "RATE_LIMITED", retryable: true, retryAfterMs: 1 } };
      }
      if (input.index === 1) return { ...terminal(input.index), outcome: "failed", error: { code: "PERMANENT", retryable: false } };
      return terminal(input.index);
    },
  });
  const run = await execute(executor, definition, [{ value: 0 }, { value: 1 }, { value: 2 }]);
  assert.equal(run.result.outcome, "completed");
  assert.deepEqual(Object.fromEntries(attempts), { 0: 2, 1: 1, 2: 1 });
  assert.deepEqual(run.result.result.items.map((item) => item.status), ["succeeded", "failed", "succeeded"]);
  assert.equal(run.result.result.failed, 1);
});

test("a retryable but non-authoritative item terminal never causes a second physical launch", async () => {
  const values = fixture();
  const definition = {
    ...values.definition,
    concurrency: { ...values.definition.concurrency, initial: 1, max: 1 },
    failurePolicy: { kind: "continue" },
  };
  let calls = 0;
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      calls += 1;
      return {
        ...terminal(input.index),
        outcome: "failed",
        authoritative: false,
        error: { code: "RATE_LIMITED", retryable: true, retryAfterMs: 1 },
      };
    },
  });
  const run = await execute(executor, definition, [{ value: 0 }]);
  assert.equal(calls, 1);
  assert.equal(run.result.result.items[0].attempts, 1);
  assert.equal(run.result.result.items[0].authoritative, false);
  assert.equal(run.result.usage.assignments, 1);
});

test("an item executor that ignores AbortSignal cannot hold the batch open or admit another item", async () => {
  const values = fixture();
  const definition = {
    ...values.definition,
    concurrency: { ...values.definition.concurrency, initial: 1, max: 1 },
    failurePolicy: { kind: "continue" },
  };
  const controller = new AbortController();
  let calls = 0;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async () => {
      calls += 1;
      entered();
      return new Promise(() => {});
    },
  });
  const pending = execute(executor, definition, [{ value: 0 }, { value: 1 }], { signal: controller.signal });
  await enteredPromise;
  controller.abort(new Error("test cancellation"));
  let timer;
  const run = await Promise.race([
    pending,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("BatchSwarm cancellation did not settle")), 500); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(calls, 1);
  assert.equal(run.result.outcome, "cancelled");
  assert.equal(run.result.result.items[0].authoritative, false);
  assert.equal(run.result.result.items[1].status, "cancelled");
  assert.equal(run.result.usage.assignments, 1);
});

test("fail-fast and cancellation close admission without dropping queued slots", async () => {
  const values = fixture();
  const definition = {
    ...values.definition,
    concurrency: { ...values.definition.concurrency, initial: 1, max: 1 },
    failurePolicy: { kind: "fail-fast" },
  };
  let calls = 0;
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      calls += 1;
      return input.index === 0
        ? { ...terminal(0), outcome: "failed", error: { code: "FIRST_FAILED", retryable: false } }
        : terminal(input.index);
    },
  });
  const failed = await execute(executor, definition, Array.from({ length: 6 }, (_, value) => ({ value })));
  assert.equal(calls, 1);
  assert.equal(failed.result.outcome, "failed");
  assert.deepEqual(failed.result.result.items.map((item) => item.status), ["failed", "skipped", "skipped", "skipped", "skipped", "skipped"]);

  const controller = new AbortController();
  let cancelCalls = 0;
  const cancelExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => ({ ...definition, failurePolicy: { kind: "continue" } }),
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => {
      cancelCalls += 1;
      controller.abort();
      return { ...terminal(input.index), outcome: "cancelled" };
    },
  });
  const cancelled = await execute(cancelExecutor, { ...definition, failurePolicy: { kind: "continue" } }, Array.from({ length: 6 }, (_, value) => ({ value })), { signal: controller.signal });
  assert.equal(cancelCalls, 1);
  assert.equal(cancelled.result.outcome, "cancelled");
  assert.ok(cancelled.result.result.items.slice(1).every((item) => item.status === "cancelled"));
});

test("durable item events resume by item identity and never replay an authoritative success", async () => {
  const { definition, executor } = createExecutor();
  const first = await execute(executor, definition, [{ value: 0 }, { value: 1 }]);
  const prior = first.events.filter((event) => event.type !== "BatchSettled" && event.payload.index === 0);
  let resumedCalls = 0;
  const resumedExecutor = createExecutor({
    executeItem: async (input) => { resumedCalls += 1; return terminal(input.index, { resumed: true }); },
  }).executor;
  const resumed = await execute(resumedExecutor, definition, [{ value: 0 }, { value: 1 }], { priorEvents: prior, attemptId: "batch-attempt-2" });
  assert.equal(resumedCalls, 1);
  assert.deepEqual(resumed.result.result.items.map((item) => item.status), ["succeeded", "succeeded"]);
  assert.equal(resumed.result.result.items[0].attempts, 1);
  assert.equal(resumed.result.result.items[1].attempts, 1);
});

test("logical 1/8/20/64/300 simulations remain bounded and stable", async () => {
  const values = fixture();
  for (const size of [1, 8, 20, 64, 300]) {
    let active = 0;
    let maximum = 0;
    const executor = createBatchSwarmNodeExecutor({
      resolveBatch: async () => values.definition,
      resolveAgentSpec: async () => values.agentSpec,
      resolvePromptTemplate: async () => values.promptTemplate,
      capabilityMatrix: capabilities(),
      executeItem: async (input) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await Promise.resolve();
        active -= 1;
        return terminal(input.index);
      },
    });
    const run = await execute(executor, values.definition, Array.from({ length: size }, (_, value) => ({ value })), { runId: `simulation-${size}` });
    assert.equal(run.result.result.total, size);
    assert.equal(run.result.result.items.length, size);
    assert.ok(maximum <= values.definition.concurrency.max, `${size}: ${maximum}`);
    assert.deepEqual(run.result.result.items.map((item) => item.index), Array.from({ length: size }, (_, index) => index));
  }
});

test("WorkflowPlan batch nodes reserve the full item-attempt envelope and project one durable stable ledger", async (t) => {
  const values = fixture();
  const definition = batchWorkflowDefinition(values);
  const plan = compileWorkflowDefinition(definition, { resolveBatch: () => values.definition });
  assert.equal(plan.nodes[0].batchMaxItems, 300);
  assert.equal(plan.nodes[0].batchMaxAttempts, 2);
  assert.equal(plan.nodes[0].batchDigest, digestBatchSwarmDefinition(values.definition));

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-batch-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 19);
  let sequence = 0;
  const clock = () => new Date(now += 2);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock, idFactory });
  const budgetLedger = createBudgetLedger({
    eventJournal,
    envelope: () => plan.budget,
    metering: () => ({ tokens: false, cost: false }),
  });
  const nodeExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => values.definition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (input) => terminal(input.index),
  });
  const coordinator = createRunCoordinator({
    eventJournal,
    budgetLedger,
    nodeExecutor,
    clock: () => now,
    idFactory,
  });
  const state = await coordinator.execute(plan, {
    runId: "batch-workflow-run",
    input: { artifacts: { items: [{ value: 0 }, { value: 1 }, { value: 2 }] } },
  });
  assert.equal(state.status, "completed");
  assert.equal(state.nodes["review-batch"].batch.status, "completed");
  assert.deepEqual(state.nodes["review-batch"].batch.items.map((item) => item.index), [0, 1, 2]);
  assert.ok(state.nodes["review-batch"].batch.items.every((item) => item.status === "succeeded"));

  const events = (await eventJournal.read("batch-workflow-run")).events;
  const reserved = events.find((event) => event.type === "BudgetReserved");
  const consumed = events.find((event) => event.type === "BudgetConsumed");
  assert.equal(reserved.payload.worstCase.assignments, 6);
  assert.equal(consumed.payload.consumed.assignments, 3);
  assert.equal(events.filter((event) => event.type === "BatchItemTerminal").length, 3);

  const doubleRetryDefinition = structuredClone(definition);
  doubleRetryDefinition.budget.maxAttemptsPerNode = 2;
  doubleRetryDefinition.flow.budget.maxAttempts = 2;
  await assert.rejects(
    async () => compileWorkflowDefinition(doubleRetryDefinition, { resolveBatch: () => values.definition }),
    (error) => error.code === "BATCH_ROOT_RETRY_FORBIDDEN",
  );
});

test("RunCoordinator waits for BatchSwarm cancellation receipts before releasing its journal lease", async (t) => {
  const values = fixture();
  const batchDefinition = {
    ...values.definition,
    maxItems: 1,
    concurrency: { ...values.definition.concurrency, initial: 1, max: 1 },
    retryPolicy: { maxAttempts: 1, maxDelayMs: 0, deadlineMs: 500 },
  };
  const definition = batchWorkflowDefinition({ ...values, definition: batchDefinition }, { items: 1, attempts: 1 });
  const plan = compileWorkflowDefinition(definition, { resolveBatch: () => batchDefinition });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-batch-timeout-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let sequence = 0;
  const eventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock: () => new Date(), idFactory: (prefix) => `${prefix}-${++sequence}` });
  const budgetLedger = createBudgetLedger({ eventJournal, envelope: () => plan.budget, metering: () => ({ tokens: false, cost: false }) });
  const nodeExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => batchDefinition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async () => new Promise(() => {}),
  });
  const coordinator = createRunCoordinator({ eventJournal, budgetLedger, nodeExecutor });
  let timer;
  const state = await Promise.race([
    coordinator.execute(plan, { runId: "batch-cooperative-timeout", input: { artifacts: { items: [{ value: 0 }] } } }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("coordinator did not settle a cancelled BatchSwarm")), 2000); }),
  ]).finally(() => clearTimeout(timer));
  assert.equal(state.status, "orphaned");
  const events = (await eventJournal.read("batch-cooperative-timeout")).events;
  const itemTerminalIndex = events.findIndex((event) => event.type === "BatchItemTerminal");
  const itemStartedIndex = events.findIndex((event) => event.type === "BatchItemStarted");
  const batchSettledIndex = events.findIndex((event) => event.type === "BatchSettled");
  const childTerminalIndex = events.findIndex((event) => event.type === "ChildTerminal");
  assert.ok(itemStartedIndex >= 0 && itemStartedIndex < itemTerminalIndex);
  assert.ok(itemTerminalIndex < batchSettledIndex && batchSettledIndex < childTerminalIndex);
  assert.equal(events[itemTerminalIndex].payload.authoritative, false);
  assert.equal(events[childTerminalIndex].payload.authoritative, false);
  assert.equal(events.some((event) => event.payload?.errorCode === "BATCH_EVENT_APPEND_FAILED"), false);
});

test("RunCoordinator reuses one batch reservation after a crash and preserves authoritative item slots", async (t) => {
  const values = fixture();
  const batchDefinition = { ...values.definition, maxItems: 2 };
  const definition = batchWorkflowDefinition({ ...values, definition: batchDefinition }, { items: 2, attempts: 2 });
  const plan = compileWorkflowDefinition(definition, { resolveBatch: () => batchDefinition });
  const input = { artifacts: { items: [{ value: 0 }, { value: 1 }] } };
  const runId = "batch-crash-resume";
  const envelope = createExecutionEnvelope(plan, { runId, input });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-batch-crash-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 19);
  let sequence = 0;
  const clock = () => new Date(now += 2);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock, idFactory });
  const budgetLedger = createBudgetLedger({ eventJournal, envelope: () => plan.budget, metering: () => ({ tokens: false, cost: false }) });
  let resumedCalls = 0;
  const nodeExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => batchDefinition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async (context) => {
      resumedCalls += 1;
      assert.equal(context.index, 1, "the authoritative item zero must not replay");
      return terminal(context.index);
    },
  });
  const prepared = await nodeExecutor.prepareBatch(plan.nodes[0], {
    runId,
    attemptId: "review-batch:old-attempt",
    input,
    inputDigest: digestWorkflowValue(input),
    priorBatchEvents: [],
  });
  const oldItem = prepared.items[0];
  const oldAttemptId = "review-batch:old-attempt";
  const oldReservationId = "review-batch:old-reservation";
  const oldAssignmentHash = digestValue({ assignment: "old-item-zero" });
  const lease = await eventJournal.acquireWriter(runId, { writerId: "batch-crash-fixture", ttlMs: 1000 });
  let version = await eventJournal.read(runId);
  const append = async (event) => {
    const result = await eventJournal.append(runId, event, { lease, expectedSeq: version.lastSeq, expectedDigest: version.lastEventDigest });
    version = { lastSeq: result.lastSeq, lastEventDigest: result.lastEventDigest };
  };
  await append({ eventId: "fixture-planned", type: "RunPlanned", revision: 0, payload: { planId: plan.id, planDigest: plan.planDigest, policyDigest: plan.policyDigest, runInputDigest: digestWorkflowValue(input), executionEnvelopeDigest: envelope.executionEnvelopeDigest, executionEnvelope: envelope } });
  await append({ eventId: "fixture-started", type: "RunStarted", revision: 0, payload: { planDigest: plan.planDigest, executionEnvelopeDigest: envelope.executionEnvelopeDigest } });
  await append({ eventId: "fixture-queued", type: "NodeQueued", revision: 0, nodeId: "review-batch", payload: { nodeDigest: digestWorkflowValue(plan.nodes[0]), needs: [] } });
  await budgetLedger.reserve(runId, {
    reservationId: oldReservationId,
    ownerId: "review-batch",
    nodeId: "review-batch",
    attemptId: oldAttemptId,
    worstCase: { assignments: 4, elapsedMs: 60_000, rawOutputBytes: 1_048_576 },
  }, { lease, revision: 0 });
  version = await eventJournal.read(runId);
  await append({ eventId: "fixture-admitted", type: "NodeAdmitted", revision: 0, nodeId: "review-batch", attemptId: oldAttemptId, payload: { reservationId: oldReservationId, attemptNumber: 1 } });
  await append({ eventId: "fixture-child", type: "ChildStarted", revision: 0, nodeId: "review-batch", attemptId: oldAttemptId, childId: "old-batch-controller", payload: { localOnly: true, batch: true } });
  await append({ eventId: "fixture-batch-started", type: "BatchStarted", revision: 0, nodeId: "review-batch", attemptId: oldAttemptId, swarmRunId: prepared.batchRunId, payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, itemCount: prepared.itemCount, preparationDigest: prepared.preparationDigest } });
  await append({ eventId: "fixture-item-started", type: "BatchItemStarted", revision: 0, nodeId: "review-batch", attemptId: oldAttemptId, swarmRunId: prepared.batchRunId, childId: "old-item-handle", payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, index: oldItem.index, itemId: oldItem.itemId, itemDigest: oldItem.itemDigest, itemAttempt: 1, assignmentId: "old-item-assignment", assignmentHash: oldAssignmentHash, handleId: "old-item-handle" } });
  await append({ eventId: "fixture-item-terminal", type: "BatchItemTerminal", revision: 0, nodeId: "review-batch", attemptId: oldAttemptId, swarmRunId: prepared.batchRunId, childId: "old-item-handle", payload: { batchId: prepared.batchId, batchDigest: prepared.batchDigest, index: oldItem.index, itemId: oldItem.itemId, itemDigest: oldItem.itemDigest, itemAttempt: 1, status: "succeeded", assignmentId: "old-item-assignment", assignmentHash: oldAssignmentHash, handleId: "old-item-handle", receiptId: digestValue({ receipt: "old-item-zero" }), authoritative: true, result: { verdict: "pass-0" }, error: null, usage: { elapsedMs: 1, rawOutputBytes: 20, tokens: 0, costUsd: 0 } } });
  await eventJournal.releaseWriter(runId, { lease });

  const coordinator = createRunCoordinator({ eventJournal, budgetLedger, nodeExecutor, clock: () => now, idFactory });
  const state = await coordinator.execute(plan, { runId, input, executionEnvelope: envelope });
  assert.equal(state.status, "completed");
  assert.equal(resumedCalls, 1);
  assert.deepEqual(state.nodes["review-batch"].batch.items.map((item) => [item.index, item.status]), [[0, "succeeded"], [1, "succeeded"]]);
  const events = (await eventJournal.read(runId)).events;
  assert.equal(events.filter((event) => event.type === "BudgetReserved").length, 1, "resume must reuse the durable reservation");
  const consumed = events.find((event) => event.type === "BudgetConsumed");
  assert.equal(consumed.payload.consumed.assignments, 2);
  assert.equal(events.filter((event) => event.type === "BatchItemStarted" && event.payload.index === 0).length, 1);
});

test("RunCoordinator never replays a batch item whose process terminal is unproven", async (t) => {
  const values = fixture();
  const batchDefinition = { ...values.definition, maxItems: 1 };
  const definition = batchWorkflowDefinition({ ...values, definition: batchDefinition }, { items: 1, attempts: 2 });
  const plan = compileWorkflowDefinition(definition, { resolveBatch: () => batchDefinition });
  const input = { artifacts: { items: [{ value: 0 }] } };
  const runId = "batch-unproven-child";
  const envelope = createExecutionEnvelope(plan, { runId, input });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-batch-unproven-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 19);
  let sequence = 0;
  const clock = () => new Date(now += 2);
  const idFactory = (prefix) => `${prefix}-${++sequence}`;
  const eventJournal = createEventJournal({ rootDir: root, filesystem: fs, clock, idFactory });
  const budgetLedger = createBudgetLedger({ eventJournal, envelope: () => plan.budget, metering: () => ({ tokens: false, cost: false }) });
  let dispatches = 0;
  const nodeExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => batchDefinition,
    resolveAgentSpec: async () => values.agentSpec,
    resolvePromptTemplate: async () => values.promptTemplate,
    capabilityMatrix: capabilities(),
    executeItem: async () => { dispatches += 1; return terminal(0); },
  });
  const prepared = await nodeExecutor.prepareBatch(plan.nodes[0], {
    runId,
    attemptId: "review-batch:old-attempt",
    input,
    inputDigest: digestWorkflowValue(input),
    priorBatchEvents: [],
  });
  const { reservationId } = await seedStartedBatchAttempt({
    eventJournal,
    budgetLedger,
    plan,
    input,
    envelope,
    prepared,
    runId,
    includeTerminal: false,
  });
  const coordinator = createRunCoordinator({ eventJournal, budgetLedger, nodeExecutor, clock: () => now, idFactory });
  const state = await coordinator.execute(plan, { runId, input, executionEnvelope: envelope });
  assert.equal(state.status, "interrupted");
  assert.equal(dispatches, 0);
  const events = (await eventJournal.read(runId)).events;
  const consumed = events.find((event) => event.type === "BudgetConsumed" && event.payload.reservationId === reservationId);
  assert.equal(consumed.payload.consumed.assignments, 2, "unknown child consumption must charge the full reservation");
  assert.equal(events.filter((event) => event.type === "BatchItemStarted").length, 1);
});
