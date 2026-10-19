import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const digest = bytes => "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex");

for (const entry of [
  { id: "gir", cli: "webui-g2-gir-materials.mjs", module: "gir-material-candidate.mjs", recipe: "native-gir-candidate.json", purpose: "GIR_MATERIAL_CANDIDATE_ONLY", error: "GIR_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED" },
  { id: "generated", cli: "webui-g2-generated-inputs.mjs", module: "generated-input-candidate.mjs", recipe: "native-generated-candidate.json", purpose: "GENERATED_INPUT_MATERIAL_CANDIDATE_ONLY", error: "GENERATED_CANDIDATE_PRIVATE_PATH_BINDINGS_REQUIRED" },
]) {
  test(`${entry.id} material CLI rejects unbound private paths before writing output`, async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-public-projection-")));
    try {
      const mirror = path.join(root, "checkout"), inputs = path.join(root, "inputs"), output = path.join(root, "output");
      const cli = path.join(mirror, "scripts/probes", entry.cli);
      const module = path.join(mirror, "scripts/probes/lib", entry.module);
      const recipe = path.join(mirror, "contracts/release/parser-resources-v1", entry.recipe);
      for (const dir of [inputs, path.dirname(cli), path.dirname(module), path.dirname(recipe)]) await fs.mkdir(dir, { recursive: true });
      const manifestBytes = Buffer.from(JSON.stringify({ purpose: entry.purpose, files: [] }));
      const recipeBytes = Buffer.from(JSON.stringify({ manifestSha256: digest(manifestBytes), protectedInputRoots: ["LOCAL_WORKSPACE/private-inputs"] }));
      await fs.writeFile(path.join(inputs, "manifest.json"), manifestBytes);
      await fs.writeFile(recipe, recipeBytes);
      await fs.copyFile(path.join(repo, "scripts/probes", entry.cli), cli);
      let moduleText = await fs.readFile(path.join(repo, "scripts/probes/lib", entry.module), "utf8");
      if (entry.id === "generated") {
        // Bind the isolated runner to this test-owned recipe. The production
        // runner and its exact recipe pin remain untouched.
        const productionPin = digest(await fs.readFile(path.join(repo, "contracts/release/parser-resources-v1", entry.recipe)));
        assert.equal(moduleText.split(productionPin).length, 2);
        moduleText = moduleText.replace(productionPin, digest(recipeBytes));
      }
      await fs.writeFile(module, moduleText);
      const result = spawnSync(process.execPath, [cli, "--candidate", inputs, output], { encoding: "utf8", timeout: 10000 });
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(entry.error, "u"));
      for (const name of [output, output + ".execution", output + ".receipt.json"]) await assert.rejects(fs.lstat(name), { code: "ENOENT" });
      assert.equal(await fs.readFile(path.join(inputs, "manifest.json"), "utf8"), manifestBytes.toString());
      assert.deepEqual(await fs.readdir(inputs), ["manifest.json"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}
