export const DIRECT_AGENT_VERSION = "0.3.0-preview.1";
export const DIRECT_AGENT_TAG = `v${DIRECT_AGENT_VERSION}`;
export const LEGACY_HARNESS_VERSION = "0.2.0-preview.1";

export const DIRECT_AGENT_CAPABILITY_CEILING = Object.freeze({
  mode: "GUARDED_PROJECT_CODING",
  maxDepth: 1,
  writer: true,
  bash: true,
  mcp: false,
});

export const LEGACY_HARNESS_CAPABILITY_CEILING = Object.freeze({
  mode: "READ_ONLY",
  maxDepth: 1,
  writer: false,
  bash: false,
  mcp: false,
});

export const DIRECT_AGENT_OVERLAYS = Object.freeze({
  enabled: Object.freeze(["web", "orchestration-readonly", "ui-terminal", "writer"]),
  disabled: Object.freeze(["memory", "sync", "mcp", "experimental"]),
});

export const LEGACY_HARNESS_OVERLAYS = Object.freeze({
  enabled: Object.freeze(["web", "orchestration-readonly", "ui-terminal"]),
  disabled: Object.freeze(["memory", "sync", "mcp", "experimental"]),
});

export function productBoundaryForVersion(version) {
  if (version === DIRECT_AGENT_VERSION) {
    return Object.freeze({
      version,
      currentProductContract: true,
      currentReleaseAuthority: false,
      publicationDecision: "HOLD_PUBLICATION",
      product: "DIRECT_TERMINAL_CODING_AGENT",
      capabilityCeiling: DIRECT_AGENT_CAPABILITY_CEILING,
      overlays: DIRECT_AGENT_OVERLAYS,
    });
  }
  if (version === LEGACY_HARNESS_VERSION) {
    return Object.freeze({
      version,
      currentProductContract: false,
      currentReleaseAuthority: false,
      publicationDecision: "HOLD_PUBLICATION",
      product: "INTERNAL_DISTRIBUTION_FOUNDATION",
      capabilityCeiling: LEGACY_HARNESS_CAPABILITY_CEILING,
      overlays: LEGACY_HARNESS_OVERLAYS,
    });
  }
  const error = new Error(`unsupported only-my-pi Preview identity: ${String(version)}`);
  error.code = "OMP_PREVIEW_VERSION_UNSUPPORTED";
  throw error;
}
