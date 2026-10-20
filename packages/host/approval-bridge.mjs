import { randomUUID } from "node:crypto";
import { hostError } from "./contracts.mjs";

// A browser never receives the Pi request ID. IDs belong to one worker lifetime;
// consuming an answer before sending it prevents duplicate/late authorization.
export class ApprovalBridge {
  constructor({ send, publish, timeoutMs = 5 * 60 * 1000 }) {
    Object.assign(this, { send, publish, timeoutMs });
    this.pending = new Map(); this.closed = false;
  }
  request(frame) {
    if (this.closed || typeof frame.id !== "string" || frame.id.length > 256 || !["select", "confirm"].includes(frame.method)) {
      if (typeof frame.id === "string") this.send({ type: "extension_ui_response", id: frame.id, cancelled: true });
      return;
    }
    if (this.pending.size >= 8 || [...this.pending.values()].some((p) => p.rpcId === frame.id)) {
      this.invalidate(); throw hostError("APPROVAL_REQUEST_INVALID");
    }
    const title = typeof frame.title === "string" ? frame.title : "";
    const message = typeof frame.message === "string" ? frame.message : "";
    const options = frame.method === "select" ? frame.options : undefined;
    if (title.length > 16384 || message.length > 16384 || (frame.method === "select" && (!Array.isArray(options) || options.length < 1 || options.length > 32 || options.some((v) => typeof v !== "string" || v.length > 2048)))) {
      this.send({ type: "extension_ui_response", id: frame.id, cancelled: true }); return;
    }
    const approvalId = randomUUID();
    const publicValue = { approvalId, kind: frame.method, title, message, ...(options ? { options: [...options] } : {}), expiresAt: new Date(Date.now() + this.timeoutMs).toISOString() };
    const timer = setTimeout(() => this.cancel(approvalId), this.timeoutMs);
    this.pending.set(approvalId, { rpcId: frame.id, publicValue, timer });
    this.publish(this.snapshot());
  }
  snapshot() { return [...this.pending.values()].map((p) => structuredClone(p.publicValue)); }
  answer(approvalId, answer) {
    const item = this.pending.get(approvalId);
    if (!item || this.closed) throw hostError("APPROVAL_EXPIRED", 409);
    if (Date.now() >= Date.parse(item.publicValue.expiresAt)) { this.cancel(approvalId); throw hostError("APPROVAL_EXPIRED", 409); }
    if (item.publicValue.kind === "select" ? !item.publicValue.options.includes(answer) : typeof answer !== "boolean") throw hostError("APPROVAL_ANSWER_INVALID", 400);
    clearTimeout(item.timer); this.pending.delete(approvalId); this.publish(this.snapshot());
    this.send({ type: "extension_ui_response", id: item.rpcId, ...(item.publicValue.kind === "select" ? { value: answer } : { confirmed: answer }) });
  }
  cancel(approvalId) {
    const item = this.pending.get(approvalId); if (!item) return;
    clearTimeout(item.timer); this.pending.delete(approvalId); this.publish(this.snapshot());
    this.send({ type: "extension_ui_response", id: item.rpcId, cancelled: true });
  }
  invalidate() { for (const id of [...this.pending.keys()]) this.cancel(id); }
  close() { this.closed = true; this.invalidate(); }
}
