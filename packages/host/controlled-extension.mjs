import { createHostInteraction } from "./interaction.mjs";
import { projectControlState } from "./control-state.mjs";

// Private SDK factory: never loaded by ordinary CLI/RPC, never configurable by
// browser fields. Host communication uses the inherited Node IPC channel.
export function createControlledExtension({ transport = process } = {}) {
  if (typeof transport.send !== "function") throw new Error("HOST_CONTROL_CHANNEL_REQUIRED");
  const capability = createHostInteraction();
  let controller;
  let closed = false;
  let shutdownId;
  let managedRuntimeSeen = false;
  const executionProbes = [];
  return (pi) => {
    pi.events.emit("only-my-pi:host-interaction:v1", {
      capability,
      register(value) { if (controller) throw new Error("HOST_CONTROLLER_DUPLICATE"); controller = value; },
      registerExecutionProbe(probe) { if (typeof probe !== "function") throw new Error("HOST_EXECUTION_PROBE_INVALID"); executionProbes.push(probe); },
      isHostAuthorized(context) {
        return !closed && capability.allows(controller?.context) && controller.hasCodingAccess()
          && !controller.grantAbort?.signal.aborted && controller.grantBinding !== null
          && controller.grantBinding === controller.sessionIdentity(context)
          && controller.grantBinding === controller.sessionIdentity(controller.context);
      },
    });
    if (!controller) throw new Error("HOST_CONTROLLER_UNAVAILABLE");
    let previous;
    const publish = () => {
      if (closed || transport.connected === false) return;
      managedRuntimeSeen ||= !!controller.orchestrator;
      const state = projectControlState({ access: controller.hasCodingAccess() ? "coding" : "inspect", orchestration: controller.orchestrator?.snapshot?.() });
      const encoded = JSON.stringify(state);
      if (encoded !== previous) { previous = encoded; transport.send({ type: "control_state", state }, () => {}); }
    };
    // The shared orchestrator exposes a snapshot, not an event subscription.
    // Sample only this private process state and publish changes, never logs.
    const projectionTimer = setInterval(publish, 250); projectionTimer.unref();
    pi.on("tool_result", publish);
    pi.on("agent_end", publish);
    const revoke = () => {
      if (controller.context) controller.accessCommand("revoke", controller.context);
      else controller.invalidateCodingAuthority();
    };
    const receive = (message) => {
      if (!closed && message?.type === "prepare_shutdown" && typeof message.id === "string") {
        shutdownId = message.id; revoke(); return;
      }
      if (closed || message?.type !== "revoke" || typeof message.id !== "string") return;
      revoke(); publish(); transport.send({ type: "revoked", id: message.id });
    };
    const disconnect = () => { closed = true; clearInterval(projectionTimer); capability.invalidate(); revoke(); transport.exit?.(1); };
    transport.on("message", receive); transport.once("disconnect", disconnect);
    pi.on("session_shutdown", () => {
      // OMP control's earlier shutdown handler disposes the shared runtime.
      // Never turn a detached gate's unconfirmed exit into released ownership.
      const clean = (!managedRuntimeSeen || executionProbes.length > 0)
        && executionProbes.every((probe) => { const state = probe(); return state.active === 0 && state.unconfirmed === false; });
      if (shutdownId && transport.connected !== false) transport.send({ type: "shutdown_confirmed", id: shutdownId, clean });
      publish(); closed = true; clearInterval(projectionTimer); capability.invalidate();
      transport.off("message", receive); transport.off("disconnect", disconnect);
    });
  };
}
