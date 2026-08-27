import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GENESIS_EVENT_DIGEST,
  createEventJournal,
  sha256,
} from "../packages/subagents/state/index.mjs";
import {
  createBudgetLedger,
  createBudgetReservationLedger,
  rebuildBudgetStateFromEvents,
} from "../packages/subagents/policy/budget-ledger.mjs";

function fakeClock(start = "2026-08-18T00:00:00.000Z") {
  let value = Date.parse(start);
  const clock = () => new Date(value);
  clock.advance = (milliseconds) => { value += milliseconds; };
  return clock;
}

async function temporaryRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-subagents-state-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

function hasCode(code) {
  return (error) => error?.code === code;
}

function manager(rootDir, clock, options = {}) {
  return createEventJournal({
    rootDir,
    filesystem: options.filesystem ?? fs,
    clock,
    idFactory: options.idFactory ?? ((prefix) => `${prefix}-generated`),
    lockRetries: options.lockRetries ?? 2_000,
    delay: options.delay,
  });
}

async function appendAtHead(journal, runId, lease, event) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let state;
    try {
      state = await journal.read(runId);
    } catch (error) {
      if (["JOURNAL_TRAILING_PARTIAL", "JOURNAL_TRAILING_CORRUPT"].includes(error?.code)) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      throw error;
    }
    try {
      return await journal.append(runId, event, {
        lease,
        expectedSeq: state.lastSeq,
        expectedDigest: state.lastEventDigest,
      });
    } catch (error) {
      if (error?.code !== "JOURNAL_CAS_MISMATCH") throw error;
    }
  }
  throw new Error("appendAtHead exhausted CAS retries");
}

test("writer lease is exclusive and every takeover increments the fencing token", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const journal = manager(root, clock);
  const first = await journal.acquireWriter("run-lease", { writerId: "writer-a", ttlMs: 1_000 });
  assert.equal(first.fencingToken, 1);
  assert.equal(first.status, "active");
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u);

  await assert.rejects(
    journal.acquireWriter("run-lease", { writerId: "writer-b", ttlMs: 1_000 }),
    hasCode("LEASE_HELD"),
  );
  clock.advance(1_001);
  await assert.rejects(
    journal.acquireWriter("run-lease", { writerId: "writer-b", ttlMs: 1_000 }),
    hasCode("LEASE_RECLAIM_PROOF_REQUIRED"),
  );
  await fs.writeFile(journal.forRun("run-lease").paths.lock, `${JSON.stringify({
    fencingToken: 1,
    purpose: "crashed-append",
    writerId: "writer-a",
    createdAt: "2026-08-18T00:00:00.000Z",
  })}\n`, "utf8");
  let proved;
  const second = await journal.acquireWriter("run-lease", {
    writerId: "writer-b",
    ttlMs: 1_000,
    provePreviousWriterDead(previous) {
      proved = previous;
      return true;
    },
  });
  assert.equal(proved.fencingToken, 1);
  assert.equal(second.fencingToken, 2);

  await assert.rejects(
    journal.append("run-lease", { eventId: "stale-write", type: "RunPlanned", payload: {} }, {
      lease: first,
      expectedSeq: 0,
      expectedDigest: GENESIS_EVENT_DIGEST,
    }),
    hasCode("STALE_WRITER"),
  );
  const appended = await journal.append("run-lease", { eventId: "current-write", type: "RunPlanned", payload: {} }, {
    lease: second,
    expectedSeq: 0,
    expectedDigest: GENESIS_EVENT_DIGEST,
  });
  assert.equal(appended.event.fencingToken, 2);

  const released = await journal.releaseWriter("run-lease", { lease: second });
  assert.equal(released.status, "released");
  const third = await journal.acquireWriter("run-lease", { writerId: "writer-c", ttlMs: 1_000 });
  assert.equal(third.fencingToken, 3);
  const renewed = await journal.renewWriter("run-lease", { lease: third, ttlMs: 5_000 });
  assert.equal(renewed.fencingToken, 3);
  assert.notEqual(renewed.expiresAt, third.expiresAt);
});

