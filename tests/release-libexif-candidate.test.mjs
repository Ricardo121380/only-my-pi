import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-libexif-generation.mjs", import.meta.url));

test("new libexif candidate refuses missing fixed inputs before creating output", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-candidate-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, "inputs"), output = path.join(root, "output");
  await fs.mkdir(inputs);
  const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXIF_CANDIDATE_INPUT_MISSING/u);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("new libexif candidate rejects a different purpose before creating output", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-purpose-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, "inputs"), output = path.join(root, "output");
  await fs.mkdir(inputs);
  await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "FULL_RELEASE" }));
  const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXIF_CANDIDATE_PURPOSE_DENIED/u);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});

test("new libexif candidate does not overwrite an existing output", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-existing-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, "inputs"), output = path.join(root, "output");
  await fs.mkdir(inputs);
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "user-material"), "keep");
  const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXIF_CANDIDATE_OUTPUT_EXISTS/u);
  assert.equal(await fs.readFile(path.join(output, "user-material"), "utf8"), "keep");
});

test("new libexif candidate refuses aliases and overlapping roots", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-alias-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, "inputs");
  await fs.mkdir(inputs);
  const alias = path.join(root, "alias");
  await fs.symlink(inputs, alias);
  for (const [source, output] of [[alias, path.join(root, "output")], [inputs, path.join(inputs, "output")]]) {
    const result = spawnSync(process.execPath, [script, "--candidate", source, output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXIF_CANDIDATE_PATH_UNSAFE/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  }
});

test("new libexif candidate refuses an unapproved manifest", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-manifest-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputs = path.join(root, "inputs"), output = path.join(root, "output");
  await fs.mkdir(inputs);
  await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "LIBEXIF_DOCUMENT_CANDIDATE_ONLY", files: [] }));
  const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /EXIF_CANDIDATE_MANIFEST_DRIFT/u);
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
});
