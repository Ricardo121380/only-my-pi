import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { createArtifactProcessRunner } from "../bootstrap/artifact-installer.mjs";
import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { compileGenerationSettings } from "../bootstrap/settings-compiler.mjs";
import { compilePublishedSettings, compileUninstalledSettings } from "../bootstrap/settings-merge.mjs";
import { stageAndPromoteGeneration, verifyPromotedGeneration } from "../bootstrap/npm-stager.mjs";
import {
  atomicWriteJson,
  canonicalJson,
  compareAndSaveSettings,
  configRuntimePaths,
  loadSettings,
  readJsonObject,
} from "../config-runtime/index.mjs";
import { parsePackageSpec } from "../../scripts/lib/package-source.mjs";
import { buildCandidateBoundGraphPlan } from "./candidate-target.mjs";
import { loadMigrationArtifactBytes, M10_ARTIFACT_NAMES } from "./contract.mjs";

const FULL_SHA = /^[a-f0-9]{40}$/u;
const MAX_TAR_OUTPUT = 4 * 1024 * 1024;
const LIFECYCLE_NAMES = new Set(["preinstall", "install", "postinstall", "prepublish", "preprepare", "prepare", "postprepare", "prepack", "postpack"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function assertRealDirectory(target, label) {
  const stat = await lstatOrNull(target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail("MIGRATION_PATH_UNSAFE", `${label} must be a real directory`);
  return path.resolve(target);
}

async function readJsonFile(target, label) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) fail("MIGRATION_EVIDENCE_INVALID", `${label} must be a bounded regular file`);
  try { return JSON.parse(await fs.readFile(target, "utf8")); } catch { fail("MIGRATION_EVIDENCE_INVALID", `${label} is invalid JSON`); }
}

async function hashTree(target, { symlinks = true } = {}) {
  const parent = await assertRealDirectory(path.dirname(target), `${path.basename(target)} parent`);
  return `sha256:${await hashResourcePath({ artifactRoot: parent, relativePath: path.basename(target), allowContainedSymlinks: symlinks })}`;
}

function sourceFromSetting(setting) {
  return typeof setting === "string" ? setting : setting?.source;
}

function packageNameFromSetting(setting) {
  const source = sourceFromSetting(setting);
  if (typeof source !== "string") return null;
  try {
    const parsed = parsePackageSpec(source);
    return parsed.type === "npm" ? parsed.name : null;
  } catch { return null; }
}

function replacePackageSource(setting, source) {
  return typeof setting === "string" ? source : { ...setting, source };
}

function lifecycleEvidence(packageManifest) {
  const scripts = packageManifest?.scripts ?? {};
  if (scripts === null || typeof scripts !== "object" || Array.isArray(scripts)) fail("MIGRATION_PACKAGE_LIFECYCLE_DRIFT", "package scripts must be an object");
  return Object.entries(scripts)
    .filter(([name]) => LIFECYCLE_NAMES.has(name))
    .map(([name, command]) => ({ name, commandSha256: digest(command), necessity: "not-required" }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function urlDigest(value) {
  let parsed;
  try { parsed = new URL(value); } catch { fail("MIGRATION_LOCK_DRIFT", "resolved URL is invalid"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) fail("MIGRATION_LOCK_DRIFT", "resolved URL must be credential-free HTTPS");
  return digest(parsed.href);
}

async function validateContainedTree(root) {
  const realRoot = await fs.realpath(root);
  async function visit(target) {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(target).catch(() => fail("MIGRATION_ARCHIVE_LINK_UNSAFE", "archive contains a dangling symlink"));
      if (real !== realRoot && !real.startsWith(`${realRoot}${path.sep}`)) fail("MIGRATION_ARCHIVE_LINK_UNSAFE", "archive symlink escapes the staged root");
      return;
    }
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(target)) await visit(path.join(target, name));
      return;
    }
    if (!stat.isFile()) fail("MIGRATION_ARCHIVE_TYPE_UNSAFE", "archive contains a non-file entry");
  }
  await visit(root);
}

function validateArchiveNames(text, topLevel) {
  const names = text.split("\n").filter(Boolean);
  if (names.length === 0 || names.length > 200_000) fail("MIGRATION_ARCHIVE_INVALID", "archive entry count is invalid");
  for (const original of names) {
    const name = original.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (!name || path.posix.isAbsolute(name) || path.posix.normalize(name) !== name || name.split("/").some((part) => part === ".." || part === "." || part === "")) {
      fail("MIGRATION_ARCHIVE_PATH_UNSAFE", "archive contains an unsafe path");
    }
    if (name !== topLevel && !name.startsWith(`${topLevel}/`)) fail("MIGRATION_ARCHIVE_LAYOUT_INVALID", `archive must contain only ${topLevel}/`);
  }
}

async function runChecked(runCommand, command, argv, options, code) {
  const result = await runCommand(command, argv, options);
  if (result.exitCode !== 0 || result.stdoutTruncated || result.stderrTruncated || Buffer.byteLength(result.stdout) > MAX_TAR_OUTPUT) {
    fail(code, `${options.label} failed`, { exitCode: result.exitCode, signal: result.signal, stdoutDigest: digest(result.stdout), stderrDigest: digest(result.stderr) });
  }
  return result;
}

async function extractArchive({ archive, destination, topLevel, runCommand }) {
  const list = await runChecked(runCommand, "tar", ["-tzf", archive], { cwd: path.dirname(archive), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" }, label: `${topLevel} archive listing` }, "MIGRATION_ARCHIVE_LIST_FAILED");
  validateArchiveNames(list.stdout, topLevel);
  const verbose = await runChecked(runCommand, "tar", ["-tvzf", archive], { cwd: path.dirname(archive), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" }, label: `${topLevel} archive type audit` }, "MIGRATION_ARCHIVE_LIST_FAILED");
  if (verbose.stdout.split("\n").some((line) => /^[lh]/u.test(line))) fail("MIGRATION_ARCHIVE_LINK_UNSAFE", "migration archives may not contain link entries");
  await fs.mkdir(destination, { mode: 0o700 });
  await runChecked(runCommand, "tar", ["-xzf", archive, "-C", destination, "--no-same-owner", "--no-same-permissions"], { cwd: path.dirname(archive), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C" }, label: `${topLevel} archive extraction` }, "MIGRATION_ARCHIVE_EXTRACTION_FAILED");
  const extracted = path.join(destination, topLevel);
  await assertRealDirectory(extracted, `${topLevel} extracted root`);
  await validateContainedTree(extracted);
  return extracted;
}

function layoutFor({ transactionId, piPackageRoot, configRoot }) {
  const piParent = path.dirname(piPackageRoot);
  return Object.freeze({
    piStage: path.join(piParent, `.only-my-pi-stage-${transactionId}`),
    piBackup: path.join(piParent, `.only-my-pi-backup-${transactionId}`),
    piCandidateArchive: path.join(piParent, `.only-my-pi-candidate-${transactionId}`),
    externalRoot: path.join(configRoot, "npm"),
    externalStage: path.join(configRoot, `.only-my-pi-npm-stage-${transactionId}`),
    externalBackup: path.join(configRoot, `.only-my-pi-npm-backup-${transactionId}`),
    externalCandidateArchive: path.join(configRoot, `.only-my-pi-npm-candidate-${transactionId}`),
  });
}

async function readOptionalJson(target) {
  const stat = await lstatOrNull(target);
  if (stat === null) return { exists: false, value: null };
  if (!stat.isFile() || stat.isSymbolicLink()) fail("MIGRATION_BACKUP_INVALID", `${path.basename(target)} is not a regular file`);
  return { exists: true, value: JSON.parse(await fs.readFile(target, "utf8")) };
}

async function verifyTargetExternalTree(npmRoot, manifest, expectedLockDigest) {
  await assertRealDirectory(npmRoot, "candidate external npm tree");
  const lockPath = path.join(npmRoot, "package-lock.json");
  const lockBytes = await fs.readFile(lockPath);
  if (digest(lockBytes) !== expectedLockDigest) fail("MIGRATION_TARGET_LOCK_DRIFT", "candidate external lock differs from the bound bundle artifact");
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const declared = Object.keys(lock.packages?.[""]?.dependencies ?? {}).sort();
  const expectedNames = manifest.externalPackages.map((entry) => entry.name).sort();
  if (canonicalJson(declared) !== canonicalJson(expectedNames)) fail("MIGRATION_TARGET_PACKAGE_SET_DRIFT", "candidate external tree must declare exactly nine direct packages");
  for (const expected of manifest.externalPackages) {
    const relative = `node_modules/${expected.name}`;
    const locked = lock.packages?.[relative];
    if (!locked || locked.version !== expected.toVersion || locked.integrity !== expected.toIntegrity || urlDigest(locked.resolved) !== expected.toResolvedUrlDigest) fail("MIGRATION_TARGET_LOCK_DRIFT", `candidate lock drifted for ${expected.id}`);
    const packageRoot = path.join(npmRoot, ...relative.split("/"));
    const packageManifest = await readJsonFile(path.join(packageRoot, "package.json"), `candidate package ${expected.id}`);
    if (packageManifest.name !== expected.name || packageManifest.version !== expected.toVersion) fail("MIGRATION_TARGET_PACKAGE_DRIFT", `candidate package identity drifted for ${expected.id}`);
    if (canonicalJson(lifecycleEvidence(packageManifest)) !== canonicalJson(expected.lifecycleScripts)) fail("MIGRATION_PACKAGE_LIFECYCLE_DRIFT", `candidate lifecycle drifted for ${expected.id}`);
    if (`sha256:${await hashResourcePath({ artifactRoot: npmRoot, relativePath: relative, allowContainedSymlinks: true })}` !== expected.toTreeDigest) fail("MIGRATION_TARGET_PACKAGE_TREE_DRIFT", `candidate tree drifted for ${expected.id}`);
  }
  return Object.freeze({ lockDigest: expectedLockDigest, npmTreeDigest: await hashTree(npmRoot) });
}

function targetedSignature(settings, packageNames) {
  const selected = (settings.packages ?? [])
    .filter((entry) => packageNames.has(packageNameFromSetting(entry)))
    .map((entry) => structuredClone(entry))
    .sort((left, right) => String(sourceFromSetting(left)).localeCompare(String(sourceFromSetting(right))));
  return digest(canonicalJson({ packages: selected, onlyMyPi: settings.onlyMyPi ?? null }));
}

function targetSettingsBase(current, manifest) {
  const byName = new Map(manifest.externalPackages.map((entry) => [entry.name, entry]));
  const output = structuredClone(current);
  output.packages = (output.packages ?? []).map((setting) => {
    const expected = byName.get(packageNameFromSetting(setting));
    return expected ? replacePackageSource(setting, expected.sourceSpec) : setting;
  });
  return output;
}

function restoreAuthorizedSettings(current, baseline, packageNames) {
  const withoutCandidateManaged = compileUninstalledSettings(current);
  let output = compilePublishedSettings(withoutCandidateManaged, baseline.onlyMyPi.managedSettings, baseline.onlyMyPi);
  const baselinePackages = (baseline.packages ?? []).filter((entry) => packageNames.has(packageNameFromSetting(entry)));
  output.packages = (output.packages ?? []).filter((entry) => !packageNames.has(packageNameFromSetting(entry)));
  output.packages.push(...structuredClone(baselinePackages));
  return output;
}

export class FilesystemMigrationPlatform {
  constructor({ rootDir, configRoot, piPackageRoot, piBinPath, planner, candidateTarget, userCli, doctor, smokeRunner, bootstrapTransaction, runCommand } = {}) {
    for (const [label, value] of Object.entries({ rootDir, configRoot, piPackageRoot, piBinPath })) if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError(`${label} must be an absolute path`);
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
    this.piPackageRoot = path.resolve(piPackageRoot);
    this.piBinPath = path.resolve(piBinPath);
    this.planner = planner;
    this.candidateTarget = candidateTarget;
    this.userCli = userCli;
    this.doctor = doctor;
    this.smokeRunner = smokeRunner;
    this.bootstrapTransaction = bootstrapTransaction;
    this.runCommand = runCommand ?? createArtifactProcessRunner();
  }

  async rollbackManifest(context) {
    return readJsonObject(this.configRoot, context.paths.rollbackManifest);
  }

  async updateRollbackManifest(context, patch) {
    const current = await this.rollbackManifest(context);
    const updated = { ...current, ...patch };
    await atomicWriteJson(this.configRoot, context.paths.rollbackManifest, updated, { mode: 0o600 });
    return updated;
  }

  async preflight(context) {
    const [preflight, target] = await Promise.all([
      this.planner.inspect({ manifest: context.inspected.manifest }),
      this.candidateTarget.inspect({ manifest: context.inspected.manifest }),
    ]);
    if (preflight.settings.digest !== context.plan.preflight?.settings?.digest
      || preflight.pi.treeDigest !== context.plan.preflight?.pi?.treeDigest
      || preflight.external.npmTreeDigest !== context.plan.preflight?.external?.npmTreeDigest
      || target.graphDigest !== context.plan.candidateGraphDigest) {
      fail("MIGRATION_PLAN_DRIFT", "installed stack changed after migration planning");
    }
    const identity = await readJsonFile(path.join(this.rootDir, "artifact-identity.json"), "only-my-pi source identity");
    if (identity?.formatVersion !== 1 || identity.kind !== "only-my-pi-source-identity" || identity.sourceCommit !== context.plan.sourceCommit || !FULL_SHA.test(identity.sourceCommit)) fail("MIGRATION_SOURCE_IDENTITY_DRIFT", "executing artifact does not match the migration source commit");
  }

  async backup(context) {
    const settings = await loadSettings(this.configRoot);
    if (settings.digest !== context.plan.preflight.settings.digest) fail("MIGRATION_SETTINGS_DRIFT", "settings changed before durable backup");
    const paths = layoutFor({ transactionId: context.transactionId, piPackageRoot: this.piPackageRoot, configRoot: this.configRoot });
    for (const target of [paths.piStage, paths.piBackup, paths.piCandidateArchive, paths.externalStage, paths.externalBackup, paths.externalCandidateArchive]) {
      if (await lstatOrNull(target)) fail("MIGRATION_STAGING_COLLISION", `migration sibling path already exists: ${path.basename(target)}`);
    }
    const lkg = await readOptionalJson(configRuntimePaths(this.configRoot).lastKnownGoodFile);
    const cliSnapshot = await this.userCli.snapshot();
    const rollback = {
      formatVersion: 1,
      kind: "only-my-pi-upstream-rollback-manifest",
      transactionId: context.transactionId,
      settings: { exists: settings.exists, digest: settings.digest, value: settings.settings },
      lkg,
      cliSnapshot,
      pathNames: Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, path.basename(value)])),
      oldPiTreeDigest: context.plan.preflight.pi.treeDigest,
      oldExternalTreeDigest: context.plan.preflight.external.npmTreeDigest,
      targetPiTreeDigest: context.inspected.manifest.piArtifact.treeDigest,
      targetExternalTreeDigest: null,
      candidateGenerationId: context.plan.candidateGraphDigest,
      targetSettingsDigest: null,
      targetSettingsSignature: null,
    };
    await atomicWriteJson(this.configRoot, context.paths.rollbackManifest, rollback, { mode: 0o600 });
    context.state.layout = paths;
    context.state.rollback = rollback;
  }

  async materializeArtifacts(context) {
    if (context.state.artifacts) return context.state.artifacts;
    const loaded = await loadMigrationArtifactBytes({ bundlePath: context.options.bundle, rootDir: this.rootDir, expectedBundleSha256: context.plan.bundle.sha256 });
    const artifactRoot = path.join(context.paths.staging, "artifacts");
    await fs.mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const artifacts = new Map();
    for (const name of M10_ARTIFACT_NAMES) {
      const bytes = loaded.artifactBytes.get(name);
      const target = path.join(artifactRoot, name);
      await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
      artifacts.set(name, target);
    }
    context.state.artifacts = artifacts;
    return artifacts;
  }

  async stagePi(context) {
    const artifacts = await this.materializeArtifacts(context);
    const extracted = await extractArchive({ archive: artifacts.get("pi-candidate.tgz"), destination: path.join(context.paths.staging, "extract-pi"), topLevel: "package", runCommand: this.runCommand });
    const layout = context.state.layout ?? layoutFor({ transactionId: context.transactionId, piPackageRoot: this.piPackageRoot, configRoot: this.configRoot });
    await fs.cp(extracted, layout.piStage, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    const manifest = await readJsonFile(path.join(layout.piStage, "package.json"), "candidate Pi manifest");
    if (manifest.name !== "@earendil-works/pi-coding-agent" || manifest.version !== context.inspected.manifest.to.piVersion) fail("MIGRATION_TARGET_PI_DRIFT", "candidate Pi package identity drifted");
    if (await hashTree(layout.piStage) !== context.inspected.manifest.piArtifact.treeDigest) fail("MIGRATION_TARGET_PI_TREE_DRIFT", "candidate Pi tree digest drifted");
    context.state.layout = layout;
  }

  async stageExternalTree(context) {
    const artifacts = await this.materializeArtifacts(context);
    const extracted = await extractArchive({ archive: artifacts.get("external-npm-tree.tgz"), destination: path.join(context.paths.staging, "extract-external"), topLevel: "npm", runCommand: this.runCommand });
    const layout = context.state.layout;
    await fs.cp(extracted, layout.externalStage, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
    const expectedLockDigest = context.inspected.manifest.artifacts["external-package-lock.json"];
    const external = await verifyTargetExternalTree(layout.externalStage, context.inspected.manifest, expectedLockDigest);
    context.state.targetExternal = external;
    await this.updateRollbackManifest(context, { targetExternalTreeDigest: external.npmTreeDigest });
  }

  async onlyMyPiPackage(context) {
    if (context.state.onlyMyPiPackageRoot) return context.state.onlyMyPiPackageRoot;
    const artifacts = await this.materializeArtifacts(context);
    const extracted = await extractArchive({ archive: artifacts.get("only-my-pi.tgz"), destination: path.join(context.paths.staging, "extract-only-my-pi"), topLevel: "package", runCommand: this.runCommand });
    const manifest = await readJsonFile(path.join(extracted, "package.json"), "candidate only-my-pi package manifest");
    const identity = await readJsonFile(path.join(extracted, "artifact-identity.json"), "candidate only-my-pi source identity");
    if (manifest.name !== "only-my-pi" || identity?.sourceCommit !== context.plan.sourceCommit) fail("MIGRATION_ONLY_MY_PI_IDENTITY_DRIFT", "candidate only-my-pi artifact identity drifted");
    context.state.onlyMyPiPackageRoot = extracted;
    context.state.onlyMyPiPackageVersion = manifest.version;
    return extracted;
  }

  async stageGeneration(context) {
    const packageRoot = await this.onlyMyPiPackage(context);
    const candidatePlan = await buildCandidateBoundGraphPlan({ rootDir: packageRoot, manifest: context.inspected.manifest });
    if (candidatePlan.graphDigest !== context.plan.candidateGraphDigest) fail("CANDIDATE_GRAPH_DIGEST_DRIFT", "staged artifact candidate graph differs from the reviewed plan");
    const generation = await stageAndPromoteGeneration({
      plan: candidatePlan,
      configRoot: this.configRoot,
      transactionId: context.transactionId,
      artifactRoot: packageRoot,
      runCommand: async () => fail("MIGRATION_MANAGED_PACKAGE_FORBIDDEN", "candidate generation may not stage managed third-party packages"),
    });
    context.state.candidatePlan = candidatePlan;
    context.state.generation = generation;
  }

  async stageCli(context) {
    const packageRoot = await this.onlyMyPiPackage(context);
    let staged = await this.userCli.stage({
      packageRoot,
      artifactSha256: context.inspected.manifest.onlyMyPiArtifact.sha256,
      sourceCommit: context.plan.sourceCommit,
      packageVersion: context.state.onlyMyPiPackageVersion,
    });
    staged = await this.userCli.bindGeneration(staged, context.plan.candidateGraphDigest);
    context.state.stagedCli = staged;
  }

  async renamePiOld(context) {
    const { piBackup } = context.state.layout;
    if (await lstatOrNull(piBackup)) fail("MIGRATION_PI_BACKUP_COLLISION", "Pi backup path already exists");
    if (await hashTree(this.piPackageRoot) !== context.plan.preflight.pi.treeDigest) fail("MIGRATION_PI_TREE_DRIFT", "Pi tree changed before switch");
    await fs.rename(this.piPackageRoot, piBackup);
  }

  async renamePiNew(context) {
    await fs.rename(context.state.layout.piStage, this.piPackageRoot);
    if (await hashTree(this.piPackageRoot) !== context.inspected.manifest.piArtifact.treeDigest) fail("MIGRATION_TARGET_PI_TREE_DRIFT", "published Pi tree drifted");
    const real = await fs.realpath(this.piBinPath);
    const root = await fs.realpath(this.piPackageRoot);
    if (!real.startsWith(`${root}${path.sep}`)) fail("MIGRATION_PI_BINARY_ESCAPE", "Pi binary no longer resolves inside the candidate package");
  }

  async renameExternalOld(context) {
    const { externalRoot, externalBackup } = context.state.layout;
    if (await hashTree(externalRoot) !== context.plan.preflight.external.npmTreeDigest) fail("MIGRATION_EXTERNAL_TREE_DRIFT", "external npm tree changed before switch");
    await fs.rename(externalRoot, externalBackup);
  }

  async renameExternalNew(context) {
    const { externalRoot, externalStage } = context.state.layout;
    await fs.rename(externalStage, externalRoot);
    if (await hashTree(externalRoot) !== context.state.targetExternal.npmTreeDigest) fail("MIGRATION_TARGET_EXTERNAL_TREE_DRIFT", "published external npm tree drifted");
  }

  async publishSettings(context) {
    const rollback = await this.rollbackManifest(context);
    const current = await loadSettings(this.configRoot);
    const names = new Set(context.inspected.manifest.externalPackages.map((entry) => entry.name));
    if (targetedSignature(current.settings, names) !== targetedSignature(rollback.settings.value, names)) fail("CONCURRENT_EXTERNAL_PACKAGE_CHANGE", "authorized package settings or onlyMyPi metadata changed during migration");
    const base = targetSettingsBase(current.settings, context.inspected.manifest);
    const compiled = await compileGenerationSettings({
      plan: context.state.candidatePlan,
      promotion: context.state.generation.receipt,
      configRoot: this.configRoot,
      transactionId: context.transactionId,
    });
    const previous = rollback.settings.value.onlyMyPi;
    const metadata = {
      profileId: "daily",
      generationId: context.state.candidatePlan.graphDigest,
      graphDigest: context.state.candidatePlan.graphDigest,
      providerSelection: previous.providerSelection ?? null,
      initialMode: previous.initialMode ?? null,
      packageBindings: context.state.candidatePlan.packageBindings,
    };
    const intended = compilePublishedSettings(base, compiled.ownedSettings, metadata);
    const saved = await compareAndSaveSettings(this.configRoot, intended, { expectedCurrent: { exists: current.exists, digest: current.digest } });
    context.state.savedSettings = saved;
    const signature = targetedSignature(saved.settings, names);
    await this.updateRollbackManifest(context, { targetSettingsDigest: saved.digest, targetSettingsSignature: signature });
  }

  async activateGeneration(context) {
    const verified = await verifyPromotedGeneration({ plan: context.state.candidatePlan, layout: context.state.generation.layout });
    const settings = await loadSettings(this.configRoot);
    if (settings.settings.onlyMyPi?.generationId !== verified.receipt.graphDigest) fail("MIGRATION_GENERATION_ACTIVATION_DRIFT", "settings do not activate the verified candidate generation");
  }

  async activateCli(context) {
    context.state.cli = await this.userCli.activate(context.state.stagedCli);
  }

  async staticDoctor() {
    const result = await this.doctor.static({ profileId: "daily", strict: false });
    if (result?.ok !== true || result.errors !== 0) fail("STATIC_DOCTOR_FAILED", "candidate artifact static doctor failed", { doctor: result });
  }

  async noModelSmoke(context) {
    const settings = await loadSettings(this.configRoot);
    const result = await this.smokeRunner({ configRoot: this.configRoot, settings: settings.settings, operation: "upstream-migration" });
    if (result?.ok !== true) fail("NO_MODEL_SMOKE_FAILED", "candidate no-model smoke failed", { smoke: result });
    context.state.smoke = result;
  }

  async recordLkg(context) {
    const result = await this.bootstrapTransaction.reconcileLastKnownGood(this.configRoot);
    if (!new Set(["REBUILT", "PRESERVED"]).has(result.status) || result.generationId !== context.plan.candidateGraphDigest) fail("MIGRATION_LKG_RECORD_FAILED", "candidate last-known-good identity was not recorded");
    context.state.lkg = result;
  }

  async commit(context) {
    const rollback = await this.rollbackManifest(context);
    if (await hashTree(this.piPackageRoot) !== rollback.targetPiTreeDigest || await hashTree(path.join(this.configRoot, "npm")) !== rollback.targetExternalTreeDigest) fail("MIGRATION_COMMIT_IDENTITY_DRIFT", "candidate physical identity drifted before commit");
    const active = await this.userCli.inspectActive();
    if (active?.manifest?.installedGenerationId !== context.plan.candidateGraphDigest || active.manifest.artifactSha256 !== context.inspected.manifest.onlyMyPiArtifact.sha256) fail("MIGRATION_CLI_IDENTITY_DRIFT", "CLI and generation identities differ before commit");
  }

  async readRecordedPlan(transactionId) {
    const root = path.join(this.configRoot, "only-my-pi", "upstream-transactions", transactionId);
    return readJsonObject(this.configRoot, path.join(root, "plan.json"));
  }

  async restorePhysicalRoot({ root, backup, candidateArchive, oldDigest, targetDigest }) {
    const backupStat = await lstatOrNull(backup);
    const rootStat = await lstatOrNull(root);
    if (backupStat) {
      if (!backupStat.isDirectory() || backupStat.isSymbolicLink() || await hashTree(backup) !== oldDigest) fail("MIGRATION_BACKUP_DRIFT", `backup drifted for ${path.basename(root)}`);
      if (rootStat) {
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || await hashTree(root) !== targetDigest) fail("MIGRATION_PUBLISHED_ROOT_DRIFT", `published root drifted for ${path.basename(root)}`);
        if (await lstatOrNull(candidateArchive)) fail("MIGRATION_RECOVERY_COLLISION", `candidate archive path exists for ${path.basename(root)}`);
        await fs.rename(root, candidateArchive);
      }
      await fs.rename(backup, root);
      return;
    }
    if (!rootStat || await hashTree(root) !== oldDigest) fail("MANUAL_RECONCILIATION_REQUIRED", `cannot prove old root identity for ${path.basename(root)}`);
  }

  async rollback(context) {
    const rollbackStat = await lstatOrNull(context.paths.rollbackManifest);
    if (rollbackStat === null) {
      await fs.rm(context.paths.staging, { recursive: true, force: true });
      return { status: "NO_VISIBLE_MUTATION", manualReconciliation: false };
    }
    const rollback = await this.rollbackManifest(context);
    const layout = layoutFor({ transactionId: context.transactionId, piPackageRoot: this.piPackageRoot, configRoot: this.configRoot });
    let manual = false;
    let code = "STACK_RESTORED";
    try {
      await this.restorePhysicalRoot({ root: layout.externalRoot, backup: layout.externalBackup, candidateArchive: layout.externalCandidateArchive, oldDigest: rollback.oldExternalTreeDigest, targetDigest: rollback.targetExternalTreeDigest });
      await this.restorePhysicalRoot({ root: this.piPackageRoot, backup: layout.piBackup, candidateArchive: layout.piCandidateArchive, oldDigest: rollback.oldPiTreeDigest, targetDigest: rollback.targetPiTreeDigest });
    } catch (error) {
      if (error?.code === "MANUAL_RECONCILIATION_REQUIRED") { manual = true; code = error.code; } else throw error;
    }

    const names = new Set((await this.readRecordedPlan(context.transactionId)).packages.map((entry) => entry.name));
    const current = await loadSettings(this.configRoot);
    if (current.digest !== rollback.settings.digest) {
      const signature = targetedSignature(current.settings, names);
      if (signature !== rollback.targetSettingsSignature) {
        manual = true;
        code = "CONCURRENT_EXTERNAL_PACKAGE_CHANGE";
      } else {
        const restored = restoreAuthorizedSettings(current.settings, rollback.settings.value, names);
        await compareAndSaveSettings(this.configRoot, restored, { expectedCurrent: { exists: current.exists, digest: current.digest } });
      }
    }
    await this.userCli.restore(rollback.cliSnapshot);
    if (!manual) {
      const lkgPath = configRuntimePaths(this.configRoot).lastKnownGoodFile;
      if (rollback.lkg.exists) await atomicWriteJson(this.configRoot, lkgPath, rollback.lkg.value, { mode: 0o600 });
      else await fs.rm(lkgPath, { force: true });
    }
    for (const target of [layout.piStage, layout.externalStage, context.paths.staging]) await fs.rm(target, { recursive: true, force: true });
    return { status: manual ? "MANUAL_RECONCILIATION_REQUIRED" : "STACK_RESTORED", manualReconciliation: manual, code };
  }
}

export function createFilesystemMigrationPlatform(options) {
  return new FilesystemMigrationPlatform(options);
}
