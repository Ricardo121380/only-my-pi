import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import pty from "node-pty";
import { groupAlive } from "../packages/host/ownership.mjs";
import { randomUUID } from "node:crypto";
import { createMcpHost, providerReply, until, untilPiInitialized } from "./fixtures/mcp-host.mjs";

const run = (f, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [f.cli, ...args], { cwd: f.project, env: f.cliEnv });
  let stdout = "", stderr = ""; child.stdout.on("data", b => { stdout += b; }); child.stderr.on("data", b => { stderr += b; }); child.stdin.end();
  child.on("error", reject); child.on("close", code => resolve({ code, stdout, stderr }));
});
const settings = async (f, input, expected = 200) => {
  const response = await fetch(f.host.origin + "/api/settings", { method: "POST", headers: { Origin: f.host.origin, Cookie: f.cookie, "content-type": "application/json", "x-omp-settings-protocol": "1" }, body: JSON.stringify({ ...input, projectId: f.projectId }) });
  const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
};
const waitTask = (f, id) => until(() => f.task(id), t => ["succeeded", "failed", "cancelled"].includes(t.status), "real Pi task settled", 30000);

test("public Host refuses malformed project scope without changing product defaults", async t => {
  const f = await createMcpHost(); t.after(() => f.close());
  for (const projectId of [false, 0, "", null]) {
    const response = await fetch(f.host.origin + "/api/settings", { method: "POST", headers: { Origin: f.host.origin, Cookie: f.cookie, "content-type": "application/json", "x-omp-settings-protocol": "1" }, body: JSON.stringify({ type: "set", projectId, revision: 0, id: "context-doctor", parameters: { label: "must-not-save" } }) });
    assert.equal(response.status, 400); assert.equal((await response.json()).code, "SETTINGS_PROJECT_REQUIRED");
    assert.equal((await run(f, ["settings", "list"])).stdout.includes('"revision": 0'), true);
  }
});

