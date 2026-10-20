import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ProjectCatalog } from "../packages/host/catalog.mjs";
import { ImageExports } from "../packages/host/image-exports.mjs";
import { acquireOwnership } from "../packages/host/ownership.mjs";
import { imageBase64, imageDigest } from "./fixtures/image-host.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-image-export-"))); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "config"), projectPath = path.join(root, "project"); await fs.mkdir(configRoot); await fs.mkdir(projectPath);
  const catalog = new ProjectCatalog({ sessionRoot: path.join(root, "sessions") }), project = await catalog.add(projectPath);
  const artifact = { requestId: randomUUID(), index: 0, projectPath, sessionId: "original", taskId: "task", parentToolCallId: "script", accountId: "synthetic", model: "synthetic/draw", inputDigest: "synthetic-input", createdAt: "2026-10-11T00:00:00Z", bytes: 253, width: 64, height: 64, mimeType: "image/png", sha256: imageDigest };
  const images = { read: async () => ({ artifact, bytes: Buffer.from(imageBase64, "base64") }) };
  const exports = new ImageExports({ configRoot, catalog, images }); t.after(() => exports.stop());
  const input = { type: "prepare", projectId: project.projectId, sessionKey: "selected", entryId: "position", requestId: artifact.requestId, index: 0, path: "result.png" };
  return { root, configRoot, projectPath, project, exports, input };
}
test("bounded export process publishes actual PNG once and retains an inspectable receipt", async t => {
  const f = await fixture(t), plan = await f.exports.action(f.input);
  const result = await f.exports.action({ type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.sha256, imageDigest); assert.equal(result.worker.exitCode, 0);
  const file = path.join(f.projectPath, "result.png"), stat = await fs.stat(file); assert.equal(stat.mode & 0o777, 0o600);
  assert.equal(createHash("sha256").update(await fs.readFile(file)).digest("hex"), imageDigest);
  assert.equal((await f.exports.action({ type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false })).status, "completed");
  assert.equal((await fs.stat(file)).ino, stat.ino);
});
test("permission, project ownership and overwrite checks reject without changing original bytes", async t => {
  const f = await fixture(t), file = path.join(f.projectPath, "result.png"); await fs.writeFile(file, "original");
  const plan = await f.exports.action(f.input), commit = { type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: true };
  await assert.rejects(f.exports.action({ ...commit, codingAuthorized: false }), { code: "IMAGE_EXPORT_WRITE_PERMISSION_REQUIRED" });
  await assert.rejects(f.exports.action({ ...commit, overwrite: false }), { code: "IMAGE_EXPORT_OVERWRITE_REQUIRED" });
  const owner = await acquireOwnership(f.configRoot, "project", f.projectPath);
  await assert.rejects(f.exports.action(commit), { code: "OWNERSHIP_HELD" }); await owner.release();
  assert.equal(await fs.readFile(file, "utf8"), "original");
  await fs.writeFile(file, "external edit"); await assert.rejects(f.exports.action(commit), { code: "IMAGE_EXPORT_TARGET_CHANGED" });
  assert.equal(await fs.readFile(file, "utf8"), "external edit");
  const refreshed = await f.exports.action(f.input); const done = await f.exports.action({ ...commit, operationId: refreshed.operationId });
  assert.equal(done.status, "completed", JSON.stringify(done));
});
test("traversal, sensitive paths, symlinks and hardlinks cannot be exported", async t => {
  const f = await fixture(t), outside = path.join(f.root, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "original.png"), "protected");
  await fs.symlink(outside, path.join(f.projectPath, "link")); await fs.symlink(path.join(outside, "original.png"), path.join(f.projectPath, "leaf.png"));
  await fs.link(path.join(outside, "original.png"), path.join(f.projectPath, "hard.png"));
  for (const target of ["../outside/new.png", "/absolute.png", ".env.png", ".git/image.png", ".pi/image.png", "link/new.png", "leaf.png", "hard.png", "missing/new.png"])
    await assert.rejects(f.exports.action({ ...f.input, path: target }));
  assert.equal(await fs.readFile(path.join(outside, "original.png"), "utf8"), "protected"); assert.deepEqual(await fs.readdir(outside), ["original.png"]);
});
test("unknown completion retains owner, rejects replay and reconciles observed bytes explicitly", async t => {
  const f = await fixture(t), plan = await f.exports.action(f.input), save = f.exports.save.bind(f.exports); let fault = true;
  t.mock.method(f.exports, "save", async record => { if (fault && record.status === "completed") { fault = false; throw Object.assign(new Error("synthetic receipt persistence failure"), { atomicPublication: "NOT_PUBLISHED" }); } return save(record); });
  const commit = { type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false };
  const result = await f.exports.action(commit); assert.equal(result.status, "unknown");
  const file = path.join(f.projectPath, "result.png"), before = await fs.stat(file);
  await assert.rejects(f.exports.action(commit), { code: "IMAGE_EXPORT_RECONCILIATION_REQUIRED" }); await assert.rejects(f.exports.action(f.input), { code: "IMAGE_EXPORT_RECONCILIATION_REQUIRED" });
  await assert.rejects(acquireOwnership(f.configRoot, "project", f.projectPath), { code: "OWNERSHIP_HELD" });
  assert.equal((await f.exports.records(f.projectPath))[0].status, "unknown");
  await f.exports.stop();
  const restarted = new ImageExports({ configRoot: f.configRoot, catalog: f.exports.catalog, images: f.exports.images }); t.after(() => restarted.stop());
  assert.equal((await restarted.records(f.projectPath))[0].status, "unknown"); assert.equal((await fs.stat(file)).ino, before.ino);
  const done = await restarted.action({ type: "reconcile", operationId: plan.operationId }); assert.equal(done.status, "completed"); assert.equal(done.reconciled, true); assert.equal((await fs.stat(file)).ino, before.ino);
  const owner = await acquireOwnership(f.configRoot, "project", f.projectPath); await owner.release();
});
test("a parent moved and replaced after the publication check cannot redirect export into an outside file", async t => {
  const f = await fixture(t), parent = path.join(f.projectPath, "images"), outside = path.join(f.root, "outside"), moved = path.join(f.root, "moved");
  await fs.mkdir(parent); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "result.png"), "protected outside bytes");
  const target = f.exports.target.bind(f.exports); let reads = 0;
  t.mock.method(f.exports, "target", async (...args) => { const pinned = await target(...args); if (++reads === 3) { await fs.rename(parent, moved); await fs.symlink(outside, parent); } return pinned; });
  const plan = await f.exports.action({ ...f.input, path: "images/result.png" });
  const result = await f.exports.action({ type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false });
  assert.equal(result.status, "failed"); assert.equal(await fs.readFile(path.join(outside, "result.png"), "utf8"), "protected outside bytes");
});
test("a future export reader refuses the receipt without changing data or writing the selected target", async t => {
  const f = await fixture(t), plan = await f.exports.action(f.input), file = f.exports.file(plan.operationId);
  const future = { ...plan, version: 2 }; await fs.writeFile(file, JSON.stringify(future)); const before = await fs.readFile(file);
  await assert.rejects(f.exports.action({ type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false }), { code: "IMAGE_EXPORT_READER_REQUIRED" });
  assert.deepEqual(await fs.readFile(file), before); assert.deepEqual(await fs.readdir(f.projectPath), []);
});
