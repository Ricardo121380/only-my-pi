import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createBatchSwarmControlService } from "../packages/control-service/batch-swarm-service.mjs";
import { createSwarmControlService } from "../packages/control-service/swarm-service.mjs";
import { createBatchSwarmRegistry } from "../packages/subagents/batch-swarm/registry.mjs";
import { createPiBatchSwarmRuntime } from "../packages/subagents/batch-swarm/runtime.mjs";
import { createPiSubagentsRpcV1CapabilityMatrix } from "../packages/subagents/adapters/pi-subagents-rpc-v1/index.mjs";

const root = process.cwd();
const input = Object.freeze({
  artifacts: {
    items: [
      { itemId: "src-a", path: "src/a.mjs" },
      { itemId: "src-b", path: "src/b.mjs" },
    ],
  },
});

test("BatchSwarm registry binds definition, prompt, and registered AgentSpec provenance", async () => {
  const registry = createBatchSwarmRegistry({ rootDir: root });
  const entries = await registry.list();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, "review-items");
  assert.equal(entries[0].definition.agentSpecRef, "omp-reviewer-resolved");
  assert.equal(entries[0].agentSpec.backendAgentId, "omp-reviewer");
  assert.equal(entries[0].definition.promptTemplateHash, "sha256:ecb29c70c453d19db00d079ed032b87b1dbb56744ebd4d2c4779822c88975acd");
  assert.equal((await registry.resolveAgentSpec("omp-reviewer-resolved")).specHash, entries[0].agentSpec.specHash);
  assert.equal(await registry.resolvePromptTemplate("review-item"), entries[0].promptTemplate);
  assert.deepEqual(await registry.doctor(), { ok: true, status: "BATCH_SWARM_DOCTOR_PASS", count: 1, errors: [] });
});

test("standard Pi BatchSwarm runtime negotiates the public backend before preparation", async () => {
  const capabilityMatrix = createPiSubagentsRpcV1CapabilityMatrix({ terminalTransport: true });
  let negotiations = 0;
  const backend = {
    capabilityMatrix,
    async ensureReady() { negotiations += 1; return { capabilityMatrix }; },
    async launch() { assert.fail("preparation must not launch a child"); },
    async awaitTerminal() { assert.fail("preparation must not await a child"); },
    async interrupt() { assert.fail("preparation must not interrupt a child"); },
  };
  const runtime = createPiBatchSwarmRuntime({ backend, rootDir: root });
  const entry = await runtime.registry.resolve("review-items");
  const service = createBatchSwarmControlService({ rootDir: root });
  const preview = await service.dispatch({ subcommand: "plan", batchId: "review-items", input });
  const prepared = await runtime.nodeExecutor.prepareBatch(preview.plan.nodes[0], {
    runId: preview.runId,
    attemptId: "registered-runtime-prepare",
    input,
    priorBatchEvents: [],
  });
  assert.equal(negotiations, 1);
  assert.equal(runtime.physicalRuntimeOwner, "pi-subagents");
  assert.equal(prepared.batchDigest, entry.definitionDigest);
  assert.equal(prepared.itemCount, 2);
});

test("BatchSwarm plan expands items and budgets offline without dispatching a child", async () => {
  const service = createBatchSwarmControlService({ rootDir: root });
  const listed = await service.dispatch({ subcommand: "list" });
  assert.equal(listed.status, "BATCH_SWARM_LIST");
  assert.equal(listed.batches[0].id, "review-items");

  const preview = await service.dispatch({ subcommand: "plan", batchId: "review-items", input });
  assert.equal(preview.status, "BATCH_SWARM_PLAN");
  assert.equal(preview.mutation, false);
  assert.equal(preview.liveDispatch, "NOT_RUN_BY_POLICY");
  assert.equal(preview.expansion.itemCount, 2);
  assert.equal(preview.expansion.maximumAssignments, 4);
  assert.deepEqual(preview.expansion.items.map((item) => item.itemId), ["src-a", "src-b"]);
  assert.equal(preview.plan.nodes[0].kind, "batch-swarm");
  assert.equal(preview.plan.nodes[0].batchMaxItems, 300);
  assert.equal(preview.executionEnvelope.target.kind, "swarm");
  assert.equal(preview.executionEnvelope.target.id, "review-items");

  const blocked = await service.dispatch({
    subcommand: "run",
    batchId: "review-items",
    runId: preview.runId,
    input: preview.input,
    yes: true,
    expectedPlanDigest: preview.plan.planDigest,
    expectedExecutionDigest: preview.executionEnvelope.executionEnvelopeDigest,
  });
  assert.equal(blocked.status, "LIVE_BATCH_SWARM_REQUIRES_PI_SESSION");
  assert.equal(blocked.liveDispatch, "NOT_RUN_BY_POLICY");
});

