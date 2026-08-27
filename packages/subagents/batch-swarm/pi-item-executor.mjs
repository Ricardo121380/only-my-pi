import {
  activeBackendBinding,
  createAgentRunHandle,
  digestValue,
  SubagentsError,
} from "../domain/index.mjs";

const ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;

function canonicalId(prefix, value) {
  const candidate = `${prefix}:${value}`;
  return ID.test(candidate) ? candidate : `${prefix}:${digestValue(candidate).slice(7, 39)}`;
}

function assertBackend(backend) {
  for (const method of ["launch", "awaitTerminal", "interrupt"]) {
    if (typeof backend?.[method] !== "function") throw new TypeError(`Pi BatchSwarm item backend must implement ${method}()`);
  }
  return backend;
}

async function awaitWithCancellation(backend, handle, bindingId, signal) {
  const terminalPromise = Promise.resolve(backend.awaitTerminal(handle, { bindingId, intent: "run" }));
  terminalPromise.catch(() => {});
  if (!signal) return terminalPromise;
  const interrupt = async () => {
    try {
      const result = await backend.interrupt(handle, { awaitTerminal: true });
      if (!result?.terminal) throw new Error("interrupt returned no terminal receipt");
      return result.terminal;
    } catch (cause) {
      throw new SubagentsError("BatchSwarm item cancellation has no correlated terminal proof", {
        code: "BATCH_ITEM_TERMINAL_UNPROVEN",
        category: "cancelled",
        retryable: false,
        cause,
      });
    }
  };
  if (signal.aborted) return interrupt();
  let onAbort;
  const cancellation = new Promise((resolve, reject) => {
    onAbort = () => { void interrupt().then(resolve, reject); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([terminalPromise, cancellation]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Maps one logical homogeneous BatchSwarm slot to the sole physical child
 * runtime. It never accepts workflow source: the only executable request is
 * compiled by PiSubagentsRpcV1Backend from the correlated domain objects.
 */
export class PiSubagentsBatchItemExecutor {
  constructor({ backend } = {}) {
    this.backend = assertBackend(backend);
    this.executeItem = this.executeItem.bind(this);
  }

  get capabilityMatrix() {
    return this.backend.capabilityMatrix;
  }

  async executeItem(input = {}) {
    const { assignment, agentSpec } = input;
    if (assignment?.kind !== "task-assignment" || agentSpec?.kind !== "resolved-agent-spec") {
      throw new TypeError("BatchSwarm item execution requires a TaskAssignment and ResolvedAgentSpec");
    }
    const itemNodeId = canonicalId("batch-item", `${input.nodeId}:${input.itemId}`);
    const itemAttemptId = canonicalId("batch-attempt", `${input.nodeId}:${input.itemId}:${input.itemAttempt}`);
    const handle = createAgentRunHandle({
      runId: input.runId,
      nodeId: itemNodeId,
      attemptId: itemAttemptId,
      assignment,
      agentSpec,
    });
    const launched = await this.backend.launch({
      handle,
      assignment,
      agentSpec,
      mode: "background",
      signal: input.signal,
    });
    const boundHandle = launched?.handle;
    if (boundHandle?.kind !== "agent-run-handle" || boundHandle.handleId !== handle.handleId) {
      throw new SubagentsError("pi-subagents did not return a correlated AgentRunHandle", {
        code: "BATCH_ITEM_HANDLE_UNAVAILABLE",
        category: "correlation",
      });
    }
    const binding = launched.binding ?? activeBackendBinding(boundHandle);
    const terminal = await awaitWithCancellation(this.backend, boundHandle, binding.bindingId, input.signal);
    return Object.freeze({ terminal, handle: boundHandle });
  }
}

export function createPiSubagentsBatchItemExecutor(options = {}) {
  return new PiSubagentsBatchItemExecutor(options);
}
