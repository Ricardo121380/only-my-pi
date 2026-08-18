import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPlanStore } from "../packages/subagents/state/plan-store.mjs";
import { compileWorkflowDefinition } from "../packages/subagents/workflow/plan-compiler/index.mjs";
import { createExecutionEnvelope } from "../packages/subagents/workflow/run-coordinator/index.mjs";

function plan() {
  return compileWorkflowDefinition({
    $schema: "../../schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: "plan-store-fixture",
    version: "2.0.0",
    description: "durable plan store fixture",
    policy: {
      workspace: "shared-read-only",
      mutation: "none",
      egress: { web: "deny", mcp: "deny", provider: "allow" },
      tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
    },
    budget: {
      maxNodes: 8,
      maxParallel: 2,
      maxDepth: 4,
      maxAttemptsPerNode: 1,
      maxWallTimeMs: 10_000,
      maxOutputBytes: 4096,
      maxAssignments: 4,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: {
      kind: "agent",
      id: "inspect",
      agentTemplateRef: "scout",
      assignment: { taskTemplateRef: "inspect-task" },
      outputSchemaRef: null,
      policy: {
        workspace: "shared-read-only",
        mutation: "none",
        egress: { web: "deny", mcp: "deny", provider: "allow" },
        tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
      },
      budget: { maxAttempts: 1, timeoutMs: 1000, maxOutputBytes: 4096, maxTokens: null, maxCostUsd: null },
      cache: { mode: "never", keyInputs: [] },
      idempotency: "content-addressed",
    },
  });
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-plan-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.UTC(2026, 7, 19);
  let counter = 0;
  const store = createPlanStore({
    rootDir: root,
    filesystem: fs,
    clock: () => new Date(now += 5),
    idFactory: (prefix) => `${prefix}-${++counter}`,
  });
  return { root, store };
}

test("Plan Store durably binds an immutable plan and never stores raw input", async (t) => {
  const { root, store } = await fixture(t);
  const workflowPlan = plan();
  const envelope = createExecutionEnvelope(workflowPlan, { runId: "plan-store-run", input: { secret: "must-not-persist" } });
  const created = await store.put({ runId: "plan-store-run", plan: workflowPlan, executionEnvelope: envelope });
  assert.equal(created.status, "CREATED");
  assert.equal(created.record.inputDigest, envelope.runInputDigest);
  const recordText = await fs.readFile(path.join(root, "plan-store-run", "plan.json"), "utf8");
  assert.doesNotMatch(recordText, /must-not-persist/u);
  assert.doesNotMatch(recordText, /secret/u);
  const restarted = createPlanStore({ rootDir: root, filesystem: fs, clock: () => new Date(Date.UTC(2026, 7, 20)) });
  const loaded = await restarted.require("plan-store-run");
  assert.equal(loaded.digest, created.record.digest);
  assert.equal(loaded.executionEnvelope.executionEnvelopeDigest, envelope.executionEnvelopeDigest);
  assert.deepEqual(loaded.plan, workflowPlan);
  assert.equal((await restarted.put({ runId: "plan-store-run", plan: workflowPlan, executionEnvelope: envelope })).status, "DUPLICATE");
});

test("Plan Store rejects plan drift and tampering", async (t) => {
  const { root, store } = await fixture(t);
  const workflowPlan = plan();
  const envelope = createExecutionEnvelope(workflowPlan, { runId: "plan-drift-run", input: {} });
  await store.put({ runId: "plan-drift-run", plan: workflowPlan, executionEnvelope: envelope });
  const altered = structuredClone(workflowPlan);
  altered.description = "not part of immutable plan";
  await assert.rejects(
    store.put({ runId: "plan-drift-run", plan: altered, executionEnvelope: envelope }),
    (error) => error.code === "PLAN_DIGEST_MISMATCH" || error.code === "PLAN_STORE_CONFLICT",
  );
  const filename = path.join(root, "plan-drift-run", "plan.json");
  const value = JSON.parse(await fs.readFile(filename, "utf8"));
  value.inputDigest = `sha256:${"0".repeat(64)}`;
  await fs.writeFile(filename, JSON.stringify(value));
  await assert.rejects(store.get("plan-drift-run"), (error) => error.code === "PLAN_RECORD_TAMPERED" || error.code === "PLAN_RECORD_DRIFT");
});

test("Plan Store rejects unknown durable fields and requires atomic create support", async (t) => {
  const { root, store } = await fixture(t);
  const workflowPlan = plan();
  const envelope = createExecutionEnvelope(workflowPlan, { runId: "unknown-field-run", input: {} });
  await store.put({ runId: "unknown-field-run", plan: workflowPlan, executionEnvelope: envelope });
  const filename = path.join(root, "unknown-field-run", "plan.json");
  const value = JSON.parse(await fs.readFile(filename, "utf8"));
  value.unexpected = true;
  await fs.writeFile(filename, JSON.stringify(value));
  await assert.rejects(store.get("unknown-field-run"), (error) => error.code === "PLAN_RECORD_INVALID");

  const noAtomicLink = { ...fs, link: undefined };
  assert.throws(
    () => createPlanStore({ rootDir: root, filesystem: noAtomicLink }),
    /readFile\/open\/lstat\/link/,
  );
});

test("Plan Store create is first-writer-wins under concurrent publication", async (t) => {
  const { store } = await fixture(t);
  const workflowPlan = plan();
  const envelope = createExecutionEnvelope(workflowPlan, { runId: "race-run", input: {} });
  const results = await Promise.all([
    store.put({ runId: "race-run", plan: workflowPlan, executionEnvelope: envelope }),
    store.put({ runId: "race-run", plan: workflowPlan, executionEnvelope: envelope }),
  ]);
  assert.deepEqual(results.map((entry) => entry.status).sort(), ["CREATED", "DUPLICATE"]);
});

test("cancel requests are durable, idempotent, and refuse symlink escape", async (t) => {
  const { root, store } = await fixture(t);
  const first = await store.requestCancel("cancel-run", { reason: "operator requested stop" });
  assert.equal(first.status, "CREATED");
  const duplicate = await store.requestCancel("cancel-run", { reason: "different text" });
  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(duplicate.request.requestId, first.request.requestId);
  assert.equal((await store.getCancelRequest("cancel-run")).reason, "operator requested stop");

  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "omp-plan-store-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, "symlink-run"));
  await assert.rejects(store.requestCancel("symlink-run"), (error) => error.code === "PLAN_STORE_SYMLINK");
});
