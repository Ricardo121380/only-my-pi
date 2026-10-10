import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createMcpHost, until, providerReply } from "./fixtures/mcp-host.mjs";
import { createOAuthMcpServer } from "./fixtures/mcp-oauth-server.mjs";
import { McpCatalog } from "../packages/mcp/catalog.mjs";
import { McpOAuth } from "../packages/mcp/oauth.mjs";
import { withConfigLock } from "../packages/config-runtime/index.mjs";

const respond = ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "OAuth approved input" });
async function configure(f, service) {
  return f.mcp({ type: "save", revision: (await f.mcp({ type: "list" })).revision,
    server: { name: "remote", transport: "streamable-http", url: service.url, enabled: true, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }] } });
}
async function openAndAuthorize(f, flow, decision = "allow", manager) {
  const open = manager ? null : await fetch(`${f.host.origin}/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Origin: f.host.origin, Cookie: f.cookie }, redirect: "manual" });
  if (open) assert.equal(open.status, 303);
  const authorization = manager ? await manager.open(flow.flowId) : open.headers.get("location");
  const page = await fetch(authorization); assert.equal(page.status, 200);
  const answer = await fetch(authorization, { method: "POST", body: new URLSearchParams({ decision }), redirect: "manual" });
  assert.equal(answer.status, 303);
  const callback = answer.headers.get("location"), result = await fetch(callback);
  return { callback, status: result.status, body: await result.text() };
}
const currentFlow = async (f, flow) => f.mcp({ type: "oauthStatus", flowId: flow.flowId });
async function login(f, state) {
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision });
  await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision }, 409);
  await openAndAuthorize(f, flow);
  await until(() => currentFlow(f, flow), (value) => value.status === "stored", "identity stored");
  return f.mcp({ type: "list" });
}

test("explicit public MCP OAuth login uses native PKCE, atomic bound credentials and one real Pi tool request", { timeout: 45000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond, installedExtensions: true }); t.after(() => f.close());
  const initial = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: initial.revision });
  assert.equal(flow.status, "waiting"); assert.equal(service.received.filter((entry) => entry.type === "authorization_page").length, 0);
  const callback = await openAndAuthorize(f, flow); assert.equal(callback.status, 200);
  const stored = await until(() => currentFlow(f, flow), (value) => value.status === "stored", "OAuth durable identity");
  const state = await f.mcp({ type: "list" }); assert.equal(state.authentication.remote.state, "connected");
  const credential = JSON.parse(await fs.readFile(path.join(f.config, "only-my-pi/mcp/credentials", `${stored.ref}.json`), "utf8"));
  assert.equal(credential.projectPath, f.project); assert.equal(credential.name, "remote"); assert.equal(credential.targetDigest, state.servers[0].targetDigest);
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (value) => value.approvals.length || value.status === "failed", "OAuth real Pi approval", 20000);
  assert.ok(waiting.approvals.length, JSON.stringify(waiting));
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  const ended = await until(() => f.task(start.taskId), (value) => ["succeeded", "failed"].includes(value.status), "OAuth real Pi completion", 20000);
  assert.equal(ended.status, "succeeded", JSON.stringify(ended)); assert.match(JSON.stringify(f.requests.at(-1).body.messages), /OAuth result: OAuth approved input/u);
  const grant = service.received.find((entry) => entry.type === "authorization").grant;
  assert.equal(service.received.filter((entry) => entry.type === "token" && entry.valid && entry.grant === grant).length, 1);
  assert.deepEqual(service.received.filter((entry) => entry.rpc === "tools/call").map(({ grant: actual, valid }) => ({ grant: actual, valid })), [{ grant, valid: true }]);
  const publicData = JSON.stringify([flow, state, ended, await f.mcp({ type: "status" }), f.requests.map((entry) => entry.body)]);
  for (const value of service.privateValues) assert.ok(!publicData.includes(value));
  assert.ok(!callback.body.includes(new URL(callback.callback).searchParams.get("code")));
});

test("cancelled public login closes its native callback, does not open a page or publish identity, and is idempotent", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision });
  const cancelled = await f.mcp({ type: "oauthCancel", flowId: flow.flowId }); assert.equal(cancelled.status, "cancelled");
  assert.equal((await f.mcp({ type: "oauthCancel", flowId: flow.flowId })).status, "cancelled");
  const reopened = await fetch(`${f.host.origin}/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Cookie: f.cookie, Origin: f.host.origin }, redirect: "manual" });
  assert.equal(reopened.status, 409); assert.equal((await f.mcp({ type: "list" })).authentication.remote.state, "not_connected");
  assert.equal(service.received.filter((entry) => ["authorization_page", "token", "mcp"].includes(entry.type)).length, 0);
});

