import { canonicalJson, jsonClone } from "../state/codec.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

export const BUDGET_RESOURCE_LIMITS = Object.freeze({
  workflowRuns: Object.freeze(["maxWorkflowRuns"]),
  phases: Object.freeze(["maxPhases"]),
  planRevisions: Object.freeze(["maxPlanRevisions"]),
  assignments: Object.freeze(["maxTotalAssignments", "maxAssignments"]),
  iterations: Object.freeze(["maxIterations"]),
  retries: Object.freeze(["maxRetries"]),
  elapsedMs: Object.freeze(["maxElapsedMs", "maxWallTimeMs"]),
  turns: Object.freeze(["maxTurns"]),
  toolCalls: Object.freeze(["maxToolCalls"]),
  tokens: Object.freeze(["maxTokens"]),
  cost: Object.freeze(["maxCost", "maxCostUsd"]),
  rawOutputBytes: Object.freeze(["maxRawOutputBytes", "maxOutputBytes"]),
  artifactBytes: Object.freeze(["maxArtifactBytes"]),
  writerWorktrees: Object.freeze(["maxWriterWorktrees"]),
});

const RESOURCES = Object.freeze(Object.keys(BUDGET_RESOURCE_LIMITS));
const RESOURCE_SET = new Set(RESOURCES);
const DISCRETE_RESOURCES = new Set(RESOURCES.filter((resource) => resource !== "cost"));
const RESOURCE_ALIASES = Object.freeze({
  wallTimeMs: "elapsedMs",
  timeoutMs: "elapsedMs",
  outputBytes: "rawOutputBytes",
  costUsd: "cost",
  maxAssignments: "assignments",
  maxWallTimeMs: "elapsedMs",
  maxElapsedMs: "elapsedMs",
  maxTurns: "turns",
  maxToolCalls: "toolCalls",
  maxTokens: "tokens",
  maxCost: "cost",
  maxCostUsd: "cost",
  maxOutputBytes: "rawOutputBytes",
  maxRawOutputBytes: "rawOutputBytes",
  maxArtifactBytes: "artifactBytes",
});
const EPSILON = Number.EPSILON * 16;

export class BudgetLedgerError extends Error {
  constructor(message, code, details = undefined, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "BudgetLedgerError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details, cause) {
  throw new BudgetLedgerError(message, code, details, cause);
}

function validateId(value, label) {
  if (typeof value !== "string" || !ID.test(value)) fail("INVALID_BUDGET_ID", `${label} must be a canonical identifier`);
}

function numeric(value, label, resource = null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("INVALID_BUDGET_VECTOR", `${label} must be a finite non-negative number`);
  }
  if (resource !== null && DISCRETE_RESOURCES.has(resource) && !Number.isSafeInteger(value)) {
    fail("INVALID_BUDGET_VECTOR", `${label} must be a non-negative safe integer`);
  }
  return Object.is(value, -0) ? 0 : value;
}

function normalizeVector(input, label, { allowEmpty = false } = {}) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_BUDGET_VECTOR", `${label} must be an object`);
  }
  const unknown = Object.keys(input).filter((key) => !RESOURCE_SET.has(key) && !Object.hasOwn(RESOURCE_ALIASES, key));
  if (unknown.length > 0) fail("INVALID_BUDGET_VECTOR", `${label} contains unknown resources`, { unknown });
  const result = {};
  for (const [inputResource, raw] of Object.entries(input)) {
    const resource = RESOURCE_ALIASES[inputResource] ?? inputResource;
    const value = numeric(raw, `${label}.${inputResource}`, resource);
    if (Object.hasOwn(result, resource) && result[resource] !== value) {
      fail("INVALID_BUDGET_VECTOR", `${label} supplies conflicting aliases for ${resource}`);
    }
    result[resource] = value;
  }
  if (!allowEmpty && !Object.values(result).some((value) => value > 0)) {
    fail("INVALID_BUDGET_VECTOR", `${label} must reserve at least one positive resource`);
  }
  return result;
}

