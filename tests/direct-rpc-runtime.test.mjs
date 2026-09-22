import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import test from "node:test";
import { acquireOwnership } from "../packages/host/ownership.mjs";
import { createRpcRuntimeView } from "../packages/direct-agent/rpc-runtime-view.mjs";
import { prepareDirectSourceStack } from "./fixtures/direct-source-stack.mjs";

const fullStack = process.env.OMP_TEST_DIRECT_FULL_STACK === "1";

async function fixture(t, { memory = false, occupied = false, lifecycleError = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-rpc-")));
  const config = path.join(root, "config"), sessions = path.join(root, "sessions");
  await fs.mkdir(config); await fs.mkdir(sessions);
  await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({ quietStartup: true, enableAnalytics: false }));
  const extensions = fullStack ? await prepareDirectSourceStack(root, config) : [];
  const target = path.join(sessions, "target.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 1, id: "target", cwd: root, timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(target, bytes);
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, `export default pi => {
    ${lifecycleError ? 'pi.on("session_before_switch", () => { throw new Error("fixture lifecycle failure"); });' : ""}
    ${fullStack ? 'pi.events.on("only-my-pi:direct-runtime:v1", payload => process.send?.({orchestratorStatus:payload.status}));' : 'pi.registerFlag("perm", {type:"string",default:""});'}
    pi.registerProvider("fixture", {baseUrl:"http://127.0.0.1:1",api:"openai-completions",apiKey:"fixture",
      models:[{id:"one",name:"one",reasoning:true,input:["text"],contextWindow:32000,maxTokens:128,
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
    pi.on("session_start", (_event, ctx) => process.send?.({event:"start",id:ctx.sessionManager.getSessionId(),
      trusted:ctx.isProjectTrusted(),mode:ctx.mode}));
    pi.on("session_shutdown", async (_event, ctx) => {
      await new Promise(resolve => setTimeout(resolve, 25));
      await new Promise((resolve,reject) => process.send({event:"shutdown",id:ctx.sessionManager.getSessionId()},
        error => error ? reject(error) : resolve()));
    });
  };`);
  const owner = occupied ? await acquireOwnership(config, "session", "target") : undefined;
  const child = spawn(process.execPath, [fileURLToPath(new URL("../packages/direct-agent/rpc-entry.mjs", import.meta.url)),
    fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")), "--mode", "rpc", "--offline",
    "--no-extensions", ...[...extensions, extension].flatMap(entry => ["--extension", entry]),
    "--tools", "read,grep,find,ls", "--perm", "plan", "--session-dir", sessions,
    ...(occupied ? ["--session", target] : ["--session-id", "initial"]),
    ...(memory ? ["--no-session"] : []), "--model", "fixture/one", "--thinking", "high"],
  { cwd: root, stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: config, PI_SKIP_VERSION_CHECK: "1",
      ONLY_MY_PI_DIRECT: fullStack ? "1" : "0", ONLY_MY_PI_HEADLESS: "1", ONLY_MY_PI_MODEL_EXPLICIT: "1" } });
  let stderr = "", nextId = 0;
  const events = [], output = [], statuses = [], pending = new Map();
  child.stderr.on("data", chunk => { stderr += chunk; });
  child.on("message", event => event.orchestratorStatus ? statuses.push(event.orchestratorStatus) : events.push(event));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line); output.push(message);
    if (message.type === "response") { pending.get(message.id)?.(message); pending.delete(message.id); }
  });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited; lines.close(); await owner?.release(); await fs.rm(root, { recursive: true, force: true });
  });
  const command = async (type, fields = {}) => {
    const id = String(++nextId);
    const response = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ type, id, ...fields }) + "\n");
    return response;
  };
  return { root, config, sessions, target, bytes, child, events, output, statuses, exited, command, stderr: () => stderr };
}

