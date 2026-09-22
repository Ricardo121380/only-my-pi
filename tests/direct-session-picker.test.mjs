import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as sdk from "@earendil-works/pi-coding-agent";
import { createReadOnlySessionPicker, selectResumeSession } from "../packages/direct-agent/session-picker.mjs";

test("public Pi picker selects and cancels while deletion and rename cannot mutate history", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-picker-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "fixture.jsonl");
  const original = JSON.stringify({ type: "session", version: 1, id: "picker-fixture", cwd: root, timestamp: new Date().toISOString() }) + "\n";
  await fs.writeFile(file, original);
  sdk.initTheme("dark", false);
  let selected, cancelled = 0, error;
  const selector = createReadOnlySessionPicker({ sdk,
    currentSessions: () => sdk.SessionManager.list(root, root),
    allSessions: () => sdk.SessionManager.listAll(root),
    onSelect: (value) => { selected = value; }, onCancel: () => { cancelled++; }, requestRender() {} });
  const list = selector.getSessionList();
  // Use the component's public callbacks: the native deletion implementation
  // must be replaced even when invoked without its keyboard confirmation UI.
  list.onError = (message) => { error = message; };
  await list.onDeleteSession(file);
  list.onRenameSession(file);
  assert.match(error, /read-only/);
  assert.equal(await fs.readFile(file, "utf8"), original);
  list.onSelect(file); assert.equal(selected, file);
  list.onCancel(); list.onExit(); assert.equal(cancelled, 2);
  // Settle public async discovery before removing the fixture.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await fs.readFile(file, "utf8"), original);
});

test("resume picker refuses a nonterminal before loading UI or touching a session", async () => {
  // node --test runs this test in a piped child process.
  assert.ok(!process.stdin.isTTY || !process.stdout.isTTY);
  await assert.rejects(selectResumeSession({}), { code: "SESSION_PICKER_TTY_REQUIRED" });
});