function normalizeLimits(envelope = {}) {
  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    fail("INVALID_BUDGET_ENVELOPE", "budget envelope must be an object");
  }
  const limits = {};
  for (const [resource, fields] of Object.entries(BUDGET_RESOURCE_LIMITS)) {
    const nested = envelope.hard?.[resource];
    const directValues = fields
      .filter((field) => envelope[field] !== undefined && envelope[field] !== null)
      .map((field) => ({ field, value: envelope[field] }));
    if (directValues.some((entry) => entry.value !== directValues[0]?.value)) {
      fail("INVALID_BUDGET_ENVELOPE", `budget aliases for ${resource} conflict`, { fields });
    }
    const direct = directValues[0]?.value;
    if (direct !== undefined && nested !== undefined && direct !== nested) {
      fail("INVALID_BUDGET_ENVELOPE", `budget limit ${directValues[0].field} conflicts with hard.${resource}`);
    }
    const value = direct ?? nested;
    if (value !== undefined && value !== null) limits[resource] = numeric(value, directValues[0]?.field ?? `hard.${resource}`, resource);
  }
  return limits;
}

function meteringAvailable(metering, resource) {
  const value = metering?.[resource] ?? (resource === "cost" ? metering?.costUsd : undefined);
  return value === true || value === "AVAILABLE" || value === "METERED";
}

function ensureMetering(limits, vector, metering) {
  for (const resource of ["tokens", "cost"]) {
    if ((Object.hasOwn(limits, resource) || Object.hasOwn(vector, resource)) && !meteringAvailable(metering, resource)) {
      fail("METERING_UNAVAILABLE", `hard ${resource} admission requires reliable runtime metering`, { resource });
    }
  }
}

function ensureHardMeteredReservation(limits, vector) {
  for (const resource of ["tokens", "cost"]) {
    if (Object.hasOwn(limits, resource) && !Object.hasOwn(vector, resource)) {
      fail("BUDGET_RESERVATION_INCOMPLETE", `hard ${resource} budget requires a worst-case ${resource} reservation`, { resource });
    }
  }
}

function addVector(target, vector) {
  for (const [resource, value] of Object.entries(vector)) target[resource] = (target[resource] ?? 0) + value;
  return target;
}

function equalVector(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function closeNumber(left, right) {
  return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function closeVector(left, right) {
  const resources = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...resources].every((resource) => closeNumber(left[resource] ?? 0, right[resource] ?? 0));
}

function zeroVectorLike(vector) {
  return Object.fromEntries(Object.keys(vector).map((resource) => [resource, 0]));
}

function immutable(value) {
  if (Array.isArray(value)) {
    value.forEach(immutable);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(immutable);
    return Object.freeze(value);
  }
  return value;
}

function completeActual(reserved, actualInput) {
  const actual = normalizeVector(actualInput ?? {}, "consumed", { allowEmpty: true });
  const extra = Object.keys(actual).filter((resource) => !Object.hasOwn(reserved, resource));
  if (extra.length > 0) fail("ACTUAL_OUTSIDE_RESERVATION", "consumed resources were not reserved", { extra });
  const consumed = {};
  const refunded = {};
  for (const [resource, reservedValue] of Object.entries(reserved)) {
    const value = actual[resource] ?? 0;
    if (value > reservedValue && !closeNumber(value, reservedValue)) {
      fail("ACTUAL_EXCEEDS_RESERVATION", `consumed ${resource} exceeds the worst-case reservation`, {
        resource,
        reserved: reservedValue,
        consumed: value,
      });
    }
    consumed[resource] = value;
    refunded[resource] = Math.max(0, reservedValue - value);
  }
  return { consumed, refunded };
}

function validateBudgetEvent(event) {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("BUDGET_JOURNAL_CORRUPT", "budget event payload must be an object", { seq: event.seq });
  }
  validateId(payload.reservationId, "reservationId");
  validateId(payload.ownerId, "ownerId");
  if (event.type === "BudgetReserved") {
    const keys = Object.keys(payload).sort();
    if (canonicalJson(keys) !== canonicalJson(["ownerId", "reservationId", "worstCase"])) {
      fail("BUDGET_JOURNAL_CORRUPT", "BudgetReserved payload fields are invalid", { seq: event.seq });
    }
    return { ...payload, worstCase: normalizeVector(payload.worstCase, "worstCase") };
  }
  if (["BudgetConsumed", "BudgetRefunded"].includes(event.type)) {
    const keys = Object.keys(payload).sort();
    if (canonicalJson(keys) !== canonicalJson(["consumed", "ownerId", "refunded", "reservationId", "reserved"])) {
      fail("BUDGET_JOURNAL_CORRUPT", `${event.type} payload fields are invalid`, { seq: event.seq });
    }
    return {
      ...payload,
      reserved: normalizeVector(payload.reserved, "reserved"),
      consumed: normalizeVector(payload.consumed, "consumed", { allowEmpty: true }),
      refunded: normalizeVector(payload.refunded, "refunded", { allowEmpty: true }),
    };
  }
  fail("BUDGET_JOURNAL_CORRUPT", "unknown budget event type", { type: event.type, seq: event.seq });
}

