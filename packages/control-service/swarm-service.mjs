import fs from "node:fs/promises";
import path from "node:path";

import { createAgentRegistry } from "../agent-registry/index.mjs";
import { createSwarmRecipeRegistry, createSwarmRunController } from "../swarm-core/index.mjs";

/**
 * Control surface for Swarm recipes.  Listing, showing, validating, and
 * planning are offline/read-only.  Live run/status/cancel require an injected
 * Pi extension-RPC transport; the default service deliberately has none.
 */
export class SwarmControlService {
  constructor({ rootDir, registry, agentRegistry, adapter, controller, profile, mode, runtimeCapabilities } = {}) {
    this.rootDir = rootDir;
    this.agentRegistry = agentRegistry ?? createAgentRegistry({ rootDir });
    this.registry = registry ?? createSwarmRecipeRegistry({ rootDir, agentRegistry: this.agentRegistry });
    this.adapter = adapter ?? null;
    this.controller = controller ?? createSwarmRunController({
      registry: this.registry,
      agentRegistry: this.agentRegistry,
      adapter: this.adapter,
      profile,
      mode,
      runtimeCapabilities,
    });
  }

  async #input(options) {
    if (options.input !== undefined) return options.input;
    if (!options.inputFile) return {};
    const target = path.resolve(options.inputFile);
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw Object.assign(new Error("swarm input file must be a regular non-symlink file"), { code: "INVALID_INPUT_FILE" });
    if (stat.size > 64 * 1024) throw Object.assign(new Error("swarm input file exceeds 64 KiB"), { code: "INPUT_TOO_LARGE" });
    const value = JSON.parse(await fs.readFile(target, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("swarm input must be a JSON object"), { code: "INVALID_INPUT" });
    return value;
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") {
      const recipes = await this.registry.list();
      return { ok: true, status: "SWARM_RECIPE_LIST", mutation: false, recipes: recipes.map((entry) => ({ id: entry.id, version: entry.manifest.version, description: entry.manifest.description, readOnly: entry.manifest.readOnly, nodes: entry.graph.order.length, sourceHash: entry.sourceHash, contractStatus: entry.manifest.contractStatus })) };
    }
    if (subcommand === "show") {
      const entry = await this.registry.resolve(options.recipeId);
      return { ok: true, status: "SWARM_RECIPE_SHOW", mutation: false, recipe: entry.manifest, sourceHash: entry.sourceHash };
    }
    if (subcommand === "validate") {
      const result = options.recipeId ? await this.registry.resolve(options.recipeId).then(() => ({ ok: true, status: "SWARM_RECIPE_VALID", mutation: false, recipeId: options.recipeId })) : await this.registry.doctor();
      return result;
    }
    if (subcommand === "plan") {
      try {
        const planned = await this.controller.plan(options.recipeId, { input: await this.#input(options), profile: options.profile, mode: options.mode, runtimeCapabilities: options.runtimeCapabilities });
        return { ok: true, status: "SWARM_PLAN", mutation: false, recipeId: options.recipeId, sourceHash: planned.entry.sourceHash, plan: planned.plan, admission: planned.admission, requestDigest: planned.request.workflowScriptDigest };
      } catch (error) {
        return { ok: false, status: "SWARM_PLAN_BLOCKED", mutation: false, code: error.code ?? "SWARM_PLAN_BLOCKED", message: error.message };
      }
    }
    if (subcommand === "run") {
      if (!this.adapter) return { ok: false, status: "LIVE_SWARM_REQUIRES_PI_SESSION", mutation: true, code: "LIVE_SWARM_REQUIRES_PI_SESSION", next: "Use /omp swarm run inside a Pi session with the audited extension-RPC transport." };
      const state = await this.controller.run(options.recipeId, { runId: options.runId, input: await this.#input(options), profile: options.profile, mode: options.mode, runtimeCapabilities: options.runtimeCapabilities, signal: options.signal });
      return { ok: state.verdict === "pass", status: state.status === "completed" ? "SWARM_COMPLETED" : state.status === "cancelled" ? "SWARM_CANCELLED" : "SWARM_FAILED", mutation: true, state };
    }
    if (subcommand === "status") {
      const state = await this.controller.status(options.runId);
      return state ? { ok: true, status: "SWARM_STATUS", mutation: false, state } : { ok: false, status: "SWARM_RUN_NOT_FOUND", mutation: false, code: "UNKNOWN_RUN" };
    }
    if (subcommand === "cancel") {
      return { ok: true, status: "SWARM_CANCEL", mutation: false, result: await this.controller.cancel(options.runId) };
    }
    return { ok: false, status: "SWARM_COMMAND_INVALID", mutation: false, code: "INVALID_SWARM_COMMAND" };
  }
}

export function createSwarmControlService(options = {}) { return new SwarmControlService(options); }
