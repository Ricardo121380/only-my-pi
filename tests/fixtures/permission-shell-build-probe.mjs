// Private build check against a verified installed binding, no global writes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveBoundPackageRoot } from "../../packages/bootstrap/runtime-package-binding.mjs";
import { applyRuntimePatches } from "../../packages/distribution/runtime-patches.mjs";

const pkg = await resolveBoundPackageRoot({ configRoot: path.join(os.homedir(), ".pi/agent"), packageId: "permission-modes" });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-shell-build-"));
try {
  const target = path.join(root, "external-npm/node_modules/pi-permission-modes/src");
  await fs.mkdir(target, { recursive: true });
  const before = new Map();
  for (const name of ["index.ts", "paths.ts", "sandbox.ts"]) {
    const bytes = await fs.readFile(path.join(pkg.root, "src", name));
    before.set(name, bytes);
    await fs.writeFile(path.join(target, name), bytes);
  }
  const patches = await applyRuntimePatches({ runtimeRoot: root, version: "0.3.0-preview.1",
    platform: "darwin-arm64", runtimeContract: "phase1-pi0851" });
  assert.equal(patches.length, 3);
  assert.equal(new Set(patches.map((entry) => entry.path)).size, 3);
  for (const patch of patches) assert.notEqual(patch.patchedSha256, patch.upstreamSha256);
  const sandbox = await fs.readFile(path.join(target, "sandbox.ts"), "utf8");
  assert.match(sandbox, /operations\.exec\(wrapped/);
  assert.match(sandbox, /finally \{ releaseOwnedMounts\(\); \}/);
  assert.match(await fs.readFile(path.join(target, "paths.ts"), "utf8"), /return 0;/);
  await assert.rejects(applyRuntimePatches({ runtimeRoot: root, version: "0.3.0-preview.1",
    platform: "darwin-arm64", runtimeContract: "phase1-pi0851" }), /upstream patch input differs/);
  for (const [name, bytes] of before) assert.deepEqual(await fs.readFile(path.join(pkg.root, "src", name)), bytes);
  process.stdout.write("PERMISSION_SHELL_BUILD_PASS: 3 byte-bound patches; upstream unchanged; repeat refused\n");
} finally { await fs.rm(root, { recursive: true, force: true }); }
