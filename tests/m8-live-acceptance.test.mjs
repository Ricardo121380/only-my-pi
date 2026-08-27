import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  M8_LIVE_EXPECTED_ASSERTIONS,
  parseM8LiveAcceptanceArgs,
  runPiM8Phase,
} from "../scripts/m8-live-acceptance.mjs";
import { M8_LIVE_RECORD_TYPE, createM8ProtectedSequentialPlan, m8ProtectedConfiguration, m8ProtectedGoalPlannerPolicy, m8ProtectedToolCallLimit, m8ProtectedTurnLimit } from "../packages/subagents/release/m8-live-acceptance-extension.mjs";
import { protectedEvidenceDigest, validateDailyHarnessProtectedEvidence } from "../scripts/lib/daily-harness-gates.mjs";

test("M8 live CLI is plan-first and run requires explicit artifact/output confirmation", () => {
  const plan = parseM8LiveAcceptanceArgs(["--plan"]);
  assert.equal(plan.operation, "plan");
  assert.equal(plan.provider, "cc-switch-open-code-go");
  assert.equal(plan.model, "deepseek-v4-flash");
  assert.throws(() => parseM8LiveAcceptanceArgs(["--run"]), /requires --yes/u);
  assert.throws(() => parseM8LiveAcceptanceArgs(["--run", "--yes", "--artifact-sha256", "bad", "--output", "/tmp/evidence.json"]), /requires --yes/u);
  const run = parseM8LiveAcceptanceArgs(["--run", "--yes", "--artifact-sha256", "a".repeat(64), "--output", "/tmp/evidence.json"]);
  assert.equal(run.operation, "run");
  assert.equal(run.artifactSha256, "a".repeat(64));
});

test("Pi M8 phase uses real config through a scrubbed shell-free process and emits one bounded record", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m8-phase-config-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const subagentsEntry = path.join(configRoot, "subagents.ts");
  await fs.writeFile(subagentsEntry, "// fixture\n");
  let invocation;
  const record = {
    formatVersion: 1,
    type: M8_LIVE_RECORD_TYPE,
    phase: "main",
    status: "PASS",
    sourceCommit: "a".repeat(40),
    model: { provider: "provider", id: "model" },
    assertions: [],
    usage: { tokens: 0, costUsd: 0, toolCalls: 0, meteredTerminals: 0 },
  };
  const result = await runPiM8Phase({
    piCommand: "pi",
    phase: "main",
    request: { formatVersion: 1, phase: "main", sourceCommit: "a".repeat(40), repositoryRoot: process.cwd(), configRoot, model: { provider: "provider", id: "model" }, runNonce: "fixture", webAuthorized: true },
    configRoot,
    subagentsEntry,
    timeoutMs: 10_000,
    spawnImpl(command, args, options) {
      const child = new EventEmitter();
      child.pid = 999_999;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => {};
      invocation = { command, args, options };
      process.nextTick(() => {
        child.stdout.write(`${JSON.stringify(record)}\n`);
        child.stdout.end();
        setImmediate(() => child.emit("exit", 0, null));
      });
      return child;
    },
  });
  assert.equal(result.status, "PASS");
  assert.equal(invocation.options.shell, false);
  assert.match(invocation.options.cwd, new RegExp(`${configRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/only-my-pi/live-workspaces/fixture$`, "u"));
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR, configRoot);
  assert.equal(invocation.options.env.OPENCODE_API_KEY, undefined);
  assert.equal(invocation.options.env.CODEX_API_KEY, undefined);
  assert.ok(invocation.args.includes("--no-extensions"));
  assert.equal(invocation.args.filter((entry) => entry === "--extension").length, 2);
  assert.equal(invocation.args.includes("--api-key"), false);
});

test("D13 evidence requires the full source-bound low-sensitivity assertion matrix", () => {
  const document = {
    formatVersion: 1,
    kind: "only-my-pi-daily-harness-protected-evidence",
    gateId: "D13",
    evidenceId: "m8-live-model-matrix",
    sourceCommit: "a".repeat(40),
    status: "PASS",
    createdAt: "2026-08-27T00:00:00.000Z",
    assertions: M8_LIVE_EXPECTED_ASSERTIONS.map((id, index) => ({ id, status: "PASS", digest: `sha256:${String((index % 9) + 1).repeat(64)}` })),
    privacy: { rawOutputStored: false, hostPathsStored: false, secretsStored: false },
    authorization: { providerRequests: "AUTHORIZED", realPiHome: "AUTHORIZED", credentials: "PI_RUNTIME_ONLY", writer: "DENIED" },
  };
  document.evidenceDigest = protectedEvidenceDigest(document);
  assert.equal(validateDailyHarnessProtectedEvidence(document, { gateId: "D13", expectedSourceCommit: "a".repeat(40) }).status, "PASS");
  const missing = structuredClone(document);
  missing.assertions.pop();
  missing.evidenceDigest = protectedEvidenceDigest(missing);
  assert.throws(() => validateDailyHarnessProtectedEvidence(missing, { gateId: "D13" }), /assertion set/u);
});

