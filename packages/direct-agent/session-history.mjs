import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ownershipError } from "../host/ownership.mjs";

const entryTypes = new Set(["message", "thinking_level_change", "model_change", "usage", "compaction", "branch_summary", "custom", "custom_message", "context_edit", "label", "session_info"]);
const roles = new Set(["system", "user", "assistant", "toolResult", "bashExecution", "custom", "hookMessage", "branchSummary", "compactionSummary"]);
const content = value => typeof value === "string" || Array.isArray(value);

// Parse before handing bytes to Pi: its permissive file loader skips broken
// lines and can rewrite legacy files. Migration/projection here is in memory.
export async function readSessionSnapshot(file, sdk = undefined) {
  sdk ??= await import("@earendil-works/pi-coding-agent");
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw ownershipError("SESSION_TARGET_INVALID");
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const lines = bytes.toString("utf8").trimEnd().split("\n");
  if (lines.length > 100001 || lines.some(line => line.length > 8 * 1024 * 1024)) throw ownershipError("SESSION_ENTRY_TOO_LARGE");
  let entries;
  try { entries = lines.map(line => JSON.parse(line)); }
  catch { throw ownershipError("SESSION_TREE_INVALID"); }
  const header = entries[0], version = header?.version ?? 1;
  if (header?.type !== "session" || typeof header.id !== "string" || !header.id || typeof header.cwd !== "string") throw ownershipError("SESSION_HEADER_INVALID");
  if (!Number.isSafeInteger(version) || version < 1 || version > sdk.CURRENT_SESSION_VERSION) throw ownershipError("SESSION_READER_UPGRADE_REQUIRED");
  const ids = new Set();
  for (const entry of entries.slice(1)) {
    if (!entry || !entryTypes.has(entry.type)) throw ownershipError("SESSION_READER_UPGRADE_REQUIRED");
    if (version >= 2) {
      if (typeof entry.id !== "string" || !entry.id || entry.id.length > 256 || ids.has(entry.id)
        || (entry.parentId !== null && !ids.has(entry.parentId))) throw ownershipError("SESSION_TREE_INVALID");
      ids.add(entry.id);
    }
    if (entry.type === "message" && (!roles.has(entry.message?.role)
      || (["system", "user", "assistant", "toolResult", "custom", "hookMessage"].includes(entry.message.role) && !content(entry.message.content)))) throw ownershipError("SESSION_TREE_INVALID");
    if (entry.type === "custom_message" && !content(entry.content)) throw ownershipError("SESSION_TREE_INVALID");
    if (["context_edit", "usage"].includes(entry.type) && typeof sdk.SessionManager.prototype.buildSessionProjection !== "function") throw ownershipError("SESSION_READER_UPGRADE_REQUIRED");
    if (entry.type === "context_edit" && (!ids.has(entry.targetId) || entry.targetId === entry.id || (entry.replacement !== null && !content(entry.replacement?.content)))) throw ownershipError("SESSION_TREE_INVALID");
    if (entry.type === "usage" && (![entry.kind, entry.provider, entry.model].every(value => typeof value === "string") || !entry.usage || typeof entry.usage !== "object")) throw ownershipError("SESSION_TREE_INVALID");
  }
  let manager;
  try {
    manager = sdk.SessionManager.inMemory(header.cwd, undefined, structuredClone(entries));
    manager.buildSessionContext();
  } catch { throw ownershipError("SESSION_TREE_INVALID"); }
  return { manager, header, bytes, version };
}

// An admitted resume may migrate v1/v2. Retain the exact input first; backups
// live outside discovery so they cannot become executable session candidates.
export async function openValidatedSession(file, sdk, sessionDir, cwdOverride, configRoot) {
  const snapshot = await readSessionSnapshot(file, sdk);
  if (snapshot.version < sdk.CURRENT_SESSION_VERSION) {
    const directory = path.join(configRoot, "only-my-pi/history-backups");
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const digest = createHash("sha256").update(snapshot.bytes).digest("hex");
    const backup = path.join(directory, `${path.basename(file)}.${digest}`);
    try { await fs.writeFile(backup, snapshot.bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST" || !(await fs.readFile(backup)).equals(snapshot.bytes)) throw error;
    }
  }
  return sdk.SessionManager.open(file, sessionDir, cwdOverride);
}
