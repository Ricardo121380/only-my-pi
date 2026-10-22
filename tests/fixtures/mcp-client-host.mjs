// A separate production Host process sharing the standalone CLI's isolated
// source stack. No Provider requests or GUI preconfiguration occur on startup.
import path from "node:path";
import { startHost } from "../../packages/host/server.mjs";

const [configRoot, root, assetsRoot] = process.argv.slice(2);
const stack = { root, ompPackageRoot: path.join(root, "only-my-pi/package"), nodePath: path.join(root, "node/bin/node"),
  piCliPath: path.join(root, "pi/dist/bundle/cli.js"), stackId: `sha256:${path.basename(root)}` };
const host = await startHost({ configRoot, stack, assetsRoot, allowControlled: true, env: process.env, modelsProvider: () => [] });
let stopping;
const stop = () => stopping ??= (async () => { await host.stop(); process.disconnect?.(); })();
process.on("message", message => { if (message === "stop") void stop(); });
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
process.send({ origin: host.origin, pairingUrl: host.pairingUrl, pid: process.pid });
