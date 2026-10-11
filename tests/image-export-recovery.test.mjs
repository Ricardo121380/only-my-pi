import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./fixtures/image-export-recovery.mjs", import.meta.url));
for (const scenario of ["target-rejected", "crash-after-handoff"]) {
  test(`unknown export remains explicitly recoverable across three processes: ${scenario}`, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-export-recovery-")));
    t.after(async () => {
      if (process.env.OMP_IMAGE_EVIDENCE_DIR) {
        const evidence = path.join(process.env.OMP_IMAGE_EVIDENCE_DIR, `export-recovery-${scenario}`);
        await fs.mkdir(path.dirname(evidence), { recursive: true }); await fs.cp(root, evidence, { recursive: true });
      }
      await fs.rm(root, { recursive: true, force: true });
    });
    for (const phase of ["publish-unknown", "handoff", "reconcile"]) {
      const { stdout } = await promisify(execFile)(process.execPath, [fixture, phase, root, scenario], { timeout: 30000, maxBuffer: 65536 });
      if (stdout.trim()) t.diagnostic(stdout.trim());
    }
    const receipts = await Promise.all([1, 2, 3].map(async n => JSON.parse(await fs.readFile(path.join(root, `phase-${n}.json`), "utf8"))));
    assert.equal(new Set(receipts.map(r => r.pid)).size, 3);
    assert.equal(receipts[1].owner.pid, receipts[1].pid); assert.notEqual(receipts[1].owner.identity, receipts[0].owner.identity);
    assert.equal(receipts[1].imageReads, 0); assert.equal(receipts[2].imageReads, 0);
    assert.equal(receipts[2].status, "completed"); assert.equal(receipts[2].reconciled, true);
    assert.equal(receipts[2].ino, receipts[0].ino);
  });
}
