import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";
import { hashResourcePath } from "../bootstrap/resource-hash.mjs";

const execFile = promisify(callback);
async function digest(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}
async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/** Install a verified archive into an explicitly selected, previously absent
 * directory. Never changes PATH, command links, a legacy stack or user data. */
export async function installDistributionArchive({ archiveRoot, prefix, nodeRoot }) {
  if (!path.isAbsolute(prefix ?? "") || /[\0\r\n]/u.test(prefix) || path.resolve(prefix) === path.parse(prefix).root)
    throw new Error("--prefix must name a new absolute installation directory");
  const manifest = JSON.parse(await fs.readFile(path.join(archiveRoot, "archive-manifest.json"), "utf8"));
  if (manifest.formatVersion !== 1 || manifest.kind !== "only-my-pi-native-archive"
    || manifest.platform !== `${process.platform}-${process.arch}` || !["full", "thin"].includes(manifest.mode)
    || !/^sha256:[a-f0-9]{64}$/u.test(manifest.distributionId ?? "")
    || !/^0\.4\.0-preview\.[12]$/u.test(manifest.version ?? "") || !/^[a-f0-9]{40}$/u.test(manifest.sourceCommit ?? ""))
    throw new Error("archive metadata or platform is invalid");
  const nodeReal = await fs.realpath(nodeRoot);
  if (`sha256:${await hashResourcePath({ artifactRoot: path.dirname(nodeReal), relativePath: path.basename(nodeReal), allowContainedSymlinks: true })}` !== manifest.node.treeDigest)
    throw new Error("Node payload differs from the archive identity");
  const names = ["only-my-pi", `only-my-pi-runtime-${manifest.platform}`];
  if (!Array.isArray(manifest.packages) || manifest.packages.length !== names.length) throw new Error("archive package set is invalid");
  for (const name of names) {
    const item = manifest.packages.find((entry) => entry.name === name);
    if (!item || item.filename !== `${name}-${manifest.version}.tgz`
      || await digest(path.join(archiveRoot, item.filename)) !== item.sha256)
      throw new Error("archive package checksum differs");
  }
  // Only the explicit prefix's parent may be created. Resolve existing aliases
  // before deriving staging paths; an existing prefix, even a symlink, is refused.
  if (await exists(prefix)) throw new Error("installation prefix already exists; choose a new directory");
  await fs.mkdir(path.dirname(prefix), { recursive: true });
  const parent = await fs.realpath(path.dirname(prefix));
  const target = path.join(parent, path.basename(prefix));
  const stage = await fs.mkdtemp(path.join(parent, ".omp-install-"));
  let published = false;
  try {
    const modules = path.join(stage, "lib/node_modules");
    await fs.mkdir(modules, { recursive: true });
    for (const item of manifest.packages) {
      const destination = path.join(modules, item.name);
      await fs.mkdir(destination);
      await execFile("/usr/bin/tar", ["-xzf", path.join(archiveRoot, item.filename), "-C", destination, "--strip-components", "1"]);
    }
    await fs.cp(nodeReal, path.join(stage, "node"), { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    const cli = path.join(modules, "only-my-pi");
    const helper = path.join(modules, names[1]);
    const descriptor = JSON.parse(await fs.readFile(path.join(cli, "runtime-packages.json"), "utf8"));
    if (descriptor.version !== manifest.version || descriptor.sourceCommit !== manifest.sourceCommit
      || descriptor.platforms[manifest.platform]?.distributionId !== manifest.distributionId)
      throw new Error("archive and public CLI identities differ");
    await fs.writeFile(path.join(helper, "distribution-installation.json"), JSON.stringify({ formatVersion: 1, channel: "archive", version: manifest.version }));
    const launcher = '#!/bin/sh\nOMP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport PATH="$OMP_ROOT/node/bin:$PATH"\nexec "$OMP_ROOT/node/bin/node" "$OMP_ROOT/lib/node_modules/only-my-pi/loader.mjs" "$@"\n';
    await fs.mkdir(path.join(stage, "bin"));
    await fs.writeFile(path.join(stage, "bin/omp"), launcher, { mode: 0o755 });
    await execFile(path.join(stage, "node/bin/node"), [path.join(cli, "loader.mjs"), "--verify-install"], {
      env: { HOME: stage, PATH: `${stage}/node/bin:/usr/bin:/bin` }, timeout: 60_000 });
    await fs.writeFile(path.join(stage, ".omp-archive-installation.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    if (await exists(target)) throw new Error("installation prefix appeared during staging; nothing was overwritten");
    await fs.rename(stage, target);
    published = true;
    return { ok: true, status: "ARCHIVE_INSTALLED", prefix: target, version: manifest.version,
      distributionId: manifest.distributionId, command: path.join(target, "bin/omp"), userDataChanged: false };
  } finally { if (!published) await fs.rm(stage, { recursive: true, force: true }); }
}
