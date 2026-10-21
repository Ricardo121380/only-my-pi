import test from "node:test";
import assert from "node:assert/strict";
import pty from "node-pty";
import { createMcpHost, until, providerReply, mcpReception } from "./fixtures/mcp-host.mjs";
import { installMcpLateInputGate } from "./fixtures/mcp-late-input.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";

test("a real Pi TUI input queued during agent_end retains MCP until native agent_settled and never restores an old grant", { timeout: 60000 }, async t => {
  const code = 'text(await tools.read({path:"README.md"})); text(await tools.mcp__local__read_file({path:"README.md"}));';
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => {
    const last = body.messages.findLastIndex(message => message.role === "user"), text = JSON.stringify(body.messages[last]?.content);
    const done = body.messages.slice(last + 1).some(message => message.role === "tool");
    providerReply(res, done ? null : text.includes("queued") ? "codemode" : "mcp__local__read_file", text.includes("queued") ? { code } : { path: "README.md" });
  } });
  let terminal, identity, output = "", exit, gate;
  t.after(async () => {
    const before = await f.mcp({ type: "status" });
    try {
      if (terminal && !exit) {
        terminal.write("\x1b"); terminal.write("\x04");
        try { await until(() => exit, Boolean, "queued fixture normal close", 2000); }
        catch {
          if (await processIdentity(terminal.pid) === identity) process.kill(-terminal.pid, "SIGKILL");
          for (const run of before.runs) for (const entry of run.processes) if (entry.pid && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL");
        }
      }
      if (terminal) await until(() => exit && !groupAlive(terminal.pid), Boolean, "queued TUI physical exit");
      await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01C_PUBLIC_HOOK_GATED_REAL_PI_TUI_NOT_STANDALONE_SETUP", instrumentation: "public agent_end gate and AgentSession queue getters",
        sdkOriginalSha256: gate?.sdkOriginalSha256, trace: await gate?.read(), runs: before, transcript: output, requests: f.requests.map(request => request.body), exit, groupGone: !terminal || !groupAlive(terminal.pid) });
    } finally { await f.close(); }
  });
  gate = await installMcpLateInputGate(f);
  await f.mcp({ type: "save", revision: 0, server: { ...f.server, enabled: true } });
  terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.cliEnv, cols: 160, rows: 50 });
  terminal.onData(value => { output += value; }); terminal.onExit(value => { exit = value; });
  await until(() => output, text => text.includes("[Extensions]") && text.includes("OMP · Inspect") || exit, "queued real Pi ready", 30000); assert.equal(exit, undefined, output);
  identity = await processIdentity(terminal.pid);
  terminal.write("first selected read\r");
  await until(() => output, text => text.includes("local/read_file") && text.includes("仅本次"), "initial MCP permission", 15000); terminal.write("\x1b[B\r");
  await until(gate.read, events => events.some(event => event.stage === "agent_end_gate"), "actual low-level agent_end gate");
  const offset = output.length; terminal.write("compose queued selected read\r");
  const queued = await until(gate.read, events => events.some(event => event.stage === "queued_input"), "actual native steering queue");
  assert.equal(queued.find(event => event.stage === "queued_input").isStreaming, true);
  await until(() => output.slice(offset), text => text.includes("Codemode · read") && text.includes("仅本次"), "queued ordinary child permission", 15000);
  const nestedOffset = output.length; terminal.write("\x1b[B\r");
  await until(() => output.slice(nestedOffset), text => text.includes("local/read_file") && text.includes("仅本次"), "queued MCP child permission", 15000);
  const pending = (await f.mcp({ type: "status" })).runs;
  assert.equal(pending.length, 1, "a native continuation keeps its original task snapshot and budget");
  assert.equal((await mcpReception(pending[0])).filter(entry => entry.type === "call").length, 1, "the first task permission does not grant the nested call");
  terminal.write("\x1b[B\r");
  await until(gate.read, events => events.some(event => event.stage === "agent_settled"), "actual native logical-run settlement");
  const final = (await f.mcp({ type: "status" })).runs;
  assert.equal(final.length, 1); assert.equal(final[0].status, "stopped"); assert.deepEqual(final[0].calls.map(call => call.status), ["completed", "completed"]);
  assert.ok(final[0].calls[1].parentToolCallId); assert.equal((await mcpReception(final[0])).filter(entry => entry.type === "call").length, 2);
  assert.equal((await gate.read()).filter(event => event.stage === "before_agent_start").length, 1);
  terminal.write("\x04"); await until(() => exit && !groupAlive(terminal.pid), Boolean, "queued TUI normal exit"); assert.equal(exit.exitCode, 0);
});
