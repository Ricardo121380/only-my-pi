import fs from "node:fs/promises";
import path from "node:path";

import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { canonicalJson } from "../config-runtime/index.mjs";
import { PUBLIC_STACK_PACKAGES, sha256, validateStackManifest } from "./contracts.mjs";

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

async function lstatOrNull(target) {
  return fs.lstat(target).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
}

async function assertNoUnsafeAncestor(target, stopAt) {
  let current = path.resolve(target);
  const boundary = path.resolve(stopAt);
  while (current !== boundary && current !== path.dirname(current)) {
    const stat = await lstatOrNull(current);
    if (stat?.isSymbolicLink()) fail("STACK_PATH_UNSAFE", `stack target has a symlink ancestor: ${path.basename(current)}`);
    current = path.dirname(current);
  }
}

async function inspectShim(target, layout) {
  const stat = await lstatOrNull(target);
  if (!stat) return Object.freeze({ status: "ABSENT", targetClass: null });
  if (!stat.isSymbolicLink()) fail("SHIM_CONFLICT", `${path.basename(target)} exists and is not an only-my-pi symlink`);
  const real = await fs.realpath(target).catch(() => null);
  if (!real || (real !== layout.shareRoot && !real.startsWith(`${layout.shareRoot}${path.sep}`))) fail("SHIM_CONFLICT", `${path.basename(target)} does not resolve inside the controlled stack root`);
  return Object.freeze({ status: "CONTROLLED", targetClass: "USER_LOCAL_CONTROLLED_STACK", targetDigest: sha256(path.relative(layout.shareRoot, real).split(path.sep).join("/")) });
}

function packageNameFromLockPath(relative) {
  if (!relative.startsWith("node_modules/")) return null;
  const tail = relative.slice("node_modules/".length).split("/");
  return tail[0].startsWith("@") ? `${tail[0]}/${tail[1]}` : tail[0];
}

function topLevelNames(lock) {
  const names = [];
  for (const relative of Object.keys(lock.packages ?? {})) {
    const name = packageNameFromLockPath(relative);
    const depth = relative.split("/node_modules/").length - 1;
    if (name && depth === 0 && relative === `node_modules/${name}`) names.push(name);
  }
  return [...new Set(names)].sort();
}

async function inspectExternalRoot(layout, stack) {
  const stat = await lstatOrNull(layout.npmRoot);
  if (!stat) return Object.freeze({ classification: "EMPTY", existing: [], missing: PUBLIC_STACK_PACKAGES.map((entry) => entry.name), rootDigest: null });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("EXTERNAL_ROOT_UNSAFE", "existing Pi npm root must be a real directory");
  const lockPath = path.join(layout.npmRoot, "package-lock.json");
  const lockStat = await lstatOrNull(lockPath);
  if (!lockStat?.isFile() || lockStat.isSymbolicLink() || lockStat.size > 64 * 1024 * 1024) fail("EXTERNAL_ROOT_UNVERIFIABLE", "existing Pi npm root requires a bounded package-lock.json");
  const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
  if (lock.lockfileVersion !== 3 || !lock.packages) fail("EXTERNAL_ROOT_UNVERIFIABLE", "existing Pi npm root requires lockfileVersion 3");
  const actualTop = topLevelNames(lock);
  const expectedNames = new Set(PUBLIC_STACK_PACKAGES.map((entry) => entry.name));
  const unknown = actualTop.filter((name) => !expectedNames.has(name));
  const declaredMissing = stack.externalPackages.filter((entry) => !lock.packages[`node_modules/${entry.name}`]).map((entry) => entry.name);
  if (declaredMissing.length > 0 && unknown.length > 0) fail("PARTIAL_ROOT_UNRELATED_PACKAGE_CONFLICT", "partial governed root contains unrelated top-level packages", { unknown: unknown.map((name) => sha256(name)) });
  if (declaredMissing.length === 0 && unknown.length > 0) fail("EXTERNAL_ROOT_UNRELATED_PACKAGE_CONFLICT", "complete governed root contains unrelated top-level packages", { unknown: unknown.map((name) => sha256(name)) });
  const existing = [];
  const missing = [];
  for (const expected of stack.externalPackages) {
    const relative = `node_modules/${expected.name}`;
    const locked = lock.packages[relative];
    if (!locked) { missing.push(expected.name); continue; }
    if (locked.version !== expected.version || locked.integrity !== expected.integrity) fail("REQUIRED_PACKAGE_CONFLICT", `existing package differs from Preview target: ${expected.name}`);
    const packageRoot = path.join(layout.npmRoot, ...relative.split("/"));
    const packageStat = await lstatOrNull(packageRoot);
    if (!packageStat?.isDirectory() || packageStat.isSymbolicLink()) fail("EXTERNAL_ROOT_UNVERIFIABLE", `existing package root is unsafe: ${expected.name}`);
    const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (manifest.name !== expected.name || manifest.version !== expected.version) fail("REQUIRED_PACKAGE_CONFLICT", `existing disk package differs: ${expected.name}`);
    const treeDigest = `sha256:${await hashResourcePath({ artifactRoot: layout.npmRoot, relativePath: relative, allowContainedSymlinks: true })}`;
    if (treeDigest !== expected.treeDigest) fail("EXTERNAL_PACKAGE_DRIFT", `existing package tree drifted: ${expected.name}`);
    existing.push(Object.freeze({ name: expected.name, version: expected.version, treeDigest }));
  }
  return Object.freeze({
    classification: missing.length === 0 ? "EXACT" : "PARTIAL",
    existing: Object.freeze(existing),
    missing: Object.freeze(missing),
    rootDigest: `sha256:${await hashResourcePath({ artifactRoot: layout.configRoot, relativePath: path.relative(layout.configRoot, layout.npmRoot), allowContainedSymlinks: true })}`,
  });
}

