import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-gir-materials.mjs", import.meta.url));

test("GIR material CLI rejects a changed contract before trusting new scope claims", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-contract-")));
  try {
    const mirror = path.join(root, "checkout");
    const cli = path.join(mirror, "scripts/probes/webui-g2-gir-materials.mjs");
    const recipe = path.join(mirror, "contracts/release/parser-resources-v1/native-gir-materials.json");
    await fs.mkdir(path.dirname(cli), { recursive: true });
    await fs.mkdir(path.dirname(recipe), { recursive: true });
    await fs.copyFile(script, cli);
    await fs.writeFile(recipe, '{"issueCompletion":"PASS","Full":"PASS"}\n');
    for (const name of ["kit", "origins"]) await fs.mkdir(path.join(root, name));
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [cli, path.join(root, "kit"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GIR_MATERIAL_RECIPE_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("GIR material CLI refuses to overwrite retained failure evidence", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-materials-")));
  try {
    for (const name of ["kit", "origins", "output"]) await fs.mkdir(path.join(root, name));
    const marker = path.join(root, "output/failed.json");
    await fs.writeFile(marker, "original failure evidence\n");
    const result = spawnSync(process.execPath, [script, path.join(root, "kit"), path.join(root, "origins"), path.join(root, "output")], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GIR_MATERIAL_OUTPUT_EXISTS/u);
    assert.equal(await fs.readFile(marker, "utf8"), "original failure evidence\n");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("GIR material CLI keeps missing supply material as a failure without creating output", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-missing-")));
  try {
    for (const name of ["kit", "origins"]) await fs.mkdir(path.join(root, name));
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, path.join(root, "kit"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GIR_MATERIAL_INPUT_MISSING/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("GIR material CLI refuses aliases and output inside an input or checkout", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-path-")));
  try {
    for (const name of ["kit", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.symlink(path.join(root, "kit"), path.join(root, "alias"));
    const checkoutOutput = fileURLToPath(new URL("../gir-test-output-must-not-exist", import.meta.url));
    for (const [kit, output] of [[path.join(root, "alias"), path.join(root, "new")], [path.join(root, "kit"), path.join(root, "kit/new")], [path.join(root, "kit"), checkoutOutput]]) {
      const result = spawnSync(process.execPath, [script, kit, path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /GIR_MATERIAL_PATH_UNSAFE/u);
      await assert.rejects(fs.lstat(output), { code: "ENOENT" });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("GIR material CLI rejects a kit receipt that claims an unverified pass", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-kit-")));
  try {
    for (const name of ["kit", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, "kit/kit.json"), '{"status":"PASS","kitSha256":"sha256:forged"}\n');
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, path.join(root, "kit"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GIR_MATERIAL_KIT_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
