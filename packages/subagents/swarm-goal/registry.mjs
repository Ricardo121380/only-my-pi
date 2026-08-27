import { constants as fsConstants } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { digestValue, immutable } from "../domain/index.mjs";
import { assertSwarmGoalDefinition } from "./index.mjs";

const MAX_BYTES = 256 * 1024;

export class SwarmGoalRegistryError extends Error {
  constructor(message, code = "SWARM_GOAL_REGISTRY_ERROR", details = {}) {
    super(`swarm-goal-registry: ${message}`);
    this.name = "SwarmGoalRegistryError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) {
  throw new SwarmGoalRegistryError(message, code, details);
}

function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("goal path escapes registry root", "SWARM_GOAL_RESOURCE_ESCAPE");
  return path.resolve(target);
}

async function lstatOrNull(fs, target) {
  try { return await fs.lstat(target); } catch (cause) { if (cause?.code === "ENOENT") return null; throw cause; }
}

export class SwarmGoalRegistry {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.goalRoot = contained(this.rootDir, options.goalRoot ?? path.join(this.rootDir, "swarm", "goals"));
    this.fs = options.fs ?? fsPromises;
    this.state = null;
  }

  async discover() {
    const stat = await lstatOrNull(this.fs, this.goalRoot);
    if (!stat) return Object.freeze([]);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("goal root is unsafe", "SWARM_GOAL_RESOURCE_ESCAPE");
    const realRoot = await this.fs.realpath(this.rootDir);
    const realGoalRoot = await this.fs.realpath(this.goalRoot);
    contained(realRoot, realGoalRoot);
    const entries = await this.fs.readdir(this.goalRoot, { withFileTypes: true });
    const goals = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) fail(`unsupported goal registry entry: ${entry.name}`, "SWARM_GOAL_RESOURCE_ESCAPE");
      const target = contained(this.goalRoot, path.join(this.goalRoot, entry.name));
      let handle;
      let raw;
      try {
        handle = await this.fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const targetStat = await handle.stat();
        if (!targetStat.isFile() || targetStat.size > MAX_BYTES) fail(`unsafe or oversized goal: ${entry.name}`, "SWARM_GOAL_RESOURCE_ESCAPE");
        contained(realGoalRoot, await this.fs.realpath(target));
        raw = JSON.parse((await handle.readFile()).toString("utf8"));
      } catch (cause) {
        if (cause instanceof SyntaxError) fail(`invalid goal JSON: ${entry.name}`, "SWARM_GOAL_RESOURCE_INVALID");
        if (["ELOOP", "EMLINK"].includes(cause?.code)) fail(`goal may not be a symlink: ${entry.name}`, "SWARM_GOAL_RESOURCE_ESCAPE");
        throw cause;
      } finally {
        await handle?.close().catch(() => {});
      }
      const definition = assertSwarmGoalDefinition(raw);
      if (goals.some((goal) => goal.id === definition.id)) fail(`duplicate goal id: ${definition.id}`, "SWARM_GOAL_DUPLICATE_ID");
      goals.push(immutable({ id: definition.id, definition, sourceHash: digestValue(definition), source: path.relative(this.rootDir, target).split(path.sep).join("/") }));
    }
    this.state = new Map(goals.map((goal) => [goal.id, goal]));
    return Object.freeze(goals);
  }

  async list() { if (!this.state) await this.discover(); return Object.freeze([...this.state.values()]); }
  async resolve(id) {
    if (!this.state) await this.discover();
    const value = this.state.get(id);
    if (!value) fail(`unknown SwarmGoal: ${id}`, "SWARM_GOAL_UNKNOWN");
    return value;
  }
  async doctor() {
    try { const goals = await this.discover(); return { ok: true, status: "SWARM_GOAL_DOCTOR_PASS", count: goals.length, errors: [] }; }
    catch (cause) { if (cause instanceof SwarmGoalRegistryError) return { ok: false, status: "SWARM_GOAL_DOCTOR_FAIL", code: cause.code, message: cause.message }; throw cause; }
  }
}

export function createSwarmGoalRegistry(options = {}) { return new SwarmGoalRegistry(options); }