test("CLI and public Host share requested settings; each real Pi loads the declared parameters and imported skill", { timeout: 120000 }, async t => {
  const f = await createMcpHost({ installedExtensions: true, verifyNode: true, respond: ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(m => m.role === "user");
    const tools = body.messages.slice(lastUser + 1).filter(m => m.role === "tool");
    providerReply(res, tools.length ? null : "context_snapshot", {});
  } });
  t.after(async () => {
    if (process.env.OMP_SETTINGS_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_SETTINGS_EVIDENCE_ROOT, `pi-${Date.now()}.json`), JSON.stringify({ test: t.name, node: process.version, scope: "SOURCE_PI130_LOOPBACK_ONLY", requests: f.requests.map(r => r.body), tasks: f.host.tasks.snapshot(), settings: await settings(f, { type: "list" }) }, null, 2));
    await f.close();
  });
  const changed = await run(f, ["settings", "set", "context-doctor", "--revision", "0", "--parameters", '{"label":"CLI-default"}']);
  assert.equal(changed.code, 0, changed.stderr);
  let shared = await settings(f, { type: "list" });
  assert.equal(shared.resources.find(r => r.id === "context-doctor").parameters.label, "CLI-default");
  const first = await f.start({ prompt: "measure context" }); await untilPiInitialized(() => f.task(first.taskId));
  const completed = await waitTask(f, first.taskId);
  assert.equal(completed.status, "succeeded", JSON.stringify(completed));
  assert.match(completed.messages.find(m => m.toolName === "context_snapshot").text, /^CLI-default:/);
  assert.equal(completed.settingsLoaded.revision, 1);
  shared = await settings(f, { type: "set", revision: 1, id: "context-doctor", parameters: { label: "GUI-project" } });
  const read = await run(f, ["settings", "list", "--project", f.project]); assert.equal(read.code, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).resources.find(r => r.id === "context-doctor").parameters.label, "GUI-project");
  const cli = await run(f, ["--model", "fixture/one", "--no-session", "-p", "measure next context"]);
  assert.equal(cli.code, 0, cli.stderr);
  assert.ok(f.requests.some(r => r.body.messages.some(m => m.role === "tool" && String(m.content).startsWith("GUI-project:"))), "independent model receiver observed the actual CLI tool result");
  shared = await settings(f, { type: "list" }); assert.equal(shared.lastLoaded.revision, 2); assert.equal(shared.pending, false);
  const skill = path.join(f.root, "SKILL.md"), content = "---\nname: shared-diagnostic\ndescription: Explicit imported diagnostic instructions\ncompatibility: pi-1.3.0\n---\nReport SHARED_SKILL_MARKER and measure context.\n";
  await fs.writeFile(skill, content);
  const preview = await run(f, ["settings", "preview", skill]); assert.equal(preview.code, 0, preview.stderr);
  const imported = await run(f, ["settings", "import", skill, "--revision", "2", "--digest", JSON.parse(preview.stdout).digest]); assert.equal(imported.code, 0, imported.stderr);
  assert.equal(f.requests.length, 4, "import did not issue a model or tool request");
  await settings(f, { type: "set", revision: 3, id: "skill:shared-diagnostic", enabled: true });
  const terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one"], { cwd: f.project, env: f.cliEnv, cols: 140, rows: 42 });
  let transcript = "", exited;
  terminal.onData(data => { transcript += data; }); terminal.onExit(value => { exited = value; });
  try {
    await until(() => transcript, text => text.includes("[Extensions]") && text.includes("OMP · Inspect"), "real settings TUI ready", 30000);
    terminal.write("/skill:shared-diagnostic\r");
    await until(() => ({ transcript, count: f.requests.length }), value => value.count > 4 || value.transcript.includes('Skill "shared-diagnostic"') && value.transcript.includes("Allow once"), "native skill permission decision or admitted request", 30000).then(value => { if (value.count === 4) terminal.write("\r"); });
    await until(() => f.requests.length, count => count === 6, "approved Pi skill expansion and diagnostic result", 30000);
    assert.ok(f.requests.slice(4).some(r => JSON.stringify(r.body.messages).includes("SHARED_SKILL_MARKER")), "approved native skill expansion reached the independent model receiver");
    await until(() => transcript, text => text.includes("MCP fixture completed"), "real TUI completed response");
    terminal.write("/exit\r");
    await until(() => exited && !groupAlive(terminal.pid), Boolean, "settings TUI clean exit", 10000);
    assert.equal(exited.exitCode, 0);
  } finally {
    if (!exited) { terminal.write("\x1b"); terminal.write("\x04"); try { await until(() => exited, Boolean, "failed settings fixture exit", 2000); } catch { terminal.kill("SIGKILL"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "forced fixture exit confirmed", 5000); } }
    if (process.env.OMP_SETTINGS_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_SETTINGS_EVIDENCE_ROOT, `pty-${Date.now()}.json`), JSON.stringify({ transcript, exited, pid: terminal.pid, groupAlive: groupAlive(terminal.pid) }));
  }
  assert.equal(await fs.readFile(skill, "utf8"), content);
  const loaded = await settings(f, { type: "list" }); assert.equal(loaded.lastLoaded.revision, 4);
  const extensionFile = path.join(f.omp, "extensions/context-doctor/index.ts"), originalExtension = await fs.readFile(extensionFile);
  await fs.writeFile(extensionFile, "export default function broken( {");
  const broken = await f.start({ prompt: "invalid resource must not send" });
  assert.equal((await waitTask(f, broken.taskId)).status, "failed");
  const rejectedLoad = await settings(f, { type: "list" });
  assert.equal(rejectedLoad.lastFailure.code, "RESOURCE_LOAD_FAILED"); assert.equal(rejectedLoad.lastLoaded.revision, 4);
  assert.equal(rejectedLoad.pending, true, "a failed reload of the same version is not a loaded current version");
  assert.equal(f.requests.length, 6); await fs.writeFile(extensionFile, originalExtension);
  await fs.writeFile(path.join(f.config, "only-my-pi/product-settings/skills", loaded.resources.find(r => r.kind === "skill").contentDigest, "SKILL.md"), "changed source");
  await f.request("/api/command", { type: "startTask", requestId: randomUUID(), projectId: f.projectId, accountId: "cli-readonly", model: "fixture/one", prompt: "must not send" }, 409);
  const failure = await settings(f, { type: "list" });
  assert.equal(failure.lastLoaded.revision, 4); assert.equal(failure.lastFailure.code, "RESOURCE_IDENTITY_CHANGED");
  assert.equal(failure.pending, true);
  assert.equal(f.requests.length, 6, "failed loading never sent a model request");
});

