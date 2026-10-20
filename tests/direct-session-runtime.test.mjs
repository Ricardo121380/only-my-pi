import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import * as sdk from "@earendil-works/pi-coding-agent";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { createAdmittedSessionRuntime } from "../packages/direct-agent/session-runtime.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";
import { prepareHeadlessSession } from "../packages/direct-agent/session-selection.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function seedFork(runtime) {
  const manager = runtime.session.sessionManager;
  const first = manager.appendMessage({ role: "user", content: "first", timestamp: Date.now() });
  const answer = manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], timestamp: Date.now() });
  const second = manager.appendMessage({ role: "user", content: [{ type: "text", text: "second" }], timestamp: Date.now() });
  return { first, answer, second };
}

test("fatal notification runs after transition settlement so bounded disposal cannot wait on itself", { timeout: 5_000 }, async (t) => {
  const f = await fixture(t, { beforeSwitch: () => { throw new Error("fixture failure"); } });
  let runtime, notified = 0;
  runtime = await f.start({ sessionFile: f.files.source, onFatal: async error => {
    notified++;
    assert.equal(error.code, "SESSION_LIFECYCLE_UNCONFIRMED");
    await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  } });
  await assert.rejects(runtime.newSession(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  assert.equal(notified, 1);
  assert.deepEqual(f.events, ["source:quit"]);
  await assert.rejects(runtime.newSession(), { code: "OWNER_CLOSING" });
  await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
});

test("prepared empty session enters runtime with its original reserved manager and identity", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareHeadlessSession({ args: ["--session-dir", f.sessions], sdk,
    admissions: f.admissions, configRoot: f.config, cwd: f.root, env: {} });
  const manager = prepared.sessionManager, id = prepared.target.id;
  assert.equal(manager.getSessionId(), id);
  await assert.rejects(fs.stat(manager.getSessionFile()), { code: "ENOENT" });
  const runtime = await f.start({ sessionManager: manager });
  assert.equal(runtime.session.sessionManager, manager);
  assert.equal(runtime.session.sessionId, id);
  await assert.rejects(f.start({ sessionManager: manager }), { code: "SESSION_TARGET_INVALID" });
  await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
  await runtime.switchSession(f.files.target);
  await runtime.dispose();
  const owner = await acquireOwnership(f.config, "session", id); await owner.release();
});

test("unowned or identity-replaced managers cannot initialize a runtime", async (t) => {
  const f = await fixture(t, { factoryHook: () => assert.fail("factory must not run") });
  await assert.rejects(f.start({ sessionManager: sdk.SessionManager.inMemory(f.root) }), { code: "SESSION_TARGET_INVALID" });
  const manager = await f.admissions.create(f.root, f.sessions);
  manager.newSession();
  await assert.rejects(f.start({ sessionManager: manager }), { code: "SESSION_TARGET_CHANGED" });
});

test("initial missing cwd is refused before history migration or runtime creation", async (t) => {
  const f = await fixture(t, { factoryHook: () => assert.fail("factory must not run") });
  const bytes = JSON.stringify({ type: "session", version: 1, id: "source",
    cwd: path.join(f.root, "missing"), timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(f.files.source, bytes);
  await assert.rejects(f.start(), { code: "SESSION_CWD_INVALID" });
  assert.equal(await fs.readFile(f.files.source, "utf8"), bytes);
});

test("import missing cwd is recoverable before copy, migration or shutdown", async (t) => {
  const f = await fixture(t), incoming = await f.external(), runtime = await f.start();
  const header = JSON.parse(incoming.contents);
  header.cwd = path.join(f.root, "missing");
  const bytes = JSON.stringify(header) + "\n";
  await fs.writeFile(incoming.file, bytes);
  await assert.rejects(runtime.importFromJsonl(incoming.file), { code: "SESSION_CWD_INVALID" });
  assert.equal(await fs.readFile(incoming.file, "utf8"), bytes);
  assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
  assert.equal(runtime.session.sessionId, "source");
  assert.deepEqual(f.events, []);
  await runtime.importFromJsonl(incoming.file, f.root);
  assert.equal(runtime.cwd, f.root);
  assert.equal(runtime.session.sessionId, "imported");
  assert.equal(await fs.readFile(incoming.file, "utf8"), bytes);
  await runtime.dispose();
});

test("missing history cwd is refused before migration and explicit correction keeps runtime usable", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  const header = { type: "session", version: 1, id: "target", cwd: path.join(f.root, "missing"), timestamp: new Date().toISOString() };
  const bytes = JSON.stringify(header) + "\n";
  await fs.writeFile(f.files.target, bytes);
  await assert.rejects(runtime.switchSession(f.files.target), { code: "SESSION_CWD_INVALID" });
  assert.equal(await fs.readFile(f.files.target, "utf8"), bytes);
  assert.equal(runtime.session.sessionId, "source"); assert.deepEqual(f.events, []);
  await runtime.switchSession(f.files.target, { cwdOverride: f.root });
  assert.equal(runtime.session.sessionId, "target"); assert.equal(runtime.cwd, f.root);
  await runtime.dispose();
});

test("fork before a root user creates an empty child with the source as parent", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  runtime.session.sessionManager.resetLeaf();
  const first = runtime.session.sessionManager.appendMessage({ role: "user", content: "root", timestamp: 1 });
  assert.deepEqual(await runtime.fork(first), { cancelled: false, selectedText: "root" });
  assert.equal(runtime.session.sessionManager.getHeader().parentSession, f.files.source);
  assert.equal(runtime.session.sessionManager.getEntry(first), undefined);
  assert.equal(runtime.session.agent.state.messages.length, 0);
  await runtime.dispose();
});

test("quit waits for in-flight fork and rejects competing replacements", async (t) => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(t, { factoryHook: async (id) => {
    if (id !== "source") { entered.resolve(); await finish.promise; }
  } }), runtime = await f.start(), ids = seedFork(runtime);
  const forking = runtime.fork(ids.second); await entered.promise;
  await assert.rejects(runtime.fork(ids.second), { code: "SESSION_TRANSITION_IN_PROGRESS" });
  const disposal = runtime.dispose();
  await assert.rejects(runtime.newSession(), { code: "OWNER_CLOSING" });
  finish.resolve(); await forking; const id = runtime.session.sessionId; await disposal;
  assert.deepEqual(f.events, ["source:fork", `${id}:quit`]);
});

