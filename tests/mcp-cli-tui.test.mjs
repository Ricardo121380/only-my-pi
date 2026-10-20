import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pty from "node-pty";
import { createMcpHost, until, mcpReception, providerReply } from "./fixtures/mcp-host.mjs";
const exec = promisify(execFile);

test("public CLI and real Pi TUI configure, enable, approve and read the same OMP project store", { timeout: 60000 }, async (t) => {
  const f = await createMcpHost({ installedExtensions: process.env.OMP_PI110_INSTALLED_EXTENSIONS === "1", respond: ({ body, res }) => {
    const last = body.messages.at(-1); providerReply(res, last.role === "tool" ? null : "mcp__local__read_file", { path: JSON.stringify(last).includes("second read") ? "ALT.md" : "README.md" });
  } });
  const action = path.join(f.root, "action.json"); await fs.writeFile(action, JSON.stringify({ type: "save", revision: 0, server: f.server }));
  const runCli = async (args) => JSON.parse((await exec(process.execPath, [f.cli, "admin", "mcp", ...args, "--project", f.project], { env: f.env, cwd: f.project })).stdout);
  assert.equal((await runCli(["apply", action])).revision, 1);
  assert.equal((await runCli(["status"])).runs.length, 0);
  await fs.writeFile(action, JSON.stringify({ type: "enable", revision: 1, name: "local", enabled: true }));
  let output = "", exited;
  const terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 120, rows: 36 });
  terminal.onData((data) => { output += data; }); terminal.onExit((exit) => { exited = exit; }); t.after(async () => {
    try {
      if (!exited) {
        terminal.kill("SIGTERM");
        try { await until(() => exited, Boolean, "owned TUI fixture exit"); }
        catch (error) { terminal.kill("SIGKILL"); await until(() => exited, Boolean, "owned failed TUI fixture exit"); throw error; }
      }
    } finally { await f.close(); }
  });
  await until(() => output, (text) => text.includes("Inspect") || exited, "TUI start", 30000);
  assert.equal(exited, undefined, output);
  terminal.write(`/mcp apply ${action}\r`);
  await until(() => output, (text) => text.includes("保存 MCP 配置"), "TUI config confirmation");
  terminal.write("\r");
  await until(() => f.mcp({ type: "list" }), (state) => state.revision === 2, "TUI config persisted");
  // A new user request, within the same TUI session, captures the new revision.
  terminal.write("MCP read probe\r"); await until(() => output, (text) => text.includes("仅本次"), "TUI per-call approval");
  let runs = await f.mcp({ type: "status" }); const run = runs.runs.at(-1), ledger = path.join(run.processes[0].runtimeDir, "received.jsonl");
  assert.equal((await fs.readFile(ledger, "utf8")).split("\n").filter((line) => line.includes('"type":"call"')).length, 0);
  // Explicitly move from the default refusal to allow once.
  terminal.write("\x1b[B\r");
  await until(() => f.requests.length, (count) => count === 2, "TUI tool response");
  assert.match(JSON.stringify(f.requests[1].body.messages), /temporary CLI project/);
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.at(-1).status === "stopped", "first TUI task stopped");
  await fs.writeFile(path.join(f.project, "ALT.md"), "MCP second revision result");
  await f.mcp({ type: "save", revision: 2, server: { ...f.server, enabled: true, env: { F_MODE: "second" }, tools: [{ ...f.server.tools[0], paths: ["ALT.md"] }] } });
  const nextTurnOutput = output.length; terminal.write("MCP second read probe\r");
  await until(() => f.mcp({ type: "status" }), (state) => state.runs.length === 2 && state.runs.at(-1).calls[0]?.status === "awaiting_approval", "same-session new revision approval");
  await until(() => output.slice(nextTurnOutput), text => text.includes("仅本次") && text.includes("ALT.md"), "second TUI approval rendered");
  terminal.write("\x1b[B\r");
  await until(() => f.requests.length, (count) => count === 4, "second TUI response");
  assert.match(JSON.stringify(f.requests[3].body.messages), /MCP second revision result/);
  await until(() => f.mcp({ type: "status" }), state => state.runs.at(-1).status === "stopped", "second TUI task stopped");
  terminal.write("\x04"); await until(() => exited, Boolean, "TUI exit"); assert.equal(exited.exitCode, 0);
  runs = await runCli(["status"]); assert.ok(runs.runs.every((run) => run.status === "stopped"));
  assert.deepEqual(runs.runs.map((run) => run.revision), [2, 3]); assert.notEqual(runs.runs[0].taskId, runs.runs[1].taskId);
  assert.notEqual(runs.runs[0].calls[0].targetDigest, runs.runs[1].calls[0].targetDigest);
  for (const run of runs.runs) assert.equal((await mcpReception(run)).filter((entry) => entry.type === "call").length, 1);
});
