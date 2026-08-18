import {
  BACKEND_CAPABILITY_KEYS,
  createBackendCapabilityV2,
  immutable,
} from "./domain/index.mjs";
import { createRunCoordinator } from "./workflow/run-coordinator/index.mjs";

export const ONLY_MY_PI_SUBAGENTS_API_VERSION = 2;

function assertMethod(value, name) {
  if (typeof value?.[name] !== "function") {
    throw new TypeError(`subagents backend must implement ${name}()`);
  }
}

function createUnavailableCapabilities() {
  return createBackendCapabilityV2({
    backendId: "unconfigured",
    backendVersion: "0.0.0",
    protocol: { name: "none", version: 1 },
    observedAt: 0,
    capabilities: Object.fromEntries(BACKEND_CAPABILITY_KEYS.map((key) => [key, {
      state: "UNAVAILABLE",
      reasonCode: "no-backend-injected",
      evidence: ["facade-created-without-backend"],
      constraints: {},
    }])),
  });
}

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
  nodeExecutor = null,
  approvalVerifier = null,
  approvalEvidenceProvider = null,
  coordinatorOptions = {},
} = {}) {
  if (backend !== null) {
    for (const method of ["ensureReady", "launch", "status", "steer", "interrupt", "stop", "resume", "dispose"]) {
      assertMethod(backend, method);
    }
  }

  const requireBackend = () => {
    if (backend === null) {
      const error = new Error("a live subagents backend was not injected");
      error.name = "SubagentsUnavailableError";
      error.code = "SUBAGENTS_BACKEND_UNAVAILABLE";
      throw error;
    }
    return backend;
  };

  const agent = Object.freeze({
    capabilities() {
      return backend?.capabilityMatrix ?? createUnavailableCapabilities();
    },
    negotiate(options) {
      return requireBackend().ensureReady(options);
    },
    launch(input) {
      return requireBackend().launch(input);
    },
    status(handle, options) {
      return requireBackend().status(handle, options);
    },
    steer(handle, message, options) {
      return requireBackend().steer(handle, message, options);
    },
    interrupt(handle, options) {
      return requireBackend().interrupt(handle, options);
    },
    stop(handle, options) {
      return requireBackend().stop(handle, options);
    },
    resume(handle, options) {
      return requireBackend().resume(handle, options);
    },
    dispose() {
      return backend === null
        ? Promise.resolve(Object.freeze({ status: "DISPOSED", stoppedBackendRuns: false }))
        : backend.dispose();
    },
  });

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
export * from "./adapters/pi-subagents-rpc-v1/index.mjs";
export * from "./state/index.mjs";
export * from "./policy/budget-ledger.mjs";
export * from "./policy/approval-receipt.mjs";
export * from "./workflow/plan-compiler/index.mjs";
export * from "./workflow/migration/index.mjs";
export * from "./workflow/run-coordinator/index.mjs";
