import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hostError, textContent } from "./contracts.mjs";
import { assertSafeContainedPath } from "../config-runtime/index.mjs";
import { findInputReceipt, INPUT_CARRIER } from "./input-protocol.mjs";
import { readSessionSnapshot } from "../direct-agent/session-history.mjs";

const key = (value) => createHash("sha256").update(value).digest("hex");
export const projectIdFor = (root) => key(root);
async function regular(file, maximum) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > maximum) { await handle.close(); throw hostError("FILE_TOO_LARGE_OR_UNSAFE"); }
  return handle;
}
export class ProjectCatalog {
  constructor({ sessionRoot, projects = [] }) {
    this.sessionRoot = path.resolve(sessionRoot); this.projects = new Map(projects.map((p) => [p.projectId, p])); this.sessions = new Map(); this.diagnostics = [];
  }
  async add(root) {
    if (!path.isAbsolute(root) || /[\0\r\n]/u.test(root)) throw hostError("PROJECT_PATH_INVALID");
    const canonical = await fs.realpath(root);
    if (!(await fs.stat(canonical)).isDirectory()) throw hostError("PROJECT_PATH_INVALID");
    const project = { projectId: projectIdFor(canonical), path: canonical, name: path.basename(canonical), available: true };
    this.projects.set(project.projectId, project); return project;
  }
  scan() {
    this.scanning ??= this.scanOnce().finally(() => { this.scanning = null; });
    return this.scanning;
  }
  async scanOnce() {
    this.sessions.clear(); this.diagnostics = [];
    for (const project of this.projects.values()) project.available = await fs.stat(project.path).then((stat) => stat.isDirectory(), () => false);
    const dirs = await fs.readdir(this.sessionRoot, { withFileTypes: true }).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
    const files = [];
    for (const dir of dirs) {
      if (dir.isFile() && dir.name.endsWith(".jsonl")) files.push(path.join(this.sessionRoot, dir.name));
      else if (dir.isDirectory() && !dir.isSymbolicLink()) {
        for (const item of await fs.readdir(path.join(this.sessionRoot, dir.name), { withFileTypes: true })) if (item.isFile() && item.name.endsWith(".jsonl")) files.push(path.join(this.sessionRoot, dir.name, item.name));
      }
      if (files.length > 10000) throw hostError("SESSION_INDEX_LIMIT");
    }
    for (const file of files) {
      try {
        const handle = await regular(file, 128 * 1024 * 1024);
        let header;
        try { const buffer = Buffer.alloc(16384); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); header = JSON.parse(buffer.subarray(0, bytesRead).toString().split("\n")[0]); } finally { await handle.close(); }
        if (header.type !== "session" || typeof header.id !== "string" || header.id.length > 256 || typeof header.cwd !== "string" || header.cwd.length > 4096 || !path.isAbsolute(header.cwd)) throw hostError("SESSION_HEADER_INVALID");
        const canonical = await fs.realpath(header.cwd).catch(() => header.cwd);
        const projectId = projectIdFor(canonical);
        const available = await fs.stat(canonical).then((s) => s.isDirectory(), () => false);
        this.projects.set(projectId, { projectId, path: canonical, name: path.basename(canonical), available });
        const sessionKey = key(file);
        const timestamp = typeof header.timestamp === "string" ? header.timestamp.slice(0, 64) : "";
        this.sessions.set(sessionKey, { sessionKey, sessionId: header.id, projectId, timestamp, name: timestamp || header.id, readOnly: true, file });
      } catch { this.diagnostics.push({ code: "SESSION_UNREADABLE", sessionKey: key(file) }); }
    }
    return this.listProjects();
  }
  listProjects() { return [...this.projects.values()].sort((a, b) => a.name.localeCompare(b.name)); }
  listSessions(projectId) { return [...this.sessions.values()].filter((s) => s.projectId === projectId).map(({ file, ...s }) => s).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); }
  project(id) { const result = this.projects.get(id); if (!result) throw hostError("PROJECT_NOT_FOUND", 404); return result; }
  async resume(sessionKey, projectId) {
    const session = this.sessions.get(sessionKey);
    if (!session || session.projectId !== projectId) throw hostError("SESSION_NOT_FOUND", 404);
    await assertSafeContainedPath(this.sessionRoot, session.file);
    const { header } = await readSessionSnapshot(session.file);
    if (header.id !== session.sessionId || await fs.realpath(header.cwd) !== this.project(projectId).path) throw hostError("SESSION_IDENTITY_CHANGED", 409);
    return { sessionId: session.sessionId, file: session.file };
  }
  async history(sessionKey, offset = 0, limit = 50) {
    const session = this.sessions.get(sessionKey); if (!session) throw hostError("SESSION_NOT_FOUND", 404);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw hostError("PAGE_INVALID");
    const { manager } = await readSessionSnapshot(session.file);
    const entries = manager.getBranch().map((entry) => entry.type === "custom_message" && entry.customType === INPUT_CARRIER
      ? { ...entry, type: "message", message: { role: "user", content: entry.content } } : entry).filter((entry) => entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message?.role));
    const messages = entries.slice(offset, offset + Math.min(50, limit)).map((entry) => {
      const m = entry.message, cap = m.role === "toolResult" ? 240 : 65536;
      return { id: entry.id, role: m.role, text: textContent(m.content, cap), toolName: typeof m.toolName === "string" ? m.toolName : undefined,
        timestamp: entry.timestamp, outputAvailable: m.role === "toolResult", truncated: textContent(m.content, cap + 1).length > cap };
    });
    const projection = manager.buildSessionProjection();
    const projectedMessages = projection.entries.flatMap(({ sourceEntry, messages }) => messages.map(message => ({ entryId: sourceEntry.id, message })));
    const context = {
      minimumReader: manager.getBranch().some(entry => ["context_edit", "usage"].includes(entry.type)) ? "1.1.0" : "0.85.1",
      messages: projectedMessages.slice(offset, offset + Math.min(50, limit)).map(({ entryId, message }) => ({ id: entryId, role: message.role, text: textContent(message.content, 65536) })),
      nextOffset: offset + Math.min(50, limit) < projectedMessages.length ? offset + Math.min(50, limit) : null,
      usage: manager.getBranch().filter(entry => entry.type === "usage").slice(offset, offset + Math.min(50, limit)).map(({ id, kind, provider, model, usage, note }) => ({ id, kind, provider, model, usage, note })),
    };
    return { messages, nextOffset: offset + messages.length < entries.length ? offset + messages.length : null, context };
  }
  /** No SDK.open here: a missing or malformed history must never be recreated.
   * @param {import('./contracts.d.ts').InputRecordV1} record */
  async inputReceipt(record) {
    const sessions = this.listSessions(record.projectId).filter((session) => session.sessionId === record.sessionId);
    if (!sessions.length) return null;
    if (sessions.length !== 1) throw hostError("SESSION_IDENTITY_CHANGED", 409);
    const current = await this.resume(sessions[0].sessionKey, record.projectId);
    return findInputReceipt((await readSessionSnapshot(current.file)).manager.getBranch(), record);
  }
  async toolOutput(sessionKey, entryId, offset = 0) {
    const session = this.sessions.get(sessionKey); if (!session) throw hostError("SESSION_NOT_FOUND", 404);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 8 * 1024 * 1024) throw hostError("PAGE_INVALID");
    const entry = (await readSessionSnapshot(session.file)).manager.getBranch().find((e) => e.id === entryId && e.type === "message" && e.message?.role === "toolResult");
    if (!entry) throw hostError("TOOL_OUTPUT_NOT_FOUND", 404);
    const text = textContent(entry.message.content, 8 * 1024 * 1024);
    return { text: text.slice(offset, offset + 65536), nextOffset: offset + 65536 < text.length ? offset + 65536 : null };
  }
}
