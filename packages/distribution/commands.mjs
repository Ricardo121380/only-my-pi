import fs from "node:fs/promises";
import path from "node:path";
import { DirectAgentDoctor } from "../direct-agent/doctor.mjs";
import { resolveDirectConfigRoot } from "../direct-agent/launcher.mjs";
import { distributionError } from "./runtime.mjs";
import { migrateLegacy } from "./migrate.mjs";

const GUIDANCE = Object.freeze({
  npm: { update: "npm install -g only-my-pi@latest", uninstall: "npm uninstall -g only-my-pi" },
  homebrew: { update: "brew upgrade ricardo121380/tap/only-my-pi", uninstall: "brew uninstall only-my-pi" },
  docker: { update: "docker pull ghcr.io/ricardo121380/only-my-pi:latest", uninstall: "Remove the OMP container; retain the configuration volume." },
  archive: { update: "Install the verified archive for the desired version.", uninstall: "Use the archive ownership record to remove only its installation." },
});

export async function inspectCommandPaths({ env = process.env, homeDir, runtime }) {
  const entries = [];
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter((value) => path.isAbsolute(value))) {
    const filename = path.join(directory, "omp");
    const stat = await fs.stat(filename).catch((error) => {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return null;
      throw error;
    });
    if (!stat?.isFile() || (stat.mode & 0o111) === 0) continue;
    const target = await fs.realpath(filename);
    if (entries.some((entry) => entry.path === filename)) continue;
    entries.push({ path: filename, target,
      legacy: target.startsWith(path.join(homeDir, ".local/share/only-my-pi/stacks") + path.sep),
      current: target.startsWith(`${path.resolve(runtime.root, "../..", "only-my-pi")}${path.sep}`) || target === runtime.ompCliPath });
  }
  return { entries, legacyShadowsCurrent: entries[0]?.legacy === true,
    multipleEntries: new Set(entries.map((entry) => entry.target)).size > 1 };
}

export function distributionVersion(runtime, env = process.env) {
  return { formatVersion: 1, ok: true, status: "DISTRIBUTION_READY", mutation: false,
    packageVersion: runtime.distribution.version, sourceCommit: runtime.distribution.sourceCommit,
    distributionId: runtime.stackId, piVersion: "0.84.3", nodeVersion: process.versions.node,
    installation: { channel: runtime.channel, platform: runtime.distribution.platform,
      runtimeRoot: runtime.root, ephemeral: runtime.channel === "npm" && env.npm_command === "exec" } };
}

export async function handleDistributionCommand({ runtime, argv, env = process.env, homeDir, execve = process.execve }) {
  const [command, ...args] = argv;
  const configRoot = resolveDirectConfigRoot({ env, homeDir });
  if (command === "migrate") return { handled: true, result: await migrateLegacy({ runtime, argv: args, env, homeDir, inspectPaths: inspectCommandPaths }) };
  if (command === "pi") {
    const childEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) => !key.startsWith("ONLY_MY_PI_") && typeof value === "string"));
    if (typeof execve !== "function") throw distributionError("OMP_EXECVE_UNAVAILABLE", "this Node runtime does not support process.execve");
    execve(runtime.nodePath, [runtime.nodePath, runtime.piCliPath, ...args], { ...childEnv,
      PATH: `${path.join(runtime.root, "pi/vendor-tools/bin")}${path.delimiter}${env.PATH ?? "/usr/bin:/bin"}`,
      PI_CODING_AGENT_DIR: configRoot });
    throw distributionError("OMP_EXECVE_RETURNED", "raw Pi process replacement unexpectedly returned");
  }
  if (["version", "doctor", "status"].includes(command) || (command === "stack" && args[0] === "status")) {
    const flags = command === "stack" ? args.slice(1) : args;
    if (flags.some((flag) => flag !== "--json") || new Set(flags).size !== flags.length)
      throw distributionError("INVALID_ARGUMENT", `${command} accepts only --json in a package-managed installation`);
    const version = distributionVersion(runtime, env);
    if (command !== "doctor") return { handled: true, result: version };
    const doctor = new DirectAgentDoctor({ rootDir: runtime.ompPackageRoot, configRoot,
      homeDir, stackRoot: runtime.root, resolveStack: async () => runtime });
    const readiness = await doctor.inspect();
    return { handled: true, result: { ...version, ok: readiness.ok, status: readiness.status,
      readiness, commandPaths: await inspectCommandPaths({ env, homeDir, runtime }),
      modelSetup: "omp admin pi", next: readiness.ok ? "Run omp; configure model authentication through omp admin pi when needed." : "Inspect the failed readiness components." } };
  }
  if (["bootstrap", "install", "update", "uninstall", "rollback", "stack", "upstream"].includes(command)
    || (command === "profiles" && args[0] === "apply")) {
    const operation = command === "uninstall" || args[0] === "remove" ? "uninstall" : "update";
    return { handled: true, result: { ok: false, status: "PACKAGE_MANAGER_OWNS_INSTALLATION", mutation: false,
      installation: { channel: runtime.channel }, next: GUIDANCE[runtime.channel][operation],
      message: "Use this installation's distribution channel. OMP will not modify another package manager's files." } };
  }
  return { handled: false };
}
