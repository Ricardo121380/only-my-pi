import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import test from "node:test";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { acquireOwnership } from "../packages/process-runtime/ownership.mjs";
import { buildDirectPiInvocation } from "../packages/direct-agent/launcher.mjs";
import { runOmpEntrypoint } from "../bin/omp.mjs";

function chunk(res, delta, finish_reason = null) {
  res.write(`data: ${JSON.stringify({ id: "local", object: "chat.completion.chunk", created: 1,
    model: "one", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
}
function finish(res, text) {
  chunk(res, { role: "assistant", content: text });
  chunk(res, {}, "stop");
  res.end("data: [DONE]\n\n");
}
function tool(res, name, args) {
  chunk(res, { role: "assistant", tool_calls: [{ index: 0, id: `${name}-local`, type: "function",
    function: { name, arguments: JSON.stringify(args) } }] });
  chunk(res, {}, "tool_calls");
  res.end("data: [DONE]\n\n");
}

async function start(f, extra = []) {
  const child = spawn(process.execPath, [f.cli, "--minimal", "--mode", "rpc", "--offline",
    "--model", "fixture/one", "--session-dir", f.sessions, ...extra],
  { cwd: f.project, env: f.cliEnv, stdio: ["pipe", "pipe", "pipe"] });
  const output = [], pending = new Map(), listeners = new Set();
  let stderr = "", sequence = 0;
  child.stderr.on("data", value => { stderr += value; });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const event = JSON.parse(line); output.push(event);
    if (event.type === "response") { pending.get(event.id)?.resolve(event); pending.delete(event.id); }
    for (const listener of listeners) listener(event);
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const error = new Error(`RPC exited ${code}: ${stderr}`);
      for (const waiter of pending.values()) waiter.reject(error);
      for (const listener of listeners) listener.reject(error);
      pending.clear(); listeners.clear();
      resolve({ code, signal });
    });
  });
  f.cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited; lines.close();
  });
  const command = (type, fields = {}) => {
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ type, id, ...fields }) + "\n");
    });
  };
  const next = type => new Promise((resolve, reject) => {
    const listener = event => { if (event.type === type) { listeners.delete(listener); resolve(event); } };
    listener.reject = reject;
    listeners.add(listener);
  });
  const prompt = async message => {
    const settled = next("agent_settled");
    const [, event] = await Promise.all([
      command("prompt", { message }).then(response => assert.equal(response.success, true, stderr)), settled,
    ]);
    return event;
  };
  return { child, output, exited, command, next, prompt, stderr: () => stderr };
}

test("minimal public CLI uses native Pi tools/history, preserves read-only policy and releases on abort/exit", { timeout: 45_000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-session-")));
  const received = [];
  const cleanups = [];
  let sawHang, closedHang;
  const hanging = new Promise(resolve => { sawHang = resolve; });
  const disconnected = new Promise(resolve => { closedHang = resolve; });
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    const request = JSON.parse(body); received.push(request);
    const content = request.messages.findLast(message => message.role === "user")?.content;
    const instruction = typeof content === "string" ? content : content?.filter(part => part.type === "text").map(part => part.text).join("");
    if (instruction === "fail") { res.writeHead(503); res.end("controlled failure"); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (instruction === "hang") {
      res.once("close", closedHang); chunk(res, { role: "assistant", content: "partial" }); sawHang(); return;
    }
    if (request.messages.at(-1).role === "tool") { finish(res, "tool handled"); return; }
    if (instruction === "read") { tool(res, "read", { path: "README.md" }); return; }
    if (instruction === "deny write") { tool(res, "write", { path: "forbidden.txt", content: "forbidden" }); return; }
    finish(res, "continued");
  });
  t.after(async () => {
    const results = await Promise.allSettled(cleanups.map(cleanup => cleanup()));
    try { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
    finally { await fs.rm(root, { recursive: true, force: true }); }
    for (const result of results) if (result.status === "rejected") throw result.reason;
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, installedExtensions: true });
  f.cleanups = cleanups;
  f.sessions = path.join(root, "sessions");
  await fs.mkdir(f.sessions);
  // Prove the listed optional implementations and configuration bindings are
  // unnecessary. Shared dependency installations remain available read-only.
  // Only this disposable copy is reduced; source stays intact.
  for (const entry of ["packages/mcp", "packages/product-settings", "packages/subagents",
    "packages/direct-agent/orchestration.mjs", "packages/direct-agent/managed-clone.mjs", "packages/direct-agent/codemode.mjs",
    "extensions/omp-control", "extensions/context-doctor", "extensions/session-ledger"])
    await fs.rm(path.join(f.omp, entry), { recursive: true, force: true });
  // Existing histories still require their pure image-reference schema. It
  // carries no model caller, credential access, extension or tool registration.
  for (const entry of await fs.readdir(path.join(f.omp, "packages/model-calls")))
    if (entry !== "references.mjs") await fs.rm(path.join(f.omp, "packages/model-calls", entry), { recursive: true });
  const settingsFile = path.join(f.config, "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  for (const binding of settings.onlyMyPi.packageBindings.filter(binding => binding.id !== "permission-modes"))
    await fs.rm(path.join(f.config, "npm/node_modules", binding.name), { recursive: true });
  settings.onlyMyPi.packageBindings = settings.onlyMyPi.packageBindings.filter(binding => binding.id === "permission-modes");
  await fs.writeFile(settingsFile, JSON.stringify(settings));
  const settingsBytes = await fs.readFile(settingsFile, "utf8");
  const stack = { root: f.stack, ompPackageRoot: f.omp, nodePath: process.execPath,
    stackId: `sha256:${"a".repeat(64)}`, piCliPath: path.join(f.stack, "pi/dist/bundle/cli.js") };
  const build = (argv, options = {}) => buildDirectPiInvocation({ argv, stack, extensionPaths: [path.join(f.omp, "extensions/omp-direct/index.ts")], ...options });
  const ordinary = build(["--mode", "rpc"], { env: { ONLY_MY_PI_MINIMAL: "1" } });
  assert.equal(ordinary.env.ONLY_MY_PI_MINIMAL, "0", "ambient mode must not replace an explicit launch choice");
  const literal = build(["--", "--minimal"]);
  assert.equal(literal.env.ONLY_MY_PI_MINIMAL, "0");
  let routed = false;
  assert.equal(await runOmpEntrypoint({ argv: ["--", "--minimal"], agentLauncher: async ({ argv }) => {
    routed = true;
    assert.deepEqual(argv, ["--", "--minimal"]);
    assert.equal(build(argv).env.ONLY_MY_PI_MINIMAL, "0");
  } }), 0);
  assert.equal(routed, true);
  for (const argv of [["--minimal", "--version"], ["--minimal", "--export", "/tmp/history"], ["--minimal", "--mode", "unknown"]])
    assert.throws(() => build(argv), { code: "OMP_AGENT_OPTION_INVALID" });
  assert.throws(() => build(["--minimal", "--mode", "rpc"], { runtimeOwner: "host" }), { code: "OMP_AGENT_OPTION_INVALID" });
  // Ambient resources must not become part of the minimal model context.
  await fs.mkdir(path.join(f.project, ".pi"));
  await fs.writeFile(path.join(f.project, "AGENTS.md"), "AMBIENT_CONTEXT_MUST_NOT_LOAD");
  await fs.writeFile(path.join(f.project, ".pi/settings.json"), JSON.stringify({ extensions: ["./unexpected.ts"] }));
  await fs.writeFile(path.join(f.project, ".pi/unexpected.ts"), 'throw new Error("AMBIENT_EXTENSION_LOADED");');

  const first = await start(f);
  const state = await first.command("get_state");
  assert.equal(state.success, true, first.stderr());
  assert.equal(state.data.model.id, "one");
  const id = state.data.sessionId;
  await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
  assert.equal((await first.prompt("read")).aborted, false);
  assert.equal(received.length, 2, JSON.stringify({ received, output: first.output, stderr: first.stderr() }));
  assert.match(JSON.stringify(received[1].messages), /temporary CLI project/);
  assert.ok(first.output.some(event => event.type === "tool_execution_end" && event.toolName === "read" && !event.isError));
  assert.ok(first.output.some(event => event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta"));
  const sessionFile = (await first.command("get_state")).data.sessionFile;
  assert.equal(path.dirname(sessionFile), f.sessions);
  const bytes = await fs.readFile(sessionFile, "utf8");
  const competing = await start(f, ["--session", sessionFile]);
  assert.equal((await competing.exited).code, 1);
  assert.equal(await fs.readFile(sessionFile, "utf8"), bytes);
  assert.equal(received.length, 2, "occupied history must not submit a request");
  first.child.stdin.end(); assert.deepEqual(await first.exited, { code: 0, signal: null }, first.stderr());
  const lease = await acquireOwnership(f.config, "session", id); await lease.release();

  const second = await start(f, ["--session", sessionFile]);
  assert.equal((await second.command("get_state")).data.sessionId, id);
  assert.equal(received.length, 2, "restoring history must not replay input");
  assert.equal((await second.prompt("resume")).aborted, false);
  assert.match(JSON.stringify(received[2].messages), /tool handled/);
  assert.equal((await second.prompt("deny write")).aborted, false);
  assert.equal(received.length, 5);
  await assert.rejects(fs.stat(path.join(f.project, "forbidden.txt")), { code: "ENOENT" });
  assert.ok(second.output.some(event => event.type === "tool_execution_end" && event.toolName === "write" && event.isError));
  const settled = second.next("agent_settled");
  assert.equal((await second.command("prompt", { message: "hang" })).success, true);
  await hanging;
  assert.equal((await second.command("abort")).success, true);
  assert.equal((await settled).aborted, true);
  await disconnected;
  assert.equal(received.length, 6);
  assert.equal((await second.command("get_state")).data.isStreaming, false);
  await second.prompt("fail");
  assert.equal(received.length, 7, "an admitted failure must not retry");
  assert.ok(second.output.some(event => event.type === "message_end" && event.message?.stopReason === "error"));
  second.child.kill("SIGTERM");
  assert.deepEqual(await second.exited, { code: 143, signal: null }, second.stderr());
  const released = await acquireOwnership(f.config, "session", id); await released.release();
  assert.equal(await fs.readFile(settingsFile, "utf8"), settingsBytes);
  for (const request of received) {
    assert.deepEqual(request.tools.map(tool => tool.function.name).sort(), ["find", "grep", "ls", "read"]);
    assert.ok(!JSON.stringify(request).includes("AMBIENT_CONTEXT_MUST_NOT_LOAD"));
  }
  // A missing mandatory permission extension must fail closed, even here.
  const permission = settings.onlyMyPi.packageBindings[0];
  await fs.rm(path.join(f.config, "npm/node_modules", permission.name), { recursive: true });
  const refused = await start(f);
  assert.notEqual((await refused.exited).code, 0);
  assert.equal(received.length, 7);
  t.diagnostic(`Pi ${f.piVersion}; 7 loopback model requests; native read/stream/resume/abort/error; EOF and SIGTERM; no optional modules`);
});

test("minimal interactive SDK preserves explicit approval, revoke and no grant inheritance", { timeout: 30_000 }, async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-native-approval-")));
  const received = [];
  const access = { taskSummary: "Write isolated proof", complexity: "simple", scope: ["proof.txt"], riskFlags: [],
    verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const part of req) body += part;
    const request = JSON.parse(body); received.push(request);
    const turn = request.messages.slice(request.messages.findLastIndex(message => message.role === "user") + 1);
    const steps = turn.filter(message => message.role === "tool").length;
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (steps === 0) tool(res, "request_coding_access", access);
    else if (steps === 1) tool(res, "write", { path: "proof.txt", content: "local approved write\n" });
    else finish(res, "done");
  });
  let child;
  let exited;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    try { await exited; }
    finally {
      try { await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }); }
      finally { await fs.rm(root, { recursive: true, force: true }); }
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, installedExtensions: true });
  const settingsFile = path.join(f.config, "settings.json");
  const settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
  settings.packages = ["npm:omp-unused-fixture-package@0.0.0"];
  settings.defaultProjectTrust = "always";
  await fs.writeFile(settingsFile, JSON.stringify(settings));
  const settingsBytes = await fs.readFile(settingsFile, "utf8");
  await fs.mkdir(path.join(f.project, ".pi"));
  const projectSettings = JSON.stringify({ packages: ["npm:omp-unused-project-package@0.0.0"] });
  await fs.writeFile(path.join(f.project, ".pi/settings.json"), projectSettings);
  const sessions = path.join(root, "sessions"); await fs.mkdir(sessions);
  child = spawn(process.execPath, [new URL("./fixtures/minimal-tui-session.mjs", import.meta.url).pathname, f.omp, f.config, sessions],
    { cwd: f.project, env: f.cliEnv, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
  assert.deepEqual(JSON.parse(stdout), { approvals: 2, resumedWithoutGrant: true, disposed: true });
  assert.equal(received.length, 6);
  assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "local approved write\n");
  assert.ok(!received[0].tools.some(tool => tool.function.name === "write"));
  assert.ok(received[1].tools.some(tool => tool.function.name === "write"));
  assert.ok(received.every(request => request.tools.every(tool => !/delegate|mcp|codemode|image/.test(tool.function.name))));
  assert.equal(await fs.readFile(settingsFile, "utf8"), settingsBytes);
  assert.equal(await fs.readFile(path.join(f.project, ".pi/settings.json"), "utf8"), projectSettings);
});
