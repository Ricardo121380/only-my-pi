import fs from "node:fs/promises";
import path from "node:path";

import { loadSettings } from "../config-runtime/index.mjs";
import { extractManagedMetadata } from "../bootstrap/settings-merge.mjs";

async function readJson(target, { missing = null } = {}) {
  try {
    const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) return missing;
    return JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return missing;
    throw error;
  }
}

async function executableOnPath(name, env) {
  for (const directory of String(env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isFile() || stat.isSymbolicLink()) return await fs.realpath(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return null;
}

async function packageVersionForExecutable(executable, expectedName) {
  if (executable === null) return null;
  let directory = path.dirname(executable);
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = await readJson(path.join(directory, "package.json"));
    if (manifest?.name === expectedName && typeof manifest.version === "string") return manifest.version;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

export class VersionService {
  constructor({ rootDir, configRoot, userCli, env = process.env } = {}) {
    if (typeof rootDir !== "string" || !path.isAbsolute(rootDir)) throw new TypeError("VersionService requires an absolute rootDir");
    if (typeof configRoot !== "string" || !path.isAbsolute(configRoot)) throw new TypeError("VersionService requires an absolute configRoot");
    if (!userCli || typeof userCli.inspectActive !== "function") throw new TypeError("VersionService requires a user CLI inspector");
    this.rootDir = path.resolve(rootDir);
    this.configRoot = path.resolve(configRoot);
    this.userCli = userCli;
    this.env = env;
  }

  async inspect() {
    const [packageManifest, decisionContract, settings, activeCli, piExecutable] = await Promise.all([
      readJson(path.join(this.rootDir, "package.json")),
      readJson(path.join(this.rootDir, "contracts", "compatibility", "upstream-candidates.json")),
      loadSettings(this.configRoot),
      this.userCli.inspectActive(),
      executableOnPath("pi", this.env),
    ]);
    const metadata = extractManagedMetadata(settings.settings);
    const subagents = metadata?.packageBindings?.find((entry) => entry.id === "subagents") ?? null;
    const piVersion = await packageVersionForExecutable(piExecutable, "@earendil-works/pi-coding-agent");
    const cliGeneration = activeCli?.manifest.installedGenerationId ?? null;
    const installedGenerationId = metadata?.generationId ?? null;
    const consistent = activeCli === null || cliGeneration === installedGenerationId;
    return Object.freeze({
      formatVersion: 1,
      packageVersion: packageManifest?.version ?? null,
      sourceCommit: activeCli?.manifest.sourceCommit ?? null,
      artifactSha256: activeCli?.manifest.artifactSha256 ?? null,
      cliRoot: activeCli ? "USER_LOCAL_IMMUTABLE_ARTIFACT" : "NOT_INSTALLED",
      installedGenerationId,
      piVersion,
      subagentsVersion: subagents?.resolvedVersion ?? null,
      decision: decisionContract?.decision?.state ?? null,
      ok: consistent,
      status: consistent ? "VERSION_IDENTITY" : "CLI_GENERATION_IDENTITY_DRIFT",
    });
  }
}

export function createVersionService(options) {
  return new VersionService(options);
}
