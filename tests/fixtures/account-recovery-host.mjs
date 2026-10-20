import path from "node:path";
import { pathToFileURL } from "node:url";

// A real, separate source Host exercises its normal startup recovery. This is
// not an installed candidate or a replacement authentication implementation.
const [packageRoot, root, configRoot, assetsRoot] = process.argv.slice(2);
const { startHost } = await import(pathToFileURL(path.join(packageRoot, "packages/host/server.mjs")).href);
const host = await startHost({ configRoot, assetsRoot, allowControlled: true, stack: {
  root, ompPackageRoot: packageRoot, stackId: `sha256:${path.basename(root)}`,
  nodePath: path.join(root, "node/bin/node"), piCliPath: path.join(root, "pi/dist/bundle/cli.js"),
} });
let stopping;
const stop = () => { stopping ??= host.stop().then(() => process.exit(0), () => process.exit(1)); };
process.on("message", message => { if (message?.type === "stop") stop(); });
process.on("disconnect", stop); process.on("SIGTERM", stop);
process.send({ ready: true, pid: process.pid });
