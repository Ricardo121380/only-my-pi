import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { processIdentity, groupAlive } from "../packages/process-runtime/ownership.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
async function until(read, accept, label) {
  for (let i = 0; i < 400; i++) { const value = await read(); if (accept(value)) return value; await delay(25); }
  assert.fail(`Not reached: ${label}`);
}
async function launch(t, dataDir, { port = 0, demo = true, watch = false } = {}) {
  const child = spawn(process.execPath, ["scripts/dev-web.mjs", "--minimal", "--data-dir", dataDir, "--port", String(port), ...(watch ? [] : ["--no-watch"]), ...(demo ? ["--demo"] : [])], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", exitCode;
  child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
  const exited = new Promise(resolve => child.once("exit", code => { exitCode = code; resolve(code); }));
  const stop = async signal => {
    if (exitCode === undefined) { if (signal) child.kill(signal); else child.stdin.end("stop\n"); }
    await Promise.race([exited, delay(10000, undefined, { ref: false }).then(() => { throw new Error("Development launcher did not exit"); })]);
  };
  t.after(async () => { if (exitCode === undefined) await stop("SIGTERM"); });
  const started = await until(() => {
    if (exitCode !== undefined) throw new Error(`Development startup exited ${exitCode}: ${stderr}`);
    return stdout.split("\n").find(line => line.startsWith('{"development":'));
  }, Boolean, "development Host ready");
  return { ...JSON.parse(started), child, stop, exited, output: () => stdout, errors: () => stderr };
}
async function client(app) {
  const pair = await fetch(app.origin + "/pair", { method: "POST", headers: { origin: app.origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(app.pairingUrl).hash.slice(6) }) });
  assert.equal(pair.status, 200);
  const headers = { origin: app.origin, cookie: pair.headers.get("set-cookie").split(";")[0], "content-type": "application/json", "x-omp-host-protocol": "2" };
  const get = async route => { const response = await fetch(app.origin + route, { headers }); assert.equal(response.status, 200); return response.json(); };
  const command = async body => { const response = await fetch(app.origin + "/api/command", { method: "POST", headers, body: JSON.stringify(body) }); assert.ok(response.ok, JSON.stringify(await response.clone().json())); return response.json(); };
  const task = taskId => get(`/api/task?taskId=${taskId}`);
  const settled = taskId => until(() => task(taskId), task => ["succeeded", "failed", "cancelled"].includes(task.status), "task settles");
  return { headers, get, command, task, settled };
}

test("portable WebUI uses prebuilt assets without creating a development build or importing user accounts", { timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-webui-prebuilt-")), assets = path.join(root, "assets"), dataDir = path.join(root, "data");
  await fs.mkdir(assets);
  for (const [name, text] of [["minimal.html", "<html>WEBUI_PREBUILT_PROOF</html>"], ["dependencies.json", "[]"], ["THIRD_PARTY_NOTICES.txt", "fixture notices"]]) await fs.writeFile(path.join(assets, name), text);
  const { startWebHost } = await import("../scripts/web-runtime.mjs");
  const app = await startWebHost({ frontend: "b2", dataDir, port: 0, prebuiltAssets: assets });
  t.after(async () => { await app.stop(); await fs.rm(root, { recursive: true }); });
  assert.match(await (await fetch(app.host.origin)).text(), /WEBUI_PREBUILT_PROOF/);
  await assert.rejects(fs.access(path.join(dataDir, "assets")), { code: "ENOENT" });
  const c = await client({ origin: app.host.origin, pairingUrl: app.host.pairingUrl });
  assert.deepEqual((await c.get("/api/models?accountId=cli-readonly")).models, []);
  assert.equal((await c.get("/api/state")).capabilities.minimal, true);
  await app.stop(); assert.equal(app.host.tasks.workers.size, 0);
});

