import { createBatchSwarmNodeExecutor } from "./index.mjs";
import { createPiSubagentsBatchItemExecutor } from "./pi-item-executor.mjs";
import { createBatchSwarmRegistry } from "./registry.mjs";

/**
 * Standard live composition for a Pi host. Construction itself is inert;
 * prepareBatch performs the public backend negotiation before any reservation
 * or item dispatch.
 */
export function createPiBatchSwarmRuntime({
  backend,
  registry,
  rootDir,
  fs,
  scheduler,
  clock,
  resolveItems,
  maximumItemOutputBytes,
} = {}) {
  if (typeof backend?.ensureReady !== "function") throw new TypeError("Pi BatchSwarm runtime requires a backend with ensureReady()");
  const resolvedRegistry = registry ?? createBatchSwarmRegistry({ rootDir, fs });
  for (const method of ["resolve", "resolveAgentSpec", "resolvePromptTemplate"]) {
    if (typeof resolvedRegistry?.[method] !== "function") throw new TypeError(`Pi BatchSwarm registry must implement ${method}()`);
  }
  const itemExecutor = createPiSubagentsBatchItemExecutor({ backend });
  const nodeExecutor = createBatchSwarmNodeExecutor({
    resolveBatch: async (id) => (await resolvedRegistry.resolve(id)).definition,
    resolveAgentSpec: (id) => resolvedRegistry.resolveAgentSpec(id),
    resolvePromptTemplate: (id) => resolvedRegistry.resolvePromptTemplate(id),
    resolveItems,
    capabilityMatrix: async (context) => (await backend.ensureReady({ signal: context?.signal })).capabilityMatrix,
    executeItem: itemExecutor.executeItem,
    scheduler,
    clock,
    maximumItemOutputBytes,
  });
  return Object.freeze({
    physicalRuntimeOwner: "pi-subagents",
    registry: resolvedRegistry,
    itemExecutor,
    nodeExecutor,
  });
}