test("an active real TUI refuses native skill expansion after disable and re-enable", { timeout: 90000 }, async t => {
  let held = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await createMcpHost({ installedExtensions: true, respond: async ({ res }) => { held = true; await gate; providerReply(res, null, {}); } });
  const skill = path.join(f.root, "SKILL.md");
  await fs.writeFile(skill, "---\nname: revoked-skill\ndescription: Revocation fixture\ncompatibility: pi-1.3.0\n---\nREVOKED_SKILL_MUST_NOT_EXPAND\n");
  const preview = await run(f, ["settings", "preview", skill]); assert.equal(preview.code, 0, preview.stderr);
  const imported = await run(f, ["settings", "import", skill, "--revision", "0", "--digest", JSON.parse(preview.stdout).digest]); assert.equal(imported.code, 0, imported.stderr);
  await settings(f, { type: "set", revision: 1, id: "skill:revoked-skill", enabled: true });
  const terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one"], { cwd: f.project, env: f.cliEnv, cols: 140, rows: 42 });
  let transcript = "", exited;
  terminal.onData(data => { transcript += data; }); terminal.onExit(value => { exited = value; });
  t.after(async () => {
    release();
    if (!exited) { terminal.write("\x1b"); terminal.write("/exit\r"); try { await until(() => exited && !groupAlive(terminal.pid), Boolean, "revocation TUI exit", 3000); } catch { terminal.kill("SIGKILL"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "revocation fixture cleanup", 5000); } }
    if (process.env.OMP_SETTINGS_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_SETTINGS_EVIDENCE_ROOT, `skill-revocation-${Date.now()}.json`), JSON.stringify({ transcript, requests: f.requests.map(r => r.body), exited }));
    await f.close();
  });
  await until(() => transcript, text => text.includes("[Extensions]") && text.includes("OMP · Inspect"), "revocation TUI ready", 30000);
  terminal.write("hold active run\r"); await until(() => held, Boolean, "active model request held", 30000);
  await settings(f, { type: "set", revision: 2, id: "skill:revoked-skill", enabled: false });
  await settings(f, { type: "set", revision: 3, id: "skill:revoked-skill", enabled: true });
  terminal.write("/skill:revoked-skill\r");
  await until(() => transcript, text => text.includes("RESOURCE_DISABLED_OR_REVOKED"), "native skill rejected before expansion", 7500);
  release(); await until(() => transcript, text => text.includes("MCP fixture completed"), "original task completed");
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.stringify(f.requests.map(r => r.body)).includes("REVOKED_SKILL_MUST_NOT_EXPAND"), false);
  terminal.write("/exit\r"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "revocation TUI clean exit", 10000);
  assert.equal(exited.exitCode, 0);
});

