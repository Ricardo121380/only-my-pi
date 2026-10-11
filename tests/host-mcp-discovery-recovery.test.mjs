import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { providerReply, until } from "./fixtures/mcp-host.mjs";
import { createResourceHost, finishResources, ended } from "./fixtures/mcp-resource-host.mjs";
const waiting = (f, started) => until(() => f.task(started.taskId), (task) => task.approvals.length || ended(task), "resource approval", 25000);

test("an execution-only HTTP POST SSE definition notification during persistence prevents the physical resource send", { timeout: 50000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service } = fixture;
  service.setResourceMode("notify-at-send");
  // Hold only the isolated fixture's durable save until a real notification
  // has been sent on the execution connection's still-open POST SSE response.
  const marker = path.join(f.config, "http-dispatch-waiting"), release = path.join(f.config, "http-dispatch-release");
  const file = path.join(f.omp, "packages/mcp/runs.mjs"), source = await fs.readFile(file, "utf8"), anchor = "  async save(run) {\n";
  assert.equal(source.split(anchor).length, 2);
  await fs.writeFile(file, source.replace(anchor, anchor + `    if (!this.fixtureDelayed && run.calls.some((item) => item.kind === "resource" && item.status === "dispatched")) {
      this.fixtureDelayed = true;
      const fs = await import("node:fs/promises");
      await fs.writeFile(${JSON.stringify(marker)}, "waiting");
      for (let i = 0; i < 80 && !await fs.stat(${JSON.stringify(release)}).then(() => true, () => false); i++) await new Promise((resolve) => setTimeout(resolve, 25));
    }
`));
  const started = await f.start(), first = await waiting(f, started); assert.ok(first.approvals.length);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "仅本次" });
  await until(() => fs.stat(marker).then(() => true, () => false), Boolean, "actual resource dispatch persistence", 7500);
  assert.equal(service.notifyExecution(), 1, "notification must use the execution POST SSE stream");
  await delay(150); await fs.writeFile(release, "release");
  await until(() => f.task(started.taskId), ended, "resource notification race", 25000);
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  assert.equal(run.discoveries[0].epoch, 0, "discovery GET connection must remain unchanged");
  assert.equal(service.received.filter((row) => row.rpc === "resources/read").length, 0, "stale execution must not receive a resource read");
  assert.equal(run.calls[0].code, "MCP_RESOURCE_DEFINITION_CHANGED");
});

test("an admitted binary resource cannot return a base64 encoded credential to the script or model", { timeout: 50000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service, server } = fixture;
  service.setResourceMode("binary-secret"); const state = await f.mcp({ type: "list" });
  const copy = { ...server, resources: [{ uri: "mcp://remote/readme", mimeTypes: ["application/octet-stream"] }] }; delete copy.source; delete copy.targetDigest; delete copy.revocations;
  await f.mcp({ type: "save", revision: state.revision, server: copy });
  const started = await f.start(), final = await finishResources(f, started), run = (await f.mcp({ type: "status" })).runs.at(-1);
  const publicData = JSON.stringify([final, run, f.requests.map((item) => item.body)]);
  assert.equal(publicData.includes(Buffer.from(service.token).toString("base64")), false, "encoded credential must be withheld");
  assert.equal(publicData.includes(service.token), false, "credential must be withheld");
  assert.equal(run.calls[0].status, "unknown"); assert.match(publicData, /MCP_SECRET_OUTPUT_REJECTED/);
  assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
});

for (const mode of ["eof", "oversized", "deadline"]) test(`actual HTTP notification ${mode} invalidates old approval and permits explicit recovery`, { timeout: 110000 }, async (t) => {
  const fixture = await createResourceHost({ respond: ({ body, res }) => providerReply(res, body.messages.filter((item) => item.role === "tool").length < 2 ? "mcp_read_resource" : null, { server: "remote", uri: "mcp://remote/readme" }) });
  t.after(() => fixture.close()); const { f, service } = fixture;
  const started = await f.start(), first = await waiting(f, started); assert.ok(first.approvals.length);
  await until(() => service.received, (rows) => rows.some((row) => row.method === "GET"), "actual notification stream");
  const epoch = (await f.mcp({ type: "status" })).runs.at(-1).discoveries[0].epoch;
  if (mode !== "deadline") service.dropNotifications(mode === "oversized");
  const disconnected = await until(() => f.mcp({ type: "status" }), (status) => status.runs.at(-1).discoveries[0].status === "disconnected", "notification loss must invalidate actual discovery", mode === "deadline" ? 80000 : 7500);
  const discovery = disconnected.runs.at(-1).discoveries[0]; assert.ok(discovery.epoch > epoch); assert.ok(discovery.events.some((event) => event.type === "disconnected")); assert.ok(discovery.tools.every((tool) => !tool.active));
  assert.equal(service.received.filter((row) => row.method === "GET").length, 1, "channel loss cannot silently reconnect");
  const restored = await f.mcp({ type: "discover", taskId: started.taskId, name: "remote" }); assert.equal(restored.runs.at(-1).discoveries[0].status, "ready");
  await until(() => service.received, (rows) => rows.filter((row) => row.method === "GET").length === 2, "explicit actual reconnection");
  if (mode === "eof") { await delay(11000); assert.equal((await f.mcp({ type: "status" })).runs.at(-1).discoveries[0].status, "ready", "a successful discovery deadline must not later abort the recovered channel"); }
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "本任务" });
  const fresh = await waiting(f, started); assert.ok(fresh.approvals.length); assert.equal(service.received.filter((row) => row.rpc === "resources/read").length, 0, "old approval cannot dispatch after channel loss");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: fresh.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(started.taskId), ended, "fresh authorized resource after recovery", 25000);
  assert.equal(service.received.filter((row) => row.rpc === "resources/read").length, 1);
  assert.deepEqual((await f.mcp({ type: "status" })).runs.at(-1).calls.map((call) => call.status), ["rejected", "completed"]);
});
