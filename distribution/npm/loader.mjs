#!/usr/bin/env node
// Copied into the public CLI package together with the dependency-free tree
// verifier. Do not import code from a platform payload before checking it.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashResourcePath } from "./resource-hash.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function fail(message) { throw new Error(`only-my-pi: ${message}`); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
async function json(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) fail("unsafe package metadata");
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

export async function locateRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) fail("Node >=22.19.0 is required");
  const descriptor = await json(path.join(here, "runtime-packages.json"));
  const target = `${process.platform}-${process.arch}`;
  const expected = descriptor.platforms[target];
  if (!expected || (process.platform === "darwin" && Number.parseInt(os.release(), 10) < 23)
    || (process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime)) fail(`unsupported platform: ${target}`);
  let metadata;
  try { metadata = createRequire(import.meta.url).resolve(`${expected.name}/package.json`); }
  catch { fail("the platform runtime package is missing; reinstall with optional dependencies enabled"); }
  const packageManifest = await json(metadata);
  if (packageManifest.name !== expected.name || packageManifest.version !== descriptor.version) fail("platform package version mismatch");
  const root = await fs.realpath(path.join(path.dirname(metadata), "runtime"));
  const manifest = await json(path.join(root, "distribution-manifest.json"));
  const { distributionId, ...identity } = manifest;
  const calculated = `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(identity))).digest("hex")}`;
  if (distributionId !== expected.distributionId || calculated !== distributionId || manifest.version !== descriptor.version
    || manifest.platform.os !== process.platform || manifest.platform.arch !== process.arch) fail("runtime identity differs from the CLI release");
  const paths = { app: "only-my-pi/package", pi: "pi", external: "external-npm" };
  for (const [id, relative] of Object.entries(paths)) {
    if (manifest.components[id]?.path !== relative) fail("invalid runtime component path");
    const hash = `sha256:${await hashResourcePath({ artifactRoot: root, relativePath: relative, allowContainedSymlinks: true })}`;
    if (hash !== manifest.components[id].treeDigest) fail(`${id} runtime content is damaged`);
  }
  return { root, packageRoot: path.join(root, paths.app) };
}

export async function main(argv = process.argv.slice(2)) {
  const runtime = await locateRuntime();
  if (argv.length === 1 && argv[0] === "--verify-install") {
    const { requireSystemDependencies } = await import(pathToFileURL(path.join(runtime.packageRoot, "packages/distribution/system-dependencies.mjs")).href);
    await requireSystemDependencies();
    return 0;
  }
  const { runOmpEntrypoint } = await import(pathToFileURL(path.join(runtime.packageRoot, "bin/omp.mjs")).href);
  return runOmpEntrypoint({ argv, rootDir: runtime.packageRoot });
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
