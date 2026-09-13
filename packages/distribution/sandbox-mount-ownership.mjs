import fs from "node:fs";
import path from "node:path";

// Shared by the native ESM sandbox and the TS permission adapter in one process.
const key = Symbol.for("only-my-pi:sandbox-mount-ownership:v1");
const state = globalThis[key] ??= { active: 0, owned: new Map() };
const stat = (filename) => {
  try { return fs.lstatSync(filename, { bigint: true }); }
  catch (error) { if (["ENOENT", "ENOTDIR"].includes(error.code)) return null; throw error; }
};

export function cleanupOwnedSandboxMountPoints() {
  if (state.active !== 0) return;
  for (const [filename, original] of [...state.owned].sort(([a], [b]) => b.length - a.length)) {
    try {
      const current = stat(filename);
      if (!current || current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino
        || current.mode !== original.mode) continue;
      if (current.isFile() && current.size === 0n && current.mtimeNs === original.mtimeNs && current.ctimeNs === original.ctimeNs)
        fs.unlinkSync(filename);
      else if (current.isDirectory() && fs.readdirSync(filename).length === 0) fs.rmdirSync(filename);
    } catch { /* Preserve anything we cannot safely identify and remove. */ }
  }
  state.owned.clear();
}

export function beginSandboxMountLease() {
  state.active++;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    state.active--;
    cleanupOwnedSandboxMountPoints();
  };
}

/** Reserve only missing mountpoints in the already-generated bwrap argument
 * list. Exclusive creation proves ownership; pre-existing empty files are never
 * ours. All overlapping commands must finish before any mountpoint is removed. */
export function reserveSandboxMountPoints(args) {
  if (state.active < 1) throw new Error("Linux sandbox requires a mount ownership lease");
  const end = args.indexOf("--");
  const options = end < 0 ? args : args.slice(0, end);
  const writable = [];
  for (let i = 0; i < options.length; i++) {
    if (options[i] !== "--bind" || options[i + 1] !== options[i + 2]) continue;
    const directory = options[i + 1];
    if (path.isAbsolute(directory) && stat(directory)?.isDirectory()) writable.push(fs.realpathSync(directory));
  }
  for (let i = 0; i < options.length; i++) {
    const directory = options[i] === "--tmpfs";
    const file = options[i] === "--ro-bind" && options[i + 1] === "/dev/null";
    if (!directory && !file) continue;
    const target = options[i + (directory ? 1 : 2)];
    if (typeof target !== "string" || !path.isAbsolute(target) || stat(target)) continue;
    const parent = path.dirname(target);
    if (!stat(parent)?.isDirectory() || fs.realpathSync(parent) !== parent
      || !writable.some((root) => parent === root || parent.startsWith(`${root}${path.sep}`))) continue;
    try {
      if (directory) fs.mkdirSync(target, { mode: 0o700 });
      else fs.closeSync(fs.openSync(target, "wx", 0o600));
      state.owned.set(target, stat(target));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
