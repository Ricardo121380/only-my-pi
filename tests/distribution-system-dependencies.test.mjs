import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inspectSystemDependencies, requireSystemDependencies } from "../packages/distribution/system-dependencies.mjs";

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-git-")));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("missing Git is a local prerequisite failure and invokes no installer", async (t) => {
  const root = await fixture(t);
  const options = { env: { PATH: root }, run: () => assert.fail("no command should run") };
  assert.equal((await inspectSystemDependencies(options)).git.reason, "GIT_NOT_FOUND");
  await assert.rejects(requireSystemDependencies(options), { code: "SYSTEM_DEPENDENCIES_MISSING" });
  assert.deepEqual(await fs.readdir(root), []);
});

test("the actual executable and Git version are reported", async (t) => {
  const root = await fixture(t);
  const git = path.join(root, "git");
  await fs.writeFile(git, '#!/bin/sh\nprintf "git version 2.45.2\\n"\n', { mode: 0o755 });
  const result = await inspectSystemDependencies({ platform: "darwin", env: { PATH: root } });
  assert.equal(result.ok, true);
  assert.equal(result.git.path, git);
  assert.equal(result.git.version, "2.45.2");
});

test("an unavailable Apple developer directory never invokes the Git installer shim", async () => {
  const calls = [];
  const result = await inspectSystemDependencies({ platform: "darwin", env: { PATH: "/usr/bin" },
    run: async (command) => { calls.push(command); throw new Error("no developer tools"); } });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["/usr/bin/xcode-select"]);
});

test("a project-relative Git shadow is rejected before executing it", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = await inspectSystemDependencies({ env: { PATH: `.:${root}` }, cwd: root,
    run: () => assert.fail("relative Git must not run") });
  assert.equal(result.git.reason, "GIT_ON_RELATIVE_PATH");
});


test("Linux requires all declared tools and reports Git separately", async (t) => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, "git"), '#!/bin/sh\nprintf "git version 2.45.2\\n"\n', { mode: 0o755 });
  const options = { platform: "linux", env: { PATH: root } };
  const missing = await inspectSystemDependencies(options);
  assert.equal(missing.git.ok, true);
  assert.equal(missing.reason, "LINUX_TOOLS_UNAVAILABLE");
  await assert.rejects(requireSystemDependencies(options), { code: "SYSTEM_DEPENDENCIES_MISSING" });
  for (const name of ["bwrap", "socat", "rg"])
    await fs.writeFile(path.join(root, name), '#!/bin/sh\nprintf "tool 1.0\\n"\n', { mode: 0o755 });
  const ready = await inspectSystemDependencies(options);
  assert.equal(ready.ok, true);
  assert.deepEqual(Object.keys(ready.tools), ["bwrap", "socat", "rg"]);
});

test("Linux tools alone never count as readiness when namespaces are denied", async (t) => {
  const root = await fixture(t);
  for (const name of ["git", "bwrap", "socat", "rg"])
    await fs.writeFile(path.join(root, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const result = await inspectSystemDependencies({ platform: "linux", env: { PATH: root },
    run: async (command, argv) => {
      if (argv.includes("--unshare-net")) throw new Error("kernel denied network namespace");
      return { stdout: path.basename(command) === "git" ? "git version 2.45.2\n" : "tool 1.0\n" };
    } });
  assert.equal(result.git.ok, true);
  assert.equal(result.ok, false);
  assert.equal(result.status, "LINUX_SANDBOX_UNAVAILABLE");
  assert.equal(result.sandbox.ok, false);
});
