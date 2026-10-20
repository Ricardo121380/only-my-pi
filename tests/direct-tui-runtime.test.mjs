import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createDirectTuiRuntime } from "../packages/direct-agent/tui-runtime.mjs";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-tui-start-")));
  const configRoot = path.join(root, "config"), sessions = path.join(root, "sessions");
  await fs.mkdir(configRoot); await fs.mkdir(sessions);
  const extension = path.join(root, "fixture.mjs");
  await fs.writeFile(extension, `export default pi => {
    pi.registerFlag("perm", {type:"string", default:""});
    pi.registerProvider("fixture", {baseUrl:"http://127.0.0.1:1", api:"openai-completions", apiKey:"fixture",
      models:[{id:"one", name:"one", reasoning:true, input:["text"], contextWindow:32000, maxTokens:128,
        cost:{input:0, output:0, cacheRead:0, cacheWrite:0}}]});
  };`);
  const admissions = new SessionAdmissions(configRoot);
  // Provider registration refreshes credentials asynchronously in Pi. These
  // bootstrap unit tests need no credential files; keep the injected store in
  // memory so a late refresh cannot recreate auth.json during fixture cleanup.
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: {
    async read() { return undefined; }, async list() { return []; },
    async modify() { assert.fail("fixture credentials must not change"); },
    async delete() { assert.fail("fixture credentials must not change"); },
  }, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  const base = ["--no-extensions", "--extension", extension, "--tools", "read,ls", "--perm", "build", "--session-dir", sessions];
  const start = (extra = [], confirmProjectTrust, confirmSessionCwd) => createDirectTuiRuntime({ sdk, admissions, args: [...base, ...extra],
    configRoot, cwd: root, env: {}, modelRuntime, confirmProjectTrust, confirmSessionCwd });
  t.after(async () => { await admissions.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, configRoot, sessions, admissions, start };
}

test("candidate TUI bootstrap preserves model, thinking, name, messages and reserved identity", async (t) => {
  const f = await fixture(t);
  const result = await f.start(["--mode", "text", "--model", "fixture/one", "--thinking", "high", "--name", "session label", "--", "task one"]);
  assert.equal(result.runtime.session.model.id, "one");
  assert.equal(result.runtime.session.thinkingLevel, "high");
  assert.equal(result.runtime.session.sessionManager.getSessionName(), "session label");
  assert.equal(result.options.initialMessage, "task one");
  assert.deepEqual(result.options.initialMessages, []);
  assert.deepEqual(result.runtime.session.getActiveToolNames(), ["read", "ls"]);
  const id = result.runtime.session.sessionId;
  await assert.rejects(acquireOwnership(f.configRoot, "session", id), { code: "OWNERSHIP_HELD" });
  await result.runtime.dispose();
  const next = await acquireOwnership(f.configRoot, "session", id); await next.release();
});

test("candidate TUI preserves public custom-model semantics without choosing another model", async (t) => {
  const f = await fixture(t);
  const { runtime } = await f.start(["--model", "fixture/custom-one"]);
  assert.equal(runtime.session.model.id, "custom-one");
  assert.equal(runtime.session.model.provider, "fixture");
  assert.ok(runtime.diagnostics.some((entry) => entry.message.includes("Using custom model id")));
  await runtime.dispose();
});

test("candidate TUI rejects an unresolved model without changing providers", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.start(["--model", "unknown-provider/unknown-model"]), { code: "TUI_MODEL_NOT_FOUND" });
});

test("unsupported startup modes fail before any session reservation", async (t) => {
  const f = await fixture(t);
  for (const args of [["--print"], ["--mode", "rpc"]])
    await assert.rejects(f.start(args), { code: "TUI_STARTUP_OPTION_NOT_ADMITTED" });
  assert.equal(f.admissions.reservations.size, 0);
  assert.deepEqual(await fs.readdir(f.sessions), []);
});

