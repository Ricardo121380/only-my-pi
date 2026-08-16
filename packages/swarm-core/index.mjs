import crypto from "node:crypto";
import fsPromises from "node:fs/promises";
import path from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export const SWARM_RUN_STATES = Object.freeze([
  "planned", "admitted", "running", "stopping", "completed", "failed", "cancelled",
  "timed_out", "budget_exhausted", "interrupted",
]);
export const SWARM_ITEM_STATES = Object.freeze([
  "queued", "running", "completed", "failed", "timed_out", "cancelled",
  "skipped_dependency_failed", "skipped_run_cancelled", "budget_exhausted",
]);
const TERMINAL_RUN_STATES = new Set(["completed", "failed", "cancelled", "timed_out", "budget_exhausted", "interrupted"]);

export class SwarmError extends Error {
  constructor(message, code = "SWARM_ERROR", details = {}) {
    super(`swarm-core: ${message}`);
    this.name = "SwarmError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) { throw new SwarmError(message, code, details); }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(canonical(value))).digest("hex")}`;
}
function bounded(value, maxBytes) {
  const candidate = object(value) ? clone(value) : { value: typeof value === "string" ? value : null };
  for (const key of ["prompt", "promptText", "reasoning", "rawOutput", "credentials", "token", "secret", "env"]) delete candidate[key];
  const serialized = JSON.stringify(candidate);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) return { truncated: true, digest: digest(serialized) };
  return candidate;
}
function id(value, label) { if (!ID.test(value ?? "")) fail(`${label} must be a canonical id`, "INVALID_RECIPE_ID"); }

function normalizeFs(input) {
  const fs = input ?? fsPromises;
  for (const name of ["readdir", "readFile", "lstat"]) if (typeof fs[name] !== "function") fail(`filesystem driver lacks ${name}`, "FILESYSTEM_UNAVAILABLE");
  return {
    readdir: (...args) => fs.readdir(...args),
    readFile: (...args) => fs.readFile(...args),
    lstat: (...args) => fs.lstat(...args),
  };
}
async function files(fs, root) {
  let stat;
  try { stat = await fs.lstat(root); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  if (stat.isSymbolicLink?.() || !stat.isDirectory?.()) fail(`unsafe recipe root: ${root}`, "PATH_ESCAPE");
  const output = [];
  for (const entry of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink?.()) fail(`recipe resource symlink is not allowed: ${target}`, "PATH_ESCAPE");
    if (entry.isFile?.() && entry.name.endsWith(".json")) output.push(target);
  }
  return output;
}

function graph(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) fail("recipe nodes must be non-empty", "INVALID_RECIPE_GRAPH");
  const byId = new Map();
  for (const node of nodes) {
    id(node?.id, "node id");
    if (byId.has(node.id)) fail(`duplicate node: ${node.id}`, "DUPLICATE_NODE");
    byId.set(node.id, node);
  }
  const visiting = new Set();
  const visited = new Set();
  const order = [];
  const visit = (nodeId, trail = []) => {
    if (visiting.has(nodeId)) fail(`recipe cycle: ${[...trail, nodeId].join(" -> ")}`, "RECIPE_CYCLE");
    if (visited.has(nodeId)) return;
    const node = byId.get(nodeId);
    if (!node) fail(`unknown node dependency: ${nodeId}`, "UNKNOWN_NODE");
    visiting.add(nodeId);
    for (const dependency of [...(node.needs ?? [])].sort()) visit(dependency, [...trail, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
    order.push(node);
  };
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) visit(node.id);
  const levels = new Map();
  for (const node of order) levels.set(node.id, Math.max(0, ...(node.needs ?? []).map((dep) => (levels.get(dep) ?? 0) + 1)));
  const width = Math.max(1, ...[...levels.values()].map((level) => [...levels.values()].filter((candidate) => candidate === level).length));
  return { byId, order, levels, width };
}

