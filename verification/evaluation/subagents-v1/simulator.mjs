import { canonicalJson, sha256 } from "../../../packages/subagents/state/codec.mjs";

export const SIMULATOR_ID = "only-my-pi-subagents-offline-simulator";
export const SIMULATOR_VERSION = "1.0.0";
export const IMPLEMENTATIONS = Object.freeze([
  "single-agent-reference",
  "legacy-v1-reference",
  "current-release",
]);

function assertFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new TypeError("evaluation fixture must be an object");
  if (fixture.formatVersion !== 1) throw new TypeError("evaluation fixture formatVersion must be 1");
  if (typeof fixture.id !== "string" || !fixture.id) throw new TypeError("evaluation fixture requires id");
  if (!new Set(["agent", "batch-swarm", "workflow", "swarm-goal", "recovery", "budget", "cancel"]).has(fixture.kind)) {
    throw new TypeError(`unsupported evaluation fixture kind: ${fixture.kind}`);
  }
}

function baseSignals() {
  return {
    unsafeAdmission: false,
    stableOrderViolation: false,
    budgetOvershoot: false,
    duplicateEffect: false,
    unprovenCancellationSuccess: false,
  };
}

function result(verdict, details = {}, signals = baseSignals()) {
  return { verdict, details, signals: { ...baseSignals(), ...signals } };
}

function simulateAgent(input) {
  const keys = ["runId", "nodeId", "attemptId", "childId"];
  const matches = keys.every((key) => input.expected?.[key] === input.observed?.[key]);
  return result(matches ? "ACCEPTED" : "REJECTED", {
    correlationFields: keys,
    terminalProofAccepted: matches,
  });
}

function simulateBatch(input, { legacy = false } = {}) {
  const specs = [...new Set(input.agentSpecRefs ?? [])];
  if (!legacy && specs.length !== 1) return result("REJECTED", { reason: "HETEROGENEOUS_BATCH" });
  const completed = new Map((input.completions ?? []).map((entry) => [entry.itemId, entry.value]));
  const projected = (input.items ?? []).map((item) => ({ itemId: item.id, value: completed.get(item.id) ?? null }));
  const missing = projected.some((entry) => entry.value === null);
  const unsafe = specs.length !== 1;
  return result(missing ? "REJECTED" : "ACCEPTED", { itemOrder: projected.map((entry) => entry.itemId), projected }, {
    unsafeAdmission: legacy && unsafe,
    stableOrderViolation: false,
  });
}

function simulateWorkflow(input) {
  const nodes = input.nodes ?? [];
  const ids = new Set(nodes.map((node) => node.id));
  if (ids.size !== nodes.length || nodes.some((node) => (node.needs ?? []).some((need) => !ids.has(need)))) {
    return result("REJECTED", { reason: "INVALID_REFERENCE" });
  }
  const remaining = new Map(nodes.map((node) => [node.id, new Set(node.needs ?? [])]));
  const order = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()].filter(([, needs]) => [...needs].every((need) => order.includes(need))).map(([id]) => id).sort();
    if (ready.length === 0) return result("REJECTED", { reason: "CYCLE", settledOrder: order });
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
    }
  }
  return result("ACCEPTED", { settledOrder: order });
}

function simulateSwarmGoal(input) {
  const authority = input.authority ?? {};
  const proposal = input.proposal ?? {};
  const assignments = proposal.assignments ?? [];
  const allowedTemplates = new Set(authority.allowedTemplates ?? []);
  const withinAssignments = assignments.length <= (authority.maxAssignments ?? 0);
  const withinRevisions = (proposal.revision ?? Number.POSITIVE_INFINITY) <= (authority.maxRevisions ?? 0);
  const templatesAllowed = assignments.every((assignment) => allowedTemplates.has(assignment.agentTemplateRef));
  const mutationAllowed = proposal.mutation === "none" || authority.mutation === "guarded";
  const allowed = withinAssignments && withinRevisions && templatesAllowed && mutationAllowed;
  return result(allowed ? "PROPOSED" : "DENIED", {
    withinAssignments,
    withinRevisions,
    templatesAllowed,
    mutationAllowed,
  });
}

