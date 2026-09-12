import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

import { canonicalJson } from "../config-runtime/index.mjs";
import { hashResourcePath } from "../bootstrap/graph-plan.mjs";
import { CONTROLLED_PI_VERSION, PUBLIC_STACK_PACKAGES, sha256 } from "../release-stack/contracts.mjs";

export const DISTRIBUTION_VERSION = "0.4.0-preview.1";
export const DISTRIBUTION_VERSIONS = Object.freeze([DISTRIBUTION_VERSION, "0.4.0-preview.2"]);
export const NODE_RANGE = ">=22.19.0";
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PACKAGE_IDS = Object.freeze({
  "plan-mode": "@narumitw/pi-plan-mode", "agent-extensions": "pi-agent-extensions",
  "web-access": "pi-web-access", subagents: "pi-subagents", "permission-modes": "pi-permission-modes",
  lsp: "@narumitw/pi-lsp", usage: "@sreetej510/pi-usage", memory: "pi-memory", "git-sync": "pi-git-sync",
});
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const COMPONENTS = Object.freeze({ app: "only-my-pi/package", pi: "pi", external: "external-npm" });

export function distributionError(code, message) {
  return Object.assign(new Error(message), { code });
}
function requireThat(condition, message) {
  if (!condition) throw distributionError("DISTRIBUTION_MANIFEST_INVALID", message);
}

