import assert from "node:assert/strict";
import test from "node:test";

import { buildStatusModel, createStatusService, formatStatusModel } from "../packages/control-service/status-service.mjs";

test("status model is bounded, low-sensitivity, and provenance-labelled", () => {
  const model = buildStatusModel({
    profile: { id: "coding", capabilities: ["workspace-read", "secret-should-not-leak"] },
    mode: { id: "coding", hash: `sha256:${"a".repeat(64)}` },
    model: { provider: "deepseek", id: "deepseek-v4-pro", apiKey: ["sk", "secret-must-not-appear"].join("-") },
    permission: { state: "unknown", mode: "build", bashSandbox: { state: "degraded", reason: "dependency missing\n/path/private" } },
    context: { usage: { tokens: 123, contextWindow: 1000, percent: 12.3 }, messages: { count: 4 } },
    git: { branch: "codex/only-my-pi-harness-v1", head: "0123456789abcdef", dirty: true },
    theme: { id: "only-my-pi-dark", mode: "dark" },
  });
  assert.equal(model.status, "HARNESS_STATUS");
  assert.equal(model.provenance, "injected-observations-only");
  assert.equal(model.model.modelId, "deepseek-v4-pro");
  assert.equal(Object.hasOwn(model.model, "apiKey"), false);
  assert.equal(model.permission.wholeSessionSandbox, false);
  assert.equal(model.permission.bashSandbox.state, "degraded");
  assert.equal(model.permission.bashSandbox.reason.includes("\n"), false);
  assert.ok(!JSON.stringify(model).includes("sk-secret"));
  assert.match(formatStatusModel(model), /profile:coding/);
});

test("status service can be used headlessly with injected observations only", async () => {
  const service = createStatusService({ providers: { profile: () => "research", headless: true } });
  const model = await service.snapshot();
  assert.equal(model.headless, true);
  const explicit = await service.snapshot({ headless: true, theme: { id: "only-my-pi-dark", mode: "dark" } });
  assert.equal(explicit.headless, true);
  assert.equal(explicit.theme.id, "only-my-pi-dark");
});