test("an operation that waited for the state lock rechecks lease expiry inside its critical section", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  let delayObserved;
  let releaseDelay;
  const observed = new Promise((resolve) => { delayObserved = resolve; });
  const released = new Promise((resolve) => { releaseDelay = resolve; });
  const journal = manager(root, clock, {
    lockRetries: 100,
    async delay() {
      delayObserved();
      await released;
    },
  });
  const runId = "run-expiry-after-wait";
  const lease = await journal.acquireWriter(runId, { writerId: "writer-expiry-after-wait", ttlMs: 10 });
  const lockPath = journal.forRun(runId).paths.lock;
  await fs.writeFile(lockPath, `${JSON.stringify({
    fencingToken: lease.fencingToken,
    purpose: "blocking-operation",
    writerId: lease.writerId,
    createdAt: "2026-08-18T00:00:00.000Z",
  })}\n`, "utf8");

  const append = journal.append(runId, {
    eventId: "must-not-outlive-lease",
    type: "RunPlanned",
    payload: {},
  }, {
    lease,
    expectedSeq: 0,
    expectedDigest: GENESIS_EVENT_DIGEST,
  });
  await observed;
  clock.advance(11);
  await fs.unlink(lockPath);
  releaseDelay();

  await assert.rejects(append, hasCode("STALE_WRITER"));
  assert.equal((await journal.read(runId)).lastSeq, 0);
});

test("event journal enforces CAS, digest chaining, duplicate identity, and late terminal classification", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const journal = manager(root, clock);
  const lease = await journal.acquireWriter("run-events", { writerId: "writer-events", ttlMs: 60_000 });

  const started = await journal.append("run-events", {
    eventId: "run-started",
    type: "RunStarted",
    revision: 1,
    payload: { plan: "plan-1" },
  }, { lease, expectedSeq: 0, expectedDigest: GENESIS_EVENT_DIGEST });
  clock.advance(1);
  const child = await journal.append("run-events", {
    eventId: "child-started",
    type: "ChildStarted",
    revision: 1,
    nodeId: "node-a",
    attemptId: "attempt-a",
    childId: "child-a",
    payload: { backend: "injected" },
  }, { lease, expectedSeq: started.lastSeq, expectedDigest: started.lastEventDigest });

  const duplicate = await journal.append("run-events", {
    eventId: "child-started",
    type: "ChildStarted",
    revision: 1,
    nodeId: "node-a",
    attemptId: "attempt-a",
    childId: "child-a",
    payload: { backend: "injected" },
  }, { lease, expectedSeq: 0, expectedDigest: GENESIS_EVENT_DIGEST });
  assert.equal(duplicate.status, "DUPLICATE_EVENT");
  assert.equal(duplicate.lastSeq, 2);
  await assert.rejects(
    journal.append("run-events", {
      eventId: "child-started",
      type: "ChildStarted",
      revision: 1,
      nodeId: "node-a",
      attemptId: "attempt-a",
      childId: "child-a",
      payload: { backend: "different" },
    }, { lease, expectedSeq: child.lastSeq, expectedDigest: child.lastEventDigest }),
    hasCode("EVENT_ID_CONFLICT"),
  );

  const terminal = await journal.append("run-events", {
    eventId: "child-terminal",
    type: "ChildTerminal",
    revision: 1,
    nodeId: "node-a",
    attemptId: "attempt-a",
    childId: "child-a",
    payload: { status: "completed" },
  }, { lease, expectedSeq: child.lastSeq, expectedDigest: child.lastEventDigest });
  const late = await journal.append("run-events", {
    eventId: "late-output",
    type: "ChildOutputProjected",
    revision: 1,
    nodeId: "node-a",
    attemptId: "attempt-a",
    childId: "child-a",
    payload: { summary: "too late" },
  }, { lease, expectedSeq: terminal.lastSeq, expectedDigest: terminal.lastEventDigest });
  assert.equal(late.status, "LATE_EVENT");
  assert.equal(late.reason, "ATTEMPT_ALREADY_TERMINAL");
  assert.equal(late.lastSeq, 3);

  await assert.rejects(
    journal.append("run-events", { eventId: "unseen", type: "NodeQueued", nodeId: "node-b", payload: {} }, {
      lease,
      expectedSeq: 1,
      expectedDigest: started.lastEventDigest,
    }),
    hasCode("JOURNAL_CAS_MISMATCH"),
  );
  const recovered = await journal.read("run-events");
  assert.deepEqual(recovered.events.map((event) => event.seq), [1, 2, 3]);
  assert.equal(recovered.events[0].prevEventDigest, GENESIS_EVENT_DIGEST);
  for (let index = 1; index < recovered.events.length; index += 1) {
    assert.equal(recovered.events[index].prevEventDigest, recovered.events[index - 1].eventDigest);
  }
  assert.equal(recovered.lastEventDigest, terminal.lastEventDigest);
  assert.equal((await journal.verify("run-events")).ok, true);
});

