import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DESTRUCTIVE_GIT_CODES,
  captureWorkspaceBaseline,
  classifyWorkspaceChanges,
  inspectMutationCommand,
  inspectMutationPath,
  normalizeRelativePath,
  parseGitStatusPorcelainV2,
  pathMatchesScope,
} from "../packages/direct-agent/workspace.mjs";

test("relative paths and glob scopes stay inside the project", () => {
  assert.equal(normalizeRelativePath("src/auth.ts"), "src/auth.ts");
  assert.equal(pathMatchesScope("src/auth/login.ts", ["src/**"]), true);
  assert.equal(pathMatchesScope("tests/login.ts", ["src/**"]), false);
  assert.equal(pathMatchesScope("README.md", ["."]), true);
  assert.throws(() => normalizeRelativePath("../outside"), { code: "WORKSPACE_PATH_ESCAPE" });
  assert.equal(inspectMutationPath("src/auth.ts", { cwd: "/tmp/project", scope: ["src/**"] }), null);
  assert.equal(inspectMutationPath("../outside", { cwd: "/tmp/project", scope: ["."] }).code, "PROJECT_PATH_ESCAPE");
  assert.equal(inspectMutationPath("tests/a.ts", { cwd: "/tmp/project", scope: ["src/**"] }).code, "CODING_SCOPE_DENIED");
});

test("destructive Git and shell escape commands are denied without shell execution", () => {
  assert.equal(inspectMutationCommand("git reset --hard HEAD").code, DESTRUCTIVE_GIT_CODES.RESET);
  assert.equal(inspectMutationCommand("git clean -fd").code, DESTRUCTIVE_GIT_CODES.CLEAN);
  assert.equal(inspectMutationCommand("git checkout -- src/a.ts").code, DESTRUCTIVE_GIT_CODES.CHECKOUT);
  assert.equal(inspectMutationCommand("git push origin main --force").code, DESTRUCTIVE_GIT_CODES.FORCE_PUSH);
  assert.equal(inspectMutationCommand("git commit -am fix").code, DESTRUCTIVE_GIT_CODES.COMMIT);
  assert.equal(inspectMutationCommand("git commit -am fix", { allowCommit: true }), null);
  assert.equal(inspectMutationCommand("npm test && cat $(pwd)/secret").code, "SHELL_EXPANSION_UNSUPPORTED");
  assert.equal(inspectMutationCommand("npm test -- --runInBand"), null);
});

test("porcelain v2 status parser returns branch and bounded path inventory", () => {
  const output = [
    "# branch.oid abcdef012345678901234567890123456789abcd",
    "# branch.head feature/test",
    "1 .M N... 100644 100644 100644 abcdef0 1234567\tsrc/app.ts",
    "? docs/new.md",
  ].join("\0") + "\0";
  const parsed = parseGitStatusPorcelainV2(output);
  assert.equal(parsed.head, "abcdef012345678901234567890123456789abcd");
  assert.equal(parsed.branch, "feature/test");
  assert.deepEqual(parsed.paths.map((entry) => entry.path), ["docs/new.md", "src/app.ts"]);
});

test("baseline captures pre-existing paths and later classification separates session changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-workspace-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const runGit = async (_cwd, args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { code: 0, stdout: `${root}\n`, stderr: "" };
    if (args[0] === "status") return { code: 0, stdout: "# branch.oid abcdef012345678901234567890123456789abcd\0# branch.head main\0? preexisting.txt\0", stderr: "" };
    if (args[0] === "submodule") return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
  await fs.writeFile(path.join(root, "preexisting.txt"), "user change\n");
  const baseline = await captureWorkspaceBaseline({ cwd: root, runGit });
  assert.equal(baseline.status, "GIT_REPOSITORY");
  assert.equal(baseline.dirty, true);
  assert.equal(baseline.paths[0].path, "preexisting.txt");
  assert.match(baseline.pathDigests["preexisting.txt"].digest, /^sha256:/u);
  await fs.writeFile(path.join(root, "session.txt"), "agent change\n");
  const current = {
    ...baseline,
    paths: [
      ...baseline.paths,
      { path: "session.txt", status: "??" },
    ],
    pathDigests: {
      ...baseline.pathDigests,
      "session.txt": { kind: "file", digest: "sha256:session", bytes: 13 },
    },
  };
  const changes = classifyWorkspaceChanges(baseline, current);
  assert.equal(changes.preExisting[0].path, "preexisting.txt");
  assert.equal(changes.sessionChanges.some((entry) => entry.path === "session.txt"), true);
  assert.equal(calls.length, 3);
});