for (const mode of ["bad_state", "wrong_path", "missing_code", "bad_issuer"]) test(`native OAuth ${mode} never exchanges a token or sends a business request`, { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); service.setMode(mode); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision }), callback = await openAndAuthorize(f, flow);
  if (["bad_state", "wrong_path"].includes(mode)) {
    assert.equal(callback.status, mode === "bad_state" ? 400 : 404);
    assert.equal((await currentFlow(f, flow)).status, "waiting"); await f.mcp({ type: "oauthCancel", flowId: flow.flowId });
  } else assert.equal((await until(() => currentFlow(f, flow), (value) => value.status === "failed", "invalid callback ended")).status, "failed");
  assert.equal(service.received.filter((entry) => ["token", "mcp"].includes(entry.type)).length, 0);
  assert.equal((await f.mcp({ type: "list" })).servers[0].credentialRefs.MCP_TOKEN, undefined);
});

test("native callback timeout is finite and the actual callback listener is closed", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const manager = new McpOAuth({ catalog: new McpCatalog(f.config), sdkFile: f.sdk, timeoutMs: 200 }); t.after(() => manager.stop());
  const flow = await manager.start("remote", f.project, state.revision);
  await until(() => manager.public(manager.own(flow.flowId, f.project)), (value) => value.status === "timed_out", "native callback physical timeout");
  await manager.own(flow.flowId, f.project).done;
  await assert.rejects(manager.open(flow.flowId), { code: "MCP_OAUTH_FLOW_EXPIRED" });
  assert.equal(service.received.filter((entry) => ["authorization_page", "token", "mcp"].includes(entry.type)).length, 0);
});

