import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createReleasePayloadStager } from "../packages/release-stack/index.mjs";

const SOURCE = "a".repeat(40);

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("release payload stager is zero-write until an exact reviewed plan is applied", async (t) => {
  const repo = await temporary(t, "omp-stage-repo-");
  const parent = await temporary(t, "omp-stage-output-");
  const outputRoot = path.join(parent, "stage");
  let prepares = 0;
  const stager = createReleasePayloadStager({
    rootDir: repo,
    sourceInspector: async () => ({ head: SOURCE, clean: true }),
    async prepare(options) {
      prepares += 1;
      assert.equal(options.sourceCommit, SOURCE);
      const fullPayloadRoot = path.join(options.outputRoot, "payloads", "full");
      const thinPayloadRoot = path.join(options.outputRoot, "payloads", "thin");
      const thinResolvedRoot = path.join(options.outputRoot, "resolved");
      await Promise.all([fullPayloadRoot, thinPayloadRoot, thinResolvedRoot].map((directory) => fs.mkdir(directory, { recursive: true })));
      return { stackId: `sha256:${"b".repeat(64)}`, fullPayloadRoot, thinPayloadRoot, thinResolvedRoot };
    },
  });
  const plan = await stager.plan({ sourceCommit: SOURCE, outputRoot });
  assert.equal(plan.mutation, false);
  assert.equal(prepares, 0);
  assert.equal(await fs.lstat(outputRoot).then(() => true, () => false), false);
  await assert.rejects(stager.apply({ sourceCommit: SOURCE, outputRoot }, { ...plan, planDigest: `sha256:${"0".repeat(64)}` }), { code: "RELEASE_STAGE_PLAN_DRIFT" });
  const result = await stager.apply({ sourceCommit: SOURCE, outputRoot }, plan);
  assert.equal(result.status, "RELEASE_PAYLOADS_STAGED");
  assert.equal(prepares, 1);
  assert.equal(await fs.realpath(result.fullPayloadRoot), result.fullPayloadRoot);
});

test("release payload stager rejects repository outputs and cleans failed staging roots", async (t) => {
  const repo = await temporary(t, "omp-stage-repo-");
  const parent = await temporary(t, "omp-stage-output-");
  const sourceInspector = async () => ({ head: SOURCE, clean: true });
  const stager = createReleasePayloadStager({ rootDir: repo, sourceInspector });
  await assert.rejects(stager.plan({ sourceCommit: SOURCE, outputRoot: path.join(repo, "release") }), { code: "RELEASE_STAGE_ARGUMENT_INVALID" });

  const outputRoot = path.join(parent, "failed");
  const failing = createReleasePayloadStager({
    rootDir: repo,
    sourceInspector,
    async prepare(options) {
      await fs.writeFile(path.join(options.outputRoot, "partial"), "partial\n");
      throw Object.assign(new Error("fixture failure"), { code: "FIXTURE_FAILURE" });
    },
  });
  const plan = await failing.plan({ sourceCommit: SOURCE, outputRoot });
  await assert.rejects(failing.apply({ sourceCommit: SOURCE, outputRoot }, plan), { code: "FIXTURE_FAILURE" });
  assert.equal(await fs.lstat(outputRoot).then(() => true, () => false), false);
});