test("fork before user preserves context, selected text, parent and lifecycle callbacks", async (t) => {
  const starts = [], before = [], order = [];
  const f = await fixture(t, { sessionStart: (event) => starts.push(event), beforeFork: (event) => before.push(event) });
  const runtime = await f.start(), ids = seedFork(runtime);
  runtime.setBeforeSessionInvalidate(() => order.push("invalidate"));
  runtime.setRebindSession(() => order.push("rebind"));
  const result = await runtime.fork(ids.second, { withSession: () => order.push("context") });
  assert.deepEqual(result, { cancelled: false, selectedText: "second" });
  assert.deepEqual(order, ["invalidate", "rebind", "context"]);
  assert.equal(before[0].position, "before"); assert.equal(starts.at(-1).reason, "fork");
  assert.equal(starts.at(-1).previousSessionFile, f.files.source);
  assert.equal(runtime.session.sessionManager.getHeader().parentSession, f.files.source);
  assert.ok(runtime.session.sessionManager.getEntry(ids.answer));
  assert.equal(runtime.session.sessionManager.getEntry(ids.second), undefined);
  const id = runtime.session.sessionId, file = runtime.session.sessionFile;
  await runtime.switchSession(f.files.source); await runtime.switchSession(file); await runtime.dispose();
  const lease = await acquireOwnership(f.config, "session", id); await lease.release();
});

