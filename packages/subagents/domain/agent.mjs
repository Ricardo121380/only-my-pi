import {
  assertBoolean,
  assertDomainId,
  assertRecord,
  assertSafeInteger,
  assertSha256,
  assertString,
  digestValue,
  immutable,
  normalizeStringSet,
} from "./shared.mjs";
import { fail } from "./errors.mjs";

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);
const WORKSPACE_CANONICAL = Object.freeze({
  none: "none",
  "read-only": "shared-read-only",
  "shared-read-only": "shared-read-only",
  "guarded-write": "shared-guarded",
  "shared-guarded": "shared-guarded",
  "worktree-write": "managed-worktree",
  "managed-worktree": "managed-worktree",
});
const WORKSPACE_RANK = Object.freeze({ none: 0, "shared-read-only": 1, "shared-guarded": 2, "managed-worktree": 3 });
const MUTATION_CANONICAL = Object.freeze({ none: "none", workspace: "guarded", guarded: "guarded", "isolated-worktree": "guarded" });
const MUTATION_RANK = Object.freeze({ none: 0, guarded: 1 });
const APPROVAL_RANK = Object.freeze({ deny: 0, ask: 1, inherit: 2 });
const EGRESS_RANK = Object.freeze({ deny: 0, "allow-listed": 1, inherit: 2 });

function normalizeTools(input, label) {
  assertRecord(input, label);
  const allow = normalizeStringSet(input.allow ?? [], `${label}.allow`, { id: true });
  const deny = normalizeStringSet(input.deny ?? [], `${label}.deny`, { id: true });
  const overlap = allow.filter((tool) => deny.includes(tool));
  if (overlap.length) throw new TypeError(`${label} allow/deny overlap: ${overlap.join(", ")}`);
  return { allow, deny };
}

function normalizePolicy(input, label) {
  assertRecord(input, label);
  if (!Object.hasOwn(WORKSPACE_CANONICAL, input.workspace)) throw new TypeError(`${label}.workspace is invalid`);
  if (!Object.hasOwn(MUTATION_CANONICAL, input.mutation)) throw new TypeError(`${label}.mutation is invalid`);
  if (!Object.hasOwn(APPROVAL_RANK, input.approval)) throw new TypeError(`${label}.approval is invalid`);
  assertRecord(input.egress, `${label}.egress`);
  const egress = {};
  for (const key of ["web", "mcp", "provider", "extension"]) {
    if (!Object.hasOwn(EGRESS_RANK, input.egress[key])) throw new TypeError(`${label}.egress.${key} is invalid`);
    egress[key] = input.egress[key];
  }
  return {
    workspace: WORKSPACE_CANONICAL[input.workspace],
    mutation: MUTATION_CANONICAL[input.mutation],
    approval: input.approval,
    egress,
  };
}

function assertPolicyNarrower(candidate, ceiling) {
  if (WORKSPACE_RANK[candidate.workspace] > WORKSPACE_RANK[ceiling.workspace]) fail("resolved AgentSpec widens workspace policy", "AGENT_SPEC_POLICY_ESCALATION", { category: "policy" });
  if (MUTATION_RANK[candidate.mutation] > MUTATION_RANK[ceiling.mutation]) fail("resolved AgentSpec widens mutation policy", "AGENT_SPEC_POLICY_ESCALATION", { category: "policy" });
  if (APPROVAL_RANK[candidate.approval] > APPROVAL_RANK[ceiling.approval]) fail("resolved AgentSpec weakens approval policy", "AGENT_SPEC_POLICY_ESCALATION", { category: "policy" });
  for (const key of ["web", "mcp", "provider", "extension"]) {
    if (EGRESS_RANK[candidate.egress[key]] > EGRESS_RANK[ceiling.egress[key]]) fail(`resolved AgentSpec widens ${key} egress`, "AGENT_SPEC_POLICY_ESCALATION", { category: "policy", details: { surface: key } });
  }
}

function normalizeSchema(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return { ref: assertString(value, label, { maximum: 512 }), hash: digestValue(value) };
  assertRecord(value, label);
  return { value, hash: digestValue(value) };
}

