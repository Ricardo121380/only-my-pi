import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createControlledExtension } from "../packages/host/controlled-extension.mjs";

test("private writer authority is bound to a live grant, project and session", () => {
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
  handlers.get("session_shutdown")();
  assert.equal(payload.isHostAuthorized(context), false);
});