test("fork at an assistant keeps that entry and invalid requests leave source usable", async (t) => {
  const f = await fixture(t), runtime = await f.start(), ids = seedFork(runtime);
  for (const [entry, options] of [[ids.answer, undefined], ["missing", undefined], [ids.first, { position: "invalid" }]])
    await assert.rejects(runtime.fork(entry, options), { code: "SESSION_FORK_ENTRY_INVALID" });
  assert.equal(f.admissions.reservations.size, 0);
  const result = await runtime.fork(ids.answer, { position: "at" });
  assert.equal(result.selectedText, undefined);
  assert.ok(runtime.session.sessionManager.getEntry(ids.answer));
  assert.equal(runtime.session.sessionManager.getEntry(ids.second), undefined);
  await runtime.dispose();
});

test("fork cancellation and a reentrant request create no target", async (t) => {
  let runtime;
  const f = await fixture(t, { beforeFork: async () => {
    await assert.rejects(runtime.newSession(), { code: "SESSION_TRANSITION_IN_PROGRESS" });
    return { cancel: true };
  } });
  runtime = await f.start(); const ids = seedFork(runtime), before = await fs.readFile(f.files.source);
  assert.deepEqual(await runtime.fork(ids.second), { cancelled: true });
  assert.deepEqual(await fs.readFile(f.files.source), before);
  assert.equal(f.admissions.reservations.size, 0);
  await runtime.dispose();
});

test("fork factory failure retains source and target and prevents retry", async (t) => {
  const f = await fixture(t, { factoryHook: (id) => { if (id !== "source") throw new Error("fork factory failed"); } });
  const runtime = await f.start(), ids = seedFork(runtime);
  await assert.rejects(runtime.fork(ids.second), /fork factory failed/);
  const [id] = f.admissions.reservations.keys(); assert.ok(id);
  await assert.rejects(runtime.fork(ids.second), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  for (const owned of ["source", id]) await assert.rejects(acquireOwnership(f.config, "session", owned), { code: "OWNERSHIP_HELD" });
});

test("fork handler errors swallowed by Pi fail closed before reservation", async (t) => {
  const f = await fixture(t, { beforeFork: () => { throw new Error("fork hook failed"); } });
  const runtime = await f.start(), ids = seedFork(runtime);
  await assert.rejects(runtime.fork(ids.second), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  assert.equal(f.admissions.reservations.size, 0);
  await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
});

async function fixture(t, { shutdown, beforeSwitch, beforeFork, factoryHook, sessionStart } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-runtime-")));
  const config = path.join(root, "config"), sessions = path.join(root, "sessions");
  await fs.mkdir(config); await fs.mkdir(sessions);
  const files = Object.fromEntries(["source", "target"].map((id) => [id, path.join(sessions, `${id}.jsonl`)]));
  for (const [id, file] of Object.entries(files)) await fs.writeFile(file,
    JSON.stringify({ type: "session", version: 1, id, cwd: root, timestamp: new Date().toISOString() }) + "\n");
  const state = { active: 0, unconfirmed: false }, events = [];
  const admissions = new SessionAdmissions(config, { executionState: () => state });
  t.after(async () => {
    // Fixture-only cleanup after all tested operations settled. Not recovery of
    // an actual user's unconfirmed runtime.
    state.active = 0; state.unconfirmed = false;
    await admissions.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  sdk.initTheme("dark", false);
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(config, "auth.json"),
    modelsPath: path.join(config, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const model = { id: "fixture", name: "fixture", api: "openai-completions", provider: "fixture",
    baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 };
  const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const id = sessionManager.getSessionId();
    await assert.rejects(acquireOwnership(config, "session", id), { code: "OWNERSHIP_HELD" });
    await factoryHook?.(id);
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({}),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        extensionFactories: [(pi) => {
          pi.on("session_before_switch", (event) => beforeSwitch?.(event));
          pi.on("session_before_fork", (event) => beforeFork?.(event));
          pi.on("session_start", (event) => sessionStart?.(event, id));
          pi.on("session_shutdown", async (event) => {
            await assert.rejects(acquireOwnership(config, "session", id), { code: "OWNERSHIP_HELD" });
            await shutdown?.(id, event);
            sessionManager.appendCustomEntry("shutdown-proof", { id, reason: event.reason });
            events.push(`${id}:${event.reason}`);
          });
        }] } });
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, noTools: true });
    await created.session.bindExtensions({ mode: "tui" });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  const start = (selection = { sessionFile: files.source }) => createAdmittedSessionRuntime({ sdk, admissions, ...selection, createRuntime });
  const external = async (name = "target.jsonl") => {
    const directory = path.join(root, "incoming"); await fs.mkdir(directory, { recursive: true });
    const file = path.join(directory, name);
    const contents = JSON.stringify({ type: "session", version: 1, id: "imported", cwd: root, timestamp: new Date().toISOString() }) + "\n";
    await fs.writeFile(file, contents); return { file, contents };
  };
  return { root, config, sessions, files, state, admissions, events, start, external };
}

