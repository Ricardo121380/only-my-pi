import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createUserCliInstaller } from "../packages/bootstrap/user-cli-installer.mjs";
import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import { loadSettings, settingsDigest } from "../packages/config-runtime/index.mjs";
import {
  buildCandidateBoundGraphPlan,
  createCrossRootTransactionEngine,
  createFilesystemMigrationPlatform,
  createMigrationManifest,
  inspectMigrationBundle,
  M10_ARTIFACT_NAMES,
  M10_EXACT_PACKAGE_TARGET,
} from "../packages/upstream-migration/index.mjs";

const exec = promisify(execFile);
const sourceCommit = "a".repeat(40);
const piIntegrity = "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==";
const lifecycleCommands = new Map([
  ["pi-memory", "node scripts/postinstall.cjs"],
  ["pi-permission-modes", "echo 'permission-mode: dependencies installed.'"],
]);

const sha = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const resolved = (name, version) => `https://registry.npmjs.org/${name}/-/${name.split("/").at(-1)}-${version}.tgz`;

async function tarDirectory(parent, topLevel, target) {
  await exec("tar", ["-czf", target, "-C", parent, topLevel], { env: { PATH: process.env.PATH, LC_ALL: "C" } });
  return fs.readFile(target);
}

async function writePackageTree(npmRoot, versions, manifestEntries) {
  const lock = { name: "pi-extensions", lockfileVersion: 3, packages: { "": { name: "pi-extensions", dependencies: {} } } };
  const treeDigests = new Map();
  const urlDigests = new Map();
  for (const entry of M10_EXACT_PACKAGE_TARGET) {
    const version = versions === "from" ? entry.fromVersion : entry.toVersion;
    const integrity = versions === "from" ? entry.fromIntegrity : entry.toIntegrity;
    const relative = `node_modules/${entry.name}`;
    const packageRoot = path.join(npmRoot, ...relative.split("/"));
    await fs.mkdir(packageRoot, { recursive: true });
    const command = lifecycleCommands.get(entry.name);
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: entry.name, version, scripts: command ? { postinstall: command } : {} }));
    await fs.writeFile(path.join(packageRoot, "index.js"), `export default ${JSON.stringify(`${entry.id}:${version}`)};\n`);
    const url = resolved(entry.name, version);
    lock.packages[relative] = { version, integrity, resolved: url };
    lock.packages[""].dependencies[entry.name] = version;
    treeDigests.set(entry.id, `sha256:${await hashResourcePath({ artifactRoot: npmRoot, relativePath: relative, allowContainedSymlinks: true })}`);
    urlDigests.set(entry.id, sha(url));
  }
  await fs.writeFile(path.join(npmRoot, "package.json"), JSON.stringify({ name: "pi-extensions", private: true }));
  const lockBytes = Buffer.from(`${JSON.stringify(lock, null, 2)}\n`);
  await fs.writeFile(path.join(npmRoot, "package-lock.json"), lockBytes);
  for (const entry of manifestEntries) {
    if (versions === "from") {
      entry.fromTreeDigest = treeDigests.get(entry.id);
      entry.fromResolvedUrlDigest = urlDigests.get(entry.id);
    } else {
      entry.toTreeDigest = treeDigests.get(entry.id);
      entry.toResolvedUrlDigest = urlDigests.get(entry.id);
    }
  }
  return lockBytes;
}

