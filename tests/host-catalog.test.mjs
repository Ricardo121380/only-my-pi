import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { gitDiff } from "../packages/host/inspector.mjs";

test("history follows the active Pi branch, pages output lazily and never rewrites old sessions", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-history-"))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sessions = path.join(root, "sessions"), project = path.join(root, "project"); await fs.mkdir(sessions); await fs.mkdir(project);
  const file = path.join(sessions, "fixture.jsonl");
  const entries = [
    { type: "session", id: "history", version: 3, cwd: project, timestamp: "2026-09-20T00:00:00Z" },
    { type: "message", id: "a", parentId: null, message: { role: "user", content: "共同问题" } },
    { type: "message", id: "old", parentId: "a", message: { role: "assistant", content: "旧分支" } },
    { type: "message", id: "new", parentId: "a", message: { role: "assistant", content: "当前分支" } },
    { type: "message", id: "tool", parentId: "new", message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "x".repeat(70000) }] } },
  ];
  const bytes = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"; await fs.writeFile(file, bytes);
  await fs.writeFile(path.join(sessions, "broken.jsonl"), "not-json\n");
  await fs.symlink(file, path.join(sessions, "ignored.jsonl"));
  const catalog = new ProjectCatalog({ sessionRoot: sessions }); await catalog.scan();
  const [p] = catalog.listProjects(); const [s] = catalog.listSessions(p.projectId);
  assert.equal(catalog.listSessions(p.projectId).length, 1); assert.equal(catalog.diagnostics.length, 1);
  const first = await catalog.history(s.sessionKey, 0, 2);
  assert.deepEqual(first.messages.map((m) => m.text), ["共同问题", "当前分支"]); assert.equal(first.nextOffset, 2);
  const next = await catalog.history(s.sessionKey, 2); assert.equal(next.messages[0].text.length, 240);
  const output = await catalog.toolOutput(s.sessionKey, "tool"); assert.equal(output.text.length, 65536); assert.equal(output.nextOffset, 65536);
  assert.equal((await catalog.toolOutput(s.sessionKey, "tool", output.nextOffset)).text.length, 4464);
  assert.equal(await fs.readFile(file, "utf8"), bytes);
  assert.deepEqual(await catalog.resume(s.sessionKey, p.projectId), { sessionId: "history", file });
  await assert.rejects(catalog.resume(s.sessionKey, "other-project"), { code: "SESSION_NOT_FOUND" });
  await fs.writeFile(file, bytes.replace('"id":"history"', '"id":"different"'));
  await assert.rejects(catalog.resume(s.sessionKey, p.projectId), { code: "SESSION_IDENTITY_CHANGED" });
});
test("Git diff disables repository external diff, text conversion and clean filters", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-inspector-git-"))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("/usr/bin/git", args, { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root }, stdio: "pipe" });
  git("init", "-q"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(root, "file.txt"), "before\n"); git("add", "."); git("commit", "-qm", "fixture");
  await fs.writeFile(path.join(root, ".gitattributes"), "*.txt diff=unsafe filter=unsafe\n");
  for (const key of ["diff.external", "diff.unsafe.textconv", "filter.unsafe.clean", "filter.unsafe.process"]) git("config", key, "touch EXECUTED");
  git("config", "filter.unsafe.required", "true");
  await fs.writeFile(path.join(root, "file.txt"), "after\n");
  const result = await gitDiff({ path: root }); assert.equal(result.available, true); assert.match(result.text, /after/u);
  assert.equal(await fs.stat(path.join(root, "EXECUTED")).then(() => true, () => false), false);
});