test("real Pi freezes the active loadout and pauses old revision FIFO until explicitly rebound and resubmitted", { timeout: 120000 }, async t => {
  let release, held;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await createMcpHost({ installedExtensions: true, respond: async ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(m => m.role === "user"), tools = body.messages.slice(lastUser + 1).filter(m => m.role === "tool");
    if (!held && !tools.length) { held = true; await gate; }
    providerReply(res, tools.length ? null : "context_snapshot", {});
  } });
  t.after(() => { release(); return f.close(); });
  await settings(f, { type: "set", id: "context-doctor", revision: 0, parameters: { label: "frozen" } });
  const first = await f.start({ prompt: "first frozen run" });
  const active = await until(() => f.task(first.taskId), task => task.status === "running" && held, "held real Pi request", 30000);
  const target = { projectId: f.projectId, taskId: first.taskId };
  const inputCommand = async (input, status = 200) => {
    const response = await fetch(f.host.origin + "/api/input-command", { method: "POST", headers: { Origin: f.host.origin, Cookie: f.cookie, "content-type": "application/json", "x-omp-host-protocol": "2", "x-omp-input-protocol": "1" }, body: JSON.stringify({ ...input, target }) });
    const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
  };
  const input = { inputId: "settings-queue", delivery: "queue", text: "next queued run", materialSnapshotIds: [], binding: { accountId: "cli-readonly", modelId: "fixture/one", thinking: active.thinkingLevel, mode: "readonly", resourceRevision: active.resourceRevision } };
  await inputCommand({ type: "enqueueInput", predecessorTaskId: first.taskId, input, expectedRevision: 0 });
  const next = await settings(f, { type: "set", id: "context-doctor", revision: 1, parameters: { label: "next-version" } });
  release(); const done = await waitTask(f, first.taskId);
  assert.match(done.messages.find(m => m.toolName === "context_snapshot").text, /^frozen:/);
  const paused = await until(() => inputCommand({ type: "getInputs" }), value => value.queue.items[0]?.state === "paused", "old settings queue paused");
  assert.equal(f.requests.length, 2, "old revision did not create another model run");
  await inputCommand({ type: "resumeQueue", expectedRevision: paused.queue.revision }, 409);
  assert.equal(f.requests.length, 2);
  const rebound = await inputCommand({ type: "editQueuedInput", input: { ...input, binding: { ...input.binding, resourceRevision: next.resourceRevision } }, expectedRevision: paused.queue.revision, expectedInputRevision: paused.queue.items[0].revision });
  await inputCommand({ type: "resumeQueue", expectedRevision: rebound.revision });
  const successor = await until(() => f.request("/api/state"), state => state.tasks.find(task => task.taskId !== first.taskId), "explicit successor admitted", 30000);
  const finished = await waitTask(f, successor.tasks.find(task => task.taskId !== first.taskId).taskId);
  assert.equal(finished.status, "succeeded", JSON.stringify(finished));
  assert.match(finished.messages.find(m => m.toolName === "context_snapshot").text, /^next-version:/);
  assert.equal(f.requests.length, 4);
  assert.equal(f.host.tasks.workers.size, 0); assert.equal(f.host.tasks.leases.size, 0);
});

test("disabling revokes an active real Pi tool immediately; enabling again never revives the old snapshot", { timeout: 120000 }, async t => {
  let release, held;
  const gate = new Promise(resolve => { release = resolve; });
  const f = await createMcpHost({ installedExtensions: true, respond: async ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(m => m.role === "user"), tools = body.messages.slice(lastUser + 1).filter(m => m.role === "tool");
    if (!held && !tools.length) { held = true; await gate; }
    providerReply(res, tools.length ? null : "context_snapshot", {});
  } });
  t.after(() => { release(); return f.close(); });
  const first = await f.start(); await until(() => held, Boolean, "first model request held", 30000);
  await settings(f, { type: "set", id: "context-doctor", revision: 0, enabled: false });
  await settings(f, { type: "set", id: "context-doctor", revision: 1, enabled: true });
  release(); const denied = await waitTask(f, first.taskId);
  assert.match(denied.messages.find(m => m.toolName === "context_snapshot").text, /RESOURCE_DISABLED_OR_REVOKED/);
  const second = await f.start(); const allowed = await waitTask(f, second.taskId);
  assert.match(allowed.messages.find(m => m.toolName === "context_snapshot").text, /^ctx:/);
  await settings(f, { type: "set", id: "context-doctor", revision: 2, enabled: false });
  const third = await f.start(); await waitTask(f, third.taskId);
  assert.equal(f.requests[4].body.tools.some(tool => tool.function.name === "context_snapshot"), false, "disabled resource is absent from the actual model declaration");
});

