import { createHostInteraction } from "./interaction.mjs";
import { projectControlState } from "./control-state.mjs";

// Private SDK factory: never loaded by ordinary CLI/RPC, never configurable by
// browser fields. Host communication uses the inherited Node IPC channel.
export function createControlledExtension({ transport = process } = {}) {
  if (typeof transport.send !== "function") throw new Error("HOST_CONTROL_CHANNEL_REQUIRED");
  const capability = createHostInteraction();
  let controller;
  let closed = false;
  return (pi) => {
    pi.events.emit("only-my-pi:host-interaction:v1", {
      capability,
      register(value) { if (controller) throw new Error("HOST_CONTROLLER_DUPLICATE"); controller = value; },
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
      if (closed || message?.type !== "revoke" || typeof message.id !== "string") return;
      revoke(); publish(); transport.send({ type: "revoked", id: message.id });
    };
    const disconnect = () => { closed = true; clearInterval(projectionTimer); capability.invalidate(); revoke(); transport.exit?.(1); };
    transport.on("message", receive); transport.once("disconnect", disconnect);
    pi.on("session_shutdown", () => {
      publish(); closed = true; clearInterval(projectionTimer); capability.invalidate();
      transport.off("message", receive); transport.off("disconnect", disconnect);
    });
  };
}
