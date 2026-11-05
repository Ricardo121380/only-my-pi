import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createClassificationHost } from "./fixtures/classification-host.mjs";

test("classification evidence creates its output directory and cannot skip fixture cleanup on a write failure", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-classification-evidence-"));
  const prior = process.env.OMP_CLASSIFIER_EVIDENCE_DIR;
  t.after(async () => { if (prior === undefined) delete process.env.OMP_CLASSIFIER_EVIDENCE_DIR; else process.env.OMP_CLASSIFIER_EVIDENCE_DIR = prior; await fs.rm(root, { recursive: true, force: true }); });
  const directory = path.join(root, "new", "receipts");
  process.env.OMP_CLASSIFIER_EVIDENCE_DIR = directory;
  const first = await createClassificationHost();
  await first.close();
  assert.equal((await fs.readdir(directory)).length, 1);
  await assert.rejects(fs.access(first.root), { code: "ENOENT" });
  const notDirectory = path.join(root, "file"); await fs.writeFile(notDirectory, "owned fixture only");
  process.env.OMP_CLASSIFIER_EVIDENCE_DIR = notDirectory;
  const second = await createClassificationHost();
  await assert.rejects(second.close(), { code: "EEXIST" });
  await assert.rejects(fs.access(second.root), { code: "ENOENT" });
  await assert.rejects(fetch(second.host.origin));
});
