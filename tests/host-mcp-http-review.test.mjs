import assert from "node:assert/strict";
import test from "node:test";
import { createMcpHost, until, providerReply } from "./fixtures/mcp-host.mjs";
import { createHttpMcpServer } from "./fixtures/mcp-http-server.mjs";

async function configure(f, service, name = "remote", value = service.token) {
  let state = await f.mcp({ type: "list" });
  state = await f.mcp({ type: "save", revision: state.revision, server: { name, transport: "streamable-http", url: service.url, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false } });
  state = await f.mcp({ type: "credential", revision: state.revision, name, envName: "MCP_TOKEN", value });
  return f.mcp({ type: "enable", revision: state.revision, name, enabled: true });
}

test("HTTP task approval stays bound to its connection and identity even when two servers share a target", { timeout: 45000 }, async (t) => {
  const secondIdentity = "fixture-secondary-identity", service = await createHttpMcpServer({ additionalTokens: [secondIdentity] }); t.after(() => service.close());
  const f = await createMcpHost({ respond: ({ res }, requests) => providerReply(res, requests.length === 1 ? "mcp__remote__echo" : requests.length === 2 ? "mcp__secondary__echo" : null, { value: "same approved input" }) }); t.after(() => f.close());
  await configure(f, service); await configure(f, service, "secondary", secondIdentity);
  const start = await f.start(), first = await until(() => f.task(start.taskId), (task) => task.approvals.length, "first HTTP connection approval", 20000);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: first.approvals[0].approvalId, value: "本任务" });
  const second = await until(() => f.task(start.taskId), (task) => task.approvals.length || ["succeeded", "failed"].includes(task.status), "second identity approval", 20000);
  t.diagnostic(JSON.stringify({ beforeSecondDecision: service.received.filter((entry) => entry.rpc === "tools/call").map((entry) => entry.identityIndex) }));
  assert.ok(second.approvals.length, "a different connection cannot consume another identity's task grant");
  assert.match(second.approvals[0].title, /secondary/u);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: second.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(start.taskId), (task) => ["succeeded", "failed"].includes(task.status), "second identity finished", 20000);
  assert.deepEqual(service.received.filter((entry) => entry.rpc === "tools/call").map((entry) => entry.identityIndex), [0, 1]);
});

test("a complete real SSE result reaches Pi before the HTTP stream closes", { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer({ mode: "sse-open", delayMs: 15000 }); t.after(() => service.close());
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "streamed result" }) }); t.after(() => f.close()); await configure(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "open SSE approval", 20000);
  const before = Date.now(); await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(start.taskId), (task) => ["succeeded", "failed"].includes(task.status), "streamed result finished", 20000);
  const run = (await f.mcp({ type: "status" })).runs.at(-1);
  t.diagnostic(JSON.stringify({ millisecondsAfterApproval: Date.now() - before, receiverCalls: service.received.filter((entry) => entry.rpc === "tools/call").length, callStatus: run.calls[0].status }));
  assert.equal(run.calls[0].status, "completed"); assert.ok(Date.now() - before < 5000);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  assert.match(JSON.stringify(f.requests.at(-1).body.messages), /remote result: streamed result/u);
});

for (const mode of ["sse-secret", "sse-oversized"]) test(`real ${mode} is bounded before model delivery and retains remote uncertainty`, { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer({ mode }); t.after(() => service.close());
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "bounded stream" }) }); t.after(() => f.close()); await configure(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "bounded SSE approval", 20000);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  const ended = await until(() => f.task(start.taskId), (task) => ["succeeded", "failed"].includes(task.status), "bounded SSE finished", 20000), status = await f.mcp({ type: "status" });
  assert.equal(status.runs.at(-1).calls[0].status, "unknown");
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  assert.ok(!JSON.stringify([ended, status, f.requests.map((entry) => entry.body)]).includes(service.token));
  assert.ok(!JSON.stringify(f.requests.map((entry) => entry.body)).includes("x".repeat(70000)));
});

test("a real RPC envelope rejected before send remains rejected and does not poison a later ordinary call", { timeout: 65000 }, async (t) => {
  const service = await createHttpMcpServer({ maxInputLength: 20000 }); t.after(() => service.close()); let large = true;
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: large ? "x".repeat(16320) : "ordinary call after local rejection" }) }); t.after(() => f.close()); await configure(f, service);
  const first = await f.start(), waiting = await until(() => f.task(first.taskId), (task) => task.approvals.length || ["succeeded", "failed"].includes(task.status), "envelope admission", 20000);
  if (waiting.approvals.length) await f.request("/api/command", { type: "answerApproval", taskId: first.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(first.taskId), (task) => ["succeeded", "failed"].includes(task.status), "envelope rejection", 20000);
  const rejected = (await f.mcp({ type: "status" })).runs.at(-1).calls[0]; t.diagnostic(JSON.stringify({ status: rejected.status, code: rejected.code, receiverCalls: service.received.filter((entry) => entry.rpc === "tools/call").length }));
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0); assert.equal(rejected.status, "rejected");
  await f.restart(); large = false;
  const next = await f.start(), approval = await until(() => f.task(next.taskId), (task) => task.approvals.length || task.status === "failed", "ordinary call approval", 20000); assert.ok(approval.approvals.length, JSON.stringify(approval));
  await f.request("/api/command", { type: "answerApproval", taskId: next.taskId, approvalId: approval.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(next.taskId), (task) => ["succeeded", "failed"].includes(task.status), "ordinary call finished", 20000);
  assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].status, "completed"); assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
});

test("remote approval exposes the exact proposed argument scope before a user decision", { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close()); const input = { value: "resource id: controlled-item-7" };
  const f = await createMcpHost({ respond: ({ res }) => providerReply(res, "mcp__remote__echo", input) }); t.after(() => f.close()); await configure(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "reviewable remote approval", 20000);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0); assert.ok(waiting.approvals[0].title.includes(JSON.stringify(input)), "approval must show arguments, in addition to their binding digest");
  await f.request("/api/command", { type: "cancelTask", taskId: start.taskId }, 202);
});

test("registered HTTP projects survive real Host restarts during initial indexing", { timeout: 45000 }, async (t) => {
  for (let attempt = 0; attempt < 8; attempt++) {
    const f = await createMcpHost();
    try {
      await f.restart();
      const state = await f.request("/api/state"); assert.ok(state.projects.some((project) => project.projectId === f.projectId));
      assert.equal((await f.mcp({ type: "list" })).projectPath, f.project);
    } finally { await f.close(); }
  }
  t.diagnostic("8 actual public project registrations and restart readbacks");
});