export function createAgentTemplate(input = {}) {
  assertRecord(input, "AgentTemplate");
  const id = assertDomainId(input.id, "AgentTemplate.id");
  const version = assertString(input.version, "AgentTemplate.version", { maximum: 128 });
  const backendAgentId = assertString(input.backendAgentId ?? input.upstreamAgentId, "AgentTemplate.backendAgentId", { maximum: 256 });
  const sourceHash = assertSha256(input.sourceHash, "AgentTemplate.sourceHash");
  const promptHash = assertSha256(input.promptHash ?? input.prompt?.hash, "AgentTemplate.promptHash");
  const tools = normalizeTools(input.tools, "AgentTemplate.tools");
  const requiredCapabilities = normalizeStringSet(input.requiredCapabilities ?? [], "AgentTemplate.requiredCapabilities", { id: true });
  const policyCeiling = normalizePolicy(input.policyCeiling, "AgentTemplate.policyCeiling");
  const writer = assertBoolean(input.writer, "AgentTemplate.writer");
  const continuable = assertBoolean(input.continuable, "AgentTemplate.continuable");
  const resumable = assertBoolean(input.resumable, "AgentTemplate.resumable");
  const timeoutMs = input.timeoutMs === undefined
    ? assertSafeInteger(input.timeoutSeconds, "AgentTemplate.timeoutSeconds", { minimum: 1, maximum: 86_400 }) * 1_000
    : assertSafeInteger(input.timeoutMs, "AgentTemplate.timeoutMs", { minimum: 1, maximum: 86_400_000 });
  if (!writer && tools.allow.some((tool) => MUTATING_TOOLS.has(tool))) fail("read-only AgentTemplate cannot allow mutating tools", "AGENT_TEMPLATE_MUTATION_CONFLICT", { category: "policy" });
  if (policyCeiling.mutation === "none" && tools.allow.some((tool) => MUTATING_TOOLS.has(tool))) fail("mutation:none AgentTemplate cannot allow mutating tools", "AGENT_TEMPLATE_MUTATION_CONFLICT", { category: "policy" });
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/agent-template-v2.schema.json",
    formatVersion: 2,
    contractStatus: "contract-preview",
    kind: "agent-template",
    id,
    version,
    backendAgentId,
    sourceHash,
    promptHash,
    tools,
    requiredCapabilities,
    policyCeiling,
    modelRole: assertString(input.modelRole, "AgentTemplate.modelRole", { maximum: 128 }),
    inputSchema: normalizeSchema(input.inputSchema, "AgentTemplate.inputSchema"),
    outputSchema: normalizeSchema(input.outputSchema, "AgentTemplate.outputSchema"),
    writer,
    continuable,
    resumable,
    timeoutMs,
    redaction: input.redaction === undefined ? {} : assertRecord(input.redaction, "AgentTemplate.redaction"),
  };
  return immutable({ ...value, templateHash: digestValue(value) });
}

export function agentTemplateFromRegistryEntry(entry) {
  assertRecord(entry, "agent registry entry");
  const manifest = assertRecord(entry.manifest, "agent registry entry.manifest");
  return createAgentTemplate({
    ...manifest,
    backendAgentId: manifest.upstreamAgentId,
    sourceHash: entry.sourceHash,
    promptHash: entry.prompt?.hash,
    timeoutSeconds: manifest.timeoutSeconds,
  });
}

