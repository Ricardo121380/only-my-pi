import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildM11WorkflowRelease } from "../scripts/m11-workflow-build.mjs";

test("RC workflow build creates temporary non-authority evidence and retains only reproducible output", async () => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-workflow-build-test-")));
  const outputRoot = path.join(parent, "release");
  try {
    const sourceCommit = "b".repeat(40);
    let workspace;
    const stager = {
      async plan() { return { planDigest: "stage" }; },
      async apply(options) {
        workspace = path.dirname(options.outputRoot);
        const fullPayloadRoot = path.join(options.outputRoot, "full");
        const thinPayloadRoot = path.join(options.outputRoot, "thin");
        await fs.mkdir(fullPayloadRoot, { recursive: true });
        await fs.mkdir(thinPayloadRoot, { recursive: true });
        await fs.writeFile(path.join(thinPayloadRoot, "stack-manifest.json"), `${JSON.stringify({ sourceCommit })}\n`);
        await fs.writeFile(path.join(thinPayloadRoot, "transitive-artifact-ledger.json"), `${JSON.stringify({ artifacts: [] })}\n`);
        return { fullPayloadRoot, thinPayloadRoot, stackId: "sha256:" + "1".repeat(64) };
      },
    };
    const controller = {
      async plan(options) {
        const receipt = JSON.parse(await fs.readFile(options.protectedReceiptPath, "utf8"));
        assert.equal(receipt.status, "HOLD_PUBLICATION");
        assert.equal(receipt.publicationAuthority, false);
        return { planDigest: "build" };
      },
      async apply(options) { await fs.mkdir(options.outputRoot); return { stackId: "sha256:" + "1".repeat(64), reproducible: true, outputDigest: "sha256:" + "2".repeat(64), assetCount: 10 }; },
    };
    const result = await buildM11WorkflowRelease({ rootDir: process.cwd(), sourceCommit, outputRoot, workParent: parent, stager, thinResolver: async () => path.join(workspace, "resolved"), controller });
    assert.equal(result.status, "M11_WORKFLOW_RELEASE_BUILT");
    assert.equal(result.protectedAuthority, false);
    assert.equal(result.published, false);
    assert.deepEqual(await fs.readdir(parent), ["release"]);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("published workflow build requires protected receipt authority", async () => {
  await assert.rejects(buildM11WorkflowRelease({ rootDir: process.cwd(), sourceCommit: "b".repeat(40), outputRoot: path.join(os.tmpdir(), "omp-published-test"), releaseStatus: "PUBLISHED" }), { code: "M11_WORKFLOW_BUILD_EVIDENCE_REQUIRED" });
});
