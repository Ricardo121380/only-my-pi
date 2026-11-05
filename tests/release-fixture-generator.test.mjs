import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("release fixture generation retains historical bytes and default check never overwrites drift", async t => {
  const repo = fileURLToPath(new URL("../", import.meta.url)), root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-release-fixtures-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts")); await fs.symlink(path.join(repo, "packages"), path.join(root, "packages"));
  const script = path.join(root, "scripts/generate-release-contract-fixtures.mjs");
  await fs.copyFile(path.join(repo, "scripts/generate-release-contract-fixtures.mjs"), script);
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const generated = run(["--output", root]); assert.equal(generated.status, 0, generated.stderr);
  assert.equal(JSON.parse(generated.stdout).fixtureVersion, "0.2.0-preview.1");
  const files = [];
  async function walk(directory) { for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) { const name = path.join(directory, entry.name); if (entry.isDirectory()) await walk(name); else files.push(name); } }
  await walk("contracts"); await walk("verification"); assert.equal(files.length, 16);
  for (const file of files) assert.deepEqual(await fs.readFile(path.join(root, file)), await fs.readFile(path.join(repo, file)), file);
  assert.equal(run([]).status, 0);
  const file = path.join(root, files[0]), drift = (await fs.readFile(file, "utf8")) + "\n";
  await fs.writeFile(file, drift);
  const checked = run([]); assert.equal(checked.status, 1);
  assert.deepEqual(JSON.parse(checked.stdout).mismatches, [files[0]]);
  assert.equal(await fs.readFile(file, "utf8"), drift);
  assert.equal(run(["--unknown"]).status, 1);
});