test("owned runtime refuses initial occupied history before migration or factory execution", async (t) => {
  const f = await fixture(t, { factoryHook: () => assert.fail("factory must not run") });
  const before = await fs.readFile(f.files.source), owner = await acquireOwnership(f.config, "session", "source");
  try {
    await assert.rejects(f.start(), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.deepEqual(await fs.readFile(f.files.source), before);
  } finally { await owner.release(); }
});

test("real SDK runtime resumes under locks, retains source, then releases after shutdown writes", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  assert.equal(runtime.cwd, f.root);
  assert.equal(runtime.services.cwd, f.root);
  const rebound = [];
  runtime.setRebindSession(async (session) => { rebound.push(session.sessionId); });
  assert.deepEqual(await runtime.switchSession(f.files.target), { cancelled: false });
  assert.deepEqual(await runtime.switchSession(f.files.source), { cancelled: false });
  assert.deepEqual(rebound, ["target", "source"]);
  for (const id of ["source", "target"]) await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
  const disposal = runtime.dispose(); assert.equal(runtime.dispose(), disposal);
  await disposal;
  assert.deepEqual(f.events, ["source:resume", "target:resume", "source:quit"]);
  for (const [id, file] of Object.entries(f.files)) {
    assert.match(await fs.readFile(file, "utf8"), /shutdown-proof/);
    const next = await acquireOwnership(f.config, "session", id); await next.release();
  }
  await assert.rejects(runtime.switchSession(f.files.target), { code: "OWNER_CLOSING" });
});

test("occupied target and unsupported mutations leave the source usable and histories unchanged", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  const before = await fs.readFile(f.files.target), owner = await acquireOwnership(f.config, "session", "target");
  try {
    await assert.rejects(runtime.switchSession(f.files.target), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.equal(runtime.session.sessionId, "source");
    await assert.rejects(runtime.fork("entry"), { code: "SESSION_FORK_ENTRY_INVALID" });
    assert.deepEqual(await fs.readFile(f.files.target), before);
    assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
  } finally { await owner.release(); }
  await runtime.switchSession(f.files.target);
  await runtime.dispose();
});

test("before-switch cancellation is preserved without tearing down the current session", async (t) => {
  const f = await fixture(t, { beforeSwitch: () => ({ cancel: true }) }), runtime = await f.start();
  const before = await fs.readFile(f.files.target);
  assert.deepEqual(await runtime.switchSession(f.files.target), { cancelled: true });
  assert.equal(runtime.session.sessionId, "source"); assert.deepEqual(f.events, []);
  assert.deepEqual(await fs.readFile(f.files.target), before);
  await runtime.dispose();
});