function validateRecipeShape(manifest) {
  if (!object(manifest)) fail("recipe must be an object", "INVALID_RECIPE");
  for (const key of ["$schema", "formatVersion", "contractStatus", "id", "version", "description", "readOnly", "budget", "writerPolicy", "nodes", "aggregation", "verifier", "cancellation"]) {
    if (!Object.hasOwn(manifest, key)) fail(`recipe missing ${key}`, "INVALID_RECIPE");
  }
  if (manifest.formatVersion !== 1 || !["contract-only", "runtime-ready"].includes(manifest.contractStatus)) fail("unsupported recipe version/status", "INVALID_RECIPE");
  id(manifest.id, "recipe id");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version ?? "")) fail("recipe version must be semver", "INVALID_RECIPE");
  const budget = manifest.budget;
  for (const key of ["maxDepth", "maxConcurrency", "maxChildren", "childTimeoutSeconds", "runTimeoutSeconds", "retry", "childOutputBytes", "parentSummaryBytes"]) {
    if (!Number.isInteger(budget?.[key])) fail(`budget.${key} must be an integer`, "INVALID_RECIPE_BUDGET");
  }
  if (budget.maxDepth < 0 || budget.maxConcurrency < 1 || budget.maxChildren < 1 || budget.retry < 0 || budget.childTimeoutSeconds < 1 || budget.runTimeoutSeconds < 1) fail("recipe budget is outside safe bounds", "INVALID_RECIPE_BUDGET");
  if (budget.nestedSwarm !== false) fail("nested Swarm is disabled in v1", "NESTED_SWARM_UNSUPPORTED");
  if (manifest.writerPolicy?.sharedCwdMaxWriters !== 1 || manifest.writerPolicy?.parallelWriters !== "managed-worktree-only") fail("recipe writer policy must be single-writer/worktree-only", "INVALID_WRITER_POLICY");
  if (!manifest.cancellation || Object.values(manifest.cancellation).some((value) => value !== true)) fail("recipe cancellation must be fail-safe", "INVALID_CANCELLATION_POLICY");
  const g = graph(manifest.nodes);
  if (!g.byId.has(manifest.verifier)) fail(`unknown verifier node: ${manifest.verifier}`, "UNKNOWN_VERIFIER");
  if (g.order.length > budget.maxChildren) fail("recipe exceeds maxChildren", "BUDGET_EXCEEDED");
  if (g.width > budget.maxConcurrency) fail("recipe exceeds maxConcurrency", "BUDGET_EXCEEDED");
  for (const node of g.order) {
    id(node.agent, "node agent");
    if (!ID.test(node.taskTemplate ?? "")) fail(`node ${node.id} has invalid taskTemplate`, "INVALID_TASK_TEMPLATE");
    if (!Array.isArray(node.needs)) fail(`node ${node.id} needs must be an array`, "INVALID_RECIPE_GRAPH");
    if (!Number.isInteger(node.timeoutSeconds) || node.timeoutSeconds < 1 || node.timeoutSeconds > budget.childTimeoutSeconds) fail(`node ${node.id} timeout exceeds budget`, "BUDGET_EXCEEDED");
    if (!Number.isInteger(node.retry) || node.retry < 0 || node.retry > budget.retry) fail(`node ${node.id} retry exceeds budget`, "BUDGET_EXCEEDED");
    if (manifest.readOnly && (node.writer || node.workspace !== "shared-read-only")) fail(`read-only recipe node ${node.id} requests mutation`, "CAPABILITY_ESCALATION");
    if (node.writer && node.workspace !== "managed-worktree") fail(`writer ${node.id} must use managed-worktree`, "WORKTREE_REQUIRED");
  }
  return { manifest: clone(manifest), graph: g };
}

export function validateSwarmRecipe(manifest) {
  try { const result = validateRecipeShape(manifest); return { valid: true, errors: [], ...result }; }
  catch (error) { if (error instanceof SwarmError) return { valid: false, errors: [{ code: error.code, message: error.message }] }; throw error; }
}

