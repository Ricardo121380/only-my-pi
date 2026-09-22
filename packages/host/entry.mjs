import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveControlledStack } from "../direct-agent/launcher.mjs";
import { startHost } from "./server.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
try {
  const configRoot = process.argv[2];
  const stack = await resolveControlledStack({ packageRoot: root });
  if (stack.distribution?.runtimeContract !== "phase1-pi0851") throw Object.assign(new Error("candidate required"), { code: "HOST_REQUIRES_VERIFIED_CANDIDATE" });
  const host = await startHost({ configRoot, stack, allowControlled: true, assetsRoot: path.join(root, "webui/dist"), sessionRoot: process.env.PI_CODING_AGENT_SESSION_DIR ?? path.join(configRoot, "sessions") });
  process.send?.({ ready: true });
  const stop = () => { void host.stop().then(() => process.exit(0), () => process.exit(1)); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
} catch (error) { process.send?.({ ready: false, code: /^[A-Z_]+$/u.test(error.code ?? "") ? error.code : "HOST_START_FAILED" }); process.exitCode = 1; process.disconnect?.(); }
