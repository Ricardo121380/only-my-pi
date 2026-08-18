import path from "node:path";

import { assertPlainJson, canonicalJson, jsonClone, sha256, withoutKey } from "./codec.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const EVENT_ID = /^[a-z0-9][a-z0-9._:-]{0,191}$/u;
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]{0,63}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ROOT_TERMINAL_TYPES = new Set([
  "RunCompleted",
  "RunFailed",
  "RunCancelled",
  "RunInterrupted",
  "RunOrphaned",
]);
const CHILD_EVENT_TYPES = new Set(["ChildStarted", "ChildOutputProjected", "ChildTerminal"]);
const NODE_EVENT_TYPES = new Set([
  "NodeQueued",
  "NodeAdmitted",
  "ChildStarted",
  "ChildOutputProjected",
  "ChildTerminal",
  "NodeSettled",
  "GateEvaluated",
]);
const EVENT_KEYS = Object.freeze([
  "attemptId",
  "childId",
  "eventDigest",
  "eventId",
  "fencingToken",
  "formatVersion",
  "inputDigest",
  "nodeId",
  "payload",
  "prevEventDigest",
  "revision",
  "runId",
  "seq",
  "swarmRunId",
  "timestamp",
  "type",
  "writerId",
]);
const LEASE_KEYS = Object.freeze([
  "acquiredAt",
  "digest",
  "expiresAt",
  "fencingToken",
  "formatVersion",
  "releasedAt",
  "runId",
  "status",
  "writerId",
]);
const SNAPSHOT_KEYS = Object.freeze([
  "activeRevision",
  "createdAt",
  "digest",
  "formatVersion",
  "lastAppliedSeq",
  "lastEventDigest",
  "runId",
  "state",
]);

export const GENESIS_EVENT_DIGEST = sha256("only-my-pi:subagents:event-journal:genesis:v1");

export class RunStateError extends Error {
  constructor(message, code, details = undefined, cause = undefined) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RunStateError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details, cause) {
  throw new RunStateError(message, code, details, cause);
}

function exactKeys(value, expected, label, code) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail(code, `${label} contains missing or unknown fields`, { actual, expected: wanted });
  }
}

function validateId(value, label, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !ID.test(value)) fail("INVALID_ID", `${label} must be a canonical identifier`);
}

function validateEventId(value) {
  if (typeof value !== "string" || !EVENT_ID.test(value)) fail("INVALID_ID", "eventId must be a canonical identifier");
}

function validateDigest(value, label, code = "INVALID_DIGEST") {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code, `${label} must be a canonical sha256 digest`);
}

function validateInteger(value, label, { min = 0 } = {}) {
  if (!Number.isSafeInteger(value) || value < min) fail("INVALID_INTEGER", `${label} must be a safe integer >= ${min}`);
}

function instant(clock) {
  const raw = clock();
  const date = raw instanceof Date ? new Date(raw.valueOf()) : new Date(raw);
  if (!Number.isFinite(date.valueOf())) fail("INVALID_CLOCK", "clock returned an invalid instant");
  return date;
}

function isExpired(lease, at) {
  return Date.parse(lease.expiresAt) <= at.valueOf();
}

function inputShape(event) {
  return {
    attemptId: event.attemptId,
    childId: event.childId,
    eventId: event.eventId,
    nodeId: event.nodeId,
    payload: event.payload,
    revision: event.revision,
    swarmRunId: event.swarmRunId,
    type: event.type,
  };
}

function normalizeEventInput(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_EVENT", "event input must be an object");
  }
  const allowed = new Set(["attemptId", "childId", "eventId", "nodeId", "payload", "revision", "swarmRunId", "type"]);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) fail("INVALID_EVENT", "event input contains unknown fields", { unknown });
  validateEventId(input.eventId);
  if (typeof input.type !== "string" || !EVENT_TYPE.test(input.type)) {
    fail("INVALID_EVENT", "event type must be canonical PascalCase");
  }
  validateInteger(input.revision ?? 0, "revision");
  for (const key of ["attemptId", "childId", "nodeId", "swarmRunId"]) validateId(input[key] ?? null, key, true);
  const payload = assertPlainJson(input.payload ?? {}, "event payload");
  return {
    eventId: input.eventId,
    type: input.type,
    revision: input.revision ?? 0,
    nodeId: input.nodeId ?? null,
    attemptId: input.attemptId ?? null,
    swarmRunId: input.swarmRunId ?? null,
    childId: input.childId ?? null,
    payload,
  };
}