export class SwarmRecipeRegistry {
  constructor({ rootDir = process.cwd(), recipeRoot, fs, agentRegistry } = {}) {
    this.rootDir = path.resolve(rootDir);
    this.recipeRoot = path.resolve(recipeRoot ?? path.join(this.rootDir, "swarm", "recipes"));
    this.fs = normalizeFs(fs);
    this.agentRegistry = agentRegistry ?? null;
    this.state = null;
  }
  async discover() {
    const entries = [];
    for (const file of await files(this.fs, this.recipeRoot)) {
      let manifest;
      try { manifest = JSON.parse(await this.fs.readFile(file, "utf8")); } catch (error) { fail(`cannot parse ${file}: ${error.message}`, "INVALID_RECIPE"); }
      const checked = validateRecipeShape(manifest);
      if (this.agentRegistry) {
        for (const node of checked.graph.order) {
          try { await this.agentRegistry.resolve(node.agent); }
          catch (error) { fail(`recipe ${manifest.id} references unavailable agent ${node.agent}`, error.code ?? "UNKNOWN_AGENT"); }
        }
      }
      entries.push(Object.freeze({ id: manifest.id, manifest: checked.manifest, graph: checked.graph, sourcePath: path.relative(this.rootDir, file).split(path.sep).join("/"), sourceHash: digest(manifest) }));
    }
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) fail("duplicate recipe id", "DUPLICATE_RECIPE_ID");
    entries.sort((left, right) => left.id.localeCompare(right.id));
    this.state = new Map(entries.map((entry) => [entry.id, entry]));
    return Object.freeze({ formatVersion: 1, recipes: Object.freeze(entries.map((entry) => ({ id: entry.id, sourcePath: entry.sourcePath, sourceHash: entry.sourceHash, contractStatus: entry.manifest.contractStatus }))) });
  }
  async list() { if (!this.state) await this.discover(); return [...this.state.values()]; }
  async resolve(recipeId) { if (!this.state) await this.discover(); const entry = this.state.get(recipeId); if (!entry) fail(`unknown recipe: ${recipeId}`, "UNKNOWN_RECIPE"); return entry; }
  async doctor() { try { const result = await this.discover(); return { ok: true, status: "SWARM_RECIPE_DOCTOR_PASS", count: result.recipes.length, errors: [] }; } catch (error) { if (error instanceof SwarmError) return { ok: false, status: "SWARM_RECIPE_DOCTOR_FAIL", code: error.code, message: error.message }; throw error; } }
}

export function createSwarmRecipeRegistry(options = {}) { return new SwarmRecipeRegistry(options); }

const DEFAULT_BUDGET = Object.freeze({ maxDepth: 1, maxConcurrency: 3, maxChildren: 8, childTimeoutSeconds: 900, runTimeoutSeconds: 3600, retry: 0, nestedSwarm: false, childOutputBytes: 51200, parentSummaryBytes: 8192 });
function budgetOf(value) {
  const source = value?.subagents ?? value?.budget ?? value ?? {};
  return {
    maxDepth: Number.isInteger(source.maxDepth) ? source.maxDepth : DEFAULT_BUDGET.maxDepth,
    maxConcurrency: Number.isInteger(source.maxConcurrency) ? source.maxConcurrency : DEFAULT_BUDGET.maxConcurrency,
    maxChildren: Number.isInteger(source.maxChildren) ? source.maxChildren : DEFAULT_BUDGET.maxChildren,
    childTimeoutSeconds: Number.isInteger(source.childTimeoutSeconds) ? source.childTimeoutSeconds : DEFAULT_BUDGET.childTimeoutSeconds,
    runTimeoutSeconds: Number.isInteger(source.runTimeoutSeconds) ? source.runTimeoutSeconds : DEFAULT_BUDGET.runTimeoutSeconds,
    retry: Number.isInteger(source.retry) ? source.retry : DEFAULT_BUDGET.retry,
    nestedSwarm: source.nestedSwarm === true,
    childOutputBytes: Number.isInteger(source.childOutputBytes) ? source.childOutputBytes : DEFAULT_BUDGET.childOutputBytes,
    parentSummaryBytes: Number.isInteger(source.parentSummaryBytes) ? source.parentSummaryBytes : DEFAULT_BUDGET.parentSummaryBytes,
  };
}

