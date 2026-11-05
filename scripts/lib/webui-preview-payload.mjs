import fs from "node:fs/promises";
import path from "node:path";

// Source and regression evidence stay in Git. Only their portable-package
// copies are omitted, after the frontend and dependency notices are built.
export const WEBUI_SOURCE_ONLY = Object.freeze([
  ".github", "codex", "docs", "legacy", "prototypes", "tests", "verification", "webui",
]);

export async function omitWebPreviewSource(app) {
  if (!path.isAbsolute(app)) throw new Error("Use an absolute staged application directory");
  const omitted = { files: 0, bytes: 0, paths: [] };
  async function count(directory) {
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) await count(file);
      else { omitted.files++; omitted.bytes += (await fs.lstat(file)).size; }
    }
  }
  for (const name of WEBUI_SOURCE_ONLY) {
    const directory = path.join(app, name);
    const stat = await fs.lstat(directory).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unexpected source directory: ${name}`);
    await count(directory);
    await fs.rm(directory, { recursive: true });
    omitted.paths.push(name);
  }
  return omitted;
}
