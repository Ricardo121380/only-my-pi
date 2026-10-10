import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pty from "node-pty";
import { createMcpHost, until, providerReply } from "./fixtures/mcp-host.mjs";
import { createHttpMcpServer } from "./fixtures/mcp-http-server.mjs";
const exec = promisify(execFile);

test("real CLI and Pi TUI configure an HTTP reference, approve the bound remote input and receive one authenticated result", { timeout: 60000 }, async (t) => {
  const service = await createHttpMcpServer(); t.after(() => service.close());
  const f = await createMcpHost({ installedExtensions: true, respond: ({ body, res }) => providerReply(res, body.messages.at(-1).role === "tool" ? null : "mcp__remote__echo", { value: "TUI approved input" }) });
  t.after(() => f.close());
  const action = path.join(f.root, "action.json");
  const runCli = async (args) => JSON.parse((await exec(process.execPath, [f.cli, "admin", "mcp", ...args, "--project", f.project], { env: f.env, cwd: f.project, timeout: 20000 })).stdout);
  const apply = async (input) => { await fs.writeFile(action, JSON.stringify(input)); return runCli(["apply", action]); };
  const server = { name: "remote", transport: "streamable-http", url: service.url, tools: [{ name: "echo", effect: "remote" }], credentialRefs: {}, enabled: false };
  assert.equal((await apply({ type: "save", revision: 0, server })).revision, 1);
  // The existing CLI forbids secret-bearing action files. Bind the credential
  // through the authenticated Host, then read its opaque reference in CLI/TUI.
  const state = await f.mcp({ type: "credential", revision: 1, name: "remote", envName: "MCP_TOKEN", value: service.token });
  assert.equal(state.revision, 2); assert.ok(!JSON.stringify(state).includes(service.token)); assert.equal(service.received.length, 0);
  assert.deepEqual((await runCli(["list"])).servers[0].credentialRefs, state.servers[0].credentialRefs);
  await fs.writeFile(action, JSON.stringify({ type: "enable", revision: 2, name: "remote", enabled: true }));
  let output = "", exited;
  const terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.env, cols: 120, rows: 36 });
  terminal.onData((data) => { output += data; }); terminal.onExit((exit) => { exited = exit; });
  t.after(async () => { if (!exited) { terminal.kill("SIGTERM"); await until(() => exited, Boolean, "HTTP TUI owned exit"); } });
  await until(() => output, (text) => text.includes("Inspect") || exited, "HTTP TUI ready", 30000); assert.equal(exited, undefined, output);
  terminal.write(`/mcp apply ${action}\r`); await until(() => output, (text) => text.includes("保存 MCP 配置"), "HTTP TUI config confirmation"); terminal.write("\r");
  await until(() => f.mcp({ type: "list" }), (value) => value.revision === 3, "HTTP TUI enabled"); assert.equal(service.received.length, 0);
  terminal.write("HTTP MCP remote probe\r"); await until(() => output, (text) => text.includes("仅本次"), "HTTP TUI tool decision");
  assert.match(output, /远程操作/u); assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 0);
  terminal.write("\x1b[B\r"); await until(() => f.requests.length, (count) => count === 2, "HTTP TUI model result");
  assert.match(JSON.stringify(f.requests[1].body.messages), /remote result: TUI approved input/u);
  await until(() => f.mcp({ type: "status" }), (value) => value.runs.at(-1)?.status === "stopped", "HTTP TUI stopped");
  terminal.write("\x04"); await until(() => exited, Boolean, "HTTP TUI exit"); assert.equal(exited.exitCode, 0);
  const runs = await runCli(["status"]); assert.equal(runs.runs[0].calls[0].status, "completed");
  assert.equal(service.received.filter((entry) => entry.rpc === "tools/call").length, 1);
  assert.ok(service.received.every((entry) => entry.path === "/mcp" && entry.identity));
  assert.ok(!JSON.stringify([runs, f.requests.map((entry) => entry.body), output]).includes(service.token));
});