test("the next task in the same real CLI TUI reloads settings only after logical settlement", { timeout: 120000 }, async t => {
  const f = await createMcpHost({ installedExtensions: true, verifyNode: true, respond: ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(m => m.role === "user"), tools = body.messages.slice(lastUser + 1).filter(m => m.role === "tool");
    providerReply(res, tools.length ? null : "context_snapshot", {});
  } });
  const terminal = pty.spawn(process.execPath, [f.cli, "--model", "fixture/one"], { cwd: f.project, env: f.cliEnv, cols: 140, rows: 42 });
  let transcript = "", exited;
  terminal.onData(data => { transcript += data; }); terminal.onExit(value => { exited = value; });
  t.after(async () => {
    if (!exited) { terminal.write("\x1b"); terminal.write("/exit\r"); try { await until(() => exited && !groupAlive(terminal.pid), Boolean, "failed TUI normal cleanup", 3000); } catch { terminal.kill("SIGKILL"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "failed TUI forced cleanup", 5000); } }
    if (process.env.OMP_SETTINGS_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_SETTINGS_EVIDENCE_ROOT, `tui-refresh-${Date.now()}.json`), JSON.stringify({ transcript, requests: f.requests.map(r => r.body), exited, pid: terminal.pid, groupAlive: groupAlive(terminal.pid) }));
    await f.close();
  });
  await until(() => transcript, text => text.includes("[Extensions]") && text.includes("OMP · Inspect"), "TUI ready", 30000);
  terminal.write("measure first\r");
  await until(() => transcript, text => text.includes("MCP fixture completed"), "first logical run returned", 30000);
  await settings(f, { type: "set", id: "context-doctor", revision: 0, parameters: { label: "TUI-next" } });
  terminal.write("measure next\r");
  await until(() => f.requests, requests => requests.some(r => r.body.messages.some(m => m.role === "tool" && String(m.content).startsWith("TUI-next:"))), "next logical TUI task actually consumed new parameters", 30000);
  await until(() => transcript, text => text.includes("TUI-next:"), "new result rendered");
  terminal.write("/exit\r"); await until(() => exited && !groupAlive(terminal.pid), Boolean, "TUI normal exit", 10000);
  assert.equal(exited.exitCode, 0); assert.equal(exited.signal, 0);
});

test("public Host skill invocation separates enablement from native first-use consent", { timeout: 90000 }, async t => {
  const f = await createMcpHost({ installedExtensions: true, verifyNode: true, respond: ({ body, res }) => {
    const lastUser = body.messages.findLastIndex(m => m.role === "user"), tools = body.messages.slice(lastUser + 1).filter(m => m.role === "tool");
    providerReply(res, tools.length ? null : "context_snapshot", {});
  } });
  t.after(async () => {
    if (process.env.OMP_SETTINGS_EVIDENCE_ROOT) await fs.writeFile(path.join(process.env.OMP_SETTINGS_EVIDENCE_ROOT, `host-skill-consent-${Date.now()}.json`), JSON.stringify({ test: t.name, node: process.version, requests: f.requests.map(r => r.body), tasks: f.host.tasks.snapshot() }));
    await f.close();
  });
  const skill = path.join(f.root, "SKILL.md"), content = "---\nname: host-consent\ndescription: Explicit Host consent diagnostic\ncompatibility: pi-1.3.0\n---\nHOST_SKILL_APPROVAL_MARKER: measure context.\n";
  await fs.writeFile(skill, content);
  const preview = await run(f, ["settings", "preview", skill]); assert.equal(preview.code, 0, preview.stderr);
  const imported = await run(f, ["settings", "import", skill, "--revision", "0", "--digest", JSON.parse(preview.stdout).digest]); assert.equal(imported.code, 0, imported.stderr);
  await settings(f, { type: "set", id: "skill:host-consent", revision: 1, enabled: true });
  assert.equal(f.requests.length, 0);
  for (const decision of ["Deny", "Allow once"]) {
    const started = await f.start({ prompt: "/skill:host-consent" });
    const pending = await until(() => f.task(started.taskId), task => task.approvals.some(a => a.title.startsWith('Skill "host-consent" — first use')), "native skill first-use consent", 30000);
    assert.equal(f.requests.length, 0, "enablement and pending consent do not dispatch");
    await f.request("/api/command", { type: "answerApproval", taskId: started.taskId, approvalId: pending.approvals[0].approvalId, value: decision });
    const done = await waitTask(f, started.taskId); assert.equal(done.status, "succeeded", JSON.stringify(done));
    assert.equal(f.host.tasks.workers.size, 0); assert.equal(f.host.tasks.leases.size, 0);
    if (decision === "Deny") { assert.equal(f.requests.length, 0); assert.equal(done.inputFeedback[0].disposition, "handled"); }
    else {
      assert.equal(f.requests.length, 2);
      assert.ok(JSON.stringify(f.requests[0].body.messages).includes("HOST_SKILL_APPROVAL_MARKER"));
      assert.match(done.messages.find(m => m.toolName === "context_snapshot").text, /^ctx:/);
      assert.deepEqual(done.settingsLoaded.skills, ["host-consent"]);
    }
  }
  assert.equal(await fs.readFile(skill, "utf8"), content);
});
