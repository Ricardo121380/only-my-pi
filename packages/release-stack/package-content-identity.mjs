import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

async function hashEntry(absolutePath, relativePath, hash, realRoot) {
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    const realTarget = await fs.realpath(absolutePath).catch(() => null);
    if (!realTarget || (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`))) {
      fail("PACKAGE_CONTENT_SYMLINK_UNSAFE", `package content symlink escapes its root: ${relativePath}`);
    }
    hash.update("L\0");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await fs.readlink(absolutePath));
    hash.update("\0");
    return;
  }
  if (stat.isDirectory()) {
    hash.update("D\0");
    hash.update(relativePath);
    hash.update("\0");
    const names = (await fs.readdir(absolutePath)).sort();
    for (const name of names) {
      if (relativePath === "." && name === "node_modules") {
        const dependencyRoot = path.join(absolutePath, name);
        const dependencyStat = await fs.lstat(dependencyRoot);
        if (!dependencyStat.isDirectory() || dependencyStat.isSymbolicLink()) {
          fail("PACKAGE_DEPENDENCY_ROOT_UNSAFE", "package dependency root must be a real directory");
        }
        continue;
      }
      await hashEntry(path.join(absolutePath, name), relativePath === "." ? name : `${relativePath}/${name}`, hash, realRoot);
    }
    return;
  }
  if (!stat.isFile()) fail("PACKAGE_CONTENT_TYPE_UNSUPPORTED", `package content contains an unsupported entry: ${relativePath}`);
  const bytes = await fs.readFile(absolutePath);
  hash.update("F\0");
  hash.update(relativePath);
  hash.update("\0");
  hash.update(String(bytes.length));
  hash.update("\0");
  hash.update(bytes);
  hash.update("\0");
}

export async function hashPackageContentTree(packageRoot) {
  if (typeof packageRoot !== "string" || !path.isAbsolute(packageRoot)) throw new TypeError("package content root must be an absolute path");
  const requestedRoot = path.resolve(packageRoot);
  const stat = await fs.lstat(requestedRoot).catch(() => null);
  const realRoot = stat ? await fs.realpath(requestedRoot).catch(() => null) : null;
  if (!stat?.isDirectory() || stat.isSymbolicLink() || !realRoot) fail("PACKAGE_CONTENT_ROOT_UNSAFE", "package content root must be a real directory");
  const root = realRoot;
  const manifestStat = await fs.lstat(path.join(root, "package.json")).catch(() => null);
  if (!manifestStat?.isFile() || manifestStat.isSymbolicLink()) fail("PACKAGE_CONTENT_MANIFEST_UNSAFE", "package content requires a real package.json");
  const hash = crypto.createHash("sha256");
  await hashEntry(root, ".", hash, realRoot);
  return `sha256:${hash.digest("hex")}`;
}