export function rebuildBudgetStateFromEvents(events, envelope = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array");
  const limits = normalizeLimits(envelope);
  const reservations = new Map();
  const consumed = {};
  for (const event of events) {
    if (!event || !["BudgetReserved", "BudgetConsumed", "BudgetRefunded"].includes(event.type)) continue;
    const payload = validateBudgetEvent(event);
    const current = reservations.get(payload.reservationId);
    if (event.type === "BudgetReserved") {
      if (current) fail("BUDGET_JOURNAL_CORRUPT", "reservation was recorded more than once", { reservationId: payload.reservationId, seq: event.seq });
      reservations.set(payload.reservationId, {
        reservationId: payload.reservationId,
        ownerId: payload.ownerId,
        worstCase: payload.worstCase,
        status: "reserved",
        reservedSeq: event.seq,
        settledSeq: null,
        consumed: null,
        refunded: null,
      });
      continue;
    }
    if (!current) fail("BUDGET_JOURNAL_CORRUPT", "terminal budget event has no reservation", { reservationId: payload.reservationId, seq: event.seq });
    if (current.status !== "reserved") fail("BUDGET_JOURNAL_CORRUPT", "reservation was settled more than once", { reservationId: payload.reservationId, seq: event.seq });
    if (payload.ownerId !== current.ownerId || !equalVector(payload.reserved, current.worstCase)) {
      fail("BUDGET_JOURNAL_CORRUPT", "terminal budget event does not match its reservation", { reservationId: payload.reservationId, seq: event.seq });
    }
    const sum = {};
    addVector(sum, payload.consumed);
    addVector(sum, payload.refunded);
    if (!closeVector(sum, current.worstCase)) {
      fail("BUDGET_JOURNAL_CORRUPT", "consumed plus refunded does not equal the reservation", { reservationId: payload.reservationId, seq: event.seq });
    }
    current.status = event.type === "BudgetRefunded" ? "refunded" : "consumed";
    current.settledSeq = event.seq;
    current.consumed = payload.consumed;
    current.refunded = payload.refunded;
    addVector(consumed, payload.consumed);
  }
  const outstanding = {};
  for (const reservation of reservations.values()) {
    if (reservation.status === "reserved") addVector(outstanding, reservation.worstCase);
  }
  const committed = {};
  addVector(committed, consumed);
  addVector(committed, outstanding);
  const available = {};
  for (const resource of RESOURCES) {
    if (Object.hasOwn(limits, resource)) available[resource] = Math.max(0, limits[resource] - (committed[resource] ?? 0));
  }
  for (const [resource, limit] of Object.entries(limits)) {
    if ((committed[resource] ?? 0) > limit && !closeNumber(committed[resource] ?? 0, limit)) {
      fail("BUDGET_JOURNAL_OVERSPENT", "durable reservations exceed the hard parent budget", {
        resource,
        limit,
        committed: committed[resource],
      });
    }
  }
  const orderedReservations = [...reservations.values()]
    .sort((left, right) => left.reservationId.localeCompare(right.reservationId))
    .map((reservation) => jsonClone(reservation));
  return immutable({
    formatVersion: 1,
    limits: { ...limits },
    consumed: { ...consumed },
    outstanding: { ...outstanding },
    committed: { ...committed },
    available,
    reservations: orderedReservations,
  });
}

function reservationById(state, reservationId) {
  return state.reservations.find((entry) => entry.reservationId === reservationId) ?? null;
}