export function createResolvedAgentSpec(input = {}) {
  assertRecord(input, "ResolvedAgentSpec");
  const template = input.template;
  if (template?.kind !== "agent-template" || template?.formatVersion !== 2) throw new TypeError("ResolvedAgentSpec.template must be an AgentTemplate v2");
  const requestedTools = input.tools === undefined ? template.tools : normalizeTools(input.tools, "ResolvedAgentSpec.tools");
  const outsideCeiling = requestedTools.allow.filter((tool) => !template.tools.allow.includes(tool));
  if (outsideCeiling.length) fail(`resolved AgentSpec adds tools outside template: ${outsideCeiling.join(", ")}`, "AGENT_SPEC_TOOL_ESCALATION", { category: "policy" });
  const tools = {
    allow: requestedTools.allow.filter((tool) => !template.tools.deny.includes(tool)).sort(),
    deny: [...new Set([...template.tools.deny, ...requestedTools.deny])].sort(),
  };
  const requiredCapabilities = input.requiredCapabilities === undefined
    ? [...template.requiredCapabilities]
    : normalizeStringSet(input.requiredCapabilities, "ResolvedAgentSpec.requiredCapabilities", { id: true });
  const capabilityExpansion = requiredCapabilities.filter((capability) => !template.requiredCapabilities.includes(capability));
  if (capabilityExpansion.length) fail(`resolved AgentSpec adds capabilities outside template: ${capabilityExpansion.join(", ")}`, "AGENT_SPEC_CAPABILITY_ESCALATION", { category: "policy" });
  const effectivePolicy = input.effectivePolicy === undefined
    ? template.policyCeiling
    : normalizePolicy(input.effectivePolicy, "ResolvedAgentSpec.effectivePolicy");
  assertPolicyNarrower(effectivePolicy, template.policyCeiling);
  const computedPolicyHash = digestValue(effectivePolicy);
  if (input.effectivePolicyHash !== undefined
    && assertSha256(input.effectivePolicyHash, "ResolvedAgentSpec.effectivePolicyHash") !== computedPolicyHash) {
    fail("resolved AgentSpec effective policy hash mismatch", "AGENT_SPEC_POLICY_HASH_MISMATCH", { category: "correlation" });
  }
  const writer = input.writer === undefined ? template.writer : assertBoolean(input.writer, "ResolvedAgentSpec.writer");
  if (writer && !template.writer) fail("resolved AgentSpec cannot promote a read-only template to writer", "AGENT_SPEC_WRITER_ESCALATION", { category: "policy" });
  if (!writer && tools.allow.some((tool) => MUTATING_TOOLS.has(tool))) fail("read-only resolved AgentSpec cannot allow mutating tools", "AGENT_SPEC_MUTATION_CONFLICT", { category: "policy" });
  const specialization = input.specialization === undefined ? null : (() => {
    assertRecord(input.specialization, "ResolvedAgentSpec.specialization");
    const promptText = input.specialization.prompt;
    const promptDigest = promptText === undefined
      ? assertSha256(input.specialization.promptDigest, "ResolvedAgentSpec.specialization.promptDigest")
      : digestValue(assertString(promptText, "ResolvedAgentSpec.specialization.prompt", { maximum: 16_384 }));
    if (input.specialization.promptDigest !== undefined && input.specialization.promptDigest !== promptDigest) fail("specialization prompt digest mismatch", "AGENT_SPEC_PROMPT_DIGEST_MISMATCH", { category: "validation" });
    return {
      promptDigest,
      ...(input.specialization.promptRef === undefined ? {} : { promptRef: assertString(input.specialization.promptRef, "ResolvedAgentSpec.specialization.promptRef", { maximum: 512 }) }),
    };
  })();
  const model = input.model === undefined
    ? { role: template.modelRole }
    : (() => {
      assertRecord(input.model, "ResolvedAgentSpec.model");
      const role = assertString(input.model.role ?? template.modelRole, "ResolvedAgentSpec.model.role", { maximum: 128 });
      if (role !== template.modelRole) fail("resolved AgentSpec cannot change the template model role", "AGENT_SPEC_MODEL_ROLE_ESCALATION", { category: "policy" });
      if (input.model.provider !== undefined && input.model.id === undefined) {
        throw new TypeError("ResolvedAgentSpec.model.provider requires model.id");
      }
      return {
        role,
        ...(input.model.provider === undefined ? {} : { provider: assertString(input.model.provider, "ResolvedAgentSpec.model.provider", { maximum: 128 }) }),
        ...(input.model.id === undefined ? {} : { id: assertString(input.model.id, "ResolvedAgentSpec.model.id", { maximum: 256 }) }),
      };
    })();
  const runtimeMode = input.runtimeMode ?? "REGISTERED_ROLES_ONLY";
  if (!["REGISTERED_ROLES_ONLY", "DYNAMIC_OVERLAY"].includes(runtimeMode)) throw new TypeError("ResolvedAgentSpec.runtimeMode is invalid");
  const overlayRequirements = {
    tools: JSON.stringify(tools) !== JSON.stringify(template.tools),
    model: model.provider !== undefined || model.id !== undefined,
  };
  const value = {
    $schema: "https://github.com/Ricardo121380/only-my-pi/schemas/resolved-agent-spec-v1.schema.json",
    formatVersion: 1,
    contractStatus: "contract-preview",
    kind: "resolved-agent-spec",
    id: assertDomainId(input.id ?? `${template.id}-resolved`, "ResolvedAgentSpec.id"),
    templateId: template.id,
    templateHash: template.templateHash,
    backendAgentId: template.backendAgentId,
    sourceHash: template.sourceHash,
    tools,
    requiredCapabilities,
    effectivePolicy,
    effectivePolicyHash: computedPolicyHash,
    model,
    inputSchema: input.inputSchema === undefined ? template.inputSchema : normalizeSchema(input.inputSchema, "ResolvedAgentSpec.inputSchema"),
    outputSchema: input.outputSchema === undefined ? template.outputSchema : normalizeSchema(input.outputSchema, "ResolvedAgentSpec.outputSchema"),
    writer,
    continuable: template.continuable,
    resumable: template.resumable,
    timeoutMs: input.timeoutMs === undefined ? template.timeoutMs : Math.min(template.timeoutMs, assertSafeInteger(input.timeoutMs, "ResolvedAgentSpec.timeoutMs", { minimum: 1 })),
    runtimeMode,
    overlayRequirements,
    specialization,
  };
  return immutable({ ...value, specHash: digestValue(value) });
}
