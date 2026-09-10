import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compareM11ReleaseCore } from "../scripts/m11-compare-release-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = ["THIRD_PARTY_NOTICES.txt", "install.sh", "only-my-pi-0.3.0-preview.1-darwin-arm64-full.tar.gz", "only-my-pi-0.3.0-preview.1-darwin-arm64-thin.tar.gz", "only-my-pi-0.3.0-preview.1.spdx.json", "stack-manifest.json", "transitive-artifact-ledger.json"];

async function releaseRoot(parent, name, status, version = "0.3.0-preview.1") {
  const root = path.join(parent, name);
  await fs.mkdir(root);
  const index = JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "release-index.example.json"), "utf8"));
  index.version = version;
  index.tag = `v${version}`;
  for (const asset of Object.values(index.assets)) asset.name = asset.name.replace("0.2.0-preview.1", version);
  index.status = status;
  await fs.writeFile(path.join(root, "release-index.json"), `${JSON.stringify(index, null, 2)}\n`);
  await Promise.all(CORE.map((file) => file.replace("0.3.0-preview.1", version)).map((file) => fs.writeFile(path.join(root, file), `fixture ${file}\n`)));
  return root;
}

test("0.3 Final core comparison permits authority metadata changes but no core asset drift", async (t) => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-m11-core-")));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const rc = await releaseRoot(parent, "rc", "RC");
  const final = await releaseRoot(parent, "final", "PUBLISHED");
  const result = await compareM11ReleaseCore({ rcRoot: rc, finalRoot: final });
  assert.equal(result.status, "M11_RC_FINAL_CORE_IDENTICAL");
  assert.equal(result.assetCount, 7);
  await fs.appendFile(path.join(final, CORE[2]), "drift\n");
  await assert.rejects(compareM11ReleaseCore({ rcRoot: rc, finalRoot: final }), { code: "M11_CORE_ASSET_DRIFT" });
});

test("historical core comparisons retain their version and reject mixed releases", async (t) => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-release-core-version-")));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const rc = await releaseRoot(parent, "rc", "RC", "0.2.0-preview.1");
  const historicalFinal = await releaseRoot(parent, "historical-final", "PUBLISHED", "0.2.0-preview.1");
  assert.equal((await compareM11ReleaseCore({ rcRoot: rc, finalRoot: historicalFinal })).assetCount, 7);
  const currentFinal = await releaseRoot(parent, "current-final", "PUBLISHED");
  await assert.rejects(compareM11ReleaseCore({ rcRoot: rc, finalRoot: currentFinal }), { code: "M11_CORE_COMPARE_AUTHORITY_INVALID" });
});
