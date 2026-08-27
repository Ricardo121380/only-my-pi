import assert from "node:assert/strict";
import test from "node:test";

import { createGoalAuthorityGrant, createGoalRevisionApproval, createGoalRevisionAuthorizer, projectGoalRevisionAuthority } from "../packages/subagents/policy/goal-revision-authority.mjs";

const digest = (value) => "sha256:" + value.repeat(64).slice(0, 64);
function proposal(overrides = {}) {
  return {
    revision: overrides.revision ?? 0,
    agentSpecs: overrides.agentSpecs ?? [
      { templateId: "researcher", model: { role: "deep" } },
      { templateId: "synthesizer", model: { role: "deep" } },
      { templateId: "verifier", model: { role: "fast" } },
    ],
    plan: {
      policy: { mutation: overrides.mutation ?? "none", egress: { web: overrides.web === false ? "deny" : "allow" } },
      budget: { maxAssignments: overrides.maxAssignments ?? 3, maxCostUsd: overrides.maxCostUsd ?? 0.05, maxTokens: 10000, maxWallTimeMs: 450000, maxOutputBytes: 65536, maxNodes: 3, maxParallel: 1, maxDepth: 3 },
    },
  };
}
function grant() {
  return createGoalAuthorityGrant({
    runId: "goal-run",
    objectiveDigest: digest("a"),
    allowedRoles: ["researcher", "synthesizer", "verifier"],
    allowedModels: ["role:deep", "role:fast"],
    overlays: ["orchestration-readonly", "web"],
    scope: ["repository"],
    web: true,
    mutation: "none",
    maxRevisions: 4,
    budget: { maxAssignments: 4, maxCostUsd: 0.0625, maxTokens: 12500, maxWallTimeMs: 450000, maxOutputBytes: 65536, maxNodes: 4, maxParallel: 2, maxDepth: 3 },
  });
}

test("equal or narrower Goal revisions auto-authorize", () => {
  const authorizer = createGoalRevisionAuthorizer(grant());
  const assessment = authorizer.assess(proposal(), { overlays: ["web"], scope: ["repository"] });
  assert.equal(assessment.ok, true);
  assert.equal(assessment.requiresApproval, false);
});

test("role, model, Web, scope and budget expansion require a digest-bound reapproval", () => {
  const authorizer = createGoalRevisionAuthorizer(grant());
  const expanded = proposal({ agentSpecs: [{ templateId: "new-role", model: { provider: "new-provider", id: "new-model", role: "deep" } }], maxAssignments: 8, maxCostUsd: 0.2 });
  const options = { overlays: ["web", "mcp"], scope: ["repository", "outside-scope"] };
  const assessment = authorizer.assess(expanded, options);
  assert.equal(assessment.requiresApproval, true);
  assert.ok(assessment.expansions.some((entry) => entry.kind === "role"));
  assert.ok(assessment.expansions.some((entry) => entry.kind === "model"));
  assert.ok(assessment.expansions.some((entry) => entry.kind === "overlay"));
  assert.ok(assessment.expansions.some((entry) => entry.kind === "scope"));
  assert.ok(assessment.expansions.some((entry) => entry.kind === "budget"));
  const approval = createGoalRevisionApproval(authorizer.grant, projectGoalRevisionAuthority(expanded, options), "human-expansion-1");
  authorizer.approve(expanded, approval, options);
  assert.equal(authorizer.assess(expanded, options).ok, true);
  assert.throws(() => authorizer.approve(expanded, { ...approval, nonce: "different" }, options), { code: "GOAL_REVISION_APPROVAL_DRIFT" });
});

test("mutating revision is never admitted by M8 reapproval", () => {
  const authorizer = createGoalRevisionAuthorizer(grant());
  const assessment = authorizer.assess(proposal({ mutation: "guarded" }));
  assert.equal(assessment.requiresApproval, true);
  assert.ok(assessment.expansions.some((entry) => entry.kind === "mutation"));
});
