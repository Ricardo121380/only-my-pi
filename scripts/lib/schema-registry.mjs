import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { parsePackageSpec, validatePackageEntrySource } from "./package-source.mjs";
import {
  compileWorkflowDefinition,
  digestWorkflowValue,
  validateWorkflowPlan,
} from "../../packages/subagents/workflow/plan-compiler/index.mjs";
import {
  approvalReceiptId,
  approvalReceiptSemanticFindings,
} from "../../packages/subagents/policy/approval-receipt.mjs";
import { assignmentPathClaimCovered } from "../../packages/subagents/domain/assignment.mjs";
import {
  validateCompatibilityMatrix,
  validatePromotionPolicy,
} from "../../packages/subagents/release/compatibility.mjs";
import {
  validateProtectedEvidenceDocument,
  validateProtectedEvidenceTrustPolicy,
} from "../../packages/subagents/release/protected-evidence.mjs";
import { validateLiveEvidenceAuthorization } from "../../packages/subagents/release/live-evidence-authorization.mjs";
import { validateLiveEvidenceProviderDescriptor } from "../../packages/subagents/release/live-evidence-provider.mjs";
import { validateBackgroundResumeAuthorization } from "../../packages/subagents/release/background-resume-authorization.mjs";
import { sha256 as stateSha256, withoutKey } from "../../packages/subagents/state/codec.mjs";
import { validateUpstreamCompatibility } from "../../packages/upstream-compatibility/index.mjs";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_CATALOG = "contracts/schema-catalog.json";
const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
const READ_ONLY_WORKSPACES = new Set(["none", "read-only"]);

function error(instancePath, keyword, message, params = {}) {
  return { instancePath, schemaPath: "#/semantic", keyword, message, params };
}

function normalizedAjvErrors(errors = []) {
  return errors.map(({ instancePath = "", schemaPath = "", keyword = "validation", message = "validation failed", params = {} }) => ({
    instancePath,
    schemaPath,
    keyword,
    message,
    params,
  }));
}

function ensureContained(rootDir, relativePath, { mustExist = true } = {}) {
  if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    throw new Error(`contract path must be a non-empty repository-relative path: ${relativePath}`);
  }
  const target = path.resolve(rootDir, relativePath);
  const rel = path.relative(rootDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`contract path escapes repository: ${relativePath}`);
  if (mustExist) {
    const realRoot = fs.realpathSync(rootDir);
    const realTarget = fs.realpathSync(target);
    const realRel = path.relative(realRoot, realTarget);
    if (realRel.startsWith("..") || path.isAbsolute(realRel)) throw new Error(`contract path symlink escapes repository: ${relativePath}`);
  }
  return target;
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) value.forEach((entry) => collectRefs(entry, refs));
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "$ref" && typeof entry === "string") refs.push(entry);
      else collectRefs(entry, refs);
    }
  }
  return refs;
}

function validateSchemaRefs(schema, knownIds) {
  for (const ref of collectRefs(schema)) {
    if (ref.startsWith("#")) continue;
    if (ref.includes("\0") || ref.startsWith("/") || ref.startsWith(".") || ref.includes("/../")) throw new Error(`unsafe schema $ref: ${ref}`);
    const [base] = ref.split("#", 1);
    if (!knownIds.has(base)) throw new Error(`schema $ref is not in the local catalog: ${ref}`);
  }
}

