import test from "node:test";
import assert from "node:assert/strict";
import { projectControlState } from "../packages/host/control-state.mjs";

test("control projection preserves real child usage but strips arbitrary runtime data", () => {
  const state = projectControlState({ access: "coding", secret: "PRIVATE", orchestration: {
    maximumConcurrency: 2, maximumChildren: 8, totalChildren: 1, writerUsed: true,
    budget: { status: "AVAILABLE", mainAgentIncluded: true, limits: { maxTotalTokens: 100, private: "PRIVATE" }, used: { tokens: 30, costUsd: 0, toolCalls: NaN }, private: "PRIVATE" },
    children: [{ label: "scout", agent: "omp-scout", status: "completed", tokens: 30, rawOutput: "PRIVATE", task: "PRIVATE" }],
    auth: "PRIVATE", cwd: "PRIVATE",
  } });
  assert.equal(state.access, "coding");
  assert.equal(state.orchestration.budget.mainAgentIncluded, false);
  assert.equal(state.orchestration.budget.used.tokens, 30);
  assert.equal(state.orchestration.budget.used.toolCalls, null);
  assert.equal(state.orchestration.budget.used.costUsd, 0);
  assert.equal(JSON.stringify(state).includes("PRIVATE"), false);
  assert.deepEqual(projectControlState(state), state);
  assert.deepEqual(projectControlState(null), { access: "inspect", orchestration: null });
});
