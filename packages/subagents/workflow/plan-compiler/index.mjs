import crypto from "node:crypto";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMPOSITES = new Set(["sequence", "pipeline", "parallel", "workflow"]);
const PRIMITIVES = new Set(["agent", "batch-swarm", "gate", "checkpoint", "approval", "loop-controller"]);
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

export class WorkflowPlanError extends Error {
  constructor(message, code = "WORKFLOW_PLAN_ERROR", details = {}) {
    super(`workflow-plan: ${message}`);
    this.name = "WorkflowPlanError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new WorkflowPlanError(message, code, details);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  const encoded = typeof value === "string" ? value : JSON.stringify(canonical(value));
  return `sha256:${crypto.createHash("sha256").update(encoded).digest("hex")}`;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalId(value, label) {
  if (!ID.test(value ?? "")) fail(`${label} must match ${ID}`, "INVALID_ID", { value });
  return value;
}

function namespace(prefix, id) {
  const joined = prefix ? `${prefix}--${id}` : id;
  if (joined.length <= 64 && ID.test(joined)) return joined;
  return `${joined.slice(0, 47).replace(/-+$/u, "")}-${digest(joined).slice(7, 23)}`;
}

function normalizeBudget(input = {}) {
  const budget = {
    maxNodes: input.maxNodes ?? 64,
    maxParallel: input.maxParallel ?? 8,
    maxDepth: input.maxDepth ?? 4,
    maxAttemptsPerNode: input.maxAttemptsPerNode ?? 1,
    maxWallTimeMs: input.maxWallTimeMs ?? 3_600_000,
    maxOutputBytes: input.maxOutputBytes ?? 1_048_576,
    maxAssignments: input.maxAssignments ?? 64,
    maxTokens: input.maxTokens ?? null,
    maxCostUsd: input.maxCostUsd ?? null,
  };
  for (const key of ["maxNodes", "maxParallel", "maxDepth", "maxAttemptsPerNode", "maxWallTimeMs", "maxOutputBytes", "maxAssignments"]) {
    if (!Number.isSafeInteger(budget[key]) || budget[key] < 1) {
      fail(`budget.${key} must be a positive safe integer`, "INVALID_BUDGET", { key });
    }
  }
  for (const key of ["maxTokens", "maxCostUsd"]) {
    if (budget[key] !== null && (!Number.isFinite(budget[key]) || budget[key] <= 0)) {
      fail(`budget.${key} must be null or positive`, "INVALID_BUDGET", { key });
    }
  }
  return budget;
}

function normalizePolicy(input = {}) {
  const policy = {
    workspace: input.workspace ?? "shared-read-only",
    mutation: input.mutation ?? "none",
    egress: {
      web: input.egress?.web ?? "deny",
      mcp: input.egress?.mcp ?? "deny",
      provider: input.egress?.provider ?? "allow",
    },
    tools: {
      allow: [...(input.tools?.allow ?? [])].sort(),
      deny: [...(input.tools?.deny ?? [])].sort(),
    },
  };
  if (!["shared-read-only", "shared-guarded", "managed-worktree"].includes(policy.workspace)) {
    fail("unsupported workspace policy", "INVALID_POLICY");
  }
  if (!["none", "guarded"].includes(policy.mutation)) fail("unsupported mutation policy", "INVALID_POLICY");
  for (const value of Object.values(policy.egress)) {
    if (!["allow", "deny", "ask"].includes(value)) fail("unsupported egress policy", "INVALID_POLICY");
  }
  const denied = new Set(policy.tools.deny);
  const overlap = policy.tools.allow.find((tool) => denied.has(tool));
  if (overlap) fail(`tool is both allowed and denied: ${overlap}`, "POLICY_ESCALATION");
  if (policy.mutation === "none" || policy.workspace === "shared-read-only") {
    const mutating = policy.tools.allow.find((tool) => MUTATING_TOOLS.has(tool));
    if (mutating) fail(`read-only policy allows mutating tool: ${mutating}`, "POLICY_ESCALATION");
  }
  return policy;
}

function graphFacts(nodes) {
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) fail(`duplicate plan node ${node.id}`, "DUPLICATE_NODE", { nodeId: node.id });
    byId.set(node.id, node);
  }
  const visiting = new Set();
  const visited = new Set();
  const order = [];
  const depth = new Map();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) fail(`plan cycle: ${[...trail, id].join(" -> ")}`, "WORKFLOW_CYCLE", { nodeId: id });
    if (visited.has(id)) return depth.get(id);
    const node = byId.get(id);
    if (!node) fail(`unknown node dependency: ${id}`, "UNKNOWN_NODE", { nodeId: id });
    visiting.add(id);
    const parentDepths = node.needs.map((need) => visit(need, [...trail, id]));
    visiting.delete(id);
    visited.add(id);
    const value = parentDepths.length === 0 ? 1 : Math.max(...parentDepths) + 1;
    depth.set(id, value);
    order.push(id);
    return value;
  };
  for (const id of [...byId.keys()].sort()) visit(id);
  const levels = new Map();
  for (const [id, value] of depth) levels.set(value, (levels.get(value) ?? 0) + 1);
  return {
    byId,
    order,
    depth: Math.max(0, ...depth.values()),
    width: Math.max(0, ...levels.values()),
  };
}

