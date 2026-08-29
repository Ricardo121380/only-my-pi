import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  STACK_TRANSACTION_PHASES,
  createShellProfileService,
  createStackLayout,
  createStackTransactionEngine,
  createStackService,
  finalizeStackManifest,
  planStackEnvironment,
  readStackJournal,
  sha256,
} from "../packages/release-stack/index.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const platform = { os: "darwin", arch: "arm64", minimumMacOSSatisfied: true, rosetta: false };

async function temporary(t, prefix) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function digestTree(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

async function fixture(t) {
  const home = await temporary(t, "omp-stack-transaction-");
  const resolved = path.join(home, "resolved");
  const layout = createStackLayout({ homeDir: home });
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, "contracts", "release", "stack-manifest.example.json"), "utf8"));
  await fs.mkdir(path.join(resolved, "node", "bin"), { recursive: true });
  await fs.writeFile(path.join(resolved, "node", "bin", "node"), "fixture node\n", { mode: 0o755 });
  await fs.mkdir(path.join(resolved, "pi", "dist", "bundle"), { recursive: true });
  await fs.writeFile(path.join(resolved, "pi", "dist", "bundle", "cli.js"), "fixture Pi\n", { mode: 0o755 });
  await fs.mkdir(path.join(resolved, "external-npm", "node_modules"), { recursive: true });
  const lock = { name: "fixture", version: "1.0.0", lockfileVersion: 3, packages: { "": { name: "fixture", version: "1.0.0" } } };
  for (const entry of manifest.externalPackages) {
    const packageRoot = path.join(resolved, "external-npm", "node_modules", ...entry.name.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({ name: entry.name, version: entry.version, license: "MIT" })}\n`);
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(entry.name)};\n`);
    lock.packages[`node_modules/${entry.name}`] = { version: entry.version, integrity: entry.integrity, resolved: `https://registry.npmjs.org/${entry.name}/-/${entry.name.split("/").at(-1)}-${entry.version}.tgz` };
    entry.treeDigest = await digestTree(resolved, `external-npm/node_modules/${entry.name}`);
  }
  await fs.writeFile(path.join(resolved, "external-npm", "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  await fs.writeFile(path.join(resolved, "only-my-pi.tgz"), "fixture artifact\n");
  manifest.sourceCommit = "d".repeat(40);
  manifest.runtime.node.treeDigest = await digestTree(resolved, "node");
  manifest.runtime.pi.treeDigest = await digestTree(resolved, "pi");
  manifest.externalTreeDigest = await digestTree(resolved, "external-npm");
  manifest.onlyMyPi.artifactSha256 = sha256(await fs.readFile(path.join(resolved, "only-my-pi.tgz")));
  delete manifest.stackId;
  const stack = finalizeStackManifest(manifest);
  const plan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "full", platform, pathValue: layout.binRoot });
  const harness = {
    async stage({ context }) {
      const root = path.join(context.paths.stage, "only-my-pi", "package", "bin");
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, "omp.mjs"), "process.stdout.write('fixture omp\\n');\n");
    },
    async publish() {},
    async rollback() {},
    async generationId() { return sha256("fixture-generation"); },
  };
  return { home, resolved, layout, stack, plan, harness };
}

function transactionId(index = 1) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

test("stack transaction installs one complete user-local stack and preserves external ownership", async (t) => {
  const value = await fixture(t);
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(),
    processAdmission: { async plan() { return []; } },
    doctor: async () => ({ ok: true }),
    smoke: async () => ({ ok: true }),
  });
  const result = await engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved });
  assert.equal(result.status, "COMMITTED");
  assert.equal(await fs.realpath(value.layout.ompShim), path.join(await fs.realpath(value.layout.currentStack), "bin", "omp"));
  assert.equal(await fs.realpath(value.layout.piShim), path.join(await fs.realpath(value.layout.currentStack), "bin", "pi"));
  const settings = JSON.parse(await fs.readFile(value.layout.settingsFile, "utf8"));
  assert.equal(settings.packages.length, 9);
  const state = JSON.parse(await fs.readFile(value.layout.stateFile, "utf8"));
  assert.equal(state.activeStack, value.stack.stackId);
  assert.ok(state.externalPackages.every((entry) => entry.binding === "external" && entry.owner === "user" && entry.assetDisposition === "PROVISIONED_FOR_USER"));
  assert.equal(Boolean(await fs.lstat(value.layout.npmRoot)), true);
  const journal = await readStackJournal(value.layout, transactionId());
  assert.equal(journal.status, "COMMITTED");
  assert.deepEqual(journal.history.map((entry) => entry.phase), STACK_TRANSACTION_PHASES);
});