test("no-session keeps initial, fork and new histories in memory with distinct owned IDs", async (t) => {
  const f = await fixture(t);
  const { runtime } = await f.start(["--no-session", "--session-id", "ephemeral", "--model", "fixture/one"]);
  const bind = (session) => session.bindExtensions({ mode: "tui" });
  await bind(runtime.session); runtime.setRebindSession(bind);
  const ids = [runtime.session.sessionId];
  const original = runtime.session.sessionManager;
  const first = original.appendMessage({ role: "user", content: "first", timestamp: 1 });
  original.appendLabelChange(first, "bookmark");
  original.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], timestamp: 2 });
  const selected = original.appendMessage({ role: "user", content: "redo", timestamp: 3 });
  const before = structuredClone(original.getEntries());
  assert.deepEqual(await runtime.fork(selected), { cancelled: false, selectedText: "redo" });
  assert.deepEqual(original.getEntries(), before);
  assert.equal(runtime.session.sessionManager.getLabel(first), "bookmark");
  assert.equal(runtime.session.sessionManager.getEntry(selected), undefined);
  ids.push(runtime.session.sessionId);
  assert.equal(runtime.session.sessionManager.isPersisted(), false);
  assert.equal(runtime.session.sessionFile, undefined);
  await assert.rejects(runtime.importFromJsonl("unused.jsonl"), { code: "SESSION_TARGET_INVALID" });
  assert.deepEqual(await runtime.newSession(), { cancelled: false });
  ids.push(runtime.session.sessionId);
  runtime.session.sessionManager.appendMessage({ role: "assistant", content: [], timestamp: 4 });
  assert.equal(runtime.session.sessionManager.isPersisted(), false);
  assert.equal(runtime.session.sessionFile, undefined);
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(await fs.readdir(f.sessions), []);
  for (const id of ids) await assert.rejects(acquireOwnership(f.configRoot, "session", id), { code: "OWNERSHIP_HELD" });
  await runtime.dispose();
  for (const id of ids) { const owner = await acquireOwnership(f.configRoot, "session", id); await owner.release(); }
});

test("no-session rejects fork and occupied explicit identity before loading a runtime", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.start(["--no-session", "--fork", "missing.jsonl"]), { code: "OMP_AGENT_OPTION_INVALID" });
  const owner = await acquireOwnership(f.configRoot, "session", "occupied");
  try {
    await assert.rejects(f.start(["--no-session", "--session-id", "occupied"]), { code: "OWNERSHIP_HELD" });
    assert.equal(f.admissions.reservations.size, 0);
    assert.deepEqual(await fs.readdir(f.sessions), []);
  } finally { await owner.release(); }
});

test("unknown project trust never executes project resources or silently grants trust", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, ".pi"));
  await fs.writeFile(path.join(f.root, ".pi/settings.json"), JSON.stringify({ theme: "light" }));
  await assert.rejects(f.start(), { code: "TUI_PROJECT_TRUST_CONFIRMATION_REQUIRED" });
  assert.equal(new sdk.ProjectTrustStore(f.configRoot).get(f.root), null);
});

test("candidate factory rebuilds services on resume and new without dropping tools or thinking", async (t) => {
  const f = await fixture(t);
  const { runtime } = await f.start(["--model", "fixture/one", "--thinking", "high"]);
  const bind = (session) => session.bindExtensions({ mode: "tui" });
  await bind(runtime.session); runtime.setRebindSession(bind);
  const target = path.join(f.sessions, "target.jsonl");
  await fs.writeFile(target, JSON.stringify({ type: "session", version: 1, id: "target", cwd: f.root,
    timestamp: new Date().toISOString() }) + "\n");
  assert.deepEqual(await runtime.switchSession(target), { cancelled: false });
  assert.equal(runtime.session.sessionId, "target");
  assert.equal(runtime.session.thinkingLevel, "high");
  assert.deepEqual(runtime.session.getActiveToolNames(), ["read", "ls"]);
  assert.deepEqual(await runtime.newSession(), { cancelled: false });
  assert.notEqual(runtime.session.sessionId, "target");
  assert.equal(runtime.session.model.id, "one");
  assert.equal(runtime.session.thinkingLevel, "high");
  await runtime.dispose();
  const lease = await acquireOwnership(f.configRoot, "session", "target"); await lease.release();
});

for (const accepted of [true, false]) test(`startup project trust ${accepted} is explicit, session-only and not repeated for new`, async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.root, ".pi"));
  await fs.writeFile(path.join(f.root, ".pi/settings.json"), JSON.stringify({ theme: "light" }));
  let asked = 0;
  const { runtime } = await f.start(["--model", "fixture/one"], async (cwd) => {
    asked++; assert.equal(cwd, f.root); return accepted;
  });
  const bind = (session) => session.bindExtensions({ mode: "tui" });
  await bind(runtime.session); runtime.setRebindSession(bind);
  assert.equal(runtime.services.settingsManager.isProjectTrusted(), accepted);
  await runtime.newSession();
  assert.equal(asked, 1);
  assert.equal(runtime.services.settingsManager.isProjectTrusted(), accepted);
  assert.equal(new sdk.ProjectTrustStore(f.configRoot).get(f.root), null);
  await runtime.dispose();
});