export function intersectBudgets(...values) {
  const budgets = values.filter(Boolean).map(budgetOf);
  const all = budgets.length ? budgets : [DEFAULT_BUDGET];
  const result = {};
  for (const key of ["maxDepth", "maxConcurrency", "maxChildren", "childTimeoutSeconds", "runTimeoutSeconds", "retry", "childOutputBytes", "parentSummaryBytes"]) result[key] = Math.min(...all.map((budget) => budget[key]));
  result.nestedSwarm = all.every((budget) => budget.nestedSwarm === true);
  return Object.freeze(result);
}

function policyFrom(value) { return value?.policy?.subagents ?? value?.subagents ?? value?.budget ?? value ?? {}; }
function agentCanWrite(agent) { return Boolean(agent?.manifest?.writer || agent?.writer); }
function agentTools(agent) { return new Set(agent?.manifest?.tools?.allow ?? agent?.tools?.allow ?? []); }

export async function admitSwarm(entry, { profile, mode, run, agentRegistry, runtimeCapabilities = {}, depth = 0 } = {}) {
  if (!entry?.manifest || !entry?.graph) fail("recipe entry is not resolved", "INVALID_RECIPE_ENTRY");
  const manifest = entry.manifest;
  const envelope = intersectBudgets(manifest.budget, policyFrom(profile), policyFrom(mode), run?.budget, runtimeCapabilities.budget);
  if (depth > envelope.maxDepth) fail("requested swarm depth exceeds effective budget", "BUDGET_EXCEEDED");
  if (manifest.budget.nestedSwarm || envelope.nestedSwarm) fail("nested Swarm is disabled", "NESTED_SWARM_UNSUPPORTED");
  if (entry.graph.order.length > envelope.maxChildren || entry.graph.width > envelope.maxConcurrency) fail("recipe exceeds effective runtime budget", "BUDGET_EXCEEDED");
  const resolvedAgents = new Map();
  for (const node of entry.graph.order) {
    let agent = null;
    if (agentRegistry) {
      agent = await agentRegistry.resolve(node.agent, { profile });
      resolvedAgents.set(node.agent, agent);
    }
    const tools = agentTools(agent);
    if (manifest.readOnly && [...tools].some((tool) => MUTATING_TOOLS.has(tool))) fail(`read-only node ${node.id} exposes a mutating tool`, "CAPABILITY_ESCALATION");
    if (["tester", "verifier", "reviewer", "security-reviewer", "test-analyst", "source-verifier"].includes(agent?.rawId ?? node.agent) && tools.has("bash")) fail(`non-writer node ${node.id} exposes bash`, "CHILD_TOOL_POLICY_UNSUPPORTED");
    if (node.writer && !agentCanWrite(agent)) fail(`writer node ${node.id} references a read-only agent`, "CAPABILITY_ESCALATION");
    if (node.writer && node.workspace === "managed-worktree" && runtimeCapabilities.worktree !== true) fail(`writer node ${node.id} requires a negotiated worktree capability`, "WORKTREE_CAPABILITY_UNAVAILABLE");
  }
  const effectivePolicy = {
    readOnly: manifest.readOnly,
    writerPolicy: clone(manifest.writerPolicy),
    runtimeCapabilities: clone(runtimeCapabilities),
    depth,
  };
  const policyHash = digest(effectivePolicy);
  return Object.freeze({
    formatVersion: 1,
    recipeId: manifest.id,
    recipeVersion: manifest.version,
    recipeHash: entry.sourceHash,
    effectiveBudget: envelope,
    policyHash,
    agents: Object.freeze([...resolvedAgents.entries()].map(([id, agent]) => ({ id, sourceHash: agent?.sourceHash ?? null, receipt: agent?.receipt ?? null }))),
    capabilityStatus: runtimeCapabilities,
    depth,
  });
}

function safeJson(value) {
  const raw = JSON.stringify(canonical(value)).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
  if (Buffer.byteLength(raw, "utf8") > 256 * 1024) fail("compiled workflow payload is too large", "WORKFLOW_PAYLOAD_TOO_LARGE");
  return raw;
}

export function compileWorkflowScript(plan) {
  const encoded = Buffer.from(safeJson(plan), "utf8").toString("base64url");
  const literal = JSON.stringify(encoded);
  return `export default async function run(ctx){const plan=JSON.parse(Buffer.from(${literal},"base64url").toString("utf8"));return ctx.execute(plan)}`;
}

