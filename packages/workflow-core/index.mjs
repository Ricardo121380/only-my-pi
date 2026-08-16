import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const STATES = Object.freeze(["planned", "admitted", "running", "stopping", "completed", "failed", "cancelled", "timed_out", "budget_exhausted", "interrupted"]);
const TERMINAL = new Set(["completed", "failed", "cancelled", "timed_out", "budget_exhausted", "interrupted"]);

export class WorkflowError extends Error {
  constructor(message, code = "WORKFLOW_ERROR", details = {}) {
    super(`workflow-core: ${message}`);
    this.name = "WorkflowError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) { throw new WorkflowError(message, code, details); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function digest(value) { return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex")}`; }
function statIs(stat, name) { return Boolean(stat && (typeof stat[name] === "function" ? stat[name]() : stat[name])); }

function normalizeFs(input) {
  const source = input ?? fsPromises;
  for (const name of ["readdir", "readFile", "lstat"]) if (typeof source[name] !== "function") fail(`filesystem driver lacks ${name}`, "FILESYSTEM_UNAVAILABLE");
  return { readdir: (...args) => source.readdir(...args), readFile: (...args) => source.readFile(...args), lstat: (...args) => source.lstat(...args) };
}

async function files(fs, root) {
  const stat = await fs.lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (!stat) return [];
  if (statIs(stat, "isSymbolicLink") || !statIs(stat, "isDirectory")) fail(`unsafe workflow root: ${root}`, "PATH_ESCAPE");
  const result = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name.endsWith(".json")) result.push(path.join(root, entry.name));
  }
  return result;
}

function graphOrder(steps) {
  const byId = new Map();
  for (const step of steps) {
    if (!step || !ID.test(step.id ?? "") || byId.has(step.id)) fail(`invalid or duplicate step id: ${step?.id}`, "INVALID_WORKFLOW_GRAPH");
    byId.set(step.id, step);
  }
  const visiting = new Set();
  const visited = new Set();
  const output = [];
  const visit = (id) => {
    if (visiting.has(id)) fail(`workflow cycle at ${id}`, "WORKFLOW_CYCLE");
    if (visited.has(id)) return;
    const step = byId.get(id);
    if (!step) fail(`workflow references missing step ${id}`, "UNKNOWN_STEP");
    visiting.add(id);
    for (const dependency of [...(step.needs ?? [])].sort()) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    output.push(step);
  };
  for (const step of steps.slice().sort((left, right) => left.id.localeCompare(right.id))) visit(step.id);
  return { byId, order: output };
}

function validateWorkflow(manifest) {
  if (!isObject(manifest)) fail("workflow must be an object", "INVALID_WORKFLOW");
  for (const key of ["$schema", "formatVersion", "contractStatus", "id", "version", "entryConditions", "mutationScope", "budget", "fallback", "steps", "terminal", "cancellation", "failure", "recovery"]) if (!Object.hasOwn(manifest, key)) fail(`workflow missing ${key}`, "INVALID_WORKFLOW");
  if (manifest.formatVersion !== 1 || !ID.test(manifest.id ?? "")) fail("unsupported workflow format or id", "INVALID_WORKFLOW");
  if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) fail("workflow steps must be non-empty", "INVALID_WORKFLOW");
  const graph = graphOrder(manifest.steps);
  if (manifest.steps.length > manifest.budget.maxSteps) fail("workflow exceeds maxSteps", "WORKFLOW_BUDGET");
  if (!graph.byId.has(manifest.terminal.step)) fail("terminal step is missing", "UNKNOWN_STEP");
  if (manifest.terminal.requiresVerifierGate !== true) fail("workflow must require a verifier gate", "INVALID_WORKFLOW");
  const terminalDependencies = new Set([manifest.terminal.step]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of manifest.steps) {
      if (terminalDependencies.has(step.id)) for (const dependency of step.needs ?? []) if (!terminalDependencies.has(dependency)) {
        terminalDependencies.add(dependency);
        changed = true;
      }
    }
  }
  if (!manifest.steps.some((step) => terminalDependencies.has(step.id) && step.action === "gate")) fail("terminal dependency chain must contain a gate", "MISSING_VERIFIER_GATE");
  for (const step of manifest.steps) {
    if (!Array.isArray(step.needs) || step.needs.some((dependency) => !graph.byId.has(dependency))) fail(`step ${step.id} has an unknown dependency`, "UNKNOWN_STEP");
    if (!["agent", "gate", "swarm"].includes(step.action)) fail(`step ${step.id} has unsupported action`, "INVALID_WORKFLOW_STEP");
  }
  return Object.freeze({ manifest: clone(manifest), graph });
}

export function validateWorkflowManifest(manifest) {
  try { validateWorkflow(manifest); return { valid: true, errors: [] }; }
  catch (error) { if (error instanceof WorkflowError) return { valid: false, errors: [{ code: error.code, message: error.message }] }; throw error; }
}

export class WorkflowRegistry {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.workflowRoot = path.resolve(options.workflowRoot ?? path.join(this.rootDir, "workflows"));
    this.fs = normalizeFs(options.fs);
    this.agentRegistry = options.agentRegistry ?? null;
    this.gateRunner = options.gateRunner ?? null;
    this.modeIds = new Set(options.modeIds ?? []);
    this.state = null;
  }

  async discover() {
    const entries = [];
    for (const file of await files(this.fs, this.workflowRoot)) {
      let manifest;
      try { manifest = JSON.parse(await this.fs.readFile(file, "utf8")); } catch (error) { fail(`cannot parse workflow ${file}: ${error.message}`, "INVALID_WORKFLOW"); }
      const checked = validateWorkflow(manifest);
      entries.push({ id: manifest.id, manifest: checked.manifest, graph: checked.graph, sourcePath: path.relative(this.rootDir, file).split(path.sep).join("/"), sourceHash: digest(manifest) });
    }
    const duplicates = entries.filter((entry, index) => entries.findIndex((candidate) => candidate.id === entry.id) !== index);
    if (duplicates.length) fail(`duplicate workflow id ${duplicates[0].id}`, "DUPLICATE_WORKFLOW_ID");
    const knownAgents = new Set();
    const knownModes = new Set();
    try {
      const agentFiles = await files(this.fs, path.join(this.rootDir, "agents"));
      for (const file of agentFiles) knownAgents.add(JSON.parse(await this.fs.readFile(file, "utf8")).id);
    } catch (error) { if (!(error instanceof WorkflowError)) throw error; }
    try {
      const modeFiles = await files(this.fs, path.join(this.rootDir, "modes"));
      for (const file of modeFiles) knownModes.add(JSON.parse(await this.fs.readFile(file, "utf8")).id);
    } catch (error) { if (!(error instanceof WorkflowError)) throw error; }
    for (const entry of entries) {
      for (const step of entry.manifest.steps) {
        if (step.action === "agent" && knownAgents.size > 0 && !knownAgents.has(step.agent)) fail(`workflow ${entry.id} references unknown agent ${step.agent}`, "UNKNOWN_AGENT");
        if (step.policyRef && knownModes.size > 0 && !knownModes.has(step.policyRef)) fail(`workflow ${entry.id} references unknown mode ${step.policyRef}`, "UNKNOWN_MODE");
        if (step.action === "gate" && this.gateRunner?.plan) this.gateRunner.plan(step.gate);
      }
      if (entry.manifest.fallback.workflow && !entries.some((candidate) => candidate.id === entry.manifest.fallback.workflow)) fail(`workflow ${entry.id} references unknown fallback`, "UNKNOWN_WORKFLOW");
    }
    entries.sort((left, right) => left.id.localeCompare(right.id));
    this.state = new Map(entries.map((entry) => [entry.id, entry]));
    return Object.freeze({ formatVersion: 1, workflows: Object.freeze(entries.map((entry) => ({ id: entry.id, sourcePath: entry.sourcePath, sourceHash: entry.sourceHash, contractStatus: entry.manifest.contractStatus }))) });
  }

  async list() { if (!this.state) await this.discover(); return [...this.state.values()]; }
  async resolve(id) { if (!this.state) await this.discover(); const result = this.state.get(id); if (!result) fail(`unknown workflow ${id}`, "UNKNOWN_WORKFLOW"); return result; }
  async doctor() { try { const result = await this.discover(); return { ok: true, status: "WORKFLOW_DOCTOR_PASS", count: result.workflows.length, errors: [] }; } catch (error) { if (error instanceof WorkflowError) return { ok: false, status: "WORKFLOW_DOCTOR_FAIL", code: error.code, message: error.message }; throw error; } }
}

class MemoryStateStore {
  constructor() { this.values = new Map(); }
  async get(id) { return this.values.get(id) ?? null; }
  async put(id, value) { this.values.set(id, clone(value)); return value; }
}

function safeResult(value, maxBytes = 65536) {
  if (!isObject(value)) return { value: typeof value === "string" ? value.slice(0, 1024) : null };
  const candidate = clone(value);
  for (const key of ["prompt", "promptText", "reasoning", "content", "rawOutput", "credentials", "token", "secret"]) delete candidate[key];
  const serialized = JSON.stringify(candidate);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) return { truncated: true, digest: digest(serialized) };
  return candidate;
}

function transitionAllowed(from, to) {
  const allowed = {
    planned: new Set(["admitted", "cancelled", "failed"]),
    admitted: new Set(["running", "stopping", "cancelled", "failed"]),
    running: new Set(["completed", "failed", "stopping", "cancelled", "timed_out", "budget_exhausted", "interrupted"]),
    stopping: new Set(["cancelled", "failed", "interrupted"]),
  };
  return allowed[from]?.has(to) ?? false;
}

export class SingleAgentWorkflowRunner {
  constructor(options = {}) {
    this.registry = options.registry ?? new WorkflowRegistry(options);
    this.agentRegistry = options.agentRegistry;
    this.gateRunner = options.gateRunner;
    this.stateStore = options.stateStore ?? new MemoryStateStore();
    this.agentExecutor = options.agentExecutor;
    this.session = options.session ?? null;
    // Keep the durable state separate from the live controller.  The state is
    // persisted for resume/inspection; the controller is process-local and is
    // the only thing allowed to interrupt an in-flight parent-session stage.
    this.active = new Map();
  }

  async #persist(state) { state.updatedAt = new Date().toISOString(); await this.stateStore.put(state.runId, state); return state; }
  async #transition(state, next, reason) {
    if (!transitionAllowed(state.status, next)) fail(`invalid transition ${state.status} -> ${next}`, "INVALID_TRANSITION");
    state.status = next;
    state.transitions.push({ from: state.transitions.at(-1)?.to ?? "new", to: next, reason: reason ?? null });
    await this.#persist(state);
  }

  async #executeAgent(step, context, state, signal) {
    if (!this.agentExecutor && !this.session?.runAgent) return { status: "UNAVAILABLE", code: "AGENT_EXECUTOR_UNAVAILABLE" };
    const agent = this.agentRegistry ? await this.agentRegistry.resolve(step.agent, { profile: context.profile }) : { id: step.agent, manifest: { id: step.agent } };
    const executor = this.agentExecutor ?? ((payload) => this.session.runAgent(payload));
    const result = await executor({ agent, step: clone(step), input: safeResult(context.input), prior: safeResult(state.steps), signal, session: this.session });
    if (!isObject(result)) fail(`agent ${step.agent} did not return a structured object`, "UNSTRUCTURED_AGENT_RESULT");
    return safeResult(result, context.maxOutputBytes);
  }

  async #executeStep(step, context, state, signal) {
    if (step.action === "agent") return this.#executeAgent(step, context, state, signal);
    if (step.action === "gate") {
      if (!this.gateRunner || typeof this.gateRunner.run !== "function") return { status: "UNAVAILABLE", code: "GATE_RUNNER_UNAVAILABLE", gateId: step.gate };
      return this.gateRunner.run(step.gate, { signal });
    }
    return { status: "UNAVAILABLE", code: "SWARM_UNAVAILABLE", recipe: step.recipe };
  }

  async run(workflowId, options = {}) {
    const entry = await this.registry.resolve(workflowId);
    const manifest = entry.manifest;
    const runId = options.runId ?? crypto.randomUUID();
    const existing = await this.stateStore.get(runId);
    if (existing) {
      if (options.sourceHash && existing.sourceHash !== options.sourceHash) fail("workflow source hash changed", "WORKFLOW_SOURCE_STALE");
      if (existing.sourceHash !== entry.sourceHash) fail("workflow source hash changed", "WORKFLOW_SOURCE_STALE");
      if (TERMINAL.has(existing.status)) return existing;
    }
    if (options.conditions && !manifest.entryConditions.every((condition) => options.conditions.includes(condition))) return Object.freeze({ runId, workflowId, status: "blocked", verdict: "blocked", reason: "entry conditions are not satisfied" });
    const state = existing ?? {
      formatVersion: 1, runId, workflowId, sourceHash: entry.sourceHash, status: "planned", verdict: null,
      steps: {}, transitions: [], receipts: [], startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inputDigest: digest(options.input ?? {}),
    };
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    this.active.set(runId, { state, controller });
    if (state.status === "planned") await this.#transition(state, "admitted", "workflow admitted");
    try {
      if (controller.signal.aborted) { await this.#transition(state, "cancelled", "cancelled before admission"); state.verdict = "cancelled"; return state; }
      await this.#transition(state, "running", "first unsettled step admitted");
      const context = { input: options.input ?? {}, profile: options.profile, maxOutputBytes: manifest.budget.maxOutputBytes };
      for (const step of entry.graph.order) {
        if (controller.signal.aborted) {
          if (state.status !== "stopping") await this.#transition(state, "stopping", "cancellation requested");
          await this.#transition(state, "cancelled", "terminal cancellation proof");
          state.verdict = "cancelled";
          await this.#persist(state);
          return state;
        }
        const prior = state.steps[step.id];
        if (prior?.status === "completed") continue;
        state.steps[step.id] = { status: "running", action: step.action, startedAt: new Date().toISOString() };
        await this.#persist(state);
        let result;
        try { result = await this.#executeStep(step, context, state, controller.signal); }
        catch (error) {
          if (controller.signal.aborted) {
            state.steps[step.id] = { ...state.steps[step.id], status: "cancelled", errorCode: "ABORTED", completedAt: new Date().toISOString() };
            await this.#persist(state);
            if (state.status !== "stopping") await this.#transition(state, "stopping", "cancellation requested during step");
            await this.#transition(state, "cancelled", "terminal cancellation proof");
            state.verdict = "cancelled";
            await this.#persist(state);
            return state;
          }
          state.steps[step.id] = { ...state.steps[step.id], status: "failed", errorCode: error.code ?? "STEP_ERROR" };
          await this.#persist(state);
          await this.#transition(state, "failed", `step ${step.id} failed`);
          state.verdict = "fail";
          await this.#persist(state);
          return state;
        }
        const passed = step.action === "gate" ? result.status === "PASS" : result.status !== "UNAVAILABLE" && result.verdict !== "fail";
        state.steps[step.id] = { ...state.steps[step.id], status: passed ? "completed" : "failed", result: safeResult(result, manifest.budget.maxOutputBytes), completedAt: new Date().toISOString() };
        if (result?.status && ["PASS", "FAIL", "PLANNED"].includes(result.status)) state.receipts.push(safeResult(result));
        await this.#persist(state);
        if (!passed) {
          if (step.action === "swarm" && manifest.fallback?.workflow) {
            state.fallback = { from: workflowId, to: manifest.fallback.workflow, reason: result.code ?? "SWARM_UNAVAILABLE" };
            await this.#persist(state);
            const fallback = await this.run(manifest.fallback.workflow, { ...options, runId: `${runId}:fallback`, input: options.input, conditions: manifest.entryConditions });
            state.verdict = fallback.verdict ?? "blocked";
            state.status = fallback.status === "completed" ? "completed" : "failed";
            await this.#persist(state);
            return state;
          }
          await this.#transition(state, "failed", `step ${step.id} did not pass`);
          state.verdict = result?.status === "UNAVAILABLE" ? "blocked" : "fail";
          await this.#persist(state);
          return state;
        }
      }
      await this.#transition(state, "completed", "terminal step passed");
      state.verdict = "pass";
      await this.#persist(state);
      return state;
    } finally {
      options.signal?.removeEventListener?.("abort", onAbort);
      const active = this.active.get(runId);
      if (active?.controller === controller) this.active.delete(runId);
    }
  }

  async cancel(runId) {
    const active = this.active.get(runId);
    const state = active?.state ?? await this.stateStore.get(runId);
    if (!state) return { status: "UNKNOWN_RUN" };
    if (TERMINAL.has(state.status)) return state;
    state.cancelRequested = true;
    if (active?.controller) {
      if (["admitted", "running"].includes(state.status)) await this.#transition(state, "stopping", "cancellation requested by caller");
      active.controller.abort();
    }
    await this.#persist(state);
    return Object.freeze({ status: "CANCEL_REQUESTED", runId });
  }

  async resume(runId, options = {}) {
    const state = await this.stateStore.get(runId);
    if (!state) fail(`unknown workflow run ${runId}`, "UNKNOWN_RUN");
    if (options.sourceHash && options.sourceHash !== state.sourceHash) fail("workflow source hash changed", "WORKFLOW_SOURCE_STALE");
    return this.run(state.workflowId, { ...options, runId, sourceHash: state.sourceHash });
  }
}

export function createWorkflowRegistry(options = {}) { return new WorkflowRegistry(options); }
export function createSingleAgentWorkflowRunner(options = {}) { return new SingleAgentWorkflowRunner(options); }
export { MemoryStateStore, STATES, TERMINAL };
