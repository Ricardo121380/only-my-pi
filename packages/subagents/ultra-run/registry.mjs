import { constants as fsConstants } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";

import { digestValue, immutable } from "../domain/index.mjs";
import { assertUltraRunDefinition } from "./index.mjs";

const MAX_BYTES = 256 * 1024;

export class UltraRunRegistryError extends Error {
  constructor(message, code = "ULTRA_RUN_REGISTRY_ERROR", details = {}) {
    super(`ultra-run-registry: ${message}`);
    this.name = "UltraRunRegistryError";
    this.code = code;
    this.details = details;
  }
}

function fail(message, code, details) { throw new UltraRunRegistryError(message, code, details); }
function contained(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("UltraRun path escapes registry root", "ULTRA_RUN_RESOURCE_ESCAPE");
  return path.resolve(target);
}

export class UltraRunRegistry {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.strategyRoot = contained(this.rootDir, options.strategyRoot ?? path.join(this.rootDir, "ultra", "strategies"));
    this.fs = options.fs ?? fsPromises;
    this.state = null;
  }

  async discover() {
    let stat;
    try { stat = await this.fs.lstat(this.strategyRoot); } catch (cause) { if (cause?.code === "ENOENT") return Object.freeze([]); throw cause; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UltraRun strategy root is unsafe", "ULTRA_RUN_RESOURCE_ESCAPE");
    const realRoot = await this.fs.realpath(this.rootDir);
    const realStrategyRoot = await this.fs.realpath(this.strategyRoot);
    contained(realRoot, realStrategyRoot);
    const values = [];
    for (const entry of (await this.fs.readdir(this.strategyRoot, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".json") || entry.name.startsWith(".")) fail(`unsupported UltraRun registry entry: ${entry.name}`, "ULTRA_RUN_RESOURCE_ESCAPE");
      const target = contained(this.strategyRoot, path.join(this.strategyRoot, entry.name));
      let handle;
      let raw;
      try {
        handle = await this.fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
        const targetStat = await handle.stat();
        if (!targetStat.isFile() || targetStat.size > MAX_BYTES) fail(`unsafe or oversized UltraRun strategy: ${entry.name}`, "ULTRA_RUN_RESOURCE_ESCAPE");
        contained(realStrategyRoot, await this.fs.realpath(target));
        raw = JSON.parse((await handle.readFile()).toString("utf8"));
      } catch (cause) {
        if (cause instanceof SyntaxError) fail(`invalid UltraRun JSON: ${entry.name}`, "ULTRA_RUN_RESOURCE_INVALID");
        if (["ELOOP", "EMLINK"].includes(cause?.code)) fail(`UltraRun strategy may not be a symlink: ${entry.name}`, "ULTRA_RUN_RESOURCE_ESCAPE");
        throw cause;
      } finally {
        await handle?.close().catch(() => {});
      }
      const definition = assertUltraRunDefinition(raw);
      if (values.some((value) => value.id === definition.id)) fail(`duplicate UltraRun id: ${definition.id}`, "ULTRA_RUN_DUPLICATE_ID");
      values.push(immutable({ id: definition.id, definition, sourceHash: digestValue(definition), source: path.relative(this.rootDir, target).split(path.sep).join("/") }));
    }
    this.state = new Map(values.map((value) => [value.id, value]));
    return Object.freeze(values);
  }
  async list() { if (!this.state) await this.discover(); return Object.freeze([...this.state.values()]); }
  async resolve(id) { if (!this.state) await this.discover(); const value = this.state.get(id); if (!value) fail(`unknown UltraRun: ${id}`, "ULTRA_RUN_UNKNOWN"); return value; }
  async doctor() {
    try { const values = await this.discover(); return { ok: true, status: "ULTRA_RUN_DOCTOR_PASS", count: values.length, errors: [] }; }
    catch (cause) { if (cause instanceof UltraRunRegistryError) return { ok: false, status: "ULTRA_RUN_DOCTOR_FAIL", code: cause.code, message: cause.message }; throw cause; }
  }
}

export function createUltraRunRegistry(options = {}) { return new UltraRunRegistry(options); }
