import assert from "node:assert/strict";
import test from "node:test";
import { providerReply, until } from "./fixtures/mcp-host.mjs";
import { createResourceHost, finishResources, ended } from "./fixtures/mcp-resource-host.mjs";
const waiting = (f, started) => until(() => f.task(started.taskId), (item) => item.approvals.length || ended(item), "resource approval", 25000);

test("real HTTP discovery and nested resource/tool calls retain separate grants and source", { timeout: 55000 }, async (t) => {
  const code = 'text(searchTools("echo")); text(await tools.mcp__remote__echo({value:"nested actual call"})); text(await tools.mcp_read_resource({server:"remote",uri:"mcp://remote/readme"}));';
  const fixture = await createResourceHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((item) => item.role === "tool") ? null : "codemode", { code }) }); t.after(() => fixture.close());
  const { f, service } = fixture; assert.equal(service.received.length, 0);
  const started = await f.start(); const first = await waiting(f, started); assert.ok(first.approvals.length); assert.equal(service.received.filter((item) => item.rpc === "tools/call").length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "仅本次" });
  const second = await waiting(f, started); assert.match(second.approvals[0].title, /资源读取/); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: second.approvals[0].approvalId, value: "仅本次" });
  const final = await until(() => f.task(started.taskId), ended, "nested completion", 25000); assert.equal(final.toolCalls.filter((item) => item.parentToolCallId).length, 2); assert.match(JSON.stringify(final), /来源 MCP remote/);
  const run = (await f.mcp({ type: "status" })).runs.at(-1); assert.deepEqual(run.calls.map((item) => item.authorization), ["once", "once"]); assert.ok(run.calls.every((item) => item.status === "completed")); assert.equal(run.discoveries[0].resources.length, 1);
  assert.equal(service.received.filter((item) => item.rpc === "tools/call").length, 1); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
});

test("real notifications invalidate pending definitions; explicit rediscovery records new definitions; withdrawal hides calls", { timeout: 65000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service } = fixture;
  let started = await f.start(), first = await waiting(f, started); assert.ok(first.approvals.length);
  await until(() => service.received, (items) => items.some((item) => item.method === "GET"), "real notification stream");
  const before = (await f.mcp({ type: "status" })).runs.at(-1).discoveries[0].resources[0].definitionDigest;
  service.changeSchema();
  await until(() => f.mcp({ type: "status" }), (status) => status.runs.at(-1).discoveries[0].epoch > 0 && status.runs.at(-1).discoveries[0].status === "ready", "refreshed notification definition");
  const changed = await f.mcp({ type: "discover", taskId: started.taskId, name: "remote" }); assert.notEqual(changed.runs.at(-1).discoveries[0].resources[0].definitionDigest, before);
  assert.ok(changed.runs.at(-1).discoveries[0].events.some((event) => event.type === "notifications/resources/list_changed"));
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "本任务" });
  await until(() => f.task(started.taskId), ended, "stale resource rejection"); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 0);
  started = await f.start(); await finishResources(f, started); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
  started = await f.start(); first = await waiting(f, started); assert.ok(first.approvals.length); service.withdraw();
  await until(() => f.mcp({ type: "status" }), (status) => status.runs.at(-1).discoveries[0].status === "ready" && status.runs.at(-1).discoveries[0].resources.length === 0, "withdrawn discovery");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(started.taskId), ended, "withdrawn resource rejected"); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
  const after = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(after.discoveries[0].tools[0].active, false); assert.equal(after.discoveries[0].live, false);
  const denied = await f.mcp({ type: "discover", taskId: started.taskId, name: "remote" }, 409); assert.equal(denied.code, "MCP_DISCOVERY_UNAVAILABLE");
});

test("resource URI, MIME, partial output and decoded credential boundaries use the actual HTTP receiver", { timeout: 65000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service } = fixture;
  for (const mode of ["blob", "bad-uri", "html", "partial", "secret-blob"]) {
    service.setResourceMode(mode); const started = await f.start(), final = await finishResources(f, started); const run = (await f.mcp({ type: "status" })).runs.at(-1);
    assert.equal(run.calls[0].status, mode === "blob" ? "completed" : mode === "secret-blob" ? "unknown" : "failed", mode);
    if (mode === "partial") { assert.equal(run.calls[0].partial, true); assert.match(JSON.stringify(final), /controlled remote README/); assert.ok(!JSON.stringify(final).includes("untrusted second part")); }
    assert.ok(!JSON.stringify([final, run, f.requests.map((item) => item.body)]).includes(service.token), mode);
  }
  assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 5);
});

for (const mode of ["oversized", "disconnect", "delay"]) test(`received resource ${mode} remains unknown across restart without replay`, { timeout: 65000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service } = fixture; service.setResourceMode(mode);
  const started = await f.start(), first = await waiting(f, started); assert.ok(first.approvals.length);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "本任务" });
  if (mode === "delay") { await until(() => service.received, (items) => items.some((item) => item.rpc === "resources/read"), "received resource before cancel"); await f.request("/api/command", { type: "cancelTask", taskId: started.taskId }, 202); }
  await until(() => f.task(started.taskId), ended, "unknown resource end", 20000);
  assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].status, "unknown"); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
  await f.restart(); service.setResourceMode("text"); const later = await f.start(), final = await finishResources(f, later);
  assert.match(JSON.stringify(final), /MCP_RESOURCE_RECONCILIATION_REQUIRED/); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 1);
});

test("resource denial and config hiding revoke current grants without new connections", { timeout: 55000 }, async (t) => {
  const fixture = await createResourceHost(); t.after(() => fixture.close()); const { f, service, server } = fixture;
  let started = await f.start(); await finishResources(f, started, "拒绝"); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 0);
  started = await f.start(); const first = await waiting(f, started); assert.ok(first.approvals.length); const state = await f.mcp({ type: "list" });
  const copy = { ...server, tools: server.tools.map((tool) => ({ ...tool, exposure: "hidden" })), resources: server.resources.map((resource) => ({ ...resource, active: false })) }; delete copy.source; delete copy.targetDigest; delete copy.revocations;
  await f.mcp({ type: "save", revision: state.revision, server: copy });
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(started.taskId), ended, "hidden config ended", 20000); assert.equal(service.received.filter((item) => item.rpc === "resources/read").length, 0);
});