function validateEvent(record, expectedRunId, previous) {
  if (record === null || typeof record !== "object" || Array.isArray(record)) {
    fail("INVALID_EVENT_RECORD", "journal event must be an object");
  }
  exactKeys(record, EVENT_KEYS, "journal event", "INVALID_EVENT_RECORD");
  if (record.formatVersion !== 1 || record.runId !== expectedRunId) {
    fail("INVALID_EVENT_RECORD", "journal event version or run identity is invalid");
  }
  validateId(record.runId, "runId");
  validateId(record.writerId, "writerId");
  validateEventId(record.eventId);
  if (typeof record.type !== "string" || !EVENT_TYPE.test(record.type)) {
    fail("INVALID_EVENT_RECORD", "journal event type is invalid");
  }
  validateInteger(record.seq, "seq", { min: 1 });
  validateInteger(record.revision, "revision");
  validateInteger(record.fencingToken, "fencingToken", { min: 1 });
  for (const key of ["attemptId", "childId", "nodeId", "swarmRunId"]) validateId(record[key], key, true);
  if (!Number.isFinite(Date.parse(record.timestamp))) fail("INVALID_EVENT_RECORD", "journal event timestamp is invalid");
  assertPlainJson(record.payload, "journal event payload");
  validateDigest(record.inputDigest, "inputDigest", "INVALID_EVENT_RECORD");
  validateDigest(record.prevEventDigest, "prevEventDigest", "INVALID_EVENT_RECORD");
  validateDigest(record.eventDigest, "eventDigest", "INVALID_EVENT_RECORD");

  const expectedSeq = previous === null ? 1 : previous.seq + 1;
  const expectedPrev = previous === null ? GENESIS_EVENT_DIGEST : previous.eventDigest;
  if (record.seq !== expectedSeq) {
    fail("EVENT_SEQ_GAP", "journal sequence is not contiguous", { expectedSeq, actualSeq: record.seq });
  }
  if (record.prevEventDigest !== expectedPrev) {
    fail("EVENT_CHAIN_MISMATCH", "journal prevEventDigest does not match the prior event", {
      seq: record.seq,
      expected: expectedPrev,
      actual: record.prevEventDigest,
    });
  }
  if (previous !== null && record.fencingToken < previous.fencingToken) {
    fail("EVENT_FENCING_REGRESSION", "journal fencing token regressed", {
      seq: record.seq,
      previousFencingToken: previous.fencingToken,
      fencingToken: record.fencingToken,
    });
  }
  const expectedInputDigest = sha256(inputShape(record));
  if (record.inputDigest !== expectedInputDigest) {
    fail("EVENT_INPUT_DIGEST_MISMATCH", "journal event input digest is invalid", { seq: record.seq });
  }
  const expectedEventDigest = sha256(withoutKey(record, "eventDigest"));
  if (record.eventDigest !== expectedEventDigest) {
    fail("EVENT_DIGEST_MISMATCH", "journal event digest is invalid", { seq: record.seq });
  }
  return record;
}

function leasePayload(lease) {
  return withoutKey(lease, "digest");
}