test("concurrent CAS property preserves one contiguous append-only sequence", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const journal = manager(root, clock, { lockRetries: 5_000 });
  const lease = await journal.acquireWriter("run-property", { writerId: "writer-property", ttlMs: 120_000 });
  const count = 40;
  await Promise.all(Array.from({ length: count }, (_, index) => appendAtHead(journal, "run-property", lease, {
    eventId: `property-${index}`,
    type: "NodeQueued",
    revision: 1,
    nodeId: `node-${index}`,
    payload: { index },
  })));
  const state = await journal.read("run-property");
  assert.equal(state.events.length, count);
  assert.deepEqual(state.events.map((event) => event.seq), Array.from({ length: count }, (_, index) => index + 1));
  assert.equal(new Set(state.events.map((event) => event.eventId)).size, count);
  for (let index = 0; index < count; index += 1) {
    assert.equal(state.events[index].prevEventDigest, index === 0 ? GENESIS_EVENT_DIGEST : state.events[index - 1].eventDigest);
  }
});

test("lock contenders retry the owner's partial metadata publication without deleting the lock", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  let delayNextLockWrite = false;
  let lockWriteBlocked;
  let partialLockObserved;
  let releaseLockWrite;
  const writeBlocked = new Promise((resolve) => { lockWriteBlocked = resolve; });
  const partialObserved = new Promise((resolve) => { partialLockObserved = resolve; });
  const releaseWrite = new Promise((resolve) => { releaseLockWrite = resolve; });
  const delayedFilesystem = new Proxy(fs, {
    get(target, property) {
      if (property === "open") {
        return async (targetPath, flags, mode) => {
          const handle = await target.open(targetPath, flags, mode);
          if (delayNextLockWrite && targetPath.endsWith(`${path.sep}.state-operation.lock`) && flags === "wx") {
            delayNextLockWrite = false;
            return new Proxy(handle, {
              get(handleTarget, handleProperty) {
                if (handleProperty === "writeFile") {
                  return async (...arguments_) => {
                    lockWriteBlocked();
                    await releaseWrite;
                    return handleTarget.writeFile(...arguments_);
                  };
                }
                const value = handleTarget[handleProperty];
                return typeof value === "function" ? value.bind(handleTarget) : value;
              },
            });
          }
          return handle;
        };
      }
      if (property === "readFile") {
        return async (targetPath, ...arguments_) => {
          const result = await target.readFile(targetPath, ...arguments_);
          if (targetPath.endsWith(`${path.sep}.state-operation.lock`) && result.length === 0) partialLockObserved();
          return result;
        };
      }
      return target[property];
    },
  });
  const journal = manager(root, clock, { filesystem: delayedFilesystem, lockRetries: 5_000 });
  const runId = "run-lock-publication";
  const lease = await journal.acquireWriter(runId, { writerId: "writer-lock-publication", ttlMs: 120_000 });

  delayNextLockWrite = true;
  const first = appendAtHead(journal, runId, lease, {
    eventId: "lock-publication-one",
    type: "NodeQueued",
    nodeId: "node-lock-one",
    payload: {},
  });
  await writeBlocked;
  const second = appendAtHead(journal, runId, lease, {
    eventId: "lock-publication-two",
    type: "NodeQueued",
    nodeId: "node-lock-two",
    payload: {},
  });
  await partialObserved;
  releaseLockWrite();
  await Promise.all([first, second]);

  const state = await journal.read(runId);
  assert.deepEqual(state.events.map((event) => event.seq), [1, 2]);
  assert.equal(new Set(state.events.map((event) => event.eventId)).size, 2);
});

