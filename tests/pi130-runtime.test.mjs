import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import http from "node:http";
import { spawn } from "node:child_process";
import { buildDirectPiInvocation } from "../packages/direct-agent/launcher.mjs";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { saveLastInteractiveModel } from "../packages/daily-config/index.mjs";

test("Pi 1.3 CLI admits controlled codemode and disables ambient MCP discovery", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi130-admission-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "pi"));
  await fs.writeFile(path.join(root, "pi/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.3.0" }));
  const stack = { root, stackId: `sha256:${"a".repeat(64)}`, nodePath: process.execPath,
    piCliPath: path.join(root, "pi/dist/bundle/cli.js"), ompPackageRoot: path.join(root, "omp") };
  const invocation = buildDirectPiInvocation({ argv: ["--mode", "rpc"], stack, extensionPaths: ["/verified/omp-direct.ts"] });
  assert.ok(invocation.argv.includes("--no-mcp"));
  assert.equal(invocation.argv[invocation.argv.indexOf("--tools") + 1], "read,grep,find,ls,codemode");
});

async function sourceCli(t, respond) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi130-cli-")));
  const received = [];
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const bytes of req) body += bytes;
    received.push({ key: req.headers.authorization, body: JSON.parse(body) });
    respond(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    if (f) await writePiEvidence(t.name, { sdk: f.sdk, service: { origin: `http://127.0.0.1:${port}`, source: "tests/pi130-runtime.test.mjs" }, received, exits });
    await fs.rm(root, { recursive: true, force: true });
  });
  const port = server.address().port, exits = [];
  const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${server.address().port}/v1` });
  const launch = (args, input = "", entry = f.cli) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: f.project, env: f.env });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
    let stdout = "", stderr = "";
    child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
    child.once("error", reject); child.once("close", (code, signal) => { exits.push({ args, code, signal }); resolve({ code, signal, stdout, stderr }); });
    if (args.includes("rpc")) {
      child.stdin.write(input);
      child.stdout.on("data", () => { if (stdout.includes('"type":"agent_settled"')) child.stdin.end(); });
    } else child.stdin.end(input);
  });
  return { ...f, received, launch };
}

test("public Pi 1.3 print preserves one combined stdin/file/prompt and the remaining prompt order", { timeout: 30000 }, async t => {
  const f = await sourceCli(t, res => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"complete"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await fs.writeFile(path.join(f.project, "input.txt"), "FILE_MARKER");
  const result = await f.launch(["-p", "--model", "fixture/one", "@input.txt", "FIRST_MARKER", "SECOND_MARKER"], "  STDIN_MARKER\n");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(f.received.length, 2, "stdin belongs to the first prompt, not a separate model turn");
  const first = f.received[0].body.messages.filter(message => message.role === "user");
  assert.equal(first.length, 1);
  assert.match(JSON.stringify(first[0].content), /STDIN_MARKER[\s\S]*FILE_MARKER[\s\S]*FIRST_MARKER/);
  assert.match(JSON.stringify(first[0].content), /"STDIN_MARKER<file/);
  assert.match(JSON.stringify(f.received[1].body.messages.at(-1).content), /SECOND_MARKER/);
});

for (const mode of ["persisted print", "ephemeral print", "RPC"]) test(`public Pi 1.3 ${mode} rejects provider-only selection without using the recent model`, { timeout: 15000 }, async t => {
  const f = await sourceCli(t, res => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"must not reach"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await saveLastInteractiveModel({ configRoot: f.config, model: "fixture/one" });
  const args = ["--provider", "different-provider", ...(mode === "RPC" ? ["--mode", "rpc"] : ["-p", "do not use recent model"]), ...(mode === "ephemeral print" ? ["--no-session"] : [])];
  const result = await f.launch(args, mode === "RPC" ? '{"id":"provider-only","type":"prompt","message":"do not use recent model"}\n' : "");
  assert.equal(f.received.length, 0, "an incomplete explicit selection must never dispatch to a recorded provider/model");
  assert.equal(result.code, 1);
  assert.match(result.stderr + result.stdout, /OMP_AGENT_OPTION_INVALID/);
});

for (const mode of ["persisted print", "ephemeral print", "RPC", "RPC re-enable", "account child"]) test(`public Pi 1.3 ${mode} sends one failed request despite raw retry settings`, { timeout: 30000 }, async t => {
  const f = await sourceCli(t, res => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end('{"error":{"message":"The service is temporarily unavailable"}}');
  });
  const settingsFile = path.join(f.config, "settings.json");
  const settings = JSON.stringify({ ...JSON.parse(await fs.readFile(settingsFile, "utf8")),
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 50, provider: { maxRetries: 2 } } });
  await fs.writeFile(settingsFile, settings);
  let args = ["--model", "fixture/one"], input = "", entry;
  if (mode.startsWith("RPC")) { args.push("--mode", "rpc"); input = (mode === "RPC re-enable" ? '{"id":"retry","type":"set_auto_retry","enabled":true}\n' : "") + '{"id":"once","type":"prompt","message":"uncertain request"}\n'; }
  else { args.push("-p", "uncertain request"); if (mode !== "persisted print") args.push("--no-session"); }
  if (mode === "account child") {
    entry = path.join(f.stack, "child-entry.mjs");
    await fs.writeFile(entry, `import { runAccountChild } from ${JSON.stringify(path.join(f.omp, "packages/host/account-child.mjs"))}; process.exitCode = await runAccountChild({stack:{root:${JSON.stringify(f.stack)}}, configRoot:${JSON.stringify(f.config)}, accountId:"cli-readonly", argv:process.argv.slice(2)});`);
    args.push("--mode", "json", "--no-extensions", "--tools", "read");
  }
  const result = await f.launch(args, input, entry);
  assert.equal(result.code, mode.startsWith("RPC") || mode === "account child" ? 0 : 1, result.stderr + result.stdout);
  if (mode.startsWith("RPC") || mode === "account child") {
    assert.match(result.stdout, /"stopReason":"error"/);
    assert.match(result.stdout, /"willRetry":false/);
  }
  assert.equal(f.received.length, 1, "neither the Agent nor Provider layer may automatically retry");
  assert.equal(f.received[0].key, "Bearer fixture-cli");
  if (mode === "RPC re-enable") assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, "utf8")).retry, JSON.parse(settings).retry);
  else assert.equal(await fs.readFile(settingsFile, "utf8"), settings);
});

test("public CLI rejects an unadmitted Pi version before any model request", { timeout: 15000 }, async t => {
  const f = await sourceCli(t, res => res.end());
  const manifestFile = path.join(f.stack, "pi/package.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  await fs.writeFile(manifestFile, JSON.stringify({ ...manifest, version: "1.3.1" }));
  const result = await f.launch(["-p", "--model", "fixture/one", "must not run"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /OMP_PI_RUNTIME_UNSUPPORTED/);
  assert.equal(f.received.length, 0);
});

for (const invalid of ["missing manifest", "malformed manifest", "missing version", "wrong package"]) test(`public CLI rejects ${invalid} without legacy fallback`, { timeout: 15000 }, async t => {
  const f = await sourceCli(t, res => res.end());
  const file = path.join(f.stack, "pi/package.json");
  if (invalid === "missing manifest") await fs.unlink(file);
  else if (invalid === "malformed manifest") await fs.writeFile(file, "{");
  else await fs.writeFile(file, JSON.stringify({ name: invalid === "wrong package" ? "untrusted-pi" : "@earendil-works/pi-coding-agent", ...(invalid === "missing version" ? {} : { version: "1.3.0" }) }));
  const result = await f.launch(["-p", "--model", "fixture/one", "must not run"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /OMP_PI_RUNTIME_UNSUPPORTED/);
  assert.equal(f.received.length, 0);
});
