import assert from "node:assert/strict";
import test from "node:test";

import { digestValue } from "../packages/subagents/domain/index.mjs";
import {
  createUltraRunAuthorization,
  createUltraRunRouter,
  planUltraRun,
  ULTRA_PHASE_LIBRARY,
} from "../packages/subagents/ultra-run/index.mjs";

function definition(effort = "deep") {
  return {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/ultra-run-v1.schema.json",
    formatVersion: 1,
    contractStatus: "runtime-ready",
    kind: "ultra-run",
    id: `ultra-${effort}`,
    version: "1.0.0",
    effort,
    routePolicy: {
      singleAgentMaxComplexity: 20,
      batchMinItems: 8,
      dynamicGoalRequiresExplicitApproval: true,
    },
    workflowLibrary: ["source-review-v2"],
    batchLibrary: ["review-items"],
    goalLibrary: ["research-release-goal"],
    quality: {
      freshVerifier: true,
      testGate: "test-contract",
      integrationGate: "test-integration",
    },
    budgetRef: "preview-read-only",
    approvalPolicy: "exact-mutating-revision",
  };
}

function request(overrides = {}) {
  const value = {
    id: "request-one",
    taskDigest: digestValue("task-one"),
    complexity: 10,
    itemCount: 1,
    homogeneous: false,
    dynamicGoal: false,
    mutation: "none",
    risk: "low",
    origin: { kind: "human", requestDigest: digestValue("human-request-one") },
    ...overrides,
  };
  return value;
}

function completed(plan) {
  return {
    status: "completed",
    verification: { contextMode: "fresh", verdict: "pass", receiptDigest: digestValue({ plan: plan.planDigest, verifier: true }) },
    scale: { logicalAssignments: plan.scale.logicalAssignments, costVisibility: "VISIBLE" },
  };
}

test("UltraRun keeps a small task on the Agent route and exposes bounded U0-U6 quality evidence", () => {
  const plan = planUltraRun(definition("quick"), request());
  assert.equal(plan.route, "agent");
  assert.equal(plan.routeRef, null);
  assert.equal(plan.scale.logicalAssignments, 2);
  assert.equal(plan.scale.workflowRuns, 0);
  assert.equal(plan.approval.required, false);
  assert.equal(plan.phases.length, 4);
  assert.equal(plan.phases.at(-1), "u6-final");
  assert.equal(ULTRA_PHASE_LIBRARY.length, 7);
});

test("UltraRun distinguishes homogeneous BatchSwarm, structured Workflow, and dynamic SwarmGoal routes", () => {
  const batch = planUltraRun(definition(), request({ complexity: 60, itemCount: 20, homogeneous: true, preferredBatch: "review-items" }));
  assert.equal(batch.route, "batch-swarm");
  assert.equal(batch.routeRef, "review-items");
  assert.equal(batch.scale.logicalAssignments, 21);

  const workflow = planUltraRun(definition(), request({ complexity: 60, itemCount: 3, homogeneous: false, preferredWorkflow: "source-review-v2" }));
  assert.equal(workflow.route, "workflow");
  assert.equal(workflow.routeRef, "source-review-v2");
  assert.ok(workflow.phases.includes("u3-change"));

  const goal = planUltraRun(definition("critical"), request({ complexity: 95, itemCount: 30, dynamicGoal: true, risk: "critical", preferredGoal: "research-release-goal" }));
  assert.equal(goal.route, "swarm-goal");
  assert.equal(goal.approval.required, true);
  assert.equal(goal.approval.humanOriginRequired, true);
  assert.equal(goal.scale.maximumPlanRevisions, 4);
  assert.equal(goal.quality.verifierLenses, 3);
  assert.deepEqual(goal.phases, ULTRA_PHASE_LIBRARY.map((phase) => phase.id));
});

test("UltraRun requires digest-bound human authorization for dynamic goals and never becomes a scheduler", async () => {
  const calls = [];
  const router = createUltraRunRouter({
    executors: {
      async "swarm-goal"({ runId, plan, authorization }) {
        calls.push({ runId, plan, authorization });
        return completed(plan);
      },
    },
  });
  const dynamicRequest = request({ complexity: 90, itemCount: 12, dynamicGoal: true, risk: "high" });
  const plan = router.plan(definition(), dynamicRequest);
  await assert.rejects(
    router.run(definition(), dynamicRequest),
    (error) => error?.code === "ULTRA_RUN_AUTHORIZATION_REQUIRED",
  );
  const authorization = createUltraRunAuthorization(plan, "human-ultra-approval-1");
  const result = await router.run(definition(), dynamicRequest, { authorization });
  assert.equal(result.result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].runId, dynamicRequest.id);
  assert.equal(calls[0].plan.planDigest, plan.planDigest);
});

test("UltraRun fails closed for automation-triggered dynamic goals, route drift, missing scale, and failed verifier", async () => {
  const automated = request({ dynamicGoal: true, origin: { kind: "automation", requestDigest: digestValue("automation") }, risk: "high" });
  const automatedPlan = planUltraRun(definition(), automated);
  const authorization = createUltraRunAuthorization(automatedPlan, "automation-cannot-authorize");
  const router = createUltraRunRouter({ executors: { async "swarm-goal"({ plan }) { return completed(plan); } } });
  await assert.rejects(
    router.run(definition(), automated, { authorization }),
    (error) => error?.code === "ULTRA_RUN_HUMAN_ORIGIN_REQUIRED",
  );

  assert.throws(
    () => planUltraRun(definition(), request({ complexity: 60, preferredWorkflow: "not-allowed" })),
    (error) => error?.code === "ULTRA_RUN_ROUTE_OUTSIDE_LIBRARY",
  );

  const brokenScale = createUltraRunRouter({ executors: { async agent({ plan }) { return { ...completed(plan), scale: null }; } } });
  await assert.rejects(
    brokenScale.run(definition(), request()),
    (error) => error?.code === "ULTRA_RUN_SCALE_EVIDENCE_REQUIRED",
  );
  const understatedScale = createUltraRunRouter({ executors: { async agent({ plan }) { return { ...completed(plan), scale: { logicalAssignments: 0, costVisibility: "VISIBLE" } }; } } });
  await assert.rejects(
    understatedScale.run(definition(), request()),
    (error) => error?.code === "ULTRA_RUN_SCALE_EVIDENCE_REQUIRED",
  );

  const failedVerifier = createUltraRunRouter({ executors: { async agent({ plan }) { return { ...completed(plan), verification: { contextMode: "fresh", verdict: "fail", receiptDigest: digestValue("fail") } }; } } });
  await assert.rejects(
    failedVerifier.run(definition(), request()),
    (error) => error?.code === "ULTRA_RUN_FINAL_VERIFIER_FAILED",
  );
  assert.throws(
    () => planUltraRun(definition(), request({ homogeneous: "yes" })),
    (error) => error?.code === "ULTRA_RUN_INVALID",
  );
  assert.throws(
    () => planUltraRun({ ...definition(), version: "latest" }, request()),
    (error) => error?.code === "ULTRA_RUN_INVALID",
  );
});
