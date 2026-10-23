// Real candidate-entry smoke, isolated config/provider. Type /quit to finish.
// import-trust-yes/no: /import other/target.jsonl, confirm import, choose trust,
// then /quit. Tests the real outgoing UI, not a mock trust callback.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import http from "node:http";
import { acquireOwnership } from "../../packages/host/ownership.mjs";
import { prepareDirectTestRuntime } from "./direct-test-runtime.mjs";

assert.ok(process.stdin.isTTY && process.stdout.isTTY);
const mode = process.argv[2] ?? "quit";
const fullStack = process.argv.includes("--full-stack") || !!process.env.OMP_TEST_STACK_PACKAGE;
assert.ok(["quit", "trust-yes", "trust-no", "offline", "import-trust-yes", "import-trust-no", "cwd-yes", "cwd-no", "attachment", "no-session", "lifecycle-error", "resume", "resume-occupied"].includes(mode));
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-tui-entry-")));
const config = path.join(root, "config"), sessions = path.join(root, "sessions");
let server, targetOwner;
const requests = [];
try {
  await fs.mkdir(config); await fs.mkdir(sessions);
  const resumedFile = path.join(sessions, "resumed.jsonl");
  const resumedBytes = JSON.stringify({ type: "session", version: 1, id: "resumed", cwd: root, timestamp: new Date().toISOString() }) + "\n";
  if (mode.startsWith("resume")) await fs.writeFile(resumedFile, resumedBytes);
  if (mode === "resume-occupied") targetOwner = await acquireOwnership(config, "session", "resumed");
  let baseUrl = "http://127.0.0.1:1";
  if (mode === "attachment") {
    await fs.writeFile(path.join(root, "input.txt"), "only fixture attachment\n");
    server = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        await assert.rejects(acquireOwnership(config, "session", "entry-smoke"), { code: "OWNERSHIP_HELD" });
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end('data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"one","choices":[{"index":0,"delta":{"role":"assistant","content":"attachment received"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"one","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      } catch { res.writeHead(500); res.end(); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  }
  let missingCwdBytes;
  const missingCwdFile = path.join(sessions, "missing-cwd.jsonl");
  if (mode.startsWith("cwd-")) {
    missingCwdBytes = JSON.stringify({ type: "session", version: 1, id: "entry-smoke", cwd: path.join(root, "removed-project"),
      timestamp: new Date().toISOString() }) + "\n";
    await fs.writeFile(missingCwdFile, missingCwdBytes);
  }
  if (mode.startsWith("trust-")) {
    await fs.mkdir(path.join(root, ".pi"));
    await fs.writeFile(path.join(root, ".pi/settings.json"), JSON.stringify({ theme: "light" }));
  }
  let importedBytes;
  if (mode.startsWith("import-")) {
    const other = path.join(root, "other");
    await fs.mkdir(path.join(other, ".pi"), { recursive: true });
    await fs.writeFile(path.join(other, ".pi/settings.json"), JSON.stringify({ theme: "light" }));
    importedBytes = JSON.stringify({ type: "session", version: 1, id: "imported", cwd: other,
      timestamp: new Date().toISOString() }) + "\n";
    await fs.writeFile(path.join(other, "target.jsonl"), importedBytes);
  }
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ quietStartup: true, enableAnalytics: false }));
  const runtime = await prepareDirectTestRuntime(root, config, { fullStack, headless: false });
  const { extensions } = runtime;
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, `export default pi => {
    ${mode === "lifecycle-error" ? `pi.on("session_before_switch", () => { throw new Error("fixture lifecycle failure"); });` : ""}
    ${fullStack ? 'pi.events.on("only-my-pi:direct-runtime:v1", payload => process.send?.({orchestratorStatus:payload.status}));' : 'pi.registerFlag("perm", { type:"string", default:"" });'}
    pi.registerProvider("fixture", {baseUrl:${JSON.stringify(baseUrl)}, api:"openai-completions", apiKey:"fixture",
      models:[{id:"one", name:"one", reasoning:true, input:["text"], contextWindow:32000,maxTokens:128,
        cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    pi.on("session_start", (_event, ctx) => process.send?.({event:"start", id:ctx.sessionManager.getSessionId(), mode:ctx.mode, trusted:ctx.isProjectTrusted(), offline:process.env.PI_OFFLINE}));
    ${mode === "no-session" ? `pi.on("session_start", (_event, ctx) => {
      if (ctx.sessionManager.isPersisted() || ctx.sessionManager.getSessionFile()) process.send?.({event:"unexpected-persistence"});
      pi.sendMessage({customType:"fixture", content:"memory only", display:false});
    });` : ""}
    pi.on("session_shutdown", async (_event, ctx) => {
      await new Promise((resolve,reject) => process.send({event:"shutdown",id:ctx.sessionManager.getSessionId()}, error => error ? reject(error) : resolve()));
    });
  };`);
  const messages = [];
  const child = spawn(runtime.node, [path.join(runtime.packageRoot, "packages/direct-agent/tui-entry.mjs"),
    runtime.sdk, "--no-extensions",
    ...[...extensions, extension].flatMap(entry => ["--extension", entry]),
    "--tools", fullStack ? "read,grep,find,ls,edit,write,bash,request_coding_access,delegate_readonly_agent,delegate_managed_writer,context_snapshot" : "read,ls", "--perm", "build", "--session-dir", sessions,
    ...(missingCwdBytes ? ["--session", missingCwdFile] : ["--session-id", "entry-smoke"]),
    "--model", "fixture/one", "--thinking", "high", ...(mode === "offline" ? ["--offline"] : []),
    ...(mode === "no-session" ? ["--no-session"] : []),
    ...(mode === "attachment" ? ["@input.txt", "read attachment"] : [])], { cwd: root, stdio: ["inherit", "inherit", "inherit", "ipc"],
    env: { PATH: process.env.PATH, HOME: root, TERM: process.env.TERM ?? "xterm-256color",
      PI_CODING_AGENT_DIR: config, ...(mode === "offline" ? {} : { PI_OFFLINE: "1" }), PI_SKIP_VERSION_CHECK: "1",
      ONLY_MY_PI_DIRECT: fullStack ? "1" : "0", ONLY_MY_PI_MODEL_EXPLICIT: "1", ONLY_MY_PI_HEADLESS: "0" } });
  const statuses = [];
  child.on("message", message => message.orchestratorStatus ? statuses.push(message.orchestratorStatus) : messages.push(message));
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, mode === "lifecycle-error" ? 1 : 0); assert.equal(result.signal, null);
  if (fullStack) assert.deepEqual(statuses, messages.map(message => message.event === "start" ? "READY" : "UNAVAILABLE"));
  const start = (id, trusted) => ({ event: "start", id, mode: "tui", trusted, offline: "1" });
  const shutdown = (id) => ({ event: "shutdown", id });
  if (mode === "no-session") {
    assert.equal(messages.length, 4, "exercise /new then /quit");
    const ids = [messages[0].id, messages[2].id];
    assert.equal(ids[0], "entry-smoke"); assert.notEqual(ids[0], ids[1]);
    assert.deepEqual(messages, ids.flatMap(id => [start(id, true), shutdown(id)]));
    assert.deepEqual(await fs.readdir(sessions), []);
    for (const id of ids) { const lease = await acquireOwnership(config, "session", id); await lease.release(); }
  } else assert.deepEqual(messages, mode === "resume"
    ? [start("entry-smoke", true), shutdown("entry-smoke"), start("resumed", true), shutdown("resumed")]
    : mode === "cwd-no" ? [] : mode.startsWith("import-")
    ? [start("entry-smoke", true), shutdown("entry-smoke"), start("imported", mode.endsWith("yes")), shutdown("imported")]
    : [start("entry-smoke", mode !== "trust-no"), shutdown("entry-smoke")]);
  if (missingCwdBytes) {
    const saved = await fs.readFile(missingCwdFile, "utf8");
    if (mode === "cwd-no") assert.equal(saved, missingCwdBytes);
    else assert.equal(JSON.parse(saved.split("\n")[0]).cwd, path.join(root, "removed-project"));
  }
  if (mode === "resume-occupied") assert.equal(await fs.readFile(resumedFile, "utf8"), resumedBytes);
  if (mode === "resume") { const lease = await acquireOwnership(config, "session", "resumed"); await lease.release(); }
  if (importedBytes) {
    assert.equal(await fs.readFile(path.join(root, "other/target.jsonl"), "utf8"), importedBytes);
    const lease = await acquireOwnership(config, "session", "imported"); await lease.release();
  }
  if (mode === "lifecycle-error") {
    await assert.rejects(acquireOwnership(config, "session", "entry-smoke"), { code: "OWNER_RECONCILIATION_REQUIRED" });
    assert.deepEqual(await fs.readdir(sessions), []);
  } else {
    const lease = await acquireOwnership(config, "session", "entry-smoke"); await lease.release();
  }
  if (mode === "attachment") {
    assert.equal(requests.length, 1);
    assert.match(JSON.stringify(requests[0].messages), /only fixture attachment/);
    assert.match(JSON.stringify(requests[0].messages), /read attachment/);
    const history = (await fs.readdir(sessions)).find((file) => file.endsWith("_entry-smoke.jsonl"));
    assert.match(await fs.readFile(path.join(sessions, history), "utf8"), /attachment received/);
  }
  process.stdout.write(`\nDIRECT_TUI_ENTRY_${mode.toUpperCase()}${fullStack ? "_FULL_STACK" : ""}_PTY_PASS\n`);
} finally {
  await targetOwner?.release();
  if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); });
  await fs.rm(root, { recursive: true, force: true });
}