function assertCapacity(state, worstCase) {
  const next = { ...state.committed };
  addVector(next, worstCase);
  for (const [resource, limit] of Object.entries(state.limits)) {
    if ((next[resource] ?? 0) > limit && !closeNumber(next[resource] ?? 0, limit)) {
      fail("BUDGET_EXHAUSTED", `worst-case ${resource} reservation exceeds the hard budget`, {
        resource,
        limit,
        committed: state.committed[resource] ?? 0,
        requested: worstCase[resource] ?? 0,
      });
    }
  }
}

function expectedMatches(expectedVersion, journalState) {
  if (expectedVersion === undefined || expectedVersion === null) return true;
  if (Number.isSafeInteger(expectedVersion)) return journalState.lastSeq === expectedVersion;
  if (typeof expectedVersion === "object" && !Array.isArray(expectedVersion)) {
    const seq = expectedVersion.seq ?? expectedVersion.lastSeq;
    const digest = expectedVersion.digest ?? expectedVersion.lastEventDigest;
    return journalState.lastSeq === seq && (digest === undefined || journalState.lastEventDigest === digest);
  }
  fail("INVALID_EXPECTED_VERSION", "expectedVersion must be a seq or seq/digest object");
}

export function createBudgetReservationLedger(options = {}) {
  const { journal } = options;
  if (!journal || typeof journal.recover !== "function" || typeof journal.appendEvent !== "function") {
    throw new TypeError("createBudgetReservationLedger requires a run-bound event journal");
  }
  const envelope = jsonClone(options.envelope ?? {});
  const limits = normalizeLimits(envelope);
  const metering = Object.freeze({ ...(options.metering ?? {}) });
  const maxCasRetries = options.maxCasRetries ?? 8;
  if (!Number.isSafeInteger(maxCasRetries) || maxCasRetries < 1) throw new TypeError("maxCasRetries must be a positive safe integer");

  async function durableState(lease, repair = true) {
    const recovered = await journal.recover(repair ? { repairTrailingPartial: true, lease } : {});
    return { recovered, budget: rebuildBudgetStateFromEvents(recovered.events, envelope) };
  }

  async function snapshot(input = {}) {
    const recovered = await journal.recover(input.repairTrailingPartial === true
      ? { repairTrailingPartial: true, lease: input.lease }
      : {});
    return Object.freeze({
      journalVersion: Object.freeze({ seq: recovered.lastSeq, digest: recovered.lastEventDigest }),
      ...rebuildBudgetStateFromEvents(recovered.events, envelope),
    });
  }

  async function reserve(reservation, input = {}) {
    if (!reservation || typeof reservation !== "object" || Array.isArray(reservation)) {
      fail("INVALID_RESERVATION", "reservation must be an object");
    }
    validateId(reservation.reservationId, "reservationId");
    validateId(reservation.ownerId, "ownerId");
    const worstCase = normalizeVector(reservation.worstCase, "worstCase");
    ensureMetering(limits, worstCase, metering);
    ensureHardMeteredReservation(limits, worstCase);
    for (let attempt = 0; attempt < maxCasRetries; attempt += 1) {
      const { recovered, budget } = await durableState(input.lease);
      if (!expectedMatches(input.expectedVersion, recovered)) {
        fail("BUDGET_VERSION_MISMATCH", "budget expectedVersion does not match the durable journal", {
          expectedVersion: input.expectedVersion,
          actual: { seq: recovered.lastSeq, digest: recovered.lastEventDigest },
        });
      }
      const existing = reservationById(budget, reservation.reservationId);
      if (existing) {
        if (existing.ownerId !== reservation.ownerId || !equalVector(existing.worstCase, worstCase)) {
          fail("RESERVATION_CONFLICT", "reservationId already exists with different ownership or limits", { reservationId: reservation.reservationId });
        }
        return Object.freeze({
          status: existing.status === "reserved" ? "ALREADY_RESERVED" : "ALREADY_SETTLED",
          reservation: existing,
          journalVersion: Object.freeze({ seq: recovered.lastSeq, digest: recovered.lastEventDigest }),
          budget,
        });
      }
      assertCapacity(budget, worstCase);
      try {
        const result = await journal.appendEvent({
          lease: input.lease,
          expectedSeq: recovered.lastSeq,
          expectedDigest: recovered.lastEventDigest,
          event: {
            eventId: `budget-reserved:${reservation.reservationId}`,
            type: "BudgetReserved",
            revision: input.revision ?? 0,
            nodeId: reservation.nodeId ?? null,
            attemptId: reservation.attemptId ?? null,
            payload: {
              reservationId: reservation.reservationId,
              ownerId: reservation.ownerId,
              worstCase,
            },
          },
        });
        if (result.status === "LATE_EVENT") {
          fail("BUDGET_EVENT_LATE", "budget reservation arrived after its run or scope was terminal", {
            reservationId: reservation.reservationId,
            reason: result.reason,
          });
        }
        if (result.status === "DUPLICATE_EVENT") {
          const fresh = await durableState(input.lease);
          return Object.freeze({
            status: "ALREADY_RESERVED",
            reservation: reservationById(fresh.budget, reservation.reservationId),
            journalVersion: Object.freeze({ seq: fresh.recovered.lastSeq, digest: fresh.recovered.lastEventDigest }),
            budget: fresh.budget,
          });
        }
        const next = rebuildBudgetStateFromEvents([...recovered.events, result.event].filter(Boolean), envelope);
        return Object.freeze({
          status: "RESERVED",
          reservation: reservationById(next, reservation.reservationId),
          journalVersion: Object.freeze({ seq: result.lastSeq, digest: result.lastEventDigest }),
          budget: next,
        });
      } catch (error) {
        if (error?.code === "JOURNAL_CAS_MISMATCH" && input.expectedVersion == null && attempt + 1 < maxCasRetries) continue;
        throw error;
      }
    }
    fail("BUDGET_CAS_RETRY_EXHAUSTED", "budget reservation could not acquire a durable CAS version");
  }

  async function settle(reservationId, settlement = {}, input = {}) {
    validateId(reservationId, "reservationId");
    for (let attempt = 0; attempt < maxCasRetries; attempt += 1) {
      const { recovered, budget } = await durableState(input.lease);
      if (!expectedMatches(input.expectedVersion, recovered)) {
        fail("BUDGET_VERSION_MISMATCH", "budget expectedVersion does not match the durable journal", {
          expectedVersion: input.expectedVersion,
          actual: { seq: recovered.lastSeq, digest: recovered.lastEventDigest },
        });
      }
      const existing = reservationById(budget, reservationId);
      if (!existing) fail("RESERVATION_NOT_FOUND", "reservation does not exist", { reservationId });
      const actualInput = settlement.consumed ?? {};
      const terminal = completeActual(existing.worstCase, actualInput);
      if (settlement.refunded !== undefined) {
        const explicitRefund = normalizeVector(settlement.refunded, "refunded", { allowEmpty: true });
        if (!equalVector(explicitRefund, terminal.refunded)) {
          fail("INVALID_SETTLEMENT", "explicit refunded vector does not equal reserved minus consumed", {
            expected: terminal.refunded,
            actual: explicitRefund,
          });
        }
      }
      if (existing.status !== "reserved") {
        if (equalVector(existing.consumed ?? {}, terminal.consumed) && equalVector(existing.refunded ?? {}, terminal.refunded)) {
          return Object.freeze({
            status: "ALREADY_SETTLED",
            reservation: existing,
            journalVersion: Object.freeze({ seq: recovered.lastSeq, digest: recovered.lastEventDigest }),
            budget,
          });
        }
        fail("RESERVATION_ALREADY_SETTLED", "reservation has a different terminal settlement", { reservationId });
      }
      ensureMetering(limits, terminal.consumed, metering);
      const fullyRefunded = equalVector(terminal.consumed, zeroVectorLike(existing.worstCase));
      try {
        const result = await journal.appendEvent({
          lease: input.lease,
          expectedSeq: recovered.lastSeq,
          expectedDigest: recovered.lastEventDigest,
          event: {
            eventId: `budget-settled:${reservationId}`,
            type: fullyRefunded ? "BudgetRefunded" : "BudgetConsumed",
            revision: input.revision ?? 0,
            nodeId: input.nodeId ?? null,
            attemptId: input.attemptId ?? null,
            payload: {
              reservationId,
              ownerId: existing.ownerId,
              reserved: existing.worstCase,
              consumed: terminal.consumed,
              refunded: terminal.refunded,
            },
          },
        });
        if (result.status === "LATE_EVENT") {
          fail("BUDGET_EVENT_LATE", "budget settlement arrived after its run or scope was terminal", {
            reservationId,
            reason: result.reason,
          });
        }
        if (result.status === "DUPLICATE_EVENT") {
          const fresh = await durableState(input.lease);
          return Object.freeze({
            status: "ALREADY_SETTLED",
            reservation: reservationById(fresh.budget, reservationId),
            journalVersion: Object.freeze({ seq: fresh.recovered.lastSeq, digest: fresh.recovered.lastEventDigest }),
            budget: fresh.budget,
          });
        }
        const next = rebuildBudgetStateFromEvents([...recovered.events, result.event].filter(Boolean), envelope);
        return Object.freeze({
          status: fullyRefunded ? "REFUNDED" : "CONSUMED",
          reservation: reservationById(next, reservationId),
          journalVersion: Object.freeze({ seq: result.lastSeq, digest: result.lastEventDigest }),
          budget: next,
        });
      } catch (error) {
        if (error?.code === "JOURNAL_CAS_MISMATCH" && input.expectedVersion == null && attempt + 1 < maxCasRetries) continue;
        throw error;
      }
    }
    fail("BUDGET_CAS_RETRY_EXHAUSTED", "budget settlement could not acquire a durable CAS version");
  }

  async function refund(reservationId, input = {}) {
    return settle(reservationId, { consumed: {} }, input);
  }

  return Object.freeze({
    envelope: immutable(envelope),
    limits: immutable(limits),
    metering,
    reserve,
    settle,
    refund,
    snapshot,
    rebuildFromEvents(events) {
      return rebuildBudgetStateFromEvents(events, envelope);
    },
  });
}

