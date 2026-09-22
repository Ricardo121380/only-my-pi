import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { acquireOwnership, ownershipError } from "../host/ownership.mjs";
import { projectExecutionState } from "../project-gates/index.mjs";

// Admission reads bytes only. SessionManager.open is deliberately forbidden here:
// it can migrate and rewrite an existing session before returning.
async function readIdentity(file) {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw ownershipError("SESSION_TARGET_INVALID");
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const newline = bytes.indexOf(10);
    if (newline < 0) throw ownershipError("SESSION_HEADER_INVALID");
    let header;
    try { header = JSON.parse(bytes.subarray(0, newline).toString("utf8")); }
    catch { throw ownershipError("SESSION_HEADER_INVALID"); }
    if (header?.type !== "session" || typeof header.id !== "string" || header.id.length > 256
      || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(header.id)) {
      throw ownershipError("SESSION_HEADER_INVALID");
    }
    return { id: header.id, dev: stat.dev, ino: stat.ino, cwd: header.cwd };
  } finally { await handle.close(); }
}

export async function readSessionCwd(file) {
  const { cwd } = await readIdentity(file);
  return typeof cwd === "string" && cwd.length ? path.resolve(cwd) : process.cwd();
}

export async function acquireExplicitSession(configRoot, sessionFile) {
  if (!path.isAbsolute(sessionFile)) throw ownershipError("SESSION_ABSOLUTE_PATH_REQUIRED");
  const file = await fs.realpath(sessionFile);
  const before = await readIdentity(file);
  let lease;
  try { lease = await acquireOwnership(configRoot, "session", before.id); }
  catch (cause) { throw Object.assign(ownershipError("SESSION_OWNERSHIP_UNAVAILABLE"), { cause }); }
  try {
    const after = await readIdentity(file);
    if (await fs.realpath(sessionFile) !== file || before.id !== after.id
      || before.dev !== after.dev || before.ino !== after.ino) throw ownershipError("SESSION_TARGET_CHANGED");
    return { file, ...before, release: lease.release };
  } catch (error) { await lease.release(); throw error; }
}