test("ordinary doctor failure automatically restores the exact empty baseline", async (t) => {
  const value = await fixture(t);
  await fs.mkdir(value.layout.configRoot, { recursive: true });
  await fs.writeFile(value.layout.settingsFile, `${JSON.stringify({ custom: { preserved: true } }, null, 2)}\n`);
  const original = await fs.readFile(value.layout.settingsFile);
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(2),
    processAdmission: { async plan() { return []; } },
    doctor: async () => ({ ok: false }),
  });
  await assert.rejects(engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved }), { code: "STACK_STATIC_DOCTOR_FAILED" });
  assert.deepEqual(await fs.readFile(value.layout.settingsFile), original);
  await assert.rejects(fs.lstat(value.layout.currentStack), { code: "ENOENT" });
  await assert.rejects(fs.lstat(value.layout.ompShim), { code: "ENOENT" });
  await assert.rejects(fs.lstat(value.layout.npmRoot), { code: "ENOENT" });
  assert.equal((await readStackJournal(value.layout, transactionId(2))).status, "ROLLED_BACK");
});

test("a new mutating engine recovers crashes at every durable pre-commit boundary", async (t) => {
  for (const [index, phase] of STACK_TRANSACTION_PHASES.slice(1, -1).entries()) {
    await t.test(phase, async (nested) => {
      const value = await fixture(nested);
      const id = transactionId(100 + index);
      const crash = Object.assign(new Error(`crash at ${phase}`), { simulateCrash: true });
      const failing = createStackTransactionEngine({
        layout: value.layout,
        harness: value.harness,
        transactionIdFactory: () => id,
        processAdmission: { async plan() { return []; } },
        doctor: async () => ({ ok: true }),
        smoke: async () => ({ ok: true }),
        onBoundary: async (current) => { if (current === phase) throw crash; },
      });
      await assert.rejects(failing.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved }), (error) => error === crash);
      const recovering = createStackTransactionEngine({ layout: value.layout, harness: value.harness });
      const results = await recovering.recoverPending();
      assert.equal(results.length, 1);
      assert.equal(results[0].status, "ROLLED_BACK");
      assert.equal((await readStackJournal(value.layout, id)).status, "ROLLED_BACK");
      await assert.rejects(fs.lstat(value.layout.currentStack), { code: "ENOENT" });
    });
  }
});

test("running Pi requires separate termination authority", async (t) => {
  const value = await fixture(t);
  let terminated = false;
  const admission = {
    async plan() { return [{ pid: 123, startedAt: "digest", executableClass: "CONTROLLED_PI" }]; },
    async terminate() { terminated = true; },
  };
  const engine = createStackTransactionEngine({ layout: value.layout, harness: value.harness, processAdmission: admission, transactionIdFactory: () => transactionId(3) });
  await assert.rejects(engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved }), { code: "PI_TERMINATION_AUTHORITY_REQUIRED" });
  assert.equal(terminated, false);
});

test("concurrent targeted settings mutation stops recovery without overwriting user bytes", async (t) => {
  const value = await fixture(t);
  let captured;
  const crash = Object.assign(new Error("crash after settings"), { simulateCrash: true });
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(4),
    processAdmission: { async plan() { return []; } },
    onBoundary: async (phase) => { if (phase === "STACK_ACTIVATED") { captured = phase; throw crash; } },
  });
  await assert.rejects(engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved }), (error) => error === crash);
  assert.equal(captured, "STACK_ACTIVATED");
  const userBytes = Buffer.from(`${JSON.stringify({ packages: ["npm:pi-subagents@999.0.0"], userChange: true }, null, 2)}\n`);
  await fs.writeFile(value.layout.settingsFile, userBytes);
  const recovery = await engine.recoverTransaction(transactionId(4));
  assert.equal(recovery.status, "MANUAL_RECONCILIATION_REQUIRED");
  assert.deepEqual(await fs.readFile(value.layout.settingsFile), userBytes);
});

test("explicit stack remove reverses the committed install and restores CLI absence", async (t) => {
  const value = await fixture(t);
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(5),
    processAdmission: { async plan() { return []; } },
    doctor: async () => ({ ok: true }),
    smoke: async () => ({ ok: true }),
  });
  await engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved });
  const service = createStackService({ layout: value.layout, localSource: {}, releaseSource: {}, engine });
  const plan = await service.planLifecycle({ subcommand: "remove" });
  assert.equal(plan.status, "STACK_REMOVE_PLAN");
  assert.deepEqual(plan.transactionIds, [transactionId(5)]);
  const result = await service.applyLifecycle({ subcommand: "remove" }, plan);
  assert.equal(result.status, "REMOVED");
  for (const target of [value.layout.currentStack, value.layout.lkgStack, value.layout.ompShim, value.layout.piShim, value.layout.npmRoot, value.layout.settingsFile, value.layout.stateFile]) {
    await assert.rejects(fs.lstat(target), { code: "ENOENT" });
  }
  assert.equal((await readStackJournal(value.layout, transactionId(5))).status, "ROLLED_BACK");
});

