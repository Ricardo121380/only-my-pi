import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-generated-inputs.mjs", import.meta.url));

test("generated candidate CLI refuses a release purpose before creating output", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-candidate-")));
  try {
    const inputs = path.join(root, "inputs"), output = path.join(root, "output");
    await fs.mkdir(inputs);
    await fs.writeFile(path.join(inputs, "manifest.json"), '{"purpose":"FULL_RELEASE","status":"PASS"}\n');
    const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_CANDIDATE_PURPOSE_DENIED/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated candidate CLI cannot turn a forged manifest into acceptance", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-forged-")));
  try {
    const inputs = path.join(root, "inputs"), output = path.join(root, "output");
    await fs.mkdir(inputs);
    await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "GENERATED_INPUT_MATERIAL_CANDIDATE_ONLY", files: [], currentConditions: "PASS" }));
    const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_CANDIDATE_MANIFEST_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated candidate CLI preserves failed output and refuses aliases", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-protected-")));
  try {
    const inputs = path.join(root, "inputs"), output = path.join(root, "output");
    await fs.mkdir(inputs);
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, "failure.json"), "retained failure\n");
    let result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_CANDIDATE_OUTPUT_EXISTS/u);
    assert.equal(await fs.readFile(path.join(output, "failure.json"), "utf8"), "retained failure\n");
    await fs.symlink(inputs, path.join(root, "alias"));
    for (const [source, destination] of [[path.join(root, "alias"), path.join(root, "new")], [inputs, path.join(inputs, "new")]]) {
      result = spawnSync(process.execPath, [script, "--candidate", source, destination], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /GENERATED_CANDIDATE_PATH_UNSAFE/u);
      await assert.rejects(fs.lstat(destination), { code: "ENOENT" });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated candidate CLI refuses missing fixed inputs", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-missing-")));
  try {
    const inputs = path.join(root, "inputs");
    await fs.mkdir(inputs);
    const output = path.join(root, "output");
    const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_CANDIDATE_INPUT_MISSING/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
