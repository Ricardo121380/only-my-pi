import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createMcpHost, until, providerReply, untilPiInitialized, slowPiInitialization } from "./fixtures/mcp-host.mjs";
import { createHttpMcpServer } from "./fixtures/mcp-http-server.mjs";
import { acquireConfigLock } from "../packages/config-runtime/lock.mjs";

async function configureRemote(f, service) {
  const server = { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false };
  let state = await f.mcp({ type: "list" });
  state = await f.mcp({ type: "save", revision: state.revision, server });
  state = await f.mcp({ type: "credential", revision: state.revision, name: "remote", envName: "MCP_TOKEN", value: service.token });
  state = await f.mcp({ type: "enable", revision: state.revision, name: "remote", enabled: true });
  return state;
}
const respond = ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "approved input" });

for (const startupDelay of [0, 26000]) test(`public Host and real Pi use an authenticated Streamable HTTP MCP target only after explicit tool approval${startupDelay ? " with bounded slow initialization" : ""}`, { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond, installedExtensions: true }); t.after(() => f.close());
  const state = await configureRemote(f, service);
  assert.equal(service.received.length, 0, "saving credentials and enabling never connects");
  assert.ok(!JSON.stringify(state).includes(service.token));
  if (startupDelay) await slowPiInitialization(f.sdk, startupDelay);
  const started = await f.start();
  await untilPiInitialized(() => f.task(started.taskId));
  const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length || task.status === "failed", "HTTP approval", 20000);
  assert.ok(waiting.approvals.length, JSON.stringify(waiting));
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  const completed = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "HTTP completion", 20000);
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.match(JSON.stringify(f.requests.at(-1).body.messages), /remote result: approved input/u);
  const calls = service.received.filter((entry) => entry.rpc === "tools/call");
  assert.equal(calls.length, 1); assert.equal(calls[0].path, "/mcp"); assert.equal(calls[0].identity, true);
  const status = await f.mcp({ type: "status" });
  assert.equal(status.runs.at(-1).calls[0].status, "completed");
  assert.equal(status.runs.at(-1).processes[0].transport, "streamable-http");
  assert.ok(!JSON.stringify([completed, status, f.requests.map((entry) => entry.body)]).includes(service.token));
});

test("HTTP imports and local-write policies are rejected without opening a connection", { timeout: 30000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close());
  await f.mcp({ type: "previewImport", source: JSON.stringify({ mcpServers: { remote: { type: "sse", url: service.url } } }) }, 400);
  await f.mcp({ type: "save", revision: 0, server: { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: {}, tools: [{ name: "echo", effect: "write", pathArgument: "path", paths: ["README.md"], writeMode: "descriptor" }], enabled: false } }, 400);
  for (const url of ["https://user:secret@example.com/mcp", "http://example.com/mcp", `${service.url}?token=private`, `${service.url}#token`]) await f.mcp({ type: "save", revision: 0, server: { name: "remote", transport: "streamable-http", url, credentialRefs: {}, tools: [], enabled: false } }, 400);
  const source = JSON.stringify({ mcpServers: { remote: { type: "http", url: service.url } } });
  const preview = await f.mcp({ type: "previewImport", source });
  const state = await f.mcp({ type: "import", source, digest: preview.digest, revision: preview.revision });
  assert.equal(state.servers[0].enabled, false); assert.equal(service.received.length, 0);
});

for (const action of ["deny", "disable", "credential", "schema", "cancel"]) test(`real HTTP MCP waiting approval is invalidated by ${action} with zero business execution`, { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); await configureRemote(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length || task.status === "failed", "HTTP waiting", 20000);
  assert.ok(waiting.approvals.length, JSON.stringify(waiting));
  const current = await f.mcp({ type: "list" });
  if (action === "disable") await f.mcp({ type: "enable", name: "remote", revision: current.revision, enabled: false });
  if (action === "credential") await f.mcp({ type: "revokeCredential", name: "remote", revision: current.revision, envName: "MCP_TOKEN" });
  if (action === "schema") service.changeSchema();
  if (action === "cancel") await f.request("/api/command", { type: "cancelTask", taskId: start.taskId }, 202);
  else await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: action === "deny" ? "拒绝" : "仅本次" });
  await until(() => f.task(start.taskId), (task) => ["succeeded", "failed", "cancelled"].includes(task.status), "invalidated HTTP ended", 20000);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0);
  const status = await f.mcp({ type: "status" }); assert.ok(status.runs.at(-1).calls.every((call) => call.status !== "completed"));
});

for (const mode of ["disconnect", "oversized", "secret"]) test(`received HTTP ${mode} stays unknown across restart and later tool attempts never replay`, { timeout: 65000 }, async (t) => {
  const service = await createHttpMcpServer({ mode }); t.after(() => service.close());
  const f = await createMcpHost({ respond, installedExtensions: true }); t.after(() => f.close()); await configureRemote(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "HTTP pending", 20000);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" });
  await until(() => f.task(start.taskId), (task) => ["succeeded", "failed"].includes(task.status), "HTTP unknown ended", 20000);
  let status = await f.mcp({ type: "status" });
  assert.equal(status.runs[0].calls[0].status, "unknown");
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  assert.ok(!JSON.stringify([status, f.requests.map((entry) => entry.body)]).includes(service.token));
  await f.restart(); service.setMode("json");
  status = await f.mcp({ type: "status" }); assert.equal(status.runs[0].calls[0].status, "unknown");
  const later = await f.start();
  const ended = await until(() => f.task(later.taskId), (task) => ["succeeded", "failed"].includes(task.status), "no HTTP replay", 20000);
  assert.match(JSON.stringify(ended), /MCP_REMOTE_RECONCILIATION_REQUIRED/u);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
});

