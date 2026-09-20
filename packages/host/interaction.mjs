// A process-local capability. It is never constructed from HTTP/RPC fields.
// Only the trusted SDK bootstrap binds extension contexts to this capability.
export function createHostInteraction() {
  let contexts = new WeakSet();
  return Object.freeze({
    bind(context) { if (!context || context.mode !== "rpc" || context.hasUI !== true) throw new TypeError("interactive RPC context required"); contexts.add(context); },
    allows(context) { return Boolean(context && contexts.has(context) && context.mode === "rpc" && context.hasUI === true); },
    invalidate() { contexts = new WeakSet(); },
  });
}
