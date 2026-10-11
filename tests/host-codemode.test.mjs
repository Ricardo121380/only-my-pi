import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { createMcpHost, providerReply, until, mcpReception } from "./fixtures/mcp-host.mjs";
import { createWriteHost, codingRequest, terminal } from "./fixtures/mcp-write-host.mjs";

test("public Host runs the native QuickJS extension and authorizes ordinary and MCP children separately", { timeout: 45000 }, async (t) => {
  const code = 'text(await tools.read({path:"README.md"})); text(await tools.mcp__local__read_file({path:"README.md"})); store("checked", {source:"README.md"});';
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: f.server });
  await f.mcp({ type: "enable", revision: 1, name: "local", enabled: true });
  const started = await f.start();
  const first = await until(() => f.task(started.taskId), (task) => task.approvals.length || ["failed", "succeeded"].includes(task.status), "ordinary child approval", 15000);
  assert.ok(first.approvals.length, JSON.stringify(first));
  assert.match(first.approvals[0]?.title ?? "", /Codemode · read/);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: first.approvals[0].approvalId, value: "仅本次" });
  const second = await until(() => f.task(started.taskId), (task) => task.approvals.some((approval) => approval.title.startsWith("MCP ·")), "MCP child approval");
  const run = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === started.taskId);
  assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: second.approvals[0].approvalId, value: "仅本次" });
  const final = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "QuickJS completion");
  assert.equal(final.status, "succeeded", JSON.stringify(final));
  const parent = final.toolCalls.find((call) => call.name === "codemode");
  const children = final.toolCalls.filter((call) => call.parentToolCallId === parent.toolCallId);
  assert.deepEqual(children.map((call) => [call.name, call.status]), [["read", "completed"], ["mcp__local__read_file", "completed"]]);
  assert.ok(children.every((call) => call.durationMs >= 0 && /temporary CLI project/.test(call.result)));
  assert.match(parent.result, /Script completed/);
  const completed = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === started.taskId);
  assert.equal((await mcpReception(completed)).filter((item) => item.type === "call").length, 1);
  assert.equal(completed.calls[0].parentToolCallId, parent.toolCallId);
});

test("native QuickJS keeps partial failures and enforces input, result, memory, store and suspended-promise boundaries", { timeout: 90000 }, async (t) => {
  let code;
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const cases = [
    ['text("partial before failure"); throw new Error("script failure");', /partial before failure[\s\S]*script failure/],
    ['text("x".repeat(100000));', /CODEMODE_OUTPUT_LIMIT/],
    [`/*${"x".repeat(33000)}*/text("oversized source");`, /CODEMODE_INPUT_LIMIT/],
    ['await tools.read({path:"x".repeat(17000)});', /CODEMODE_ARGUMENT_LIMIT/],
    ['store("large", "x".repeat(1048577));', /store[\s\S]*(limit|large|bytes)/i],
    ['const buffers=[]; for(let i=0;i<400;i++) buffers.push(new Uint8Array(1024*1024)); text(buffers.length);', /out of memory/i],
    ['await new Promise(() => {}); text("unreachable");', /(deadlock|pending|settle)/i],
    ['text(await models.getAvailableOfType("classifier")); await models.classify({type:"classifier",provider:"unselected",id:"other"}, {});', /\[\][\s\S]*Unknown classifier model/],
    ['// @options: {"timeout_ms":50}\nwhile(true) {}', /CODEMODE_TIMEOUT|timed out|timeout/i],
  ];
  for (const [source, expected] of cases) {
    code = source;
    const started = await f.start();
    const final = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), String(expected));
    const parent = final.toolCalls.find((call) => call.name === "codemode");
    assert.equal(parent.status, "failed", JSON.stringify(final));
    assert.match(parent.result, expected);
    assert.equal(final.approvals.length, 0);
  }
  assert.equal(f.requests.length, cases.length * 2, "only the selected loopback chat requests were received");
});

