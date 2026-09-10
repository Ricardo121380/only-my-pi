import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { inspectM11Q10SourceCommit, runM11Q10Ci } from "../scripts/m11-q10-ci.mjs";

const execFile = promisify(execFileCallback);

test("Q10 CI binds staging, reproducible build and clean-home acceptance without retaining assets", async () => {
  const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q10-ci-test-")));
  try {
    const sourceCommit = "a".repeat(40);
    let workspace;
    const stager = {
      async plan(options) { return { planDigest: options.sourceCommit }; },
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
      async plan() { return { planDigest: "plan" }; },
      async apply(options) { await fs.mkdir(options.outputRoot); return { stackId: "sha256:" + "1".repeat(64), reproducible: true, outputDigest: "sha256:" + "2".repeat(64) }; },
    };
    const result = await runM11Q10Ci({ rootDir: process.cwd(), workParent: parent, inspectSource: async () => sourceCommit, stager, thinResolver: async () => path.join(workspace, "thin-resolved"), controller, acceptance: async () => ({ status: "Q10_MACOS_ARM64_NO_MODEL_PASSED", stackId: "sha256:" + "1".repeat(64), receiptDigest: "sha256:" + "3".repeat(64) }) });
    assert.equal(result.status, "Q10_CI_PASSED");
    assert.equal(result.reproducible, true);
    assert.equal(result.published, false);
    assert.equal(result.retainedAssets, false);
    assert.deepEqual(await fs.readdir(parent), []);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test("Q10 CI source authority requires one clean exact Git commit", async (t) => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-q10-source-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await execFile("git", ["init", "-q"], { cwd: root });
  await execFile("git", ["config", "user.name", "Fixture"], { cwd: root });
  await execFile("git", ["config", "user.email", "fixture@users.noreply.github.com"], { cwd: root });
  await fs.writeFile(path.join(root, "source"), "source\n");
  await execFile("git", ["add", "source"], { cwd: root });
  await execFile("git", ["commit", "-q", "-m", "source"], { cwd: root });
  assert.match(await inspectM11Q10SourceCommit(root), /^[a-f0-9]{40}$/u);
  await fs.writeFile(path.join(root, "source"), "dirty\n");
  await assert.rejects(inspectM11Q10SourceCommit(root), { code: "Q10_CI_SOURCE_NOT_CLEAN" });
});
