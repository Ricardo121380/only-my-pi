import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionAdmissions } from "../packages/direct-agent/session-admission.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-create-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "config"), sessions = path.join(root, "sessions");
  await fs.mkdir(config); await fs.mkdir(sessions);
  const admissions = new SessionAdmissions(config);
  return { root, config, sessions, admissions };
}

test("selected fork preserves Pi label and compaction projection without changing source", async (t) => {
  const f = await fixture(t);
  try {
    const source = await f.admissions.create(f.root, f.sessions, { id: "source" });
    const user = source.appendMessage({ role: "user", content: "first", timestamp: 1 });
    const label = source.appendLabelChange(user, "bookmark");
    const answer = source.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], timestamp: 2 });
    const leaf = source.appendCompaction("summary", label, 100);
    source.appendMessage({ role: "user", content: "excluded", timestamp: 3 });
    const bytes = await fs.readFile(source.getSessionFile());
    const fork = await f.admissions.create(f.root, f.sessions, { id: "fork", sourceFile: source.getSessionFile(), leafId: leaf });
    assert.deepEqual(await fs.readFile(source.getSessionFile()), bytes);
    assert.equal(fork.getEntry(answer).parentId, user);
    assert.equal(fork.getEntry(leaf).firstKeptEntryId, answer);
    assert.equal(fork.getLabel(user), "bookmark");
    assert.equal(fork.getEntries().filter((entry) => entry.type === "message").length, 2);
    assert.equal(fork.getTree().length, 1);
    assert.equal(fork.getHeader().parentSession, source.getSessionFile());
    await f.admissions.admit(fork.getSessionFile());
  } finally { await f.admissions.close(); }
});

test("no-assistant fork snapshot survives first assistant append with one header", async (t) => {
  const f = await fixture(t);
  try {
    const source = await f.admissions.create(f.root, f.sessions, { id: "source" });
    const user = source.appendMessage({ role: "user", content: "first", timestamp: 1 });
    source.appendMessage({ role: "assistant", content: [], timestamp: 2 });
    const fork = await f.admissions.create(f.root, f.sessions, { id: "fork", sourceFile: source.getSessionFile(), leafId: user });
    assert.ok((await fs.stat(fork.getSessionFile())).isFile());
    fork.appendMessage({ role: "assistant", content: [], timestamp: 3 });
    const entries = (await fs.readFile(fork.getSessionFile(), "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(entries.filter((entry) => entry.type === "session").length, 1);
    assert.equal(SessionManager.open(fork.getSessionFile()).getEntries().length, 2);
  } finally { await f.admissions.close(); }
});

test("new session ID is locked before SDK metadata can be persisted", async (t) => {
  const f = await fixture(t);
  try {
    const manager = await f.admissions.create(f.root, f.sessions, { id: "new-session" });
    await assert.rejects(acquireOwnership(f.config, "session", "new-session"), { code: "OWNERSHIP_HELD" });
    manager.appendModelChange("fixture", "fixture");
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: Date.now() });
    const lease = await f.admissions.admit(manager.getSessionFile());
    assert.equal(lease.id, "new-session");
  } finally { await f.admissions.close(); }
  const lease = await acquireOwnership(f.config, "session", "new-session"); await lease.release();
});

test("occupied target ID causes zero history creation", async (t) => {
  const f = await fixture(t); const owner = await acquireOwnership(f.config, "session", "reserved");
  try {
    await assert.rejects(f.admissions.create(f.root, f.sessions, { id: "reserved" }), { code: "OWNERSHIP_HELD" });
    assert.deepEqual(await fs.readdir(f.sessions), []);
  } finally { await owner.release(); await f.admissions.close(); }
});

test("real SDK fork holds source and target, preserves source bytes", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.sessions, "source.jsonl");
  const bytes = JSON.stringify({ type: "session", version: 3, id: "source", cwd: f.root, timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(source, bytes);
  try {
    const fork = await f.admissions.create(f.root, f.sessions, { id: "fork", sourceFile: source });
    assert.equal(fork.getSessionId(), "fork");
    assert.equal(await fs.readFile(source, "utf8"), bytes);
    const header = JSON.parse((await fs.readFile(fork.getSessionFile(), "utf8")).split("\n")[0]);
    assert.equal(header.parentSession, source);
    for (const id of ["source", "fork"]) await assert.rejects(acquireOwnership(f.config, "session", id), { code: "OWNERSHIP_HELD" });
    await f.admissions.admit(fork.getSessionFile());
  } finally { await f.admissions.close(); }
});

test("existing on-disk ID cannot be reused for a new history", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.sessions, "existing.jsonl");
  const bytes = '{"type":"session","id":"existing","version":3}\n';
  await fs.writeFile(file, bytes);
  try {
    await assert.rejects(f.admissions.create(f.root, f.sessions, { id: "existing" }), { code: "SESSION_ID_EXISTS" });
    assert.deepEqual(await fs.readdir(f.sessions), ["existing.jsonl"]);
    assert.equal(await fs.readFile(file, "utf8"), bytes);
  } finally { await f.admissions.close(); }
});

test("continue chooses file mtime, not conversation timestamp, and refuses occupied latest", async (t) => {
  const f = await fixture(t);
  const files = ["older", "latest"].map((id) => path.join(f.sessions, `${id}.jsonl`));
  for (const [index, file] of files.entries()) {
    await fs.writeFile(file, JSON.stringify({ type: "session", version: 1, id: index ? "latest" : "older", cwd: f.root, timestamp: index ? "2020-01-01T00:00:00Z" : "2026-01-01T00:00:00Z" }) + "\n");
    await fs.utimes(file, new Date(1000 + index * 1000), new Date(1000 + index * 1000));
  }
  const bytes = await fs.readFile(files[1], "utf8");
  const owner = await acquireOwnership(f.config, "session", "latest");
  try {
    await assert.rejects(f.admissions.continueRecent(f.root, f.sessions), { code: "SESSION_OWNERSHIP_UNAVAILABLE" });
    assert.equal(await fs.readFile(files[1], "utf8"), bytes);
  } finally { await owner.release(); }
  try {
    const manager = await f.admissions.continueRecent(f.root, f.sessions);
    assert.equal(manager.getSessionId(), "latest");
    assert.equal(manager.getHeader().version, 3);
  } finally { await f.admissions.close(); }
});

test("continue in an empty directory creates a reserved session", async (t) => {
  const f = await fixture(t);
  try {
    const manager = await f.admissions.continueRecent(f.root, f.sessions);
    await assert.rejects(acquireOwnership(f.config, "session", manager.getSessionId()), { code: "OWNERSHIP_HELD" });
  } finally { await f.admissions.close(); }
});