test("rejecting one child preserves a successful partial result instead of treating outer completion as child success", { timeout: 30000 }, async (t) => {
  const code = 'try { await tools.read({path:"README.md"}); } catch (e) { text(e.message); } text("partial result retained");';
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const started = await f.start();
  const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length, "ordinary approval without MCP");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "拒绝" });
  const final = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "partial completion");
  assert.equal(final.toolCalls.find((call) => call.name === "read").status, "failed");
  const parent = final.toolCalls.find((call) => call.name === "codemode");
  assert.equal(parent.status, "completed");
  assert.match(parent.result, /CODEMODE_CALL_DENIED[\s\S]*partial result retained/);
});

test("an ordinary target changed during approval cannot retain or consume the previous grant", { timeout: 25000 }, async (t) => {
  const code = 'text(await tools.read({path:"README.md"}));';
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const started = await f.start(), waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length, "ordinary target approval", 15000);
  await fs.writeFile(path.join(f.project, "README.md"), "replacement target bytes\n");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" });
  const final = await until(() => f.task(started.taskId), terminal, "changed target refusal");
  assert.equal(final.toolCalls.find((call) => call.name === "read").status, "failed");
  assert.match(final.toolCalls.find((call) => call.name === "codemode").result, /CODEMODE_TARGET_CHANGED/);
  assert.doesNotMatch(final.toolCalls.find((call) => call.name === "read").result, /replacement target bytes/);
});

test("unawaited calls and cancellation do not dispatch any new MCP action or retain approvals", { timeout: 45000 }, async (t) => {
  let code = 'tools.mcp__local__read_file({path:"README.md"}); text("unawaited complete");';
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  await f.mcp({ type: "save", revision: 0, server: f.server });
  await f.mcp({ type: "enable", revision: 1, name: "local", enabled: true });
  const unawaited = await f.start();
  await until(() => f.task(unawaited.taskId), (task) => ["succeeded", "failed"].includes(task.status), "unawaited termination");
  let run = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === unawaited.taskId);
  assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 0);
  code = 'await tools.mcp__local__read_file({path:"README.md"}); await tools.mcp__local__read_file({path:"README.md"});';
  const cancelled = await f.start();
  const waiting = await until(() => f.task(cancelled.taskId), (task) => task.approvals.length, "cancellable child approval");
  const oldApproval = waiting.approvals[0].approvalId;
  await f.request("/api/command", { type: "cancelTask", taskId: cancelled.taskId }, 202);
  const final = await until(() => f.task(cancelled.taskId), (task) => ["cancelled", "failed"].includes(task.status), "cancelled script");
  assert.equal(final.status, "cancelled", JSON.stringify(final));
  assert.equal(final.approvals.length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: cancelled.taskId, approvalId: oldApproval, value: "本任务" }, 409);
  run = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === cancelled.taskId);
  assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 0);
  await f.restart();
  assert.equal((await f.task(cancelled.taskId)).approvals.length, 0);
});

test("a hidden MCP tool is absent from QuickJS discovery and a handwritten name cannot invoke it", { timeout: 30000 }, async (t) => {
  const code = 'text(ALL_TOOLS.some(t => t.name === "mcp__local__read_file")); try { await tools.mcp__local__read_file({path:"README.md"}); } catch { text("hidden rejected"); }';
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const server = { ...f.server, tools: f.server.tools.map((tool) => ({ ...tool, exposure: "hidden" })) };
  await f.mcp({ type: "save", revision: 0, server });
  await f.mcp({ type: "enable", revision: 1, name: "local", enabled: true });
  const started = await f.start();
  const final = await until(() => f.task(started.taskId), (task) => ["succeeded", "failed"].includes(task.status), "hidden tool rejection");
  assert.equal(final.approvals.length, 0);
  assert.match(final.toolCalls.find((call) => call.name === "codemode").result, /false[\s\S]*hidden rejected/);
  const run = (await f.mcp({ type: "status" })).runs.find((item) => item.taskId === started.taskId);
  assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, 0);
  assert.ok(!f.requests[0].body.tools.some((tool) => tool.function.name === "mcp__local__read_file"));
});