export function compileSwarmRequest(entry, admission, { requestId = `omp-swarm-${crypto.randomUUID()}`, input = {}, parentSessionId = null } = {}) {
  if (!admission?.policyHash || !SHA256.test(admission.policyHash)) fail("swarm admission receipt is missing", "NOT_ADMITTED");
  const nodes = entry.graph.order.map((node, index) => ({
    index,
    id: node.id,
    agent: node.agent,
    taskTemplate: node.taskTemplate,
    needs: [...(node.needs ?? [])].sort(),
    workspace: node.workspace,
    writer: node.writer,
    timeoutSeconds: node.timeoutSeconds,
    retry: node.retry,
  }));
  const plan = {
    formatVersion: 1,
    kind: "only-my-pi-swarm-plan",
    recipe: { id: entry.manifest.id, version: entry.manifest.version, sourceHash: entry.sourceHash },
    admission,
    input: bounded(input, 16384),
    parentSessionId: typeof parentSessionId === "string" ? parentSessionId.slice(0, 256) : null,
    nodes,
    verifierNode: entry.manifest.verifier,
    aggregation: clone(entry.manifest.aggregation),
    cancellation: clone(entry.manifest.cancellation),
  };
  const workflowScript = compileWorkflowScript(plan);
  return Object.freeze({
    formatVersion: 1,
    requestId,
    method: "spawn",
    source: { extension: "only-my-pi", kind: "schema-validated-workflow-compiler", schemaValidated: true },
    params: { workflowScript, async: true },
    plan: Object.freeze(plan),
    workflowScriptDigest: digest(workflowScript),
  });
}

export function aggregateSwarmResults(entry, results, { maxBytes = entry?.manifest?.aggregation?.maxOutputBytes ?? 65536 } = {}) {
  const byId = new Map((results ?? []).map((result) => [result.nodeId, result]));
  const ordered = entry.graph.order.map((node, index) => {
    const result = byId.get(node.id);
    if (!result) return { index, nodeId: node.id, status: "skipped_dependency_failed", result: null };
    return { index, nodeId: node.id, status: result.status ?? "failed", result: bounded(result.result ?? result, maxBytes) };
  });
  const verifier = ordered.find((item) => item.nodeId === entry.manifest.verifier);
  const failed = ordered.some((item) => ["failed", "timed_out", "cancelled", "skipped_dependency_failed", "budget_exhausted"].includes(item.status));
  const verifierPassed = verifier?.status === "completed" && verifier.result?.verdict !== "fail" && verifier.result?.status !== "FAIL";
  const verdict = failed || !verifierPassed ? "fail" : "pass";
  const output = { formatVersion: 1, verdict, verifierNode: entry.manifest.verifier, items: ordered, partial: failed, order: ordered.map((item) => item.nodeId) };
  const serialized = JSON.stringify(output);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) return { ...output, items: ordered.map((item) => ({ index: item.index, nodeId: item.nodeId, status: item.status, result: { truncated: true, digest: digest(JSON.stringify(item.result)) } })), truncated: true };
  return output;
}