function validateLease(lease, expectedRunId) {
  if (lease === null || typeof lease !== "object" || Array.isArray(lease)) fail("INVALID_LEASE", "writer lease must be an object");
  exactKeys(lease, LEASE_KEYS, "writer lease", "INVALID_LEASE");
  if (lease.formatVersion !== 1 || lease.runId !== expectedRunId || !["active", "released"].includes(lease.status)) {
    fail("INVALID_LEASE", "writer lease identity or status is invalid");
  }
  validateId(lease.runId, "runId");
  validateId(lease.writerId, "writerId");
  validateInteger(lease.fencingToken, "fencingToken", { min: 1 });
  if (!Number.isFinite(Date.parse(lease.acquiredAt)) || !Number.isFinite(Date.parse(lease.expiresAt))) {
    fail("INVALID_LEASE", "writer lease timestamps are invalid");
  }
  if (lease.releasedAt !== null && !Number.isFinite(Date.parse(lease.releasedAt))) {
    fail("INVALID_LEASE", "writer lease releasedAt is invalid");
  }
  if ((lease.status === "released") !== (lease.releasedAt !== null)) {
    fail("INVALID_LEASE", "writer lease release fields are inconsistent");
  }
  validateDigest(lease.digest, "lease digest", "INVALID_LEASE");
  if (lease.digest !== sha256(leasePayload(lease))) fail("LEASE_DIGEST_MISMATCH", "writer lease digest is invalid");
  return lease;
}

function snapshotPayload(snapshot) {
  return withoutKey(snapshot, "digest");
}

function validateSnapshot(snapshot, expectedRunId) {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) fail("INVALID_SNAPSHOT", "snapshot must be an object");
  exactKeys(snapshot, SNAPSHOT_KEYS, "snapshot", "INVALID_SNAPSHOT");
  if (snapshot.formatVersion !== 1 || snapshot.runId !== expectedRunId) fail("INVALID_SNAPSHOT", "snapshot version or run identity is invalid");
  validateInteger(snapshot.lastAppliedSeq, "lastAppliedSeq");
  validateInteger(snapshot.activeRevision, "activeRevision");
  validateDigest(snapshot.lastEventDigest, "lastEventDigest", "INVALID_SNAPSHOT");
  validateDigest(snapshot.digest, "snapshot digest", "INVALID_SNAPSHOT");
  if (!Number.isFinite(Date.parse(snapshot.createdAt))) fail("INVALID_SNAPSHOT", "snapshot createdAt is invalid");
  assertPlainJson(snapshot.state, "snapshot state");
  if (snapshot.digest !== sha256(snapshotPayload(snapshot))) fail("SNAPSHOT_DIGEST_MISMATCH", "snapshot digest is invalid");
  if (snapshot.lastAppliedSeq === 0 && snapshot.lastEventDigest !== GENESIS_EVENT_DIGEST) {
    fail("INVALID_SNAPSHOT", "empty snapshot must reference the genesis digest");
  }
  return snapshot;
}

