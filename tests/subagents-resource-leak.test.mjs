import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import test from "node:test";

import { createPiSubagentsRpcV1Backend } from "../packages/subagents/adapters/pi-subagents-rpc-v1/index.mjs";
import { createBatchSwarmNodeExecutor } from "../packages/subagents/batch-swarm/index.mjs";
import { createPiSubagentsRpcV1CapabilityMatrix } from "../packages/subagents/adapters/pi-subagents-rpc-v1/capabilities.mjs";

test("adapter create/dispose soak releases every terminal-event listener and is idempotent", async () => {
  class Transport extends EventEmitter {
    async request() {
      throw new Error("resource-leak soak must not dispatch RPC");
    }
  }
  const transport = new Transport();
  transport.setMaxListeners(0);
  for (let index = 0; index < 100; index += 1) {
    const backend = createPiSubagentsRpcV1Backend({ transport, timeoutMs: 10, terminalTimeoutMs: 10 });
    assert.equal(transport.listenerCount("subagent:async-complete"), 1);
    assert.equal(transport.listenerCount("subagent:process-terminal"), 1);
    const first = await backend.dispose();
    const second = await backend.dispose();
    assert.equal(first.status, "DISPOSED");
    assert.equal(second.status, "DISPOSED");
    assert.equal(transport.listenerCount("subagent:async-complete"), 0);
    assert.equal(transport.listenerCount("subagent:process-terminal"), 0);
  }
  assert.equal(transport.eventNames().length, 0);
});

test("empty BatchSwarm soak clears every deadline timer without dispatching a child", async () => {
  const definition = JSON.parse(fs.readFileSync("swarm/batches/review-items.json", "utf8"));
  const agentSpec = JSON.parse(fs.readFileSync("swarm/agent-specs/omp-reviewer-resolved.json", "utf8"));
  const promptTemplate = fs.readFileSync("swarm/templates/review-item.txt", "utf8");
  const active = new Set();
  let nextHandle = 0;
  const scheduler = {
    setTimeout(callback, delay) {
      const handle = { id: ++nextHandle, callback, delay };
      active.add(handle);
      return handle;
    },
    clearTimeout(handle) {
      active.delete(handle);
    },
  };
  const executor = createBatchSwarmNodeExecutor({
    resolveBatch: async () => definition,
    resolveAgentSpec: async () => agentSpec,
    resolvePromptTemplate: async () => promptTemplate,
    resolveItems: async () => [],
    executeItem: async () => { throw new Error("empty batch must not dispatch an item"); },
    capabilityMatrix: createPiSubagentsRpcV1CapabilityMatrix({ terminalTransport: true }),
    scheduler,
    clock: () => 1000,
  });
  const node = {
    kind: "batch-swarm",
    id: "leak-soak",
    batchRef: definition.id,
    budget: { timeoutMs: definition.retryPolicy.deadlineMs, maxOutputBytes: 4096 },
  };
  for (let index = 0; index < 100; index += 1) {
    const result = await executor.runBatch(node, { runId: `leak-${index}`, attemptId: `attempt-${index}`, input: {} });
    assert.equal(result.outcome, "completed");
    assert.equal(result.result.total, 0);
    assert.equal(active.size, 0);
  }
});
