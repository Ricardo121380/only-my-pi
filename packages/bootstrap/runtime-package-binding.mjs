import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { hashResourcePath } from "./graph-plan.mjs";
import { loadIntrinsicDistribution, resolveDistributionPackage } from "../distribution/runtime.mjs";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function contained(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("RUNTIME_PATH_ESCAPE", "runtime path escapes its root");
  }
  return resolvedTarget;
}

async function readJsonNoFollow(filename, { missing = null } = {}) {
  let handle;
  try {
    handle = await fs.open(filename, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) {
      fail("RUNTIME_FILE_UNSAFE", `${path.basename(filename)} must be a bounded regular file`);
    }
    return JSON.parse((await handle.readFile()).toString("utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return missing;
    if (cause instanceof SyntaxError) fail("RUNTIME_FILE_INVALID", `${path.basename(filename)} is not valid JSON`);
    if (["ELOOP", "EMLINK"].includes(cause?.code)) fail("RUNTIME_FILE_UNSAFE", `${path.basename(filename)} may not be a symlink`);
    throw cause;
  } finally {
    await handle?.close().catch(() => {});
  }
}

function packageSettingSource(value) {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && !Array.isArray(value) && typeof value.source === "string"
    ? value.source
    : null;
}

async function assertPackageRoot(configRoot, packageRoot, expectedName, expectedVersion) {
  contained(configRoot, packageRoot);
  const stat = await fs.lstat(packageRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("RUNTIME_PACKAGE_UNSAFE", `${expectedName} root must be a real directory`);
  }
  const manifest = await readJsonNoFollow(path.join(packageRoot, "package.json"));
  if (manifest?.name !== expectedName || manifest?.version !== expectedVersion) {
    fail("RUNTIME_PACKAGE_DRIFT", `${expectedName} identity drifted from its binding`);
  }
  return { root: packageRoot, manifest };
}

/**
 * Resolve one installed package only through the package binding recorded by
 * the active only-my-pi generation. External package trees are re-hashed on
 * every resolution; a mutable settings entry or package root is never trusted
 * on name alone.
 */
export async function resolveBoundPackageRoot({ configRoot, packageId } = {}) {
  if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) {
    throw new TypeError("resolveBoundPackageRoot requires absolute configRoot");
  }
  if (typeof packageId !== "string" || packageId.length === 0) {
    throw new TypeError("resolveBoundPackageRoot requires packageId");
  }

  const distribution = await loadIntrinsicDistribution();
  if (distribution) return resolveDistributionPackage(distribution, packageId);
  const root = path.resolve(configRoot);
  const rootStat = await fs.lstat(root).catch((cause) => {
    if (cause?.code === "ENOENT") fail("RUNTIME_PACKAGE_BINDING_MISSING", "Pi config root is unavailable");
    throw cause;
  });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("RUNTIME_PACKAGE_UNSAFE", "Pi config root must be a real directory");
  }
  const settings = await readJsonNoFollow(path.join(root, "settings.json"));
  const binding = settings?.onlyMyPi?.packageBindings?.find((entry) => entry.id === packageId);
  if (!binding) fail("RUNTIME_PACKAGE_BINDING_MISSING", `no installed binding exists for ${packageId}`);
  if (typeof binding.name !== "string" || typeof binding.resolvedVersion !== "string") {
    fail("RUNTIME_PACKAGE_BINDING_INVALID", `package binding is incomplete for ${packageId}`);
  }

  if (binding.binding === "external") {
    if (binding.owner !== "user" || typeof binding.physicalRootDigest !== "string") {
      fail("RUNTIME_PACKAGE_BINDING_INVALID", `external package binding is incomplete for ${packageId}`);
    }
    const npmRoot = path.join(root, "npm");
    const relativePackagePath = `node_modules/${binding.name}`;
    const result = await assertPackageRoot(
      root,
      path.join(npmRoot, ...relativePackagePath.split("/")),
      binding.name,
      binding.resolvedVersion,
    );
    const digest = `sha256:${await hashResourcePath({
      artifactRoot: npmRoot,
      relativePath: relativePackagePath,
      allowContainedSymlinks: true,
    })}`;
    if (digest !== binding.physicalRootDigest) {
      fail("RUNTIME_PACKAGE_DRIFT", `${binding.name} physical tree differs from its installed binding`);
    }
    return Object.freeze({ ...result, binding: Object.freeze(structuredClone(binding)) });
  }

  if (binding.binding !== "managed") {
    fail("RUNTIME_PACKAGE_BINDING_INVALID", `unknown binding kind for ${packageId}`);
  }
  const managed = settings.onlyMyPi.managedSettings?.packages ?? [];
  for (const setting of managed) {
    const source = packageSettingSource(setting);
    if (typeof source !== "string" || !source.startsWith("./only-my-pi/generations/")) continue;
    const target = contained(root, path.resolve(root, source.slice(2)));
    const manifest = await readJsonNoFollow(path.join(target, "package.json"), { missing: null });
    if (manifest?.name === binding.name) {
      const result = await assertPackageRoot(root, target, binding.name, binding.resolvedVersion);
      return Object.freeze({ ...result, binding: Object.freeze(structuredClone(binding)) });
    }
  }
  fail("RUNTIME_PACKAGE_BINDING_MISSING", `managed package root is unavailable for ${packageId}`);
}