for (const memory of [false, true]) for (const ending of ["eof", "signal"])
  test(`public RPC owns ${memory ? "memory" : "persisted"} new/resume and releases on ${ending}`, { timeout: 15_000 }, async (t) => {
    const f = await fixture(t, { memory });
    const initial = await f.command("get_state");
    assert.equal(initial.success, true, f.stderr());
    assert.equal(initial.data.sessionId, "initial");
    assert.equal(initial.data.thinkingLevel, "high");
    await assert.rejects(acquireOwnership(f.config, "session", "initial"), { code: "OWNERSHIP_HELD" });
    assert.equal((await f.command("new_session")).success, true);
    const fresh = (await f.command("get_state")).data;
    assert.notEqual(fresh.sessionId, "initial");
    if (memory) { assert.equal(fresh.sessionFile, undefined); assert.deepEqual(await fs.readdir(f.sessions), ["target.jsonl"]); }
    const blocker = await acquireOwnership(f.config, "session", "target");
    try {
      const refused = await f.command("switch_session", { sessionPath: f.target });
      assert.equal(refused.success, false);
      assert.match(refused.error, /SESSION_OWNERSHIP_UNAVAILABLE/);
      assert.equal(await fs.readFile(f.target, "utf8"), f.bytes);
      assert.equal((await f.command("get_state")).data.sessionId, fresh.sessionId);
    } finally { await blocker.release(); }
    assert.equal((await f.command("switch_session", { sessionPath: f.target })).success, true);
    assert.equal((await f.command("get_state")).data.sessionId, "target");
    await assert.rejects(acquireOwnership(f.config, "session", "target"), { code: "OWNERSHIP_HELD" });
    if (ending === "eof") f.child.stdin.end(); else f.child.kill("SIGTERM");
    assert.deepEqual(await f.exited, { code: ending === "eof" ? 0 : 143, signal: null }, f.stderr());
    const ids = ["initial", fresh.sessionId, "target"];
    assert.deepEqual(f.events, ids.flatMap(id => [{ event: "start", id, trusted: false, mode: "rpc" }, { event: "shutdown", id }]));
    if (fullStack) assert.deepEqual(f.statuses, ids.flatMap(() => ["READY", "UNAVAILABLE"]));
    for (const id of ids) { const owner = await acquireOwnership(f.config, "session", id); await owner.release(); }
  });

test("RPC initial occupied history fails before migration or extension startup", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { occupied: true });
  assert.deepEqual(await f.exited, { code: 1, signal: null });
  assert.equal(await fs.readFile(f.target, "utf8"), f.bytes);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.output, [{ type: "extension_error", code: "SESSION_OWNERSHIP_UNAVAILABLE" }]);
});

test("RPC view deduplicates transport binding, preserves private receivers and does not intercept reload", async () => {
  class Session {
    #count = 0;
    get count() { return this.#count; }
    async bindExtensions() { this.#count++; }
    async reload() { await this.bindExtensions(); }
  }
  class Runtime {
    #session = new Session();
    get session() { return this.#session; }
    newSession() { this.#session = new Session(); }
  }
  const runtime = new Runtime(), view = createRpcRuntimeView(runtime), initial = view.session;
  await Promise.all([initial.bindExtensions({}), initial.bindExtensions({})]);
  assert.equal(initial.count, 1);
  await initial.reload(); assert.equal(initial.count, 2);
  await view.newSession();
  assert.notEqual(view.session, initial);
  await view.session.bindExtensions({}); assert.equal(view.session.count, 1);
  await runtime.session.bindExtensions({}); assert.equal(view.session.count, 2, "underlying public API remains unchanged");
});

test("RPC lifecycle failure exits boundedly, runs shutdown, retains ownership and never starts a replacement", { timeout: 15_000 }, async (t) => {
  const f = await fixture(t, { lifecycleError: true });
  assert.equal((await f.command("get_state")).success, true);
  void f.command("new_session");
  assert.deepEqual(await f.exited, { code: 1, signal: null });
  assert.deepEqual(f.events, [{ event: "start", id: "initial", trusted: false, mode: "rpc" }, { event: "shutdown", id: "initial" }]);
  assert.match(f.stderr(), /SESSION_LIFECYCLE_UNCONFIRMED/);
  await assert.rejects(acquireOwnership(f.config, "session", "initial"), { code: "OWNER_RECONCILIATION_REQUIRED" });
  assert.deepEqual(await fs.readdir(f.sessions), ["target.jsonl"]);
});