function worstCaseCriticalPathMs(facts) {
  const cost = new Map();
  for (const id of facts.order) {
    const node = facts.byId.get(id);
    const upstream = node.needs.map((dependency) => cost.get(dependency) ?? 0);
    const own = node.budget.timeoutMs * node.budget.maxAttempts;
    cost.set(id, own + (upstream.length === 0 ? 0 : Math.max(...upstream)));
  }
  return Math.max(0, ...cost.values());
}

function normalizePrimitive(source, id, inheritedNeeds, planBudget) {
  const kind = source.kind;
  if (!PRIMITIVES.has(kind)) fail(`unsupported primitive kind: ${kind}`, "UNKNOWN_NODE_KIND", { kind });
  const node = {
    id,
    kind,
    needs: [...new Set([...(inheritedNeeds ?? []), ...(source.needs ?? [])])].sort(),
    policy: normalizePolicy(source.policy),
    budget: {
      maxAttempts: source.budget?.maxAttempts ?? 1,
      timeoutMs: source.budget?.timeoutMs ?? Math.min(900_000, planBudget.maxWallTimeMs),
      maxOutputBytes: source.budget?.maxOutputBytes ?? Math.min(65_536, planBudget.maxOutputBytes),
      maxTokens: source.budget?.maxTokens ?? null,
      maxCostUsd: source.budget?.maxCostUsd ?? null,
    },
    cache: {
      mode: source.cache?.mode ?? "never",
      keyInputs: [...(source.cache?.keyInputs ?? [])].sort(),
    },
    idempotency: source.idempotency ?? "none",
  };
  if (!Number.isInteger(node.budget.maxAttempts) || node.budget.maxAttempts < 1) fail(`node ${id} has invalid attempts`, "INVALID_NODE_BUDGET");
  if (!Number.isInteger(node.budget.timeoutMs) || node.budget.timeoutMs < 1) fail(`node ${id} has invalid timeout`, "INVALID_NODE_BUDGET");
  if (!Number.isInteger(node.budget.maxOutputBytes) || node.budget.maxOutputBytes < 1) fail(`node ${id} has invalid output budget`, "INVALID_NODE_BUDGET");
  if (!["never", "content-addressed"].includes(node.cache.mode)) fail(`node ${id} has invalid cache mode`, "INVALID_CACHE_POLICY");
  if (!["none", "receipt", "content-addressed"].includes(node.idempotency)) fail(`node ${id} has invalid idempotency mode`, "INVALID_IDEMPOTENCY_POLICY");

  if (kind === "agent") {
    canonicalId(source.agentTemplateRef, `node ${id} agentTemplateRef`);
    node.agentTemplateRef = source.agentTemplateRef;
    node.assignment = clone(source.assignment ?? {});
    node.outputSchemaRef = source.outputSchemaRef ?? null;
  } else if (kind === "batch-swarm") {
    canonicalId(source.batchRef, `node ${id} batchRef`);
    node.batchRef = source.batchRef;
  } else if (kind === "gate") {
    canonicalId(source.gateId, `node ${id} gateId`);
    node.gateId = source.gateId;
  } else if (kind === "checkpoint") {
    node.checkpoint = clone(source.checkpoint ?? { scope: "workspace", restore: "review-plan-only" });
  } else if (kind === "approval") {
    node.approval = clone(source.approval ?? {});
    if (!node.approval.scopeDigest || !SHA256.test(node.approval.scopeDigest)) fail(`approval node ${id} requires scopeDigest`, "INVALID_APPROVAL");
  } else if (kind === "loop-controller") {
    node.loop = clone(source.loop ?? {});
    if (!Number.isInteger(node.loop.maxIterations) || node.loop.maxIterations < 1 || node.loop.maxIterations > 64) {
      fail(`loop node ${id} requires bounded maxIterations`, "UNBOUNDED_LOOP");
    }
    canonicalId(node.loop.conditionRef, `node ${id} conditionRef`);
    node.loop.bodyDefinitionDigest = source.loop.bodyDefinitionDigest;
    if (!SHA256.test(node.loop.bodyDefinitionDigest ?? "")) fail(`loop node ${id} requires bodyDefinitionDigest`, "INVALID_LOOP");
  }
  const mutating = node.policy.mutation !== "none" || node.policy.tools.allow.some((tool) => MUTATING_TOOLS.has(tool));
  if (mutating && node.idempotency === "none" && node.cache.mode !== "never") {
    fail(`mutating node ${id} cannot use cache without idempotency proof`, "UNSAFE_REPLAY");
  }
  return node;
}

