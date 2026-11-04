import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { createMinimalWebFixture } from "./fixtures/minimal-web.mjs";

test("minimal workspace reads actual files and tracked diffs without exposing excluded files or running a model", { timeout: 20000 }, async t => {
  const f = await createMinimalWebFixture(); t.after(async () => { await f.stop(); await f.cleanup(); });
  const root = f.f.project, git = (...args) => execFileSync("/usr/bin/git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q"); git("config", "user.name", "fixture"); git("config", "user.email", "fixture@example.invalid");
  await fs.writeFile(path.join(root, "visible.txt"), "before\n"); await fs.writeFile(path.join(root, ".env"), "SECRET=before\n");
  git("add", "--", "visible.txt", ".env"); git("commit", "-qm", "workspace fixture");
  await fs.writeFile(path.join(root, "visible.txt"), "after\n"); await fs.writeFile(path.join(root, ".env"), "SECRET=never-show-this-diff\n");
  await fs.writeFile(path.join(root, "untracked.txt"), "untracked-only-content\n"); await fs.symlink("visible.txt", path.join(root, "alias.txt"));
  const origin = f.host.origin;
  const paired = await fetch(origin + "/pair", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(f.host.pairingUrl).hash.slice(6) }) });
  const headers = { cookie: paired.headers.get("set-cookie").split(";")[0] };
  const project = await f.host.catalog.add(root), query = route => `${origin}/api/${route}?projectId=${project.projectId}`;
  assert.equal((await fetch(query("files"))).status, 401);
  assert.equal((await (await fetch(origin + "/api/state", { headers })).json()).capabilities.inspector.protocol, 1);
  const files = await fetch(query("files"), { headers }); assert.equal(files.status, 200);
  const names = (await files.json()).entries.map(entry => entry.name);
  assert.ok(names.includes("visible.txt")); assert.ok(names.includes("untracked.txt"));
  assert.ok(!names.includes(".env") && !names.includes(".git") && !names.includes("alias.txt"));
  const preview = await fetch(query("file") + "&path=visible.txt", { headers }); assert.equal(preview.status, 200);
  assert.equal((await preview.json()).text, "after\n");
  for (const candidate of ["../outside", ".env", "alias.txt"]) assert.equal((await fetch(query("file") + "&path=" + encodeURIComponent(candidate), { headers })).status, 403);
  const diff = await fetch(query("diff"), { headers }); assert.equal(diff.status, 200);
  const changed = await diff.json(); assert.equal(changed.available, true); assert.match(changed.text, /after/);
  assert.doesNotMatch(changed.text, /SECRET|never-show-this-diff|untracked-only-content/);
  assert.equal(f.received.length, 0);
});

test("history correlates tool paths across page boundaries and keeps arguments private", async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-history-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const manager = SessionManager.create(root, root);
  manager.appendMessage({ role: "user", content: "inspect", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [
    { type: "toolCall", id: "file-call", name: "write", arguments: { path: path.join(root, "src/new.mjs"), content: "private-arguments-body" } },
    { type: "toolCall", id: "outside-call", name: "read", arguments: { path: path.join(root, "../outside") } },
    { type: "toolCall", id: "secret-call", name: "read", arguments: { path: ".env" } },
  ], timestamp: 2 });
  for (let i = 0; i < 50; i++) manager.appendMessage({ role: "user", content: `padding ${i}`, timestamp: i + 3 });
  for (const [toolCallId, toolName] of [["file-call", "write"], ["outside-call", "read"], ["secret-call", "read"], ["missing-call", "read"]]) manager.appendMessage({ role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "result" }], isError: false, timestamp: 100 });
  const original = await fs.readFile(manager.getSessionFile());
  const catalog = new ProjectCatalog({ sessionRoot: root }); await catalog.scan();
  const session = catalog.listSessions(catalog.listProjects()[0].projectId)[0];
  const history = await catalog.history(session.sessionKey, 50);
  const results = history.messages.filter(message => message.role === "toolResult");
  assert.deepEqual(results.map(message => message.filePath), ["src/new.mjs", undefined, undefined, undefined]);
  assert.equal(results[0].toolCallId, "file-call");
  assert.doesNotMatch(JSON.stringify(history), /private-arguments-body/);
  assert.ok(!JSON.stringify(history).includes(path.join(root, "../outside")));
  assert.deepEqual(await fs.readFile(manager.getSessionFile()), original);
});
