import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  applyWriterPatch,
  captureWriterPatch,
  createManagedClone,
  verifyWriterPatch,
  writerScopeOverlapsDirtyPaths,
} from "../packages/direct-agent/managed-clone.mjs";
import { captureWorkspaceBaseline } from "../packages/direct-agent/workspace.mjs";

const execFile = promisify(nodeExecFile);

async function git(cwd, args) {
  const result = await execFile("git", args, { cwd, encoding: "utf8" });
  return String(result.stdout).trim();
}

async function repository(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-managed-clone-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "OMP Test"]);
  await git(root, ["config", "user.email", "omp@example.invalid"]);
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(path.join(root, "src", "app.js"), "export const value = 1;\n");
  await fs.writeFile(path.join(root, "README.md"), "baseline\n");
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "baseline"]);
  return { root, head: await git(root, ["rev-parse", "HEAD"]) };
}

test("managed clone excludes dirty content and integrates one verified in-scope patch", async (t) => {
  const { root, head } = await repository(t);
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-managed-clone-private-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "README.md"), "user dirty change\n");
  const baseline = await captureWorkspaceBaseline({ cwd: root });
  assert.deepEqual(writerScopeOverlapsDirtyPaths(baseline, ["src/**"]), []);
  assert.deepEqual(writerScopeOverlapsDirtyPaths(baseline, ["README.md"]), ["README.md"]);

  const managed = await createManagedClone({
    repositoryRoot: root,
    runId: "managed-writer-test",
    baseCommit: head,
    runsRoot: path.join(configRoot, "only-my-pi", "runs"),
  });
  assert.equal(await fs.readFile(path.join(managed.cloneRoot, "README.md"), "utf8"), "baseline\n");
  assert.equal((await fs.lstat(path.join(managed.cloneRoot, ".git"))).isDirectory(), true);

  await fs.writeFile(path.join(managed.cloneRoot, "src", "app.js"), "export const value = 2;\n");
  await fs.writeFile(path.join(managed.cloneRoot, "src", "new.js"), "export const added = true;\n");
  const patch = await captureWriterPatch({
    cloneRoot: managed.cloneRoot,
    baseCommit: head,
    scope: ["src/**"],
    patchRoot: managed.patchRoot,
    runId: managed.runId,
  });
  assert.equal(patch.status, "READY");
  assert.deepEqual(patch.changedPaths, ["src/app.js", "src/new.js"]);
  assert.match(patch.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal((await fs.stat(patch.patchPath)).mode & 0o777, 0o600);
  const patchText = await fs.readFile(patch.patchPath, "utf8");
  assert.doesNotMatch(patchText, /\.omp-index-/u);
  assert.deepEqual((await git(root, ["apply", "--numstat", patch.patchPath])).split("\n").map((line) => line.split("\t")[2]).sort(), [...patch.changedPaths]);
  assert.equal((await verifyWriterPatch({ patch, repositoryRoot: root, scope: ["src/**"] })).status, "VERIFIED");

  const applied = await applyWriterPatch({ patch, repositoryRoot: root, scope: ["src/**"], baseline });
  assert.equal(applied.status, "APPLIED");
  assert.equal(await fs.readFile(path.join(root, "src", "app.js"), "utf8"), "export const value = 2;\n");
  assert.equal(await fs.readFile(path.join(root, "src", "new.js"), "utf8"), "export const added = true;\n");
  assert.equal(await fs.readFile(path.join(root, "README.md"), "utf8"), "user dirty change\n");
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "");
  assert.equal(await git(root, ["log", "-1", "--format=%s"]), "baseline");
  assert.deepEqual(await fs.readdir(root).then((entries) => entries.filter((entry) => entry.startsWith(".omp-index-"))), []);
});

test("managed writer fails closed on scope escape and target drift before apply", async (t) => {
  const { root, head } = await repository(t);
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-managed-clone-private-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const baseline = await captureWorkspaceBaseline({ cwd: root });
  const managed = await createManagedClone({ repositoryRoot: root, runId: "scope-test", baseCommit: head, runsRoot: path.join(configRoot, "runs") });
  await fs.writeFile(path.join(managed.cloneRoot, "README.md"), "writer escaped\n");
  await assert.rejects(
    captureWriterPatch({ cloneRoot: managed.cloneRoot, baseCommit: head, scope: ["src/**"], patchRoot: managed.patchRoot, runId: managed.runId }),
    { code: "WRITER_PATCH_SCOPE_ESCAPE" },
  );

  await fs.writeFile(path.join(managed.cloneRoot, "README.md"), "baseline\n");
  await fs.writeFile(path.join(managed.cloneRoot, "src", "app.js"), "export const value = 3;\n");
  const patch = await captureWriterPatch({ cloneRoot: managed.cloneRoot, baseCommit: head, scope: ["src/**"], patchRoot: managed.patchRoot, runId: managed.runId });
  await fs.writeFile(path.join(root, "src", "app.js"), "concurrent user change\n");
  await assert.rejects(
    applyWriterPatch({ patch, repositoryRoot: root, scope: ["src/**"], baseline }),
    (error) => ["WRITER_PATCH_CONFLICT", "WRITER_PATCH_WORKTREE_CONFLICT"].includes(error.code),
  );
  assert.equal(await fs.readFile(path.join(root, "src", "app.js"), "utf8"), "concurrent user change\n");
});

test("managed writer rejects Git binary patches even inside the approved scope", async (t) => {
  const { root, head } = await repository(t);
  const privateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-binary-patch-test-"));
  t.after(() => fs.rm(privateRoot, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "src", "payload.bin"), Buffer.from([0, 1, 2, 0, 3]));
  await assert.rejects(captureWriterPatch({
    cloneRoot: root, baseCommit: head, scope: ["src/**"], patchRoot: path.join(privateRoot, "artifacts"),
  }), { code: "WRITER_PATCH_BINARY_UNAPPROVED" });
  assert.equal(await git(root, ["diff", "--cached", "--name-only"]), "");
});
