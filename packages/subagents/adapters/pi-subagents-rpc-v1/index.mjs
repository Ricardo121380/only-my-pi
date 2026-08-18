export * from "./backend.mjs";
export * from "./capabilities.mjs";
export * from "./compiler.mjs";
export * from "./legacy-compatibility.mjs";
export * from "./normalization.mjs";
export * from "./terminal-store.mjs";
export * from "./wire.mjs";

// Constants are safe import aliases for incremental migration. The legacy
// marker-only adapter class/factory are deliberately not re-exported; use the
// domain-correlated PiSubagentsAdapterCompatibility above.
export {
  PI_SUBAGENTS_EVENTS,
  PI_SUBAGENTS_METHODS,
  PI_SUBAGENTS_REQUIRED_CAPABILITIES,
} from "../../../pi-subagents-adapter/index.mjs";
