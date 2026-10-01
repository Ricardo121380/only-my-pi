import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-libexif-generation.mjs", import.meta.url));

test("material CLI rejects existing output without changing retained evidence", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-generation-")));
  try {
    for (const name of ["prior", "origins", "output"]) await fs.mkdir(path.join(root, name));
    const retained = path.join(root, "output/retained.json");
    await fs.writeFile(retained, "prior failure evidence\n");
    const result = spawnSync(process.execPath, [script, path.join(root, "prior"), path.join(root, "origins"), path.join(root, "output")], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXIF_GENERATION_OUTPUT_EXISTS/u);
    assert.equal(await fs.readFile(retained, "utf8"), "prior failure evidence\n");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("material CLI refuses aliased and overlapping roots before creating output", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-generation-path-")));
  try {
    for (const name of ["prior", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.symlink(path.join(root, "prior"), path.join(root, "alias"));
    for (const [prior, output] of [["alias", "new"], ["prior", "prior/new"]]) {
      const result = spawnSync(process.execPath, [script, path.join(root, prior), path.join(root, "origins"), path.join(root, output)], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /EXIF_GENERATION_PATH_UNSAFE/u);
      await assert.rejects(fs.lstat(path.join(root, output)), { code: "ENOENT" });
    }
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("material CLI rejects missing fixed inputs without manufacturing a supplement", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-generation-input-")));
  try {
    for (const name of ["prior", "origins"]) await fs.mkdir(path.join(root, name));
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, path.join(root, "prior"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXIF_GENERATION_INPUT_MISSING/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("material CLI refuses a different prior receipt instead of accepting its claims", async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-exif-generation-receipt-")));
  try {
    for (const name of ["prior", "origins"]) await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, "prior/libexif-doc-materials.json"), '{"status":"PASS"}\n');
    const output = path.join(root, "new");
    const result = spawnSync(process.execPath, [script, path.join(root, "prior"), path.join(root, "origins"), output], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /EXIF_GENERATION_PRIOR_DRIFT/u);
    await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
