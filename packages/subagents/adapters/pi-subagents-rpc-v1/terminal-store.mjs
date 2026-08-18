import { digestValue, SubagentsError } from "../../domain/index.mjs";
import {
  piSubagentsEventRunId,
  unwrapPiSubagentsEvent,
} from "./normalization.mjs";

function terminalProof(value) {
  return value?.version === 1 && ["observed", "unknown"].includes(value?.state);
}

function abortError() {
  return new SubagentsError("terminal wait was aborted", {
    code: "ABORT_ERR",
    category: "cancelled",
  });
}

export class PiSubagentsTerminalEventStore {
  constructor({ transport, events, maxEntries = 512 } = {}) {
    this.transport = transport;
    this.events = events;
    this.maxEntries = maxEntries;
    this.completions = new Map();
    this.proofs = new Map();
    this.conflicts = new Map();
    this.waiters = new Map();
    this.unsubscribers = [];
    this.disposed = false;
    this.observable = this.#subscribe(events.asyncComplete, (value) => this.captureCompletion(value))
      | this.#subscribe(events.processTerminal, (value) => this.captureProcessTerminal(value));
  }

  #subscribe(eventName, handler) {
    if (typeof this.transport.subscribe === "function") {
      const unsubscribe = this.transport.subscribe(eventName, handler);
      if (typeof unsubscribe === "function") this.unsubscribers.push(unsubscribe);
      return 1;
    }
    if (typeof this.transport.on === "function") {
      this.transport.on(eventName, handler);
      if (typeof this.transport.off === "function") {
        this.unsubscribers.push(() => this.transport.off(eventName, handler));
      } else if (typeof this.transport.removeListener === "function") {
        this.unsubscribers.push(() => this.transport.removeListener(eventName, handler));
      }
      return 1;
    }
    return 0;
  }

  #boundedSet(map, key, value) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > this.maxEntries) map.delete(map.keys().next().value);
  }

  #capture(map, runId, value, kind) {
    const existing = map.get(runId);
    if (existing !== undefined && digestValue(existing) !== digestValue(value)) {
      this.#boundedSet(this.conflicts, runId, new SubagentsError(`conflicting ${kind} event for backend run id`, {
        code: "PI_SUBAGENTS_TERMINAL_EVENT_CONFLICT",
        category: "correlation",
        details: { runId, kind },
      }));
      this.#notify(runId);
      return false;
    }
    this.#boundedSet(map, runId, value);
    this.#notify(runId);
    return true;
  }

  #notify(runId) {
    const waiters = this.waiters.get(runId);
    if (!waiters) return;
    for (const waiter of [...waiters]) waiter.check();
  }

  captureCompletion(value) {
    const completion = unwrapPiSubagentsEvent(value);
    const runId = piSubagentsEventRunId(completion);
    if (runId === null) return false;
    return this.#capture(this.completions, runId, completion, "async-complete");
  }

  captureProcessTerminal(value) {
    const proof = unwrapPiSubagentsEvent(value);
    const runId = piSubagentsEventRunId(proof);
    if (runId === null || !terminalProof(proof)) return false;
    return this.#capture(this.proofs, runId, proof, "process-terminal");
  }

  snapshot(runId) {
    return {
      completion: this.completions.get(runId) ?? null,
      processTerminal: this.proofs.get(runId) ?? null,
    };
  }

  snapshotAny(runIds) {
    return {
      completion: runIds.map((runId) => this.completions.get(runId)).find((value) => value !== undefined) ?? null,
      processTerminal: runIds.map((runId) => this.proofs.get(runId)).find((value) => value !== undefined) ?? null,
    };
  }

  conflictAny(runIds) {
    return runIds.map((runId) => this.conflicts.get(runId)).find((value) => value !== undefined) ?? null;
  }

  clear(runIds) {
    for (const runId of new Set(runIds)) {
      this.completions.delete(runId);
      this.proofs.delete(runId);
      this.conflicts.delete(runId);
    }
  }

  async wait(runIdOrIds, { signal, timeoutMs = 30_000 } = {}) {
    if (this.disposed) {
      throw new SubagentsError("terminal event store is disposed", {
        code: "ADAPTER_DISPOSED",
        category: "unavailable",
      });
    }
    if (signal?.aborted) throw abortError();
    const runIds = [...new Set(Array.isArray(runIdOrIds) ? runIdOrIds : [runIdOrIds])];
    if (runIds.length === 0 || runIds.some((runId) => typeof runId !== "string" || runId.length === 0)) {
      throw new TypeError("terminal wait requires at least one backend run id");
    }
    const existingConflict = this.conflictAny(runIds);
    if (existingConflict) throw existingConflict;
    const current = this.snapshotAny(runIds);
    if (current.processTerminal?.state === "unknown"
      || (current.processTerminal?.state === "observed" && current.completion !== null)) return current;
    return new Promise((resolve, reject) => {
      let timer;
      const waiter = {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
        check: () => {
          const conflict = this.conflictAny(runIds);
          if (conflict) {
            waiter.reject(conflict);
            return;
          }
          const snapshot = this.snapshotAny(runIds);
          if (snapshot.processTerminal?.state === "unknown"
            || (snapshot.processTerminal?.state === "observed" && snapshot.completion !== null)) {
            waiter.resolve(snapshot);
          }
        },
      };
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        for (const runId of runIds) {
          const entries = this.waiters.get(runId);
          entries?.delete(waiter);
          if (entries?.size === 0) this.waiters.delete(runId);
        }
      };
      const onAbort = () => waiter.reject(abortError());
      for (const runId of runIds) {
        const entries = this.waiters.get(runId) ?? new Set();
        entries.add(waiter);
        this.waiters.set(runId, entries);
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => waiter.resolve(this.snapshotAny(runIds)), timeoutMs);
      waiter.check();
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    const error = new SubagentsError("terminal event store was disposed", {
      code: "ADAPTER_DISPOSED",
      category: "unavailable",
    });
    for (const waiters of this.waiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.waiters.clear();
    this.completions.clear();
    this.proofs.clear();
    this.conflicts.clear();
  }
}
