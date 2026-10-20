import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, ensureConfigDirectory, readJsonObject, withConfigLock } from "../config-runtime/index.mjs";
import { groupAlive, processIdentity } from "./ownership.mjs";
import { hostError } from "./contracts.mjs";

// A short disk transaction serializes admission. The durable reservations live
// for the actual operation, independently of the Host or its in-memory tasks.
export async function reserveAccount(configRoot, accountId, mode) {
  if (!/^(?:cli-readonly|[0-9a-f-]{36})$/.test(accountId ?? "")) throw hostError("ACCOUNT_NOT_FOUND", 404);
  const directory = await ensureConfigDirectory(configRoot, "only-my-pi/host/account-activity");
  const file = path.join(directory, `${accountId}.json`);
  const owner = { pid: process.pid, identity: await processIdentity() };
  if (!owner.identity) throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
  const token = randomUUID();
  async function transact(operation) {
    // Contention on this tiny metadata transaction is distinct from an active
    // use/login. Never wait for an active reservation or steal one on a timer.
    for (let attempt = 0; ; attempt++) {
      try {
        return await withConfigLock(configRoot, { lockDirectory: `${file}.lock`, staleAfterMs: 1 }, async () => {
          const state = await readJsonObject(configRoot, file, { allowMissing: true }) ?? { version: 1, reservations: [] };
          if (state.version !== 1 || !Array.isArray(state.reservations)) throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
          const retained = [];
          for (const entry of state.reservations) {
            if (!entry || !["use", "change"].includes(entry.mode) || typeof entry.token !== "string" || !Array.isArray(entry.processes) || !entry.processes.length)
              throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
            let active = false;
            for (const participant of entry.processes) {
              if (!Number.isSafeInteger(participant.pid) || participant.pid < 1 || typeof participant.identity !== "string") throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
              const identity = await processIdentity(participant.pid);
              if (identity === participant.identity || participant.group && groupAlive(participant.pid)) active = true;
              else if (identity !== null) throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
            }
            if (active) retained.push(entry);
          }
          state.reservations = retained;
          const result = await operation(state);
          await atomicWriteJson(configRoot, file, state);
          return result;
        });
      } catch (error) {
        if (!["LOCK_HELD", "LOCK_RECLAIMING"].includes(error.code)) throw error;
        if (attempt >= 30) throw hostError("ACCOUNT_BUSY", 409);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
  }
  await transact(state => {
    if (state.reservations.some(entry => mode === "change" || entry.mode === "change")) throw hostError("ACCOUNT_BUSY", 409);
    state.reservations.push({ token, mode, processes: [owner] });
  });
  let released = false;
  const release = async () => {
    if (released) return;
    await transact(async state => {
      const entry = state.reservations.find(item => item.token === token);
      for (const participant of entry?.processes.slice(1) ?? []) {
        if (await processIdentity(participant.pid) === participant.identity || participant.group && groupAlive(participant.pid)) throw hostError("ACCOUNT_BUSY", 409);
      }
      state.reservations = state.reservations.filter(item => item.token !== token);
    });
    released = true;
  };
  // Register a child before allowing it to enter Pi. A dead parent cannot
  // release a still-live child or process group during crash reconciliation.
  release.addProcess = async (pid, { group = false } = {}) => {
    const identity = await processIdentity(pid);
    if (!identity || released) throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
    await transact(state => {
      const entry = state.reservations.find(item => item.token === token);
      if (!entry) throw hostError("ACCOUNT_RECONCILIATION_REQUIRED", 409);
      entry.processes.push({ pid, identity, group });
    });
  };
  return release;
}