function compileTree(source, context) {
  if (!object(source)) fail("workflow tree node must be an object", "INVALID_DEFINITION");
  const kind = source.kind;
  if (PRIMITIVES.has(kind)) {
    const rawId = canonicalId(source.id, "node id");
    const id = namespace(context.prefix, rawId);
    const node = normalizePrimitive(source, id, context.inheritedNeeds, context.planBudget);
    context.nodes.push(node);
    return { entries: [id], exits: [id] };
  }
  if (!COMPOSITES.has(kind)) fail(`unsupported workflow combinator: ${kind}`, "UNKNOWN_COMBINATOR", { kind });

  if (kind === "workflow") {
    canonicalId(source.workflowRef, "workflowRef");
    if (context.stack.includes(source.workflowRef)) fail(`nested workflow cycle: ${[...context.stack, source.workflowRef].join(" -> ")}`, "WORKFLOW_CYCLE");
    const nested = context.resolveWorkflow?.(source.workflowRef);
    if (!nested) fail(`unknown nested workflow: ${source.workflowRef}`, "UNKNOWN_WORKFLOW", { workflowRef: source.workflowRef });
    const nestedPrefix = namespace(context.prefix, source.id ?? source.workflowRef);
    return compileTree(nested.flow, { ...context, prefix: nestedPrefix, stack: [...context.stack, source.workflowRef] });
  }

  const children = source.steps ?? source.stages ?? source.branches;
  if (!Array.isArray(children) || children.length === 0) fail(`${kind} must contain children`, "INVALID_DEFINITION");
  if (kind === "parallel") {
    const compiled = children.map((child) => compileTree(child, { ...context, inheritedNeeds: [...context.inheritedNeeds] }));
    return { entries: compiled.flatMap((value) => value.entries), exits: compiled.flatMap((value) => value.exits) };
  }
  let needs = [...context.inheritedNeeds];
  let entries = [];
  let exits = [];
  for (let index = 0; index < children.length; index += 1) {
    const compiled = compileTree(children[index], { ...context, inheritedNeeds: needs });
    if (index === 0) entries = compiled.entries;
    exits = compiled.exits;
    needs = compiled.exits;
  }
  return { entries, exits };
}

function sourceWithoutSchema(definition) {
  const value = clone(definition);
  delete value.$schema;
  return value;
}

