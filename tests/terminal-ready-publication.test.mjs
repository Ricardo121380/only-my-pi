import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { atomicWriteJson, readJsonObject } from "../packages/config-runtime/atomic-file.mjs";

test("exclusive atomic receipts preserve existing and concurrently published evidence", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-receipt-exclusive-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const target = path.join(root, "terminal.json");
  await assert.rejects(atomicWriteJson(root, target, { token: "new" }, { exclusive: true,
    beforeRename: () => fs.writeFile(target, JSON.stringify({ token: "old" }), { flag: "wx" }),
  }), { code: "EEXIST" });
  await assert.rejects(atomicWriteJson(root, target, { token: "new" }, { exclusive: true }), { code: "EEXIST" });
  assert.deepEqual(await readJsonObject(root, target), { token: "old" });
  assert.deepEqual(await fs.readdir(root), ["terminal.json"]);
});