export class SwarmRunController {
  constructor({ registry, agentRegistry, adapter, stateStore = new Map(), profile, mode, runtimeCapabilities = {} } = {}) {
    this.registry = registry;
    this.agentRegistry = agentRegistry;
    this.adapter = adapter;
    this.stateStore = stateStore;
    this.profile = profile;
    this.mode = mode;
    this.runtimeCapabilities = runtimeCapabilities;
    this.active = new Map();
  }
  async #get(id) { return typeof this.stateStore.get === "function" ? await this.stateStore.get(id) : this.stateStore.get(id) ?? null; }
  async #put(id, value) { if (typeof this.stateStore.put === "function") return this.stateStore.put(id, clone(value)); this.stateStore.set(id, clone(value)); return value; }
  async plan(recipeId, options = {}) {
    const entry = await this.registry.resolve(recipeId);
    const admission = await admitSwarm(entry, { profile: options.profile ?? this.profile, mode: options.mode ?? this.mode, run: options, agentRegistry: this.agentRegistry, runtimeCapabilities: options.runtimeCapabilities ?? this.runtimeCapabilities, depth: options.depth ?? 0 });
    const request = compileSwarmRequest(entry, admission, { input: options.input ?? {}, parentSessionId: options.parentSessionId });
    return { entry, admission, request, plan: { recipeId, sourceHash: entry.sourceHash, nodes: request.plan.nodes, budget: admission.effectiveBudget, writerPolicy: entry.manifest.writerPolicy } };
  }
  async run(recipeId, options = {}) {
    const runId = options.runId ?? crypto.randomUUID();
    const existing = await this.#get(runId);
    if (existing && TERMINAL_RUN_STATES.has(existing.status)) return existing;
    const prepared = await this.plan(recipeId, options);
    const state = existing ?? { formatVersion: 1, runId, recipeId, recipeHash: prepared.entry.sourceHash, status: "planned", verdict: null, admission: prepared.admission, items: [], transitions: [], admissionClosed: false, startedAt: new Date().toISOString() };
    state.status = "admitted";
    state.admissionClosed = true;
    state.transitions.push({ to: "admitted", at: new Date().toISOString() });
    await this.#put(runId, state);
    if (!this.adapter || typeof this.adapter.execute !== "function") {
      state.status = "failed";
      state.verdict = "blocked";
      state.reason = "LIVE_SWARM_REQUIRES_PI_SESSION";
      await this.#put(runId, state);
      return state;
    }
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener?.("abort", onAbort, { once: true });
    this.active.set(runId, { controller, state });
    state.status = "running";
    state.transitions.push({ to: "running", at: new Date().toISOString() });
    await this.#put(runId, state);
    try {
      const execution = await this.adapter.execute(prepared.request, { runId, signal: controller.signal, recipe: prepared.entry.manifest });
      if (controller.signal.aborted) {
        state.status = "cancelled";
        state.verdict = "cancelled";
        state.reason = "terminal cancellation proof";
        await this.#put(runId, state);
        return state;
      }
      if (!execution || !Array.isArray(execution.items)) {
        state.status = execution?.status === "UNAVAILABLE" ? "failed" : "interrupted";
        state.verdict = "blocked";
        state.reason = execution?.code ?? "CHILD_RUNTIME_NOT_TERMINAL";
        await this.#put(runId, state);
        return state;
      }
      const aggregate = aggregateSwarmResults(prepared.entry, execution.items, { maxBytes: prepared.entry.manifest.aggregation.maxOutputBytes });
      state.items = aggregate.items;
      state.aggregate = aggregate;
      state.status = aggregate.verdict === "pass" ? "completed" : "failed";
      state.verdict = aggregate.verdict;
      state.transitions.push({ to: state.status, at: new Date().toISOString() });
      await this.#put(runId, state);
      return state;
    } catch (error) {
      if (controller.signal.aborted || error?.code === "ABORT_ERR" || error?.name === "AbortError") {
        state.status = "cancelled";
        state.verdict = "cancelled";
        state.reason = "terminal cancellation proof";
      } else {
        state.status = "failed";
        state.verdict = "fail";
        state.reason = error?.code ?? "SWARM_EXECUTION_FAILED";
      }
      await this.#put(runId, state);
      return state;
    } finally {
      options.signal?.removeEventListener?.("abort", onAbort);
      this.active.delete(runId);
    }
  }
  async cancel(runId) {
    const active = this.active.get(runId);
    const state = active?.state ?? await this.#get(runId);
    if (!state) return { status: "UNKNOWN_RUN", runId };
    if (TERMINAL_RUN_STATES.has(state.status)) return state;
    state.admissionClosed = true;
    state.status = "stopping";
    await this.#put(runId, state);
    if (active?.controller) active.controller.abort();
    if (this.adapter?.stop) await this.adapter.stop(runId).catch(() => null);
    return { status: "CANCEL_REQUESTED", runId, admissionClosed: true };
  }
  async status(runId) { return this.#get(runId); }
}

export function createSwarmRunController(options = {}) { return new SwarmRunController(options); }
export { digest as swarmDigest };
