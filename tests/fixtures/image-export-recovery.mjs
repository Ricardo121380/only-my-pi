import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ProjectCatalog } from "../../packages/host/catalog.mjs";
import { ImageExports } from "../../packages/host/image-exports.mjs";
import { imageBase64, imageDigest } from "./image-host.mjs";

const [phase, root, scenario] = process.argv.slice(2);
assert(path.isAbsolute(root));
const configRoot = path.join(root, "config"), projectPath = path.join(root, "project"), file = path.join(projectPath, "result.png");
await fs.mkdir(configRoot, { recursive: true }); await fs.mkdir(projectPath, { recursive: true });
const catalog = new ProjectCatalog({ sessionRoot: path.join(root, "sessions") }), project = await catalog.add(projectPath);
const artifact = { requestId: "c9bc104f-a4d5-447b-b922-0ff7d8e7e029", index: 0, projectPath, sessionId: "synthetic-source", taskId: "synthetic-task", parentToolCallId: "synthetic-script", accountId: "synthetic", model: "synthetic/draw", inputDigest: "synthetic-input", createdAt: "2026-10-11T00:00:00Z", bytes: 253, width: 64, height: 64, mimeType: "image/png", sha256: imageDigest };
let imageReads = 0;
const images = { read: async () => { imageReads++; return { artifact, bytes: Buffer.from(imageBase64, "base64") }; } };
const exports = new ImageExports({ configRoot, catalog, images });
const lock = path.join(configRoot, "only-my-pi/host/locks", `project-${createHash("sha256").update(projectPath).digest("hex")}`, "owner.json");
const receipt = async (name, data) => { const value = { pid: process.pid, imageReads, ...data }; await fs.writeFile(path.join(root, name), JSON.stringify(value, null, 2)); return value; };
let result;
if (phase === "publish-unknown") {
  const save = exports.save.bind(exports); let fault = true;
  exports.save = async record => { if (fault && record.status === "completed") { fault = false; throw Object.assign(new Error("synthetic completion receipt fault"), { atomicPublication: "NOT_PUBLISHED" }); } return save(record); };
  const plan = await exports.action({ type: "prepare", projectId: project.projectId, sessionKey: "synthetic-selected", entryId: "synthetic-entry", requestId: artifact.requestId, index: 0, path: "result.png" });
  result = await exports.action({ type: "commit", operationId: plan.operationId, codingAuthorized: true, overwrite: false });
  assert.equal(result.status, "unknown");
  await receipt("phase-1.json", { operationId: result.operationId, status: result.status, owner: result.owner, worker: result.worker, ino: (await fs.stat(file)).ino });
} else {
  const before = JSON.parse(await fs.readFile(path.join(root, "phase-1.json"), "utf8"));
  assert.notEqual(process.pid, before.pid);
  const record = (await exports.records(projectPath))[0]; assert.equal(record.status, "unknown"); assert.equal(imageReads, 0);
  await assert.rejects(exports.action({ type: "commit", operationId: before.operationId, codingAuthorized: true, overwrite: false }), { code: "IMAGE_EXPORT_RECONCILIATION_REQUIRED" });
  const handoffReceipt = async () => receipt("phase-2.json", { operationId: before.operationId, status: "unknown", owner: JSON.parse(await fs.readFile(lock, "utf8")), recordOwner: record.owner, ino: (await fs.stat(file)).ino });
  if (phase === "handoff") {
    if (scenario === "target-rejected") {
      await fs.writeFile(file, "external target edit");
      result = await exports.action({ type: "reconcile", operationId: before.operationId });
      assert.equal(result.status, "unknown"); assert.equal(await fs.readFile(file, "utf8"), "external target edit");
      await handoffReceipt();
    } else if (scenario === "crash-after-handoff") {
      // Stop the actual process after durable ownership acquisition, before
      // target inspection or any ledger update. There is no live worker.
      exports.target = async () => { await handoffReceipt(); process.exit(0); };
      await exports.action({ type: "reconcile", operationId: before.operationId });
      throw new Error("handoff crash seam was not reached");
    } else throw new Error("scenario required");
  } else if (phase === "reconcile") {
    const middle = JSON.parse(await fs.readFile(path.join(root, "phase-2.json"), "utf8")); assert.notEqual(process.pid, middle.pid);
    if (scenario === "target-rejected") await fs.writeFile(file, Buffer.from(imageBase64, "base64"));
    try { result = await exports.action({ type: "reconcile", operationId: before.operationId }); }
    catch (error) { await receipt("phase-3.json", { operationId: before.operationId, error: error.code }); throw error; }
    await receipt("phase-3.json", { operationId: before.operationId, status: result.status, owner: result.owner, reconciled: result.reconciled, ino: (await fs.stat(file)).ino });
    assert.equal(result.status, "completed"); assert.equal(result.reconciled, true); assert.equal(imageReads, 0);
    assert.deepEqual(result.worker, before.worker); assert.equal((await fs.stat(file)).ino, before.ino);
    assert.equal(createHash("sha256").update(await fs.readFile(file)).digest("hex"), imageDigest);
    await assert.rejects(fs.stat(lock), { code: "ENOENT" });
  } else throw new Error("phase required");
}
await exports.stop();
console.log(JSON.stringify({ pid: process.pid, phase, imageReads, status: result.status }));
