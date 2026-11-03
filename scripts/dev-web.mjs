import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { build } from "vite";
import { startHost } from "../packages/host/server.mjs";
import { acquireOwnership } from "../packages/process-runtime/ownership.mjs";
import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import { resolveDirectExtensionSet } from "../packages/direct-agent/launcher.mjs";
import { patchPermissionShellIndex, patchPermissionShellSandbox } from "../packages/distribution/permission-shell-patch.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });

// Source development only. Normal omp/Full entrypoints still require their
// verified distribution. No installed user configuration is imported here.
export async function startDevWeb({ dataDir = path.join(sourceRoot, ".omp-dev"), port = 4317, demo = false, watch = true, onBuild = () => {}, onStopped = () => {} } = {}) {
  if (!path.isAbsolute(dataDir)) throw new Error("--data-dir must be absolute");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid --port");
  const requiredNode = (await fs.readFile(path.join(sourceRoot, ".node-version"), "utf8")).trim();
  if (process.version !== `v${requiredNode}`) throw new Error(`Use Node ${requiredNode}; current ${process.version}`);
  const piRoot = await fs.realpath(path.dirname(path.dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")))));
  const pi = await json(path.join(piRoot, "package.json"));
  const rootPackage = await json(path.join(sourceRoot, "package.json"));
  if (pi.version !== rootPackage.devDependencies[pi.name]) throw new Error("Installed Pi differs from the pinned source dependency");
  const externalRoot = path.join(sourceRoot, "contracts/release", process.platform === "linux" ? "linux-external" : "external");
  const identity = { version: 1, sourceRoot: await fs.realpath(sourceRoot), demo, node: process.version, pi: pi.version,
    sourceLock: digest(await fs.readFile(path.join(sourceRoot, "package-lock.json"))),
    externalLock: digest(await fs.readFile(path.join(externalRoot, "package-lock.json"))) };
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(dataDir)).isSymbolicLink()) throw new Error("Development data directory must not be a symlink");
  dataDir = await fs.realpath(dataDir);
  const marker = path.join(dataDir, "development.json");
  const existing = await json(marker).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (existing ? JSON.stringify(existing) !== JSON.stringify(identity) : (await fs.readdir(dataDir)).length) {
    throw new Error("Development directory is unrecognized or dependencies/mode changed. Preserve it and choose a new --data-dir.");
  }
  // Separate from the Host lock: a second launcher cannot rebuild assets or
  // rewrite the loopback model while the first launcher is using this directory.
  const lock = await acquireOwnership(dataDir, "host", "source-development");
  let host, watcher, provider, stopping;
  const stop = () => stopping ??= (async () => {
    try { await host?.stop(); }
    finally { try { await watcher?.close(); } finally { await provider?.stop(); } }
    await lock.release();
    if (host) onStopped({ stopped: true, workers: host.tasks.workers.size, dataRetained: true });
  })();
  try {
    const configRoot = path.join(dataDir, "config"), runtimeRoot = path.join(dataDir, "runtime");
    const home = path.join(dataDir, "home"), assetsRoot = path.join(dataDir, "assets"), project = path.join(dataDir, "project");
    if (!existing) {
      for (const dir of [configRoot, runtimeRoot, home, project]) await fs.mkdir(dir, { mode: 0o700 });
      await fs.symlink(piRoot, path.join(runtimeRoot, "pi"));
      await fs.symlink(path.join(externalRoot, "node_modules"), path.join(dataDir, "node_modules"));
      const name = "pi-permission-modes", permissionRoot = path.join(configRoot, "npm/node_modules", name);
      const permission = await json(path.join(externalRoot, "node_modules", name, "package.json"));
      const externalLock = await json(path.join(externalRoot, "package-lock.json"));
      if (permission.version !== externalLock.packages[`node_modules/${name}`].version) throw new Error("Permission extension differs from lock");
      await fs.mkdir(path.dirname(permissionRoot), { recursive: true });
      await fs.cp(path.join(externalRoot, "node_modules", name), permissionRoot, { recursive: true });
      for (const [name, patch] of [["index.ts", patchPermissionShellIndex], ["sandbox.ts", patchPermissionShellSandbox]]) {
        const file = path.join(permissionRoot, "src", name);
        await fs.writeFile(file, patch(await fs.readFile(file, "utf8")));
      }
      const binding = { id: "permission-modes", name, resolvedVersion: permission.version, binding: "external", owner: "user", resourceFilter: [],
        physicalRootDigest: `sha256:${await hashResourcePath({ artifactRoot: path.join(configRoot, "npm"), relativePath: `node_modules/${name}`, allowContainedSymlinks: true })}` };
      await writeJson(path.join(configRoot, "settings.json"), { enableAnalytics: false, lastChangelogVersion: pi.version, onlyMyPi: { packageBindings: [binding] } });
      if (demo) {
        await writeJson(path.join(configRoot, "auth.json"), { fixture: { type: "api_key", key: "local-demo-only" } });
        await fs.writeFile(path.join(project, "README.md"), "# 本地开发验收项目\n\n原生 Pi read 工具读取的文件：minimal-web-evidence。\n");
      }
      await writeJson(marker, identity);
    }
    if (await fs.realpath(path.join(runtimeRoot, "pi")) !== piRoot) throw new Error("Development Pi path changed; choose a new --data-dir");
    const stack = { root: runtimeRoot, ompPackageRoot: sourceRoot, nodePath: process.execPath,
      piCliPath: path.join(piRoot, "dist/bundle/cli.js"), stackId: `sha256:${digest(JSON.stringify(identity))}` };
    await resolveDirectExtensionSet({ stack, configRoot, minimal: true });
    if (demo) {
      const { startMinimalModel } = await import("../tests/fixtures/minimal-model.mjs");
      provider = await startMinimalModel({ streamDelay: 1200 });
      await writeJson(path.join(configRoot, "models.json"), { providers: { fixture: { baseUrl: provider.baseUrl, api: "openai-completions", models: [
        { id: "one", name: "本地受控演示", input: ["text"], contextWindow: 32000, maxTokens: 128, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      ] } } });
    }
    const output = await build({ configFile: path.join(sourceRoot, "webui/vite.config.ts"), root: path.join(sourceRoot, "webui"), mode: "minimal",
      // Mounted worktrees may not deliver native filesystem events reliably.
      build: { outDir: assetsRoot, emptyOutDir: true, watch: watch ? { chokidar: { usePolling: true, interval: 500 } } : null, rollupOptions: { input: { minimal: path.join(sourceRoot, "webui/minimal.html") } } } });
    if (watch) {
      watcher = output;
      await new Promise((resolve, reject) => watcher.on("event", event => {
        if (event.code === "ERROR") reject(event.error);
        if (event.code === "END") { onBuild(); resolve(); }
      }));
    } else onBuild();
    const env = { PATH: process.env.PATH, HOME: home, TERM: "xterm-256color", LANG: "en_US.UTF-8", PI_CODING_AGENT_DIR: configRoot, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1" };
    host = await startHost({ configRoot, stack, assetsRoot, port, onStopRequested: stop, minimal: true, allowControlled: true, env });
    return { host, dataDir, configRoot, project, provider, stop };
  } catch (error) { await stop(); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = {};
    if (args.includes("--help")) {
      console.log("npm run dev:web [-- --data-dir /absolute/path --port 4317 --no-watch]\nUse dev:web:demo for a persistent isolated loopback demo.\nFrontend changes rebuild automatically; refresh the page. Restart this command after Host changes.\nCommands: pair (fresh link), stop (graceful shutdown; data retained). Ctrl+C also stops.");
    } else {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--demo") options.demo = true;
        else if (args[i] === "--no-watch") options.watch = false;
        else if (args[i] === "--data-dir" && args[i + 1]) options.dataDir = args[++i];
        else if (args[i] === "--port" && /^\d+$/.test(args[i + 1] ?? "")) options.port = Number(args[++i]);
        else throw new Error(`Unknown or incomplete option: ${args[i]}`);
      }
      options.dataDir ??= path.join(sourceRoot, options.demo ? ".omp-dev-demo" : ".omp-dev");
      let input, closing;
      const closeInput = () => { input?.close(); process.stdin.pause(); };
      const ready = startDevWeb({ ...options, onBuild: () => console.log("Frontend ready — refresh the page."), onStopped: result => { console.log(JSON.stringify(result)); closeInput(); } });
      const close = () => closing ??= (async () => {
        try { const app = await ready; await app.stop(); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
        finally { closeInput(); }
      })();
      process.once("SIGINT", close); process.once("SIGTERM", close);
      const app = await ready;
      if (!closing) {
        console.log(JSON.stringify({ development: true, demo: !!options.demo, pid: process.pid, origin: app.host.origin, pairingUrl: app.host.pairingUrl, dataDir: app.dataDir, configRoot: app.configRoot, project: options.demo ? app.project : null }));
        console.log("Commands: pair, stop. Data is retained on exit.");
        input = createInterface({ input: process.stdin });
        input.on("line", line => {
          if (line.trim() === "stop") void close();
          if (line.trim() === "pair" && !closing) void fetch(app.host.origin + "/internal/pair", { method: "POST", headers: { authorization: `Bearer ${app.host.controlToken}` } })
            .then(async response => { if (!response.ok) throw new Error("Pair link unavailable"); console.log(JSON.stringify(await response.json())); }).catch(error => console.error(error.message));
        });
      }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
