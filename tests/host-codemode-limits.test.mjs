import assert from "node:assert/strict";
import test from "node:test";
import pty from "node-pty";
import { createMcpHost, providerReply, until, mcpReception } from "./fixtures/mcp-host.mjs";

const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
test("concurrency and task call budgets fail before excess children enter the real pipeline", { timeout: 35000 }, async (t) => {
  let code = 'text((await Promise.allSettled(Array.from({length:5},()=>tools.read({path:"README.md"})))).map(r=>r.status==="rejected"?r.reason.message:r.status));';
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const start = await f.start();
  const waiting = await until(() => f.task(start.taskId), (task) => task.approvals.length === 4, "four concurrent child approvals");
  for (const approval of waiting.approvals) await f.request("/api/command", { type: "answerApproval", taskId: start.taskId, approvalId: approval.approvalId, value: "本任务" });
  const final = await until(() => f.task(start.taskId), terminal, "concurrent script completion");
  assert.equal(final.toolCalls.filter((call) => call.parentToolCallId).length, 4);
  assert.match(final.toolCalls.find((call) => call.name === "codemode").result, /CODEMODE_CALL_LIMIT/);
  code = 'for(let i=0;i<33;i++) await tools.read({path:"README.md"});';
  const budget = await f.start();
  const approval = await until(() => f.task(budget.taskId), (task) => task.approvals.length, "new task authority");
  await f.request("/api/command", { type: "answerApproval", taskId: budget.taskId, approvalId: approval.approvals[0].approvalId, value: "本任务" });
  const bounded = await until(() => f.task(budget.taskId), terminal, "32 child budget");
  assert.equal(bounded.toolCalls.filter((call) => call.parentToolCallId).length, 32);
  assert.equal(bounded.toolCalls.find((call) => call.name === "codemode").status, "failed");
  assert.match(bounded.toolCalls.find((call) => call.name === "codemode").result, /CODEMODE_CALL_LIMIT/);
});

test("script parameters cannot enlarge the actual 60 second deadline", { timeout: 85000 }, async (t) => {
  const code = '// @options: {"timeout_ms":2147483647,"max_output_tokens":2147483647}\ntext("before bounded deadline"); while(true) {}';
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  t.after(() => f.close());
  const started = await f.start();
  const final = await until(() => f.task(started.taskId), terminal, "forced deadline", 75000);
  const parent = final.toolCalls.find((call) => call.name === "codemode");
  assert.equal(parent.status, "failed"); assert.match(parent.result, /CODEMODE_TIMEOUT[\s\S]*before bounded deadline/);
  assert.ok(parent.durationMs >= 59000 && parent.durationMs < 67000, String(parent.durationMs));
  assert.equal(final.approvals.length, 0);
});

test("the 17th parent script cannot renew the task execution budget", { timeout: 30000 }, async (t) => {
  const f = await createMcpHost({ respond: ({ body, res }) => providerReply(res, body.messages.filter((message) => message.role === "tool").length < 17 ? "codemode" : null, { code: 'text("bounded script");' }) });
  t.after(() => f.close());
  const started = await f.start(), final = await until(() => f.task(started.taskId), terminal, "script budget", 20000);
  assert.equal(final.toolCalls.filter((call) => call.name === "codemode").length, 17);
  assert.equal(final.toolCalls.slice(0, 16).filter((call) => call.status === "completed").length, 16);
  assert.equal(final.toolCalls.at(-1).status, "failed"); assert.match(final.toolCalls.at(-1).result, /CODEMODE_EXECUTION_LIMIT/);
  assert.equal(f.requests.length, 18);
});

test("actual CLI TUI uses the same native codemode and two independent approvals", { timeout: 45000 }, async (t) => {
  const code = 'text(await tools.read({path:"README.md"})); text(await tools.mcp__local__read_file({path:"README.md"}));';
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.some((message) => message.role === "tool") ? null : "codemode", { code }) });
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true } });
  let output = "", exited;
  const term = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 120, rows: 36 });
  term.onData((data) => { output += data; }); term.onExit((event) => { exited = event; });
  t.after(async () => { if (!exited) { term.kill("SIGTERM"); await until(() => exited, Boolean, "owned CLI exit"); } await f.close(); });
  await until(() => output, (value) => value.includes("Inspect") || exited, "TUI ready", 30000);
  assert.equal(exited, undefined, output); term.write("codemode CLI probe\r");
  await until(() => output, (value) => value.slice(value.indexOf("Codemode · read")).includes("本任务") || exited, "ordinary child UI options", 15000);
  assert.equal(exited, undefined, output); term.write("\x1b[B\r");
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.at(-1)?.calls[0]?.status === "awaiting_approval", "MCP child UI");
  await until(() => output, (value) => value.slice(value.lastIndexOf("MCP · local/read_file")).includes("本任务") || exited, "MCP child UI options", 15000);
  assert.equal((await mcpReception((await f.mcp({ type: "status" })).runs.at(-1))).filter((entry) => entry.type === "call").length, 0);
  term.write("\x1b[B\r");
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.at(-1).status === "stopped", "TUI actual completion");
  assert.equal((await mcpReception((await f.mcp({ type: "status" })).runs.at(-1))).filter((entry) => entry.type === "call").length, 1);
  assert.match(output, /temporary CLI project/);
  term.write("\x04"); await until(() => exited, Boolean, "normal CLI exit"); assert.equal(exited.exitCode, 0);
});