function globRegex(pattern) {
  let output = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        output += ".*";
        i += 1;
      } else output += "[^/]*";
    } else if (char === "?") output += "[^/]";
    else output += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${output}$`);
}

function walkFiles(rootDir) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(path.relative(rootDir, absolute).split(path.sep).join("/"));
    }
  };
  visit(rootDir);
  return files;
}

function expandProductionGlobs(rootDir, patterns, allFiles) {
  const result = new Set();
  for (const pattern of patterns) {
    ensureContained(rootDir, pattern.replace(/[?*].*$/, "placeholder"), { mustExist: false });
    const regex = globRegex(pattern);
    for (const file of allFiles) if (regex.test(file)) result.add(file);
  }
  return [...result].sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function duplicateIds(entries, basePath) {
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < entries.length; index += 1) {
    const id = entries[index]?.id;
    if (typeof id !== "string") continue;
    if (seen.has(id)) errors.push(error(`${basePath}/${index}/id`, "duplicate-id", `duplicate id: ${id}`, { id }));
    seen.add(id);
  }
  return errors;
}

function graphErrors(entries, basePath) {
  const errors = [...duplicateIds(entries, basePath)];
  const ids = new Set(entries.map((entry) => entry?.id).filter((id) => typeof id === "string"));
  const graph = new Map();
  entries.forEach((entry, index) => {
    const needs = Array.isArray(entry?.needs) ? entry.needs : [];
    graph.set(entry?.id, needs);
    for (const need of needs) if (!ids.has(need)) errors.push(error(`${basePath}/${index}/needs`, "unknown-reference", `unknown dependency: ${need}`, { id: need }));
  });
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, trail = []) => {
    if (visiting.has(id)) {
      errors.push(error(basePath, "cycle", `dependency cycle: ${[...trail, id].join(" -> ")}`, { id }));
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) visit(next, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return errors;
}

function dependencyGraph(entries) {
  const ids = new Set(entries.map((entry) => entry?.id).filter((id) => typeof id === "string"));
  return new Map(entries
    .filter((entry) => typeof entry?.id === "string")
    .map((entry) => [entry.id, (entry.needs ?? []).filter((need) => ids.has(need))]));
}

function graphHasCycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) if (visit(dependency)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some((id) => visit(id));
}

function transitiveDependencies(graph, id, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  const result = new Set();
  memo.set(id, result);
  for (const dependency of graph.get(id) ?? []) {
    result.add(dependency);
    for (const ancestor of transitiveDependencies(graph, dependency, memo)) result.add(ancestor);
  }
  return result;
}

// Dilworth's theorem: DAG width is |V| minus a maximum matching in the
// transitive-closure bipartite graph. This catches parallelism hidden behind
// more than one dependency level, not only the number of root nodes.
function graphWidth(graph) {
  if (graphHasCycle(graph)) return Number.POSITIVE_INFINITY;
  const ids = [...graph.keys()];
  const memo = new Map();
  const successors = new Map(ids.map((id) => [id, []]));
  for (const node of ids) {
    for (const dependency of transitiveDependencies(graph, node, memo)) successors.get(dependency)?.push(node);
  }
  const matchByRight = new Map();
  const augment = (left, seen) => {
    for (const right of successors.get(left) ?? []) {
      if (seen.has(right)) continue;
      seen.add(right);
      const previous = matchByRight.get(right);
      if (previous === undefined || augment(previous, seen)) {
        matchByRight.set(right, left);
        return true;
      }
    }
    return false;
  };
  let matching = 0;
  for (const id of ids) if (augment(id, new Set())) matching += 1;
  return ids.length - matching;
}

function longestPathCost(graph, costById) {
  if (graphHasCycle(graph)) return Number.POSITIVE_INFINITY;
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const upstream = (graph.get(id) ?? []).map(visit);
    const total = (costById.get(id) ?? 0) + (upstream.length === 0 ? 0 : Math.max(...upstream));
    memo.set(id, total);
    return total;
  };
  return Math.max(0, ...[...graph.keys()].map(visit));
}

function isCapabilityForEgress(id, dimension, index) {
  const surfaces = new Set(index.capabilityDefinitions.get(id)?.surfaces ?? []);
  const surfaceByDimension = {
    web: ["webEgress"],
    mcp: ["mcpEgress"],
    provider: ["providerEgress"],
    network: ["webEgress", "mcpEgress", "providerEgress"],
  };
  if ((surfaceByDimension[dimension] ?? []).some((surface) => surfaces.has(surface))) return true;
  const prefix = dimension === "network" ? /^(?:web|mcp|network|provider)(?:-|$)/ : new RegExp(`^${dimension}(?:-|$)`);
  return prefix.test(id);
}

function policyBoundaryErrors({ tools, capabilities, policy, writer, basePath = "", capabilityPath = `${basePath}/requiredCapabilities` }, index) {
  const errors = [];
  const allowedTools = new Set([...(tools?.allow ?? []), ...(tools?.required ?? [])]);
  if (READ_ONLY_WORKSPACES.has(policy?.workspace)) {
    for (const tool of allowedTools) {
      if (MUTATING_TOOLS.has(tool)) errors.push(error(`${basePath}/tools/allow`, "capability-escalation", `${policy.workspace} workspace cannot allow mutating tool: ${tool}`, { tool, workspace: policy.workspace }));
    }
    if (writer === true) errors.push(error(`${basePath}/writer`, "capability-escalation", `${policy.workspace} workspace cannot declare a writer`, { workspace: policy.workspace }));
  }
  if (writer === false) {
    for (const tool of allowedTools) if (MUTATING_TOOLS.has(tool)) errors.push(error(`${basePath}/tools/allow`, "capability-escalation", `read-only agent cannot allow mutating tool: ${tool}`, { tool }));
  }
  if (policy?.mutation === "none") {
    if (writer === true) errors.push(error(`${basePath}/writer`, "capability-escalation", "mutation:none cannot declare a writer"));
    for (const tool of allowedTools) if (MUTATING_TOOLS.has(tool)) errors.push(error(`${basePath}/tools/allow`, "capability-escalation", `mutation:none cannot allow mutating tool: ${tool}`, { tool }));
  }

  const toolByDimension = {
    web: new Set(["web"]),
    mcp: new Set(["mcp"]),
    provider: new Set(["provider"]),
    network: new Set(["web", "mcp", "provider", "network"]),
  };
  for (const dimension of ["web", "mcp", "network", "provider"]) {
    if (policy?.egress?.[dimension] !== "deny") continue;
    for (const tool of allowedTools) {
      if (toolByDimension[dimension].has(tool)) errors.push(error(`${basePath}/tools/allow`, "egress-escalation", `${dimension} egress is denied but tool is allowed: ${tool}`, { dimension, tool }));
    }
    for (const capability of capabilities ?? []) {
      if (isCapabilityForEgress(capability, dimension, index)) errors.push(error(capabilityPath, "egress-escalation", `${dimension} egress is denied but capability is required: ${capability}`, { dimension, capability }));
    }
  }
  return errors;
}

function ioSchemaReferenceErrors(document) {
  const errors = [];
  for (const field of ["inputSchema", "outputSchema"]) {
    const properties = new Set(Object.keys(document[field]?.properties ?? {}));
    for (const required of document[field]?.required ?? []) {
      if (!properties.has(required)) errors.push(error(`/${field}/required`, "unknown-reference", `${field} required key is not declared in properties: ${required}`, { id: required }));
    }
  }
  return errors;
}

function inventorySourceErrors(document) {
  const errors = [];
  for (const [field, promoted] of [["packages", true], ["candidates", false]]) {
    for (const [position, entry] of (document[field] ?? []).entries()) {
      try {
        const source = parsePackageSpec(entry.spec);
        validatePackageEntrySource(entry, { promoted });
        if (promoted && (!entry.audit?.date || !entry.audit?.integrity)) {
          errors.push(error(`/${field}/${position}/audit`, "governance-integrity", `promoted ${source.type} source requires audit.date and canonical sha512 audit.integrity`, { id: entry.id, sourceType: source.type }));
        }
      } catch (cause) {
        errors.push(error(`/${field}/${position}`, "governance-integrity", cause.message, { id: entry?.id }));
      }
    }
  }
  return errors;
}

function overlapErrors(value, instancePath = "") {
  const errors = [];
  if (Array.isArray(value)) value.forEach((entry, index) => errors.push(...overlapErrors(entry, `${instancePath}/${index}`)));
  else if (value && typeof value === "object") {
    if (Array.isArray(value.allow) && Array.isArray(value.deny)) {
      for (const item of value.allow.filter((entry) => value.deny.includes(entry))) {
        errors.push(error(instancePath, "capability-escalation", `value appears in both allow and deny: ${item}`, { id: item }));
      }
    }
    for (const [key, entry] of Object.entries(value)) errors.push(...overlapErrors(entry, `${instancePath}/${key}`));
  }
  return errors;
}

function budgetEnvelopeErrors(document) {
  const errors = [];
  const hard = document.hard ?? {};
  const soft = document.soft ?? {};
  for (const key of Object.keys(hard)) {
    if (hard[key] !== null && soft[key] !== null && typeof hard[key] === "number" && typeof soft[key] === "number" && soft[key] > hard[key]) {
      errors.push(error(`/soft/${key}`, "budget-envelope", `soft ${key} ${soft[key]} exceeds hard limit ${hard[key]}`, { key, soft: soft[key], hard: hard[key] }));
    }
  }
  for (const [meter, key] of [["tokens", "maxTokens"], ["cost", "maxCost"]]) {
    if (document.metering?.[meter] === "UNAVAILABLE" && hard[key] !== null) {
      errors.push(error(`/hard/${key}`, "metering-unavailable", `hard ${key} cannot be enforced when ${meter} metering is unavailable`, { meter, key }));
    }
  }
  for (const limitsName of ["hard", "soft"]) {
    const limits = document[limitsName] ?? {};
    if (limits.maxActiveChildren !== null && limits.maxTotalAssignments !== null && limits.maxActiveChildren > limits.maxTotalAssignments) {
      errors.push(error(`/${limitsName}/maxActiveChildren`, "budget-envelope", "active children exceed total assignments", { limits: limitsName }));
    }
    if (limits.maxQueuedAssignments !== null && limits.maxTotalAssignments !== null && limits.maxQueuedAssignments > limits.maxTotalAssignments) {
      errors.push(error(`/${limitsName}/maxQueuedAssignments`, "budget-envelope", "queued assignments exceed total assignments", { limits: limitsName }));
    }
    if (limits.maxWriterWorktrees !== null && limits.maxActiveChildren !== null && limits.maxWriterWorktrees > limits.maxActiveChildren) {
      errors.push(error(`/${limitsName}/maxWriterWorktrees`, "budget-envelope", "writer worktrees exceed active children", { limits: limitsName }));
    }
    if (limits.noProgressWindow !== null && limits.maxIterations !== null && limits.noProgressWindow > limits.maxIterations) {
      errors.push(error(`/${limitsName}/noProgressWindow`, "budget-envelope", "no-progress window exceeds maximum iterations", { limits: limitsName }));
    }
  }
  return errors;
}

function buildIndex(documentsByKind, rootDir) {
  const values = (kind) => documentsByKind.get(kind) ?? [];
  const collect = (kind, field, nested) => new Set(values(kind).flatMap(({ document }) => nested ? (document[nested] ?? []).map((entry) => entry[field]) : [document[field]]).filter(Boolean));
  const definitions = (kind, nested) => new Map(values(kind).flatMap(({ document }) => (nested ? document[nested] ?? [] : [document])).filter((entry) => typeof entry?.id === "string").map((entry) => [entry.id, entry]));
  const inventory = values("inventory")[0]?.document;
  const packages = new Set([...(inventory?.packages ?? []), ...(inventory?.candidates ?? [])].map((entry) => entry.id));
  const releaseGatesPath = path.join(rootDir, "verification", "release-gates-v1.json");
  const releaseGates = fs.existsSync(releaseGatesPath) ? new Set((readJson(releaseGatesPath).gates ?? []).map((entry) => entry.id)) : new Set();
  return {
    packages,
    capabilities: collect("capability", "id", "capabilities"),
    capabilityDefinitions: definitions("capability", "capabilities"),
    owners: collect("owner", "id", "owners"),
    commands: collect("commandOwner", "id", "commands"),
    surfaces: collect("enforcementSurface", "id", "surfaces"),
    resources: collect("resourceInventory", "id", "resources"),
    modes: collect("mode", "id"),
    agents: collect("agent", "id"),
    agentDefinitions: definitions("agent"),
    workflows: collect("workflow", "id"),
    workflowDefinitionsV2: collect("workflowDefinitionV2", "id"),
    swarms: collect("swarmRecipe", "id"),
    agentTemplates: new Set([...collect("agentTemplate", "id"), ...collect("agent", "id")]),
    resolvedAgentSpecs: collect("resolvedAgentSpec", "id"),
    resolvedAgentSpecDefinitions: definitions("resolvedAgentSpec"),
    batchSwarms: collect("batchSwarm", "id"),
    batchSwarmDefinitions: definitions("batchSwarm"),
    budgetEnvelopes: collect("budgetEnvelope", "id"),
    swarmGoals: collect("swarmGoal", "id"),
    releaseGates,
  };
}

function unknownRefs(values, known, instancePath, kind) {
  if (!(known instanceof Set) || known.size === 0) return [];
  return (values ?? []).filter((id) => !known.has(id)).map((id) => error(instancePath, "unknown-reference", `unknown ${kind}: ${id}`, { id, kind }));
}

function promptPathErrors(document, sourcePath, rootDir) {
  if (!document?.prompt?.file) return [];
  try {
    ensureContained(rootDir, document.prompt.file);
    return [];
  } catch (cause) {
    return [error("/prompt/file", "path", cause.message, { sourcePath })];
  }
}

function durableWorkflowRecordErrors(document) {
  const errors = [];
  let checkedPlan;
  try {
    checkedPlan = validateWorkflowPlan(document.plan);
  } catch (cause) {
    errors.push(error("/plan", "runtime-parity", `durable plan cannot be validated: ${cause.message}`, { code: cause.code ?? "INVALID_PLAN" }));
  }
  if (checkedPlan && !checkedPlan.valid) {
    for (const finding of checkedPlan.errors) {
      errors.push(error("/plan", finding.code.toLowerCase().replaceAll("_", "-"), finding.message));
    }
  }
  if (document.plan?.planDigest !== document.planDigest) {
    errors.push(error("/planDigest", "digest-binding", "durable planDigest must equal plan.planDigest"));
  }
  const envelope = document.executionEnvelope;
  if (envelope?.executionEnvelopeDigest !== document.executionEnvelopeDigest) {
    errors.push(error("/executionEnvelopeDigest", "digest-binding", "top-level executionEnvelopeDigest must equal the embedded envelope digest"));
  }
  if (envelope) {
    const sortedConditions = [...(envelope.conditions ?? [])].sort();
    if (JSON.stringify(sortedConditions) !== JSON.stringify(envelope.conditions ?? [])
      || (envelope.conditions ?? []).some((condition) => /[\0\r\n]/u.test(condition))) {
      errors.push(error("/executionEnvelope/conditions", "canonical-order", "execution conditions must be sorted and contain no control-line characters"));
    }
    const expectedEnvelopeDigest = digestWorkflowValue(withoutKey(envelope, "executionEnvelopeDigest"));
    if (envelope.executionEnvelopeDigest !== expectedEnvelopeDigest) {
      errors.push(error("/executionEnvelope/executionEnvelopeDigest", "digest-authenticity", "execution envelope digest does not match its canonical payload"));
    }
    for (const [field, expected, pathName] of [
      ["runId", document.runId, "/executionEnvelope/runId"],
      ["planDigest", document.planDigest, "/executionEnvelope/planDigest"],
      ["runInputDigest", document.inputDigest, "/executionEnvelope/runInputDigest"],
      ["sourceHash", document.sourceHash, "/executionEnvelope/sourceHash"],
    ]) {
      if (envelope[field] !== expected) errors.push(error(pathName, "digest-binding", `execution envelope ${field} is not bound to the durable record`));
    }
  }
  if (document.digest !== stateSha256(withoutKey(document, "digest"))) {
    errors.push(error("/digest", "digest-authenticity", "durable workflow plan digest does not match its canonical record"));
  }
  return errors;
}

function durableCancelRecordErrors(document) {
  return document.digest === stateSha256(withoutKey(document, "digest"))
    ? []
    : [error("/digest", "digest-authenticity", "cancel request digest does not match its canonical record")];
}

function semanticErrors(kind, document, { sourcePath, rootDir, index, documentsByKind }) {
  const errors = overlapErrors(document);
  const arrays = {
    inventory: ["packages", "candidates"],
    resourceInventory: ["resources"],
    capability: ["capabilities"],
    owner: ["owners"],
    commandOwner: ["commands"],
    enforcementSurface: ["surfaces"],
  };
  for (const field of arrays[kind] ?? []) errors.push(...duplicateIds(document[field] ?? [], `/${field}`));

  if (kind === "inventory") {
    errors.push(...duplicateIds([...(document.packages ?? []), ...(document.candidates ?? [])], "/packages-and-candidates"));
    errors.push(...inventorySourceErrors(document));
  }

  if (kind === "profile") {
    errors.push(...unknownRefs(document.packageIds, index.packages, "/packageIds", "package"));
    errors.push(...unknownRefs(document.candidatePackageIds, index.packages, "/candidatePackageIds", "package"));
    errors.push(...unknownRefs(document.capabilityIds, index.capabilities, "/capabilityIds", "capability"));
    if (document.policy?.subagents?.enabled && !document.packageIds?.includes("subagents")) {
      errors.push(error("/policy/subagents/enabled", "capability-owner", "subagents are enabled without the governed subagents package", { packageId: "subagents" }));
    }
    if (document.policy?.subagents?.defaultRole) {
      errors.push(...unknownRefs([document.policy.subagents.defaultRole], index.agents, "/policy/subagents/defaultRole", "agent"));
    }
  } else if (kind === "capability") {
    const combined = new Map();
    for (const { document: catalog } of documentsByKind.get("capability") ?? []) {
      for (const capability of catalog.capabilities ?? []) combined.set(capability.id, capability);
    }
    for (const capability of document.capabilities ?? []) combined.set(capability.id, capability);
    const knownCapabilities = new Set(combined.keys());
    for (const [position, capability] of (document.capabilities ?? []).entries()) {
      errors.push(...unknownRefs(capability.requires, knownCapabilities, `/capabilities/${position}/requires`, "capability"));
      errors.push(...unknownRefs(capability.conflictsWith, knownCapabilities, `/capabilities/${position}/conflictsWith`, "capability"));
    }
    const capabilityGraph = [...combined.values()].map((capability) => ({ id: capability.id, needs: capability.requires ?? [] }));
    errors.push(...graphErrors(capabilityGraph, "/capabilities"));
    const graph = dependencyGraph(capabilityGraph);
    if (!graphHasCycle(graph)) {
      const memo = new Map();
      for (const capability of document.capabilities ?? []) {
        const closure = new Set([capability.id, ...transitiveDependencies(graph, capability.id, memo)]);
        for (const member of closure) {
          for (const conflict of combined.get(member)?.conflictsWith ?? []) {
            if (closure.has(conflict)) errors.push(error("/capabilities", "capability-escalation", `required capability closure contains a declared conflict: ${member} conflicts with ${conflict}`, { capability: capability.id, member, conflict }));
          }
        }
      }
    }
  } else if (kind === "owner") {
    for (const [position, owner] of (document.owners ?? []).entries()) {
      errors.push(...unknownRefs(owner.capabilities, index.capabilities, `/owners/${position}/capabilities`, "capability"));
      errors.push(...unknownRefs(owner.surfaces, index.surfaces, `/owners/${position}/surfaces`, "surface"));
    }
  } else if (kind === "commandOwner") {
    for (const [position, command] of (document.commands ?? []).entries()) {
      errors.push(...unknownRefs([command.owner], index.owners, `/commands/${position}/owner`, "owner"));
    }
    const aliases = new Map();
    for (const [position, command] of (document.commands ?? []).entries()) {
      for (const alias of [command.id, ...(command.aliases ?? [])]) {
        if (aliases.has(alias)) errors.push(error(`/commands/${position}/aliases`, "duplicate-command", `command or alias collision: ${alias}`, { alias }));
        aliases.set(alias, command.id);
      }
    }
  } else if (kind === "enforcementSurface") {
    for (const [position, surface] of (document.surfaces ?? []).entries()) errors.push(...unknownRefs([surface.owner], index.owners, `/surfaces/${position}/owner`, "owner"));
  } else if (kind === "resourceInventory") {
    for (const [position, resource] of (document.resources ?? []).entries()) {
      errors.push(...unknownRefs(resource.provides, index.capabilities, `/resources/${position}/provides`, "capability"));
      errors.push(...unknownRefs(resource.requires, index.capabilities, `/resources/${position}/requires`, "capability"));
      errors.push(...unknownRefs(resource.owners, index.owners, `/resources/${position}/owners`, "owner"));
    }
  } else if (kind === "mode") {
    errors.push(...promptPathErrors(document, sourcePath, rootDir));
    errors.push(...unknownRefs(document.extends, index.modes, "/extends", "mode"));
    errors.push(...unknownRefs(document.requires?.profileCapabilities, index.capabilities, "/requires/profileCapabilities", "capability"));
    errors.push(...unknownRefs(document.requires?.packages, index.packages, "/requires/packages", "package"));
    errors.push(...unknownRefs(document.requires?.enforcementSurfaces, index.surfaces, "/requires/enforcementSurfaces", "surface"));
    if (document.extends?.includes(document.id)) errors.push(error("/extends", "cycle", "mode extends itself", { id: document.id }));
    for (const tool of document.tools?.required ?? []) if (!document.tools?.allow?.includes(tool)) errors.push(error("/tools/required", "capability-escalation", `required tool is not allowed: ${tool}`, { id: tool }));
    errors.push(...policyBoundaryErrors({
      tools: document.tools,
      capabilities: document.requires?.profileCapabilities,
      policy: document.policy,
      capabilityPath: "/requires/profileCapabilities",
    }, index));
    if (document.workflow?.default) errors.push(...unknownRefs([document.workflow.default], index.workflows, "/workflow/default", "workflow"));
    if (document.workflow?.fallback) errors.push(...unknownRefs([document.workflow.fallback], index.workflows, "/workflow/fallback", "workflow"));
    if (document.swarm?.defaultRecipe) errors.push(...unknownRefs([document.swarm.defaultRecipe], index.swarms, "/swarm/defaultRecipe", "swarm recipe"));
  } else if (kind === "agent") {
    errors.push(...promptPathErrors(document, sourcePath, rootDir));
    errors.push(...unknownRefs(document.requiredCapabilities, index.capabilities, "/requiredCapabilities", "capability"));
    errors.push(...unknownRefs(document.gateIds, index.releaseGates, "/gateIds", "release gate"));
    errors.push(...policyBoundaryErrors({ tools: document.tools, capabilities: document.requiredCapabilities, policy: document.policyCeiling, writer: document.writer }, index));
    errors.push(...ioSchemaReferenceErrors(document));
  } else if (kind === "workflow") {
    const steps = document.steps ?? [];
    errors.push(...graphErrors(steps, "/steps"));
    const graph = dependencyGraph(steps);
    const acyclic = !graphHasCycle(graph);
    const ids = new Set(steps.map((step) => step.id));
    if (!ids.has(document.terminal?.step)) errors.push(error("/terminal/step", "unknown-reference", `unknown terminal step: ${document.terminal?.step}`));
    for (const [position, step] of steps.entries()) {
      if (step.action === "agent") errors.push(...unknownRefs([step.agent], index.agents, `/steps/${position}/agent`, "agent"));
      if (step.action === "swarm") errors.push(...unknownRefs([step.recipe], index.swarms, `/steps/${position}/recipe`, "swarm recipe"));
      if (step.action === "gate") errors.push(...unknownRefs([step.gate], index.releaseGates, `/steps/${position}/gate`, "release gate"));
      errors.push(...unknownRefs([step.policyRef], index.modes, `/steps/${position}/policyRef`, "mode"));
      if (step.timeoutSeconds !== undefined && step.timeoutSeconds > document.budget.timeoutSeconds) {
        errors.push(error(`/steps/${position}/timeoutSeconds`, "budget-envelope", `step timeout ${step.timeoutSeconds}s exceeds workflow timeout ${document.budget.timeoutSeconds}s`, { step: step.id }));
      }
      if ((step.retry ?? 0) > (document.budget.retry ?? 0)) {
        errors.push(error(`/steps/${position}/retry`, "budget-envelope", `step retry ${step.retry} exceeds workflow retry budget ${document.budget.retry ?? 0}`, { step: step.id }));
      }
    }
    if (steps.length > document.budget.maxSteps) errors.push(error("/steps", "budget-envelope", `workflow has ${steps.length} steps but maxSteps is ${document.budget.maxSteps}`, { actual: steps.length, maximum: document.budget.maxSteps }));
    if (acyclic) {
      const width = graphWidth(graph);
      const maximum = document.budget.maxParallel ?? 1;
      if (width > maximum) errors.push(error("/budget/maxParallel", "budget-envelope", `workflow DAG requires parallel width ${width} but maxParallel is ${maximum}`, { actual: width, maximum }));

      if (steps.every((step) => Number.isInteger(step.timeoutSeconds))) {
        const costs = new Map(steps.map((step) => [step.id, step.timeoutSeconds * ((step.retry ?? 0) + 1)]));
        const worstCase = longestPathCost(graph, costs);
        if (worstCase > document.budget.timeoutSeconds) errors.push(error("/budget/timeoutSeconds", "budget-envelope", `workflow critical-path timeout ${worstCase}s exceeds run timeout ${document.budget.timeoutSeconds}s`, { actual: worstCase, maximum: document.budget.timeoutSeconds }));
      }

      if (ids.has(document.terminal?.step) && document.terminal?.requiresVerifierGate) {
        const terminalChain = new Set([document.terminal.step, ...transitiveDependencies(graph, document.terminal.step)]);
        const verifier = steps.find((step) => terminalChain.has(step.id) && step.action === "gate" && index.releaseGates.has(step.gate));
        if (!verifier) errors.push(error("/terminal/requiresVerifierGate", "verifier-gate", "successful terminal dependency chain does not contain an allowlisted release gate", { terminal: document.terminal.step }));
      }
    }
    if (document.fallback?.workflow) errors.push(...unknownRefs([document.fallback.workflow], index.workflows, "/fallback/workflow", "workflow"));
    if (document.fallback?.workflow === document.id) errors.push(error("/fallback/workflow", "cycle", "workflow fallback cannot reference itself", { id: document.id }));
  } else if (kind === "workflowDefinitionV2") {
    try {
      compileWorkflowDefinition(document, {
        resolveBatch: (id) => index.batchSwarmDefinitions.get(id),
      });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "workflow-definition", cause.message));
    }
  } else if (kind === "workflowPlan") {
    const result = validateWorkflowPlan(document);
    for (const finding of result.errors) {
      errors.push(error("", finding.code.toLowerCase().replaceAll("_", "-"), finding.message));
    }
  } else if (kind === "workflowRunPlan") {
    errors.push(...durableWorkflowRecordErrors(document));
  } else if (kind === "workflowCancelRequest") {
    errors.push(...durableCancelRecordErrors(document));
  } else if (kind === "agentTemplate") {
    errors.push(...policyBoundaryErrors({
      tools: document.tools,
      capabilities: document.requiredCapabilities,
      policy: document.policyCeiling,
      writer: document.writer,
    }, index));
  } else if (kind === "resolvedAgentSpec") {
    errors.push(...unknownRefs([document.templateId], index.agentTemplates, "/templateId", "AgentTemplate"));
    errors.push(...policyBoundaryErrors({
      tools: document.tools,
      capabilities: document.requiredCapabilities,
      policy: document.effectivePolicy,
      writer: document.writer,
    }, index));
  } else if (kind === "taskAssignment") {
    errors.push(...unknownRefs([document.agentSpecId], index.resolvedAgentSpecs, "/agentSpecId", "ResolvedAgentSpec"));
    const ownership = document.ownership ?? {};
    if (ownership.writer && ["none", "shared-read-only"].includes(ownership.workspace)) {
      errors.push(error("/ownership/workspace", "writer-policy", "writer assignment requires a guarded or managed-worktree workspace"));
    }
    if (ownership.writer && document.idempotency?.class === "read-only") {
      errors.push(error("/idempotency/class", "writer-policy", "writer assignment cannot be classified read-only"));
    }
    for (const [position, claim] of (ownership.fileClaims ?? []).entries()) {
      if (!assignmentPathClaimCovered(claim, ownership.allowedPaths ?? [])) errors.push(error(`/ownership/fileClaims/${position}`, "path-claim", `file claim is outside allowed paths: ${claim}`, { claim }));
    }
  } else if (kind === "batchSwarm") {
    errors.push(...unknownRefs([document.agentSpecRef], index.resolvedAgentSpecs, "/agentSpecRef", "ResolvedAgentSpec"));
    errors.push(...unknownRefs([document.budgetRef], index.budgetEnvelopes, "/budgetRef", "BudgetEnvelope"));
    const resolvedAgentSpec = index.resolvedAgentSpecDefinitions.get(document.agentSpecRef);
    if (resolvedAgentSpec) {
      for (const [field, expected] of [
        ["agentSpecHash", resolvedAgentSpec.specHash],
        ["policyHash", resolvedAgentSpec.effectivePolicyHash],
        ["outputSchemaHash", resolvedAgentSpec.outputSchema?.hash],
      ]) {
        if (document[field] !== expected) {
          errors.push(error(`/${field}`, "correlation-digest", `${field} does not match ResolvedAgentSpec ${document.agentSpecRef}`, {
            expected,
            actual: document[field],
            agentSpecRef: document.agentSpecRef,
          }));
        }
      }
    }
    if (document.concurrency?.initial > document.concurrency?.max) errors.push(error("/concurrency/initial", "budget-envelope", "initial concurrency exceeds maximum concurrency"));
    const thresholdKind = ["quorum", "minimum-success"].includes(document.failurePolicy?.kind);
    if (!thresholdKind && document.failurePolicy?.threshold !== undefined) errors.push(error("/failurePolicy/threshold", "failure-policy", "threshold is only valid for quorum or minimum-success"));
    if (thresholdKind && document.failurePolicy?.threshold > document.maxItems) errors.push(error("/failurePolicy/threshold", "budget-envelope", "success threshold exceeds maxItems"));
    if (document.retryPolicy?.maxDelayMs > document.retryPolicy?.deadlineMs) errors.push(error("/retryPolicy/maxDelayMs", "budget-envelope", "retry delay exceeds the batch deadline"));
    if (Number.isSafeInteger(document.maxItems)
      && Number.isSafeInteger(document.retryPolicy?.maxAttempts)
      && document.maxItems * document.retryPolicy.maxAttempts > 1000) {
      errors.push(error("/retryPolicy/maxAttempts", "budget-envelope", "batch physical assignment envelope exceeds 1000"));
    }
  } else if (kind === "artifactRef") {
    const expectedPrefix = `runs/${document.producer?.runId}/`;
    if (typeof document.storage?.relativePath === "string" && !document.storage.relativePath.startsWith(expectedPrefix)) {
      errors.push(error("/storage/relativePath", "provenance", `artifact storage must be scoped to producing run: ${expectedPrefix}`, { expectedPrefix }));
    }
  } else if (kind === "budgetEnvelope") {
    errors.push(...budgetEnvelopeErrors(document));
  } else if (kind === "approvalReceipt") {
    for (const finding of approvalReceiptSemanticFindings(document)) {
      errors.push(error(finding.instancePath, finding.keyword, finding.message, finding.params));
    }
    if (document.receiptId !== approvalReceiptId(document)) {
      errors.push(error("/receiptId", "receipt-digest", "approval receipt digest does not match its content"));
    }
  } else if (kind === "swarmGoal") {
    errors.push(...unknownRefs(document.authority?.allowedAgentTemplates, index.agentTemplates, "/authority/allowedAgentTemplates", "AgentTemplate"));
    errors.push(...unknownRefs([document.authority?.budgetRef], index.budgetEnvelopes, "/authority/budgetRef", "BudgetEnvelope"));
    errors.push(...unknownRefs([document.roles?.synthesizerTemplate, document.roles?.verifierTemplate], index.agentTemplates, "/roles", "AgentTemplate"));
    if (document.roles?.synthesizerTemplate === document.roles?.verifierTemplate) errors.push(error("/roles", "role-conflict", "synthesizer and verifier templates must differ"));
    if (document.roles?.minimumDistinctAgentSpecs > document.authority?.maxAgentSpecs) errors.push(error("/roles/minimumDistinctAgentSpecs", "budget-envelope", "minimum distinct AgentSpecs exceeds maxAgentSpecs"));
    if (document.convergence?.noProgressWindow > document.authority?.maxPlanRevisions) errors.push(error("/convergence/noProgressWindow", "budget-envelope", "no-progress window exceeds maximum plan revisions"));
  } else if (kind === "ultraRun") {
    errors.push(...unknownRefs(document.workflowLibrary, index.workflowDefinitionsV2, "/workflowLibrary", "WorkflowDefinitionV2"));
    errors.push(...unknownRefs(document.batchLibrary, index.batchSwarms, "/batchLibrary", "BatchSwarm"));
    errors.push(...unknownRefs(document.goalLibrary, index.swarmGoals, "/goalLibrary", "SwarmGoal"));
    errors.push(...unknownRefs([document.quality?.testGate, document.quality?.integrationGate], index.releaseGates, "/quality", "release gate"));
    errors.push(...unknownRefs([document.budgetRef], index.budgetEnvelopes, "/budgetRef", "BudgetEnvelope"));
  } else if (kind === "terminalReceipt") {
    if (document.startedAt !== null && document.startedAt > document.settledAt) errors.push(error("/settledAt", "transition", "terminal receipt settles before it starts"));
    if (document.authoritative && (!document.completion || !document.processTerminal)) errors.push(error("/authoritative", "terminal-proof", "authoritative receipt requires completion and process-terminal proof"));
    if (document.outcome === "orphaned" && document.authoritative) errors.push(error("/authoritative", "terminal-proof", "orphaned receipt cannot be authoritative"));
    for (const [field, projection] of [["completion", document.completion], ["processTerminal", document.processTerminal]]) {
      if (projection && typeof projection === "object" && !Array.isArray(projection) && projection.runId !== undefined && projection.runId !== document.backendRunId) {
        errors.push(error(`/${field}/runId`, "correlation", `${field} run id does not match backendRunId`, { expected: document.backendRunId, actual: projection.runId }));
      }
    }
    if (document.authoritative && document.processTerminal?.state !== "observed") errors.push(error("/processTerminal/state", "terminal-proof", "authoritative receipt requires observed process-terminal proof"));
    if (document.authoritative && Array.isArray(document.processTerminal?.instances)
      && !document.processTerminal.instances.some((instance) => instance?.processInstanceId === document.processTerminal?.runnerProcessInstanceId)) {
      errors.push(error("/processTerminal/instances", "terminal-proof", "process-terminal proof does not include the runner process instance"));
    }
  } else if (kind === "evaluationCorpus") {
    errors.push(...duplicateIds(document.baselines ?? [], "/baselines"));
    errors.push(...duplicateIds(document.metrics ?? [], "/metrics"));
    errors.push(...duplicateIds(document.scenarios ?? [], "/scenarios"));
    const metricIds = new Set((document.metrics ?? []).map((metric) => metric.id));
    for (const [position, baseline] of (document.baselines ?? []).entries()) {
      for (const metricId of Object.keys(baseline.metrics ?? {})) if (!metricIds.has(metricId)) errors.push(error(`/baselines/${position}/metrics/${metricId}`, "unknown-reference", `baseline references unknown metric: ${metricId}`, { metricId }));
    }
    const caseIds = new Set();
    for (const [scenarioPosition, scenario] of (document.scenarios ?? []).entries()) {
      for (const [casePosition, candidate] of (scenario.cases ?? []).entries()) {
        if (caseIds.has(candidate.id)) errors.push(error(`/scenarios/${scenarioPosition}/cases/${casePosition}/id`, "duplicate-id", `duplicate evaluation case id: ${candidate.id}`, { id: candidate.id }));
        caseIds.add(candidate.id);
      }
    }
  } else if (kind === "subagentsCompatibility") {
    try {
      validateCompatibilityMatrix(document, { rootDir, verifyEvidencePaths: true });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "upstreamCompatibility") {
    try {
      validateUpstreamCompatibility(document, { rootDir, verifyEvidencePaths: true });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsPromotionPolicy") {
    try {
      validatePromotionPolicy(document);
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsProtectedEvidence") {
    try {
      validateProtectedEvidenceDocument(document, { allowContractExample: true });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsProtectedEvidenceTrust") {
    try {
      validateProtectedEvidenceTrustPolicy(document);
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsLiveEvidenceAuthorization") {
    try {
      validateLiveEvidenceAuthorization(document, { allowTemplate: true });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsLiveProvider") {
    try {
      validateLiveEvidenceProviderDescriptor(document);
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "subagentsBackgroundResumeAuthorization") {
    try {
      validateBackgroundResumeAuthorization(document, { allowTemplate: true });
    } catch (cause) {
      errors.push(error("", cause.code?.toLowerCase().replaceAll("_", "-") ?? "runtime-parity", cause.message));
    }
  } else if (kind === "swarmRecipe") {
    const nodes = document.nodes ?? [];
    errors.push(...graphErrors(nodes, "/nodes"));
    const graph = dependencyGraph(nodes);
    const acyclic = !graphHasCycle(graph);
    const ids = new Set(nodes.map((node) => node.id));
    if (!ids.has(document.verifier)) errors.push(error("/verifier", "unknown-reference", `unknown verifier node: ${document.verifier}`));
    for (const [position, node] of nodes.entries()) {
      errors.push(...unknownRefs([node.agent], index.agents, `/nodes/${position}/agent`, "agent"));
      if (document.readOnly && (node.writer || node.workspace !== "shared-read-only")) errors.push(error(`/nodes/${position}`, "capability-escalation", "read-only recipe contains a writer or writable workspace"));
      const agent = index.agentDefinitions.get(node.agent);
      if (node.writer && agent && !agent.writer) errors.push(error(`/nodes/${position}/agent`, "capability-escalation", `writer node references read-only agent: ${node.agent}`, { agent: node.agent }));
      if (document.readOnly && agent?.writer) errors.push(error(`/nodes/${position}/agent`, "capability-escalation", `read-only recipe references writer agent: ${node.agent}`, { agent: node.agent }));
      if (node.writer && node.workspace === "shared-read-only") errors.push(error(`/nodes/${position}/workspace`, "writer-policy", "writer node cannot use shared-read-only workspace", { node: node.id }));
      if (node.timeoutSeconds > document.budget.childTimeoutSeconds) errors.push(error(`/nodes/${position}/timeoutSeconds`, "budget-envelope", `node timeout ${node.timeoutSeconds}s exceeds child timeout ${document.budget.childTimeoutSeconds}s`, { node: node.id }));
      if (node.retry > document.budget.retry) errors.push(error(`/nodes/${position}/retry`, "budget-envelope", `node retry ${node.retry} exceeds recipe retry budget ${document.budget.retry}`, { node: node.id }));
    }
    if (nodes.length > document.budget.maxChildren) errors.push(error("/nodes", "budget-envelope", `recipe has ${nodes.length} nodes but maxChildren is ${document.budget.maxChildren}`, { actual: nodes.length, maximum: document.budget.maxChildren }));
    if (nodes.length > 0 && document.budget.maxDepth < 1) errors.push(error("/budget/maxDepth", "budget-envelope", "recipe with child nodes requires maxDepth of at least 1", { actual: document.budget.maxDepth, minimum: 1 }));
    if (document.budget.nestedSwarm) errors.push(error("/budget/nestedSwarm", "unsupported-nesting", "v1 recipe nodes cannot express nested swarm edges; nestedSwarm must fail closed"));
    if (acyclic) {
      const width = graphWidth(graph);
      if (width > document.budget.maxConcurrency) errors.push(error("/budget/maxConcurrency", "budget-envelope", `recipe DAG requires parallel width ${width} but maxConcurrency is ${document.budget.maxConcurrency}`, { actual: width, maximum: document.budget.maxConcurrency }));
      const costs = new Map(nodes.map((node) => [node.id, node.timeoutSeconds * (node.retry + 1)]));
      const worstCase = longestPathCost(graph, costs);
      if (worstCase > document.budget.runTimeoutSeconds) errors.push(error("/budget/runTimeoutSeconds", "budget-envelope", `recipe critical-path timeout ${worstCase}s exceeds run timeout ${document.budget.runTimeoutSeconds}s`, { actual: worstCase, maximum: document.budget.runTimeoutSeconds }));

      const dependencyMemo = new Map();
      const writers = nodes.filter((node) => node.writer);
      const sharedWriters = writers.filter((node) => node.workspace !== "managed-worktree");
      if (sharedWriters.length > document.writerPolicy.sharedCwdMaxWriters) errors.push(error("/writerPolicy/sharedCwdMaxWriters", "writer-policy", `recipe declares ${sharedWriters.length} shared-workspace writers but limit is ${document.writerPolicy.sharedCwdMaxWriters}`, { actual: sharedWriters.length, maximum: document.writerPolicy.sharedCwdMaxWriters }));
      for (let left = 0; left < writers.length; left += 1) {
        for (let right = left + 1; right < writers.length; right += 1) {
          const a = writers[left];
          const b = writers[right];
          const ordered = transitiveDependencies(graph, a.id, dependencyMemo).has(b.id) || transitiveDependencies(graph, b.id, dependencyMemo).has(a.id);
          if (!ordered && (a.workspace !== "managed-worktree" || b.workspace !== "managed-worktree")) {
            errors.push(error("/writerPolicy/parallelWriters", "writer-policy", `parallel writers ${a.id} and ${b.id} must both use managed-worktree`, { writers: [a.id, b.id] }));
          }
        }
      }
    }
  }

  if (kind === "mode") {
    const graph = new Map((documentsByKind.get("mode") ?? []).map(({ document: mode }) => [mode.id, mode.extends ?? []]));
    graph.set(document.id, document.extends ?? []);
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
      if (visiting.has(id)) {
        errors.push(error("/extends", "cycle", `mode inheritance cycle includes ${id}`, { id }));
        return;
      }
      if (visited.has(id)) return;
      visiting.add(id);
      for (const parent of graph.get(id) ?? []) visit(parent);
      visiting.delete(id);
      visited.add(id);
    };
    visit(document.id);
  }
  return errors;
}

export function createSchemaRegistry({ rootDir = DEFAULT_ROOT, catalogPath = DEFAULT_CATALOG } = {}) {
  rootDir = path.resolve(rootDir);
  const catalogFile = ensureContained(rootDir, catalogPath);
  const catalog = readJson(catalogFile);
  if (catalog.formatVersion !== 1 || !Array.isArray(catalog.schemas) || catalog.schemas.length === 0) throw new Error("invalid or empty contract catalog");
  const kinds = catalog.schemas.map((entry) => entry.kind);
  if (new Set(kinds).size !== kinds.length) throw new Error("duplicate contract kind in catalog");

  const schemas = new Map();
  for (const entry of catalog.schemas) {
    const file = ensureContained(rootDir, entry.schemaPath);
    const schema = readJson(file);
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || typeof schema.$id !== "string") throw new Error(`schema is not Draft 2020-12 with an id: ${entry.schemaPath}`);
    if ([...schemas.values()].some((item) => item.schema.$id === schema.$id)) throw new Error(`duplicate schema id: ${schema.$id}`);
    schemas.set(entry.kind, { ...entry, file, schema });
  }
  const knownIds = new Set([...schemas.values()].map(({ schema }) => schema.$id));
  for (const { schema } of schemas.values()) validateSchemaRefs(schema, knownIds);

  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, validateFormats: true });
  addFormats(ajv);
  for (const { schema } of schemas.values()) ajv.addSchema(schema);

  const allFiles = walkFiles(rootDir);
  const documentsByKind = new Map();
  for (const [kind, entry] of schemas) {
    const documents = expandProductionGlobs(rootDir, entry.productionGlobs ?? [], allFiles).map((relativePath) => ({
      sourcePath: relativePath,
      document: readJson(ensureContained(rootDir, relativePath)),
    }));
    documentsByKind.set(kind, documents);
  }
  const index = buildIndex(documentsByKind, rootDir);

  const validate = (kind, document, { sourcePath = `<${kind}>` } = {}) => {
    const entry = schemas.get(kind);
    if (!entry) return { valid: false, errors: [error("", "unknown-kind", `unknown contract kind: ${kind}`, { kind })] };
    const validator = ajv.getSchema(entry.schema.$id);
    const schemaValid = validator(document);
    const errors = schemaValid ? [] : normalizedAjvErrors(validator.errors);
    if (schemaValid) errors.push(...semanticErrors(kind, document, { sourcePath, rootDir, index, documentsByKind }));
    return { valid: errors.length === 0, errors };
  };

  const validateFile = (kind, filePath) => {
    try {
      const absolute = path.isAbsolute(filePath) ? filePath : ensureContained(rootDir, filePath);
      const relative = path.relative(rootDir, absolute);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("contract file escapes repository");
      return validate(kind, readJson(absolute), { sourcePath: relative.split(path.sep).join("/") });
    } catch (cause) {
      return { valid: false, errors: [error("", "parse-or-path", cause.message)] };
    }
  };

  return { kinds: Object.freeze([...kinds]), validate, validateFile };
}

export function validateRepositoryContracts({ rootDir = DEFAULT_ROOT, catalogPath = DEFAULT_CATALOG } = {}) {
  const registry = createSchemaRegistry({ rootDir, catalogPath });
  const catalog = readJson(ensureContained(rootDir, catalogPath));
  const allFiles = walkFiles(rootDir);
  const results = [];
  for (const entry of catalog.schemas) {
    const files = expandProductionGlobs(rootDir, entry.productionGlobs ?? [], allFiles);
    if (files.length === 0) results.push({ kind: entry.kind, sourcePath: null, valid: false, errors: [error("", "vacuous", `no production documents for ${entry.kind}`)] });
    for (const sourcePath of files) results.push({ kind: entry.kind, sourcePath, ...registry.validateFile(entry.kind, sourcePath) });
  }
  return { valid: results.length > 0 && results.every((result) => result.valid), documents: results.length, kinds: registry.kinds.length, results };
}
