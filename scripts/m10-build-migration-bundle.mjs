#!/usr/bin/env node

import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { BootstrapService } from "../packages/bootstrap/bootstrap-service.mjs";
import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import { verifyRecordedExternalBindings } from "../packages/bootstrap/package-bindings.mjs";
import { loadSettings } from "../packages/config-runtime/index.mjs";
import {
  buildCandidateBoundGraphPlan,
  createMigrationManifest,
  M10_ARTIFACT_NAMES,
  M10_EXACT_PACKAGE_TARGET,
} from "../packages/upstream-migration/index.mjs";
import { parsePackageSpec } from "./lib/package-source.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;
const PI_ROOT = "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent";
const CONFIG_ROOT = path.join(os.homedir(), ".pi", "agent");
const PI_INTEGRITY = "sha512-Yr2p9PubrbFZmYEPYI+C8KmZP9xlFuLDnAG64RtU0ZDgrdiXYWa+y7WGyJO5OlqPliOkVCMd9IzVszO3/t0D0w==";
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

function sri(value) {
  return `sha512-${crypto.createHash("sha512").update(value).digest("base64")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function lifecycleEvidence(packageManifest) {
  const scripts = packageManifest?.scripts ?? {};
  return Object.entries(scripts)
    .filter(([name]) => LIFECYCLE_NAMES.has(name))
    .map(([name, command]) => ({ name, commandSha256: digest(command), necessity: "not-required" }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function urlDigest(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) fail("M10_BUILD_LOCK_URL_UNSAFE", "package lock URL must be credential-free HTTPS");
  return digest(url.href);
}

function sourceFromSetting(setting) {
  return typeof setting === "string" ? setting : setting?.source;
}

function settingByName(settings, name) {
  const values = (settings.packages ?? []).filter((entry) => {
    try { const parsed = parsePackageSpec(sourceFromSetting(entry)); return parsed.type === "npm" && parsed.name === name; } catch { return false; }
  });
  if (values.length !== 1) fail("M10_BUILD_SETTINGS_DRIFT", `settings must contain ${name} exactly once`);
  return values[0];
}

async function run(command, argv, { cwd, env = process.env } = {}) {
  try {
    return await exec(command, argv, { cwd, env, maxBuffer: 16 * 1024 * 1024, timeout: 20 * 60 * 1000 });
  } catch (cause) {
    fail("M10_BUILD_COMMAND_FAILED", `${command} failed`, { cause, command, argv });
  }
}

async function safeEnvironment(root) {
  const cache = path.join(root, "npm-cache");
  const temporary = path.join(root, "tmp");
  const userconfig = path.join(root, "user.npmrc");
  const globalconfig = path.join(root, "global.npmrc");
  await Promise.all([cache, temporary].map((target) => fs.mkdir(target, { recursive: true, mode: 0o700 })));
  const npmrc = "audit=false\nfund=false\nignore-scripts=true\nupdate-notifier=false\n";
  await fs.writeFile(userconfig, npmrc, { mode: 0o600 });
  await fs.writeFile(globalconfig, npmrc, { mode: 0o600 });
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: temporary,
    LC_ALL: "C",
    NO_COLOR: "1",
    npm_config_cache: cache,
    npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig,
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
}

async function normalizeArchive({ input, output, topLevel, mutate, inspect }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m10-normalize-"));
  try {
    const extracted = path.join(root, "extracted");
    const normalized = path.join(root, "normalized");
    await fs.mkdir(extracted, { mode: 0o700 });
    await fs.mkdir(normalized, { mode: 0o700 });
    await run("tar", ["-xzf", input, "-C", extracted], { cwd: root });
    const source = path.join(extracted, topLevel);
    if (mutate) await mutate(source);
    await fs.cp(source, path.join(normalized, topLevel), { recursive: true, dereference: true, preserveTimestamps: true });
    const normalizedRoot = path.join(normalized, topLevel);
    const inspection = inspect ? await inspect(normalizedRoot) : null;
    await run("tar", ["-czf", output, "-C", normalized, topLevel], { cwd: root });
    return inspection;
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function npmPack(spec, destination, env, cwd = destination) {
  const result = await run("npm", ["pack", spec, "--ignore-scripts", "--json", "--pack-destination", destination], { cwd, env });
  const payload = JSON.parse(result.stdout);
  if (!Array.isArray(payload) || payload.length !== 1 || typeof payload[0].filename !== "string") fail("M10_BUILD_NPM_PACK_INVALID", `npm pack returned an invalid result for ${spec}`);
  return path.join(destination, payload[0].filename);
}

async function currentExternalEvidence(manifestEntries) {
  const settingsState = await loadSettings(CONFIG_ROOT);
  const metadata = settingsState.settings.onlyMyPi;
  if (!metadata || !Array.isArray(metadata.packageBindings) || metadata.packageBindings.filter((entry) => entry.binding === "external" && entry.owner === "user").length !== 7) fail("M10_BUILD_OWNERSHIP_DRIFT", "seven current daily bindings must be external and user-owned");
  await verifyRecordedExternalBindings({ configRoot: CONFIG_ROOT, settings: settingsState.settings, bindings: metadata.packageBindings });
  const npmRoot = path.join(CONFIG_ROOT, "npm");
  const lock = JSON.parse(await fs.readFile(path.join(npmRoot, "package-lock.json"), "utf8"));
  for (const entry of manifestEntries) {
    if (sourceFromSetting(settingByName(settingsState.settings, entry.name)) !== `npm:${entry.name}@${entry.fromVersion}`) fail("M10_BUILD_SETTINGS_DRIFT", `current settings version drifted for ${entry.id}`);
    const relative = `node_modules/${entry.name}`;
    const locked = lock.packages?.[relative];
    if (!locked || locked.version !== entry.fromVersion || locked.integrity !== entry.fromIntegrity) fail("M10_BUILD_LOCK_DRIFT", `current lock drifted for ${entry.id}`);
    const packageRoot = path.join(npmRoot, ...relative.split("/"));
    const packageManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (packageManifest.name !== entry.name || packageManifest.version !== entry.fromVersion) fail("M10_BUILD_PACKAGE_DRIFT", `current physical package identity drifted for ${entry.id}`);
    if (JSON.stringify(lifecycleEvidence(packageManifest)) !== JSON.stringify(entry.fromLifecycleScripts)) fail("M10_BUILD_LIFECYCLE_DRIFT", `current lifecycle drifted for ${entry.id}`);
    entry.fromResolvedUrlDigest = urlDigest(locked.resolved);
    entry.fromTreeDigest = `sha256:${await hashResourcePath({ artifactRoot: npmRoot, relativePath: relative, allowContainedSymlinks: true })}`;
  }
  const doctor = await new BootstrapService({ rootDir: ROOT }).doctor({ configRoot: CONFIG_ROOT });
  if (doctor.ok !== true) fail("M10_BUILD_INSTALLED_GENERATION_INVALID", "installed historical generation must be healthy before bundle creation", { doctor });
  const piManifest = JSON.parse(await fs.readFile(path.join(PI_ROOT, "package.json"), "utf8"));
  if (piManifest.name !== "@earendil-works/pi-coding-agent" || piManifest.version !== "0.84.1") fail("M10_BUILD_PI_BASELINE_DRIFT", "installed Pi must be the exact 0.84.1 baseline before bundle creation");
  return { settingsDigest: settingsState.digest, generationId: metadata.generationId };
}

async function targetExternalTree(root, env, manifestEntries) {
  const npmRoot = path.join(root, "target", "npm");
  await fs.mkdir(npmRoot, { recursive: true, mode: 0o700 });
  const dependencies = Object.fromEntries(manifestEntries.map((entry) => [entry.name, entry.toVersion]));
  await fs.writeFile(path.join(npmRoot, "package.json"), `${JSON.stringify({ name: "only-my-pi-m10-external-tree", private: true, dependencies }, null, 2)}\n`, { mode: 0o600 });
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", "--package-lock=true"], { cwd: npmRoot, env });
  const lock = JSON.parse(await fs.readFile(path.join(npmRoot, "package-lock.json"), "utf8"));
  for (const entry of manifestEntries) {
    const relative = `node_modules/${entry.name}`;
    const locked = lock.packages?.[relative];
    if (!locked || locked.version !== entry.toVersion || locked.integrity !== entry.toIntegrity) fail("M10_BUILD_TARGET_LOCK_DRIFT", `target lock drifted for ${entry.id}`);
    const packageManifest = JSON.parse(await fs.readFile(path.join(npmRoot, ...relative.split("/"), "package.json"), "utf8"));
    if (JSON.stringify(lifecycleEvidence(packageManifest)) !== JSON.stringify(entry.toLifecycleScripts)) fail("M10_BUILD_TARGET_LIFECYCLE_DRIFT", `target lifecycle drifted for ${entry.id}`);
    entry.toResolvedUrlDigest = urlDigest(locked.resolved);
  }
  const rawArchive = path.join(root, "external-raw.tgz");
  await run("tar", ["-czhf", rawArchive, "-C", path.dirname(npmRoot), "npm"], { cwd: root });
  const normalizedArchive = path.join(root, "artifacts", "external-npm-tree.tgz");
  const normalized = await normalizeArchive({
    input: rawArchive,
    output: normalizedArchive,
    topLevel: "npm",
    inspect: async (normalizedRoot) => {
      const lockBytes = await fs.readFile(path.join(normalizedRoot, "package-lock.json"));
      for (const entry of manifestEntries) {
        const relative = `node_modules/${entry.name}`;
        entry.toTreeDigest = `sha256:${await hashResourcePath({ artifactRoot: normalizedRoot, relativePath: relative, allowContainedSymlinks: true })}`;
      }
      return { lockBytes };
    },
  });
  return { archive: normalizedArchive, lockBytes: normalized.lockBytes };
}

async function build({ output, sourceCommit }) {
  if (!FULL_SHA.test(sourceCommit)) fail("M10_BUILD_SOURCE_INVALID", "--source-commit must be a full lowercase SHA");
  const head = (await run("git", ["rev-parse", "HEAD"], { cwd: ROOT })).stdout.trim();
  const dirty = (await run("git", ["status", "--porcelain"], { cwd: ROOT })).stdout.trim();
  if (head !== sourceCommit || dirty) fail("M10_BUILD_SOURCE_NOT_CLEAN", "bundle creation requires a clean checkout at the exact source commit", { head, sourceCommit, dirty: Boolean(dirty) });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "omp-m10-bundle-"));
  await fs.chmod(temporary, 0o700);
  try {
    const artifactsRoot = path.join(temporary, "artifacts");
    await fs.mkdir(artifactsRoot, { mode: 0o700 });
    const env = await safeEnvironment(temporary);

    const entries = M10_EXACT_PACKAGE_TARGET.map((entry) => ({
      ...structuredClone(entry),
      sourceSpec: `npm:${entry.name}@${entry.toVersion}`,
      fromResolvedUrlDigest: null,
      toResolvedUrlDigest: null,
      fromTreeDigest: null,
      toTreeDigest: null,
      binding: "external",
      owner: "user",
    }));
    const baseline = await currentExternalEvidence(entries);
    const external = await targetExternalTree(temporary, env, entries);

    const packRoot = path.join(temporary, "packs");
    await fs.mkdir(packRoot, { mode: 0o700 });
    const rawOnly = await npmPack(ROOT, packRoot, env);
    const onlyArchive = path.join(artifactsRoot, "only-my-pi.tgz");
    await normalizeArchive({
      input: rawOnly,
      output: onlyArchive,
      topLevel: "package",
      mutate: (packageRoot) => fs.writeFile(path.join(packageRoot, "artifact-identity.json"), `${JSON.stringify({ formatVersion: 1, kind: "only-my-pi-source-identity", sourceCommit }, null, 2)}\n`, { mode: 0o600, flag: "wx" }),
    });

    const rawPi = await npmPack("@earendil-works/pi-coding-agent@0.84.3", packRoot, env);
    const rawPiBytes = await fs.readFile(rawPi);
    if (sri(rawPiBytes) !== PI_INTEGRITY) fail("M10_BUILD_PI_SRI_DRIFT", "downloaded Pi artifact differs from the audited M9 SRI");
    const piArchive = path.join(artifactsRoot, "pi-candidate.tgz");
    const normalizedPi = await normalizeArchive({
      input: rawPi,
      output: piArchive,
      topLevel: "package",
      inspect: async (packageRoot) => {
        const piManifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
        if (piManifest.name !== "@earendil-works/pi-coding-agent" || piManifest.version !== "0.84.3") fail("M10_BUILD_PI_IDENTITY_DRIFT", "candidate Pi identity drifted");
        return { treeDigest: await hashResourcePath({ artifactRoot: path.dirname(packageRoot), relativePath: "package", allowContainedSymlinks: true }) };
      },
    });

    const candidateGraph = await buildCandidateBoundGraphPlan({ rootDir: ROOT, manifest: { externalPackages: entries } });
    const artifactBytes = new Map([
      ["external-npm-tree.tgz", await fs.readFile(external.archive)],
      ["external-package-lock.json", external.lockBytes],
      ["only-my-pi.tgz", await fs.readFile(onlyArchive)],
      ["pi-candidate.tgz", await fs.readFile(piArchive)],
    ]);
    const preliminaryDigests = Object.fromEntries([...artifactBytes].map(([name, bytes]) => [name, digest(bytes)]));
    const bundleReceiptBytes = Buffer.from(`${JSON.stringify(canonical({
      formatVersion: 1,
      kind: "only-my-pi-m10-bundle-receipt",
      sourceCommit,
      baseline,
      candidateGraphDigest: candidateGraph.graphDigest,
      artifacts: preliminaryDigests,
      packages: entries.map((entry) => ({ id: entry.id, fromVersion: entry.fromVersion, toVersion: entry.toVersion, action: entry.action })),
      lifecycleScriptsExecuted: false,
      applyNetworkRequired: false,
      secretMaterialRecorded: false,
    }), null, 2)}\n`);
    artifactBytes.set("bundle-receipt.json", bundleReceiptBytes);
    const artifactDigests = Object.fromEntries([...artifactBytes].map(([name, bytes]) => [name, digest(bytes)]));
    const manifest = createMigrationManifest({
      formatVersion: 1,
      kind: "only-my-pi-upstream-migration",
      id: "m10-pi-0-84-3",
      sourceCommit,
      candidateGraphDigest: candidateGraph.graphDigest,
      onlyMyPiArtifact: { sha256: artifactDigests["only-my-pi.tgz"] },
      piArtifact: { name: "@earendil-works/pi-coding-agent", version: "0.84.3", integrity: PI_INTEGRITY, sha256: artifactDigests["pi-candidate.tgz"], treeDigest: `sha256:${normalizedPi.treeDigest}` },
      from: { piVersion: "0.84.1", subagentsVersion: "0.45.2" },
      to: { piVersion: "0.84.3", subagentsVersion: "0.57.0" },
      externalPackages: entries,
      artifacts: artifactDigests,
      policy: { ignoreScripts: true, allowLifecycleScripts: false, requirePiStopped: true, preserveExternalOwnership: true, networkDuringApply: false },
    });
    const bundle = {
      formatVersion: 1,
      kind: "only-my-pi-upstream-migration-bundle",
      manifest,
      artifacts: M10_ARTIFACT_NAMES.map((name) => {
        const bytes = artifactBytes.get(name);
        return { name, bytes: bytes.length, sha256: digest(bytes), base64: bytes.toString("base64") };
      }),
    };
    const bytes = Buffer.from(`${JSON.stringify(bundle)}\n`);
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await fs.writeFile(output, bytes, { mode: 0o600, flag: "wx" });
    return { ok: true, status: "M10_MIGRATION_BUNDLE_BUILT", mutation: true, sourceCommit, outputType: "PROTECTED_LOCAL_BUNDLE", bytes: bytes.length, sha256: digest(bytes), manifestDigest: manifest.manifestDigest, candidateGraphDigest: candidateGraph.graphDigest, artifactDigests };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const result = { build: false, yes: false, json: false, output: null, sourceCommit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--build") result.build = true;
    else if (token === "--yes") result.yes = true;
    else if (token === "--json") result.json = true;
    else if (["--output", "--source-commit"].includes(token)) {
      const value = argv[++index];
      if (!value || value.startsWith("-")) fail("M10_BUILD_ARGUMENT_INVALID", `${token} requires a value`);
      if (token === "--output") result.output = value;
      else result.sourceCommit = value;
    } else fail("M10_BUILD_ARGUMENT_INVALID", `unknown argument: ${token}`);
  }
  if (!result.build) return result;
  if (!result.yes || !result.output || !path.isAbsolute(result.output) || !result.sourceCommit) fail("M10_BUILD_CONFIRMATION_REQUIRED", "bundle build requires --build --yes --output <absolute> --source-commit <40-hex>");
  return result;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = options.build
    ? await build({ output: path.resolve(options.output), sourceCommit: options.sourceCommit })
    : { ok: true, status: "M10_MIGRATION_BUNDLE_PLAN", mutation: false, networkDuringBuild: true, networkDuringApply: false, writes: 0, requires: ["--build", "--yes", "--output <absolute>", "--source-commit <40-hex>"], target: { pi: "0.84.3", packages: M10_EXACT_PACKAGE_TARGET.map((entry) => ({ id: entry.id, version: entry.toVersion, action: entry.action })) } };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, status: "M10_MIGRATION_BUNDLE_BUILD_FAILED", code: error?.code ?? "M10_BUILD_FAILED", message: error?.message ?? "bundle build failed" })}\n`);
    process.exitCode = 1;
  });
}
