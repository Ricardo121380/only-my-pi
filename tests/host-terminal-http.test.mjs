import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import pty from "node-pty";
import { fileURLToPath } from "node:url";
import { byteEvidence, observation, processEvidence, saveRegressionEvidence } from "./fixtures/regression-evidence.mjs";
import { startHost } from "../packages/host/server.mjs";

async function terminalHttp(t, { delayPublication = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-terminal-http-")));
  const project = path.join(root, "project"), assetsRoot = path.join(root, "assets");
  await fs.mkdir(project); await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "index.html"), "fixture");
  const options = { configRoot: path.join(root, "config"), assetsRoot, stack: { stackId: "fixture" }, modelsProvider: async () => [], allowControlled: true };
  let host = await startHost(options), cookie;
  const observations = [], identities = [], spawn = pty.spawn, readFile = fs.readFile;
  pty.spawn = function(executable, args, options) {
    const actualArgs = delayPublication ? ["--import", fileURLToPath(new URL("./fixtures/terminal-publication-delay.mjs", import.meta.url)), ...args] : args;
    const terminal = spawn.call(this, executable, actualArgs, options);
    observations.push({ type: "spawn", at: Date.now(), pid: terminal.pid, executable, args: actualArgs });
    identities.push(processEvidence(terminal.pid).then(process => observations.push({ type: "identity", at: Date.now(), process })));
    terminal.onExit(exit => observations.push({ type: "exit", at: Date.now(), pid: terminal.pid, ...exit }));
    return terminal;
  };
  fs.readFile = async function(file, ...args) {
    try {
      const raw = await readFile.call(this, file, ...args);
      if (String(file).includes("terminal-receipts")) observations.push({ type: "read", file: String(file), at: Date.now(), ...byteEvidence(raw) });
      return raw;
    } catch (error) {
      if (String(file).includes("terminal-receipts")) observations.push({ type: "read-error", file: String(file), at: Date.now(), code: error.code, message: error.message });
      throw error;
    }
  };
  t.after(async () => {
    await Promise.all(identities);
    const directory = path.join(options.configRoot, "only-my-pi/host/terminal-receipts");
    const beforeCleanup = { processes: await Promise.all(observations.filter(entry => entry.type === "spawn").map(entry => processEvidence(entry.pid))), files: await observation(async () => Promise.all((await fs.readdir(directory)).map(async name => ({ name, mode: (await fs.stat(path.join(directory, name))).mode & 0o777, raw: byteEvidence(await readFile(path.join(directory, name))) })))) };
    await saveRegressionEvidence("http-before-cleanup", { test: t.name, root, observations, beforeCleanup });
    let cleanup;
    try { await host.stop(); cleanup = { result: "closed" }; }
    catch (error) { cleanup = { result: "UNKNOWN", code: error.code, message: error.message }; throw error; }
    finally {
      fs.readFile = readFile; pty.spawn = spawn;
      const proof = { test: t.name, root, delayPublication, observations, beforeCleanup, cleanup, afterProcesses: await Promise.all(observations.filter(entry => entry.type === "spawn").map(entry => processEvidence(entry.pid))) };
      t.diagnostic(`terminal observations=${observations.length}; cleanup=${cleanup.result}`);
      await saveRegressionEvidence("http-cleanup", proof);
      if (cleanup.result === "closed") await fs.rm(root, { recursive: true });
    }
  });
  async function pair() {
    const res = await fetch(host.origin + "/pair", { method: "POST", headers: { Origin: host.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(host.pairingUrl).hash.slice(6) }) });
    cookie = res.headers.get("set-cookie").split(";")[0];
  }
  await pair();
  const cmd = async (input, extra = {}) => { const response = await fetch(host.origin + "/api/command", { method: "POST", headers: { Origin: host.origin, Cookie: cookie, "content-type": "application/json", "x-omp-host-protocol": "2", ...extra }, body: JSON.stringify(input) }); observations.push({ type: "http", at: Date.now(), input, status: response.status, body: await response.clone().text() }); return response; };
  const added = await cmd({ type: "addProject", path: project });
  assert.equal(added.status, 200);
  const { projectId } = await added.json();
  const open = { type: "openTerminal", projectId, cols: 90, rows: 24 };
  assert.equal((await cmd(open, { Cookie: "" })).status, 401);
  assert.equal((await cmd(open, { Origin: "https://example.com" })).status, 403);
  assert.equal((await cmd(open, { "x-omp-host-protocol": "1" })).status, 409);
  assert.equal((await cmd({ ...open, shell: "/bin/sh" })).status, 400);
  assert.equal((await cmd({ ...open, cols: 0 })).status, 400);
  const opened = await cmd(open);
  assert.equal(opened.status, 200, observations.at(-1).body);
  const { terminalId } = await opened.json();
  assert.ok(terminalId);
  assert.equal((await (await cmd(open)).json()).terminalId, terminalId);
  assert.equal((await cmd({ type: "enterManual", projectId })).status, 500);
  assert.equal((await cmd({ type: "writeTerminal", terminalId, seq: 2, data: "wrong\r" })).status, 409);
  assert.equal((await cmd({ type: "writeTerminal", terminalId, seq: 1, data: "a".repeat(16385) })).status, 400);
  assert.equal((await fetch(host.origin + "/api/terminal?terminalId=" + terminalId)).status, 401);
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const output = await (await fetch(host.origin + "/api/terminal?terminalId=" + terminalId, { headers: { Cookie: cookie } })).json();
    if (output.output?.includes("%")) break;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.equal((await (await cmd({ type: "closeTerminal", terminalId })).json()).status, "closed");
  assert.equal((await cmd({ type: "enterManual", projectId })).status, 200);
  await host.stop(); host = await startHost({ ...options, allowControlled: false }); await pair();
  assert.equal((await cmd(open)).status, 409);
}

test("terminal HTTP authenticates, validates input and coordinates manual ownership", terminalHttp);
test("terminal HTTP waits for complete supervisor receipts during delayed writes", t => terminalHttp(t, { delayPublication: true }));
