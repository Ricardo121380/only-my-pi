import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { createUltraRunAuthorization, planUltraRun } from "../subagents/ultra-run/index.mjs";
import { createUltraRunRegistry } from "../subagents/ultra-run/registry.mjs";

const MAX_INPUT_BYTES = 256 * 1024;

function error(message, code) { return Object.assign(new Error(message), { code }); }
function prepare(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error("UltraRun request must be a JSON object", "ULTRA_RUN_INPUT_INVALID");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_INPUT_BYTES) throw error("UltraRun request exceeds 256 KiB", "ULTRA_RUN_INPUT_TOO_LARGE");
  return JSON.parse(encoded);
}
async function readFile(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw error("UltraRun input file must be absolute", "ULTRA_RUN_INPUT_FILE_INVALID");
  let handle;
  try {
    handle = await fs.open(path.resolve(filename), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw error("UltraRun input file is not a bounded regular file", "ULTRA_RUN_INPUT_FILE_INVALID");
    return prepare(JSON.parse((await handle.readFile()).toString("utf8")));
  } catch (cause) {
    if (cause instanceof SyntaxError) throw error("UltraRun input file contains invalid JSON", "ULTRA_RUN_INPUT_INVALID");
    if (["ELOOP", "EMLINK"].includes(cause?.code)) throw error("UltraRun input file may not be a symlink", "ULTRA_RUN_INPUT_FILE_INVALID");
    throw cause;
  } finally { await handle?.close().catch(() => {}); }
}

export class UltraRunControlService {
  constructor(options = {}) {
    this.registry = options.registry ?? createUltraRunRegistry({ rootDir: options.rootDir });
    this.router = options.router ?? null;
  }
  async #request(options) { return options.inputFile ? readFile(options.inputFile) : prepare(options.input); }
  async #plan(options) {
    const entry = await this.registry.resolve(options.strategyId);
    const request = await this.#request(options);
    const plan = planUltraRun(entry.definition, request);
    const authorization = plan.approval.required ? createUltraRunAuthorization(plan, request.id) : null;
    return { entry, request, plan, authorization };
  }
  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") return { ok: true, status: "ULTRA_RUN_LIST", mutation: false, strategies: (await this.registry.list()).map((entry) => ({ id: entry.id, effort: entry.definition.effort, sourceHash: entry.sourceHash })) };
    if (subcommand === "show") { const entry = await this.registry.resolve(options.strategyId); return { ok: true, status: "ULTRA_RUN_SHOW", mutation: false, strategy: entry.definition, sourceHash: entry.sourceHash, source: entry.source }; }
    if (subcommand === "validate") return options.strategyId ? this.registry.resolve(options.strategyId).then((entry) => ({ ok: true, status: "ULTRA_RUN_VALID", mutation: false, strategyId: entry.id, sourceHash: entry.sourceHash })) : this.registry.doctor();
    if (["plan", "run"].includes(subcommand)) {
      let prepared;
      try { prepared = await this.#plan(options); } catch (cause) { return { ok: false, status: "ULTRA_RUN_PLAN_BLOCKED", mutation: false, code: cause.code ?? "ULTRA_RUN_PLAN_BLOCKED", message: cause.message }; }
      if (subcommand === "plan") return { ok: true, status: "ULTRA_RUN_PLAN", mutation: false, plan: prepared.plan, authorization: prepared.authorization, request: prepared.request, liveDispatch: "NOT_RUN_BY_POLICY" };
      if (options.yes !== true) return { ok: false, status: "CONFIRMATION_REQUIRED", mutation: true, code: "EXACT_ULTRA_CONFIRMATION_REQUIRED", plan: prepared.plan };
      if (options.expectedPlanDigest !== prepared.plan.planDigest || (prepared.authorization && options.expectedAuthorizationDigest !== prepared.authorization.authorizationDigest)) return { ok: false, status: "ULTRA_RUN_PLAN_STALE", mutation: false, code: "ULTRA_RUN_ADMISSION_DRIFT", currentPlanDigest: prepared.plan.planDigest, currentAuthorizationDigest: prepared.authorization?.authorizationDigest ?? null };
      if (!this.router) return { ok: false, status: "LIVE_ULTRA_RUN_REQUIRES_PI_SESSION", mutation: true, code: "LIVE_RUNTIME_UNAVAILABLE", liveDispatch: "NOT_RUN_BY_POLICY", next: "Inject route executors backed by the unified @only-my-pi/subagents facade." };
      const result = await this.router.run(prepared.entry.definition, prepared.request, { authorization: prepared.authorization, input: options.input, signal: options.signal });
      return { ok: result.result.status === "completed", status: `ULTRA_RUN_${result.result.status.toUpperCase().replaceAll("-", "_")}`, mutation: true, plan: result.plan, result: result.result };
    }
    return { ok: false, status: "ULTRA_RUN_COMMAND_INVALID", mutation: false, code: "INVALID_ULTRA_RUN_COMMAND" };
  }
}

export function createUltraRunControlService(options = {}) { return new UltraRunControlService(options); }