async function buildOnlyMyPiSource(root, repoRoot) {
  const packageRoot = path.join(root, "only-source", "package");
  await fs.mkdir(path.join(packageRoot, "inventory"), { recursive: true });
  await fs.mkdir(path.join(packageRoot, "profiles"), { recursive: true });
  await fs.mkdir(path.join(packageRoot, "contracts", "compatibility"), { recursive: true });
  await fs.mkdir(path.join(packageRoot, "schemas"), { recursive: true });
  await fs.mkdir(path.join(packageRoot, "bin"), { recursive: true });
  const inventory = JSON.parse(await fs.readFile(path.join(repoRoot, "inventory", "packages.lock.json"), "utf8"));
  const daily = JSON.parse(await fs.readFile(path.join(repoRoot, "profiles", "daily.json"), "utf8"));
  const contract = JSON.parse(await fs.readFile(path.join(repoRoot, "contracts", "compatibility", "upstream-candidates.json"), "utf8"));
  inventory.packages = inventory.packages.filter((entry) => daily.packageIds.includes(entry.id));
  inventory.candidates = [];
  await fs.writeFile(path.join(packageRoot, "inventory", "packages.lock.json"), JSON.stringify(inventory));
  await fs.writeFile(path.join(packageRoot, "inventory", "resources.lock.json"), JSON.stringify({ formatVersion: 1, resources: [] }));
  await fs.writeFile(path.join(packageRoot, "profiles", "daily.json"), JSON.stringify(daily));
  await fs.writeFile(path.join(packageRoot, "contracts", "compatibility", "upstream-candidates.json"), JSON.stringify(contract));
  await fs.copyFile(path.join(repoRoot, "schemas", "upstream-migration-v1.schema.json"), path.join(packageRoot, "schemas", "upstream-migration-v1.schema.json"));
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "only-my-pi", version: "0.1.0", type: "module" }));
  await fs.writeFile(path.join(packageRoot, "artifact-identity.json"), JSON.stringify({ formatVersion: 1, kind: "only-my-pi-source-identity", sourceCommit }));
  await fs.writeFile(path.join(packageRoot, "bin", "omp.mjs"), "#!/usr/bin/env node\n");
  return packageRoot;
}

