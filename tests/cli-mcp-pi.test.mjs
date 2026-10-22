import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pty from "node-pty";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createHttpMcpServer } from "./fixtures/mcp-http-server.mjs";
import { createOAuthMcpServer } from "./fixtures/mcp-oauth-server.mjs";
import { until, providerReply, mcpReception } from "./fixtures/mcp-host.mjs";
import { McpRuns } from "../packages/mcp/runs.mjs";
import { groupAlive, processIdentity } from "../packages/host/ownership.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
const stdioReception = run => mcpReception({ ...run, processes: run.processes.filter(process => process.transport === "stdio") });

for (const auth of ["token", "oauth"]) test(`independent CLI/PTY and real Pi discover and authorize stdio, ${auth} HTTP and native codemode without a Host`, { timeout: 120000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-mcp-pi-")));
  const service = auth === "token" ? await createHttpMcpServer() : await createOAuthMcpServer();
  const key = "controlled-product-model-key", requests = [], sockets = new Set(), children = [], commands = [];
  const code = 'text(await tools.read({path:"README.md"})); text(await tools.mcp__local__read_file({path:"README.md"})); text(await tools.mcp__remote__echo({value:"composed CLI MCP"})); store("cli_mcp_checked",true);';
  const provider = http.createServer(async (req, res) => {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw), lastUser = body.messages.findLastIndex(message => message.role === "user");
    const prompt = JSON.stringify(body.messages[lastUser]?.content), steps = body.messages.slice(lastUser + 1).filter(message => message.role === "tool").length;
    requests.push({ body, validIdentity: req.headers.authorization === `Bearer ${key}` });
    if (prompt.includes("compose")) providerReply(res, steps ? null : "codemode", { code });
    else if (prompt.includes("stdio")) providerReply(res, steps ? null : "mcp__local__read_file", { path: "README.md" });
    else providerReply(res, steps === 0 ? "mcp_tool_search" : steps === 1 ? "mcp__remote__echo" : null, steps ? { value: "direct CLI MCP" } : { query: "echo" });
  });
  provider.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  let f, terminal, terminalIdentity, output = "", tuiExit, lastRun, turnOutput = 0;
  t.after(async () => {
    let confirmed = false;
    try {
      let failedFixture;
      try {
        if (terminal && !tuiExit) {
          // Failed assertions can leave a modal approval open. Preserve the
          // original run/transcript before fixture-only termination; never call
          // this a successful product cancellation or clean lifecycle receipt.
          const prior = await new McpRuns(f.config).status(f.project);
          failedFixture = { transcript: output, runs: prior, requests, received: service.received };
          terminal.write("\x1b"); terminal.write("\x04");
          try { await until(() => tuiExit && !groupAlive(terminal.pid), Boolean, "failed fixture normal exit", 2000); }
          catch {
            if (await processIdentity(terminal.pid) === terminalIdentity) process.kill(-terminal.pid, "SIGKILL");
            for (const run of prior.runs) for (const entry of run.processes) {
              if (entry.pid && await processIdentity(entry.pid) === entry.identity) process.kill(-entry.pid, "SIGKILL");
            }
          }
        }
        if (terminal) await until(() => tuiExit && !groupAlive(terminal.pid), Boolean, "real Pi PTY confirmed cleanup");
      } finally {
        const outcomes = await Promise.allSettled(children.map(record => {
          if (!record.exit) record.child.kill("SIGTERM");
          return until(() => record.exit, Boolean, "CLI authentication confirmed cleanup");
        }));
        const failures = outcomes.filter(outcome => outcome.status === "rejected");
        if (failures.length) throw new AggregateError(failures.map(outcome => outcome.reason), "CLI authentication cleanup failed");
      }
      if (failedFixture) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01C_FAILED_FIXTURE_BEFORE_CLEANUP", ...failedFixture });
      const runs = f ? await new McpRuns(f.config).status(f.project) : { runs: [] };
      if (f) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01C_STANDALONE_PI_PTY_LOCAL_ONLY", auth,
        bindings: f.bindings, commands, tui: { pid: terminal?.pid, exit: tuiExit, groupGone: !terminal || !groupAlive(terminal.pid) },
        requests, received: service.received, runs, transcript: output });
      confirmed = true;
    } finally {
      for (const socket of sockets) socket.destroy(); await new Promise(resolve => provider.close(resolve)); await service.close();
      if (confirmed) await fs.rm(root, { recursive: true });
    }
  });
  f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, installedExtensions: true, verifyNode: true });
  const originalAuth = await fs.readFile(path.join(f.config, "auth.json"));
  const start = (args, input = "") => {
    const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: f.cliEnv, stdio: ["pipe", "pipe", "pipe"] });
    const command = { args, pid: child.pid, exit: null };
    const record = { child, stdout: "", stderr: "", exit: null }; children.push(record); commands.push(command);
    child.stdout.on("data", bytes => { record.stdout += bytes; }); child.stderr.on("data", bytes => { record.stderr += bytes; });
    child.on("close", (exitCode, signal) => { record.exit = { code: exitCode, signal }; command.exit = record.exit; }); child.stdin.on("error", error => { if (error.code !== "EPIPE") throw error; }); child.stdin.end(input); return record;
  };
  const run = async (args, input) => {
    const record = start(args, input); await until(() => record.exit, Boolean, "independent CLI command");
    assert.equal(record.exit.code, 0, record.stderr); return JSON.parse(record.stdout);
  };
  const mcp = (args, input) => run(["mcp", ...args, "--project", f.project], input);
  const apply = async input => { const file = path.join(root, "action.json"); await fs.writeFile(file, JSON.stringify(input)); return mcp(["apply", file]); };
  // Model identity is also explicitly selected from the shared product store;
  // the original Pi auth file is neither imported nor changed.
  const account = await run(["account", "add", "--provider", "openrouter", "--name", `CLI MCP ${auth}`, "--auth", "api_key"]);
  const descriptor = path.join(root, "provider.json");
  await fs.writeFile(descriptor, JSON.stringify({ baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, api: "openai-completions", models: [{ id: "controlled", name: "Controlled MCP model", contextWindow: 32000, maxTokens: 512 }] }));
  await run(["account", "configure", account.accountId, descriptor]); await run(["account", "login", account.accountId, "--stdin"], `${key}\n`);
  const serverFile = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
  const local = { name: "local", transport: "stdio", command: process.execPath, args: [serverFile], codePaths: [serverFile], cwd: ".", env: { F_MODE: "readonly-sideeffect" }, credentialRefs: {},
    tools: [{ name: "read_file", effect: "read", pathArgument: "path", paths: ["README.md"] }], enabled: false };
  const remote = { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: {}, tools: [{ name: "echo", effect: "remote", exposure: "deferred" }], enabled: false };
  assert.equal((await mcp(["list"])).revision, 0);
  await apply({ type: "save", revision: 0, server: local }); await apply({ type: "save", revision: 1, server: remote });
  if (auth === "token") {
    let credentialOutput = "", credentialExit;
    const credential = pty.spawn(process.execPath, [f.cli, "mcp", "credential", "remote", "--project", f.project, "--revision", "2"], { cwd: f.project, env: f.cliEnv, cols: 140, rows: 40 });
    const record = { child: credential, exit: null }; children.push(record);
    credential.onData(bytes => { credentialOutput += bytes; }); credential.onExit(value => { credentialExit = value; record.exit = value; });
    await until(() => credentialOutput, text => text.includes("MCP credential (hidden"), "actual MCP secret PTY prompt");
    credential.write(`${service.token}\r`); await until(() => credentialExit, Boolean, "secret input terminal exit"); assert.equal(credentialExit.exitCode, 0);
    assert.equal(credentialOutput.includes(service.token), false); assert.equal(groupAlive(credential.pid), false);
  } else {
    const login = start(["mcp", "login", "remote", "--project", f.project, "--revision", "2"]);
    await until(() => login.stderr, text => text.includes("Open in your browser:") || login.exit, "actual independent MCP OAuth");
    assert.equal(login.exit, null, login.stderr);
    const url = /Open in your browser: (http:\/\/[^\s]+)/u.exec(login.stderr)?.[1]; assert.ok(url);
    const answer = await fetch(url, { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" }); assert.equal(answer.status, 303);
    assert.equal((await fetch(answer.headers.get("location"))).status, 200);
    await until(() => login.exit, Boolean, "independent OAuth completion"); assert.equal(login.exit.code, 0, login.stderr);
  }
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 0);
  assert.equal(requests.length, 0, "authentication grants no model or tool call");
  const credentialState = await mcp(["list"]); assert.equal(credentialState.revision, 3);
  assert.equal(credentialState.servers.every(server => !server.enabled), true);
  await mcp(["enable", "local", "--revision", "3"]); await mcp(["enable", "remote", "--revision", "4"]);
  const sessions = path.join(root, "sessions"); await fs.mkdir(sessions);
  terminal = pty.spawn(process.execPath, [f.cli, "--account", account.accountId, "--model", "openrouter/controlled", "--session-dir", sessions, "--tui-mode", "regular"],
    { cwd: f.project, env: f.cliEnv, cols: 160, rows: 50 });
  terminal.onData(bytes => { output += bytes; }); terminal.onExit(value => { tuiExit = value; });
  await until(() => output, text => text.includes("[Extensions]") && text.includes("OMP · Inspect") || tuiExit, "real product-account Pi ready", 30000);
  assert.equal(tuiExit, undefined, output);
  terminalIdentity = await processIdentity(terminal.pid); // Pin after the real CLI execve handshake.
  const approval = async (title, offset) => {
    await until(() => output.slice(offset), text => text.includes(title) && text.includes("仅本次"), `rendered approval ${title}`, 15000);
    const next = output.length; terminal.write("\x1b[B\r"); return next;
  };
  const send = prompt => { turnOutput = output.length; terminal.write(`${prompt}\r`); return turnOutput; };
  const stopped = async () => {
    const runs = await until(() => new McpRuns(f.config).status(f.project), state => state.runs.at(-1)?.runId !== lastRun && state.runs.at(-1)?.status === "stopped"
      && state.runs.at(-1).calls.every(call => !["checking", "awaiting_approval", "dispatched"].includes(call.status)), "MCP task physical stop");
    // Pi's incremental renderer need not redraw an unchanged footer. The MCP
    // run now stops at agent_settled; also observe this turn's completed output.
    await until(() => output.slice(turnOutput), text => text.includes("MCP fixture completed"), "Pi completed turn output");
    lastRun = runs.runs.at(-1).runId; return runs.runs.at(-1);
  };
  let offset = send("stdio direct CLI probe");
  await until(() => output.slice(offset), text => text.includes("local/read_file") && text.includes("仅本次"), "stdio explicit approval", 15000);
  let status = (await mcp(["status"])).runs.at(-1);
  assert.equal((await stdioReception(status)).filter(entry => entry.type === "call").length, 0);
  await approval("local/read_file", offset); const first = await stopped();
  assert.equal(first.calls[0].status, "completed"); assert.equal((await stdioReception(first)).filter(entry => entry.type === "call").length, 1);
  assert.equal(first.discoveries.find(entry => entry.server === "remote").tools[0].active, true);
  assert.equal(first.discoveries.find(entry => entry.server === "remote").tools[0].exposure, "deferred");
  assert.equal(requests[0].body.tools.some(tool => tool.function.name === "mcp__remote__echo"), false, "discovery does not imply direct declaration");
  const directStart = requests.length; offset = send("HTTP direct CLI probe");
  await until(() => output.slice(offset), text => text.includes("remote/echo") && text.includes("仅本次"), "HTTP explicit approval", 15000);
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 0);
  await approval("remote/echo", offset); const second = await stopped(); assert.equal(second.calls[0].status, "completed");
  assert.equal(requests[directStart].body.tools.some(tool => tool.function.name === "mcp__remote__echo"), false);
  assert.equal(requests[directStart + 1].body.tools.some(tool => tool.function.name === "mcp__remote__echo"), true, "explicit native tool search loads the declared tool");
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 1);
  offset = send("compose CLI MCP probe");
  offset = await approval("Codemode · read", offset); offset = await approval("local/read_file", offset);
  await until(() => output.slice(offset), text => text.includes("remote/echo") && text.includes("仅本次"), "nested HTTP has its own approval", 15000);
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 1, "ordinary/stdio child approvals do not authorize HTTP");
  await approval("remote/echo", offset); const composed = await stopped();
  assert.deepEqual(composed.calls.map(call => call.status), ["completed", "completed"]);
  assert.ok(composed.calls.every(call => call.parentToolCallId && call.parentToolCallId === composed.calls[0].parentToolCallId));
  assert.equal((await stdioReception(composed)).filter(entry => entry.type === "call").length, 1);
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 2);
  let revision = 5, completedCalls = 2;
  if (auth === "token") {
    const replacement = await createHttpMcpServer({ token: "controlled-replacement-identity" }); t.after(() => replacement.close());
    offset = send("HTTP snapshot CLI probe");
    await until(() => output.slice(offset), text => text.includes("remote/echo") && text.includes("仅本次"), "snapshot approval", 15000);
    const captured = (await mcp(["status"])).runs.at(-1);
    revision = (await apply({ type: "save", revision, server: { ...remote, url: replacement.url, enabled: true } })).revision;
    await approval("remote/echo", offset); const frozen = await stopped();
    assert.equal(frozen.revision, captured.revision); assert.equal(frozen.calls[0].targetDigest, captured.calls[0].targetDigest);
    assert.equal(frozen.calls[0].status, "completed"); assert.equal(replacement.received.length, 0);
    completedCalls++;
    assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, completedCalls, "the active task keeps its captured target and identity");
    revision = (await apply({ type: "save", revision, server: { ...remote, enabled: true,
      credentialRefs: credentialState.servers.find(server => server.name === "remote").credentialRefs } })).revision;
  }
  // A second actual CLI process revokes the selected credential while the
  // original Pi is waiting for approval. Old grants cannot authorize dispatch.
  offset = send("HTTP revoked CLI probe");
  await until(() => output.slice(offset), text => text.includes("remote/echo") && text.includes("仅本次"), "approval before independent revocation", 15000);
  revision = (await mcp(["logout", "remote", "--revision", String(revision)])).revision; await approval("remote/echo", offset);
  const revoked = await stopped(); assert.equal(revoked.calls[0].status, "rejected");
  assert.match(revoked.calls[0].code, /REVOKED|BINDING/);
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, completedCalls);
  if (auth === "token") {
    revision = (await mcp(["credential", "remote", "--revision", String(revision), "--stdin"], `${service.token}\n`)).revision;
    service.setMode("disconnect");
    offset = send("HTTP unknown CLI probe");
    await approval("remote/echo", offset); const unknown = await stopped();
    assert.equal(unknown.calls[0].status, "unknown"); assert.equal(unknown.revision, revision); completedCalls++;
    assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, completedCalls);
    send("HTTP no replay CLI probe"); const refused = await stopped();
    assert.equal(refused.calls[0].status, "rejected"); assert.equal(refused.calls[0].code, "MCP_REMOTE_RECONCILIATION_REQUIRED");
    assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, completedCalls, "the next task cannot replay an unknown business request");
  }
  terminal.write("\x04"); await until(() => tuiExit && !groupAlive(terminal.pid), Boolean, "Pi normal exit and group gone"); assert.equal(tuiExit.exitCode, 0);
  const all = await mcp(["status"]); assert.equal(all.runs.every(run => run.status === "stopped" && run.processes.every(process => !process.alive)), true);
  for (const run of all.runs) for (const receipt of await stdioReception(run)) {
    if (["startup-write", "tool-write"].includes(receipt.type)) assert.match(receipt.code, /EPERM|EACCES/);
  }
  assert.equal(requests.every(request => request.validIdentity && request.body.model === "controlled"), true);
  assert.equal(await fs.readFile(path.join(f.project, "README.md"), "utf8"), "temporary CLI project\n");
  assert.deepEqual(await fs.readFile(path.join(f.config, "auth.json")), originalAuth);
  const historyFile = (await fs.readdir(sessions)).find(name => name.endsWith(".jsonl")); assert.ok(historyFile);
  const history = await fs.readFile(path.join(sessions, historyFile), "utf8"); assert.match(history, /codemode-store/); assert.match(history, /cli_mcp_checked/); assert.ok(history.includes(account.accountId));
  const publicState = JSON.stringify([all, requests.map(request => request.body), history, output]);
  for (const secret of [key, ...(auth === "token" ? [service.token] : service.privateValues)]) assert.equal(publicState.includes(secret), false);
});
