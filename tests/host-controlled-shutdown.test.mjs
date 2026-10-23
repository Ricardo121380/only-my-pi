import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createMcpHost, providerReply, until } from "./fixtures/mcp-host.mjs";

test("controlled Host receives shutdown preparation before ending real Pi stdin", { timeout: 15000 }, async (t) => {
  const f = await createMcpHost({ respond: ({ res }) => providerReply(res) });
  t.after(() => f.close());
  const sdk = await fs.realpath(f.sdk), root = await fs.realpath(f.root);
  assert.ok(sdk.startsWith(root + path.sep), "fault injection must stay in the copied fixture SDK");
  const events = path.join(root, "shutdown-order.jsonl");
  await fs.rename(sdk, path.join(path.dirname(sdk), "index-original.js"));
  await fs.writeFile(sdk, `export * from "./index-original.js";
    import { runRpcMode as real } from "./index-original.js";
    import { appendFileSync } from "node:fs";
    export async function runRpcMode(runtime) {
      const emit = process.emit;
      const record = event => appendFileSync(${JSON.stringify(events)}, JSON.stringify(event) + "\\n");
      process.emit = function(event, message, ...args) {
        if (event === "message" && message?.type === "prepare_shutdown") {
          record("prepare_queued");
          // IPC and stdin are independent channels. Hold actual IPC delivery,
          // without fabricating the controller's receipt or its cleanup result.
          setTimeout(() => { record("prepare_delivered"); emit.call(this, event, message, ...args); }, 50).unref();
          return true;
        }
        return emit.call(this, event, message, ...args);
      };
      process.stdin.once("end", () => record("stdin_eof"));
      return real(runtime);
    }
  `);
  const started = await f.start({ mode: "controlled" });
  const completed = await until(() => f.task(started.taskId), task => ["succeeded", "failed", "cancelled"].includes(task.status), "controlled shutdown");
  const order = (await fs.readFile(events, "utf8")).trim().split("\n").map(JSON.parse);
  t.diagnostic(JSON.stringify({ order, status: completed.status, error: completed.error, received: f.requests.length }));
  assert.equal(completed.status, "succeeded");
  assert.equal(f.requests.length, 1, "shutdown must not add or replay a model request");
  assert.ok(order.indexOf("prepare_delivered") >= 0 && order.indexOf("stdin_eof") > order.indexOf("prepare_delivered"));
  assert.equal(f.host.tasks.workers.size, 0);
  assert.equal(f.host.tasks.leases.size, 0);
  assert.equal(f.host.tasks.projectLeases.size, 0);
  assert.equal(f.host.tasks.accountReleases.size, 0);
});
