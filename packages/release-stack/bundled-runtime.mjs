import { execFile as callback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(callback);
const MAX_OUTPUT = 16 * 1024 * 1024;

// Shared scripts-disabled native runtime checks. This module has no dependency
// on legacy release generation, acquisition or publication control planes.
export function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

export async function runNode(node, argv, options = {}) {
  try {
    return await execFile(node, argv, { cwd: options.cwd, env: options.env, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: MAX_OUTPUT });
  } catch (cause) {
    fail("RELEASE_STAGE_COMMAND_FAILED", "scripts-disabled release staging command failed", { cause, step: argv[1] ?? "unknown" });
  }
}

export async function boundedFile(target, code, maxBytes = 512 * 1024 * 1024) {
  const stat = await fs.lstat(target).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxBytes) fail(code, `release staging file is unsafe: ${path.basename(target)}`);
  return target;
}

export async function prepareBundledPty(packageRoot) {
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (!manifest.dependencies?.["node-pty"]) return;
  // The scripts-disabled, darwin-arm64 release must not rely on postinstall
  // chmod. Normalize only the staged artifact, before hashing and repacking it.
  const dependency = path.join(packageRoot, "node_modules/node-pty");
  const helper = path.join(dependency, "prebuilds/darwin-arm64/spawn-helper");
  const metadata = path.join(dependency, "package.json");
  for (const file of [metadata, helper]) {
    if (await fs.realpath(file) !== path.resolve(file)) fail("RELEASE_PTY_LAYOUT_INVALID", "PTY artifact contains a redirected path");
    await boundedFile(file, "RELEASE_PTY_LAYOUT_INVALID", 4 * 1024 * 1024);
  }
  const installed = JSON.parse(await fs.readFile(metadata, "utf8"));
  if (manifest.dependencies["node-pty"] !== "1.1.0" || installed.name !== "node-pty" || installed.version !== "1.1.0") fail("RELEASE_PTY_VERSION_INVALID", "PTY version must match the reviewed native dependency");
  await fs.chmod(helper, 0o755);
}

export async function verifyBundledRuntime({ packageRoot, node, env, run = runNode }) {
  // Exercise the extracted artifact, never the checkout's dependency graph.
  await run(node, ["--input-type=module", "-e", `
    import { createRequire } from "node:module";
    import path from "node:path";
    const root = process.cwd();
    const require = createRequire(path.join(root, "package.json"));
    const manifest = require("./package.json");
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const relative = path.relative(root, require.resolve(name));
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Bundled dependency escaped artifact");
      require(name);
    }
    if (manifest.dependencies?.["node-pty"]) {
      const pty = require("node-pty");
      await new Promise((resolve, reject) => {
        const child = pty.spawn("/bin/sh", ["-c", "printf OMP_PTY_READY"], {
          name: "xterm-256color", cols: 80, rows: 24, cwd: root,
          env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }
        });
        let output = "";
        const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("PTY smoke timed out")); }, 5000);
        child.onData(data => { output = (output + data).slice(-1024); });
        child.onExit(({ exitCode, signal }) => {
          clearTimeout(timeout);
          if (exitCode !== 0 || signal || !output.includes("OMP_PTY_READY")) reject(new Error("PTY smoke failed"));
          else resolve();
        });
      });
    }
  `], { cwd: packageRoot, env });
}