test("changing the target while the native callback is pending rejects the old grant before token exchange", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(), other = await createOAuthMcpServer(); t.after(async () => { await service.close(); await other.close(); });
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision });
  const open = await fetch(`${f.host.origin}/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Cookie: f.cookie, Origin: f.host.origin }, redirect: "manual" });
  await configure(f, other);
  const answer = await fetch(open.headers.get("location"), { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" });
  await fetch(answer.headers.get("location"));
  const failed = await until(() => currentFlow(f, flow), (value) => value.status === "failed", "changed target rejected"); assert.match(failed.code, /CONFLICT|BINDING/u);
  assert.equal(service.received.filter((entry) => entry.type === "token").length, 0); assert.equal(other.received.length, 0);
});

test("an explicit refresh rotates the reference without opening authorization again and revoked identity blocks later Pi requests", { timeout: 50000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await login(f, await configure(f, service));
  const oldRef = state.servers[0].credentialRefs.MCP_TOKEN;
  const flow = await f.mcp({ type: "oauthRefresh", name: "remote", revision: state.revision });
  await until(() => currentFlow(f, flow), (value) => value.status === "stored", "refresh publication");
  const rotated = await f.mcp({ type: "list" }); assert.notEqual(rotated.servers[0].credentialRefs.MCP_TOKEN, oldRef);
  assert.equal(service.received.filter((entry) => entry.type === "authorization_page").length, 1);
  assert.equal(service.received.filter((entry) => entry.type === "token" && entry.kind === "refresh_token" && entry.valid).length, 1);
  service.revoke();
  const first = await f.start(); await until(() => f.task(first.taskId), (value) => value.status === "failed", "issuer invalidation", 20000);
  assert.equal((await f.mcp({ type: "list" })).authentication.remote.state, "expired");
  const count = service.received.filter((entry) => entry.type === "mcp").length; await f.restart();
  const later = await f.start(); const failed = await until(() => f.task(later.taskId), (value) => value.status === "failed", "expired login refuses future requests", 20000);
  assert.match(JSON.stringify(failed), /MCP_OAUTH_LOGIN_REQUIRED/u);
  assert.equal(service.received.filter((entry) => entry.type === "mcp").length, count); assert.equal(f.requests.length, 0);
});

for (const cancel of [false, true]) test(`native refresh ${cancel ? "cancellation" : "failure"} settles before reporting and cannot reuse the old identity`, { timeout: 45000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await login(f, await configure(f, service));
  service.setMode(cancel ? "refresh_delay" : "refresh_fail");
  const flow = await f.mcp({ type: "oauthRefresh", name: "remote", revision: state.revision });
  await until(() => service.received, (rows) => rows.some((entry) => entry.type === "token" && entry.kind === "refresh_token"), "physical refresh received");
  let result;
  if (cancel) { const start = Date.now(); result = await f.mcp({ type: "oauthCancel", flowId: flow.flowId }); assert.ok(Date.now() - start < 5000); }
  else result = await until(() => currentFlow(f, flow), (value) => value.status === "failed", "refresh failed");
  assert.equal(result.status, cancel ? "cancelled" : "failed");
  assert.equal((await f.mcp({ type: "list" })).servers[0].credentialRefs.MCP_TOKEN, state.servers[0].credentialRefs.MCP_TOKEN);
  await f.restart(); const task = await f.start(); await until(() => f.task(task.taskId), (value) => value.status === "failed", "no old-token replay", 20000);
  assert.equal(service.received.filter((entry) => entry.type === "mcp").length, 0);
});

test("local expiry, explicit reference binding and credential revocation are checked before any Pi network request", { timeout: 60000 }, async (t) => {
  const service = await createOAuthMcpServer({ expiresIn: 1 }); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); let state = await login(f, await configure(f, service));
  await until(() => f.mcp({ type: "list" }), (value) => value.authentication.remote.state === "expired", "local expiry");
  let start = await f.start(); await until(() => f.task(start.taskId), (value) => value.status === "failed", "expiry admission", 20000);
  assert.equal(service.received.filter((entry) => entry.type === "mcp").length, 0);
  await f.restart(); service.setExpiresIn(3600); state = await login(f, await f.mcp({ type: "list" }));
  const otherPath = path.join(f.root, "other-project"); await fs.mkdir(otherPath); const other = await f.request("/api/command", { type: "addProject", path: otherPath });
  const server = state.servers[0];
  await f.request("/api/mcp", { type: "save", projectId: other.projectId, revision: state.revision, server: { name: server.name, transport: server.transport, url: server.url, credentialRefs: server.credentialRefs, tools: server.tools, enabled: true } });
  start = await f.start({ projectId: other.projectId }); await until(() => f.task(start.taskId), (value) => value.status === "failed", "foreign project ref", 20000);
  state = await f.mcp({ type: "list" }); await f.mcp({ type: "revokeCredential", revision: state.revision, name: "remote", envName: "MCP_TOKEN" });
  assert.equal((await f.mcp({ type: "list" })).authentication.remote.state, "revoked");
  await f.restart(); start = await f.start(); await until(() => f.task(start.taskId), (value) => value.status === "failed", "revoked admission", 20000);
  assert.equal(service.received.filter((entry) => entry.type === "mcp").length, 0); assert.equal(f.requests.length, 0);
});

test("repeated callback completion cannot exchange twice and re-login is a fresh explicit identity", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); let state = await login(f, await configure(f, service));
  const oldRef = state.servers[0].credentialRefs.MCP_TOKEN;
  try { const repeated = await fetch(service.lastCallback); assert.equal(repeated.status, 400); } catch (error) { assert.ok(error.cause?.code === "ECONNREFUSED" || error.cause?.code === "UND_ERR_SOCKET"); }
  assert.equal(service.received.filter((entry) => entry.type === "token").length, 1);
  state = await login(f, state); assert.notEqual(state.servers[0].credentialRefs.MCP_TOKEN, oldRef);
  const grants = service.received.filter((entry) => entry.type === "authorization").map((entry) => entry.grant); assert.equal(new Set(grants).size, 2);
  assert.equal(service.received.filter((entry) => entry.type === "token").length, 2);
});

test("a valid callback arriving after explicit cancellation cannot publish an identity", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision });
  const open = await fetch(`${f.host.origin}/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Cookie: f.cookie, Origin: f.host.origin }, redirect: "manual" });
  await f.mcp({ type: "oauthCancel", flowId: flow.flowId });
  const answer = await fetch(open.headers.get("location"), { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" });
  await assert.rejects(fetch(answer.headers.get("location")));
  assert.equal((await f.mcp({ type: "list" })).authentication.remote.state, "not_connected");
  assert.equal(service.received.filter((entry) => entry.type === "token").length, 0);
});

