import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/probes/webui-g2-gir-materials.mjs", import.meta.url));

async function fixture(run) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-gir-candidate-")));
  const inputs = path.join(root, "inputs"), output = path.join(root, "output");
  await fs.mkdir(inputs);
  try { await run({ root, inputs, output }); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

function rejected(inputs, output, code) {
  const result = spawnSync(process.execPath, [script, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(code, "u"));
}

test("new GIR entry refuses an invented purpose and an unpinned admission claim", async () => fixture(async ({ inputs, output }) => {
  await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "FULL_RELEASE", candidateAdmission: "PASS", files: [] }));
  rejected(inputs, output, "GIR_CANDIDATE_PURPOSE_DENIED");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
  await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "GIR_MATERIAL_CANDIDATE_ONLY", candidateAdmission: "PASS", files: [] }));
  rejected(inputs, output, "GIR_CANDIDATE_MANIFEST_DRIFT");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
}));

test("new GIR entry rejects a missing manifest without creating partial output", async () => fixture(async ({ inputs, output }) => {
  rejected(inputs, output, "GIR_CANDIDATE_INPUT_MISSING");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
}));

test("new GIR entry preserves both an earlier output and an orphaned failure receipt", async () => fixture(async ({ inputs, output }) => {
  const receipt = output + ".receipt.json";
  await fs.writeFile(receipt, "retained failure\n");
  rejected(inputs, output, "GIR_CANDIDATE_OUTPUT_EXISTS");
  assert.equal(await fs.readFile(receipt, "utf8"), "retained failure\n");
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "failed.json"), "retained output\n");
  rejected(inputs, output, "GIR_CANDIDATE_OUTPUT_EXISTS");
  assert.equal(await fs.readFile(path.join(output, "failed.json"), "utf8"), "retained output\n");
}));

test("new GIR entry refuses input aliases, manifest aliases and nested output", async () => fixture(async ({ root, inputs, output }) => {
  const alias = path.join(root, "alias");
  await fs.symlink(inputs, alias);
  rejected(alias, output, "GIR_CANDIDATE_PATH_UNSAFE");
  rejected(inputs, path.join(inputs, "nested"), "GIR_CANDIDATE_PATH_UNSAFE");
  const outsideManifest = path.join(root, "manifest.json");
  await fs.writeFile(outsideManifest, "{}\n");
  await fs.symlink(outsideManifest, path.join(inputs, "manifest.json"));
  rejected(inputs, output, "GIR_CANDIDATE_PATH_UNSAFE");
  await assert.rejects(fs.lstat(output), { code: "ENOENT" });
}));

test("new GIR entry protects original inputs outside the supplied supplement", async () => fixture(async ({ root, inputs }) => {
  const mirror = path.join(root, "checkout"), protectedRoot = path.join(root, "original-kit");
  await fs.mkdir(protectedRoot);
  const cli = path.join(mirror, "scripts/probes/webui-g2-gir-materials.mjs");
  const module = path.join(mirror, "scripts/probes/lib/gir-material-candidate.mjs");
  const recipe = path.join(mirror, "contracts/release/parser-resources-v1/native-gir-candidate.json");
  for (const file of [cli, module, recipe]) await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.copyFile(script, cli);
  await fs.copyFile(new URL("../scripts/probes/lib/gir-material-candidate.mjs", import.meta.url), module);
  await fs.writeFile(recipe, JSON.stringify({ protectedInputRoots: [protectedRoot] }));
  await fs.writeFile(path.join(inputs, "manifest.json"), JSON.stringify({ purpose: "GIR_MATERIAL_CANDIDATE_ONLY" }));
  const output = path.join(protectedRoot, "new");
  const result = spawnSync(process.execPath, [cli, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GIR_CANDIDATE_PATH_UNSAFE/u);
  assert.deepEqual(await fs.readdir(protectedRoot), []);
}));