test("recovery truncates only a provable final partial record and never skips middle corruption", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const journal = manager(root, clock);
  const runId = "run-partial";
  const lease = await journal.acquireWriter(runId, { writerId: "writer-partial", ttlMs: 60_000 });
  await appendAtHead(journal, runId, lease, { eventId: "event-one", type: "RunPlanned", payload: { n: 1 } });
  await appendAtHead(journal, runId, lease, { eventId: "event-two", type: "RunStarted", payload: { n: 2 } });
  const eventsPath = journal.forRun(runId).paths.events;
  await fs.appendFile(eventsPath, "{\"formatVersion\":1", "utf8");
  await assert.rejects(journal.read(runId), hasCode("JOURNAL_TRAILING_PARTIAL"));
  const repaired = await journal.read(runId, { repairTrailingPartial: true, lease });
  assert.equal(repaired.recovery, "TRAILING_PARTIAL_TRUNCATED");
  assert.equal(repaired.events.length, 2);
  await appendAtHead(journal, runId, lease, { eventId: "event-three", type: "NodeQueued", nodeId: "node-three", payload: {} });
  assert.equal((await journal.read(runId)).lastSeq, 3);

  const middleRun = "run-middle-corrupt";
  const middleLease = await journal.acquireWriter(middleRun, { writerId: "writer-middle", ttlMs: 60_000 });
  await appendAtHead(journal, middleRun, middleLease, { eventId: "middle-one", type: "RunPlanned", payload: {} });
  await appendAtHead(journal, middleRun, middleLease, { eventId: "middle-two", type: "RunStarted", payload: {} });
  const middlePath = journal.forRun(middleRun).paths.events;
  const validLines = (await fs.readFile(middlePath, "utf8")).trimEnd().split("\n");
  const corruptMiddle = `${validLines[0]}\n{\"broken\":\n${validLines[1]}\n`;
  await fs.writeFile(middlePath, corruptMiddle, "utf8");
  await assert.rejects(
    journal.read(middleRun, { repairTrailingPartial: true, lease: middleLease }),
    hasCode("JOURNAL_CORRUPT_MIDDLE"),
  );
  assert.equal(await fs.readFile(middlePath, "utf8"), corruptMiddle);

  const digestRun = "run-tail-digest";
  const digestLease = await journal.acquireWriter(digestRun, { writerId: "writer-digest", ttlMs: 60_000 });
  await appendAtHead(journal, digestRun, digestLease, { eventId: "digest-one", type: "RunPlanned", payload: {} });
  const digestPath = journal.forRun(digestRun).paths.events;
  const record = JSON.parse((await fs.readFile(digestPath, "utf8")).trimEnd());
  record.eventDigest = `sha256:${"0".repeat(64)}`;
  const invalidCompleteTail = JSON.stringify(record);
  await fs.writeFile(digestPath, invalidCompleteTail, "utf8");
  await assert.rejects(
    journal.read(digestRun, { repairTrailingPartial: true, lease: digestLease }),
    hasCode("EVENT_DIGEST_MISMATCH"),
  );
  assert.equal(await fs.readFile(digestPath, "utf8"), invalidCompleteTail);

  const fencingRun = "run-fencing-regression";
  const fencingOne = await journal.acquireWriter(fencingRun, { writerId: "writer-fencing-one", ttlMs: 60_000 });
  await appendAtHead(journal, fencingRun, fencingOne, { eventId: "fencing-one", type: "RunPlanned", payload: {} });
  await journal.releaseWriter(fencingRun, { lease: fencingOne });
  const fencingTwo = await journal.acquireWriter(fencingRun, { writerId: "writer-fencing-two", ttlMs: 60_000 });
  await appendAtHead(journal, fencingRun, fencingTwo, { eventId: "fencing-two", type: "RunStarted", payload: {} });
  const fencingPath = journal.forRun(fencingRun).paths.events;
  const fencingLines = (await fs.readFile(fencingPath, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
  fencingLines[0].fencingToken = 2;
  const firstDigestProjection = { ...fencingLines[0] };
  delete firstDigestProjection.eventDigest;
  fencingLines[0].eventDigest = sha256(firstDigestProjection);
  fencingLines[1].fencingToken = 1;
  fencingLines[1].prevEventDigest = fencingLines[0].eventDigest;
  const digestProjection = { ...fencingLines[1] };
  delete digestProjection.eventDigest;
  fencingLines[1].eventDigest = sha256(digestProjection);
  await fs.writeFile(fencingPath, `${fencingLines.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  await assert.rejects(journal.read(fencingRun), hasCode("EVENT_FENCING_REGRESSION"));
});

test("snapshot publication is atomic, digest-bound, and tied to an exact journal position", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const journal = manager(root, clock);
  const runId = "run-snapshot";
  const lease = await journal.acquireWriter(runId, { writerId: "writer-snapshot", ttlMs: 60_000 });
  const event = await journal.append(runId, {
    eventId: "snapshot-event",
    type: "RevisionActivated",
    revision: 3,
    payload: { revision: 3 },
  }, { lease, expectedSeq: 0, expectedDigest: GENESIS_EVENT_DIGEST });
  const first = await journal.writeSnapshot(runId, { activeRevision: 3, state: { status: "running" } }, {
    lease,
    expectedSeq: event.lastSeq,
    expectedDigest: event.lastEventDigest,
  });
  assert.equal(first.lastAppliedSeq, 1);
  assert.equal(first.lastEventDigest, event.lastEventDigest);
  assert.equal(first.activeRevision, 3);
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(await journal.readSnapshot(runId, { verifyAgainstJournal: true }), first);

  let failSnapshotRename = true;
  const faultFilesystem = new Proxy(fs, {
    get(target, property) {
      if (property === "rename") {
        return async (source, destination) => {
          if (failSnapshotRename && destination.endsWith(`${path.sep}snapshot.json`)) {
            const error = new Error("injected snapshot rename fault");
            error.code = "EIO";
            throw error;
          }
          return target.rename(source, destination);
        };
      }
      return target[property];
    },
  });
  const faulty = manager(root, clock, { filesystem: faultFilesystem });
  await assert.rejects(
    faulty.writeSnapshot(runId, { activeRevision: 4, state: { status: "new" } }, {
      lease,
      expectedSeq: event.lastSeq,
      expectedDigest: event.lastEventDigest,
    }),
    hasCode("ATOMIC_PUBLICATION_FAILED"),
  );
  assert.deepEqual(await journal.readSnapshot(runId), first);
  failSnapshotRename = false;

  const snapshotPath = journal.forRun(runId).paths.snapshot;
  const corrupt = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
  corrupt.state.status = "tampered";
  await fs.writeFile(snapshotPath, `${JSON.stringify(corrupt)}\n`, "utf8");
  await assert.rejects(journal.readSnapshot(runId), hasCode("SNAPSHOT_DIGEST_MISMATCH"));
});

test("budget reservations survive restart, refund unused worst-case capacity, and cannot double-spend", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const events = manager(root, clock, { lockRetries: 5_000 });
  const runId = "run-budget";
  const lease = await events.acquireWriter(runId, { writerId: "writer-budget", ttlMs: 120_000 });
  const envelope = {
    maxAssignments: 2,
    maxTurns: 100,
    maxTokens: 1_000,
    maxCostUsd: 10,
  };
  const ledger = createBudgetLedger({
    eventJournal: events,
    envelope,
    metering: { tokens: "AVAILABLE", cost: "AVAILABLE" },
    maxCasRetries: 64,
  });
  const firstRequest = {
    reservationId: "reservation-one",
    ownerId: "attempt-one",
    worstCase: { maxAssignments: 1, maxTurns: 60, maxTokens: 600, maxCostUsd: 6 },
  };
  const first = await ledger.reserve(runId, firstRequest, { lease });
  assert.equal(first.status, "RESERVED");
  const duplicate = await ledger.reserve(runId, firstRequest, { lease });
  assert.equal(duplicate.status, "ALREADY_RESERVED");
  await assert.rejects(
    ledger.reserve(runId, { ...firstRequest, worstCase: { assignments: 1, turns: 59, tokens: 600, costUsd: 6 } }, { lease }),
    hasCode("RESERVATION_CONFLICT"),
  );
  await assert.rejects(
    ledger.reserve(runId, {
      reservationId: "reservation-too-large",
      ownerId: "attempt-two",
      worstCase: { assignments: 1, turns: 50, tokens: 500, costUsd: 5 },
    }, { lease }),
    hasCode("BUDGET_EXHAUSTED"),
  );

  const consumed = await ledger.settle(runId, "reservation-one", {
    consumed: { assignments: 1, turns: 40, tokens: 400, costUsd: 4 },
  });
  assert.equal(consumed.status, "CONSUMED");
  const secondRequest = {
    reservationId: "reservation-two",
    ownerId: "attempt-two",
    worstCase: { assignments: 1, turns: 50, tokens: 500, costUsd: 5 },
  };
  assert.equal((await ledger.reserve(runId, secondRequest)).status, "RESERVED");
  assert.equal((await ledger.refund(runId, "reservation-two")).status, "REFUNDED");

  const restarted = createBudgetLedger({
    eventJournal: events,
    envelope,
    metering: { tokens: true, cost: true },
  });
  const recovered = await restarted.snapshot(runId);
  assert.deepEqual(recovered.consumed, { assignments: 1, cost: 4, tokens: 400, turns: 40 });
  assert.deepEqual(recovered.outstanding, {});
  assert.equal(recovered.available.assignments, 1);
  assert.equal(recovered.available.turns, 60);
  assert.equal((await restarted.settle(runId, "reservation-one", {
    consumed: { assignments: 1, turns: 40, tokens: 400, costUsd: 4 },
  }, { lease })).status, "ALREADY_SETTLED");
  await assert.rejects(
    restarted.settle(runId, "reservation-one", {
      consumed: { assignments: 1, turns: 41, tokens: 400, costUsd: 4 },
    }, { lease }),
    hasCode("RESERVATION_ALREADY_SETTLED"),
  );
  await assert.rejects(
    restarted.reserve(runId, {
      reservationId: "reservation-version",
      ownerId: "attempt-version",
      worstCase: { assignments: 1, tokens: 1, costUsd: 1 },
    }, { lease, expectedVersion: 0 }),
    hasCode("BUDGET_VERSION_MISMATCH"),
  );

  const durableEvents = (await events.read(runId)).events;
  const replayed = rebuildBudgetStateFromEvents(durableEvents, envelope);
  assert.deepEqual(replayed.consumed, recovered.consumed);
  assert.equal(durableEvents.filter((event) => event.type === "BudgetReserved").length, 2);
  assert.equal(durableEvents.filter((event) => ["BudgetConsumed", "BudgetRefunded"].includes(event.type)).length, 2);
});

test("hard token or cost admission fails closed when reliable metering is unavailable", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const events = manager(root, clock);
  const runId = "run-metering";
  const lease = await events.acquireWriter(runId, { writerId: "writer-metering", ttlMs: 60_000 });
  const tokenLedger = createBudgetReservationLedger({
    journal: events.forRun(runId),
    envelope: { maxTokens: 100, maxTotalAssignments: 1 },
    metering: { tokens: "UNAVAILABLE" },
  });
  await assert.rejects(
    tokenLedger.reserve({
      reservationId: "token-reservation",
      ownerId: "token-attempt",
      worstCase: { assignments: 1 },
    }, { lease }),
    hasCode("METERING_UNAVAILABLE"),
  );
  const incompleteLedger = createBudgetReservationLedger({
    journal: events.forRun(runId),
    envelope: { maxTokens: 100, maxTotalAssignments: 1 },
    metering: { tokens: true },
  });
  await assert.rejects(
    incompleteLedger.reserve({
      reservationId: "missing-token-reservation",
      ownerId: "missing-token-attempt",
      worstCase: { assignments: 1 },
    }, { lease }),
    hasCode("BUDGET_RESERVATION_INCOMPLETE"),
  );
  const costLedger = createBudgetReservationLedger({
    journal: events.forRun(runId),
    envelope: { maxCostUsd: 5 },
    metering: { costUsd: false },
  });
  await assert.rejects(
    costLedger.reserve({
      reservationId: "cost-reservation",
      ownerId: "cost-attempt",
      worstCase: { costUsd: 1 },
    }, { lease }),
    hasCode("METERING_UNAVAILABLE"),
  );
  assert.equal((await events.read(runId)).events.length, 0);

  assert.throws(() => rebuildBudgetStateFromEvents([
    {
      seq: 1,
      type: "BudgetReserved",
      payload: { reservationId: "overspend-one", ownerId: "attempt-one", worstCase: { assignments: 1 } },
    },
    {
      seq: 2,
      type: "BudgetReserved",
      payload: { reservationId: "overspend-two", ownerId: "attempt-two", worstCase: { assignments: 1 } },
    },
  ], { maxAssignments: 1 }), hasCode("BUDGET_JOURNAL_OVERSPENT"));
});

test("concurrent reservation property never commits above a hard parent budget", async (t) => {
  const root = await temporaryRoot(t);
  const clock = fakeClock();
  const events = manager(root, clock, { lockRetries: 10_000 });
  const runId = "run-budget-property";
  const lease = await events.acquireWriter(runId, { writerId: "writer-budget-property", ttlMs: 120_000 });
  const ledger = createBudgetLedger({
    eventJournal: events,
    envelope: { maxTotalAssignments: 10, maxTurns: 100 },
    maxCasRetries: 128,
  });
  const outcomes = await Promise.allSettled(Array.from({ length: 30 }, (_, index) => ledger.reserve(runId, {
    reservationId: `parallel-${index}`,
    ownerId: `attempt-${index}`,
    worstCase: { assignments: 1, turns: 10 },
  }, { lease })));
  const admitted = outcomes.filter((entry) => entry.status === "fulfilled");
  const denied = outcomes.filter((entry) => entry.status === "rejected");
  assert.equal(admitted.length, 10);
  assert.equal(denied.length, 20);
  assert.equal(denied.every((entry) => entry.reason?.code === "BUDGET_EXHAUSTED"), true);
  const state = await ledger.snapshot(runId);
  assert.equal(state.committed.assignments, 10);
  assert.equal(state.committed.turns, 100);
  assert.equal(state.available.assignments, 0);
  assert.equal(state.available.turns, 0);

  const restarted = createBudgetLedger({
    eventJournal: events,
    envelope: { maxTotalAssignments: 10, maxTurns: 100 },
    maxCasRetries: 128,
  });
  assert.equal((await restarted.snapshot(runId)).reservations.length, 10);
  await Promise.all(admitted.map((entry) => restarted.refund(runId, entry.value.reservation.reservationId, { lease })));
  const refunded = await restarted.snapshot(runId);
  assert.deepEqual(refunded.outstanding, {});
  assert.equal(refunded.available.assignments, 10);
  assert.equal(refunded.available.turns, 100);
});