test("protected Goal and public Web runs have distinct monotonic tool and turn ceilings", () => {
  const researcher = { templateId: "researcher" };
  assert.equal(m8ProtectedToolCallLimit({ agentSpec: researcher, handle: { local: { runId: "m8-goal-source-r0" } } }), 0);
  assert.equal(m8ProtectedTurnLimit({ agentSpec: researcher, handle: { local: { runId: "m8-goal-source-r0" } } }), 1);
  assert.equal(m8ProtectedToolCallLimit({ agentSpec: researcher, handle: { local: { runId: "m8-web-source" } } }), 4);
  assert.equal(m8ProtectedTurnLimit({ agentSpec: researcher, handle: { local: { runId: "m8-web-source" } } }), 4);
  assert.equal(m8ProtectedToolCallLimit({ agentSpec: { templateId: "reviewer" }, handle: { local: { runId: "m8-agent-source" } } }), 0);
  assert.equal(m8ProtectedTurnLimit({ agentSpec: { templateId: "reviewer" }, handle: { local: { runId: "m8-agent-source" } } }), 1);
  assert.equal(m8ProtectedTurnLimit({ agentSpec: { templateId: "reviewer" }, handle: { local: { runId: "m8-cancel-source" } } }), 2);
});

test("protected Goal convergence requires a later revision plus verified reusable evidence", () => {
  const base = { questions: ["one", "two"], coverage: 0, progress: 0, coveredDimensions: [], remainingDimensions: ["one"], decision: "replan", reason: "model requested more work" };
  assert.equal(m8ProtectedGoalPlannerPolicy({ plannerResult: base, revision: 0, settledNodeCount: 3 }).decision, "replan");
  assert.equal(m8ProtectedGoalPlannerPolicy({ plannerResult: base, revision: 1, settledNodeCount: 0 }).decision, "replan");
  const completed = m8ProtectedGoalPlannerPolicy({ plannerResult: base, revision: 1, settledNodeCount: 3 });
  assert.equal(completed.decision, "complete");
  assert.equal(completed.coverage, 1);
  assert.deepEqual(completed.remainingDimensions, []);
});

test("protected sequential Workflow reserves extra context for the final verifier without widening root budget", () => {
  const plan = createM8ProtectedSequentialPlan("m8-budget-test", ["reviewer", "synthesizer", "verifier"]);
  assert.deepEqual(plan.nodes.map((node) => node.budget.maxTokens), [6000, 6000, 12000]);
  assert.equal(plan.nodes.reduce((sum, node) => sum + node.budget.maxTokens, 0), plan.budget.maxTokens);
  assert.equal(plan.nodes.reduce((sum, node) => sum + node.budget.maxCostUsd, 0), plan.budget.maxCostUsd);
});

test("protected configuration pins low thinking and only narrows daily runtime budgets", () => {
  const original = {
    models: { default: { model: "inherit", thinking: "inherit", fallbackModels: [] }, roles: { reviewer: { model: "inherit", thinking: "inherit", fallbackModels: [] }, verifier: { model: "inherit", thinking: "high", fallbackModels: [] } } },
    budget: { maxTurnsPerChild: 8, maxToolCallsPerChild: 16, maxTotalToolCalls: 64, maxGoalRevisions: 4 },
  };
  const protectedConfig = m8ProtectedConfiguration(original);
  assert.equal(protectedConfig.models.roles.reviewer.thinking, "low");
  assert.equal(protectedConfig.models.roles.verifier.thinking, "low");
  assert.deepEqual(protectedConfig.budget, { maxTurnsPerChild: 4, maxToolCallsPerChild: 4, maxTotalToolCalls: 16, maxGoalRevisions: 2 });
  assert.equal(original.models.roles.reviewer.thinking, "inherit");
});