test("dispose waits for in-flight replacement and rejects overlapping or late switches", async (t) => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(t, { factoryHook: async (id) => { if (id === "target") { entered.resolve(); await finish.promise; } } });
  const runtime = await f.start(), switching = runtime.switchSession(f.files.target);
  await entered.promise;
  await assert.rejects(runtime.switchSession(f.files.source), { code: "SESSION_TRANSITION_IN_PROGRESS" });
  let disposed = false;
  const closing = runtime.dispose().then(() => { disposed = true; });
  await assert.rejects(runtime.switchSession(f.files.source), { code: "OWNER_CLOSING" });
  assert.equal(disposed, false);
  await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
  finish.resolve(); await switching; await closing;
  assert.deepEqual(f.events, ["source:resume", "target:quit"]);
});

test("quit holds ownership until the last asynchronous shutdown handler completes", async (t) => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(t, { shutdown: async () => { entered.resolve(); await finish.promise; } });
  const runtime = await f.start(), disposal = runtime.dispose();
  await entered.promise;
  await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
  finish.resolve(); await disposal;
  const next = await acquireOwnership(f.config, "session", "source"); await next.release();
});

test("a shutdown handler error swallowed by Pi still prevents ownership release", async (t) => {
  const f = await fixture(t, { shutdown: () => { throw new Error("fixture cleanup failed"); } }), runtime = await f.start();
  const disposal = runtime.dispose();
  await assert.rejects(disposal, { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  assert.equal(runtime.dispose(), disposal);
  await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
});

test("uncertain child execution prevents release even after SDK disposal succeeds", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  f.state.unconfirmed = true;
  await assert.rejects(runtime.dispose(), { code: "OWNER_TERMINATION_UNCONFIRMED" });
  await assert.rejects(acquireOwnership(f.config, "session", "source"), { code: "OWNERSHIP_HELD" });
});

test("replacement factory failure is not retried and retains both histories", async (t) => {
  const f = await fixture(t, { factoryHook: (id) => { if (id === "target") throw new Error("fixture factory failed"); } });
  const runtime = await f.start();
  await assert.rejects(runtime.switchSession(f.files.target), /fixture factory failed/);
  await assert.rejects(runtime.switchSession(f.files.source), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  for (const id of ["source", "target"]) await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
});

test("import copies under source ownership, preserves collisions and supports revisiting the copy", async (t) => {
  const f = await fixture(t), incoming = await f.external(), runtime = await f.start();
  const untouched = await fs.readFile(f.files.target);
  const expected = path.join(f.sessions, "target-1.jsonl");
  assert.deepEqual(await runtime.importFromJsonl(pathToFileURL(incoming.file).href), { cancelled: false });
  assert.equal(runtime.session.sessionFile, expected); assert.equal(runtime.session.sessionId, "imported");
  assert.equal(await fs.readFile(incoming.file, "utf8"), incoming.contents);
  assert.deepEqual(await fs.readFile(f.files.target), untouched);
  assert.equal(JSON.parse((await fs.readFile(expected, "utf8")).split("\n")[0]).version, 3);
  await runtime.switchSession(f.files.source);
  await runtime.switchSession(expected); // Must not deadlock on the shared source-ID lease.
  await runtime.dispose();
  for (const id of ["source", "imported"]) { const next = await acquireOwnership(f.config, "session", id); await next.release(); }
});

test("import cancellation happens under ownership before any copy is created", async (t) => {
  let f;
  f = await fixture(t, { beforeSwitch: async (event) => {
    await assert.rejects(acquireOwnership(f.config, "session", "imported"), { code: "OWNERSHIP_HELD" });
    await assert.rejects(fs.stat(event.targetSessionFile), { code: "ENOENT" });
    return { cancel: true };
  } });
  const incoming = await f.external(), runtime = await f.start();
  assert.deepEqual(await runtime.importFromJsonl(incoming.file), { cancelled: true });
  assert.equal(runtime.session.sessionId, "source");
  assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
  assert.equal(await fs.readFile(incoming.file, "utf8"), incoming.contents);
  await runtime.dispose();
});

test("occupied, missing and empty import sources leave the runtime usable without copying", async (t) => {
  const f = await fixture(t), incoming = await f.external(), runtime = await f.start();
  const owner = await acquireOwnership(f.config, "session", "imported");
  try {
    await assert.rejects(runtime.importFromJsonl(incoming.file), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    await assert.rejects(runtime.importFromJsonl(`${incoming.file}.missing`), { code: "ENOENT" });
    await assert.rejects(runtime.importFromJsonl(""), { code: "SESSION_TARGET_INVALID" });
    assert.equal(runtime.session.sessionId, "source");
    assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
  } finally { await owner.release(); }
  await runtime.importFromJsonl(path.relative(process.cwd(), incoming.file));
  await runtime.dispose();
});

test("importing an already stored file does not create a duplicate", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  await runtime.importFromJsonl(f.files.target);
  assert.equal(runtime.session.sessionFile, f.files.target);
  assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
  await runtime.dispose();
});

test("importing an external copy of the current ID shares ownership instead of self-conflicting", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  const external = path.join(f.root, "source.jsonl");
  await fs.copyFile(f.files.source, external);
  const before = await fs.readFile(external);
  await runtime.importFromJsonl(external);
  assert.equal(runtime.session.sessionId, "source");
  assert.equal(runtime.session.sessionFile, path.join(f.sessions, "source-1.jsonl"));
  assert.deepEqual(await fs.readFile(external), before);
  await runtime.switchSession(f.files.source);
  await runtime.dispose();
  const next = await acquireOwnership(f.config, "session", "source"); await next.release();
});

test("copy admission rejects a different ID and hard-linked copies", async (t) => {
  const f = await fixture(t), runtime = await f.start();
  await assert.rejects(f.admissions.admitOwnedCopy(f.files.source, f.files.target), { code: "SESSION_TARGET_CHANGED" });
  const link = path.join(f.sessions, "linked.jsonl");
  await fs.link(f.files.source, link);
  await assert.rejects(f.admissions.admitOwnedCopy(f.files.source, link), { code: "SESSION_TARGET_INVALID" });
  await fs.unlink(link);
  await runtime.dispose();
});

test("in-flight import rejects a competing switch and disposal waits for the imported session", async (t) => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(t, { factoryHook: async (id) => { if (id === "imported") { entered.resolve(); await finish.promise; } } });
  const incoming = await f.external(), runtime = await f.start();
  const importing = runtime.importFromJsonl(incoming.file); await entered.promise;
  await assert.rejects(runtime.switchSession(f.files.target), { code: "SESSION_TRANSITION_IN_PROGRESS" });
  const disposal = runtime.dispose();
  await assert.rejects(runtime.importFromJsonl(incoming.file), { code: "OWNER_CLOSING" });
  finish.resolve(); await importing; await disposal;
  assert.deepEqual(f.events, ["source:resume", "imported:quit"]);
});