async function readUtf8(filesystem, target) {
  try {
    return await filesystem.readFile(target, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(filesystem, target, label, code) {
  const text = await readUtf8(filesystem, target);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    fail(code, `${label} is not valid JSON`, undefined, cause);
  }
}

let temporaryCounter = 0;

async function fsyncDirectory(filesystem, directory) {
  const handle = await filesystem.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(filesystem, target, text) {
  const directory = path.dirname(target);
  await filesystem.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${++temporaryCounter}`;
  let handle;
  let renamed = false;
  try {
    handle = await filesystem.open(temporary, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await filesystem.rename(temporary, target);
    renamed = true;
    await fsyncDirectory(filesystem, directory);
  } catch (cause) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (!renamed) await filesystem.unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    const error = new RunStateError("atomic state publication failed", "ATOMIC_PUBLICATION_FAILED", { target, renamed }, cause);
    error.publication = renamed ? "PUBLISHED_NOT_CONFIRMED_DURABLE" : "NOT_PUBLISHED";
    throw error;
  }
}

async function appendDurable(filesystem, target, text) {
  await filesystem.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await filesystem.open(target, "a", 0o600);
  try {
    await handle.writeFile(text, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(filesystem, path.dirname(target));
}

async function truncateDurable(filesystem, target, size) {
  await filesystem.truncate(target, size);
  const handle = await filesystem.open(target, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsyncDirectory(filesystem, path.dirname(target));
}

function looksLikeProvableTrailingPartial(text, parseError) {
  const trimmed = text.trimStart();
  const message = parseError?.message ?? "";
  const reportedPosition = /position\s+(\d+)/iu.exec(message)?.[1];
  const failureAtPhysicalEnd = /(?:end of JSON|unterminated)/iu.test(message)
    || (reportedPosition !== undefined && Number(reportedPosition) >= trimmed.length - 1);
  if (!trimmed.startsWith("{") || !failureAtPhysicalEnd) return false;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) return false;
      if (depth === 0 && trimmed.slice(index + 1).trim().length > 0) return false;
    }
  }
  return inString || escaped || depth > 0;
}

function parseCompleteLine(line, index, previous, runId) {
  if (line.length === 0) fail("JOURNAL_CORRUPT_MIDDLE", "journal contains an empty record", { line: index + 1 });
  let record;
  try {
    record = JSON.parse(line);
  } catch (cause) {
    fail("JOURNAL_CORRUPT_MIDDLE", "journal contains invalid JSON before its physical end", { line: index + 1 }, cause);
  }
  return validateEvent(record, runId, previous);
}

function classifyIncoming(events, normalized) {
  const inputDigest = sha256(inputShape(normalized));
  const sameId = events.find((event) => event.eventId === normalized.eventId);
  if (sameId) {
    if (sameId.inputDigest === inputDigest) return { status: "DUPLICATE_EVENT", event: sameId, reason: "EVENT_ID_REPLAY" };
    fail("EVENT_ID_CONFLICT", "eventId was already used for a different event", { eventId: normalized.eventId, seq: sameId.seq });
  }
  const rootTerminal = events.find((event) => ROOT_TERMINAL_TYPES.has(event.type));
  if (rootTerminal) return { status: "LATE_EVENT", event: null, reason: "RUN_ALREADY_TERMINAL", terminalSeq: rootTerminal.seq };
  if (normalized.attemptId !== null && CHILD_EVENT_TYPES.has(normalized.type)) {
    const terminal = events.find((event) => event.type === "ChildTerminal" && event.attemptId === normalized.attemptId);
    if (terminal) return { status: "LATE_EVENT", event: null, reason: "ATTEMPT_ALREADY_TERMINAL", terminalSeq: terminal.seq };
  }
  if (normalized.nodeId !== null && NODE_EVENT_TYPES.has(normalized.type)) {
    const settled = events.find((event) => event.type === "NodeSettled" && event.nodeId === normalized.nodeId);
    if (settled) return { status: "LATE_EVENT", event: null, reason: "NODE_ALREADY_SETTLED", terminalSeq: settled.seq };
  }
  return { status: "NEW_EVENT", event: null, reason: null };
}

function validateExpected(expectedSeq, expectedDigest) {
  validateInteger(expectedSeq, "expectedSeq");
  validateDigest(expectedDigest, "expectedDigest");
}

function leaseIdentity(input) {
  if (input === null || typeof input !== "object") fail("INVALID_LEASE", "lease identity is required");
  validateId(input.writerId, "writerId");
  validateInteger(input.fencingToken, "fencingToken", { min: 1 });
  return { writerId: input.writerId, fencingToken: input.fencingToken };
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

export function createAppendOnlyEventJournal(options = {}) {
  const { filesystem, clock, runDir, runId } = options;
  if (!filesystem || typeof filesystem.open !== "function" || typeof filesystem.readFile !== "function") {
    throw new TypeError("createAppendOnlyEventJournal requires an injected promise filesystem");
  }
  if (typeof clock !== "function") throw new TypeError("createAppendOnlyEventJournal requires an injected clock");
  if (typeof runDir !== "string" || runDir.length === 0) throw new TypeError("runDir is required");
  validateId(runId, "runId");
  const maxRecordBytes = options.maxRecordBytes ?? 64 * 1024;
  validateInteger(maxRecordBytes, "maxRecordBytes", { min: 1024 });
  const lockRetries = options.lockRetries ?? 250;
  validateInteger(lockRetries, "lockRetries", { min: 1 });
  const paths = Object.freeze({
    events: path.join(runDir, "events.jsonl"),
    lease: path.join(runDir, "writer-lease.json"),
    lock: path.join(runDir, ".state-operation.lock"),
    snapshot: path.join(runDir, "snapshot.json"),
  });

  const delay = options.delay ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  if (typeof delay !== "function") throw new TypeError("delay must be a function");

  async function readLeaseUnsafe() {
    const value = await readJson(filesystem, paths.lease, "writer lease", "INVALID_LEASE");
    return value === null ? null : validateLease(value, runId);
  }

  async function writeLeaseUnsafe(value) {
    const complete = { ...value, digest: sha256(value) };
    await atomicWrite(filesystem, paths.lease, `${canonicalJson(complete)}\n`);
    return immutable(complete);
  }

  async function readLockUnsafe() {
    return readJson(filesystem, paths.lock, "state operation lock", "STATE_LOCK_CORRUPT");
  }

  async function createLock(metadata, staleLockRecovery) {
    await filesystem.mkdir(runDir, { recursive: true, mode: 0o700 });
    let lastLockReadError = null;
    for (let attempt = 0; attempt < lockRetries; attempt += 1) {
      let handle;
      try {
        handle = await filesystem.open(paths.lock, "wx", 0o600);
        await handle.writeFile(`${canonicalJson(metadata)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        return;
      } catch (error) {
        if (handle !== undefined) await handle.close().catch(() => {});
        if (error?.code !== "EEXIST") throw error;
        if (typeof staleLockRecovery === "function") {
          let lock;
          try {
            lock = await readLockUnsafe();
            lastLockReadError = null;
          } catch (lockReadError) {
            if (lockReadError?.code !== "STATE_LOCK_CORRUPT") throw lockReadError;
            // open("wx") makes the lock pathname visible before its owner can
            // finish writing and syncing the metadata. Treat an unreadable lock
            // as contended while retries remain, but never unlink it: it may be
            // a live owner's short publication window or a persistent corrupt
            // lock that must fail closed after the retry bound.
            lastLockReadError = lockReadError;
            await delay(1);
            continue;
          }
          if (await staleLockRecovery(lock)) {
            await filesystem.unlink(paths.lock).catch((unlinkError) => {
              if (unlinkError?.code !== "ENOENT") throw unlinkError;
            });
            continue;
          }
        }
        await delay(1);
      }
    }
    if (lastLockReadError !== null) throw lastLockReadError;
    fail("STATE_LOCK_BUSY", "run state is busy with another serialized operation", { runId });
  }

  async function withLock(metadata, operation, staleLockRecovery) {
    await createLock(metadata, staleLockRecovery);
    try {
      return await operation();
    } finally {
      await filesystem.unlink(paths.lock).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }

  async function assertCurrentLeaseUnsafe(input, at = instant(clock)) {
    const identity = leaseIdentity(input);
    const current = await readLeaseUnsafe();
    if (
      current === null
      || current.status !== "active"
      || current.writerId !== identity.writerId
      || current.fencingToken !== identity.fencingToken
      || isExpired(current, at)
    ) {
      fail("STALE_WRITER", "writer lease is absent, expired, released, or fenced", {
        requested: identity,
        current: current && { writerId: current.writerId, fencingToken: current.fencingToken, status: current.status },
      });
    }
    return current;
  }

  function staleLockForLease(identity) {
    return async (lock) => {
      if (!lock || !Number.isSafeInteger(lock.fencingToken)) return false;
      return lock.fencingToken < identity.fencingToken;
    };
  }

  async function recoverUnsafe({ repairTrailingPartial = false } = {}) {
    const text = await readUtf8(filesystem, paths.events);
    if (text === null || text.length === 0) {
      return {
        events: [],
        lastSeq: 0,
        lastEventDigest: GENESIS_EVENT_DIGEST,
        recovery: "CLEAN",
        repairedBytes: 0,
      };
    }
    const terminated = text.endsWith("\n");
    const segments = text.split("\n");
    if (terminated) segments.pop();
    const completeLines = terminated ? segments : segments.slice(0, -1);
    const tail = terminated ? null : segments.at(-1);
    const events = [];
    const eventIds = new Set();
    let previous = null;
    for (let index = 0; index < completeLines.length; index += 1) {
      const record = parseCompleteLine(completeLines[index], index, previous, runId);
      if (eventIds.has(record.eventId)) {
        fail("DUPLICATE_EVENT_ID_IN_JOURNAL", "journal contains the same eventId more than once", {
          eventId: record.eventId,
          seq: record.seq,
        });
      }
      eventIds.add(record.eventId);
      events.push(record);
      previous = record;
    }

    let recovery = "CLEAN";
    let repairedBytes = 0;
    if (tail !== null && tail.length > 0) {
      let parsed;
      try {
        parsed = JSON.parse(tail);
      } catch (cause) {
        if (!looksLikeProvableTrailingPartial(tail, cause)) {
          fail("JOURNAL_TRAILING_CORRUPT", "unterminated journal tail is not a provable partial JSON record", undefined, cause);
        }
        if (!repairTrailingPartial) {
          fail("JOURNAL_TRAILING_PARTIAL", "journal ends with a recoverable partial record", {
            completeEvents: events.length,
            partialBytes: Buffer.byteLength(tail, "utf8"),
          }, cause);
        }
        const completeText = completeLines.length === 0 ? "" : `${completeLines.join("\n")}\n`;
        const keepBytes = Buffer.byteLength(completeText, "utf8");
        repairedBytes = Buffer.byteLength(text, "utf8") - keepBytes;
        await truncateDurable(filesystem, paths.events, keepBytes);
        recovery = "TRAILING_PARTIAL_TRUNCATED";
      }
      if (parsed !== undefined) {
        const record = validateEvent(parsed, runId, previous);
        if (eventIds.has(record.eventId)) {
          fail("DUPLICATE_EVENT_ID_IN_JOURNAL", "journal contains the same eventId more than once", {
            eventId: record.eventId,
            seq: record.seq,
          });
        }
        eventIds.add(record.eventId);
        events.push(record);
        previous = record;
        if (repairTrailingPartial) {
          await appendDurable(filesystem, paths.events, "\n");
          recovery = "TRAILING_TERMINATOR_REPAIRED";
          repairedBytes = -1;
        } else {
          recovery = "VALID_UNTERMINATED_RECORD";
        }
      }
    } else if (tail === "" && !terminated) {
      // An empty file is handled above. This branch is defensive for injected filesystems.
      recovery = "CLEAN";
    }
    return {
      events,
      lastSeq: previous?.seq ?? 0,
      lastEventDigest: previous?.eventDigest ?? GENESIS_EVENT_DIGEST,
      recovery,
      repairedBytes,
    };
  }

  async function acquireWriterLease(input = {}) {
    const writerId = input.writerId;
    validateId(writerId, "writerId");
    const ttlMs = input.ttlMs ?? 30_000;
    validateInteger(ttlMs, "ttlMs", { min: 1 });
    const proof = input.provePreviousWriterDead;
    if (proof !== undefined && typeof proof !== "function") throw new TypeError("provePreviousWriterDead must be a function");
    let provedToken = null;
    const prove = async (current) => {
      if (provedToken === current.fencingToken) return true;
      if (typeof proof !== "function") return false;
      if ((await proof(immutable(jsonClone(current)))) !== true) return false;
      provedToken = current.fencingToken;
      return true;
    };
    const requestedAt = instant(clock);
    const metadata = { fencingToken: 0, purpose: "acquire-lease", writerId, createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      const current = await readLeaseUnsafe();
      if (current && current.status === "active" && !isExpired(current, at)) {
        if (current.writerId === writerId) return immutable(jsonClone(current));
        fail("LEASE_HELD", "another writer holds the active lease", {
          writerId: current.writerId,
          fencingToken: current.fencingToken,
          expiresAt: current.expiresAt,
        });
      }
      if (current?.status === "active" && isExpired(current, at) && !(await prove(current))) {
        fail("LEASE_RECLAIM_PROOF_REQUIRED", "expired writer lease requires proof that the prior writer is dead", {
          writerId: current.writerId,
          fencingToken: current.fencingToken,
          expiresAt: current.expiresAt,
        });
      }
      const payload = {
        formatVersion: 1,
        runId,
        writerId,
        fencingToken: (current?.fencingToken ?? 0) + 1,
        status: "active",
        acquiredAt: at.toISOString(),
        expiresAt: new Date(at.valueOf() + ttlMs).toISOString(),
        releasedAt: null,
      };
      return writeLeaseUnsafe(payload);
    }, async (lock) => {
      const at = instant(clock);
      const current = await readLeaseUnsafe();
      if (!current || current.status !== "active" || !isExpired(current, at)) return false;
      if (!lock || lock.fencingToken !== current.fencingToken) return false;
      return prove(current);
    });
  }

  async function renewWriterLease(input = {}) {
    const identity = leaseIdentity(input.lease);
    const ttlMs = input.ttlMs ?? 30_000;
    validateInteger(ttlMs, "ttlMs", { min: 1 });
    const requestedAt = instant(clock);
    const metadata = { ...identity, purpose: "renew-lease", createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      const current = await assertCurrentLeaseUnsafe(identity, at);
      return writeLeaseUnsafe({
        ...leasePayload(current),
        expiresAt: new Date(at.valueOf() + ttlMs).toISOString(),
      });
    }, staleLockForLease(identity));
  }

  async function releaseWriterLease(input = {}) {
    const identity = leaseIdentity(input.lease);
    const requestedAt = instant(clock);
    const metadata = { ...identity, purpose: "release-lease", createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      const current = await assertCurrentLeaseUnsafe(identity, at);
      return writeLeaseUnsafe({
        ...leasePayload(current),
        status: "released",
        releasedAt: at.toISOString(),
      });
    }, staleLockForLease(identity));
  }

  async function getWriterLease() {
    const lease = await readLeaseUnsafe();
    return lease === null ? null : immutable(jsonClone(lease));
  }

  async function recover(input = {}) {
    const repairTrailingPartial = input.repairTrailingPartial === true;
    if (!repairTrailingPartial) {
      const result = await recoverUnsafe({ repairTrailingPartial: false });
      return immutable(jsonClone(result));
    }
    const identity = leaseIdentity(input.lease);
    const requestedAt = instant(clock);
    const metadata = { ...identity, purpose: "recover-journal", createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      await assertCurrentLeaseUnsafe(identity, at);
      return immutable(jsonClone(await recoverUnsafe({ repairTrailingPartial: true })));
    }, staleLockForLease(identity));
  }

  async function appendEvent(input = {}) {
    const identity = leaseIdentity(input.lease);
    validateExpected(input.expectedSeq, input.expectedDigest);
    const normalized = normalizeEventInput(input.event);
    const requestedAt = instant(clock);
    const metadata = { ...identity, purpose: "append-event", createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      await assertCurrentLeaseUnsafe(identity, at);
      const state = await recoverUnsafe({ repairTrailingPartial: true });
      const classification = classifyIncoming(state.events, normalized);
      if (classification.status !== "NEW_EVENT") {
        return immutable({
          status: classification.status,
          appended: false,
          reason: classification.reason,
          terminalSeq: classification.terminalSeq ?? null,
          event: classification.event ? jsonClone(classification.event) : null,
          lastSeq: state.lastSeq,
          lastEventDigest: state.lastEventDigest,
        });
      }
      if (state.lastSeq !== input.expectedSeq || state.lastEventDigest !== input.expectedDigest) {
        fail("JOURNAL_CAS_MISMATCH", "journal expected seq/digest does not match durable state", {
          expectedSeq: input.expectedSeq,
          actualSeq: state.lastSeq,
          expectedDigest: input.expectedDigest,
          actualDigest: state.lastEventDigest,
        });
      }
      const record = {
        formatVersion: 1,
        runId,
        seq: state.lastSeq + 1,
        eventId: normalized.eventId,
        type: normalized.type,
        timestamp: at.toISOString(),
        revision: normalized.revision,
        nodeId: normalized.nodeId,
        attemptId: normalized.attemptId,
        swarmRunId: normalized.swarmRunId,
        childId: normalized.childId,
        writerId: identity.writerId,
        fencingToken: identity.fencingToken,
        inputDigest: sha256(inputShape(normalized)),
        prevEventDigest: state.lastEventDigest,
        payload: normalized.payload,
      };
      record.eventDigest = sha256(record);
      const line = `${canonicalJson(record)}\n`;
      if (Buffer.byteLength(line, "utf8") > maxRecordBytes) {
        fail("EVENT_RECORD_TOO_LARGE", "event record exceeds the configured byte bound", { maxRecordBytes });
      }
      await appendDurable(filesystem, paths.events, line);
      return immutable({
        status: "APPENDED",
        appended: true,
        reason: null,
        terminalSeq: null,
        event: jsonClone(record),
        lastSeq: record.seq,
        lastEventDigest: record.eventDigest,
      });
    }, staleLockForLease(identity));
  }

  async function publishSnapshot(input = {}) {
    const identity = leaseIdentity(input.lease);
    validateExpected(input.expectedSeq, input.expectedDigest);
    validateInteger(input.activeRevision, "activeRevision");
    const snapshotState = assertPlainJson(input.state ?? {}, "snapshot state");
    const requestedAt = instant(clock);
    const metadata = { ...identity, purpose: "publish-snapshot", createdAt: requestedAt.toISOString() };
    return withLock(metadata, async () => {
      const at = instant(clock);
      await assertCurrentLeaseUnsafe(identity, at);
      const journalState = await recoverUnsafe({ repairTrailingPartial: true });
      if (journalState.lastSeq !== input.expectedSeq || journalState.lastEventDigest !== input.expectedDigest) {
        fail("JOURNAL_CAS_MISMATCH", "snapshot expected seq/digest does not match durable journal", {
          expectedSeq: input.expectedSeq,
          actualSeq: journalState.lastSeq,
          expectedDigest: input.expectedDigest,
          actualDigest: journalState.lastEventDigest,
        });
      }
      const payload = {
        formatVersion: 1,
        runId,
        createdAt: at.toISOString(),
        lastAppliedSeq: journalState.lastSeq,
        lastEventDigest: journalState.lastEventDigest,
        activeRevision: input.activeRevision,
        state: snapshotState,
      };
      const snapshot = { ...payload, digest: sha256(payload) };
      await atomicWrite(filesystem, paths.snapshot, `${canonicalJson(snapshot)}\n`);
      return immutable(snapshot);
    }, staleLockForLease(identity));
  }

  async function loadSnapshot(input = {}) {
    const value = await readJson(filesystem, paths.snapshot, "snapshot", "INVALID_SNAPSHOT");
    if (value === null) return null;
    const snapshot = validateSnapshot(value, runId);
    if (input.verifyAgainstJournal === true) {
      const journalState = await recoverUnsafe({ repairTrailingPartial: false });
      if (snapshot.lastAppliedSeq > journalState.lastSeq) {
        fail("SNAPSHOT_JOURNAL_MISMATCH", "snapshot is ahead of the journal", {
          snapshotSeq: snapshot.lastAppliedSeq,
          journalSeq: journalState.lastSeq,
        });
      }
      const expectedDigest = snapshot.lastAppliedSeq === 0
        ? GENESIS_EVENT_DIGEST
        : journalState.events[snapshot.lastAppliedSeq - 1]?.eventDigest;
      if (snapshot.lastEventDigest !== expectedDigest) {
        fail("SNAPSHOT_JOURNAL_MISMATCH", "snapshot event digest is not present at lastAppliedSeq", {
          snapshotSeq: snapshot.lastAppliedSeq,
        });
      }
    }
    return immutable(jsonClone(snapshot));
  }

  return Object.freeze({
    runId,
    runDir,
    paths,
    acquireWriterLease,
    renewWriterLease,
    releaseWriterLease,
    getWriterLease,
    appendEvent,
    recover,
    publishSnapshot,
    loadSnapshot,
  });
}
