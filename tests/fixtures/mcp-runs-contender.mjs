import assert from "node:assert/strict";
import os from "node:os";
import { McpRuns } from "../../packages/mcp/runs.mjs";
import { withConfigLock } from "../../packages/config-runtime/index.mjs";

const [root, role, action] = process.argv.slice(2), messages = [], waiters = [];
process.on("message", message => {
  const waiter = waiters.shift(); if (waiter) waiter(message); else messages.push(message);
});
const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve));
const runs = new McpRuns(root);
let run = role === "holder" || action === "save" ? await runs.begin({ taskId: role, projectPath: root, revision: 11 }) : null;
process.send({ type: "ready", run });
try {
  const start = await next();
  if (role === "holder") {
    await withConfigLock(root, runs.lockOptions(), async () => {
      const state = await runs.read(), own = state.runs.find(entry => entry.runId === run.runId);
      own.calls.push({ marker: "holder update" }); own.status = "stopped"; await runs.write(state);
      process.send({ type: "held", pid: process.pid });
      assert.equal((await next()).type, "release");
    });
    process.send({ type: "released" });
  } else {
    let observed = false, writes = 0;
    const options = runs.lockOptions.bind(runs), write = runs.write.bind(runs);
    runs.lockOptions = () => ({ ...options(), isOwnerAlive: async owner => {
      assert.equal(owner.pid, start.ownerPid); assert.equal(owner.hostname, os.hostname()); process.kill(owner.pid, 0);
      if (!observed) {
        observed = true; process.send({ type: "contended", ownerPid: owner.pid });
        assert.equal((await next()).type, "continue");
      }
      return true;
    } });
    runs.write = async state => { await write(state); writes++; };
    if (action === "begin") run = await runs.begin({ taskId: role, projectPath: root, revision: 11 });
    else { run.calls.push({ marker: "contender update" }); run.status = "stopped"; await runs.save(run); }
    process.send({ type: "done", run, writes, observed });
  }
} catch (error) {
  process.send({ type: "failed", code: error.code, message: error.message });
}
assert.equal((await next()).type, "stop");
process.disconnect();
