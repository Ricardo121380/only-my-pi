import { setTimeout as delay } from "node:timers/promises";
import { acquireConfigLock } from "../config-runtime/index.mjs";

// Independent CLI/Host processes briefly share these ledgers. Wait only for
// acquisition; never repeat a callback, publication, OAuth request or tool call.
export async function withMcpMetadataLock(root, options, update) {
  let lock;
  for (let attempt = 0; !lock; attempt++) {
    try { lock = await acquireConfigLock(root, options); }
    catch (error) {
      if (!["LOCK_HELD", "LOCK_RECLAIMING"].includes(error.code) || attempt >= 99) throw error;
      await delay(20);
    }
  }
  try { return await update(lock); }
  finally { await lock.release(); }
}