test("retained minimal development survives restart; native history resumes and approved shell cancellation reaps descendants", { timeout: 60000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-dev-restart-"));
  const first = await launch(t, dataDir), a = await client(first);
  const project = await a.command({ type: "addProject", path: first.project });
  const start = (c, prompt, more = {}) => c.command({ type: "startTask", requestId: randomUUID(), projectId: project.projectId, accountId: "cli-readonly", model: "fixture/one", prompt, ...more });
  const read = await a.settled((await start(a, "read project")).taskId);
  assert.equal(read.status, "succeeded", read.error);
  const session = (await a.get(`/api/sessions?projectId=${project.projectId}`)).sessions[0];
  const before = await a.get(`/api/history?sessionKey=${session.sessionKey}`);
  assert.match(JSON.stringify(before), /minimal-web-evidence/);
  const settings = await fs.readFile(path.join(first.configRoot, "settings.json"), "utf8");
  // A duplicate launcher cannot rebuild shared assets or alter provider config.
  const duplicate = spawn(process.execPath, ["scripts/dev-web.mjs", "--minimal", "--demo", "--no-watch", "--data-dir", dataDir, "--port", "0"], { cwd: root });
  let rejected = ""; duplicate.stderr.on("data", bytes => { rejected += bytes; });
  assert.equal(await new Promise(resolve => duplicate.once("exit", resolve)), 1);
  assert.match(rejected, /OWNERSHIP_HELD/);
  await first.stop(); assert.equal(await first.exited, 0);
  assert.match(first.output(), /"stopped":true,"workers":0,"dataRetained":true/);
  assert.equal(await processIdentity(first.pid), null);

  const second = await launch(t, dataDir, { port: Number(new URL(first.origin).port) });
  assert.equal(second.origin, first.origin); assert.notEqual(second.pid, first.pid);
  assert.equal((await fetch(second.origin + "/api/state", { headers: a.headers })).status, 401, "old authentication cannot survive Host epoch");
  const b = await client(second);
  await until(() => b.get("/api/state"), s => !s.indexing, "history indexed");
  const state = await b.get("/api/state");
  assert.equal(state.projects[0].projectId, project.projectId);
  assert.equal(state.tasks.length, 1, "restart cannot automatically run a task");
  assert.deepEqual(await b.get(`/api/history?sessionKey=${session.sessionKey}`), before);
  const resumed = await b.settled((await start(b, "continue", { resumeSessionKey: session.sessionKey })).taskId);
  assert.equal(resumed.status, "succeeded", resumed.error); assert.equal(resumed.sessionId, read.sessionId);

  const shell = await start(b, "request shell", { mode: "controlled", resumeSessionKey: session.sessionKey });
  const approval = await until(() => b.task(shell.taskId), task => task.approvals?.length, "coding approval");
  await assert.rejects(fs.access(path.join(second.project, "shell.pid")), { code: "ENOENT" });
  await b.command({ type: "answerApproval", taskId: shell.taskId, approvalId: approval.approvals[0].approvalId, value: approval.approvals[0].options[0] });
  const readPid = name => fs.readFile(path.join(second.project, name), "utf8").then(Number).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  const approvedShellTasks = new Set();
  const shellReady = (taskId, previousPid = null) => until(async () => {
    const task = await b.task(taskId);
    if (task.approvals?.length) {
      // The CI host may require a separate tool approval (e.g. unavailable
      // sandbox). Answer only this fixture's one bash request, never a session
      // or permanent grant; cancellation/descendant assertions stay unchanged.
      assert.equal(task.access, "coding");
      assert.equal(task.approvals.length, 1);
      assert.equal(approvedShellTasks.has(taskId), false);
      const approval = task.approvals[0];
      assert.equal(approval.kind, "select");
      assert.match(approval.title, /^Allow bash\?/u);
      assert.ok(approval.options.includes("Allow once"));
      approvedShellTasks.add(taskId);
      await b.command({ type: "answerApproval", taskId, approvalId: approval.approvalId, value: "Allow once" });
    }
    return readPid("shell.pid");
  }, pid => pid > 0 && pid !== previousPid, "shell running");
  const shellPid = await shellReady(shell.taskId).catch(async error => {
    // Surface bounded state in CI's existing error-code diagnostics, without
    // retaining task prompts, tool output or pairing credentials.
    const task = await b.task(shell.taskId);
    const status = ["starting", "running", "cancelling", "succeeded", "failed", "cancelled"].includes(task.status) ? task.status : "unknown";
    const access = ["inspect", "planning", "coding"].includes(task.access) ? task.access : "unknown";
    const toolFailed = task.toolCalls?.some(call => call.status === "failed");
    error.code = `DEV_SHELL_${status}_${access}_${toolFailed ? "tool_failed" : "no_tool_failure"}_${task.approvals?.length ? "approval_pending" : "no_approval"}`.toUpperCase();
    throw error;
  });
  const childPid = await until(() => readPid("child.pid"), pid => pid > 0, "sleep running");
  const ledger = JSON.parse(await fs.readFile(path.join(second.configRoot, "only-my-pi/host/tasks.json"), "utf8"));
  const workerPid = ledger.tasks.find(task => task.taskId === shell.taskId).worker.pid;
  assert.ok(Number.isInteger(workerPid));
  assert.ok(await processIdentity(shellPid)); assert.ok(await processIdentity(childPid));
  await b.command({ type: "cancelTask", taskId: shell.taskId });
  assert.equal((await b.settled(shell.taskId)).status, "cancelled");
  assert.equal(await processIdentity(shellPid), null); assert.equal(await processIdentity(childPid), null);
  assert.equal(groupAlive(workerPid), false);
  const next = await b.settled((await start(b, "deny write", { mode: "controlled", resumeSessionKey: session.sessionKey })).taskId);
  assert.equal(next.status, "succeeded", next.error); assert.equal(next.access, "inspect");
  await assert.rejects(fs.access(path.join(second.project, "forbidden.txt")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(second.configRoot, "settings.json"), "utf8"), settings);
  const shutdownTask = await start(b, "request shell", { mode: "controlled", resumeSessionKey: session.sessionKey });
  const shutdownApproval = await until(() => b.task(shutdownTask.taskId), task => task.approvals?.length, "shutdown approval");
  await b.command({ type: "answerApproval", taskId: shutdownTask.taskId, approvalId: shutdownApproval.approvals[0].approvalId, value: shutdownApproval.approvals[0].options[0] });
  const shutdownShell = await shellReady(shutdownTask.taskId, shellPid);
  const shutdownChild = await until(() => readPid("child.pid"), pid => pid > 0 && pid !== childPid, "shutdown child running");
  await second.stop("SIGTERM"); assert.equal(await second.exited, 0);
  assert.equal(await processIdentity(shutdownShell), null); assert.equal(await processIdentity(shutdownChild), null);
  assert.match(second.output(), /"stopped":true,"workers":0,"dataRetained":true/);
  await fs.rm(dataDir, { recursive: true, force: true });
});

