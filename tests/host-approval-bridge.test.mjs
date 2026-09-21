import test from "node:test";
import assert from "node:assert/strict";
import { ApprovalBridge } from "../packages/host/approval-bridge.mjs";

test("approval identities are single-use and invalidated on revoke/close", () => {
  const sent = [], snapshots = [];
  const bridge = new ApprovalBridge({ send: (v) => sent.push(v), publish: (v) => snapshots.push(v) });
  bridge.request({ id: "private-pi-id", method: "select", title: "Coding", options: ["Allow", "Deny"] });
  const [approval] = bridge.snapshot();
  assert.equal(JSON.stringify(approval).includes("private-pi-id"), false);
  assert.throws(() => bridge.answer(approval.approvalId, "Forged"), { code: "APPROVAL_ANSWER_INVALID" });
  bridge.answer(approval.approvalId, "Allow");
  assert.deepEqual(sent.pop(), { type: "extension_ui_response", id: "private-pi-id", value: "Allow" });
  assert.throws(() => bridge.answer(approval.approvalId, "Allow"), { code: "APPROVAL_EXPIRED" });
  bridge.request({ id: "second", method: "confirm", title: "Verify" });
  const second = bridge.snapshot()[0]; bridge.invalidate();
  assert.throws(() => bridge.answer(second.approvalId, true), { code: "APPROVAL_EXPIRED" });
  bridge.close(); bridge.request({ id: "closed", method: "confirm" });
  assert.deepEqual(sent.at(-1), { type: "extension_ui_response", id: "closed", cancelled: true });
  assert.deepEqual(snapshots.at(-1), []);
});

test("unsupported and malformed UI frames cannot become approvals; timeout cancels", async () => {
  const sent = []; let expired;
  const done = new Promise((resolve) => { expired = resolve; });
  const bridge = new ApprovalBridge({ send: (v) => { sent.push(v); if (v.id === "timeout") expired(); }, publish: () => {}, timeoutMs: 10 });
  bridge.request({ id: "input", method: "input" });
  bridge.request({ id: "malformed", method: "select", options: [{ label: "Allow" }] });
  assert.equal(bridge.snapshot().length, 0);
  bridge.request({ id: "timeout", method: "confirm" });
  await done; assert.equal(bridge.snapshot().length, 0);
  assert.ok(sent.every((v) => v.cancelled === true)); bridge.close();
});
