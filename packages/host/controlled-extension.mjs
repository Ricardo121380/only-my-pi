import { createHostInteraction } from "./interaction.mjs";

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
    });
    if (!controller) throw new Error("HOST_CONTROLLER_UNAVAILABLE");
    const revoke = () => {
      if (controller.context) controller.accessCommand("revoke", controller.context);
      else controller.invalidateCodingAuthority();
    };
    const receive = (message) => {
      if (closed || message?.type !== "revoke" || typeof message.id !== "string") return;
      revoke(); transport.send({ type: "revoked", id: message.id });
    };
    const disconnect = () => { closed = true; capability.invalidate(); revoke(); transport.exit?.(1); };
    transport.on("message", receive); transport.once("disconnect", disconnect);
    pi.on("session_shutdown", () => {
      closed = true; capability.invalidate();
      transport.off("message", receive); transport.off("disconnect", disconnect);
    });
  };
}
