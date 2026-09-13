import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { finalizeStackState, sha256 } from "../../packages/release-stack/contracts.mjs";

const execFile = promisify(callback);

// Synthetic legacy ownership records exercise the installed CLI, never the
// operator's actual legacy stack, configuration, or command links.
export async function verifyInstalledMigration({ command, home, env, sourceCommit, distributionId }) {
  const bin = path.join(home, ".local/bin");
  const share = path.join(home, ".local/share/only-my-pi");
  const state = JSON.parse(await fs.readFile(new URL("../../contracts/release/stack-state.example.json", import.meta.url)));
  state.shims.omp.digest = sha256("current-stack/bin/omp");
  const stack = path.join(share, "stacks", state.activeStack.slice(7));
  await fs.mkdir(path.join(stack, "bin"), { recursive: true });
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(share, "stack-state.json"), JSON.stringify(finalizeStackState(state)));
  for (const name of ["omp", "pi"]) {
    await fs.writeFile(path.join(stack, "bin", name), "#!/bin/sh\necho legacy-fixture\n", { mode: 0o755 });
    await fs.symlink(`../share/only-my-pi/current-stack/bin/${name}`, path.join(bin, name));
  }
  await fs.symlink(`stacks/${state.activeStack.slice(7)}`, path.join(share, "current-stack"));
  const testEnv = { ...env, PATH: `${bin}:${path.dirname(command)}:${env.PATH}` };
  const run = async (args) => JSON.parse((await execFile(command, ["admin", ...args, "--json"],
    { cwd: home, env: testEnv, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })).stdout);
  const before = await run(["doctor"]);
  assert.equal(before.sourceCommit, sourceCommit);
  assert.equal(before.distributionId, distributionId);
  assert.equal(before.commandPaths.legacyShadowsCurrent, true);
  assert.equal(before.commandPaths.multipleEntries, true);
  const link = await fs.readlink(path.join(bin, "omp"));
  const plan = await run(["migrate", "--from", "legacy", "--plan"]);
  assert.equal(plan.action, "backup-owned-link");
  assert.equal(plan.mutation, false);
  assert.equal(await fs.readlink(path.join(bin, "omp")), link);
  await assert.rejects(fs.lstat(path.join(share, "migrations")), { code: "ENOENT" });
  const applied = await run(["migrate", "--from", "legacy", "--apply", "--yes"]);
  assert.equal(applied.status, "LEGACY_MIGRATED");
  assert.equal(await fs.readlink(applied.backup), link);
  assert.equal(await fs.realpath(path.join(bin, "pi")), path.join(stack, "bin/pi"));
  assert.equal((await run(["doctor"])).commandPaths.entries[0].current, true);
  assert.equal((await run(["migrate", "--from", "legacy", "--apply", "--yes"])).action, "none");
  // An unrelated command at the old path must be reported, never executed or
  // removed by diagnostics or migration.
  const unknown = "#!/bin/sh\nexit 77\n";
  await fs.writeFile(path.join(bin, "omp"), unknown, { mode: 0o755 });
  const shadowed = await run(["doctor"]);
  assert.equal(shadowed.commandPaths.entries[0].current, false);
  assert.equal(shadowed.commandPaths.multipleEntries, true);
  await assert.rejects(run(["migrate", "--from", "legacy", "--apply", "--yes"]),
    (error) => /LEGACY_MIGRATION_UNSAFE/u.test(error.stdout + error.stderr));
  assert.equal(await fs.readFile(path.join(bin, "omp"), "utf8"), unknown);
  return { status: "INSTALLED_MIGRATION_ACCEPTANCE_PASS", sourceCommit, distributionId,
    assertions: { "legacy-migration": true, "path-shadow-detection": true, "unknown-files-preserved": true } };
}
