import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureConfigDirectory, atomicWriteJson, readJsonObject, assertSafeContainedPath } from "../config-runtime/index.mjs";

export const ownershipError = (code) => Object.assign(new Error(code), { code });
export async function processIdentity(pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw ownershipError("OWNER_IDENTITY_INVALID");
  try {
    const { stdout } = await promisify(execFile)("/bin/ps", ["-p", String(pid), "-o", "lstart=", "-o", "comm="], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 3000, maxBuffer: 4096 });
    if (!stdout.trim()) return null;
    return createHash("sha256").update(`${pid}\0${stdout.trim()}`).digest("hex");
  } catch (error) {
    try { process.kill(pid, 0); } catch (probe) { if (probe.code === "ESRCH") return null; }
    throw ownershipError("OWNER_IDENTITY_UNAVAILABLE");
  }
}
export function groupAlive(pid) {
  try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
export async function acquireOwnership(configRoot, kind, key, { recover } = {}) {
  if (!["host", "project", "session"].includes(kind)) throw ownershipError("OWNERSHIP_KIND_INVALID");
  const canonicalKey = kind === "project" ? await fs.realpath(key) : key;
  const digest = createHash("sha256").update(canonicalKey).digest("hex");
  const directory = path.join(configRoot, "only-my-pi/host/locks", `${kind}-${digest}`);
  await ensureConfigDirectory(configRoot, "only-my-pi/host/locks");
  await assertSafeContainedPath(configRoot, directory);
  const ownerFile = path.join(directory, "owner.json");
  const owner = { version: 1, kind, token: randomUUID(), pid: process.pid, identity: await processIdentity(), acquiredAt: new Date().toISOString() };
  if (!owner.identity) throw ownershipError("OWNER_IDENTITY_UNAVAILABLE");
  try { await fs.mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = await readJsonObject(configRoot, ownerFile).catch(() => null);
    if (!previous || typeof previous.identity !== "string" || !Number.isSafeInteger(previous.pid)) throw ownershipError("OWNER_RECONCILIATION_REQUIRED");
    const current = await processIdentity(previous.pid);
    if (current === previous.identity) throw ownershipError("OWNERSHIP_HELD");
    // A dead owner is not sufficient proof that its children stopped.
    if (!recover) throw ownershipError("OWNER_RECONCILIATION_REQUIRED");
    const guard = `${directory}.reclaim`;
    try { await fs.mkdir(guard, { mode: 0o700 }); } catch { throw ownershipError("OWNERSHIP_HELD"); }
    try {
      const latest = await readJsonObject(configRoot, ownerFile);
      if (latest.token !== previous.token || await processIdentity(previous.pid) === previous.identity) throw ownershipError("OWNERSHIP_HELD");
      await recover(previous);
      await fs.unlink(ownerFile);
      await fs.rmdir(directory);
      await fs.mkdir(directory, { mode: 0o700 });
    } finally { await fs.rmdir(guard); }
  }
  try { await atomicWriteJson(configRoot, ownerFile, owner); }
  catch (error) { await fs.rmdir(directory).catch(() => {}); throw error; }
  let released = false;
  return { owner, async release() {
    if (released) return;
    const current = await readJsonObject(configRoot, ownerFile);
    if (current.token !== owner.token) throw ownershipError("OWNERSHIP_LOST");
    await fs.unlink(ownerFile); await fs.rmdir(directory); released = true;
  } };
}
