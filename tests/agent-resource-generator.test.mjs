import assert from "node:assert/strict";
import test from "node:test";

import { compileAgentResource } from "../scripts/generate-subagent-resources.mjs";

function manifest(overrides = {}) {
  return {
    formatVersion: 1,
    contractStatus: "contract-only",
    id: "scout",
    description: "Read-only codebase evidence mapping.",
    modelRole: "fast",
    tools: { allow: ["read", "grep", "find", "ls"], deny: ["bash", "edit", "write", "web"] },
    writer: false,
    gateIds: [],
    ...overrides,
  };
}

test("agent compiler creates a deterministic namespaced pi-subagents resource", () => {
  const left = compileAgentResource(manifest(), "Return a bounded evidence map.\n");
  const right = compileAgentResource(manifest(), "Return a bounded evidence map.\n");
  assert.deepEqual(left, right);
  assert.equal(left.name, "omp-scout");
  assert.match(left.content, /tools: read, grep, find, ls/);
  assert.doesNotMatch(left.content, /tools:.*bash/);
});

test("non-writer compiler rejects bash, edit, or write regardless of prompt", () => {
  for (const tool of ["bash", "edit", "write"]) {
    assert.throws(
      () => compileAgentResource(manifest({ tools: { allow: ["read", tool], deny: [] } }), "Do not mutate anything."),
      /non-writer agent cannot receive/,
    );
  }
});

test("tester and verifier require fixed gate IDs and never arbitrary bash", () => {
  assert.throws(
    () => compileAgentResource(manifest({ id: "tester", tools: { allow: ["read", "bash"], deny: [] }, gateIds: [] }), "Run tests."),
    /(non-writer|fixed gate IDs)/,
  );
  assert.doesNotThrow(() => compileAgentResource(manifest({ id: "verifier", gateIds: ["full-tests"] }), "Verify receipts."));
});