test("Swarm control routes the batch namespace without relabeling legacy recipes", async () => {
  const service = createSwarmControlService({ rootDir: root });
  const batch = await service.dispatch({ subcommand: "batch", batchSubcommand: "plan", batchId: "review-items", input });
  assert.equal(batch.status, "BATCH_SWARM_PLAN");
  assert.equal(batch.batchId, "review-items");
  const legacy = await service.dispatch({ subcommand: "plan", recipeId: "research-synthesis" });
  assert.equal(legacy.status, "SWARM_PLAN");
  assert.equal(legacy.kind, "legacy-workflow");
});

test("BatchSwarm exact plan/run control passes one immutable envelope to injected orchestration", async () => {
  const calls = [];
  const orchestration = {
    async execute(plan, options) {
      calls.push({ plan, options });
      return { runId: options.runId, status: "completed", nodes: {} };
    },
    async inspect(runId) { return { runId, status: "completed" }; },
    async cancel(runId) { return { runId, status: "cancel-requested" }; },
    async resume(runId) { return { runId, status: "completed" }; },
  };
  const service = createBatchSwarmControlService({ rootDir: root, orchestration });
  const preview = await service.dispatch({ subcommand: "plan", batchId: "review-items", input });
  const stale = await service.dispatch({
    subcommand: "run",
    batchId: "review-items",
    runId: preview.runId,
    input: preview.input,
    yes: true,
    expectedPlanDigest: `sha256:${"0".repeat(64)}`,
    expectedExecutionDigest: preview.executionEnvelope.executionEnvelopeDigest,
  });
  assert.equal(stale.code, "PLAN_DIGEST_MISMATCH");
  assert.equal(calls.length, 0);

  const completed = await service.dispatch({
    subcommand: "run",
    batchId: "review-items",
    runId: preview.runId,
    input: preview.input,
    yes: true,
    expectedPlanDigest: preview.plan.planDigest,
    expectedExecutionDigest: preview.executionEnvelope.executionEnvelopeDigest,
  });
  assert.equal(completed.status, "BATCH_SWARM_COMPLETED");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].options.input, preview.input);
  assert.equal(calls[0].options.executionEnvelope.executionEnvelopeDigest, preview.executionEnvelope.executionEnvelopeDigest);
  assert.equal((await service.dispatch({ subcommand: "status", runId: preview.runId })).status, "BATCH_SWARM_STATUS");
  assert.equal((await service.dispatch({ subcommand: "cancel", runId: preview.runId })).status, "BATCH_SWARM_CANCEL");
  assert.equal((await service.dispatch({ subcommand: "resume", runId: preview.runId, input: preview.input })).status, "BATCH_SWARM_COMPLETED");
});

test("BatchSwarm input and registry paths reject symlinks and source drift", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-batch-control-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const inputFile = path.join(temporary, "items.json");
  const inputLink = path.join(temporary, "items-link.json");
  await fs.writeFile(inputFile, JSON.stringify(input));
  await fs.symlink(inputFile, inputLink);
  const service = createBatchSwarmControlService({ rootDir: root });
  const blockedInput = await service.dispatch({ subcommand: "plan", batchId: "review-items", inputFile: inputLink });
  assert.equal(blockedInput.code, "INVALID_INPUT_FILE");

  const driftRoot = path.join(temporary, "drift");
  await fs.mkdir(driftRoot);
  await fs.cp(path.join(root, "agents"), path.join(driftRoot, "agents"), { recursive: true });
  await fs.cp(path.join(root, "swarm"), path.join(driftRoot, "swarm"), { recursive: true });
  await fs.appendFile(path.join(driftRoot, "agents", "prompts", "reviewer.md"), "\nDrifted prompt.\n");
  const driftDoctor = await createBatchSwarmRegistry({ rootDir: driftRoot }).doctor();
  assert.equal(driftDoctor.ok, false);
  assert.equal(driftDoctor.code, "BATCH_AGENT_REGISTRY_DRIFT");

  const linkRoot = path.join(temporary, "link");
  await fs.mkdir(linkRoot);
  await fs.cp(path.join(root, "agents"), path.join(linkRoot, "agents"), { recursive: true });
  await fs.cp(path.join(root, "swarm"), path.join(linkRoot, "swarm"), { recursive: true });
  const templatePath = path.join(linkRoot, "swarm", "templates", "review-item.txt");
  await fs.rm(templatePath);
  await fs.symlink(path.join(root, "swarm", "templates", "review-item.txt"), templatePath);
  const linkDoctor = await createBatchSwarmRegistry({ rootDir: linkRoot }).doctor();
  assert.equal(linkDoctor.ok, false);
  assert.equal(linkDoctor.code, "BATCH_RESOURCE_ESCAPE");
});
