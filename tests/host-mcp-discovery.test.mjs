import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { createMcpHost, providerReply, until, mcpReception } from "./fixtures/mcp-host.mjs";

const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
async function configured(t, { exposure = "deferred", mode, code } = {}) {
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => {
    if (code) return providerReply(res, body.messages.some((item) => item.role === "tool") ? null : "codemode", { code });
    const count = body.messages.filter((item) => item.role === "tool").length;
    const names = ["mcp_tool_search", "mcp__local__read_file", "mcp_list_resources", "mcp_read_resource"];
    const args = [{ query: "selected file" }, { path: "README.md" }, { server: "local" }, { server: "local", uri: "mcp://local/readme" }];
    providerReply(res, names[count] ?? null, args[count]);
  } });
  t.after(() => f.close());
  const file = fileURLToPath(new URL("./fixtures/mcp-discovery-server.mjs", import.meta.url));
  const server = { ...f.server, args: [file], codePaths: [file], enabled: true, env: mode ? { F_MODE: mode } : {}, tools: f.server.tools.map((tool) => ({ ...tool, exposure })), resources: [{ uri: "mcp://local/readme", mimeTypes: ["text/plain"], paths: ["README.md"] }] };
  await f.mcp({ type: "save", revision: 0, server });return { f, server };
}
async function finish(f, started, approve = true) {
  for (;;) {
    const task = await until(() => f.task(started.taskId), (value) => value.approvals.length || terminal(value), "discovery journey", 15000);
    if (terminal(task)) return task;
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: task.approvals[0].approvalId, value: approve ? "仅本次" : "拒绝" });
  }
}

test("public native tool search loads only admitted deferred tools and reads a scoped resource", { timeout: 45000 }, async (t) => {
  const { f } = await configured(t);const started = await f.start();const final = await finish(f, started);
  assert.equal(final.toolCalls.find((call) => call.name === "mcp_tool_search").status, "completed", JSON.stringify({ calls: final.toolCalls, declarations: f.requests.map((item) => item.body.tools.map((tool) => tool.function.name)), run: (await f.mcp({ type: "status" })).runs }));
  assert.ok(!f.requests[0].body.tools.some((tool) => tool.function.name === "mcp__local__read_file"));
  assert.ok(f.requests[1].body.tools.some((tool) => tool.function.name === "mcp__local__read_file"));
  assert.equal(final.toolCalls.find((call) => call.name === "mcp_read_resource").status, "completed", JSON.stringify({ calls: final.toolCalls, runs: (await f.mcp({ type: "status" })).runs }));
  const run = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === started.taskId), received = await mcpReception(run);
  assert.equal(received.filter((item) => item.type === "call").length, 1);assert.equal(received.filter((item) => item.type === "resource").length, 1);
  assert.ok(received.some((item) => item.method === "resources/list"));assert.ok(run.discoveries.some((entry) => entry.resources.length === 1));
});

test("hidden tools and handwritten resource URIs never dispatch through codemode", { timeout: 30000 }, async (t) => {
  const code = 'text(searchTools("read_file")); try { await tools.mcp__local__read_file({path:"README.md"}); } catch(e) { text(e.message); } try { await tools.mcp_read_resource({server:"local",uri:"file:///etc/passwd"}); } catch(e) { text(e.message); }';
  const { f } = await configured(t, { exposure: "hidden", code });const started = await f.start();const final = await finish(f, started);
  const received = await mcpReception((await f.mcp({ type: "status" })).runs.find((item) => item.taskId === started.taskId));
  assert.equal(received.filter((item) => ["call", "resource"].includes(item.type)).length, 0);assert.equal(final.approvals.length, 0);
  assert.match(final.toolCalls.find((call) => call.name === "codemode").result, /MCP_RESOURCE_NOT_ADMITTED/);
});

test("real stdio list-change notifications and withdrawal hide the pending native tool without dispatch", { timeout: 45000 }, async (t) => {
  const { f } = await configured(t, { mode: "withdraw" }); const started = await f.start(); await finish(f, started);
  const run = (await f.mcp({ type: "status" })).runs.at(-1), received = await mcpReception(run);
  assert.ok(received.some((item) => item.type === "notification" && item.method === "notifications/resources/list_changed"));
  assert.equal(received.filter((item) => ["call", "resource"].includes(item.type)).length, 0);
  assert.equal(run.discoveries[0].tools[0].active, false); assert.equal(run.discoveries[0].resources.length, 0);
});

test("stdio resource approval admits only the declared physical read file", { timeout: 45000 }, async (t) => {
  const code = 'try { text(await tools.mcp_read_resource({server:"local",uri:"mcp://local/readme"})); } catch(e) { text(e.message); }';
  const { f } = await configured(t, { mode: "outside", code }); await fs.writeFile(path.join(f.project, "private.txt"), "outside-resource-secret");
  const started = await f.start(), final = await finish(f, started); const run = (await f.mcp({ type: "status" })).runs.at(-1), received = await mcpReception(run);
  assert.equal(received.filter((item) => item.type === "resource").length, 1); assert.equal(run.calls[0].status, "unknown");
  assert.ok(!JSON.stringify([final, f.requests.map((item) => item.body)]).includes("outside-resource-secret"));
  assert.equal(await fs.readFile(path.join(f.project, "private.txt"), "utf8"), "outside-resource-secret");
});

test("a resource declared oversized is excluded from discovery and rejected before approval or reading", { timeout: 45000 }, async (t) => {
  const code = 'text(await tools.mcp_list_resources({server:"local"})); text(await tools.mcp_read_resource({server:"local",uri:"mcp://local/readme"}));';
  const { f } = await configured(t, { mode: "claimed-large", code });const started = await f.start(), final = await finish(f, started);
  const run = (await f.mcp({ type: "status" })).runs.at(-1), received = await mcpReception(run);
  assert.equal(final.approvals.length, 0); assert.equal(run.discoveries[0].resources.length, 0); assert.equal(received.filter((item) => item.type === "resource").length, 0);
  assert.match(final.toolCalls.find((call) => call.name === "codemode").result, /MCP_RESOURCE_TYPE_NOT_ADMITTED/);
});

test("an execution-only stdio definition notification during persistence prevents the physical resource send", { timeout: 45000 }, async (t) => {
  const code = 'text(await tools.mcp_read_resource({server:"local",uri:"mcp://local/readme"}));';
  const { f } = await configured(t, { mode: "notify-at-send", code });
  // Delay only the isolated fixture's durable save. The real Host, Pi client,
  // transport and controlled service still execute their public paths.
  const file = path.join(f.omp, "packages/mcp/runs.mjs"), source = await fs.readFile(file, "utf8"), anchor = "  async save(run) {\n";
  assert.equal(source.split(anchor).length, 2);
  await fs.writeFile(file, source.replace(anchor, anchor + `    const call = run.calls.find((item) => item.kind === "resource" && item.status === "dispatched");
    if (call && !this.fixtureDelayed) {
      this.fixtureDelayed = true;
      const runtime = run.processes.find((item) => item.callId === call.callId).runtimeDir;
      await (await import("node:fs/promises")).writeFile(path.join(runtime, "scratch"), "notify");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
`));
  const started = await f.start(); await finish(f, started);
  const received = await mcpReception((await f.mcp({ type: "status" })).runs.at(-1));
  assert.ok(received.some((row) => row.type === "notification" && row.method === "notifications/resources/list_changed"));
  assert.equal(received.filter((row) => row.method === "resources/read").length, 0, "stale execution must not receive a resource read");
});
