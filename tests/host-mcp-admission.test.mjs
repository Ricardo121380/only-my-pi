import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { McpCatalog } from "../packages/mcp/catalog.mjs";
import { createMcpHost } from "./fixtures/mcp-host.mjs";

test("public Host retains request idempotency across concurrent MCP snapshot reads", { timeout: 20000 }, async (t) => {
  const f = await createMcpHost();
  const original = McpCatalog.prototype.snapshot;
  let release, arrived = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  t.after(async () => { McpCatalog.prototype.snapshot = original; release(); await f.close(); });
  McpCatalog.prototype.snapshot = async function (project) {
    const snapshot = await original.call(this, project);
    if (project === f.project) { if (++arrived === 2) release(); await gate; }
    return snapshot;
  };
  const input = { type: "startTask", requestId: "mcp-snapshot-concurrent-request", projectId: f.projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "bounded request idempotency probe" };
  const [first, repeated] = await Promise.all([f.request("/api/command", input, 202), f.request("/api/command", input, 202)]);
  assert.equal(arrived, 2, "both public requests crossed the asynchronous snapshot boundary");
  assert.equal(first.taskId, repeated.taskId);
  const state = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/host/tasks.json"), "utf8"));
  assert.equal(state.tasks.length, 1);
});
