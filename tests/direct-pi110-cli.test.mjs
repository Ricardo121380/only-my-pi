import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";

async function until(read, accept, label) {
  for (let i = 0; i < 400; i++) { const value = read(); if (accept(value)) return value; await delay(25); }
  assert.fail(`Timed out: ${label}`);
}

function respond(res, text, done = true) {
  if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "one", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
  if (done) {
    res.write(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  }
}

test("public OMP print, ephemeral print, RPC and account child suppress a forced warm during real Pi streaming", { timeout: 120000 }, async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-cli-")));
  const received = [], sockets = new Set();
  const provider = http.createServer(async (req, res) => {
    let bytes = ""; for await (const chunk of req) bytes += chunk;
    const request = { key: req.headers.authorization, body: JSON.parse(bytes) }; received.push(request);
    if (request.body.max_tokens === 1 || request.body.max_completion_tokens === 1) respond(res, "warm");
    else { respond(res, "streaming", false); await delay(1800); respond(res, "fixture complete"); }
  });
  provider.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  t.after(async () => { for (const socket of sockets) socket.destroy(); await new Promise((resolve) => provider.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, forceWarming: true,
    installedExtensions: process.env.OMP_PI110_INSTALLED_EXTENSIONS === "1" });
  const childEntry = path.join(root, "account-child-entry.mjs");
  await fs.writeFile(childEntry, `import { runAccountChild } from ${JSON.stringify(path.join(f.omp, "packages/host/account-child.mjs"))};
    await runAccountChild({ stack: { root: ${JSON.stringify(f.stack)} }, configRoot: ${JSON.stringify(f.config)}, accountId: "cli-readonly", argv: process.argv.slice(2) });`);
  const trigger = path.join(f.config, "npm/node_modules", f.bindings.find((b) => b.id === "permission-modes").name, "src/index.ts");
  const cases = [
    ["persisted print", [f.cli, "-p", "--model", "fixture/one", "cache probe"]],
    ["ephemeral print", [f.cli, "--no-session", "-p", "--model", "fixture/one", "cache probe"]],
    ["direct RPC", [f.cli, "--mode", "rpc", "--model", "fixture/one"]],
    ["account child", [childEntry, "--no-session", "--mode", "json", "-p", "--model", "fixture/one", "--no-extensions", "--extension", trigger, "--tools", "read,grep,find,ls", "cache probe"]],
  ];
  for (const [name, args] of cases) await t.test(name, { timeout: 30000 }, async (st) => {
    const before = received.length;
    const child = spawn(process.execPath, args, { cwd: f.project, env: f.env, stdio: ["pipe", "pipe", "pipe"] });
    st.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
    let output = "", error = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { error += chunk; });
    const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    if (name === "direct RPC") {
      child.stdin.write(JSON.stringify({ id: "probe", type: "prompt", message: "cache probe" }) + "\n");
      await until(() => output, (text) => text.includes('"type":"agent_settled"') || text.includes("START_FAILED"), "RPC settled");
      // Keep the RPC process alive beyond the idle warm interval too.
      await delay(1300); child.stdin.end();
    } else child.stdin.end(); // Pi main reads redirected stdin before print.
    const exit = await closed;
    assert.equal(exit.code, 0, `${name}: ${error}\n${output}`);
    assert.match(output, /fixture complete/);
    const requests = received.slice(before);
    assert.equal(requests.length, 1, `${name}: Provider must receive only one user request`);
    assert.equal(requests[0].key, "Bearer fixture-cli"); assert.equal(requests[0].body.model, "one");
    assert.deepEqual(requests[0].body.tools.map((tool) => tool.function.name).sort(), ["find", "grep", "ls", "read"]);
  });
});
