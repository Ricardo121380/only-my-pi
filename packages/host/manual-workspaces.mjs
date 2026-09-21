import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireOwnership } from "./ownership.mjs";
import { decodeText, fileVersion, projectPath } from "./inspector.mjs";
import { hostError } from "./contracts.mjs";

export class ManualWorkspaces {
  constructor({ configRoot, catalog }) { Object.assign(this, { configRoot, catalog }); this.entries = new Map(); this.pending = new Map(); this.closing = false; }
  snapshot() { return [...this.entries.values()].map(({ projectId, manualId }) => ({ projectId, manualId })); }
  async enter(projectId) {
    if (this.closing) throw hostError("HOST_STOPPING", 409);
    if (this.entries.has(projectId)) return this.public(projectId);
    if (this.pending.has(projectId)) return this.pending.get(projectId);
    const operation = (async () => {
      const project = this.catalog.project(projectId);
      const root = await projectPath(project);
      const lease = await acquireOwnership(this.configRoot, "project", root);
      const entry = { projectId, manualId: randomUUID(), lease, saving: false };
      this.entries.set(projectId, entry);
      return this.public(projectId);
    })();
    this.pending.set(projectId, operation);
    try { return await operation; } finally { this.pending.delete(projectId); }
  }
  public(projectId) { const { manualId } = this.entries.get(projectId); return { projectId, manualId }; }
  get(projectId, manualId) {
    const entry = this.entries.get(projectId);
    if (!entry || entry.manualId !== manualId || entry.leaving || this.closing) throw hostError("MANUAL_MODE_REQUIRED", 409);
    return entry;
  }
  async leave(projectId, manualId) {
    const entry = this.get(projectId, manualId);
    if (entry.saving) throw hostError("MANUAL_SAVE_IN_PROGRESS", 409);
    entry.leaving = true;
    await entry.lease.release(); this.entries.delete(projectId);
    return { projectId, manualId: null };
  }
  async save({ projectId, manualId, path: relative, version, text }) {
    const entry = this.get(projectId, manualId);
    if (entry.saving) throw hostError("MANUAL_SAVE_IN_PROGRESS", 409);
    if (typeof text !== "string" || Buffer.byteLength(text) > 512 * 1024 || text.includes("\0") || Buffer.from(text).toString("utf8") !== text || !/^sha256:[a-f0-9]{64}$/.test(version ?? "")) throw hostError("FILE_SAVE_INVALID", 400);
    entry.saving = true;
    let finished;
    entry.done = new Promise((resolve) => { finished = resolve; });
    let temporary;
    try {
      const project = this.catalog.project(projectId), target = await projectPath(project, relative);
      const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let stat;
      try {
        stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 512 * 1024) throw hostError("FILE_SAVE_UNSAFE", 403);
        const bytes = await handle.readFile();
        decodeText(bytes);
        if (fileVersion(bytes) !== version) throw hostError("FILE_VERSION_CONFLICT", 409);
      } finally { await handle.close(); }
      temporary = path.join(path.dirname(target), `.omp-save-${randomUUID()}`);
      const output = await fs.open(temporary, "wx", 0o600);
      try { await output.writeFile(text); await output.chmod(stat.mode & 0o777); await output.sync(); } finally { await output.close(); }
      // Conditional replacement under OMP's shared project lock. External
      // editors do not participate in that lock: detect their observed drift.
      await projectPath(project, relative);
      const current = await fs.lstat(target);
      if (current.dev !== stat.dev || current.ino !== stat.ino || current.mtimeMs !== stat.mtimeMs || current.ctimeMs !== stat.ctimeMs || fileVersion(await fs.readFile(target)) !== version) throw hostError("FILE_VERSION_CONFLICT", 409);
      await fs.rename(temporary, target); temporary = undefined;
      return { path: relative, version: fileVersion(Buffer.from(text)), bytes: Buffer.byteLength(text) };
    } finally {
      try { if (temporary) await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; }); }
      finally { entry.saving = false; finished(); }
    }
  }
  async stop() {
    this.closing = true;
    await Promise.allSettled([...this.pending.values()]);
    // A pending save must be allowed to reach its terminal result before release.
    await Promise.all([...this.entries.values()].map((entry) => entry.done));
    for (const [key, entry] of this.entries) { await entry.lease.release(); this.entries.delete(key); }
  }
}
