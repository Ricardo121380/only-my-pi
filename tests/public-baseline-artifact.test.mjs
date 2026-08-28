import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildCommitPinnedSourceArtifact } from "../scripts/lib/source-artifact.mjs";
import { parsePublicBaselineArtifactArgs } from "../scripts/public-baseline-artifact.mjs";

const execFile = promisify(execFileCallback);

test("public baseline artifact embeds the reviewed source identity without lifecycle scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-source-artifact-test-"));
  try {
    await fs.mkdir(path.join(root, "bin"));
    await fs.writeFile(path.join(root, "package.json"), `${JSON.stringify({ name: "only-my-pi", version: "9.9.9", private: true, bin: { omp: "bin/omp.mjs" }, files: ["bin/"] })}\n`);
    await fs.writeFile(path.join(root, "bin", "omp.mjs"), "#!/usr/bin/env node\n");
    const output = path.join(root, "artifact.tgz");
    const sourceCommit = "a".repeat(40);
    const built = await buildCommitPinnedSourceArtifact({ rootDir: root, sourceCommit, output });
    assert.equal(built.sourceCommit, sourceCommit);
    assert.match(built.sha256, /^sha256:[a-f0-9]{64}$/u);
    const extracted = path.join(root, "unpacked");
    await fs.mkdir(extracted);
    await execFile("tar", ["-xzf", output, "-C", extracted]);
    const identity = JSON.parse(await fs.readFile(path.join(extracted, "package", "artifact-identity.json"), "utf8"));
    assert.deepEqual(identity, { formatVersion: 1, kind: "only-my-pi-source-identity", sourceCommit });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("public baseline artifact arguments require an exact commit and absolute output", () => {
  assert.equal(parsePublicBaselineArtifactArgs(["--source-commit", "b".repeat(40), "--output", "/tmp/baseline.tgz"]).sourceCommit, "b".repeat(40));
  assert.throws(() => parsePublicBaselineArtifactArgs(["--source-commit", "bad", "--output", "/tmp/baseline.tgz"]), { code: "PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID" });
});