test("direct, deferred, codemode and inactive MCP exposure keep declarations distinct from nested eligibility", { timeout: 50000 }, async (t) => {
  for (const [exposure, active] of [["direct", true], ["deferred", true], ["codemode", true], ["direct", false]]) {
    const code = 'text(ALL_TOOLS.some(t => t.name === "mcp__local__read_file")); try { text(await tools.mcp__local__read_file({path:"README.md"})); } catch { text("not callable"); }';
    const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
    t.after(() => f.close());
    await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true, tools: f.server.tools.map((tool) => ({ ...tool, exposure, active })) } });
    const started = await f.start();
    const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length || terminal(task), "exposure outcome");
    assert.equal(f.requests[0].body.tools.some((tool) => tool.function.name === "mcp__local__read_file"), active && exposure === "direct");
    if (active) {
      assert.equal(waiting.approvals.length, 1);
      await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "仅本次" });
    } else assert.equal(waiting.approvals.length, 0);
    const final = await until(() => f.task(started.taskId), terminal, "exposure complete");
    assert.match(final.toolCalls.find((call) => call.name === "codemode").result, active ? /true[\s\S]*temporary CLI project/ : /false[\s\S]*not callable/);
    const run = (await f.mcp({ type: "status" })).runs.at(-1);
    assert.equal((await mcpReception(run)).filter((item) => item.type === "call").length, active ? 1 : 0);
    await f.close();
  }
});

test("codemode-store follows actual resume and selected branch while fresh tasks request new authority", { timeout: 50000 }, async (t) => {
  let code, phaseBase = 0;
  const f = await createMcpHost({ installedExtensions: true, respond: ({ res }, requests) => providerReply(res, requests.length === phaseBase + 1 ? "codemode" : null, { code }) });
  t.after(() => f.close());
  const execute = async (source, sessionKey, approve) => {
    code = source; phaseBase = f.requests.length;
    const started = await f.start(sessionKey ? { resumeSessionKey: sessionKey } : {});
    if (approve) {
      const waiting = await until(() => f.task(started.taskId), (task) => task.approvals.length || terminal(task), "fresh ordinary authorization");
      assert.equal(waiting.approvals.length, 1, JSON.stringify(waiting));
      await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: waiting.approvals[0].approvalId, value: "本任务" });
    }
    const final = await until(() => f.task(started.taskId), terminal, "store completion");
    await Promise.all([...f.host.tasks.running.values()]); await f.host.scan();
    return final;
  };
  const first = await execute('store("marker", "first"); text(await tools.read({path:"README.md"}));', null, true);
  let { sessions } = await f.request(`/api/sessions?projectId=${f.projectId}`);
  const source = sessions.find((session) => session.sessionId === first.sessionId);
  assert.ok(source);
  const file = (await f.host.catalog.resume(source.sessionKey, f.projectId)).file;
  const selected = SessionManager.open(file).getEntries().find((entry) => entry.type === "custom" && entry.customType === "codemode-store");
  assert.ok(selected);
  const second = await execute('text(load("marker")); store("marker", "second"); text(await tools.read({path:"README.md"}));', source.sessionKey, true);
  assert.equal(second.sessionId, first.sessionId);
  assert.match(second.toolCalls.find((call) => call.name === "codemode").result, /first/);
  const failed = await execute('store("marker", "failed"); text("failure partial"); throw new Error("abort store");', source.sessionKey);
  assert.equal(failed.toolCalls.find((call) => call.name === "codemode").status, "failed");
  const sourceBytes = await fs.readFile(file);
  const admissions = new SessionAdmissions(f.config);
  const branch = await admissions.create(f.project, path.dirname(file), { sourceFile: file, leafId: selected.id });
  const branchId = branch.getSessionId(); await admissions.close(); await f.host.scan();
  ({ sessions } = await f.request(`/api/sessions?projectId=${f.projectId}`));
  const branched = await execute('text(load("marker")); text(await tools.read({path:"README.md"}));', sessions.find((session) => session.sessionId === branchId).sessionKey, true);
  assert.match(branched.toolCalls.find((call) => call.name === "codemode").result, /first/);
  assert.doesNotMatch(branched.toolCalls.find((call) => call.name === "codemode").result, /\nsecond\n|\nfailed\n/);
  assert.deepEqual(await fs.readFile(file), sourceBytes, "the selected branch did not rewrite its source");
  const restored = await execute('text(load("marker"));', source.sessionKey);
  assert.match(restored.toolCalls.find((call) => call.name === "codemode").result, /second/);
  const fresh = await execute('text(load("marker"));');
  assert.notEqual(fresh.sessionId, first.sessionId);
  assert.match(fresh.toolCalls.find((call) => call.name === "codemode").result, /undefined/);
  assert.ok(SessionManager.open(file).getEntries().filter((entry) => entry.customType === "codemode-store").every((entry) => Object.keys(entry.data).sort().join() === "delete,set"));
});

