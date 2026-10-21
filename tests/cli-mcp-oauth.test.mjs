import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, fork, execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { createOAuthMcpServer } from "./fixtures/mcp-oauth-server.mjs";
import { until } from "./fixtures/mcp-host.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { groupAlive } from "../packages/host/ownership.mjs";

const execFile = promisify(execFileCallback);
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-cli-mcp-oauth-")));
  const service = await createOAuthMcpServer();
  const children = [];
  let f;
  t.after(async () => {
    try {
      for (const record of children) if (!record.exit) record.child.kill("SIGTERM");
      for (const record of children) await until(() => record.exit, Boolean, "OAuth/Host process cleanup");
      if (f) await writePiEvidence(t.name, { sdk: f.sdk, scope: "CLIENT-01C_NATIVE_OAUTH_REAL_PROCESSES",
        received: service.received, commands: children.map(({ child, ...record }) => ({ ...record, pid: child.pid,
          stderr: record.stderr.replace(/Open in your browser: [^\r\n]+/gu, "Open in your browser: [private interaction omitted]") })) });
    } finally { await service.close(); await fs.rm(root, { recursive: true }); }
  });
  f = await createPi110SourceCli(root, { baseUrl: "http://127.0.0.1:1/v1" });
  const run = async args => JSON.parse((await execFile(process.execPath, [f.cli, "mcp", ...args, "--project", f.project], { cwd: f.project, env: f.cliEnv })).stdout);
  const action = path.join(root, "action.json");
  await fs.writeFile(action, JSON.stringify({ type: "save", revision: 0, server: { name: "remote", transport: "streamable-http", url: service.url, credentialRefs: {}, tools: [{ name: "echo", effect: "remote" }], enabled: false } }));
  assert.equal((await run(["apply", action])).revision, 1);
  const track = child => {
    const record = { child, stdout: "", stderr: "", exit: null }; children.push(record);
    child.stdout.on("data", value => { record.stdout += value; }); child.stderr.on("data", value => { record.stderr += value; });
    child.on("close", (code, signal) => { record.exit = { code, signal }; }); return record;
  };
  const terminal = args => {
    const child = pty.spawn(process.execPath, [f.cli, "mcp", ...args, "--project", f.project], { cwd: f.project, env: f.cliEnv, cols: 140, rows: 40 });
    const record = { child, stdout: "", stderr: "", exit: null }; children.push(record);
    child.onData(value => { record.stderr += value; }); child.onExit(({ exitCode, signal }) => { record.exit = { code: exitCode, signal }; });
    return record;
  };
  return { ...f, root, service, run, track, terminal, login: (revision = 1, extra = []) => track(spawn(process.execPath,
    [f.cli, "mcp", "login", "remote", "--project", f.project, "--revision", String(revision), ...extra],
    { cwd: f.project, env: f.cliEnv, stdio: ["ignore", "pipe", "pipe"] })) };
}
async function authorizationUrl(record) {
  await until(() => record.stderr, value => value.includes("Open in your browser:") || record.exit, "standalone OAuth authorization URL");
  assert.equal(record.exit, null, record.stderr);
  const url = /Open in your browser: (http:\/\/[^\s]+)/.exec(record.stderr)?.[1]; assert.ok(url); return url;
}
async function authorize(url) {
  const authorization = await fetch(url, { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" });
  assert.equal(authorization.status, 303);
  const callback = authorization.headers.get("location"); assert.equal((await fetch(callback)).status, 200);
  return callback;
}

test("standalone CLI performs native MCP OAuth and exits after publishing the same private target-bound identity", { timeout: 45000 }, async t => {
  const f = await fixture(t), record = f.login(), callback = await authorize(await authorizationUrl(record));
  await until(() => record.exit, Boolean, "native OAuth CLI exit"); assert.deepEqual(record.exit, { code: 0, signal: null });
  const flow = JSON.parse(record.stdout), state = await f.run(["list"]);
  assert.equal(flow.status, "stored"); assert.equal(state.authentication.remote.state, "connected");
  assert.equal(state.authentication.remote.ref, flow.ref); assert.equal(state.servers[0].enabled, false);
  assert.equal(f.service.received.filter(entry => entry.type === "token").length, 1);
  assert.equal(f.service.received.filter(entry => entry.type === "mcp").length, 0);
  assert.deepEqual((await f.run(["status"])).runs, []);
  for (const secret of f.service.privateValues) assert.equal(JSON.stringify([record.stdout, state]).includes(secret), false);
  await assert.rejects(fetch(callback), "the exited CLI cannot leave a callback listener behind");
});

test("real CLI PTY cancellation, invalid callbacks, timeout and crash recovery cannot publish or replay OAuth", { timeout: 60000 }, async t => {
  const f = await fixture(t);
  const cancelled = f.terminal(["login", "remote", "--revision", "1"]), lateUrl = await authorizationUrl(cancelled);
  cancelled.child.write("\x03"); await until(() => cancelled.exit, Boolean, "PTY Ctrl+C callback close");
  assert.equal(cancelled.exit.code, 1); assert.equal(groupAlive(cancelled.child.pid), false);
  assert.match(cancelled.stderr, /"status":\s*"cancelled"/u);
  const late = await fetch(lateUrl, { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" });
  await assert.rejects(fetch(late.headers.get("location")));
  f.service.setMode("bad_state");
  const wrong = f.login(), wrongUrl = await authorizationUrl(wrong);
  const answer = await fetch(wrongUrl, { method: "POST", body: new URLSearchParams({ decision: "allow" }), redirect: "manual" });
  assert.equal((await fetch(answer.headers.get("location"))).status, 400);
  assert.equal((await fetch(answer.headers.get("location"))).status, 400);
  assert.equal((await f.run(["list"])).authentication.remote.flow.status, "waiting");
  wrong.child.kill("SIGINT"); await until(() => wrong.exit, Boolean, "invalid callback explicit cancel"); assert.equal(wrong.exit.code, 1);
  f.service.setMode("normal");
  const timeout = f.login(1, ["--timeout-ms", "250"]); await until(() => timeout.exit, Boolean, "finite native callback timeout");
  assert.equal(timeout.exit.code, 1); assert.equal(JSON.parse(timeout.stdout).status, "timed_out");
  const crashed = f.login(), crashUrl = await authorizationUrl(crashed);
  const oldFlow = (await f.run(["list"])).authentication.remote.flow.flowId;
  crashed.child.kill("SIGKILL"); await until(() => crashed.exit, Boolean, "actual OAuth owner crash"); assert.equal(crashed.exit.signal, "SIGKILL");
  await assert.rejects(fetch(new URL(crashUrl).searchParams.get("redirect_uri")));
  const recovered = await f.run(["auth-status", "remote"]);
  assert.equal(recovered.state, "not_connected"); assert.equal(recovered.flow.status, "interrupted"); assert.equal(recovered.flow.flowId, oldFlow);
  assert.equal(f.service.received.filter(entry => ["token", "mcp"].includes(entry.type)).length, 0);
  const fresh = f.login(), callback = await authorize(await authorizationUrl(fresh));
  await until(() => fresh.exit, Boolean, "fresh explicit login after crash"); assert.equal(fresh.exit.code, 0, fresh.stderr);
  assert.notEqual(JSON.parse(fresh.stdout).flowId, oldFlow);
  await assert.rejects(fetch(callback));
  assert.equal(f.service.received.filter(entry => entry.type === "token").length, 1);
  const refreshed = await f.run(["refresh", "remote", "--revision", "2"]);
  assert.equal(refreshed.status, "stored"); assert.notEqual(refreshed.ref, JSON.parse(fresh.stdout).ref);
  assert.equal(f.service.received.filter(entry => entry.type === "token" && entry.kind === "refresh_token").length, 1);
  const revoked = await f.run(["logout", "remote", "--revision", "3"]); assert.equal(revoked.authentication.remote.state, "revoked");
  assert.equal(f.service.received.filter(entry => entry.type === "mcp").length, 0);
});

test("a second CLI target change rejects an old callback before token exchange and never borrows the replacement identity", { timeout: 30000 }, async t => {
  const f = await fixture(t), other = await createOAuthMcpServer(); t.after(() => other.close());
  const login = f.login(), url = await authorizationUrl(login), action = path.join(f.root, "changed.json");
  await fs.writeFile(action, JSON.stringify({ type: "save", revision: 1, server: { name: "remote", transport: "streamable-http", url: other.url, credentialRefs: {}, tools: [], enabled: false } }));
  assert.equal((await f.run(["apply", action])).revision, 2);
  await authorize(url); await until(() => login.exit, Boolean, "old target callback rejected");
  assert.equal(login.exit.code, 1); assert.equal(JSON.parse(login.stdout).status, "failed"); assert.match(JSON.parse(login.stdout).code, /CONFLICT|BINDING/);
  assert.equal(f.service.received.filter(entry => entry.type === "token").length, 0); assert.equal(other.received.length, 0);
  const state = await f.run(["list"]); assert.equal(state.servers[0].url, other.url); assert.equal(state.authentication.remote.state, "not_connected");
});

test("a real Host startup preserves a live standalone OAuth owner and competing CLI login cannot overwrite its flow", { timeout: 45000 }, async t => {
  const f = await fixture(t), login = f.login(), url = await authorizationUrl(login);
  const before = (await f.run(["list"])).authentication.remote.flow;
  assert.equal(before.status, "waiting");
  const assets = path.join(f.root, "assets"); await fs.mkdir(assets); await fs.writeFile(path.join(assets, "index.html"), "<!doctype html><title>controlled Host</title>");
  const host = f.track(fork(fileURLToPath(new URL("./fixtures/mcp-client-host.mjs", import.meta.url)), [f.config, f.stack, assets],
    { execPath: process.execPath, execArgv: [], env: f.cliEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] }));
  const ready = await new Promise((resolve, reject) => { host.child.once("message", resolve); host.child.once("error", reject); host.child.once("exit", () => reject(new Error(host.stderr))); });
  const after = (await f.run(["list"])).authentication.remote.flow;
  assert.equal(after.status, "waiting", "Host recovery must not interrupt another live process's callback listener");
  assert.equal(after.flowId, before.flowId);
  const competing = f.login(); await until(() => competing.exit, Boolean, "competing OAuth CLI rejection");
  assert.equal(competing.exit.code, 1); assert.match(competing.stderr, /MCP_OAUTH_BUSY/);
  assert.equal(f.service.received.filter(entry => entry.type === "registration").length, 1);
  assert.equal((await f.run(["list"])).authentication.remote.flow.flowId, before.flowId);
  const pair = await fetch(`${ready.origin}/pair`, { method: "POST", headers: { Origin: ready.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(ready.pairingUrl).hash.slice(6) }) });
  assert.equal(pair.status, 200); const cookie = pair.headers.get("set-cookie").split(";")[0];
  const request = async input => {
    const response = await fetch(`${ready.origin}/api/command`, { method: "POST", headers: { Origin: ready.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2" }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); return response.json();
  };
  const project = await request({ type: "addProject", path: f.project });
  const oauthRequest = async type => {
    const response = await fetch(`${ready.origin}/api/mcp`, { method: "POST", headers: { Origin: ready.origin, Cookie: cookie, "content-type": "application/json", "x-omp-mcp-protocol": "1" },
      body: JSON.stringify({ type, flowId: before.flowId, projectId: project.projectId }) });
    return { status: response.status, body: await response.json() };
  };
  const observed = await oauthRequest("oauthStatus");
  assert.equal(observed.status, 200); assert.equal(observed.body.status, "waiting"); assert.equal(observed.body.ownerPid, login.child.pid);
  const cancelled = await oauthRequest("oauthCancel");
  assert.equal(cancelled.status, 409); assert.equal(cancelled.body.code, "MCP_OAUTH_OTHER_CLIENT_OWNS_FLOW");
  assert.equal((await f.run(["list"])).authentication.remote.flow.status, "waiting");
  assert.equal(f.service.received.filter(entry => entry.type === "token").length, 0);
  await authorize(url); await until(() => login.exit, Boolean, "preserved CLI OAuth completion"); assert.equal(login.exit.code, 0, login.stderr);
  const response = await fetch(`${ready.origin}/api/mcp`, { method: "POST", headers: { Origin: ready.origin, Cookie: cookie, "content-type": "application/json", "x-omp-mcp-protocol": "1" }, body: JSON.stringify({ type: "list", projectId: project.projectId }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).authentication, (await f.run(["list"])).authentication);
  host.child.send("stop"); await until(() => host.exit, Boolean, "separate Host confirmed stop"); assert.equal(host.exit.code, 0, host.stderr);
});