export function validateWorkflowPlan(plan) {
  try {
    if (!object(plan) || plan.formatVersion !== 1 || !Array.isArray(plan.nodes)) fail("invalid WorkflowPlan", "INVALID_PLAN");
    if (!ID.test(plan.id ?? "") || !Number.isInteger(plan.revision?.number) || plan.revision.number < 0) fail("invalid plan identity", "INVALID_PLAN");
    if (plan.revision.number === 0 && plan.revision.parentPlanDigest !== null) fail("revision zero cannot have a parent", "INVALID_REVISION");
    if (plan.revision.number > 0 && !SHA256.test(plan.revision.parentPlanDigest ?? "")) fail("revised plan requires parent digest", "INVALID_REVISION");
    const facts = graphFacts(plan.nodes);
    if (!facts.byId.has(plan.terminalNodeId)) fail("terminal node is missing", "UNKNOWN_TERMINAL");
    if (facts.order.length > plan.budget.maxNodes || facts.width > plan.budget.maxParallel || facts.depth > plan.budget.maxDepth) fail("plan exceeds its graph budget", "BUDGET_EXCEEDED");
    for (const node of plan.nodes) {
      if (!PRIMITIVES.has(node.kind)) fail(`unknown plan primitive ${node.kind}`, "UNKNOWN_NODE_KIND");
      if (node.budget.maxAttempts > plan.budget.maxAttemptsPerNode) fail(`node ${node.id} attempts exceed plan budget`, "BUDGET_EXCEEDED");
      if (node.budget.timeoutMs > plan.budget.maxWallTimeMs) fail(`node ${node.id} timeout exceeds plan wall budget`, "BUDGET_EXCEEDED");
      for (const dependency of node.needs) if (!facts.byId.has(dependency)) fail(`unknown dependency ${dependency}`, "UNKNOWN_NODE");
    }
    if (worstCaseCriticalPathMs(facts) > plan.budget.maxWallTimeMs) fail("plan critical path exceeds maxWallTimeMs", "BUDGET_EXCEEDED");
    const withoutDigest = clone(plan);
    delete withoutDigest.planDigest;
    if (plan.planDigest !== digest(withoutDigest)) fail("WorkflowPlan digest mismatch", "PLAN_DIGEST_MISMATCH");
    return { valid: true, errors: [], facts };
  } catch (error) {
    if (error instanceof WorkflowPlanError) return { valid: false, errors: [{ code: error.code, message: error.message }] };
    throw error;
  }
}

