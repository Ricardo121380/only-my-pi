import test from "node:test";
import assert from "node:assert/strict";
import { emptyUsage, recordUsage } from "../packages/host/usage.mjs";

test("usage keeps missing or zero Provider receipts unknown", () => {
  const usage = emptyUsage();
  recordUsage(usage, { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 } });
  recordUsage(usage, {});
  assert.equal(usage.responses, 2);
  assert.equal(usage.reported, 0);
  assert.equal(usage.tokens, null);
  assert.equal(usage.estimatedCost, null);
});

test("usage aggregates actual nonzero receipts and leaves zero pricing unpriced", () => {
  const usage = emptyUsage();
  recordUsage(usage, { usage: { input: 12, output: 8, cacheRead: 3, cacheWrite: 0, totalTokens: 23, cost: { total: 0 } } });
  recordUsage(usage, { usage: { input: 4, output: 6, cacheRead: 0, cacheWrite: 2, totalTokens: 12, cost: { total: 0.0012 } } });
  assert.deepEqual(usage.tokens, { input: 16, output: 14, cacheRead: 3, cacheWrite: 2, totalTokens: 35 });
  assert.equal(usage.reported, 2);
  assert.equal(usage.priced, 1);
  assert.equal(usage.estimatedCost, 0.0012);
});
