import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createControlledExtension } from "../packages/host/controlled-extension.mjs";

test("private writer authority is bound to a live grant, project and session", async () => {
  const transport = new EventEmitter(), handlers = new Map();
  transport.send = () => {};
  let payload;
  const context = { mode: "rpc", hasUI: true, cwd: "/fixture", sessionId: "one" };
  const controller = {
    context, grantAbort: new AbortController(), grantBinding: "one:/fixture", coding: true,
    hasCodingAccess() { return this.coding; },
    sessionIdentity(ctx) { return `${ctx?.sessionId}:${ctx?.cwd}`; },
    accessCommand() { this.coding = false; this.grantAbort.abort(); },
  };
  createControlledExtension({ transport })({
    events: { emit(_name, value) { payload = value; value.register(controller); } },
    on(name, handler) { handlers.set(name, handler); },
  });
  assert.equal(payload.isHostAuthorized(context), false);
  payload.capability.bind(context);
  assert.equal(payload.isHostAuthorized(context), true);
  assert.equal(payload.isHostAuthorized({ ...context, sessionId: "two" }), false);
  assert.equal(payload.isHostAuthorized({ ...context, cwd: "/other" }), false);
  context.sessionId = "two";
  assert.equal(payload.isHostAuthorized(context), false);
  context.sessionId = "one";
  transport.emit("message", { type: "revoke", id: "fixture" });
  assert.equal(payload.isHostAuthorized(context), false);
  controller.coding = true;
  assert.equal(payload.isHostAuthorized(context), false, "aborted old grant cannot be revived");
  controller.grantAbort = new AbortController();
  assert.equal(payload.isHostAuthorized(context), true);
  await handlers.get("session_shutdown")();
  assert.equal(payload.isHostAuthorized(context), false);
});

test("controlled shutdown requires all registered execution probes to confirm cleanup", async () => {
  for (const active of [0, 1]) {
    const transport = new EventEmitter(), handlers = new Map(), sent = [];
    transport.send = (message, callback) => { sent.push(message); callback?.(); };
    const controller = { context: null, hasCodingAccess: () => false, invalidateCodingAuthority() {} };
    createControlledExtension({ transport })({
      events: { emit(_name, value) { value.register(controller); value.registerExecutionProbe(() => ({ active, unconfirmed: active > 0 })); } },
      on(name, handler) { handlers.set(name, handler); },
    });
    transport.emit("message", { type: "prepare_shutdown", id: "bound-exit" });
    await handlers.get("session_shutdown")();
    assert.deepEqual(sent.find((entry) => entry.type === "shutdown_confirmed"), { type: "shutdown_confirmed", id: "bound-exit", clean: active === 0 });
  }
});

test("controlled shutdown awaits IPC completion and propagates send failure", async () => {
  for (const failed of [false, true]) {
    const transport = new EventEmitter(), handlers = new Map();
    let complete;
    transport.send = (message, callback) => { if (message.type === "shutdown_confirmed") complete = callback; else callback?.(); };
    const controller = { context: null, hasCodingAccess: () => false, invalidateCodingAuthority() {} };
    createControlledExtension({ transport })({
      events: { emit(_name, value) { value.register(controller); } },
      on(name, handler) { handlers.set(name, handler); },
    });
    transport.emit("message", { type: "prepare_shutdown", id: "pending-send" });
    let settled = false;
    const shutdown = handlers.get("session_shutdown")();
    void shutdown.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false, "Pi cannot finish shutdown while its receipt is queued");
    assert.equal(transport.listenerCount("message"), 0); assert.equal(transport.listenerCount("disconnect"), 0);
    if (failed) {
      const error = new Error("fixture IPC send failed");
      const rejected = assert.rejects(shutdown, error);
      complete(error); await rejected;
    } else { complete(); await shutdown; }
  }
});
