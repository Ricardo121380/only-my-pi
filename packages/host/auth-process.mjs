import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, ensureConfigDirectory, readJsonObject } from "../config-runtime/index.mjs";
import { processIdentity } from "./ownership.mjs";
import { hostError } from "./contracts.mjs";

// The child cannot enter Pi until its identity has been durably recorded.
// A crashed Host's successor reconciles these records before exposing account mutations.
export async function spawnAuthProcess(configRoot, executable, args, options) {
  const directory = await ensureConfigDirectory(configRoot, "only-my-pi/host/auth-processes");
  const file = path.join(directory, `${randomUUID()}.json`);
  const child = spawn(executable, args, options);
  child.on("error", () => {});
  let closed = false;
  const exited = new Promise((resolve) => child.once("close", () => { closed = true; resolve(); }));
  try {
    const identity = await processIdentity(child.pid);
    if (!identity || closed) throw hostError("ACCOUNT_AUTH_FAILED", 503);
    await atomicWriteJson(configRoot, file, { pid: child.pid, identity });
    if (closed) throw hostError("ACCOUNT_AUTH_FAILED", 503);
    // Retaining an exited marker after an I/O failure is safe: recovery verifies PID identity.
    void exited.then(() => fs.unlink(file).catch(() => {}));
    return child;
  } catch (error) { child.kill("SIGKILL"); await exited; throw error; }
}

export async function recoverAuthProcesses(configRoot) {
  const directory = await ensureConfigDirectory(configRoot, "only-my-pi/host/auth-processes");
  for (const name of await fs.readdir(directory)) {
    if (!/^[0-9a-f-]+\.json$/.test(name)) throw hostError("AUTH_PROCESS_RECONCILIATION_REQUIRED", 409);
    const file = path.join(directory, name);
    const owner = await readJsonObject(configRoot, file).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    // A child's close handler may have removed the marker after readdir.
    if (owner === null) continue;
    if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.identity !== "string") throw hostError("AUTH_PROCESS_RECONCILIATION_REQUIRED", 409);
    const identity = await processIdentity(owner.pid);
    if (identity === owner.identity) {
      try { process.kill(owner.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      for (let i = 0; i < 40 && await processIdentity(owner.pid) === owner.identity; i++) await new Promise((resolve) => setTimeout(resolve, 25));
      if (await processIdentity(owner.pid) === owner.identity) throw hostError("AUTH_PROCESS_RECONCILIATION_REQUIRED", 409);
    } else if (identity !== null) {
      // Do not kill a reused PID or assume an unknown owner's state.
      throw hostError("AUTH_PROCESS_RECONCILIATION_REQUIRED", 409);
    }
    await fs.unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function awaitAuthStart() {
  if (!process.send) throw new Error("AUTH_IPC_REQUIRED");
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { process.off("message", receive); reject(new Error("AUTH_START_TIMEOUT")); }, 20000);
    function receive(message) { if (message?.type === "begin") { clearTimeout(timer); process.off("message", receive); resolve(); } }
    process.on("message", receive);
  });
}
