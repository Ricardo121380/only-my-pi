import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { digestValue, immutable } from "../subagents/domain/index.mjs";
import { createHumanGoalAuthorization } from "../subagents/swarm-goal/index.mjs";
import { createSwarmGoalRegistry } from "../subagents/swarm-goal/registry.mjs";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const MAX_INPUT_BYTES = 256 * 1024;

function error(message, code) { return Object.assign(new Error(message), { code }); }

function canonical(value, location = "input") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw error(`${location} contains a non-finite number`, "SWARM_GOAL_INPUT_INVALID"); return value; }
  if (Array.isArray(value)) return value.map((entry, index) => canonical(entry, `${location}[${index}]`));
  if (!value || typeof value !== "object" || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw error(`${location} must be plain JSON`, "SWARM_GOAL_INPUT_INVALID");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key], `${location}.${key}`)]));
}

function prepareInput(value) {
  const input = canonical(value ?? {});
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error("SwarmGoal input must be an object", "SWARM_GOAL_INPUT_INVALID");
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) throw error("SwarmGoal input exceeds 256 KiB", "SWARM_GOAL_INPUT_TOO_LARGE");
  return immutable(input);
}

async function readInputFile(filename) {
  if (typeof filename !== "string" || !path.isAbsolute(filename)) throw error("SwarmGoal input file must be absolute", "SWARM_GOAL_INPUT_FILE_INVALID");
  let handle;
  try {
    handle = await fs.open(path.resolve(filename), fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw error("SwarmGoal input file is not a bounded regular file", "SWARM_GOAL_INPUT_FILE_INVALID");
    return prepareInput(JSON.parse((await handle.readFile()).toString("utf8")));
  } catch (cause) {
    if (cause instanceof SyntaxError) throw error("SwarmGoal input file contains invalid JSON", "SWARM_GOAL_INPUT_INVALID");
    if (["ELOOP", "EMLINK"].includes(cause?.code)) throw error("SwarmGoal input file may not be a symlink", "SWARM_GOAL_INPUT_FILE_INVALID");
    throw cause;
  } finally { await handle?.close().catch(() => {}); }
}

export class SwarmGoalControlService {
  constructor(options = {}) {
    this.registry = options.registry ?? createSwarmGoalRegistry({ rootDir: options.rootDir });
    this.controller = options.controller ?? null;
  }

  async #plan(options) {
    const entry = await this.registry.resolve(options.goalId);
    const runId = options.runId ?? `goal-${crypto.randomUUID()}`;
    if (!RUN_ID.test(runId)) throw error("SwarmGoal run id is invalid", "INVALID_RUN_ID");
    const input = options.inputFile ? await readInputFile(options.inputFile) : prepareInput(options.input);
    const objective = { ref: entry.definition.objective.ref, digest: entry.definition.objective.digest, input };
    const authorization = createHumanGoalAuthorization(entry.definition, { objective, nonce: runId });
    const plan = {
      formatVersion: 1,
      kind: "swarm-goal-admission-plan",
      runId,
      goalId: entry.id,
      goalDigest: entry.sourceHash,
      objective,
      inputDigest: authorization.inputDigest,
      authorizationDigest: authorization.authorizationDigest,
      maxPlanRevisions: entry.definition.authority.maxPlanRevisions,
      maxAgentSpecs: entry.definition.authority.maxAgentSpecs,
      liveDispatch: "NOT_RUN_BY_POLICY",
    };
    return immutable({ entry, input, objective, authorization, plan: { ...plan, planDigest: digestValue(plan) } });
  }

  async dispatch(options = {}) {
    const subcommand = options.subcommand ?? "list";
    if (subcommand === "list") return { ok: true, status: "SWARM_GOAL_LIST", mutation: false, goals: (await this.registry.list()).map((entry) => ({ id: entry.id, sourceHash: entry.sourceHash, authority: entry.definition.authority, roles: entry.definition.roles })) };
    if (subcommand === "show") { const entry = await this.registry.resolve(options.goalId); return { ok: true, status: "SWARM_GOAL_SHOW", mutation: false, goal: entry.definition, sourceHash: entry.sourceHash, source: entry.source }; }
    if (subcommand === "validate") return options.goalId ? this.registry.resolve(options.goalId).then((entry) => ({ ok: true, status: "SWARM_GOAL_VALID", mutation: false, goalId: entry.id, sourceHash: entry.sourceHash })) : this.registry.doctor();
    if (["plan", "run"].includes(subcommand)) {
      let prepared;
      try { prepared = await this.#plan(options); } catch (cause) { return { ok: false, status: "SWARM_GOAL_PLAN_BLOCKED", mutation: false, code: cause.code ?? "SWARM_GOAL_PLAN_BLOCKED", message: cause.message }; }
      if (subcommand === "plan") return { ok: true, status: "SWARM_GOAL_PLAN", mutation: false, plan: prepared.plan, runId: prepared.plan.runId, input: prepared.input, authorization: prepared.authorization, liveDispatch: "NOT_RUN_BY_POLICY" };
      if (options.yes !== true) return { ok: false, status: "CONFIRMATION_REQUIRED", mutation: true, code: "EXACT_GOAL_CONFIRMATION_REQUIRED", plan: prepared.plan };
      if (options.expectedPlanDigest !== prepared.plan.planDigest || options.expectedAuthorizationDigest !== prepared.authorization.authorizationDigest) return { ok: false, status: "SWARM_GOAL_PLAN_STALE", mutation: false, code: "SWARM_GOAL_ADMISSION_DRIFT", currentPlanDigest: prepared.plan.planDigest, currentAuthorizationDigest: prepared.authorization.authorizationDigest };
      if (!this.controller) return { ok: false, status: "LIVE_SWARM_GOAL_REQUIRES_PI_SESSION", mutation: true, code: "LIVE_RUNTIME_UNAVAILABLE", liveDispatch: "NOT_RUN_BY_POLICY", next: "Inject the governed SwarmGoalController and Pi-backed RunCoordinator." };
      const state = await this.controller.run(prepared.entry.definition, { runId: prepared.plan.runId, objective: prepared.objective, authorization: prepared.authorization, input: prepared.input, approvalForRevision: options.approvalForRevision, signal: options.signal });
      return { ok: state.status === "completed", status: `SWARM_GOAL_${state.status.toUpperCase().replaceAll("-", "_")}`, mutation: true, state };
    }
    if (subcommand === "status") {
      if (!options.runId) return { ok: false, status: "SWARM_GOAL_STATUS_UNAVAILABLE", mutation: false, code: "RUN_ID_REQUIRED" };
      if (!this.controller) return { ok: false, status: "SWARM_GOAL_STATUS_UNAVAILABLE", mutation: false, code: "LIVE_RUNTIME_UNAVAILABLE" };
      return { ok: true, status: "SWARM_GOAL_STATUS", mutation: false, state: await this.controller.inspect(options.runId) };
    }
    return { ok: false, status: "SWARM_GOAL_COMMAND_INVALID", mutation: false, code: "INVALID_SWARM_GOAL_COMMAND" };
  }
}

export function createSwarmGoalControlService(options = {}) { return new SwarmGoalControlService(options); }
