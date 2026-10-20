import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { atomicWriteJson, ensureConfigDirectory, readJsonObject, canonicalJson } from "../config-runtime/index.mjs";
import { acquireOwnership, verifyOwnership, groupAlive, processIdentity } from "./ownership.mjs";
import { publishImageExport } from "./image-export-process.mjs";
import { projectPath } from "./inspector.mjs";
import { hostError } from "./contracts.mjs";

const fail = code => hostError(code, 409);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const identity = stat => ({ dev: stat.dev, ino: stat.ino });
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const exportOwners = new Map();

// Exports are Host file operations, never model/tool grants. A reviewed plan
// binds the selected branch/source, target bytes and directory identity.
export class ImageExports {
  constructor({ configRoot, catalog, images }) { Object.assign(this, { configRoot, catalog, images }); this.directory = path.join(configRoot, "only-my-pi/image-exports"); this.leases = exportOwners; this.pending = new Map(); this.closing = false; }
  public(record) { return { operationId: record.operationId, status: record.status, projectId: record.projectId, source: record.source.artifact, target: { path: record.target.path, exists: record.target.exists, beforeSha256: record.target.before?.sha256 ?? null, beforeBytes: record.target.before?.size ?? null }, createdAt: record.createdAt, error: record.error, reconciled: record.reconciled, sha256: record.sha256, bytes: record.bytes }; }
  file(id) { if (!uuid.test(id ?? "")) throw fail("IMAGE_EXPORT_ID_INVALID"); return path.join(this.directory, `${id}.json`); }
  leaseKey(id) { return `${this.directory}:${id}`; }
  async records(projectPath) {
    const files = await fs.readdir(this.directory).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    if (files.length > 4096) throw fail("IMAGE_EXPORT_LIMIT");
    const records = [];
    for (const file of files) {
      if (!/^[0-9a-f-]{36}\.json$/u.test(file)) throw fail("IMAGE_EXPORT_LEDGER_INVALID");
      const record = await readJsonObject(this.configRoot, path.join(this.directory, file));
      if (record.version !== 1 || !uuid.test(record.operationId ?? "") || file !== `${record.operationId}.json` || !["prepared", "dispatched", "unknown", "completed", "failed", "cancelled"].includes(record.status) || !path.isAbsolute(record.projectPath ?? "") || !record.target || !record.source) throw fail("IMAGE_EXPORT_READER_REQUIRED");
      if (record.projectPath === projectPath) records.push(record);
    }
    return records;
  }
  async save(record) { await ensureConfigDirectory(this.configRoot, "only-my-pi/image-exports"); await atomicWriteJson(this.configRoot, this.file(record.operationId), record); }
  async target(project, relative) {
    if (typeof relative !== "string" || relative.length > 512 || !relative.endsWith(".png") || relative.split("/").some(p => !p || p === "." || p === ".pi") || relative.startsWith("/") || /[\\\0\r\n]/u.test(relative)) throw fail("IMAGE_EXPORT_PATH_DENIED");
    const parent = await projectPath(project, path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative));
    if (parent === this.configRoot || parent.startsWith(this.configRoot + path.sep)) throw fail("IMAGE_EXPORT_PATH_DENIED");
    const target = path.join(parent, path.posix.basename(relative));
    await projectPath(project, relative).catch(error => { if (error.code !== "ENOENT") throw error; });
    // projectPath enforces sensitive names/links including an existing leaf.
    let stat = await fs.lstat(target).catch(e => { if (e.code === "ENOENT") return null; throw e; });
    if (stat) {
      await projectPath(project, relative);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 10485760) throw fail("IMAGE_EXPORT_TARGET_UNSAFE");
    }
    const handle = await fs.open(parent, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const directories = [], components = relative.split("/").slice(0, -1); let cursor = project.path;
      directories.push({ path: cursor, ...identity(await fs.lstat(cursor)) });
      for (const component of components) { cursor = path.join(cursor, component); directories.push({ path: cursor, ...identity(await fs.lstat(cursor)) }); }
      const pinned = await handle.stat(); if (!pinned.isDirectory() || !same(identity(pinned), identity(await fs.lstat(parent)))) throw fail("IMAGE_EXPORT_TARGET_CHANGED");
      const fdPath = parent;
      let before = null;
      if (stat) {
        const leaf = await fs.open(path.join(fdPath, path.basename(target)), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { stat = await leaf.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 10485760) throw fail("IMAGE_EXPORT_TARGET_UNSAFE"); before = { ...identity(stat), size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, sha256: digest(await leaf.readFile()) }; }
        finally { await leaf.close(); }
      }
      return { handle, fdPath, snapshot: { path: relative, exists: !!before, before, directories } };
    } catch (error) { await handle.close(); throw error; }
  }
  async prepare(input) {
    if (this.closing) throw fail("HOST_STOPPING");
    if (process.platform !== "darwin") throw fail("IMAGE_EXPORT_PROCESS_ISOLATION_UNAVAILABLE");
    const project = this.catalog.project(input.projectId), { artifact } = await this.images.read(input);
    if ((await this.records(project.path)).some(r => ["dispatched", "unknown"].includes(r.status))) throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
    const pinned = await this.target(project, input.path);
    try {
      const record = { version: 1, operationId: randomUUID(), status: "prepared", projectId: input.projectId, projectPath: project.path, source: { projectId: input.projectId, sessionKey: input.sessionKey, entryId: input.entryId, requestId: input.requestId, index: input.index, artifact }, target: pinned.snapshot, createdAt: new Date().toISOString() };
      await this.save(record); return record;
    } finally { await pinned.handle.close(); }
  }
  async action(input, isAuthorized = () => true, expectedProjectId = undefined) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw hostError("IMAGE_EXPORT_COMMAND_INVALID");
    const keys = { prepare: "entryId,index,path,projectId,requestId,sessionKey,type", commit: "codingAuthorized,operationId,overwrite,type", cancel: "operationId,type", reconcile: "operationId,type" };
    if (Object.keys(input).sort().join() !== keys[input.type]) throw hostError("IMAGE_EXPORT_COMMAND_INVALID");
    if (input.type === "prepare") { if (expectedProjectId && expectedProjectId !== input.projectId) throw fail("IMAGE_EXPORT_SCOPE_MISMATCH"); return this.prepare(input); }
    if (this.closing || !isAuthorized()) throw hostError("AUTH_REQUIRED", 401);
    if (this.pending.has(input.operationId)) throw fail("IMAGE_EXPORT_BUSY");
    const operation = this.execute(input, isAuthorized, expectedProjectId); this.pending.set(input.operationId, operation);
    try { return await operation; } finally { this.pending.delete(input.operationId); }
  }
  async execute(input, isAuthorized, expectedProjectId) {
    const file = this.file(input.operationId), record = await readJsonObject(this.configRoot, file);
    const project = this.catalog.project(record.projectId);
    if (expectedProjectId && expectedProjectId !== record.projectId) throw fail("IMAGE_EXPORT_SCOPE_MISMATCH");
    if (record.projectPath !== project.path || !(await this.records(project.path)).some(r => r.operationId === record.operationId)) throw fail("IMAGE_EXPORT_LEDGER_INVALID");
    if (input.type === "cancel") { if (record.status !== "prepared") throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED"); record.status = "cancelled"; await this.save(record); return record; }
    if (["completed", "failed", "cancelled"].includes(record.status)) return record;
    if (input.type === "commit" && (input.codingAuthorized !== true || typeof input.overwrite !== "boolean")) throw hostError("IMAGE_EXPORT_WRITE_PERMISSION_REQUIRED", 403);
    if (input.type === "commit" && record.status !== "prepared") throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
    if (input.type === "commit" && record.target.exists && !input.overwrite) throw fail("IMAGE_EXPORT_OVERWRITE_REQUIRED");
    if (input.type === "reconcile" && !["unknown", "dispatched"].includes(record.status)) throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
    if ((await this.records(project.path)).some(r => r.operationId !== record.operationId && ["unknown", "dispatched"].includes(r.status))) throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
    const leaseKey = this.leaseKey(record.operationId);
    let lease = this.leases.get(leaseKey), pinned, published = false, dispatched = record.status !== "prepared";
    try {
      lease ??= await acquireOwnership(this.configRoot, "project", project.path, input.type === "reconcile" ? { retainTokenOnRecovery: true, recover: previous => {
        if (!record.owner || previous.token !== record.owner.token || record.executor !== "HOST_BOUNDED_EXPORT_WORKER" || record.worker && groupAlive(record.worker.pid)) throw fail("IMAGE_EXPORT_OWNER_CHANGED");
      } } : {});
      this.leases.set(leaseKey, lease);
      await verifyOwnership(this.configRoot, "project", project.path, lease.owner);
      pinned = await this.target(project, record.target.path);
      if (input.type === "reconcile") {
        if (record.worker && (await processIdentity(record.worker.pid) === record.worker.identity || groupAlive(record.worker.pid))) throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
        if (!same(pinned.snapshot.directories, record.target.directories) || pinned.snapshot.before?.sha256 !== record.source.artifact.sha256 || pinned.snapshot.before?.size !== record.source.artifact.bytes) throw fail("IMAGE_EXPORT_RECONCILIATION_REQUIRED");
        // Explicit reconciliation confirms observed bytes and directory sync;
        // it never publishes bytes again or calls the model.
        await pinned.handle.sync(); record.status = "completed"; record.reconciled = true; record.owner = lease.owner; await this.save(record); return record;
      }
      if (!same(pinned.snapshot, record.target)) throw fail("IMAGE_EXPORT_TARGET_CHANGED");
      const { artifact, bytes } = await this.images.read(record.source);
      if (!same(artifact, record.source.artifact)) throw fail("IMAGE_SOURCE_UNAVAILABLE");
      if (!isAuthorized() || this.closing) throw hostError("AUTH_REQUIRED", 401);
      record.status = "dispatched"; record.owner = lease.owner; record.executor = "HOST_BOUNDED_EXPORT_WORKER";
      dispatched = true; await this.save(record);
      const result = await publishImageExport({ record, bytes, save: value => this.save(value), beforePublish: async () => {
        const check = await this.target(project, record.target.path);
        try { if (!same(check.snapshot, record.target)) throw fail("IMAGE_EXPORT_TARGET_CHANGED"); } finally { await check.handle.close(); }
        await verifyOwnership(this.configRoot, "project", project.path, lease.owner);
        if (!isAuthorized() || this.closing) throw hostError("AUTH_REQUIRED", 401);
      } });
      record.status = result.phase; published = result.phase !== "failed";
      if (result.error) record.error = result.error; else delete record.error;
      if (result.phase === "completed") { record.sha256 = result.sha256; record.bytes = result.bytes; }
      await this.save(record); return record;
    } catch (error) {
      if (lease && dispatched) {
        record.status = input.type === "reconcile" || published || error.atomicPublication === "PUBLISHED_NOT_CONFIRMED_DURABLE" ? "unknown" : "failed";
        // A failed durable dispatch write cannot prove that the publication
        // seam was never reached on a previous attempt. Keep its owner.
        if (error.atomicPublication && !published) record.status = "unknown";
        record.error = record.status === "unknown" ? "IMAGE_EXPORT_RESULT_UNKNOWN" : error.code ?? "IMAGE_EXPORT_FAILED";
        await this.save(record).catch(() => { record.status = "unknown"; record.error = "IMAGE_EXPORT_RESULT_UNKNOWN"; });
        return record;
      }
      throw error;
    } finally {
      await pinned?.handle.close();
      if (lease && !["unknown", "dispatched"].includes(record.status)) { await lease.release(); this.leases.delete(leaseKey); }
    }
  }
  async stop() { this.closing = true; await Promise.allSettled([...this.pending.values()]); /* unknown project owners remain durable */ }
}
