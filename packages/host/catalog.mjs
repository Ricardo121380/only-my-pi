import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { hostError, textContent } from "./contracts.mjs";

const key = (value) => createHash("sha256").update(value).digest("hex");
export const projectIdFor = (root) => key(root);
async function regular(file, maximum) {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > maximum) { await handle.close(); throw hostError("FILE_TOO_LARGE_OR_UNSAFE"); }
  return handle;
}
async function sessionBranch(file) {
  const handle = await regular(file, 128 * 1024 * 1024);
  const stream = handle.createReadStream({ autoClose: false, encoding: "utf8", highWaterMark: 16384 });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const entries = new Map(); let leaf = null, sequence = 0;
  try {
    for await (const line of lines) {
      if (line.length > 8 * 1024 * 1024 || entries.size > 100000) throw hostError("SESSION_ENTRY_TOO_LARGE");
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (!entry || typeof entry !== "object" || entry.type === "session") continue;
      const id = typeof entry.id === "string" ? entry.id : `legacy-${sequence++}`;
      if (id.length > 256) throw hostError("SESSION_TREE_INVALID");
      const parentId = entry.parentId === undefined ? leaf : entry.parentId;
      if (parentId !== null && typeof parentId !== "string") throw hostError("SESSION_TREE_INVALID");
      entries.set(id, { ...entry, id, parentId }); leaf = id;
    }
  } finally { lines.close(); stream.destroy(); await handle.close(); }
  const branch = [], seen = new Set();
  while (leaf !== null && entries.has(leaf)) {
    if (seen.has(leaf)) throw hostError("SESSION_TREE_INVALID");
    seen.add(leaf); const entry = entries.get(leaf); branch.push(entry); leaf = entry.parentId;
  }
  return branch.reverse();
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
  async history(sessionKey, offset = 0, limit = 50) {
    const session = this.sessions.get(sessionKey); if (!session) throw hostError("SESSION_NOT_FOUND", 404);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw hostError("PAGE_INVALID");
    const entries = (await sessionBranch(session.file)).filter((entry) => entry.type === "message" && ["user", "assistant", "toolResult"].includes(entry.message?.role));
    const messages = entries.slice(offset, offset + Math.min(50, limit)).map((entry) => {
      const m = entry.message, cap = m.role === "toolResult" ? 240 : 65536;
      return { id: entry.id, role: m.role, text: textContent(m.content, cap), toolName: typeof m.toolName === "string" ? m.toolName : undefined,
        timestamp: entry.timestamp, outputAvailable: m.role === "toolResult", truncated: textContent(m.content, cap + 1).length > cap };
    });
    return { messages, nextOffset: offset + messages.length < entries.length ? offset + messages.length : null };
  }
  async toolOutput(sessionKey, entryId, offset = 0) {
    const session = this.sessions.get(sessionKey); if (!session) throw hostError("SESSION_NOT_FOUND", 404);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 8 * 1024 * 1024) throw hostError("PAGE_INVALID");
    const entry = (await sessionBranch(session.file)).find((e) => e.id === entryId && e.type === "message" && e.message?.role === "toolResult");
    if (!entry) throw hostError("TOOL_OUTPUT_NOT_FOUND", 404);
    const text = textContent(entry.message.content, 8 * 1024 * 1024);
    return { text: text.slice(offset, offset + 65536), nextOffset: offset + 65536 < text.length ? offset + 65536 : null };
  }
}