test("candidate bootstrap starts an explicit fork with its reserved target identity", async (t) => {
  const f = await fixture(t), source = path.join(f.sessions, "source.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 1, id: "source", cwd: f.root,
    timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(source, bytes);
  const { runtime } = await f.start(["--fork", source, "--session-id", "forked", "--model", "fixture/one"]);
  assert.equal(runtime.session.sessionId, "forked");
  assert.equal(runtime.session.sessionManager.getHeader().parentSession, source);
  assert.equal(await fs.readFile(source, "utf8"), bytes);
  await runtime.dispose();
});

for (const operation of ["resume", "import"]) for (const accepted of [true, false])
  test(`${operation} resolves project trust ${accepted} using the outgoing UI before teardown`, async (t) => {
    const f = await fixture(t), other = path.join(f.root, "other-project");
    await fs.mkdir(path.join(other, ".pi"), { recursive: true });
    await fs.writeFile(path.join(other, ".pi/settings.json"), JSON.stringify({ theme: "light" }));
    const target = path.join(other, "target.jsonl");
    const bytes = JSON.stringify({ type: "session", version: 1, id: "target", cwd: other,
      timestamp: new Date().toISOString() }) + "\n";
    await fs.writeFile(target, bytes);
    const { runtime } = await f.start(["--model", "fixture/one"]);
    const source = runtime.session, order = [];
    const uiContext = { setEditorComponent() {}, confirm: async () => {
      order.push("confirm");
      assert.equal(runtime.session, source);
      assert.equal(await fs.readFile(target, "utf8"), bytes, "trust must precede migration");
      if (operation === "import") assert.ok(!(await fs.readdir(f.sessions)).includes("target.jsonl"));
      return accepted;
    } };
    const bind = (session) => session.bindExtensions({ mode: "tui", uiContext });
    await bind(source); runtime.setRebindSession(bind);
    runtime.setBeforeSessionInvalidate(() => order.push("invalidate"));
    const result = operation === "resume" ? await runtime.switchSession(target) : await runtime.importFromJsonl(target);
    assert.deepEqual(result, { cancelled: false });
    assert.deepEqual(order, ["confirm", "invalidate"]);
    assert.equal(runtime.cwd, other);
    assert.equal(runtime.services.settingsManager.isProjectTrusted(), accepted);
    assert.equal(new sdk.ProjectTrustStore(f.configRoot).get(other), null);
    if (operation === "import") assert.equal(await fs.readFile(target, "utf8"), bytes);
    await runtime.dispose();
  });

for (const accepted of [true, false]) test(`initial missing cwd correction requires explicit choice ${accepted}`, async (t) => {
  const f = await fixture(t), target = path.join(f.sessions, "missing-cwd.jsonl");
  const missing = path.join(f.root, "removed-project");
  const bytes = JSON.stringify({ type: "session", version: 1, id: "missing-cwd", cwd: missing,
    timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(target, bytes);
  let asked = 0;
  const result = await f.start(["--session", target, "--model", "fixture/one"], undefined, async (input) => {
    asked++;
    assert.deepEqual(input, { file: target, cwd: f.root });
    assert.equal(await fs.readFile(target, "utf8"), bytes);
    await assert.rejects(acquireOwnership(f.configRoot, "session", "missing-cwd"), { code: "OWNERSHIP_HELD" });
    return accepted;
  });
  assert.equal(asked, 1);
  assert.equal(result.cancelled, !accepted);
  if (accepted) {
    assert.equal(result.runtime.cwd, f.root);
    assert.equal(result.runtime.session.sessionManager.getHeader().cwd, missing);
    await result.runtime.dispose();
  } else {
    assert.equal(await fs.readFile(target, "utf8"), bytes);
    await f.admissions.close();
  }
  const owner = await acquireOwnership(f.configRoot, "session", "missing-cwd"); await owner.release();
});

test("explicit startup session directory survives opening external history and subsequent new", async (t) => {
  const f = await fixture(t), source = path.join(f.root, "external.jsonl");
  await fs.writeFile(source, JSON.stringify({ type: "session", version: 1, id: "external", cwd: f.root,
    timestamp: new Date().toISOString() }) + "\n");
  const { runtime } = await f.start(["--session", source, "--model", "fixture/one"]);
  assert.equal(runtime.session.sessionManager.getSessionDir(), f.sessions);
  await runtime.session.bindExtensions({ mode: "tui" });
  await runtime.newSession();
  assert.equal(runtime.session.sessionManager.getSessionDir(), f.sessions);
  assert.equal(path.dirname(runtime.session.sessionFile), f.sessions);
  await runtime.dispose();
});
