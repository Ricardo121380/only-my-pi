import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hostError } from "./contracts.mjs";
const exec = promisify(execFile);
const excluded = (name) => [".git", "node_modules", ".ssh", ".npmrc", "auth.json"].includes(name) || name === ".env" || name.startsWith(".env.") || /\.(pem|key)$/iu.test(name);
export async function projectPath(project, relative = "") {
  if (typeof relative !== "string" || relative.length > 4096 || path.isAbsolute(relative) || /[\\\0\r\n]/u.test(relative) || relative.split("/").some((p) => p === ".." || excluded(p))) throw hostError("FILE_PATH_DENIED", 403);
  const root = await fs.realpath(project.path);
  if (root !== project.path) throw hostError("PROJECT_PATH_CHANGED", 409);
  let target = root;
  for (const part of relative.split("/").filter(Boolean)) {
    target = path.join(target, part);
    if ((await fs.lstat(target)).isSymbolicLink()) throw hostError("FILE_SYMLINK_DENIED", 403);
  }
  const real = await fs.realpath(target);
  if (real !== root && !real.startsWith(root + path.sep)) throw hostError("FILE_PATH_DENIED", 403);
  return real;
}
export async function listFiles(project, relative = "") {
  const target = await projectPath(project, relative);
  const entries = await fs.readdir(target, { withFileTypes: true });
  return { entries: entries.filter((e) => !excluded(e.name) && !e.isSymbolicLink() && (e.isDirectory() || e.isFile())).slice(0, 1000)
    .map((e) => ({ name: e.name, path: relative ? `${relative}/${e.name}` : e.name, directory: e.isDirectory() })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)), truncated: entries.length > 1000 };
}
export async function readFile(project, relative) {
  const target = await projectPath(project, relative);
  const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 512 * 1024) throw hostError("FILE_PREVIEW_LIMIT", 413);
    const bytes = await handle.readFile();
    if (bytes.includes(0)) throw hostError("BINARY_PREVIEW_UNAVAILABLE", 415);
    return { path: relative, text: bytes.toString("utf8"), bytes: bytes.length };
  } finally { await handle.close(); }
}
export async function gitDiff(project) {
  const cwd = await projectPath(project);
  const options = { cwd, env: { PATH: "/usr/bin:/bin", HOME: "/var/empty", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" }, timeout: 5000, maxBuffer: 1024 * 1024 };
  const common = ["--no-pager", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null"];
  let keys = "";
  try { keys = (await exec("/usr/bin/git", [...common, "config", "--local", "--name-only", "--null", "--get-regexp", "^filter\\."], options)).stdout; }
  catch (error) { if (error.code !== 1) return { text: "", available: false, code: "GIT_DIFF_UNAVAILABLE" }; }
  const overrides = keys.split("\0").filter((key) => /^filter\..+\.(clean|smudge|process|required)$/iu.test(key) && !/[\r\n]/u.test(key)).flatMap((key) => ["-c", `${key}=${key.endsWith(".required") ? "false" : ""}`]);
  try {
    const [unstaged, staged] = await Promise.all([
      exec("/usr/bin/git", [...common, ...overrides, "diff", "--no-ext-diff", "--no-textconv", "--"], options),
      exec("/usr/bin/git", [...common, ...overrides, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--"], options),
    ]);
    return { available: true, text: `${staged.stdout}${unstaged.stdout}`.slice(0, 1024 * 1024), truncated: staged.stdout.length + unstaged.stdout.length > 1024 * 1024 };
  } catch { return { available: false, text: "", code: "GIT_DIFF_UNAVAILABLE_OR_TOO_LARGE" }; }
}