test("import factory failure retains source ownership and the partial copy for reconciliation", async (t) => {
  const f = await fixture(t, { factoryHook: (id) => { if (id === "imported") throw new Error("import factory failed"); } });
  const incoming = await f.external(), runtime = await f.start();
  await assert.rejects(runtime.importFromJsonl(incoming.file), /import factory failed/);
  assert.equal(await fs.readFile(incoming.file, "utf8"), incoming.contents);
  assert.ok((await fs.stat(path.join(f.sessions, "target-1.jsonl"))).isFile());
  await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  for (const id of ["source", "imported"]) await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
});

test("new session reserves one ID, preserves new events, parent and setup/rebind/context order", async (t) => {
  const order = [], starts = [];
  const f = await fixture(t, {
    beforeSwitch: (event) => { assert.equal(event.reason, "new"); order.push("before"); },
    shutdown: (_id, event) => { if (event.reason === "new") order.push("shutdown"); },
    sessionStart: (event) => starts.push(event),
  }), runtime = await f.start();
  runtime.setBeforeSessionInvalidate(() => order.push("invalidate"));
  runtime.setRebindSession(() => order.push("rebind"));
  await runtime.newSession({ parentSession: f.files.source,
    setup: (manager) => {
      order.push("setup");
      manager.appendMessage({ role: "user", content: "seed", timestamp: Date.now() });
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: Date.now() });
    },
    withSession: (ctx) => { order.push("withSession"); assert.equal(ctx.sessionManager.getSessionId(), runtime.session.sessionId); },
  });
  assert.deepEqual(order, ["before", "shutdown", "invalidate", "setup", "rebind", "withSession"]);
  assert.equal(starts.at(-1).reason, "new");
  assert.equal(starts.at(-1).previousSessionFile, f.files.source);
  const id = runtime.session.sessionId, file = runtime.session.sessionFile;
  assert.notEqual(id, "source");
  assert.equal(f.admissions.reservations.size, 1);
  assert.equal(runtime.session.sessionManager.getHeader().parentSession, f.files.source);
  assert.equal(runtime.session.agent.state.messages[0].content, "seed");
  assert.equal((await f.admissions.admit(file)).id, id);
  await runtime.dispose();
  assert.deepEqual(f.events, ["source:new", `${id}:quit`]);
  assert.match(await fs.readFile(file, "utf8"), /shutdown-proof/);
  for (const owned of ["source", id]) { const lease = await acquireOwnership(f.config, "session", owned); await lease.release(); }
});

