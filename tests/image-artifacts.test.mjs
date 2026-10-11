import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ImageArtifacts, validateImage } from "../packages/model-calls/artifacts.mjs";
import { imageBase64, imageDigest, imageBudget } from "./fixtures/image-host.mjs";
const block = { type: "image", mimeType: "image/png", data: imageBase64 };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-image-artifacts-")); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ImageArtifacts(root), request = { requestId: randomUUID(), accountId: "synthetic", model: "synthetic/image", parentToolCallId: "parent", inputDigest: "sha256:input", createdAt: "2026-10-11T00:00:00.000Z" };
  const input = { projectPath: "/synthetic/project", sessionId: "synthetic-session", taskId: "task", request, images: [validateImage(block, 1024)], budget: imageBudget };
  return { root, store, request, input };
}
test("PNG actual bytes are bounded and MIME, CRC and trailing data cannot substitute for an image", () => {
  assert.equal(validateImage(block, 1024).sha256, imageDigest);
  const corrupt = Buffer.from(imageBase64, "base64"); corrupt[50] ^= 1;
  for (const invalid of [{ ...block, mimeType: "image/jpeg" }, { ...block, data: "not base64" }, { ...block, data: corrupt.toString("base64") }, { ...block, data: Buffer.concat([Buffer.from(imageBase64, "base64"), Buffer.from("trailing")]).toString("base64") }]) assert.throws(() => validateImage(invalid, 1024), error => /^IMAGE_/u.test(error.code));
  assert.throws(() => validateImage(block, 32), error => error.code === "IMAGE_CONTENT_INVALID");
});
test("atomic publication keeps bytes and source metadata together and a corrupt or missing file cannot display", async t => {
  const f = await fixture(t), saved = await f.store.save(f.input), artifact = saved.artifacts[0];
  assert.equal(saved.bytes, 253); assert.equal((await f.store.read(f.input.projectPath, f.request.requestId, 0, artifact)).artifact.sha256, imageDigest);
  const directory = f.store.target(f.request.requestId); assert.deepEqual((await fs.readdir(directory)).sort(), ["0.png", "manifest.json"]);
  assert.equal((await fs.stat(path.join(directory, "0.png"))).mode & 0o777, 0o600);
  await assert.rejects(f.store.read("/another/project", f.request.requestId, 0, artifact), error => error.code === "IMAGE_ARTIFACT_CORRUPT");
  await fs.writeFile(path.join(directory, "0.png"), "corrupt"); await assert.rejects(f.store.read(f.input.projectPath, f.request.requestId, 0, artifact), error => error.code === "IMAGE_ARTIFACT_CORRUPT");
  await fs.unlink(path.join(directory, "0.png")); await assert.rejects(f.store.read(f.input.projectPath, f.request.requestId, 0, artifact), error => error.code === "IMAGE_ARTIFACT_MISSING");
});
for (const code of ["ENOSPC", "EDQUOT", "LOW_SPACE"]) test(`disk failure ${code} publishes no image or source metadata`, async t => {
  const f = await fixture(t);
  t.mock.method(fs, "statfs", async () => { if (code === "LOW_SPACE") return { bavail: 1, bsize: 512 }; throw Object.assign(new Error("filesystem fault"), { code }); });
  await assert.rejects(f.store.save(f.input), error => error.code === "IMAGE_DISK_FULL");
  assert.deepEqual(await fs.readdir(f.store.directory), []);
});
test("publication followed by a directory sync failure preserves inspectable source references as unknown", async t => {
  const f = await fixture(t), open = fs.open;
  t.mock.method(fs, "open", async (...args) => {
    const handle = await open(...args);
    if (args[0] === f.store.directory && args[1] === "r") handle.sync = async () => { throw Object.assign(new Error("synthetic sync failure"), { code: "EIO" }); };
    return handle;
  });
  const saved = await f.store.save(f.input); assert.equal(saved.status, "unknown"); assert.equal(saved.error, "IMAGE_SAVE_UNKNOWN"); assert.equal(saved.artifacts[0].sha256, imageDigest);
  assert.equal((await f.store.read(f.input.projectPath, f.request.requestId, 0, saved.artifacts[0])).bytes.length, 253);
});
