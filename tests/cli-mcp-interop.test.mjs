import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createOAuthMcpServer } from "./fixtures/mcp-oauth-server.mjs";
import { until, providerReply } from "./fixtures/mcp-host.mjs";
import { McpRuns } from "../packages/mcp/runs.mjs";
import { processIdentity, groupAlive } from "../packages/host/ownership.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";

// This proves the production GUI's authenticated Host API and another actual
// CLI process interoperate. Actual page interaction remains separate Ego B.
test("a separate Host creates an OAuth connection used by real CLI Pi and revocation and stale writes coordinate across processes", { timeout: 60000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-mcp-interop-")));
  const service = await createOAuthMcpServer(), requests = [], sockets = new Set(), children = [];
  const provider = http.createServer(async (req, res) => {
    let raw = ""; for await (const bytes of req) raw += bytes;
    const body = JSON.parse(raw), lastUser = body.messages.findLastIndex(message => message.role === "user");
    requests.push({ body, validIdentity: req.headers.authorization === "Bearer fixture-cli" });
    providerReply(res, body.messages.slice(lastUser + 1).some(message => message.role === "tool") ? null : "mcp__gui__echo", { value: "shared Host connection" });
  });
  provider.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  let f, host, terminal, terminalIdentity, output = "", exited, finalState;
  t.after(async () => {
    let confirmed = false;
    try {
      try {
        if (terminal && !exited && await processIdentity(terminal.pid) === terminalIdentity) {
          terminal.write("\x1b"); terminal.write("\x04");
          try { await until(() => exited, Boolean, "failed interop TUI normal exit", 2000); }
          catch { if (await processIdentity(terminal.pid) === terminalIdentity) process.kill(-terminal.pid, "SIGKILL"); }
        }
        if (terminal) await until(() => exited && !groupAlive(terminal.pid), Boolean, "interop TUI confirmed exit");
      } finally {
        if (host && !host.exit) host.child.send("stop");
        const outcomes = await Promise.allSettled(children.map(record => {
          if (!record.exit && record !== host) record.child.kill("SIGTERM");
          return until(() => record.exit, Boolean, "interop child exit");
        }));
        const failures = outcomes.filter(outcome => outcome.status === "rejected");
        if (failures.length) throw new AggregateError(failures.map(outcome => outcome.reason), "interop child cleanup failed");
      }
      if (f) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01C_HOST_API_CLI_REAL_PROCESS_INTEROP_NOT_BROWSER", requests, received: service.received,
        finalState, runs: await new McpRuns(f.config).status(f.project), terminal: { pid: terminal?.pid, exit: exited, groupGone: !terminal || !groupAlive(terminal.pid) },
        children: children.map(({ child, ...record }) => ({ ...record, pid: child.pid })), transcript: output });
      confirmed = true;
    } finally {
      for (const socket of sockets) socket.destroy(); await new Promise(resolve => provider.close(resolve)); await service.close();
      if (confirmed) await fs.rm(root, { recursive: true });
    }
  });
  f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, installedExtensions: true });
  const track = (child, args) => {
    const record = { child, args, stdout: "", stderr: "", exit: null }; children.push(record);
    child.stdout.on("data", value => { record.stdout += value; }); child.stderr.on("data", value => { record.stderr += value; });
    child.once("close", (code, signal) => { record.exit = { code, signal }; }); return record;
  };
  const cli = async (args, expected = 0) => {
    const record = track(spawn(process.execPath, [f.cli, "mcp", ...args, "--project", f.project], { cwd: f.project, env: f.cliEnv, stdio: ["ignore", "pipe", "pipe"] }), args);
    await until(() => record.exit, Boolean, "interop CLI result"); assert.equal(record.exit.code, expected, record.stderr);
    return expected ? record : JSON.parse(record.stdout);
  };
  const assets = path.join(root, "assets"); await fs.mkdir(assets); await fs.writeFile(path.join(assets, "index.html"), "<!doctype html><title>Host API fixture</title>");
  host = track(fork(fileURLToPath(new URL("./fixtures/mcp-client-host.mjs", import.meta.url)), [f.config, f.stack, assets],
    { execPath: process.execPath, execArgv: [], env: f.cliEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] }), ["production Host"]);
  const ready = await new Promise((resolve, reject) => { host.child.once("message", resolve); host.child.once("error", reject); host.child.once("exit", () => reject(new Error(host.stderr))); });
  const pair = await fetch(`${ready.origin}/pair`, { method: "POST", headers: { Origin: ready.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(ready.pairingUrl).hash.slice(6) }) });
  assert.equal(pair.status, 200); const cookie = pair.headers.get("set-cookie").split(";")[0];
  const request = async (route, input, expected = 200) => {
    const response = await fetch(ready.origin + route, { method: "POST", headers: { Origin: ready.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-mcp-protocol": "1" }, body: JSON.stringify(input) });
    assert.equal(response.status, expected, JSON.stringify(await response.clone().json())); return response.json();
  };
  const project = await request("/api/command", { type: "addProject", path: f.project });
  const mcp = (input, expected) => request("/api/mcp", { ...input, projectId: project.projectId }, expected);
  await mcp({ type: "save", revision: 0, server: { name: "gui", transport: "streamable-http", url: service.url, enabled: false, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }] } });
  const flow = await mcp({ type: "oauthStart", name: "gui", revision: 1 });
  const open = await fetch(`${ready.origin}/api/mcp-oauth/open?flowId=${flow.flowId}`, { headers: { Origin: ready.origin, Cookie: cookie }, redirect: "manual" }); assert.equal(open.status, 303);
  const answer = await fetch(open.headers.get("location"), { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" }); assert.equal(answer.status, 303);
  assert.equal((await fetch(answer.headers.get("location"))).status, 200);
  const stored = await until(() => mcp({ type: "oauthStatus", flowId: flow.flowId }), value => value.status === "stored", "Host-created native identity");
  const initial = await cli(["list"]); assert.equal(initial.authentication.gui.ref, stored.ref); assert.equal(initial.revision, 2);
  assert.equal(initial.servers[0].enabled, false); assert.equal(requests.length, 0); assert.equal(service.received.filter(entry => entry.type === "mcp").length, 0);
  const enabled = await mcp({ type: "enable", name: "gui", enabled: true, revision: 2 });
  const stale = await cli(["disable", "gui", "--revision", "2"], 1); assert.match(stale.stderr, /MCP_REVISION_CONFLICT/);
  assert.deepEqual((await cli(["list"])).servers, enabled.servers);
  terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one", "--no-session", "--tui-mode", "regular"], { cwd: f.project, env: f.cliEnv, cols: 160, rows: 50 });
  terminal.onData(value => { output += value; }); terminal.onExit(value => { exited = value; });
  await until(() => output, text => text.includes("[Extensions]") && text.includes("OMP · Inspect") || exited, "interop actual Pi ready", 30000); assert.equal(exited, undefined, output);
  terminalIdentity = await processIdentity(terminal.pid);
  let offset = output.length; terminal.write("use the Host-created connection\r");
  await until(() => output.slice(offset), text => text.includes("gui/echo") && text.includes("仅本次"), "CLI use of Host identity approval", 15000);
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 0); terminal.write("\x1b[B\r");
  await until(() => new McpRuns(f.config).status(f.project), state => state.runs.at(-1)?.status === "stopped", "shared identity task stopped");
  assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 1);
  offset = output.length; terminal.write("wait for shared connection revocation\r");
  await until(() => output.slice(offset), text => text.includes("gui/echo") && text.includes("仅本次"), "second task requires a fresh permission", 15000);
  finalState = await mcp({ type: "revokeCredential", name: "gui", envName: "MCP_TOKEN", revision: 3 }); assert.equal(finalState.revision, 4);
  assert.equal((await cli(["auth-status", "gui"])).state, "revoked"); terminal.write("\x1b[B\r");
  const final = await until(() => new McpRuns(f.config).status(f.project), state => state.runs.length === 2 && state.runs.at(-1).status === "stopped" && state.runs.at(-1).calls[0]?.status === "rejected", "Host revocation blocks CLI dispatch");
  assert.equal(final.runs.at(-1).revision, 3); assert.equal(service.received.filter(entry => entry.rpc === "tools/call").length, 1);
  await mcp({ type: "enable", name: "gui", enabled: false, revision: 3 }, 409);
  assert.equal((await cli(["list"])).revision, 4);
  terminal.write("\x04"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "interop actual Pi normal exit"); assert.equal(exited.exitCode, 0);
  assert.ok(requests.every(request => request.validIdentity)); assert.ok(service.received.filter(entry => entry.rpc === "tools/call").every(entry => entry.valid));
  for (const secret of service.privateValues) assert.equal(JSON.stringify([output, finalState, requests.map(request => request.body), final]).includes(secret), false);
  host.child.send("stop"); await until(() => host.exit, Boolean, "separate Host physical exit"); assert.equal(host.exit.code, 0, host.stderr); assert.equal(await processIdentity(host.child.pid), null);
});