function bindings(entries, side) {
  return entries
    .filter((entry) => !["git-sync", "memory"].includes(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      binding: "external",
      sourceSpec: `npm:${entry.name}@${side === "from" ? entry.fromVersion : entry.toVersion}`,
      resolvedVersion: side === "from" ? entry.fromVersion : entry.toVersion,
      integrity: side === "from" ? entry.fromIntegrity : entry.toIntegrity,
      resolvedUrlDigest: side === "from" ? entry.fromResolvedUrlDigest : entry.toResolvedUrlDigest,
      physicalRootDigest: side === "from" ? entry.fromTreeDigest : entry.toTreeDigest,
      owner: "user",
      resourceFilter: entry.id === "agent-extensions" ? ["extensions/context/index.ts", "extensions/notify/index.ts", "extensions/review/index.ts", "extensions/sessions/index.ts"] : [],
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function fixture(t) {
  const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-migration-platform-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "agent");
  const piParent = path.join(root, "global", "@earendil-works");
  const piPackageRoot = path.join(piParent, "pi-coding-agent");
  const piBinPath = path.join(root, "bin", "pi");
  const cliRoot = path.join(root, "local", "share", "only-my-pi");
  const cliBin = path.join(root, "local", "bin", "omp");
  await fs.mkdir(path.join(piPackageRoot, "dist"), { recursive: true });
  await fs.mkdir(path.dirname(piBinPath), { recursive: true });
  await fs.writeFile(path.join(piPackageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.1" }));
  await fs.writeFile(path.join(piPackageRoot, "dist", "cli.js"), "old pi\n");
  await fs.symlink(path.join(piPackageRoot, "dist", "cli.js"), piBinPath);

  const externalEntries = M10_EXACT_PACKAGE_TARGET.map((entry) => ({
    ...entry,
    sourceSpec: `npm:${entry.name}@${entry.toVersion}`,
    fromResolvedUrlDigest: null,
    toResolvedUrlDigest: null,
    fromTreeDigest: null,
    toTreeDigest: null,
    binding: "external",
    owner: "user",
  }));
  const oldNpmRoot = path.join(configRoot, "npm");
  await fs.mkdir(path.join(oldNpmRoot, "node_modules"), { recursive: true });
  await writePackageTree(oldNpmRoot, "from", externalEntries);

  const targetParent = path.join(root, "target-external");
  const targetNpmRoot = path.join(targetParent, "npm");
  await fs.mkdir(path.join(targetNpmRoot, "node_modules"), { recursive: true });
  const targetLockBytes = await writePackageTree(targetNpmRoot, "to", externalEntries);

  const onlyPackageRoot = await buildOnlyMyPiSource(root, repoRoot);
  const candidatePlan = await buildCandidateBoundGraphPlan({ rootDir: onlyPackageRoot, manifest: { externalPackages: externalEntries } });

  const piCandidateParent = path.join(root, "pi-candidate");
  const piCandidateRoot = path.join(piCandidateParent, "package");
  await fs.mkdir(path.join(piCandidateRoot, "dist"), { recursive: true });
  await fs.writeFile(path.join(piCandidateRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3" }));
  await fs.writeFile(path.join(piCandidateRoot, "dist", "cli.js"), "new pi\n");
  const piTreeDigest = `sha256:${await hashResourcePath({ artifactRoot: piCandidateParent, relativePath: "package", allowContainedSymlinks: true })}`;

  const archiveRoot = path.join(root, "archives");
  await fs.mkdir(archiveRoot);
  const piBytes = await tarDirectory(piCandidateParent, "package", path.join(archiveRoot, "pi-candidate.tgz"));
  const externalBytes = await tarDirectory(targetParent, "npm", path.join(archiveRoot, "external-npm-tree.tgz"));
  const onlyBytes = await tarDirectory(path.dirname(onlyPackageRoot), "package", path.join(archiveRoot, "only-my-pi.tgz"));
  const receiptBytes = Buffer.from("{\"status\":\"fixture\"}\n");
  const artifactBytes = new Map([
    ["bundle-receipt.json", receiptBytes],
    ["external-npm-tree.tgz", externalBytes],
    ["external-package-lock.json", targetLockBytes],
    ["only-my-pi.tgz", onlyBytes],
    ["pi-candidate.tgz", piBytes],
  ]);
  const artifactDigests = Object.fromEntries([...artifactBytes].map(([name, bytes]) => [name, sha(bytes)]));
  const manifest = createMigrationManifest({
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration",
    id: "m10-pi-0-84-3",
    sourceCommit,
    candidateGraphDigest: candidatePlan.graphDigest,
    onlyMyPiArtifact: { sha256: artifactDigests["only-my-pi.tgz"] },
    piArtifact: { name: "@earendil-works/pi-coding-agent", version: "0.84.3", integrity: piIntegrity, sha256: artifactDigests["pi-candidate.tgz"], treeDigest: piTreeDigest },
    from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" },
    to: { piVersion: "0.84.3", subagentsVersion: "0.57.0" },
    externalPackages: externalEntries,
    artifacts: artifactDigests,
    policy: { ignoreScripts: true, allowLifecycleScripts: false, requirePiStopped: true, preserveExternalOwnership: true, networkDuringApply: false },
  });
  const bundle = {
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration-bundle",
    manifest,
    artifacts: M10_ARTIFACT_NAMES.map((name) => ({ name, bytes: artifactBytes.get(name).length, sha256: sha(artifactBytes.get(name)), base64: artifactBytes.get(name).toString("base64") })),
  };
  const bundlePath = path.join(root, "migration.bundle.json");
  await fs.writeFile(bundlePath, JSON.stringify(bundle));
  const inspected = await inspectMigrationBundle({ bundlePath, rootDir: repoRoot });

  const oldGenerationId = `sha256:${"1".repeat(64)}`;
  const settings = {
    packages: externalEntries.map((entry) => `npm:${entry.name}@${entry.fromVersion}`),
    extensions: [], skills: [], prompts: [], themes: [],
    onlyMyPi: {
      formatVersion: 2,
      profileId: "daily",
      generationId: oldGenerationId,
      graphDigest: oldGenerationId,
      providerSelection: null,
      initialMode: null,
      managedSettings: { packages: [], extensions: [], skills: [], prompts: [], themes: [] },
      packageBindings: bindings(externalEntries, "from"),
    },
  };
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(configRoot, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  const preflight = {
    settings: { exists: true, digest: settingsDigest(settings) },
    generation: { generationId: oldGenerationId, lkgGenerationId: oldGenerationId, status: "VERIFIED" },
    pi: { version: "0.84.1", treeDigest: await (async () => `sha256:${await hashResourcePath({ artifactRoot: piParent, relativePath: "pi-coding-agent", allowContainedSymlinks: true })}`)() },
    external: { npmTreeDigest: `sha256:${await hashResourcePath({ artifactRoot: configRoot, relativePath: "npm", allowContainedSymlinks: true })}` },
    ownership: { dailyExternalBindings: 7, completeExternalPackages: 9, owner: "user" },
    privacy: { authRead: false, sessionsRead: false, providerConfigRead: false },
  };
  const planner = { async inspect() { return preflight; } };
  const candidateTarget = { async inspect() { return { graphDigest: candidatePlan.graphDigest }; } };
  const userCli = createUserCliInstaller({ cliRoot, binPath: cliBin });
  const platform = createFilesystemMigrationPlatform({
    rootDir: onlyPackageRoot,
    configRoot,
    piPackageRoot,
    piBinPath,
    planner,
    candidateTarget,
    userCli,
    doctor: { static: () => ({ ok: true, errors: 0 }) },
    smokeRunner: async () => ({ ok: true, status: "NO_MODEL_STARTUP_PASS" }),
    bootstrapTransaction: { reconcileLastKnownGood: async () => ({ status: "REBUILT", generationId: candidatePlan.graphDigest }) },
  });
  const plan = {
    formatVersion: 1,
    kind: "only-my-pi-upstream-migration-plan",
    planDigest: sha("plan"),
    bundle: inspected.bundle,
    manifestDigest: manifest.manifestDigest,
    sourceCommit,
    candidateGraphDigest: candidatePlan.graphDigest,
    from: manifest.from,
    to: manifest.to,
    packages: manifest.externalPackages.map((entry) => ({ id: entry.id, name: entry.name, fromVersion: entry.fromVersion, toVersion: entry.toVersion, action: entry.action, binding: "external", owner: "user" })),
    processPolicy: { requirePiStopped: true, signal: "SIGTERM", timeoutSeconds: 15, forceKill: false },
    piProcesses: [],
    preflight,
  };
  return { root, configRoot, piPackageRoot, cliBin, platform, plan, inspected, bundlePath, settings, candidatePlan };
}

test("filesystem platform performs shadow apply and exact old-stack rollback", async (t) => {
  const value = await fixture(t);
  const transactionId = "11111111-1111-4111-8111-111111111111";
  const engine = createCrossRootTransactionEngine({ configRoot: value.configRoot, platform: value.platform, transactionIdFactory: () => transactionId });
  const applied = await engine.apply({ plan: value.plan, inspected: value.inspected, bundle: value.bundlePath });
  assert.equal(applied.status, "COMMITTED");
  assert.equal((await readJson(path.join(value.piPackageRoot, "package.json"))).version, "0.84.3");
  assert.equal((await loadSettings(value.configRoot)).settings.onlyMyPi.generationId, value.candidatePlan.graphDigest);
  assert.equal(await fs.realpath(value.cliBin).then(() => true, () => false), true);

  const rolledBack = await engine.rollback({ transactionId });
  assert.equal(rolledBack.status, "ROLLED_BACK");
  assert.equal((await readJson(path.join(value.piPackageRoot, "package.json"))).version, "0.84.1");
  assert.deepEqual((await loadSettings(value.configRoot)).settings, value.settings);
  assert.equal(await fs.lstat(value.cliBin).then(() => true, () => false), false);

  const reappliedId = "22222222-2222-4222-8222-222222222222";
  const reapplier = createCrossRootTransactionEngine({ configRoot: value.configRoot, platform: value.platform, transactionIdFactory: () => reappliedId });
  const reapplied = await reapplier.apply({ plan: value.plan, inspected: value.inspected, bundle: value.bundlePath });
  assert.equal(reapplied.status, "COMMITTED");
  assert.equal((await readJson(path.join(value.piPackageRoot, "package.json"))).version, "0.84.3");
  assert.equal((await loadSettings(value.configRoot)).settings.onlyMyPi.generationId, value.candidatePlan.graphDigest);
  assert.equal(await fs.realpath(value.cliBin).then(() => true, () => false), true);
});

async function readJson(target) {
  return JSON.parse(await fs.readFile(target, "utf8"));
}