export function compileWorkflowDefinition(definition, options = {}) {
  if (!object(definition) || definition.formatVersion !== 2) fail("WorkflowDefinition v2 is required", "INVALID_DEFINITION");
  canonicalId(definition.id, "workflow id");
  if (!object(definition.flow)) fail("definition.flow is required", "INVALID_DEFINITION");
  const budget = normalizeBudget(definition.budget);
  const policy = normalizePolicy(definition.policy);
  const revision = {
    number: options.revision?.number ?? 0,
    parentPlanDigest: options.revision?.parentPlanDigest ?? null,
    reason: options.revision?.reason ?? "initial-compile",
    activationPolicy: options.revision?.activationPolicy ?? "drain",
  };
  if (!Number.isInteger(revision.number) || revision.number < 0) fail("invalid revision number", "INVALID_REVISION");
  if (revision.number === 0 && revision.parentPlanDigest !== null) fail("revision zero cannot have a parent", "INVALID_REVISION");
  if (revision.number > 0 && !SHA256.test(revision.parentPlanDigest ?? "")) fail("revised plan requires parent digest", "INVALID_REVISION");
  if (!["drain", "stop"].includes(revision.activationPolicy)) fail("invalid revision activation policy", "INVALID_REVISION");

  const nodes = [];
  const compiled = compileTree(definition.flow, {
    prefix: "",
    inheritedNeeds: [],
    nodes,
    stack: [definition.id],
    resolveWorkflow: options.resolveWorkflow,
    planBudget: budget,
  });
  const facts = graphFacts(nodes);
  if (nodes.length > budget.maxNodes) fail("definition exceeds maxNodes", "BUDGET_EXCEEDED");
  if (facts.width > budget.maxParallel) fail("definition exceeds maxParallel", "BUDGET_EXCEEDED");
  if (facts.depth > budget.maxDepth) fail("definition exceeds maxDepth", "BUDGET_EXCEEDED");
  if (nodes.some((node) => node.budget.maxAttempts > budget.maxAttemptsPerNode)) fail("node retry envelope exceeds plan budget", "BUDGET_EXCEEDED");
  if (nodes.some((node) => node.budget.timeoutMs > budget.maxWallTimeMs)) fail("node timeout exceeds plan wall budget", "BUDGET_EXCEEDED");
  if (worstCaseCriticalPathMs(facts) > budget.maxWallTimeMs) fail("definition critical path exceeds maxWallTimeMs", "BUDGET_EXCEEDED");
  if (nodes.filter((node) => node.kind === "agent" || node.kind === "batch-swarm").length > budget.maxAssignments) fail("definition exceeds maxAssignments", "BUDGET_EXCEEDED");

  const terminalNodeId = definition.terminalNodeId ? namespace("", definition.terminalNodeId) : compiled.exits.at(-1);
  if (!facts.byId.has(terminalNodeId)) fail(`unknown terminal node ${terminalNodeId}`, "UNKNOWN_TERMINAL");
  const sourceDigest = digest(sourceWithoutSchema(definition));
  const plan = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-plan-v1.schema.json",
    formatVersion: 1,
    contractStatus: "contract-preview",
    id: definition.id,
    definitionVersion: definition.version,
    definitionDigest: sourceDigest,
    revision,
    policy,
    policyDigest: digest(policy),
    budget,
    nodes: nodes.map((node) => canonical(node)).sort((left, right) => left.id.localeCompare(right.id)),
    entryNodeIds: [...compiled.entries].sort(),
    terminalNodeId,
    planDigest: null,
  };
  plan.planDigest = digest({ ...plan, planDigest: undefined });
  const checked = validateWorkflowPlan(plan);
  if (!checked.valid) fail(checked.errors[0].message, checked.errors[0].code);
  return deepFreeze(plan);
}

export function diffWorkflowPlans(previous, next) {
  const before = validateWorkflowPlan(previous);
  const after = validateWorkflowPlan(next);
  if (!before.valid) fail("previous plan is invalid", before.errors[0].code);
  if (!after.valid) fail("next plan is invalid", after.errors[0].code);
  if (next.revision.parentPlanDigest !== previous.planDigest || next.revision.number !== previous.revision.number + 1) {
    fail("revision ancestry mismatch", "INVALID_REVISION_ANCESTRY");
  }
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
  const added = [...nextNodes.keys()].filter((id) => !previousNodes.has(id)).sort();
  const removed = [...previousNodes.keys()].filter((id) => !nextNodes.has(id)).sort();
  const changed = [...nextNodes.keys()].filter((id) => previousNodes.has(id) && digest(previousNodes.get(id)) !== digest(nextNodes.get(id))).sort();
  const widensMutation = next.nodes.some((node) => {
    const beforeNode = previousNodes.get(node.id);
    if (!beforeNode) return node.policy.mutation !== "none";
    return beforeNode.policy.mutation === "none" && node.policy.mutation !== "none";
  });
  const widensEgress = next.nodes.some((node) => {
    const beforeNode = previousNodes.get(node.id);
    if (!beforeNode) return Object.values(node.policy.egress).some((value) => value !== "deny");
    return Object.keys(node.policy.egress).some((key) => beforeNode.policy.egress[key] === "deny" && node.policy.egress[key] !== "deny");
  });
  return deepFreeze({
    formatVersion: 1,
    previousPlanDigest: previous.planDigest,
    nextPlanDigest: next.planDigest,
    added,
    removed,
    changed,
    approvalRequired: added.length > 0 || removed.length > 0 || changed.length > 0,
    widensMutation,
    widensEgress,
    diffDigest: digest({ added, removed, changed, widensMutation, widensEgress }),
  });
}

export const WORKFLOW_PLAN_PRIMITIVES = Object.freeze([...PRIMITIVES].sort());
export { canonical as canonicalWorkflowValue, digest as digestWorkflowValue };
