import { SubagentsError } from "../../domain/index.mjs";
import { createPiSubagentsRpcV1Backend } from "./backend.mjs";

function requireDomainLaunch(input) {
  if (input?.handle?.kind !== "agent-run-handle"
    || input?.agentSpec?.kind !== "resolved-agent-spec"
    || input?.assignment?.kind !== "task-assignment") {
    throw new SubagentsError(
      "legacy adapter migration requires { handle, agentSpec, assignment }; compiled workflowScript alone is not accepted",
      {
        code: "LEGACY_ADAPTER_DOMAIN_INPUT_REQUIRED",
        category: "validation",
      },
    );
  }
  return input;
}

// Preserves familiar method names while moving every dispatch through the new
// domain-correlated backend. It intentionally does not wrap or re-export the
// legacy marker-only spawn implementation.
export class PiSubagentsAdapterCompatibility {
  constructor({ backend, ...backendOptions } = {}) {
    this.backend = backend ?? createPiSubagentsRpcV1Backend(backendOptions);
    if (!this.backend || typeof this.backend.launch !== "function") {
      throw new TypeError("backend must implement the PiSubagentsRpcV1Backend surface");
    }
  }

  async negotiate(options = {}) {
    return this.backend.negotiate(options);
  }

  async ensureReady(options = {}) {
    return this.backend.ensureReady(options);
  }

  async spawn(input, options = {}) {
    return this.backend.launch({ ...requireDomainLaunch(input), ...options, mode: "background" });
  }

  async execute(input, options = {}) {
    return this.backend.launch({ ...requireDomainLaunch(input), ...options, mode: "foreground" });
  }

  async status(handle, options = {}) {
    return this.backend.status(handle, options);
  }

  async steer(handle, message, options = {}) {
    return this.backend.steer(handle, message, options);
  }

  async interrupt(handle, options = {}) {
    return this.backend.interrupt(handle, options);
  }

  async stop(handle, options = {}) {
    return this.backend.stop(handle, options);
  }

  async resume(handle, options = {}) {
    return this.backend.resume(handle, options);
  }

  async dispose() {
    return this.backend.dispose();
  }
}

export function createPiSubagentsAdapterCompatibility(options = {}) {
  return new PiSubagentsAdapterCompatibility(options);
}
