import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createReleasePayloadStager } from "../packages/release-stack/index.mjs";
import { prepareBundledPty, verifyBundledRuntime } from "../packages/release-stack/release-payload-stager.mjs";

const SOURCE = "a".repeat(40);

test("staged PTY helper gets executable mode without scripts or redirected writes", async (t) => {
  const root = await temporary(t, "omp-pty-stage-");
  const dependency = path.join(root, "node_modules/node-pty");
  const helper = path.join(dependency, "prebuilds/darwin-arm64/spawn-helper");
  await fs.mkdir(path.dirname(helper), { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { "node-pty": "1.1.0" } }));
  await fs.writeFile(path.join(dependency, "package.json"), JSON.stringify({ name: "node-pty", version: "1.1.0" }));
  await fs.writeFile(helper, "fixture", { mode: 0o644 });
  await prepareBundledPty(root);
  assert.equal((await fs.stat(helper)).mode & 0o777, 0o755);
  assert.equal(await fs.readFile(helper, "utf8"), "fixture");
  await fs.writeFile(path.join(dependency, "package.json"), JSON.stringify({ name: "node-pty", version: "other" }));
  await assert.rejects(prepareBundledPty(root), { code: "RELEASE_PTY_VERSION_INVALID" });
  const redirected = path.join(root, "outside-helper");
  await fs.writeFile(redirected, "outside", { mode: 0o600 });
  await fs.unlink(helper); await fs.symlink(redirected, helper);
  await assert.rejects(prepareBundledPty(root), { code: "RELEASE_PTY_LAYOUT_INVALID" });
  assert.equal((await fs.stat(redirected)).mode & 0o777, 0o600);
});

test("extracted runtime smoke rejects missing transitive dependencies", async (t) => {
  const root = await temporary(t, "omp-bundled-runtime-");
  const dependency = path.join(root, "node_modules", "fixture-parent");
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { "fixture-parent": "1.0.0" } }));
  await fs.writeFile(path.join(dependency, "index.js"), "module.exports = require('fixture-missing-child');\n");
  await assert.rejects(verifyBundledRuntime({ packageRoot: root, node: process.execPath, env: {} }), { code: "RELEASE_STAGE_COMMAND_FAILED" });
  await fs.writeFile(path.join(dependency, "index.js"), "module.exports = {};\n");
  await verifyBundledRuntime({ packageRoot: root, node: process.execPath, env: {} });
});

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

test("staging binds an explicit Pi candidate and rejects changing it after review", async (t) => {
  const repo = await temporary(t, "omp-candidate-repo-");
  const parent = await temporary(t, "omp-candidate-output-");
  const outputRoot = path.join(parent, "candidate");
  let selected = null;
  const stager = createReleasePayloadStager({ rootDir: repo,
    sourceInspector: async () => ({ head: SOURCE, clean: true }),
    async prepare(options) {
      selected = options.piVersion;
      return { stackId: `sha256:${"b".repeat(64)}`, fullPayloadRoot: options.outputRoot };
    },
  });
  const options = { sourceCommit: SOURCE, outputRoot, piVersion: "0.85.1" };
  const plan = await stager.plan(options);
  assert.equal(plan.piRuntime.version, "0.85.1");
  await assert.rejects(stager.apply({ ...options, piVersion: "0.84.3" }, plan), { code: "RELEASE_STAGE_PLAN_DRIFT" });
  assert.equal(selected, null);
  assert.equal(await fs.lstat(outputRoot).then(() => true, () => false), false);
  await stager.apply(options, plan);
  assert.equal(selected, "0.85.1");
});
