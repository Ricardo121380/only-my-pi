import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dependencyNotices } from "./vite.config.ts";

test("a notice supplement cannot exempt another version, license or package", async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-notices-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "node_modules/fixture");
  await fs.mkdir(root, { recursive: true });
  const file = path.join(dir, "upstream-LICENSE");
  await fs.writeFile(file, "Full upstream notice\n");
  const emitted = [];
  const context = { getModuleIds: () => [path.join(root, "index.js")], emitFile: asset => emitted.push(asset) };
  const supplements = { "fixture@1.0.0": { license: "MIT", file, source: "https://example.invalid/fixed-source/LICENSE" } };
  for (const manifest of [
    { name: "fixture", version: "1.0.1", license: "MIT" },
    { name: "fixture", version: "1.0.0", license: "Apache-2.0" },
    { name: "another-package", version: "1.0.0", license: "MIT" },
  ]) {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify(manifest));
    await assert.rejects(dependencyNotices(supplements).generateBundle.call(context), /Missing frontend licenses:/);
    assert.equal(emitted.length, 0);
  }
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0", license: "MIT" }));
  await dependencyNotices(supplements).generateBundle.call(context);
  assert.equal(JSON.parse(emitted.find(a => a.fileName === "dependencies.json").source)[0].noticeSource, supplements["fixture@1.0.0"].source);
  assert.match(emitted.find(a => a.fileName === "THIRD_PARTY_NOTICES.txt").source, /Full upstream notice/);
});