test("nested ordinary and MCP writes retain Coding, separate approvals and the canonical project writer", { timeout: 40000 }, async (t) => {
  const code = String.raw`text(await tools.write({path:"README.md", content:"ordinary child bytes\n"})); text(await tools.mcp__local__write_file({path:"README.md",text:"approved MCP file bytes\n"}));`;
  const f = await createWriteHost({ respond: ({ body, res }) => {
    const count = body.messages.filter((message) => message.role === "tool").length;
    providerReply(res, count === 0 ? "request_coding_access" : count === 1 ? "codemode" : null, count === 0 ? codingRequest : { code });
  } });
  t.after(() => f.close());
  const started = await f.start({ mode: "controlled" });
  const coding = await until(() => f.task(started.taskId), (task) => task.approvals.length, "Coding request");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: coding.approvals[0].approvalId, value: coding.approvals[0].options[0] });
  const ordinary = await until(() => f.task(started.taskId), (task) => task.approvals.some((approval) => approval.title.startsWith("Codemode · write")) || terminal(task), "ordinary write request");
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.ok(ordinary.approvals.length, JSON.stringify(ordinary));
  const conflict = await f.request("/api/command", { type: "openTerminal", projectId: f.projectId, cols: 90, rows: 24 }, 500);
  assert.equal(conflict.code, "OWNERSHIP_HELD");
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: ordinary.approvals[0].approvalId, value: "仅本次" });
  const mcp = await until(() => f.task(started.taskId), (task) => task.approvals.some((approval) => approval.title.startsWith("MCP ·")) || terminal(task), "descriptor write request");
  assert.ok(mcp.approvals.length, JSON.stringify(mcp));
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "ordinary child bytes\n");
  assert.equal((await mcpReception((await f.mcp({ type: "status" })).runs.at(-1))).filter((item) => item.type === "call").length, 0);
  await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: mcp.approvals[0].approvalId, value: "仅本次" });
  const final = await until(() => f.task(started.taskId), terminal, "nested writes complete");
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "approved MCP file bytes\n");
  const parent = final.toolCalls.find((call) => call.name === "codemode");
  assert.deepEqual(final.toolCalls.filter((call) => call.parentToolCallId === parent.toolCallId).map((call) => [call.name, call.status]), [["write", "completed"], ["mcp__local__write_file", "completed"]]);
  const run = (await f.mcp({ type: "status" })).runs.at(-1), receipts = await mcpReception(run);
  assert.equal(receipts.filter((entry) => entry.type === "call").length, 1);
  assert.equal(receipts.filter((entry) => entry.type === "effect").length, 1);
  assert.equal(receipts.find((entry) => entry.type === "call").arguments.path, "/dev/fd/3");
  assert.ok(receipts.filter((entry) => entry.type === "startup-write").every((entry) => ["EPERM", "EACCES"].includes(entry.code)));
  assert.equal(run.calls[0].parentToolCallId, parent.toolCallId);
  assert.equal(run.calls[0].application, "applied"); assert.equal(run.calls[0].verification, "not_run");
});
