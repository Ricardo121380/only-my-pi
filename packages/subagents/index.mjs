import { createRunCoordinator } from "./workflow/run-coordinator/index.mjs";
import { createAgentFacade, ONLY_MY_PI_SUBAGENTS_API_VERSION } from "./agent-facade.mjs";
export { createAgentFacade, ONLY_MY_PI_SUBAGENTS_API_VERSION } from "./agent-facade.mjs";

/**
 * The single first-party orchestration facade.
 *
 * It owns no child process and accepts no executable workflow source. A live
 * backend, durable journal, budget ledger, and logical node executor are all
 * injected. This keeps pi-subagents as the sole physical child runtime while
 * the RunCoordinator remains the sole first-party logical scheduler.
 */
export function createSubagentsFacade({
  backend = null,
  eventJournal = null,
  budgetLedger = null,
  planStore = null,
  artifactStore = null,
  nodeExecutor = null,
  approvalVerifier = null,
  approvalEvidenceProvider = null,
  coordinatorOptions = {},
} = {}) {
  const { agent } = createAgentFacade({ backend });

  function workflow(overrides = {}) {
    const journal = overrides.eventJournal ?? eventJournal;
    const ledger = overrides.budgetLedger ?? budgetLedger;
    const durablePlans = overrides.planStore ?? planStore;
    const executor = overrides.nodeExecutor ?? nodeExecutor;
    if (!journal || !ledger || !executor) {
      const error = new Error("workflow execution requires eventJournal, budgetLedger, and nodeExecutor");
      error.name = "SubagentsUnavailableError";
      error.code = "WORKFLOW_RUNTIME_UNAVAILABLE";
      throw error;
    }
    return createRunCoordinator({
      ...coordinatorOptions,
      ...overrides,
      eventJournal: journal,
      budgetLedger: ledger,
      planStore: durablePlans,
      artifactStore: overrides.artifactStore ?? artifactStore,
      nodeExecutor: executor,
      approvalVerifier: overrides.approvalVerifier ?? approvalVerifier ?? coordinatorOptions.approvalVerifier,
      approvalEvidenceProvider: overrides.approvalEvidenceProvider
        ?? approvalEvidenceProvider
        ?? coordinatorOptions.approvalEvidenceProvider,
    });
  }

  return Object.freeze({
    apiVersion: ONLY_MY_PI_SUBAGENTS_API_VERSION,
    owner: "@only-my-pi/subagents",
    physicalRuntimeOwner: "pi-subagents",
    agent,
    workflow,
  });
}

export * from "./domain/index.mjs";
export * from "./batch-swarm/index.mjs";
export * from "./batch-swarm/registry.mjs";
export * from "./batch-swarm/pi-item-executor.mjs";
export * from "./batch-swarm/runtime.mjs";
export * from "./swarm-goal/index.mjs";
export * from "./swarm-goal/registry.mjs";
export * from "./ultra-run/index.mjs";
export * from "./ultra-run/registry.mjs";
export * from "./adapters/pi-subagents-rpc-v1/index.mjs";
export * from "./adapters/pi-subagents-delegation-v1/index.mjs";
export * from "./state/index.mjs";
export * from "./topology.mjs";
export * from "./policy/budget-ledger.mjs";
export * from "./policy/approval-receipt.mjs";
export * from "./policy/writer-handoff.mjs";
export * from "./release/compatibility.mjs";
export * from "./release/live-evidence-authorization.mjs";
export * from "./release/live-evidence-capture.mjs";
export * from "./release/live-evidence-pi-runner.mjs";
export * from "./release/protected-evidence.mjs";
export * from "./workflow/plan-compiler/index.mjs";
export * from "./workflow/migration/index.mjs";
export * from "./workflow/run-coordinator/index.mjs";
