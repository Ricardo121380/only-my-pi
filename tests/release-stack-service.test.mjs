import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createShellProfileService,
  createStackLayout,
  createStackService,
  sha256,
  validateStackManifest,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLATFORM = { os: "darwin", arch: "arm64", minimumMacOSSatisfied: true, rosetta: false };

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function inspection() {
  const stackManifest = validateStackManifest(JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "stack-manifest.example.json"), "utf8")));
  return Object.freeze({
    version: "0.2.0-preview.1",
    channel: "preview",
    tag: "v0.2.0-preview.1",
    sourceCommit: stackManifest.sourceCommit,
    releaseStatus: "PUBLISHED",
    payloadMode: "full",
    asset: { name: "only-my-pi-full.tar.gz", bytes: 42, sha256: sha256("asset") },
    stackId: stackManifest.stackId,
    stackManifestSha256: sha256("manifest"),
    stackManifest,
  });
}

test("stack service binds release identity into a zero-write plan before apply", async (t) => {
  const home = await temporary(t, "omp-stack-service-");
  const layout = createStackLayout({ homeDir: home });
  const value = await inspection();
  let applyCalls = 0;
  let cleanupCalls = 0;
  const source = {
    async inspect() { return value; },
    async prepare() { return { ...value, resolvedRoot: path.join(home, "resolved"), cleanup: async () => { cleanupCalls += 1; } }; },
    async check() { return { ok: true, status: "CURRENT", mutation: false }; },
  };
  const engine = {
    async recoverPending() { return []; },
    async apply({ plan }) { applyCalls += 1; return { ok: true, status: "COMMITTED", mutation: true, transactionId: "tx", planDigest: plan.planDigest }; },
  };
  const service = createStackService({ layout, localSource: source, releaseSource: source, engine, platformInspector: async () => PLATFORM, pathValue: () => layout.binRoot });
  const plan = await service.planInstall({ subcommand: "install", bundle: "/tmp/bundle" });
  assert.equal(plan.mutation, false);
  assert.equal(plan.source.asset.sha256, value.asset.sha256);
  assert.equal(applyCalls, 0);
  const result = await service.applyInstall({ subcommand: "install", bundle: "/tmp/bundle" }, plan);
  assert.equal(result.status, "COMMITTED");
  assert.equal(applyCalls, 1);
  assert.equal(cleanupCalls, 1);
  await assert.rejects(service.applyInstall({ subcommand: "update", bundle: "/tmp/bundle" }, plan), { code: "STACK_PLAN_DRIFT" });
});

test("release check is delegated as a read-only operation", async (t) => {
  const home = await temporary(t, "omp-release-check-service-");
  const layout = createStackLayout({ homeDir: home });
  const source = { async check(options) { return { ok: true, status: "CURRENT", mutation: false, channel: options.channel }; } };
  const service = createStackService({ layout, localSource: {}, releaseSource: source, engine: {} });
  assert.deepEqual(await service.releaseCheck({ channel: "preview" }), { ok: true, status: "CURRENT", mutation: false, channel: "preview" });
});

test("shell PATH marker is explicit, idempotent, backed up, and symlink-safe", async (t) => {
  const home = await temporary(t, "omp-shell-profile-");
  const profile = path.join(home, ".zprofile");
  await fs.writeFile(profile, "export EXISTING=1\n", { mode: 0o600 });
  const service = createShellProfileService({ homeDir: home, shellPath: "/bin/zsh" });
  const plan = await service.plan();
  assert.equal(plan.status, "SHELL_PROFILE_CHANGE_PLANNED");
  const result = await service.apply(plan);
  assert.equal(result.status, "SHELL_PROFILE_CONFIGURED");
  const text = await fs.readFile(profile, "utf8");
  assert.match(text, /only-my-pi PATH/u);
  assert.equal((text.match(/>>> only-my-pi PATH >>>/gu) ?? []).length, 1);
  assert.equal((await service.plan()).status, "NO_CHANGES");

  await fs.writeFile(profile, `${text}export AFTER_INSTALL=1\n`);
  const removal = await service.planRemoval(plan);
  assert.equal(removal.status, "SHELL_PROFILE_REMOVAL_PLANNED");
  assert.equal((await service.remove(removal, plan)).status, "SHELL_PROFILE_REMOVED");
  assert.equal(await fs.readFile(profile, "utf8"), "export EXISTING=1\nexport AFTER_INSTALL=1\n");

  const linkedHome = await temporary(t, "omp-shell-profile-link-");
  await fs.symlink(profile, path.join(linkedHome, ".zprofile"));
  const linked = createShellProfileService({ homeDir: linkedHome, shellPath: "/bin/zsh" });
  await assert.rejects(linked.plan(), { code: "SHELL_PROFILE_UNSAFE" });
});

test("shell marker removal restores profile absence and fails closed on marker drift", async (t) => {
  const home = await temporary(t, "omp-shell-profile-removal-");
  const profile = path.join(home, ".zprofile");
  const service = createShellProfileService({ homeDir: home, shellPath: "/bin/zsh" });
  const addition = await service.plan();
  assert.equal(addition.sourceExists, false);
  await service.apply(addition);
  const removal = await service.planRemoval(addition);
  assert.equal(removal.removeFile, true);
  await service.remove(removal, addition);
  await assert.rejects(fs.lstat(profile), { code: "ENOENT" });

  const second = await service.plan();
  await service.apply(second);
  await fs.writeFile(profile, (await fs.readFile(profile, "utf8")).replace("only-my-pi PATH", "modified PATH"));
  await assert.rejects(service.planRemoval(second), { code: "SHELL_PROFILE_MARKER_DRIFT" });
});