function simulateRecovery(input, { legacy = false } = {}) {
  const acceptedById = new Map();
  const effects = new Set();
  let previousEventId = "GENESIS";
  for (const event of input.events ?? []) {
    if (event.recordState !== "complete") {
      if (legacy) continue;
      return result("REJECTED", { reason: "PARTIAL_RECORD", effects: [...effects].sort() });
    }
    const existing = acceptedById.get(event.eventId);
    if (existing) {
      if (existing.inputDigest !== event.inputDigest) return result("REJECTED", { reason: "EVENT_ID_CONFLICT", effects: [...effects].sort() });
      if (legacy) effects.add(`${event.effectId}:duplicate:${event.observation}`);
      continue;
    }
    if (event.prevEventId !== previousEventId) return result("REJECTED", { reason: "HASH_CHAIN_MISMATCH", effects: [...effects].sort() });
    acceptedById.set(event.eventId, event);
    effects.add(event.effectId);
    previousEventId = event.eventId;
  }
  const duplicateEffect = legacy && effects.size > new Set([...effects].map((effect) => effect.replace(/:duplicate:.*$/u, ""))).size;
  return result("RECOVERED", { effects: [...effects].sort() }, { duplicateEffect });
}

function addVector(target, vector) {
  for (const [key, value] of Object.entries(vector)) target[key] = (target[key] ?? 0) + value;
}

function exceedsVector(total, envelope) {
  return Object.entries(total).some(([key, value]) => value > (envelope[key] ?? 0));
}

function simulateBudget(input, { legacy = false } = {}) {
  const consumed = {};
  let deniedAt = null;
  for (let index = 0; index < (input.requests ?? []).length; index += 1) {
    const candidate = { ...consumed };
    addVector(candidate, input.requests[index]);
    if (!legacy && exceedsVector(candidate, input.envelope ?? {})) {
      deniedAt = index;
      break;
    }
    Object.assign(consumed, candidate);
  }
  const overshoot = exceedsVector(consumed, input.envelope ?? {});
  return result(deniedAt === null ? "ADMITTED" : "DENIED", { consumed, deniedAt }, {
    unsafeAdmission: legacy && overshoot,
    budgetOvershoot: overshoot,
  });
}

function simulateCancel(input, { legacy = false } = {}) {
  const active = new Set(input.activeAttemptIds ?? []);
  const proven = new Set((input.terminalProofs ?? []).filter((proof) => proof.terminal === true).map((proof) => proof.attemptId));
  const missing = [...active].filter((attemptId) => !proven.has(attemptId)).sort();
  const verdict = legacy || missing.length === 0 ? "CANCELLED" : "ORPHANED";
  return result(verdict, { missingTerminalProofs: missing }, {
    unprovenCancellationSuccess: verdict === "CANCELLED" && missing.length > 0,
  });
}

function unavailable(fixture) {
  return result("UNAVAILABLE", { reason: `SINGLE_AGENT_BASELINE_HAS_NO_${fixture.kind.toUpperCase().replaceAll("-", "_")}_PRIMITIVE` });
}

function simulateByImplementation(fixture, implementation) {
  if (implementation === "single-agent-reference" && fixture.kind !== "agent") return unavailable(fixture);
  const legacy = implementation === "legacy-v1-reference";
  switch (fixture.kind) {
    case "agent": return simulateAgent(fixture.input ?? {});
    case "batch-swarm": return simulateBatch(fixture.input ?? {}, { legacy });
    case "workflow": return simulateWorkflow(fixture.input ?? {});
    case "swarm-goal": return legacy ? unavailable(fixture) : simulateSwarmGoal(fixture.input ?? {});
    case "recovery": return simulateRecovery(fixture.input ?? {}, { legacy });
    case "budget": return simulateBudget(fixture.input ?? {}, { legacy });
    case "cancel": return simulateCancel(fixture.input ?? {}, { legacy });
    default: throw new TypeError(`unsupported evaluation fixture kind: ${fixture.kind}`);
  }
}

export function simulateFixture(fixture, {
  implementation = "current-release",
  seed = 0,
  repetition = 0,
  fixtureDigest = sha256(fixture),
} = {}) {
  assertFixture(fixture);
  if (!IMPLEMENTATIONS.includes(implementation)) throw new TypeError(`unsupported simulator implementation: ${implementation}`);
  if (!Number.isSafeInteger(seed) || seed < 0) throw new TypeError("simulator seed must be a non-negative safe integer");
  if (!Number.isSafeInteger(repetition) || repetition < 0) throw new TypeError("simulator repetition must be a non-negative safe integer");
  const simulation = simulateByImplementation(fixture, implementation);
  const output = {
    formatVersion: 1,
    simulator: { id: SIMULATOR_ID, version: SIMULATOR_VERSION },
    implementation,
    fixtureId: fixture.id,
    fixtureDigest,
    seed,
    repetition,
    verdict: simulation.verdict,
    details: simulation.details,
    signals: simulation.signals,
  };
  return Object.freeze({ ...output, resultDigest: sha256(output) });
}

export function simulatorSourceDigest() {
  return sha256(canonicalJson({ id: SIMULATOR_ID, version: SIMULATOR_VERSION, implementations: IMPLEMENTATIONS }));
}