test("new cancellation does not reserve an ID, write a file or invalidate the current runtime", async (t) => {
  const f = await fixture(t, { beforeSwitch: () => ({ cancel: true }) }), runtime = await f.start();
  const before = await fs.readFile(f.files.source);
  runtime.setBeforeSessionInvalidate(() => assert.fail("must not invalidate"));
  assert.deepEqual(await runtime.newSession({ setup: () => assert.fail("must not setup") }), { cancelled: true });
  assert.equal(f.admissions.reservations.size, 0);
  assert.equal(runtime.session.sessionId, "source");
  assert.deepEqual(await fs.readFile(f.files.source), before);
  runtime.setBeforeSessionInvalidate(undefined);
  await runtime.dispose();
});

test("new session then resume/import keeps runtime callbacks wired to the current delegate", async (t) => {
  const f = await fixture(t), runtime = await f.start(), rebound = [], invalidated = [];
  runtime.setRebindSession((session) => rebound.push(session.sessionId));
  runtime.setBeforeSessionInvalidate(() => invalidated.push(runtime.session.sessionId));
  await runtime.newSession(); const id = runtime.session.sessionId;
  await runtime.switchSession(f.files.target);
  const incoming = await f.external(); await runtime.importFromJsonl(incoming.file);
  await runtime.dispose();
  assert.deepEqual(rebound, [id, "target", "imported"]);
  assert.deepEqual(invalidated, ["source", id, "target", "imported"]);
  const lease = await acquireOwnership(f.config, "session", id); await lease.release();
});

test("in-flight new session rejects competitors and quit waits for creation", async (t) => {
  const entered = deferred(), finish = deferred();
  const f = await fixture(t, { factoryHook: async (id) => {
    if (id !== "source") { entered.resolve(); await finish.promise; }
  } }), runtime = await f.start();
  const creating = runtime.newSession(); await entered.promise;
  await assert.rejects(runtime.newSession(), { code: "SESSION_TRANSITION_IN_PROGRESS" });
  await assert.rejects(runtime.switchSession(f.files.target), { code: "SESSION_TRANSITION_IN_PROGRESS" });
  const disposal = runtime.dispose();
  await assert.rejects(runtime.newSession(), { code: "OWNER_CLOSING" });
  finish.resolve(); await creating; const id = runtime.session.sessionId; await disposal;
  assert.deepEqual(f.events, ["source:new", `${id}:quit`]);
});

