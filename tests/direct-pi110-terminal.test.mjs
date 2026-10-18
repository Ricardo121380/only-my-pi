import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import pty from "node-pty";
import { setTimeout as delay } from "node:timers/promises";
import { createPi110SourceCli } from "./fixtures/pi110-source-cli.mjs";
import { writePiEvidence } from "./fixtures/pi-runtime-evidence.mjs";
import { processIdentity } from "../packages/host/ownership.mjs";

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
async function until(read, accept, label) {
  for (let i = 0; i < 320; i++) { const value = await read(); if (accept(value)) return value; await delay(25); }
  assert.fail(`Timed out: ${label}\n${String(read()).slice(-6000)}`);
}

function toolResponse(res, name, args) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  const delta = { role: "assistant", tool_calls: [{ index: 0, id: "tool-fixture", type: "function", function: { name, arguments: JSON.stringify(args) } }] };
  for (const choice of [{ delta, finish_reason: null }, { delta: {}, finish_reason: "tool_calls" }]) res.write(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
}

function textResponse(res, content = "fixture complete") {
  if (!res.headersSent) res.writeHead(200, { "content-type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\ndata: {"id":"fixture","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
}

async function fixture(t, { forceWarming = false, respondRequest } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi110-pty-")));
  const received = [], sockets = new Set();
  const provider = http.createServer(async (req, res) => {
    let text = ""; for await (const bytes of req) text += bytes;
    const request = { key: req.headers.authorization, body: JSON.parse(text), res, closed: false };
    res.once("close", () => { request.closed = true; }); received.push(request);
    if (respondRequest) { await respondRequest(request); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (forceWarming) {
      res.write('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"streaming"},"finish_reason":null}]}\n\n');
      await delay(1800);
    }
    textResponse(res);
  });
  provider.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${provider.address().port}`, terminals = [];
  t.after(async () => { for (const run of terminals) await run.close();
    for (const socket of sockets) socket.destroy(); await new Promise((resolve) => provider.close(resolve));
    await writePiEvidence(t.name, { sdk: f.sdk, bindings: f.bindings, service: { origin, source: "tests/direct-pi110-terminal.test.mjs" }, received: received.map(({ key, body, closed }) => ({ key, body, closed })), terminals: terminals.map(run => run.output()) });
    await fs.rm(root, { recursive: true, force: true }); });
  const f = await createPi110SourceCli(root, { baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, forceWarming, installedExtensions: process.env.OMP_PI110_INSTALLED_EXTENSIONS === "1" });
  function launch(args) {
    // Observe terminal attributes in the *same* PTY after Pi returns, before
    // node-pty closes its fd. A new terminal would hide restoration defects.
    const script = `printf 'OMP_STTY_BEFORE='; stty -g; ${[process.execPath, f.cli, ...args].map(quote).join(" ")}; code=$?; printf '\nOMP_EXIT_CODE=%s\nOMP_STTY_AFTER=' "$code"; stty -g; printf 'OMP_SHELL_READY\n'; read -r answer`;
    const terminal = pty.spawn("/bin/sh", ["-c", script], { cwd: f.project, env: f.env, cols: 100, rows: 30 });
    let output = ""; terminal.onData((chunk) => { output += chunk; });
    let exited = false; terminal.onExit(() => { exited = true; });
    const identity = processIdentity(terminal.pid).catch(() => null);
    const run = { terminal, output: () => output, close: async () => {
      if (!exited) {
        const expected = await identity;
        if (expected && await processIdentity(terminal.pid) === expected) {
          // The fixture shell and Pi share this private PTY process group.
          // Killing only the shell leaves Pi holding the fd after a failed test.
          try { process.kill(-terminal.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
        }
        try { terminal.kill("SIGKILL"); } catch {}
      }
    } }; terminals.push(run); return run;
  }
  return { ...f, received, launch };
}

test("public OMP defaults to fullscreen despite raw Pi regular settings and restores the same PTY on Ctrl+D", { timeout: 20000 }, async (t) => {
  const f = await fixture(t), run = f.launch(["--model", "fixture/one", "--no-session"]);
  await until(run.output, (output) => output.includes("\x1b[?1049h"), "fullscreen alternate screen");
  await until(run.output, (output) => output.includes("Inspect"), "OMP read-only startup");
  run.terminal.write("\x04");
  await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "return to shell");
  assert.ok(run.output().includes("\x1b[?1049l"), "must leave alternate screen");
  assert.match(run.output(), /OMP_EXIT_CODE=0/);
  assert.equal(run.output().match(/OMP_STTY_AFTER=([^\r\n]+)/)?.[1], run.output().match(/OMP_STTY_BEFORE=([^\r\n]+)/)?.[1]);
  assert.equal(f.received.length, 0, "startup/quit must not execute a model request");
  assert.equal(JSON.parse(await fs.readFile(path.join(f.config, "settings.json"), "utf8")).tuiMode, "regular", "do not rewrite raw Pi settings");
  run.terminal.write("done\r");
});

test("public OMP TUI handles keyboard input and resize without streaming or idle warm requests", { timeout: 30000 }, async (t) => {
  const f = await fixture(t, { forceWarming: true }), run = f.launch(["--model", "fixture/one", "--tui-mode", "regular", "--no-session"]);
  await until(run.output, (output) => output.includes("Inspect"), "TUI ready");
  const beforeResize = run.output().length;
  run.terminal.resize(132, 42);
  await until(() => run.output().slice(beforeResize), (output) => output.includes("─".repeat(132)), "renderer follows PTY resize");
  run.terminal.write("cache probe\r");
  await until(run.output, (output) => output.includes("fixture complete"), "keyboard prompt and real response");
  await delay(1300); // Stay alive beyond the idle refresh interval as well.
  assert.equal(f.received.length, 1, "TUI Provider must receive one explicit keyboard prompt only");
  assert.equal(f.received[0].key, "Bearer fixture-cli");
  assert.ok(f.received[0].body.messages.some((message) => message.role === "user" && JSON.stringify(message.content).includes("cache probe")));
  assert.deepEqual(f.received[0].body.tools.map((tool) => tool.function.name).sort(), ["codemode", "delegate_readonly_agent", "find", "grep", "ls", "read", "request_coding_access"]);
  assert.ok(!run.output().includes("\x1b[?1049h"), "explicit regular must use the main screen");
  run.terminal.write("\x04");
  await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "regular quit restores shell");
  assert.match(run.output(), /OMP_EXIT_CODE=0/);
  assert.equal(run.output().match(/OMP_STTY_AFTER=([^\r\n]+)/)?.[1], run.output().match(/OMP_STTY_BEFORE=([^\r\n]+)/)?.[1]);
  run.terminal.write("done\r");
});

test("public OMP restores the same PTY when the real Pi renderer starts and run rejects", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  // Fault injection is restricted to the copied SDK boundary. Renderer/init,
  // OMP entry, admission and teardown remain real; the user's SDK is untouched.
  await fs.rename(f.sdk, path.join(path.dirname(f.sdk), "index-original.js"));
  await fs.writeFile(f.sdk, 'export * from "./index-original.js"; import { InteractiveMode as RealMode } from "./index-original.js"; export class InteractiveMode extends RealMode { async run() { await this.init(); throw Object.assign(new Error("fixture"), { code: "TUI_FIXTURE_FAILURE" }); } }');
  const run = f.launch(["--model", "fixture/one", "--tui-mode", "fullscreen", "--no-session"]);
  t.after(async () => { try { run.terminal.write("\x04"); } catch {} await delay(100); });
  await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "rejected run returns to shell");
  assert.match(run.output(), /TUI_FIXTURE_FAILURE/);
  assert.match(run.output(), /OMP_EXIT_CODE=1/);
  assert.ok(run.output().includes("\x1b[?1049h") && run.output().includes("\x1b[?1049l"));
  assert.ok(run.output().includes("\x1b[?2004l"), "bracketed paste must be disabled on error");
  assert.equal(run.output().match(/OMP_STTY_AFTER=([^\r\n]+)/)?.[1], run.output().match(/OMP_STTY_BEFORE=([^\r\n]+)/)?.[1]);
  assert.equal(f.received.length, 0);
  run.terminal.write("done\r");
});

test("public OMP rejects contradictory and invalid TUI options before starting Pi", { timeout: 20000 }, async (t) => {
  const f = await fixture(t);
  for (const args of [["--tui-mode", "regular", "--tui-mode", "fullscreen"], ["--tui-mode", "invalid"], ["--tui-mode"], ["--tui-mode=regular"]]) {
    const run = f.launch(["--model", "fixture/one", ...args]);
    await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "invalid option rejection");
    assert.match(run.output(), /OMP_AGENT_OPTION_(INVALID|UNSUPPORTED)/);
    assert.match(run.output(), /OMP_EXIT_CODE=1/);
    assert.ok(!run.output().includes("\x1b[?1049h"), "invalid launch cannot start a renderer");
    assert.equal(f.received.length, 0);
    run.terminal.write("done\r");
  }
});

for (const mode of ["fullscreen", "regular"]) test(`public OMP ${mode} keyboard approval is revoked by /new and Escape cannot approve`, { timeout: 40000 }, async (t) => {
  const access = { taskSummary: "Write fixture", complexity: "simple", scope: ["proof.txt"], riskFlags: [], verification: ["read proof.txt"], orchestration: { useReadOnlyScouts: false, useManagedCloneWriter: false, useFreshReviewer: false } };
  const f = await fixture(t, { respondRequest: ({ body, res }) => {
    const lastUser = body.messages.findLastIndex((message) => message.role === "user");
    const prompt = JSON.stringify(body.messages[lastUser].content);
    const steps = body.messages.slice(lastUser + 1).filter((message) => message.role === "tool").length;
    if (prompt.includes("without new grant")) {
      if (!steps) toolResponse(res, "write", { path: "proof.txt", content: "must not replace\n" });
      else textResponse(res, "new session denied write");
    } else if (!steps) toolResponse(res, "request_coding_access", access);
    else if (steps === 1) toolResponse(res, "write", { path: "proof.txt", content: "controlled\n" });
    else textResponse(res, "coding complete");
  } });
  const run = f.launch(["--model", "fixture/one", "--no-session", ...(mode === "regular" ? ["--tui-mode", "regular"] : [])]);
  await until(run.output, (output) => output.includes("Inspect"), "read-only startup");
  assert.equal(run.output().includes("\x1b[?1049h"), mode === "fullscreen");
  run.terminal.write("approve fixture\r");
  await until(run.output, (output) => output.includes("Approve plan and allow coding for this session"), "visible coding approval");
  assert.equal(f.received.length, 1);
  await assert.rejects(fs.access(path.join(f.project, "proof.txt")), { code: "ENOENT" });
  run.terminal.write("\r");
  await until(run.output, (output) => output.includes("coding complete"), "approved coding completes");
  assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "controlled\n");
  assert.equal(f.received.length, 3);
  assert.ok(f.received.every((request) => request.key === "Bearer fixture-cli" && request.body.model === "one"));
  assert.ok(f.received[1].body.tools.some((tool) => tool.function.name === "write"));
  run.terminal.write("/new\r");
  await until(run.output, (output) => output.includes("New session started"), "new session lifecycle");
  run.terminal.write("without new grant\r");
  await until(run.output, (output) => output.includes("new session denied write"), "new session cannot inherit grant");
  assert.equal(f.received.length, 5);
  assert.ok(!f.received[3].body.tools.some((tool) => tool.function.name === "write"));
  assert.match(JSON.stringify(f.received[4].body.messages), /Tool write not found|OMP_CODING_ACCESS_REQUIRED/);
  assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "controlled\n");
  const beforeApproval = run.output().length;
  run.terminal.write("deny fixture\r");
  await until(() => run.output().slice(beforeApproval), (output) => output.includes("Approve plan and allow coding for this session"), "new coding approval");
  run.terminal.write("\x1b");
  await until(() => f.received.length, (count) => count === 8, "Escape denies then completes");
  assert.match(JSON.stringify(f.received[6].body.messages), /CODING_ACCESS_DENIED|CODING_ACCESS_STALE/);
  assert.equal(await fs.readFile(path.join(f.project, "proof.txt"), "utf8"), "controlled\n");
  run.terminal.write("\x04");
  await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "approved/denied TUI exits");
  assert.match(run.output(), /OMP_EXIT_CODE=0/);
  assert.equal(run.output().match(/OMP_STTY_AFTER=([^\r\n]+)/)?.[1], run.output().match(/OMP_STTY_BEFORE=([^\r\n]+)/)?.[1]);
  run.terminal.write("done\r");
});

test("public OMP Escape cancels an actual Pi request and closes the Provider stream", { timeout: 20000 }, async (t) => {
  const f = await fixture(t, { respondRequest: ({ res }) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.write('data: {"id":"fixture","choices":[{"index":0,"delta":{"role":"assistant","content":"waiting for cancel"},"finish_reason":null}]}\n\n'); } });
  const run = f.launch(["--model", "fixture/one", "--no-session"]);
  await until(run.output, (output) => output.includes("Inspect"), "TUI startup");
  run.terminal.write("cancel probe\r");
  await until(() => f.received.length, (count) => count === 1, "actual Provider request");
  run.terminal.write("\x1b");
  await until(() => f.received[0].closed, Boolean, "Provider stream closed after keyboard cancellation");
  assert.equal(f.received.length, 1);
  run.terminal.write("\x04");
  await until(run.output, (output) => output.includes("OMP_SHELL_READY"), "cancelled TUI quits");
  assert.match(run.output(), /OMP_EXIT_CODE=0/);
  assert.equal(run.output().match(/OMP_STTY_AFTER=([^\r\n]+)/)?.[1], run.output().match(/OMP_STTY_BEFORE=([^\r\n]+)/)?.[1]);
  run.terminal.write("done\r");
});

test("public OMP reload preserves the no-retry policy without changing raw settings", { timeout: 30000 }, async t => {
  const f = await fixture(t, { respondRequest: ({ res }) => {
    res.writeHead(503, { "content-type": "application/json" }); res.end('{"error":{"message":"The service is temporarily unavailable"}}');
  } });
  const settingsFile = path.join(f.config, "settings.json");
  const settings = JSON.stringify({ ...JSON.parse(await fs.readFile(settingsFile, "utf8")), retry: { enabled: true, maxRetries: 2, baseDelayMs: 50, provider: { maxRetries: 2 } } });
  await fs.writeFile(settingsFile, settings);
  const run = f.launch(["--model", "fixture/one", "--no-session", "--tui-mode", "regular"]);
  await until(run.output, output => output.includes("Inspect"), "TUI startup");
  run.terminal.write("/reload\r");
  await until(run.output, output => output.includes("Reloaded keybindings"), "public Pi reload");
  run.terminal.write("fail only once\r");
  await until(run.output, output => output.includes("The service is temporarily unavailable"), "visible model failure");
  run.terminal.write("\x04");
  await until(run.output, output => output.includes("OMP_SHELL_READY"), "failed request returns to shell");
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0].key, "Bearer fixture-cli");
  assert.equal(await fs.readFile(settingsFile, "utf8"), settings);
  assert.match(run.output(), /OMP_EXIT_CODE=0/);
  run.terminal.write("done\r");
});