test("HTTP redirects and a changed target refuse credentials without reaching the replacement", { timeout: 50000 }, async (t) => {
  const service = await createHttpMcpServer({ mode: "redirect" }), other = await createHttpMcpServer(); t.after(async () => { await service.close(); await other.close(); });
  const f = await createMcpHost({ respond }); t.after(() => f.close()); await configureRemote(f, service);
  const start = await f.start(); await until(() => f.task(start.taskId), (task) => task.status === "failed", "redirect denied", 20000);
  assert.ok(service.received.length > 0); assert.ok(service.received.every((entry) => entry.path === "/mcp"));
  await f.restart();
  const state = await f.mcp({ type: "list" }), prior = state.servers[0];
  await f.mcp({ type: "save", revision: state.revision, server: { name: prior.name, transport: prior.transport, url: other.url, credentialRefs: prior.credentialRefs, tools: prior.tools, enabled: true } });
  const changed = await f.start(); const failed = await until(() => f.task(changed.taskId), (task) => task.status === "failed", "credential target binding", 20000);
  assert.match(JSON.stringify(failed), /MCP_CREDENTIAL_BINDING_CHANGED/u); assert.equal(other.received.length, 0);
});

test("a finite SSE response uses Streamable HTTP and a cancelled dispatched call retains remote uncertainty", { timeout: 65000 }, async (t) => {
  const service = await createHttpMcpServer({ mode: "sse" }); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); await configureRemote(f, service);
  for (const cancel of [false, true]) {
    if (cancel) { await f.restart(); service.setMode("delay"); }
    const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "SSE approval", 20000);
    await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
    if (cancel) { await until(() => service.received.filter((entry) => entry.rpc === "tools/call").length, (count) => count === 2, "received before cancel"); await f.request("/api/command", { type: "cancelTask", taskId: start.taskId }, 202); }
    await until(() => f.task(start.taskId), (task) => ["succeeded", "failed", "cancelled"].includes(task.status), "SSE end", 20000);
    const run = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(run.calls[0].status, cancel ? "unknown" : "completed"); assert.ok(run.processes.every((entry) => entry.remoteState === "unconfirmed"));
  }
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 2);
});

test("HTTP input and physical deadline limits reject before send or retain an already received request as unknown", { timeout: 65000 }, async (t) => {
  const service = await createHttpMcpServer({ mode: "delay", maxInputLength: 20000 }); t.after(() => service.close());
  let large = true;
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: large ? "x".repeat(17000) : "finite input" }) }); t.after(() => f.close()); await configureRemote(f, service);
  const first = await f.start(); const rejected = await until(() => f.task(first.taskId), (task) => ["failed", "succeeded"].includes(task.status), "large HTTP input", 20000);
  assert.match(JSON.stringify(rejected), /MCP_INPUT_LIMIT/u); assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0);
  await f.restart();
  large = false;
  const second = await f.start(), waiting = await until(() => f.task(second.taskId), (task) => task.approvals.length, "deadline approval", 20000);
  const before = Date.now(); await f.request("/api/command", { type: "answerApproval", taskId: second.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  await until(() => f.task(second.taskId), (task) => ["succeeded", "failed"].includes(task.status), "physical deadline", 20000);
  assert.ok(Date.now() - before < 15000); assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  assert.equal((await f.mcp({ type: "status" })).runs.at(-1).calls[0].status, "unknown");
});

test("the public HTTP MCP configuration reports a held store lock without crashing or sending credentials", { timeout: 30000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close());
  const lock = await acquireConfigLock(f.config);
  try {
    const result = await f.mcp({ type: "save", revision: 0, server: { name: "remote", transport: "streamable-http", url: service.url, tools: [], credentialRefs: {}, enabled: false } }, 409);
    assert.equal(result.code, "LOCK_HELD"); assert.equal(service.received.length, 0);
  } finally { await lock.release(); }
  await configureRemote(f, service); assert.equal(service.received.length, 0);
});

test("a shared HTTP credential reference cannot authorize another registered project", { timeout: 45000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configureRemote(f, service), prior = state.servers[0];
  const otherPath = path.join(f.root, "other-project"); await fs.mkdir(otherPath);
  const other = await f.request("/api/command", { type: "addProject", path: otherPath });
  await f.request("/api/mcp", { type: "save", projectId: other.projectId, revision: state.revision, server: { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: prior.credentialRefs, tools: prior.tools, enabled: true } });
  const start = await f.start({ projectId: other.projectId }); const failed = await until(() => f.task(start.taskId), (task) => task.status === "failed", "cross-project credential denied", 20000);
  assert.match(JSON.stringify(failed), /MCP_CREDENTIAL_BINDING_CHANGED/u); assert.equal(service.received.length, 0);
});

test("the real Pi task call ceiling keeps the 33rd HTTP business request off the receiver", { timeout: 65000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond: ({ res }, requests) => providerReply(res, requests.length <= 33 ? "mcp__remote__echo" : null, { value: "limited input" }) }); t.after(() => f.close()); await configureRemote(f, service);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length, "HTTP ceiling approval", 20000);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" });
  const ended = await until(() => f.task(start.taskId), (task) => ["succeeded", "failed"].includes(task.status), "HTTP ceiling completion", 45000);
  assert.match(JSON.stringify(ended), /MCP_CALL_LIMIT/u);
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 32);
  const run = (await f.mcp({ type: "status" })).runs.at(-1); assert.equal(run.calls.length, 32); assert.ok(run.calls.every((call) => call.status === "completed"));
});