test("Host restart closes a waiting callback and does not resume authentication", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const flow = await f.mcp({ type: "oauthStart", name: "remote", revision: state.revision }); await f.restart();
  const snapshot = await f.mcp({ type: "list" }); assert.equal(snapshot.authentication.remote.flow.status, "cancelled");
  await f.mcp({ type: "oauthStatus", flowId: flow.flowId }, 404);
  assert.equal(service.received.filter((entry) => ["authorization_page", "token", "mcp"].includes(entry.type)).length, 0);
});

test("concurrent explicit login admission keeps the actual callback count at eight", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); let state;
  for (let i = 0; i < 9; i++) {
    state = await f.mcp({ type: "list" });
    state = await f.mcp({ type: "save", revision: state.revision, server: { name: `remote${i}`, transport: "streamable-http", url: service.url, enabled: false, credentialRefs: {}, tools: [] } });
  }
  const results = await Promise.all(Array.from({ length: 9 }, async (_, i) => {
    const response = await fetch(`${f.host.origin}/api/mcp`, { method: "POST", headers: { Cookie: f.cookie, Origin: f.host.origin, "content-type": "application/json", "x-omp-mcp-protocol": "1" }, body: JSON.stringify({ type: "oauthStart", projectId: f.projectId, name: `remote${i}`, revision: state.revision }) });
    return { status: response.status, data: await response.json() };
  }));
  assert.equal(results.filter((result) => result.status === 200 && result.data.status === "waiting").length, 8);
  assert.deepEqual(results.filter((result) => result.status !== 200).map((result) => result.data.code), ["MCP_OAUTH_LIMIT"]);
  assert.equal(service.received.filter((entry) => entry.type === "registration").length, 8);
  for (const result of results.filter((value) => value.status === 200)) await f.mcp({ type: "oauthCancel", flowId: result.data.flowId });
});

test("a physical refresh deadline settles finitely and cannot send with the unsettled identity", { timeout: 45000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await login(f, await configure(f, service)); service.setMode("refresh_delay");
  const before = Date.now(), flow = await f.mcp({ type: "oauthRefresh", name: "remote", revision: state.revision });
  const failed = await until(() => currentFlow(f, flow), (value) => value.status === "failed", "physical refresh deadline", 13000);
  assert.equal(failed.code, "MCP_OAUTH_REQUEST_TIMED_OUT"); assert.ok(Date.now() - before < 14000);
  assert.equal(service.received.filter((entry) => entry.type === "token" && entry.kind === "refresh_token").length, 1);
  assert.equal(service.received.filter((entry) => entry.type === "mcp").length, 0);
});

