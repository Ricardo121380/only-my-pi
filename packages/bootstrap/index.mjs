import fs from "node:fs/promises";
import path from "node:path";

import {
  planOwnedGraph,
} from "./graph-plan.mjs";
import {
  stageAndPromoteGeneration,
} from "./npm-stager.mjs";
import {
  compileGenerationSettings,
} from "./settings-compiler.mjs";

export * from "./graph-plan.mjs";
export * from "./npm-stager.mjs";
export * from "./settings-compiler.mjs";
export * from "./package-bindings.mjs";
export * from "./user-cli-installer.mjs";

const SAFE_PROFILE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

async function readJson(target, root) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new TypeError(`bootstrap input must be a real JSON file: ${path.basename(target)}`);
  const realTarget = await fs.realpath(target);
  if (realTarget !== root && !realTarget.startsWith(`${root}${path.sep}`)) {
    throw new TypeError(`bootstrap input escapes rootDir: ${path.basename(target)}`);
  }
  return JSON.parse(await fs.readFile(target, "utf8"));
}

/** Repository-oriented convenience wrapper used by the bootstrap service. */
export async function buildGenerationPlan({ rootDir, profileId, sourceCommit } = {}) {
  if (typeof profileId !== "string" || !SAFE_PROFILE_ID.test(profileId)) {
    throw new TypeError("profileId must be a canonical lower-case id");
  }
  if (sourceCommit !== undefined && (typeof sourceCommit !== "string" || !COMMIT_SHA.test(sourceCommit))) {
    throw new TypeError("sourceCommit must be a full lower-case Git commit SHA");
  }
  if (typeof rootDir !== "string" || rootDir.length === 0) throw new TypeError("rootDir must be an explicit path");
  const artifactRoot = await fs.realpath(path.resolve(rootDir));
  const [packageInventory, resourceInventory, profile] = await Promise.all([
    readJson(path.join(artifactRoot, "inventory", "packages.lock.json"), artifactRoot),
    readJson(path.join(artifactRoot, "inventory", "resources.lock.json"), artifactRoot),
    readJson(path.join(artifactRoot, "profiles", `${profileId}.json`), artifactRoot),
  ]);
  const plan = await planOwnedGraph({ packageInventory, resourceInventory, profile, artifactRoot });
  return Object.freeze(sourceCommit === undefined ? plan : { ...plan, sourceCommit });
}

/** Integration-friendly alias; failAt remains owned by transaction orchestration. */
export function stageGeneration(plan, {
  configRoot,
  transactionId,
  artifactRoot,
  runner,
  promote,
} = {}) {
  return stageAndPromoteGeneration({
    plan,
    configRoot,
    transactionId,
    artifactRoot,
    runCommand: runner,
    promote,
  });
}

/** Integration-friendly alias that still performs disk re-verification. */
export function compileOwnedSettings(plan, generation, { configRoot, transactionId } = {}) {
  const promotion = generation?.receipt ?? generation;
  return compileGenerationSettings({ plan, promotion, configRoot, transactionId });
}
