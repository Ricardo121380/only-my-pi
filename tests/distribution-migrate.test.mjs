import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { migrateLegacy } from "../packages/distribution/migrate.mjs";
import { inspectCommandPaths } from "../packages/distribution/commands.mjs";
import { finalizeStackState, sha256 } from "../packages/release-stack/contracts.mjs";

async function fixture(t) {
  const homeDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-migrate-")));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  const state = JSON.parse(await fs.readFile(new URL("../contracts/release/stack-state.example.json", import.meta.url), "utf8"));
  const share = path.join(homeDir, ".local/share/only-my-pi");
  const bin = path.join(homeDir, ".local/bin");
  const stack = path.join(share, "stacks", state.activeStack.slice(7));
  const prefix = path.join(homeDir, "npm");
  const cli = path.join(prefix, "lib/node_modules/only-my-pi/loader.mjs");
  for (const directory of [bin, path.join(stack, "bin"), path.join(prefix, "bin"), path.dirname(cli)])
    await fs.mkdir(directory, { recursive: true });
  state.shims.omp.digest = sha256("current-stack/bin/omp");
  await fs.writeFile(path.join(share, "stack-state.json"), JSON.stringify(finalizeStackState(state)));
  for (const name of ["omp", "pi"]) {
    await fs.writeFile(path.join(stack, "bin", name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await fs.symlink(`../share/only-my-pi/current-stack/bin/${name}`, path.join(bin, name));
  }
  await fs.symlink(`stacks/${state.activeStack.slice(7)}`, path.join(share, "current-stack"));
  await fs.writeFile(cli, "#!/usr/bin/env node\n", { mode: 0o755 });
  await fs.symlink(cli, path.join(prefix, "bin/omp"));
  const runtime = { channel: "npm", root: path.join(prefix, "lib/node_modules/only-my-pi-runtime-darwin-arm64/runtime"),
    ompCliPath: "/unused", stackId: `sha256:${"a".repeat(64)}`, distribution: { version: "0.4.0-preview.1" } };
  await fs.writeFile(path.join(path.dirname(cli), "runtime-packages.json"), JSON.stringify({ version: runtime.distribution.version,
    platforms: { "darwin-arm64": { distributionId: runtime.stackId } } }));
  const options = { runtime, homeDir, env: { PATH: `${bin}:${prefix}/bin` }, inspectPaths: inspectCommandPaths };
  return { options, share, bin, stack };
}

test("migration plans without writes and backs up only the owned omp link", async (t) => {
  const f = await fixture(t);
  const original = await fs.readlink(path.join(f.bin, "omp"));
  const plan = await migrateLegacy({ ...f.options, argv: ["--from", "legacy", "--plan"] });
  assert.equal(plan.action, "backup-owned-link");
  await assert.rejects(fs.stat(path.join(f.share, "migrations")), { code: "ENOENT" });
  const result = await migrateLegacy({ ...f.options, argv: ["--from", "legacy", "--apply", "--yes"] });
  assert.equal(result.status, "LEGACY_MIGRATED");
  assert.equal(await fs.readlink(result.backup), original);
  assert.equal((await inspectCommandPaths(f.options)).entries[0].current, true);
  assert.equal(await fs.realpath(path.join(f.bin, "pi")), path.join(f.stack, "bin/pi"));
  assert.equal(JSON.parse(await fs.readFile(result.receipt)).status, "LEGACY_MIGRATED");
  assert.equal((await migrateLegacy({ ...f.options, argv: ["--from", "legacy", "--apply", "--yes"] })).action, "none");
});

test("unknown files, mismatched ownership and ephemeral installs are left intact", async (t) => {
  const f = await fixture(t);
  const command = path.join(f.bin, "omp");
  const argv = ["--from", "legacy", "--apply", "--yes"];
  await assert.rejects(migrateLegacy({ ...f.options, argv, env: { ...f.options.env, npm_command: "exec" } }), { code: "LEGACY_MIGRATION_UNSAFE" });
  await fs.unlink(command);
  await fs.writeFile(command, "user command", { mode: 0o755 });
  await assert.rejects(migrateLegacy({ ...f.options, argv }), { code: "LEGACY_MIGRATION_UNSAFE" });
  assert.equal(await fs.readFile(command, "utf8"), "user command");
  await fs.unlink(command);
  await fs.symlink("../share/only-my-pi/current-stack/bin/pi", command);
  await assert.rejects(migrateLegacy({ ...f.options, argv }), { code: "LEGACY_MIGRATION_UNSAFE" });
  assert.equal(await fs.readlink(command), "../share/only-my-pi/current-stack/bin/pi");
});

test("PATH shadowing and incomplete transactions require reconciliation", async (t) => {
  const f = await fixture(t);
  const argv = ["--from", "legacy", "--plan"];
  await assert.rejects(migrateLegacy({ ...f.options, argv, env: { PATH: f.bin } }), { code: "LEGACY_MIGRATION_UNSAFE" });
  const receipts = path.join(f.share, "migrations");
  await fs.mkdir(receipts);
  await fs.writeFile(path.join(receipts, "00000000-0000-4000-8000-000000000001.json"), JSON.stringify({ status: "PREPARED" }));
  await assert.rejects(migrateLegacy({ ...f.options, argv }), /incomplete migration/u);
  assert.equal((await fs.lstat(path.join(f.bin, "omp"))).isSymbolicLink(), true);
});

test("apply requires both the source selector and explicit yes", async (t) => {
  const f = await fixture(t);
  for (const argv of [["--apply"], ["--from", "legacy", "--apply"], ["--from", "legacy", "--plan", "--yes"]])
    await assert.rejects(migrateLegacy({ ...f.options, argv }), { code: "INVALID_ARGUMENT" });
});

test("PATH diagnostics recognize a helper nested beneath the global npm CLI", async (t) => {
  const f = await fixture(t);
  const publicCli = path.join(f.options.homeDir, "npm/lib/node_modules/only-my-pi");
  f.options.runtime.root = path.join(publicCli, "node_modules/only-my-pi-runtime-darwin-arm64/runtime");
  const paths = await inspectCommandPaths(f.options);
  assert.equal(paths.entries[0].legacy, true);
  assert.equal(paths.entries[1].current, true);
  await fs.writeFile(path.join(publicCli, "runtime-packages.json"), JSON.stringify({ version: "0.0.0", platforms: {} }));
  assert.equal((await inspectCommandPaths(f.options)).entries[1].current, false);
});
