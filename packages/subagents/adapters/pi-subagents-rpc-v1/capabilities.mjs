import { createBackendCapabilityV2 } from "../../domain/index.mjs";
import {
  PI_SUBAGENTS_RPC_V1_BACKEND_ID,
  PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
  PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION,
  resolvePiSubagentsRpcV1Dialect,
} from "./wire.mjs";

const COMPILER_EVIDENCE = "only-my-pi schema-validated single-agent workflow compiler";

function entry(state, reasonCode, evidence, constraints = {}) {
  return { state, reasonCode, evidence, constraints };
}

export function createPiSubagentsRpcV1CapabilityMatrix({
  observedAt = 0,
  terminalTransport = true,
  backendVersion = PI_SUBAGENTS_RPC_V1_BACKEND_VERSION,
} = {}) {
  const dialect = resolvePiSubagentsRpcV1Dialect(backendVersion);
  const wireEvidence = `pi-subagents@${backendVersion} audited public extension RPC v1`;
  const terminalState = terminalTransport ? "SUPPORTED" : "UNAVAILABLE";
  const terminalReason = terminalTransport ? "correlated-terminal-events" : "transport-cannot-observe-events";
  const foregroundState = terminalTransport ? "DEGRADED" : "UNAVAILABLE";
  const foregroundReason = terminalTransport ? "async-spawn-then-wait" : "terminal-wait-unavailable";
  const backgroundState = terminalTransport ? "SUPPORTED" : "UNAVAILABLE";
  const backgroundReason = terminalTransport ? "native-async-spawn" : "terminal-observation-unavailable";
  return createBackendCapabilityV2({
    backendId: PI_SUBAGENTS_RPC_V1_BACKEND_ID,
    backendVersion,
    protocol: { name: "pi-subagents-extension-rpc", version: PI_SUBAGENTS_RPC_V1_PROTOCOL_VERSION },
    observedAt,
    capabilities: {
      foreground: entry(foregroundState, foregroundReason, [wireEvidence], {
        native: false,
        implementation: "detached spawn followed by correlated terminal wait",
      }),
      background: entry(backgroundState, backgroundReason, [wireEvidence], {
        async: true,
        terminalObservationRequired: true,
      }),
      continuableResume: entry("SUPPORTED", "public-resume-rpc", [wireEvidence], {
        identity: "stable local handle with explicit backend rebind",
      }),
      status: entry("DEGRADED", "text-oriented-status", [wireEvidence], {
        structuredStateNotGuaranteed: true,
      }),
      steer: entry("SUPPORTED", "public-steer-rpc", [wireEvidence]),
      interrupt: entry("SUPPORTED", "public-interrupt-rpc", [wireEvidence]),
      stop: entry("SUPPORTED", "public-stop-rpc", [wireEvidence], {
        terminalProofRequired: true,
      }),
      resume: entry("SUPPORTED", "public-resume-rpc", [wireEvidence]),
      dispose: entry("SUPPORTED", "adapter-local-dispose", ["only-my-pi adapter lifecycle"], {
        stopsBackendRun: false,
      }),
      terminalEvents: entry(terminalState, terminalReason, [wireEvidence], {
        asyncComplete: dialect.events.asyncComplete,
        ...(dialect.events.childStatus ? { childStatus: dialect.events.childStatus } : {}),
      }),
      processTerminalProof: entry(terminalState, terminalReason, [wireEvidence], {
        lifecycleArtifactVersion: 3,
        observedRequiredForAuthoritativeTerminal: true,
      }),
      worktree: entry("DEGRADED", "compiler-field-not-negotiated", [wireEvidence, COMPILER_EVIDENCE], {
        requireExplicitAdmission: true,
      }),
      perItemResult: entry("DEGRADED", "backend-result-shape", [wireEvidence], {
        normalizedFromCompletion: true,
      }),
      usageMeter: entry("DEGRADED", "completion-usage-best-effort", [wireEvidence], {
        availabilityNotNegotiated: true,
      }),
      rateLimitSignal: entry("UNAVAILABLE", "no-public-rpc-capability", [wireEvidence]),
      dynamicConcurrency: entry("UNAVAILABLE", "no-public-rpc-capability", [wireEvidence]),
      modelOverlay: entry("DEGRADED", "workflow-invocation-default", [wireEvidence, COMPILER_EVIDENCE], {
        requireExplicitAdmission: true,
      }),
      toolOverlay: entry("UNAVAILABLE", "no-public-workflow-field", [wireEvidence]),
      structuredOutput: entry("SUPPORTED", "single-invocation-output-schema", [wireEvidence, COMPILER_EVIDENCE], {
        schemaMustBeInline: true,
      }),
    },
  });
}