export async function planStackEnvironment({
  layout,
  stackManifest,
  payloadMode,
  operation = "install",
  platform = { os: process.platform, arch: process.arch, minimumMacOSSatisfied: process.platform !== "darwin" ? false : true, rosetta: false },
  pathValue = process.env.PATH ?? "",
} = {}) {
  const stack = validateStackManifest(stackManifest);
  if (!layout?.shareRoot || !layout?.configRoot) throw new TypeError("stack planner requires a stack layout");
  if (!["full", "thin"].includes(payloadMode)) fail("PAYLOAD_MODE_INVALID", "payload mode must be full or thin");
  if (platform.os !== "darwin" || platform.arch !== "arm64" || platform.minimumMacOSSatisfied !== true || platform.rosetta === true) fail("PLATFORM_UNSUPPORTED", "public Preview supports native Apple Silicon macOS 14+");
  await Promise.all([
    assertNoUnsafeAncestor(layout.shareRoot, layout.homeDir),
    assertNoUnsafeAncestor(layout.configRoot, layout.homeDir),
    assertNoUnsafeAncestor(layout.binRoot, layout.homeDir),
  ]);
  const [ompShim, piShim, external] = await Promise.all([
    inspectShim(layout.ompShim, layout),
    inspectShim(layout.piShim, layout),
    inspectExternalRoot(layout, stack),
  ]);
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
  const pathActionRequired = !pathEntries.includes(path.resolve(layout.binRoot));
  const plan = {
    formatVersion: 1,
    kind: "only-my-pi-stack-plan",
    operation,
    mutation: false,
    status: operation === "install" && ompShim.status === "CONTROLLED" ? "STACK_UPDATE_PLAN" : "STACK_INSTALL_PLAN",
    stackId: stack.stackId,
    payloadMode,
    external: {
      classification: external.classification,
      existing: external.existing,
      missing: external.missing,
      priorRootDigest: external.rootDigest,
      switchRequired: external.classification !== "EXACT",
      ownership: "external/user",
    },
    shims: { omp: ompShim, pi: piShim },
    path: { binRootType: "USER_LOCAL_BIN", actionRequired: pathActionRequired },
    systemRoots: { homebrewMutation: false, sudo: false },
    privacy: { authRead: false, sessionsRead: false, providerSecretsRead: false, cookiesRead: false, memoryRead: false },
  };
  plan.planDigest = sha256(canonicalJson(plan));
  return Object.freeze(plan);
}
