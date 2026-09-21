import fs from "node:fs/promises";
import { acquireOwnership, ownershipError } from "../host/ownership.mjs";
import { projectExecutionState } from "../project-gates/index.mjs";

// TUI keeps project ownership after revoke: revoked authority does not prove
// that a prior shell or verification command has stopped.
export class DirectSessionOwnership {
  constructor(configRoot, { executionState = projectExecutionState } = {}) {
    this.configRoot = configRoot; this.executionState = executionState;
    this.leases = new Map(); this.pending = Promise.resolve(); this.closing = false;
  }
  acquire(kind, key) {
    const operation = this.pending.then(async () => {
      if (this.closing) throw ownershipError("OWNER_CLOSING");
      const canonical = kind === "project" ? await fs.realpath(key) : key;
      const identity = `${kind}:${canonical}`;
      if (!this.leases.has(identity)) this.leases.set(identity, await acquireOwnership(this.configRoot, kind, canonical));
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async close() {
    this.closing = true;
    await this.pending;
    const state = this.executionState();
    if (state.active !== 0 || state.unconfirmed !== false) throw ownershipError("OWNER_TERMINATION_UNCONFIRMED");
    for (const [key, lease] of this.leases) { await lease.release(); this.leases.delete(key); }
  }
}
