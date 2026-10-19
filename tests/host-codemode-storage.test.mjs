import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createMcpHost, providerReply, until, untilPiInitialized } from "./fixtures/mcp-host.mjs";

const terminal = (task) => ["succeeded", "failed", "cancelled"].includes(task.status);
async function storageHost(t) {
  let code, phaseBase;
  const f = await createMcpHost({ installedExtensions: true, respond: ({ res }, requests) => providerReply(res, requests.length === phaseBase + 1 ? "codemode" : null, { code }) });
  t.after(() => f.close());
  const execute = async (source, sessionKey) => {
    code = source; phaseBase = f.requests.length;
    const started = await f.start(sessionKey ? { resumeSessionKey: sessionKey } : {});
    await untilPiInitialized(() => f.task(started.taskId));
    const final = await until(() => f.task(started.taskId), terminal, "store byte boundary", 15000);
    assert.ok(final.toolCalls.some(item => item.name === "codemode"), JSON.stringify({ status: final.status, error: final.error }));
    await Promise.all([...f.host.tasks.running.values()]); await f.host.scan();
    const { sessions } = await f.request(`/api/sessions?projectId=${f.projectId}`);
    const session = sessions.find((item) => item.sessionId === final.sessionId);
    return { task: final, call: final.toolCalls.find((item) => item.name === "codemode"), sessionKey: session.sessionKey, file: (await f.host.catalog.resume(session.sessionKey, f.projectId)).file };
  };
  return { f, execute };
}

test("the store byte limit applies across real resumed scripts and allows replacing or deleting values", { timeout: 50000 }, async (t) => {
  const { execute } = await storageHost(t);
  const first = await execute('store("a", "中".repeat(200000)); text("first stored");');
  assert.equal(first.call.status, "completed");
  const second = await execute('store("b", "中".repeat(200000)); text("second stored");', first.sessionKey);
  assert.equal(second.call.status, "failed", "separate sublimit deltas must not accumulate beyond 1 MiB");
  assert.match(second.call.result, /CODEMODE_STORAGE_LIMIT/);
  const unchanged = await execute('text(load("a").length); text(load("b"));', first.sessionKey);
  assert.match(unchanged.call.result, /200000[\s\S]*undefined/);
  const replaced = await execute('store("a", "文".repeat(200000)); text(load("a").length);', first.sessionKey);
  assert.equal(replaced.call.status, "completed");
  const deleted = await execute('store("a", undefined); store("b", "中".repeat(200000)); text(load("a")); text(load("b").length);', first.sessionKey);
  assert.equal(deleted.call.status, "completed");
  assert.match(deleted.call.result, /undefined[\s\S]*200000/);
  assert.equal(SessionManager.open(first.file).getEntries().filter((entry) => entry.customType === "codemode-store").length, 3);
});

test("an oversized native history store is refused before a restored script starts", { timeout: 30000 }, async (t) => {
  const { f, execute } = await storageHost(t);
  // Build legacy history through Pi's public API; only the restore needs a worker.
  // The message persists the native session without carrying any OMP grants.
  const manager = SessionManager.create(f.project, f.host.catalog.sessionRoot);
  manager.appendMessage({ role: "user", content: "native legacy store fixture", timestamp: 1 });
  manager.appendCustomEntry("codemode-store", { set: { a: "中".repeat(200000), b: "中".repeat(200000) }, delete: [] });
  const file = manager.getSessionFile(), before = await fs.readFile(file);
  await f.host.scan();
  const { sessions } = await f.request(`/api/sessions?projectId=${f.projectId}`);
  const session = sessions.find((entry) => entry.sessionId === manager.getSessionId());
  assert.ok(session, "the real Host indexes the native session before restore");
  const restored = await execute('store("executed", true); text("unexpected script execution");', session.sessionKey);
  assert.equal(restored.file, file);
  assert.equal(restored.task.sessionId, manager.getSessionId());
  assert.equal(restored.call.status, "failed");
  assert.match(restored.call.result, /CODEMODE_STORAGE_LIMIT/);
  assert.doesNotMatch(restored.call.result, /unexpected script execution/);
  const entries = SessionManager.open(file).getEntries();
  assert.equal(entries.filter((entry) => entry.customType === "codemode-store").length, 1);
  assert.ok((await fs.readFile(file)).subarray(0, before.length).equals(before), "legacy history is not rewritten");
});
