// Isolated real Host child for abrupt-exit acceptance. All paths belong to the caller.
import assert from "node:assert/strict";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { startHost } from "../../packages/host/server.mjs";
import { RpcWorker } from "../../packages/host/rpc-worker.mjs";
import { loadDistribution } from "../../packages/distribution/runtime.mjs";
import { resolveDirectExtensionSet } from "../../packages/direct-agent/launcher.mjs";

const [configRoot, assetsRoot, extension] = process.argv.slice(2);
assert([configRoot, assetsRoot, extension, process.env.OMP_INPUT_PI110_STACK ?? process.env.OMP_TEST_STACK_PACKAGE].every((value) => value && path.isAbsolute(value)));
const workers = [];
try {
  const nodePath = process.env.OMP_INPUT_PI110_STACK ? path.join(process.env.OMP_INPUT_PI110_STACK, "node/bin/node") : path.resolve(process.env.OMP_TEST_STACK_PACKAGE, "../../node/bin/node");
  const nodeVersion = execFileSync(nodePath, ["--version"]).toString().trim().replace(/^v/, "");
  const root = process.env.OMP_INPUT_PI110_STACK;
  const stack = root ? { root, ompPackageRoot: path.join(root, "only-my-pi/package"), nodePath, piCliPath: path.join(root, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` } : await loadDistribution({ packageRoot: process.env.OMP_TEST_STACK_PACKAGE, nodePath, nodeVersion });
  const host = await startHost({ configRoot, assetsRoot, stack, allowControlled: true, env: { PATH: process.env.PATH }, workerFactory: (options) => {
    const worker = new RpcWorker({ ...options, extensionResolver: async (params) => { const set = await resolveDirectExtensionSet(params); return { ...set, extensions: [...set.extensions, extension] }; }, spawnImpl: (...args) => {
      const child = spawn(...args); child.on("message", (frame) => { if (frame?.type === "fixture_tool_waiting") process.send({ type: "waiting", taskId: options.taskId }); }); return child;
    } }); workers.push(worker); return worker;
  } });
  process.send({ type: "ready", origin: host.origin, pairingUrl: host.pairingUrl, epoch: host.epoch, stackId: stack.stackId });
  process.on("message", (frame) => { if (frame?.type === "release") for (const worker of workers) if (worker.child?.connected) worker.child.send({ type: "fixture_release_tool" }); });
  process.on("SIGTERM", () => void host.stop().then(() => process.exit(0), () => process.exit(1)));
} catch (error) { process.send({ type: "error", code: error.code ?? "FIXTURE_START_FAILED", reason: error.code ? null : error.name }); process.disconnect(); }