test("new factory and setup failures retain old and reserved leases, without retry", async (t) => {
  for (const failure of ["factory", "setup"]) await t.test(failure, async (t) => {
    const f = await fixture(t, { factoryHook: (id) => {
      if (failure === "factory" && id !== "source") throw new Error("new factory failed");
    } }), runtime = await f.start();
    await assert.rejects(runtime.newSession({ setup: () => { throw new Error("new setup failed"); } }), /new (factory|setup) failed/);
    const [id] = f.admissions.reservations.keys(); assert.ok(id);
    await assert.rejects(runtime.newSession(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
    await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
    for (const owned of ["source", id]) await assert.rejects(acquireOwnership(f.config, "session", owned), { code: "OWNERSHIP_HELD" });
  });
});

test("swallowed before-new and shutdown errors cannot create an unconfirmed replacement", async (t) => {
  for (const phase of ["before", "shutdown"]) await t.test(phase, async (t) => {
    let calls = 0;
    const f = await fixture(t, {
      factoryHook: () => { calls++; },
      beforeSwitch: () => { if (phase === "before") throw new Error("before failed"); },
      shutdown: () => { if (phase === "shutdown") throw new Error("shutdown failed"); },
    }), runtime = await f.start();
    await assert.rejects(runtime.newSession(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
    assert.equal(calls, 1);
    assert.equal(f.admissions.reservations.size, phase === "before" ? 0 : 1);
    await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
  });
});

test("resume and import stop at swallowed lifecycle errors before creating the next runtime", async (t) => {
  for (const operation of ["resume", "import"]) for (const phase of ["before", "shutdown"]) await t.test(`${operation}/${phase}`, async (t) => {
    let calls = 0;
    const f = await fixture(t, {
      factoryHook: () => { calls++; },
      beforeSwitch: () => { if (phase === "before") throw new Error("before failed"); },
      shutdown: () => { if (phase === "shutdown") throw new Error("shutdown failed"); },
    }), runtime = await f.start();
    const incoming = operation === "import" ? await f.external() : undefined;
    const before = await fs.readFile(f.files.target);
    await assert.rejects(incoming ? runtime.importFromJsonl(incoming.file) : runtime.switchSession(f.files.target),
      { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
    assert.equal(calls, 1, "failed lifecycle must not initialize target extensions");
    assert.equal(runtime.session.sessionId, "source");
    if (phase === "before") assert.deepEqual(await fs.readFile(f.files.target), before);
    if (incoming) {
      assert.equal(await fs.readFile(incoming.file, "utf8"), incoming.contents);
      if (phase === "before") assert.deepEqual((await fs.readdir(f.sessions)).sort(), ["source.jsonl", "target.jsonl"]);
    }
    await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
    for (const id of ["source", incoming ? "imported" : "target"])
      await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
  });
});

test("import cannot overwrite a destination created after its collision check", async (t) => {
  const marker = "concurrent user file\n";
  let destination, calls = 0;
  const f = await fixture(t, {
    factoryHook: () => { calls++; },
    beforeSwitch: async (event) => { destination = event.targetSessionFile; await fs.writeFile(destination, marker, { flag: "wx" }); },
  }), incoming = await f.external(), runtime = await f.start();
  await assert.rejects(runtime.importFromJsonl(incoming.file), { code: "EEXIST" });
  assert.equal(await fs.readFile(destination, "utf8"), marker);
  assert.equal(await fs.readFile(incoming.file, "utf8"), incoming.contents);
  assert.equal(calls, 1); assert.deepEqual(f.events, []);
  await assert.rejects(runtime.dispose(), { code: "SESSION_LIFECYCLE_UNCONFIRMED" });
});