test("an authorization open paused at its binding check cannot revive a completed cancellation", { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await configure(f, service);
  const manager = new McpOAuth({ catalog: new McpCatalog(f.config), sdkFile: f.sdk }); t.after(() => manager.stop());
  const flow = await manager.start("remote", f.project, state.revision);
  let release, reached; const paused = new Promise((resolve) => { release = resolve; }), checking = new Promise((resolve) => { reached = resolve; });
  const check = manager.assertBinding.bind(manager);
  manager.assertBinding = async (value) => { await check(value); reached(); await paused; };
  const opening = manager.open(flow.flowId); opening.catch(() => {}); await checking;
  assert.equal((await manager.action({ type: "oauthCancel", flowId: flow.flowId }, f.project)).status, "cancelled");
  release(); await assert.rejects(opening, { code: "MCP_OAUTH_FLOW_EXPIRED" });
  assert.equal(manager.public(manager.own(flow.flowId, f.project)).status, "cancelled");
  const next = await manager.start("remote", f.project, state.revision); assert.equal(next.status, "waiting");
  await manager.action({ type: "oauthCancel", flowId: next.flowId }, f.project);
  assert.equal(service.received.filter((row) => ["authorization_page", "token", "mcp"].includes(row.type)).length, 0);
});

for (const kind of ["login", "refresh"]) for (const fault of ["status-sync", "config-after-rename"]) test(`native ${kind} publication ${fault} is distinguished from failed authentication`, { timeout: 30000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); let state = await configure(f, service);
  if (kind === "refresh") state = await login(f, state);
  const catalog = new McpCatalog(f.config), manager = new McpOAuth({ catalog, sdkFile: f.sdk }); t.after(() => manager.stop());
  if (fault === "status-sync") {
    const save = catalog.saveOAuthFlow.bind(catalog);
    catalog.saveOAuthFlow = async (flow) => { if (["stored", "stored_sync_failed"].includes(flow.status)) throw Object.assign(new Error("injected status write failure"), { code: "EIO" }); return save(flow); };
  } else {
    const mutate = catalog.mutate.bind(catalog);
    catalog.mutate = (revision, update, options) => mutate(revision, update, { ...options, failAtPhase: "AFTER_RENAME" });
  }
  const flow = await manager.start("remote", f.project, state.revision, kind);
  if (kind === "login") await openAndAuthorize(f, flow, "allow", manager);
  await manager.own(flow.flowId, f.project).done;
  const result = manager.public(manager.own(flow.flowId, f.project));
  assert.equal(result.status, fault === "status-sync" ? "stored_sync_failed" : "publication_unconfirmed");
  assert.equal(result.code, fault === "status-sync" ? "MCP_OAUTH_STATUS_SYNC_FAILED" : "MCP_OAUTH_PUBLICATION_UNCONFIRMED");
  assert.equal((await manager.snapshot(f.project)).authentication.remote.flow.status, result.status);
  if (fault === "config-after-rename") assert.equal(result.bindingConfirmed, true);
  const snapshot = await f.mcp({ type: "list" }); assert.equal(snapshot.servers[0].credentialRefs.MCP_TOKEN, result.ref);
  const credential = await catalog.boundCredential(snapshot.servers[0], f.project); assert.ok(credential.oauth.tokens.access_token);
  assert.equal((await manager.action({ type: "oauthCancel", flowId: flow.flowId }, f.project)).status, result.status);
  if (fault === "status-sync") assert.ok((await catalog.credentials(snapshot.servers[0], f.project)).env.MCP_TOKEN);
  else await assert.rejects(catalog.credentials(snapshot.servers[0], f.project), { code: "MCP_OAUTH_LOGIN_REQUIRED" });
  assert.equal(service.received.filter((row) => row.type === "mcp").length, 0);
});