// Keep admitted histories until the runtime is fully disposed. session_shutdown
// is not a release boundary: another extension may still persist shutdown data.
export class SessionAdmissions {
  #createdManagers = new WeakSet();
  constructor(configRoot, { executionState = projectExecutionState, loadSdk = () => import("@earendil-works/pi-coding-agent") } = {}) {
    this.configRoot = configRoot;
    this.executionState = executionState;
    this.loadSdk = loadSdk;
    this.leases = new Map();
    this.reservations = new Map();
    this.pending = Promise.resolve();
    this.closing = false;
  }
  admit(sessionFile, { allowOwnedId = false } = {}) {
    const operation = this.pending.then(async () => {
      if (this.closing) throw ownershipError("OWNER_CLOSING");
      const file = await fs.realpath(sessionFile);
      const existing = this.leases.get(file);
      if (existing) {
        const identity = await readIdentity(file);
        if (identity.id !== existing.id || identity.dev !== existing.dev || identity.ino !== existing.ino)
          throw ownershipError("SESSION_TARGET_CHANGED");
        return existing;
      }
      const identity = await readIdentity(file);
      const reserved = this.reservations.get(identity.id);
      if (reserved) {
        if (!reserved.file || await fs.realpath(reserved.file) !== file) throw ownershipError("SESSION_TARGET_CHANGED");
        const lease = { file, ...identity, release: reserved.release };
        this.leases.set(file, lease);
        this.reservations.delete(identity.id);
        return lease;
      }
      // Import may bring an external copy of the current history back in. Its
      // ID is already protected by this runtime; do not contend with ourselves.
      const owner = allowOwnedId && [...this.leases.values()].find((lease) => lease.id === identity.id);
      if (owner) {
        const lease = { file, ...identity, release: owner.release };
        this.leases.set(file, lease);
        return lease;
      }
      const lease = await acquireExplicitSession(this.configRoot, file);
      this.leases.set(file, lease);
      return lease;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  create(cwd, sessionDir, { id = randomUUID(), sourceFile, parentSession, leafId } = {}) {
    // Acquire the source outside the target queue, otherwise admit would wait
    // for the operation that is itself awaiting admit.
    const source = sourceFile ? this.admit(sourceFile) : Promise.resolve(null);
    const operation = source.then(() => {
      const queued = this.pending.then(async () => {
        if (this.closing) throw ownershipError("OWNER_CLOSING");
        if (!path.isAbsolute(cwd) || !path.isAbsolute(sessionDir)
          || typeof id !== "string" || id.length > 256
          || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) throw ownershipError("SESSION_TARGET_INVALID");
        const lease = await acquireOwnership(this.configRoot, "session", id);
        // Retain even on SDK failure: forkFrom may have written a partial file.
        this.reservations.set(id, lease);
        const files = await fs.readdir(sessionDir).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
        for (const file of files.filter((file) => file.endsWith(".jsonl"))) {
          if ((await readIdentity(path.join(sessionDir, file))).id === id) throw ownershipError("SESSION_ID_EXISTS");
        }
        const { SessionManager } = await this.loadSdk();
        if (leafId !== undefined && !sourceFile) throw ownershipError("SESSION_TARGET_INVALID");
        if (leafId !== undefined) {
          const original = SessionManager.open((await source).file);
          // Let Pi project labels, compaction pointers and the selected branch.
          // Its generated ID exists only in memory, never as an unlocked file.
          const projection = SessionManager.inMemory(cwd, undefined,
            structuredClone([original.getHeader(), ...original.getEntries()]));
          projection.createBranchedSession(leafId);
          const target = SessionManager.create(cwd, sessionDir, { id, parentSession: (await source).file });
          lease.file = target.getSessionFile();
          const entries = [target.getHeader(), ...projection.getEntries()];
          // Explicit forks are saved immediately, including no-assistant paths.
          // Exclusive creation cannot overwrite an existing history.
          await fs.writeFile(lease.file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
            { flag: "wx", mode: 0o600 });
          const manager = SessionManager.open(lease.file, sessionDir);
          this.#createdManagers.add(manager);
          return manager;
        }
        const manager = sourceFile
          ? SessionManager.forkFrom((await source).file, cwd, sessionDir, { id })
          : SessionManager.create(cwd, sessionDir, { id, parentSession });
        lease.file = manager.getSessionFile();
        this.#createdManagers.add(manager);
        return manager;
      });
      this.pending = queued.catch(() => {});
      return queued;
    });
    return operation;
  }
  createMemory(cwd, { id = randomUUID(), parentSession, entries, leafId } = {}) {
    const operation = this.pending.then(async () => {
      if (this.closing) throw ownershipError("OWNER_CLOSING");
      if (!path.isAbsolute(cwd) || typeof id !== "string" || id.length > 256
        || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id))
        throw ownershipError("SESSION_TARGET_INVALID");
      const lease = await acquireOwnership(this.configRoot, "session", id);
      this.reservations.set(id, lease);
      const { SessionManager } = await this.loadSdk();
      let manager = SessionManager.inMemory(cwd, { id, parentSession });
      if (leafId !== undefined) {
        const projection = SessionManager.inMemory(cwd, undefined, structuredClone(entries));
        projection.createBranchedSession(leafId);
        // Pi projects the branch; only the reserved target ID enters a runtime.
        manager = SessionManager.inMemory(cwd, undefined, [manager.getHeader(), ...projection.getEntries()]);
      }
      this.#createdManagers.add(manager);
      return manager;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async admitCreatedManager(manager) {
    await this.pending;
    if (this.closing) throw ownershipError("OWNER_CLOSING");
    if (!this.#createdManagers.has(manager)) throw ownershipError("SESSION_TARGET_INVALID");
    this.#createdManagers.delete(manager); // A prepared manager starts exactly one runtime.
    const id = manager.getSessionId(), file = manager.getSessionFile();
    const owner = this.reservations.get(id) ?? this.leases.get(file);
    if (!owner || owner.file !== file) throw ownershipError("SESSION_TARGET_CHANGED");
    if (!manager.isPersisted() && file === undefined) return manager;
    // Persisted managers must still match the admitted inode/identity. Empty
    // sessions have no file until Pi flushes their first assistant message.
    try { await fs.lstat(file); }
    catch (error) {
      if (error.code === "ENOENT" && this.reservations.has(id)) return manager;
      throw error;
    }
    await this.admit(file);
    return manager;
  }
  async admitOwnedCopy(sourceFile, copiedFile) {
    // Pi import preserves the session ID. A verified copy therefore shares the
    // source's global ID lease, rather than trying to acquire our own lock again.
    const source = await this.admit(sourceFile);
    const operation = this.pending.then(async () => {
      if (this.closing) throw ownershipError("OWNER_CLOSING");
      const file = await fs.realpath(copiedFile), identity = await readIdentity(file);
      if (identity.id !== source.id) throw ownershipError("SESSION_TARGET_CHANGED");
      const existing = this.leases.get(file);
      if (existing) {
        if (existing.id !== identity.id || existing.dev !== identity.dev || existing.ino !== identity.ino)
          throw ownershipError("SESSION_TARGET_CHANGED");
        return existing;
      }
      const lease = { file, ...identity, release: source.release };
      this.leases.set(file, lease);
      return lease;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  async continueRecent(cwd, sessionDir) {
    const { SessionManager } = await this.loadSdk();
    // Pi's picker sorts conversation activity; --continue instead uses file
    // mtime. Re-sort discovery results rather than opening candidates to inspect.
    const sessions = await SessionManager.list(cwd, sessionDir);
    const candidates = await Promise.all(sessions.map(async (session) => ({
      file: session.path, mtime: (await fs.stat(session.path)).mtimeMs,
    })));
    candidates.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
    if (!candidates.length) return this.create(cwd, sessionDir);
    const lease = await this.admit(candidates[0].file);
    // No fallback to an older session when the most recent one is occupied.
    return SessionManager.open(lease.file, sessionDir);
  }
  async close() {
    this.closing = true;
    await this.pending;
    const state = this.executionState();
    if (state.active !== 0 || state.unconfirmed !== false) throw ownershipError("OWNER_TERMINATION_UNCONFIRMED");
    for (const [file, lease] of this.leases) {
      await lease.release();
      this.leases.delete(file);
    }
    for (const [id, lease] of this.reservations) {
      await lease.release();
      this.reservations.delete(id);
    }
  }
}

export function createResumeAdmissionExtension(admissions) {
  return (pi) => {
    pi.on("session_before_switch", async (event, ctx) => {
      if (event.reason !== "resume" || !event.targetSessionFile) return { cancel: true };
      try { await admissions.admit(event.targetSessionFile); }
      catch {
        ctx?.ui?.notify("SESSION_OWNERSHIP_UNAVAILABLE: session switch refused", "error");
        return { cancel: true };
      }
    });
    // Until new-session identity reservation is implemented, fail closed before
    // branch creation. This restriction belongs only to the private probe.
    pi.on("session_before_fork", () => ({ cancel: true }));
  };
}
