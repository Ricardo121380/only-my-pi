import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { until, mcpReception } from "./fixtures/mcp-host.mjs";
import { createWriteHost, codingApproved, approveWrite, terminal } from "./fixtures/mcp-write-host.mjs";
test("a real pending write definition notification invalidates authority before descriptor startup", { timeout: 45000 }, async (t) => {
  const f = await createWriteHost({ mode: "notification-startup" }); t.after(() => f.close());
  const started = await f.start({ mode: "controlled" }), waiting = await codingApproved(f, started); assert.ok(waiting.approvals.length);
  const state = await f.mcp({ type: "discover", taskId: started.taskId, name: "local" }); assert.ok(state.runs.at(-1).discoveries[0].epoch > 0);
  await approveWrite(f, waiting); await until(() => f.task(started.taskId), terminal, "changed writer denied", 20000);
  const run = (await f.mcp({ type: "status" })).runs.at(-1), received = await mcpReception(run);
  assert.ok(received.some((item) => item.type === "notification"));
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.equal(received.filter((item) => ["startup-effect", "call", "effect"].includes(item.type)).length, 0);
  assert.equal(run.processes.filter((item) => item.kind === "write").length, 0);
  assert.equal(run.calls[0].status, "rejected"); assert.equal(run.calls[0].application, "not_applied");
});
