import assert from "node:assert/strict";
import test from "node:test";
import { createResumeEditorFactory, createResumeUiExtension } from "../packages/direct-agent/session-resume-ui.mjs";

test("editor routes resume submit and action after native callback wiring, preserving other submits", () => {
  class Editor {
    actions = new Map();
    onAction(name, callback) { this.actions.set(name, callback); }
    handleInput(input) {
      if (input === "shortcut") this.actions.get("app.session.resume")();
      else this.onSubmit(input);
    }
  }
  let resumed = 0; const submitted = [];
  const editor = createResumeEditorFactory({ CustomEditor: Editor }, () => resumed++)();
  const submit = (text) => submitted.push(text);
  editor.onSubmit = submit;
  editor.onAction("app.session.resume", () => assert.fail("native selector must not open"));
  editor.handleInput("/resume"); editor.handleInput("shortcut"); editor.handleInput("hello");
  assert.equal(resumed, 2); assert.deepEqual(submitted, ["hello"]); assert.equal(editor.onSubmit, submit);
});

async function setup({ selection, switchError, stale = false, shutdown = false, cancelled = false, confirm = false } = {}) {
  let text = "unsent draft";
  let factory, onResume, calls = 0; const notifications = [], handlers = {};
  const session = { sessionManager: {} };
  const runtime = { session, cwd: "/fixture", async switchSession(file, options) {
    calls++; assert.equal(file, "chosen");
    assert.equal(options.projectTrustContextFactory("/target").cwd, "/target");
    assert.equal(options.projectTrustContextFactory("/target").hasUI, true);
    if (options.cwdOverride) { assert.equal(options.cwdOverride, "/fixture"); return { cancelled: false }; }
    if (switchError) throw switchError; return { cancelled };
  } };
  class Editor {
    onAction(_name, callback) { onResume = callback; }
    handleInput() {}
  }
  createResumeUiExtension({ sdk: { CustomEditor: Editor }, getRuntime: () => runtime })({ on(event, callback) { handlers[event] = callback; } });
  handlers.session_start({}, { ui: {
    setEditorComponent(value) { factory = value; }, setEditorText(value) { text = value; }, getEditorText() { return text; },
    async custom() { if (stale) runtime.session = {}; if (shutdown) handlers.session_shutdown(); return selection; },
    notify(message) { notifications.push(message); },
    async confirm() { return confirm; },
  } });
  factory().handleInput(""); await onResume();
  return { calls, notifications, text };
}

test("resume UI cancellation and stale results never switch", async () => {
  assert.equal((await setup({ selection: null })).calls, 0);
  assert.equal((await setup({ selection: "chosen", stale: true })).calls, 0);
  assert.equal((await setup({ selection: "chosen", shutdown: true })).calls, 0);
});

test("resume UI calls admitted runtime and reports bounded errors", async () => {
  assert.equal((await setup({ selection: "chosen" })).calls, 1);
  assert.deepEqual((await setup({ selection: "chosen", switchError: { code: "SESSION_OWNERSHIP_UNAVAILABLE" } })).notifications,
    ["SESSION_OWNERSHIP_UNAVAILABLE"]);
  assert.deepEqual((await setup({ selection: "chosen", switchError: new Error("private detail") })).notifications,
    ["SESSION_RESUME_FAILED"]);
  assert.deepEqual((await setup({ selection: "chosen", switchError: { code: "SECRET_PRIVATE_VALUE" } })).notifications,
    ["SESSION_RESUME_FAILED"]);
});

test("resume preserves drafts on picker cancellation, switch cancellation and ownership refusal", async () => {
  for (const options of [{ selection: null }, { selection: "chosen", cancelled: true },
    { selection: "chosen", switchError: { code: "SESSION_OWNERSHIP_UNAVAILABLE" } }]) {
    assert.equal((await setup(options)).text, "unsent draft");
  }
  assert.equal((await setup({ selection: "chosen" })).text, "");
});

test("missing cwd retries only after explicit confirmation and cancellation retains draft", async () => {
  const options = { selection: "chosen", switchError: { code: "SESSION_CWD_INVALID" } };
  const denied = await setup(options);
  assert.equal(denied.calls, 1); assert.equal(denied.text, "unsent draft");
  const accepted = await setup({ ...options, confirm: true });
  assert.equal(accepted.calls, 2); assert.equal(accepted.text, "");
});

test("shutdown invalidates old callbacks and reload installs a fresh usable editor", async () => {
  const handlers = {}, editors = []; let opened = 0;
  class Editor { onAction(_name, callback) { this.resume = callback; } handleInput() {} }
  const runtime = { session: { sessionManager: {} } };
  createResumeUiExtension({ sdk: { CustomEditor: Editor }, getRuntime: () => runtime })({
    on(event, callback) { handlers[event] = callback; },
  });
  const ctx = { ui: {
    setEditorComponent(factory) { const editor = factory(); editor.handleInput(""); editors.push(editor); },
    async custom() { opened++; return null; },
  } };
  handlers.session_start({}, ctx);
  handlers.session_shutdown({ reason: "reload" });
  await editors[0].resume(); assert.equal(opened, 0);
  handlers.session_start({ reason: "reload" }, ctx);
  await editors[0].resume(); assert.equal(opened, 0);
  await editors[1].resume(); assert.equal(opened, 1);
});
