import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { UserCliInstaller } from "../packages/bootstrap/user-cli-installer.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-user-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cliRoot = path.join(root, "share", "only-my-pi");
  const binPath = path.join(root, "bin", "omp");
  const packageRoot = path.join(root, "package");
  await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: "only-my-pi", version: "0.1.0" })}\n`);
  await fs.writeFile(path.join(packageRoot, "bin", "omp.mjs"), "#!/usr/bin/env node\n");
  return { root, cliRoot, binPath, packageRoot, installer: new UserCliInstaller({ cliRoot, binPath }) };
}

async function staged(value, character) {
  const artifactSha256 = `sha256:${character.repeat(64)}`;
  const stage = await value.installer.stage({
    packageRoot: value.packageRoot,
    artifactSha256,
    sourceCommit: character.repeat(40),
    packageVersion: "0.1.0",
  });
  return value.installer.bindGeneration(stage, `sha256:${character.repeat(64)}`);
}

test("user CLI activation is digest-addressed, idempotent and retains one LKG pointer", async (t) => {
  const value = await fixture(t);
  const first = await staged(value, "a");
  const activated = await value.installer.activate(first);
  assert.equal(activated.status, "CLI_ACTIVATED");
  assert.equal(await fs.realpath(value.binPath), await fs.realpath(path.join(first.packageRoot, "bin", "omp.mjs")));
  const reused = await value.installer.stage({ packageRoot: value.packageRoot, artifactSha256: `sha256:${"a".repeat(64)}`, sourceCommit: "a".repeat(40), packageVersion: "0.1.0" });
  assert.equal(reused.reused, true);
  assert.equal((await value.installer.activate(first)).status, "CLI_ALREADY_ACTIVE");

  const second = await staged(value, "b");
  await value.installer.activate(second);
  assert.equal(await fs.realpath(value.binPath), await fs.realpath(path.join(second.packageRoot, "bin", "omp.mjs")));
  assert.equal(await fs.realpath(path.join(value.cliRoot, "lkg")), await fs.realpath(first.artifactRoot));
});

test("user CLI restores the exact CLI-absent snapshot", async (t) => {
  const value = await fixture(t);
  const before = await value.installer.snapshot();
  assert.deepEqual(before, {
    current: { exists: false, target: null },
    lkg: { exists: false, target: null },
    bin: { exists: false, target: null },
  });
  await value.installer.activate(await staged(value, "c"));
  await value.installer.restore(before);
  await assert.rejects(fs.lstat(value.binPath), { code: "ENOENT" });
  await assert.rejects(fs.lstat(path.join(value.cliRoot, "current")), { code: "ENOENT" });
  assert.equal((await fs.readdir(path.join(value.cliRoot, "artifacts"))).length, 1, "immutable artifact remains explicit recovery material");
});

test("user CLI records a bootstrap transaction and restores its prior pointers", async (t) => {
  const value = await fixture(t);
  const transactionId = "11111111-1111-4111-8111-111111111111";
  const before = await value.installer.snapshot();
  const activated = await value.installer.activate(await staged(value, "e"));
  await value.installer.recordTransactionSnapshot(transactionId, activated.snapshot);
  const restored = await value.installer.restoreTransaction(transactionId);
  assert.equal(restored.restored, true);
  assert.deepEqual(await value.installer.snapshot(), before);
});

test("user CLI rejects an existing digest root with mismatched source identity", async (t) => {
  const value = await fixture(t);
  await staged(value, "d");
  await assert.rejects(
    value.installer.stage({ packageRoot: value.packageRoot, artifactSha256: `sha256:${"d".repeat(64)}`, sourceCommit: "e".repeat(40), packageVersion: "0.1.0" }),
    { code: "CLI_ARTIFACT_DRIFT" },
  );
});
