import { createBackendCapabilityV2 } from "../../domain/index.mjs";
import {
  PI_SUBAGENTS_RPC_V1_BACKEND_ID,
  PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
  PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
} from "./wire.mjs";

const WIRE_EVIDENCE = "pi-subagents@0.45.2 public extension RPC v1";
const COMPILER_EVIDENCE = "only-my-pi schema-validated single-agent workflow compiler";

function entry(state, reasonCode, evidence, constraints = {}) {
  return { state, reasonCode, evidence, constraints };
}

export function createPiSubagentsRpcV1CapabilityMatrix({
  observedAt = 0,
  terminalTransport = true,
} = {}) {
  const terminalState = terminalTransport ? "SUPPORTED" : "UNAVAILABLE";
  const terminalReason = terminalTransport ? "correlated-terminal-events" : "transport-cannot-observe-events";
  const foregroundState = terminalTransport ? "DEGRADED" : "UNAVAILABLE";
  const foregroundReason = terminalTransport ? "async-spawn-then-wait" : "terminal-wait-unavailable";
  const backgroundState = terminalTransport ? "SUPPORTED" : "UNAVAILABLE";
  const backgroundReason = terminalTransport ? "native-async-spawn" : "terminal-observation-unavailable";
  return createBackendCapabilityV2({
    backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
    backendVersion: PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
    protocol: { name: "pi-subagents-extension-rpc", version: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION },
    observedAt,
    capabilities: {
      foreground: entry(foregroundState, foregroundReason, [WIRE_EVIDENCE], {
        native: false,
        implementation: "detached spawn followed by correlated terminal wait",
      }),
      background: entry(backgroundState, backgroundReason, [WIRE_EVIDENCE], {
        async: true,
        terminalObservationRequired: true,
      }),
      continuableResume: entry("SUPPORTED", "public-resume-rpc", [WIRE_EVIDENCE], {
        identity: "stable local handle with explicit backend rebind",
      }),
      status: entry("DEGRADED", "text-oriented-status", [WIRE_EVIDENCE], {
        structuredStateNotGuaranteed: true,
      }),
      steer: entry("SUPPORTED", "public-steer-rpc", [WIRE_EVIDENCE]),
      interrupt: entry("SUPPORTED", "public-interrupt-rpc", [WIRE_EVIDENCE]),
      stop: entry("SUPPORTED", "public-stop-rpc", [WIRE_EVIDENCE], {
        terminalProofRequired: true,
      }),
      resume: entry("SUPPORTED", "public-resume-rpc", [WIRE_EVIDENCE]),
      dispose: entry("SUPPORTED", "adapter-local-dispose", ["only-my-pi adapter lifecycle"], {
        stopsBackendRun: false,
      }),
      terminalEvents: entry(terminalState, terminalReason, [WIRE_EVIDENCE], {
        asyncComplete: "subagent:async-complete",
      }),
      processTerminalProof: entry(terminalState, terminalReason, [WIRE_EVIDENCE], {
        lifecycleArtifactVersion: 3,
        observedRequiredForAuthoritativeTerminal: true,
      }),
      worktree: entry("DEGRADED", "compiler-field-not-negotiated", [WIRE_EVIDENCE, COMPILER_EVIDENCE], {
        requireExplicitAdmission: true,
      }),
      perItemResult: entry("DEGRADED", "backend-result-shape", [WIRE_EVIDENCE], {
        normalizedFromCompletion: true,
      }),
      usageMeter: entry("DEGRADED", "completion-usage-best-effort", [WIRE_EVIDENCE], {
        availabilityNotNegotiated: true,
      }),
      rateLimitSignal: entry("UNAVAILABLE", "no-public-rpc-capability", [WIRE_EVIDENCE]),
      dynamicConcurrency: entry("UNAVAILABLE", "no-public-rpc-capability", [WIRE_EVIDENCE]),
      modelOverlay: entry("DEGRADED", "workflow-invocation-default", [WIRE_EVIDENCE, COMPILER_EVIDENCE], {
        requireExplicitAdmission: true,
      }),
      toolOverlay: entry("UNAVAILABLE", "no-public-workflow-field", [WIRE_EVIDENCE]),
      structuredOutput: entry("SUPPORTED", "single-invocation-output-schema", [WIRE_EVIDENCE, COMPILER_EVIDENCE], {
        schemaMustBeInline: true,
      }),
    },
  });
}
