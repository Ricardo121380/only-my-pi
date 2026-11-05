import { BACKEND_CAPABILITY_KEYS, createBackendCapabilityV2 } from "./domain/index.mjs";

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

// Agent lifecycle only: the injected pi-subagents backend owns physical children.
// Workflow scheduling remains in the compatibility aggregate.
export function createAgentFacade({ backend = null } = {}) {
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

  return Object.freeze({
    apiVersion: ONLY_MY_PI_SUBAGENTS_API_VERSION,
    owner: "@only-my-pi/subagents",
    physicalRuntimeOwner: "pi-subagents",
    agent,
  });
}
