import fs from "node:fs/promises";
import path from "node:path";
import { execFile as callback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(callback);
const GUIDANCE = "Install Git before using npm/npx or archive installations; Homebrew supplies Git automatically. On macOS, install Git with Homebrew or install Apple's Command Line Tools, then retry.";

export async function inspectSystemDependencies({ env = process.env, platform = process.platform,
  cwd = process.cwd(), run = execFile } = {}) {
  const missing = (reason) => ({ ok: false, status: "SYSTEM_DEPENDENCIES_MISSING", git: { ok: false, reason }, next: GUIDANCE });
  let git;
  for (const directory of (env.PATH ?? "/usr/bin:/bin").split(path.delimiter)) {
    const candidate = path.resolve(cwd, directory, "git");
    const stat = await fs.stat(candidate).catch((error) => {
      if (["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) return null;
      throw error;
    });
    if (!stat?.isFile() || (stat.mode & 0o111) === 0) continue;
    if (!path.isAbsolute(directory)) return missing("GIT_ON_RELATIVE_PATH");
    git = await fs.realpath(candidate);
    break;
  }
  if (!git) return missing("GIT_NOT_FOUND");
  try {
    // /usr/bin/git is an installer shim on a clean Mac. xcode-select -p does
    // not open the developer-tools installation dialog.
    if (platform === "darwin" && git === "/usr/bin/git") {
      const selected = await run("/usr/bin/xcode-select", ["-p"], { env, timeout: 5000, maxBuffer: 4096 });
      const directory = selected.stdout.trim();
      if (!path.isAbsolute(directory) || !(await fs.stat(directory)).isDirectory()) return missing("APPLE_GIT_UNAVAILABLE");
      git = await fs.realpath(path.join(directory, "usr/bin/git"));
      await fs.access(git, fs.constants.X_OK);
    }
    const { stdout } = await run(git, ["--version"], { env: { ...env, GIT_TERMINAL_PROMPT: "0" }, cwd, timeout: 5000, maxBuffer: 4096 });
    const version = /^git version ([0-9]+\.[0-9]+[^\r\n]*)\s*$/u.exec(stdout)?.[1];
    if (!version) return missing("GIT_VERSION_INVALID");
    return { ok: true, status: "SYSTEM_DEPENDENCIES_READY", git: { ok: true, path: git, version } };
  } catch { return missing("GIT_UNAVAILABLE"); }
}

export async function requireSystemDependencies(options) {
  const result = await inspectSystemDependencies(options);
  if (!result.ok) throw Object.assign(new Error(`${result.git.reason}: ${result.next}`), { code: "SYSTEM_DEPENDENCIES_MISSING" });
  return result;
}
