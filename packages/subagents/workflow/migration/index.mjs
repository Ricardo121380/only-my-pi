import crypto from "node:crypto";

import { compileWorkflowDefinition } from "../plan-compiler/index.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export class WorkflowMigrationError extends Error {
  constructor(message, code = "WORKFLOW_MIGRATION_ERROR", details = {}) {
    super(`workflow-migration: ${message}`);
    this.name = "WorkflowMigrationError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) {
  throw new WorkflowMigrationError(message, code, details);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function id(value, label) {
  if (!ID.test(value ?? "")) fail(`${label} is not a canonical id`, "INVALID_LEGACY_RESOURCE", { value });
  return value;
}

function planPolicy({ writer = false, workspace = "shared-read-only", readOnly = true } = {}) {
  return writer
    ? {
        workspace: "managed-worktree",
        mutation: "guarded",
        egress: { web: "deny", mcp: "deny", provider: "allow" },
        tools: { allow: ["edit", "write"], deny: [] },
      }
    : {
        workspace: workspace === "managed-worktree" ? "shared-read-only" : workspace,
        mutation: "none",
        egress: { web: readOnly ? "deny" : "ask", mcp: "deny", provider: "allow" },
        tools: { allow: ["read"], deny: ["bash", "edit", "write"] },
      };
}

function nodeBudget(timeoutSeconds, retry, outputBytes) {
  return {
    maxAttempts: (retry ?? 0) + 1,
    timeoutMs: (timeoutSeconds ?? 900) * 1000,
    maxOutputBytes: outputBytes ?? 65_536,
    maxTokens: null,
    maxCostUsd: null,
  };
}

function approvalNode(step, needs, prefix = "") {
  const approvalId = `${prefix}${step.id}-approval`;
  return {
    kind: "approval",
    id: approvalId,
    needs,
    policy: planPolicy({ readOnly: false }),
    budget: nodeBudget(60, 0, 4096),
    cache: { mode: "never", keyInputs: [] },
    idempotency: "receipt",
    approval: {
      origin: "legacy-user-approval",
      scopeDigest: digest({ step: step.id, action: step.action, policyRef: step.policyRef }),
    },
  };
}

function legacyAgentNode(node, { prefix = "", inheritedNeeds = [], readOnly = true, childOutputBytes = 65_536 } = {}) {
  const nodeId = `${prefix}${node.id}`;
  return {
    kind: "agent",
    id: nodeId,
    agentTemplateRef: id(node.agent, `legacy node ${node.id} agent`),
    needs: [...new Set([...inheritedNeeds, ...(node.needs ?? []).map((need) => `${prefix}${need}`)])].sort(),
    assignment: {
      taskTemplateRef: id(node.taskTemplate ?? `legacy-${node.id}`, `legacy node ${node.id} task template`),
      migrationSource: "swarm-recipe-v1",
      legacyNodeId: node.id,
    },
    outputSchemaRef: null,
    policy: planPolicy({ writer: node.writer === true, workspace: node.workspace, readOnly }),
    budget: nodeBudget(node.timeoutSeconds, node.retry, childOutputBytes),
    cache: { mode: node.writer ? "never" : "content-addressed", keyInputs: ["assignment", "dependencies"] },
    idempotency: node.writer ? "receipt" : "content-addressed",
  };
}

function recipeTerminals(recipe) {
  const dependedOn = new Set(recipe.nodes.flatMap((node) => node.needs ?? []));
  return recipe.nodes.filter((node) => !dependedOn.has(node.id)).map((node) => node.id).sort();
}

function assertLegacyRecipe(recipe) {
  if (!recipe || recipe.formatVersion !== 1 || !Array.isArray(recipe.nodes) || recipe.nodes.length === 0) fail("invalid swarm-recipe-v1 resource", "INVALID_LEGACY_RESOURCE");
  id(recipe.id, "legacy recipe id");
  const ids = new Set();
  for (const node of recipe.nodes) {
    id(node.id, "legacy recipe node id");
    if (ids.has(node.id)) fail(`duplicate legacy recipe node ${node.id}`, "DUPLICATE_NODE");
    ids.add(node.id);
  }
  for (const node of recipe.nodes) for (const need of node.needs ?? []) if (!ids.has(need)) fail(`unknown legacy dependency ${need}`, "UNKNOWN_NODE");
  return ids;
}

export function translateLegacySwarmRecipe(recipe) {
  assertLegacyRecipe(recipe);
  const maxAttempts = Math.max(1, ...recipe.nodes.map((node) => (node.retry ?? 0) + 1));
  const definition = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: `${recipe.id}-workflow-v2`,
    version: "2.0.0",
    description: `Migrated heterogeneous Workflow from legacy swarm-recipe-v1 ${recipe.id}; this is not a BatchSwarm.`,
    policy: planPolicy({ readOnly: recipe.readOnly }),
    budget: {
      maxNodes: recipe.nodes.length,
      maxParallel: recipe.budget.maxConcurrency,
      maxDepth: Math.max(1, recipe.nodes.length),
      maxAttemptsPerNode: maxAttempts,
      maxWallTimeMs: recipe.budget.runTimeoutSeconds * 1000,
      maxOutputBytes: recipe.aggregation.maxOutputBytes,
      maxAssignments: recipe.nodes.length,
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: {
      kind: "parallel",
      branches: recipe.nodes.map((node) => legacyAgentNode(node, {
        readOnly: recipe.readOnly,
        childOutputBytes: recipe.budget.childOutputBytes,
      })),
    },
    terminalNodeId: recipe.verifier,
    migration: {
      sourceKind: "swarm-recipe-v1",
      sourceId: recipe.id,
      sourceVersion: recipe.version,
      sourceDigest: digest(recipe),
      taxonomy: "heterogeneous-workflow",
    },
  };
  // Migration metadata is kept out of the canonical authoring schema and is
  // returned beside the schema-valid definition.
  const migration = definition.migration;
  delete definition.migration;
  return Object.freeze({ definition: clone(definition), migration: Object.freeze(migration), plan: compileWorkflowDefinition(definition) });
}

function assertLegacyWorkflow(workflow) {
  if (!workflow || workflow.formatVersion !== 1 || !Array.isArray(workflow.steps) || workflow.steps.length === 0) fail("invalid workflow-v1 resource", "INVALID_LEGACY_RESOURCE");
  id(workflow.id, "legacy workflow id");
  const ids = new Set();
  for (const step of workflow.steps) {
    id(step.id, "legacy step id");
    if (ids.has(step.id)) fail(`duplicate legacy workflow step ${step.id}`, "DUPLICATE_NODE");
    ids.add(step.id);
  }
  for (const step of workflow.steps) for (const need of step.needs ?? []) if (!ids.has(need)) fail(`unknown legacy workflow dependency ${need}`, "UNKNOWN_NODE");
  if (!ids.has(workflow.terminal?.step)) fail("legacy terminal step is missing", "UNKNOWN_TERMINAL");
}

function translateLegacyStep(step, workflow, resolveRecipe) {
  const inheritedNeeds = [...(step.needs ?? [])];
  const nodes = [];
  const defaultStepSeconds = Math.max(1, Math.floor(workflow.budget.timeoutSeconds / workflow.budget.maxSteps));
  let directNeeds = inheritedNeeds;
  if (step.approval === "user") {
    const approval = approvalNode(step, inheritedNeeds);
    nodes.push(approval);
    directNeeds = [approval.id];
  }
  if (step.action === "agent") {
    nodes.push({
      kind: "agent",
      id: step.id,
      agentTemplateRef: id(step.agent, `legacy step ${step.id} agent`),
      needs: directNeeds,
      assignment: {
        taskTemplateRef: `legacy-${step.id}`,
        migrationSource: "workflow-v1",
        policyRef: step.policyRef,
      },
      outputSchemaRef: null,
      policy: planPolicy({ writer: workflow.mutationScope !== "none" && ["implement", "debug"].includes(step.id), readOnly: workflow.mutationScope === "none" }),
      budget: nodeBudget(step.timeoutSeconds ?? defaultStepSeconds, step.retry, workflow.budget.maxOutputBytes),
      cache: { mode: workflow.mutationScope === "none" ? "content-addressed" : "never", keyInputs: ["assignment", "dependencies"] },
      idempotency: workflow.mutationScope === "none" ? "content-addressed" : "receipt",
    });
    return nodes;
  }
  if (step.action === "gate") {
    nodes.push({
      kind: "gate",
      id: step.id,
      gateId: id(step.gate, `legacy step ${step.id} gate`),
      needs: directNeeds,
      policy: planPolicy({ readOnly: true }),
      budget: nodeBudget(step.timeoutSeconds ?? defaultStepSeconds, step.retry, workflow.budget.maxOutputBytes),
      cache: { mode: "never", keyInputs: [] },
      idempotency: "receipt",
    });
    return nodes;
  }
  if (step.action === "swarm") {
    if (typeof resolveRecipe !== "function") fail(`legacy swarm step ${step.id} requires a recipe resolver`, "RECIPE_RESOLVER_UNAVAILABLE");
    const recipe = resolveRecipe(step.recipe);
    if (!recipe) fail(`unknown legacy recipe ${step.recipe}`, "UNKNOWN_RECIPE");
    assertLegacyRecipe(recipe);
    const prefix = `${step.id}--`;
    for (const node of recipe.nodes) {
      nodes.push(legacyAgentNode(node, {
        prefix,
        inheritedNeeds: (node.needs ?? []).length === 0 ? directNeeds : [],
        readOnly: recipe.readOnly,
        childOutputBytes: recipe.budget.childOutputBytes,
      }));
    }
    nodes.push({
      kind: "checkpoint",
      id: step.id,
      needs: recipeTerminals(recipe).map((nodeId) => `${prefix}${nodeId}`),
      checkpoint: { scope: "logical-barrier", restore: "not-applicable", migratedRecipe: recipe.id },
      policy: planPolicy({ readOnly: recipe.readOnly }),
      budget: nodeBudget(60, 0, 4096),
      cache: { mode: "never", keyInputs: [] },
      idempotency: "receipt",
    });
    return nodes;
  }
  fail(`unsupported legacy workflow action ${step.action}`, "UNKNOWN_LEGACY_ACTION");
}

export function translateLegacyWorkflow(workflow, { resolveRecipe } = {}) {
  assertLegacyWorkflow(workflow);
  const branches = workflow.steps.flatMap((step) => translateLegacyStep(step, workflow, resolveRecipe));
  const maxAttempts = Math.max(1, ...branches.map((node) => node.budget.maxAttempts));
  const definition = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/workflow-definition-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    id: `${workflow.id}-v2`,
    version: "2.0.0",
    description: `Migrated WorkflowDefinition from workflow-v1 ${workflow.id}.`,
    policy: planPolicy({ readOnly: workflow.mutationScope === "none" }),
    budget: {
      maxNodes: Math.max(branches.length, workflow.budget.maxSteps),
      maxParallel: workflow.budget.maxParallel ?? 1,
      maxDepth: Math.max(branches.length, 1),
      maxAttemptsPerNode: maxAttempts,
      maxWallTimeMs: workflow.budget.timeoutSeconds * 1000,
      maxOutputBytes: workflow.budget.maxOutputBytes,
      maxAssignments: Math.max(1, branches.filter((node) => node.kind === "agent" || node.kind === "batch-swarm").length),
      maxTokens: null,
      maxCostUsd: null,
    },
    flow: { kind: "parallel", branches },
    terminalNodeId: workflow.terminal.step,
  };
  const migration = Object.freeze({
    sourceKind: "workflow-v1",
    sourceId: workflow.id,
    sourceVersion: workflow.version,
    sourceDigest: digest(workflow),
    fallbackWorkflow: workflow.fallback?.workflow ?? null,
  });
  return Object.freeze({ definition: clone(definition), migration, plan: compileWorkflowDefinition(definition) });
}

export function migrateLegacyCatalog({ workflows, recipes }) {
  const recipeMap = new Map((recipes ?? []).map((recipe) => [recipe.id, recipe]));
  return Object.freeze({
    workflowMigrations: Object.freeze((workflows ?? []).map((workflow) => translateLegacyWorkflow(workflow, { resolveRecipe: (id) => recipeMap.get(id) }))),
    recipeMigrations: Object.freeze((recipes ?? []).map(translateLegacySwarmRecipe)),
  });
}
