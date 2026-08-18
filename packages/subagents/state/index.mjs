import path from "node:path";

import { createAppendOnlyEventJournal, RunStateError } from "./event-journal.mjs";

const RUN_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function validateRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) {
    throw new RunStateError("runId must be a canonical identifier", "INVALID_ID");
  }
  return runId;
}

/**
 * Multi-run facade used by RunCoordinator. Durable state remains scoped to one
 * run directory and every mutating call still requires that run's writer lease.
 */
export function createEventJournal(options = {}) {
  const storage = options.storage;
  const filesystem = options.filesystem ?? storage?.filesystem ?? (typeof storage?.open === "function" ? storage : null);
  const rootDir = options.rootDir ?? storage?.rootDir;
  const clock = options.clock;
  const idFactory = options.idFactory;
  if (!filesystem) throw new TypeError("createEventJournal requires an injected filesystem or storage.filesystem");
  if (typeof rootDir !== "string" || rootDir.length === 0) throw new TypeError("createEventJournal requires rootDir or storage.rootDir");
  if (typeof clock !== "function") throw new TypeError("createEventJournal requires an injected clock");
  if (idFactory !== undefined && typeof idFactory !== "function") throw new TypeError("idFactory must be a function");
  const journals = new Map();

  function forRun(runId) {
    validateRunId(runId);
    let journal = journals.get(runId);
    if (!journal) {
      journal = createAppendOnlyEventJournal({
        filesystem,
        clock,
        runId,
        runDir: path.join(rootDir, runId),
        maxRecordBytes: options.maxRecordBytes,
        lockRetries: options.lockRetries,
        delay: options.delay,
      });
      journals.set(runId, journal);
    }
    return journal;
  }

  return Object.freeze({
    rootDir,
    forRun,
    acquireWriter(runId, input = {}) {
      const writerId = input.writerId ?? idFactory?.("writer", { runId });
      if (!writerId) throw new TypeError("acquireWriter requires writerId or an injected idFactory");
      return forRun(runId).acquireWriterLease({ ...input, writerId });
    },
    renewWriter(runId, input) {
      return forRun(runId).renewWriterLease(input);
    },
    releaseWriter(runId, input) {
      return forRun(runId).releaseWriterLease(input);
    },
    writer(runId) {
      return forRun(runId).getWriterLease();
    },
    append(runId, event, input = {}) {
      return forRun(runId).appendEvent({ ...input, event });
    },
    read(runId, input = {}) {
      return forRun(runId).recover(input);
    },
    async verify(runId, input = {}) {
      const journal = forRun(runId);
      const events = await journal.recover(input);
      const snapshot = await journal.loadSnapshot({ verifyAgainstJournal: true });
      return Object.freeze({ ok: true, journal: events, snapshot });
    },
    writeSnapshot(runId, snapshot, input = {}) {
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new TypeError("snapshot must be an object");
      }
      return forRun(runId).publishSnapshot({
        ...input,
        activeRevision: snapshot.activeRevision,
        state: snapshot.state,
      });
    },
    readSnapshot(runId, input = {}) {
      return forRun(runId).loadSnapshot(input);
    },
  });
}

export { createAppendOnlyEventJournal, GENESIS_EVENT_DIGEST, RunStateError } from "./event-journal.mjs";
export { assertPlainJson, canonicalJson, jsonClone, sha256 } from "./codec.mjs";