test("a dynamic registration management token echoed by a real MCP tool never enters Pi history or public state", { timeout: 45000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond, installedExtensions: true }); t.after(() => f.close());
  await login(f, await configure(f, service)); service.setMode("registration_secret_echo");
  const start = await f.start(), waiting = await until(() => f.task(start.taskId), (value) => value.approvals.length, "registration secret echo approval", 20000);
  await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
  const ended = await until(() => f.task(start.taskId), (value) => ["succeeded", "failed"].includes(value.status), "secret echo terminal task", 20000);
  const publicData = JSON.stringify([ended, await f.mcp({ type: "list" }), await f.mcp({ type: "status" }), f.requests.map((entry) => entry.body)]);
  for (const secret of service.privateValues) assert.ok(!publicData.includes(secret), "registered private value leaked");
  assert.match(publicData, /MCP_SECRET_OUTPUT_REJECTED/u);
  assert.equal(service.received.filter((row) => row.rpc === "tools/call").length, 1);
});

test("issuer invalidation under an occupied configuration lock blocks later requests across Host restart", { timeout: 50000 }, async (t) => {
  const service = await createOAuthMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ respond }); t.after(() => f.close()); await login(f, await configure(f, service));
  service.revoke(); service.setMode("unauthorized_pause");
  const first = await f.start(); await until(() => service.received, (rows) => rows.some((row) => row.type === "mcp" && !row.valid), "physical invalid initialize pending", 20000);
  let release, acquired; const held = new Promise((resolve) => { release = resolve; }), ready = new Promise((resolve) => { acquired = resolve; });
  const lock = withConfigLock(f.config, "controlled-invalid-auth-lock", async () => { acquired(); await held; });
  t.after(async () => { release(); await lock; }); await ready; service.releaseUnauthorized();
  const failed = await until(() => f.task(first.taskId), (value) => value.status === "failed", "401 recorded while config lock held", 20000);
  assert.match(JSON.stringify(failed), /MCP_HTTP_AUTH_REQUIRED/u);
  assert.equal((await f.mcp({ type: "list" })).authentication.remote.state, "expired");
  release(); await lock; service.setMode("normal"); const count = service.received.filter((row) => row.type === "mcp").length;
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const next = await f.start(); await until(() => f.task(next.taskId), (value) => value.status === "failed", "known invalid identity admission", 20000);
    assert.equal(service.received.filter((row) => row.type === "mcp").length, count);
  }
  assert.equal(service.received.filter((row) => row.rpc === "tools/call").length, 0); assert.equal(f.requests.length, 0);
});

test("a pending issuer rejection survives a public target change and cannot revive when its original binding is restored", { timeout: 50000 }, async (t) => {
  const service = await createOAuthMcpServer(), other = await createOAuthMcpServer(); t.after(async () => { await service.close(); await other.close(); });
  const f = await createMcpHost({ respond }); t.after(() => f.close()); const state = await login(f, await configure(f, service));
  const original = Object.fromEntries(Object.entries(state.servers[0]).filter(([key]) => !["source", "revocations", "targetDigest"].includes(key)));
  service.revoke(); service.setMode("unauthorized_pause");
  const first = await f.start(); await until(() => service.received, (rows) => rows.some((row) => row.type === "mcp" && !row.valid), "physical invalid initialize pending before target change", 20000);
  const changed = await f.mcp({ type: "save", revision: state.revision, server: { ...original, url: other.url } });
  assert.equal(changed.authentication.remote.state, "binding_changed");
  service.releaseUnauthorized();
  const failed = await until(() => f.task(first.taskId), (value) => value.status === "failed", "401 after public target change", 20000);
  assert.match(JSON.stringify(failed), /MCP_HTTP_AUTH_REQUIRED/u);
  const restored = await f.mcp({ type: "save", revision: changed.revision, server: original });
  assert.equal(restored.authentication.remote.state, "expired");
  service.setMode("normal"); const count = service.received.filter((row) => row.type === "mcp").length;
  for (const restart of [false, true]) {
    if (restart) await f.restart();
    const next = await f.start(); await until(() => f.task(next.taskId), (value) => value.status === "failed", "restored invalid identity admission", 20000);
    assert.equal(service.received.filter((row) => row.type === "mcp").length, count);
  }
  assert.equal(service.received.filter((row) => row.rpc === "tools/call").length, 0); assert.equal(other.received.length, 0); assert.equal(f.requests.length, 0);
});
