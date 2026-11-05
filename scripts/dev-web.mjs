import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { build } from "vite";
import { startWebHost } from "./web-runtime.mjs";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

// Programmatic callers retain the minimal-layout default. The command-line
// entry below selects the current WebUI; --minimal remains an explicit option.
export function startDevWeb(options = {}) {
  const { frontend = "minimal", watch = true } = options;
  const frontendRoot = path.join(sourceRoot, frontend === "b2" ? "prototypes" : "webui");
  return startWebHost({ ...options, watch,
    startModel: async () => {
      const { startMinimalModel } = await import("../tests/fixtures/minimal-model.mjs");
      return startMinimalModel({ streamDelay: 1200 });
    },
    buildAssets: assetsRoot => build({ configFile: path.join(frontendRoot, "vite.config.ts"), root: frontendRoot, mode: frontend === "b2" ? "host" : "minimal",
      // Mounted worktrees may not deliver native filesystem events reliably.
      build: { outDir: assetsRoot, emptyOutDir: true, watch: watch ? { chokidar: { usePolling: true, interval: 500 } } : null, rollupOptions: { input: { minimal: path.join(frontendRoot, "minimal.html") } } } }),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), options = { frontend: "b2" };
    if (args.includes("--help")) {
      console.log("npm run dev:web [-- --data-dir /absolute/path --port 4317 --no-watch]\nThe current WebUI is the default; dev:web:demo uses an isolated loopback model. Use dev:web:minimal for the retained minimal layout.\nFrontend changes rebuild automatically; refresh the page. Restart this command after Host changes.\nCommands: pair (fresh link), stop (graceful shutdown; data retained). Ctrl+C also stops.");
    } else {
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "--demo") options.demo = true;
        else if (args[i] === "--b2") options.frontend = "b2";
        else if (args[i] === "--minimal") options.frontend = "minimal";
        else if (args[i] === "--no-watch") options.watch = false;
        else if (args[i] === "--data-dir" && args[i + 1]) options.dataDir = args[++i];
        else if (args[i] === "--port" && /^\d+$/.test(args[i + 1] ?? "")) options.port = Number(args[++i]);
        else throw new Error(`Unknown or incomplete option: ${args[i]}`);
      }
      options.dataDir ??= path.join(sourceRoot, options.frontend === "b2" ? options.demo ? ".omp-dev-b2-demo" : ".omp-dev-b2" : options.demo ? ".omp-dev-demo" : ".omp-dev");
      let input, closing;
      const closeInput = () => { input?.close(); process.stdin.pause(); };
      const ready = startDevWeb({ ...options, onBuild: () => console.log("Frontend ready — refresh the page."), onStopped: result => { console.log(JSON.stringify(result)); closeInput(); } });
      const close = () => closing ??= (async () => {
        try { const app = await ready; await app.stop(); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
        finally { closeInput(); }
      })();
      // Retain signal ownership until asynchronous Host cleanup has finished.
      process.on("SIGINT", close); process.on("SIGTERM", close);
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