test("stack transaction journals explicit shell configuration and removes only its exact marker", async (t) => {
  const value = await fixture(t);
  const shellProfile = createShellProfileService({ homeDir: value.home, shellPath: "/bin/zsh" });
  await fs.writeFile(path.join(value.home, ".zprofile"), "export BEFORE=1", { mode: 0o600 });
  const shellPlan = await shellProfile.plan();
  const plan = { ...value.plan, shellProfile: shellPlan };
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    shellProfile,
    transactionIdFactory: () => transactionId(8),
    processAdmission: { async plan() { return []; } },
  });
  await engine.apply({ plan, stackManifest: value.stack, resolvedRoot: value.resolved });
  const configured = await fs.readFile(path.join(value.home, ".zprofile"), "utf8");
  assert.match(configured, /only-my-pi PATH/u);
  await fs.writeFile(path.join(value.home, ".zprofile"), `${configured}export AFTER=1\n`);

  const service = createStackService({ layout: value.layout, localSource: {}, releaseSource: {}, engine });
  const removal = await service.planLifecycle({ subcommand: "remove" });
  await service.applyLifecycle({ subcommand: "remove" }, removal);
  assert.equal(await fs.readFile(path.join(value.home, ".zprofile"), "utf8"), "export BEFORE=1\nexport AFTER=1\n");
});

test("stack remove never deletes an exact preexisting external package tree", async (t) => {
  const value = await fixture(t);
  await fs.mkdir(value.layout.configRoot, { recursive: true });
  await fs.cp(path.join(value.resolved, "external-npm"), value.layout.npmRoot, { recursive: true });
  const packages = value.stack.externalPackages.map((entry) => `npm:${entry.name}@${entry.version}`);
  await fs.writeFile(value.layout.settingsFile, `${JSON.stringify({ packages, user: { retained: true } }, null, 2)}\n`);
  const originalTree = await digestTree(value.layout.configRoot, "npm");
  const originalSettings = await fs.readFile(value.layout.settingsFile);
  const plan = await planStackEnvironment({ layout: value.layout, stackManifest: value.stack, payloadMode: "full", platform, pathValue: value.layout.binRoot });
  assert.equal(plan.external.classification, "EXACT");
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(6),
    processAdmission: { async plan() { return []; } },
  });
  await engine.apply({ plan, stackManifest: value.stack, resolvedRoot: value.resolved });
  const service = createStackService({ layout: value.layout, localSource: {}, releaseSource: {}, engine });
  const remove = await service.planLifecycle({ subcommand: "remove" });
  await service.applyLifecycle({ subcommand: "remove" }, remove);
  assert.equal(await digestTree(value.layout.configRoot, "npm"), originalTree);
  assert.deepEqual(await fs.readFile(value.layout.settingsFile), originalSettings);
});

test("stack remove preserves concurrent unrelated settings through a three-way owned merge", async (t) => {
  const value = await fixture(t);
  const engine = createStackTransactionEngine({
    layout: value.layout,
    harness: value.harness,
    transactionIdFactory: () => transactionId(7),
    processAdmission: { async plan() { return []; } },
  });
  await engine.apply({ plan: value.plan, stackManifest: value.stack, resolvedRoot: value.resolved });
  const changed = JSON.parse(await fs.readFile(value.layout.settingsFile, "utf8"));
  changed.userAfterInstall = { theme: "preserve-me" };
  await fs.writeFile(value.layout.settingsFile, `${JSON.stringify(changed, null, 2)}\n`);
  const service = createStackService({ layout: value.layout, localSource: {}, releaseSource: {}, engine });
  const remove = await service.planLifecycle({ subcommand: "remove" });
  const result = await service.applyLifecycle({ subcommand: "remove" }, remove);
  assert.equal(result.status, "REMOVED");
  assert.deepEqual(JSON.parse(await fs.readFile(value.layout.settingsFile, "utf8")), { userAfterInstall: { theme: "preserve-me" } });
  await assert.rejects(fs.lstat(value.layout.npmRoot), { code: "ENOENT" });
});