export function createBudgetLedger(options = {}) {
  const eventJournal = options.eventJournal ?? options.journal;
  if (!eventJournal || typeof eventJournal.forRun !== "function") {
    throw new TypeError("createBudgetLedger requires the manager returned by createEventJournal");
  }
  const envelopeForRun = typeof options.envelope === "function" ? options.envelope : () => options.envelope ?? {};
  const meteringForRun = typeof options.metering === "function" ? options.metering : () => options.metering ?? {};
  const ledgers = new Map();
  function forRun(runId) {
    let ledger = ledgers.get(runId);
    if (!ledger) {
      ledger = createBudgetReservationLedger({
        journal: eventJournal.forRun(runId),
        envelope: envelopeForRun(runId),
        metering: meteringForRun(runId),
        maxCasRetries: options.maxCasRetries,
      });
      ledgers.set(runId, ledger);
    }
    return ledger;
  }
  async function controlsForRun(runId, input = {}) {
    if (input.lease !== undefined) return input;
    const lease = typeof options.leaseProvider === "function"
      ? await options.leaseProvider(runId)
      : typeof eventJournal.writer === "function"
        ? await eventJournal.writer(runId)
        : null;
    return { ...input, lease };
  }
  return Object.freeze({
    async reserve(runId, reservation, input) {
      return forRun(runId).reserve(reservation, await controlsForRun(runId, input));
    },
    async settle(runId, reservationId, settlement = {}, input = {}) {
      const inlineControls = {};
      for (const key of ["lease", "expectedVersion", "revision", "nodeId", "attemptId"]) {
        if (settlement[key] !== undefined && input[key] === undefined) inlineControls[key] = settlement[key];
      }
      const controls = await controlsForRun(runId, { ...inlineControls, ...input });
      return forRun(runId).settle(reservationId, {
        consumed: settlement.consumed,
        ...(settlement.refunded === undefined ? {} : { refunded: settlement.refunded }),
      }, controls);
    },
    async refund(runId, reservationId, input) {
      return forRun(runId).refund(reservationId, await controlsForRun(runId, input));
    },
    snapshot(runId, input) {
      return forRun(runId).snapshot(input);
    },
    rebuildFromEvents(runId, events) {
      return forRun(runId).rebuildFromEvents(events);
    },
    forRun,
  });
}