test("source development defaults to empty isolated configuration and rejects occupied port without damaging its owner", { timeout: 30000 }, async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "omp-dev-empty-"));
  const app = await launch(t, path.join(parent, "first"), { demo: false });
  const c = await client(app);
  assert.deepEqual((await c.get("/api/models?accountId=cli-readonly")).models, []);
  // Pi initializes an empty auth store while reading the model catalog.
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(app.configRoot, "auth.json"), "utf8")), {});
  const child = spawn(process.execPath, ["scripts/dev-web.mjs", "--minimal", "--no-watch", "--data-dir", path.join(parent, "second"), "--port", new URL(app.origin).port], { cwd: root });
  let error = ""; child.stderr.on("data", bytes => { error += bytes; }); child.stdout.resume();
  assert.equal(await new Promise(resolve => child.once("exit", resolve)), 1);
  assert.match(error, /EADDRINUSE/);
  assert.equal((await c.get("/api/state")).capabilities.minimal, true);
  await app.stop("SIGINT"); assert.equal(await app.exited, 0);
  await fs.rm(parent, { recursive: true, force: true });
});

test("Host control stop closes the development watcher and model service and releases the persistent directory", { timeout: 20000 }, async t => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-dev-control-stop-"));
  const app = await launch(t, dataDir, { watch: true });
  const endpoint = JSON.parse(await fs.readFile(path.join(app.configRoot, "only-my-pi/host/endpoint.json"), "utf8"));
  const response = await fetch(app.origin + "/internal/stop", { method: "POST", headers: { authorization: `Bearer ${endpoint.controlToken}` } });
  assert.equal(response.status, 202);
  assert.equal(await Promise.race([app.exited, delay(5000, undefined, { ref: false }).then(() => { throw new Error("Control stop left the development process alive"); })]), 0);
  assert.match(app.output(), /"stopped":true,"workers":0,"dataRetained":true/);
  assert.equal(await processIdentity(app.pid), null);
  const restarted = await launch(t, dataDir, { port: Number(new URL(app.origin).port) });
  await restarted.stop(); assert.equal(await restarted.exited, 0);
  await fs.rm(dataDir, { recursive: true, force: true });
});
