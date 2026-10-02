import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-generated-inputs.mjs", import.meta.url));

test("generated-input material CLI rejects a changed recipe before trusting closure claims", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-recipe-")));
  try {
    const cli = path.join(root, "checkout/scripts/probes/webui-g2-generated-inputs.mjs");
    const recipe = path.join(root, "checkout/contracts/release/parser-resources-v1/native-generated-inputs.json");
    await fs.mkdir(path.dirname(cli), { recursive: true });
    await fs.mkdir(path.dirname(recipe), { recursive: true });
    await fs.copyFile(script, cli);
    await fs.writeFile(recipe, '{"issueCompletion":"PASS","Full":"PASS"}\n');
    for (const name of ["kit", "notices", "origins"]) await fs.mkdir(path.join(root, name));
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [cli, ...["kit", "notices", "origins"].map((name) => path.join(root, name)), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_INPUT_RECIPE_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated-input material CLI preserves an existing supplement and failure record", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-existing-")));
  try {
    for (const name of ["kit", "notices", "origins", "output"]) await fs.mkdir(path.join(root, name));
    const marker = path.join(root, "output/failed.json");
    await fs.writeFile(marker, "retained failure\n");
    const result = spawnSync(process.execPath, [script, ...["kit", "notices", "origins", "output"].map((name) => path.join(root, name))], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_INPUT_OUTPUT_EXISTS/u);
    assert.equal(await fs.readFile(marker, "utf8"), "retained failure\n");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated-input material CLI refuses aliases and output inside an input or checkout", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-path-")));
  try {
    for (const name of ["kit", "notices", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.symlink(path.join(root, "kit"), path.join(root, "alias"));
    const checkoutOutput = fileURLToPath(new URL("../generated-test-output-must-not-exist", import.meta.url));
    for (const [kit, output] of [[path.join(root, "alias"), path.join(root, "new")], [path.join(root, "kit"), path.join(root, "kit/new")], [path.join(root, "kit"), checkoutOutput]]) {
      const result = spawnSync(process.execPath, [script, kit, path.join(root, "notices"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /GENERATED_INPUT_PATH_UNSAFE/u);
      await assert.rejects(fs.lstat(output), { code: "ENOENT" });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated-input material CLI rejects missing fixed inputs without creating a supplement", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-missing-")));
  try {
    for (const name of ["kit", "notices", "origins"]) await fs.mkdir(path.join(root, name));
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, ...["kit", "notices", "origins"].map((name) => path.join(root, name)), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_INPUT_MISSING/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("generated-input material CLI rejects a forged kit identity and pass status", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-generated-kit-")));
  try {
    for (const name of ["kit", "notices", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, "kit/kit.json"), '{"kitSha256":"sha256:forged","status":"PASS"}\n');
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, ...["kit", "notices", "origins"].map((name) => path.join(root, name)), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GENERATED_INPUT_KIT_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