export async function readRegularJson(filename, { optional = false } = {}) {
  const stat = await fs.lstat(filename).catch((error) => {
    if (optional && error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat) return null;
  requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 * 1024, "metadata must be a bounded regular file");
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

export async function containedPath(root, relative, { directory = false } = {}) {
  requireThat(typeof relative === "string" && relative.length > 0 && !/[\\\0\r\n]/u.test(relative)
    && !path.posix.isAbsolute(relative) && !relative.split("/").includes(".."), "runtime path must be repository-relative");
  const target = await fs.realpath(path.join(root, relative));
  requireThat(target.startsWith(`${root}${path.sep}`), "runtime path escapes its distribution");
  const stat = await fs.stat(target);
  requireThat(directory ? stat.isDirectory() : stat.isFile(), "runtime entry has the wrong file type");
  return target;
}

export function manifestDigest(manifest) {
  const { distributionId: _id, ...identity } = manifest;
  return sha256(canonicalJson(identity));
}

export function validateDistributionManifest(manifest) {
  requireThat(manifest?.formatVersion === 1 && manifest.kind === "only-my-pi-distribution", "unsupported distribution format");
  requireThat(Object.keys(manifest).sort().join() === ["formatVersion", "kind", "version", "sourceCommit", "platform", "nodeRange", "components", "packages", "distributionId"].sort().join(), "unexpected distribution fields");
  requireThat(DISTRIBUTION_VERSIONS.includes(manifest.version) && /^[a-f0-9]{40}$/u.test(manifest.sourceCommit ?? ""), "unsupported version or source identity");
  const target = `${manifest.platform?.os}-${manifest.platform?.arch}`;
  requireThat(["darwin-arm64", "linux-x64", "linux-arm64"].includes(target), "unsupported distribution platform");
  requireThat(manifest.version !== DISTRIBUTION_VERSION || target === "darwin-arm64", "first native Preview supports only darwin-arm64");
  requireThat(canonicalJson(manifest.platform) === canonicalJson(target === "darwin-arm64"
    ? { os: "darwin", arch: "arm64", minimumMacOS: "14.0" }
    : { os: "linux", arch: manifest.platform.arch, libc: "glibc" }), "unexpected platform contract");
  requireThat(manifest.nodeRange === NODE_RANGE, "unsupported Node contract");
  requireThat(Object.keys(manifest.components ?? {}).sort().join() === Object.keys(COMPONENTS).sort().join(), "component set differs");
  for (const [name, relative] of Object.entries(COMPONENTS)) {
    const component = manifest.components[name];
    requireThat(component?.path === relative && DIGEST.test(component?.treeDigest ?? "")
      && Object.keys(component).sort().join() === "path,treeDigest", `invalid ${name} component`);
  }
  requireThat(Array.isArray(manifest.packages) && manifest.packages.length === PUBLIC_STACK_PACKAGES.length, "package tuple differs");
  requireThat(new Set(manifest.packages.map((entry) => entry.id)).size === manifest.packages.length, "duplicate package identity");
  for (const entry of manifest.packages) {
    const expected = PUBLIC_STACK_PACKAGES.find((item) => item.name === PACKAGE_IDS[entry.id]);
    requireThat(expected && entry.name === expected.name && entry.version === expected.version, "package identity differs from audited tuple");
    requireThat(entry.path === `external-npm/node_modules/${entry.name}` && DIGEST.test(entry.treeDigest ?? ""), "package path or digest differs");
    requireThat(Array.isArray(entry.resourceFilter) && entry.resourceFilter.every((item) => typeof item === "string"), "invalid extension filter");
    requireThat(Object.keys(entry).sort().join() === "id,name,path,resourceFilter,treeDigest,version", "unexpected package fields");
  }
  requireThat(DIGEST.test(manifest.distributionId ?? "") && manifestDigest(manifest) === manifest.distributionId, "distribution digest differs");
  return manifest;
}

export async function hashDistributionTree(root, relative) {
  return `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
}

export async function loadDistribution({ packageRoot = APP_ROOT, nodePath = process.execPath, nodeVersion = process.versions.node,
  platform = process.platform, arch = process.arch, kernelRelease = os.release(), glibc = process.platform === "linux" ? process.report?.getReport()?.header?.glibcVersionRuntime : undefined } = {}) {
  const root = await fs.realpath(path.resolve(packageRoot, "../.."));
  const input = await readRegularJson(path.join(root, "distribution-manifest.json"), { optional: true });
  if (!input) return null;
  const manifest = validateDistributionManifest(input);
  if (!semver.satisfies(nodeVersion, manifest.nodeRange)) throw distributionError("DISTRIBUTION_NODE_UNSUPPORTED", `only-my-pi requires Node ${manifest.nodeRange}`);
  if (manifest.platform.os !== platform || manifest.platform.arch !== arch
    || (platform === "darwin" && Number.parseInt(kernelRelease, 10) < 23)
    || (platform === "linux" && !glibc)) throw distributionError("DISTRIBUTION_PLATFORM_UNSUPPORTED", "this runtime does not support the current operating system, architecture or libc");
  const ompPackageRoot = await containedPath(root, COMPONENTS.app, { directory: true });
  requireThat(await fs.realpath(packageRoot) === ompPackageRoot, "application is not from this distribution");
  await Promise.all(Object.entries(manifest.components).map(async ([name, component]) => {
    if (await hashDistributionTree(root, component.path) !== component.treeDigest)
      throw distributionError("DISTRIBUTION_CONTENT_DRIFT", `${name} runtime content differs from its release manifest`);
  }));
  for (const tool of ["fd", "rg"]) {
    const binary = await containedPath(root, `pi/vendor-tools/bin/${tool}`);
    await fs.access(binary, fs.constants.X_OK);
  }
  const app = await readRegularJson(path.join(ompPackageRoot, "package.json"));
  const pi = await readRegularJson(path.join(root, "pi/package.json"));
  requireThat(app.name === "only-my-pi" && app.version === manifest.version && pi.version === CONTROLLED_PI_VERSION
    && pi.name === "@earendil-works/pi-coding-agent", "application or Pi version differs");
  const installation = await readRegularJson(path.join(root, "../distribution-installation.json"), { optional: true });
  const channel = installation?.channel ?? "npm";
  requireThat(["npm", "homebrew", "docker", "archive"].includes(channel)
    && (!installation || (installation.formatVersion === 1 && installation.version === manifest.version)), "invalid installation context");
  return Object.freeze({ root, stackId: manifest.distributionId, distribution: manifest, channel,
    nodePath: await fs.realpath(nodePath), ompPackageRoot,
    ompCliPath: await containedPath(root, "only-my-pi/package/bin/omp.mjs"),
    piCliPath: await containedPath(root, "pi/dist/bundle/cli.js"),
  });
}

export async function resolveDistributionPackage(distribution, packageId) {
  const entry = distribution.distribution.packages.find((item) => item.id === packageId);
  requireThat(entry, `no packaged binding exists for ${packageId}`);
  const root = await containedPath(distribution.root, entry.path, { directory: true });
  if (await hashDistributionTree(distribution.root, entry.path) !== entry.treeDigest)
    throw distributionError("RUNTIME_PACKAGE_DRIFT", `${entry.name} differs from its distribution binding`);
  const manifest = await readRegularJson(path.join(root, "package.json"));
  requireThat(manifest.name === entry.name && manifest.version === entry.version, "packaged dependency identity differs");
  return Object.freeze({ root, manifest, binding: Object.freeze({ id: entry.id, name: entry.name,
    resolvedVersion: entry.version, binding: "distribution", owner: distribution.channel,
    resourceFilter: entry.resourceFilter, physicalRootDigest: entry.treeDigest }) });
}

export { loadIntrinsicDistribution } from "./intrinsic.mjs";
