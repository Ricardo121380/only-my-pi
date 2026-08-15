import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContextSnapshot,
  estimateTokensFromCharacters,
  formatSnapshot,
  summarizeMessages,
  summarizeTools,
} from "./metrics.mjs";

test("message summary records counts rather than content", () => {
  const secret = "sk-test-never-emit";
  const summary = summarizeMessages([
    { role: "user", content: [{ type: "text", text: `hello ${secret}` }] },
    { role: "assistant", content: [{ type: "text", text: "world" }], reasoning: "private" },
  ]);
  assert.deepEqual(summary.roles, { user: 1, assistant: 1 });
  assert.equal(summary.count, 2);
  assert.equal(JSON.stringify(summary).includes(secret), false);
  assert.equal(summary.textCharacters, `hello ${secret}`.length + "world".length + "private".length);
});

test("tool summary measures schema without retaining it", () => {
  const tools = [{ name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }];
  const summary = summarizeTools(tools);
  assert.equal(summary.count, 1);
  assert.ok(summary.schemaCharacters > 0);
  assert.equal(Object.hasOwn(summary, "parameters"), false);
});

test("snapshot prefers provider estimate and formatting is bounded", () => {
  const snapshot = buildContextSnapshot({
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    activeTools: ["read"],
    usage: { tokens: 250, contextWindow: 1000, percent: 25 },
    systemPromptCharacters: 80,
    turnIndex: 2,
  });
  assert.equal(snapshot.providerEstimate.percent, 25);
  assert.equal(snapshot.systemPrompt.approximateTextTokens, 20);
  assert.match(formatSnapshot(snapshot), /250\/1000 tokens \(25%\)/);
  assert.equal(estimateTokensFromCharacters(9), 3);
});
