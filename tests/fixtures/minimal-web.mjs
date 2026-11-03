import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { createPi110SourceCli } from "./pi110-source-cli.mjs";
import { startMinimalModel } from "./minimal-model.mjs";

// Real Pi + real audited permission extensions. Only model inference is replaced
// by a deterministic loopback service. All files belong to this disposable root.
export async function createMinimalWebFixture({ assetsRoot, streamDelay = 700, staleOwner = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-minimal-web-")));
  const provider = await startMinimalModel({ streamDelay });
  const { received } = provider;
  let host;
  try {
    const f = await createPi110SourceCli(root, { baseUrl: provider.baseUrl, installedExtensions: true, verifyNode: true });
    const removed = ["packages/mcp", "packages/product-settings", "packages/subagents", "packages/direct-agent/orchestration.mjs", "packages/direct-agent/managed-clone.mjs", "packages/direct-agent/codemode.mjs", "extensions/omp-control", "extensions/context-doctor", "extensions/session-ledger", "packages/host/manual-workspaces.mjs", "packages/host/terminals.mjs", "packages/host/image-exports.mjs"];
    for (const name of removed) await fs.rm(path.join(f.omp, name), { recursive: true, force: true });
    for (const name of await fs.readdir(path.join(f.omp, "packages/model-calls"))) if (name !== "references.mjs") await fs.rm(path.join(f.omp, "packages/model-calls", name), { recursive: true });
    const settingsFile = path.join(f.config, "settings.json"), settings = JSON.parse(await fs.readFile(settingsFile, "utf8"));
    for (const b of settings.onlyMyPi.packageBindings.filter(b => b.id !== "permission-modes")) await fs.rm(path.join(f.config, "npm/node_modules", b.name), { recursive: true });
    settings.onlyMyPi.packageBindings = settings.onlyMyPi.packageBindings.filter(b => b.id === "permission-modes");
    settings.packages = ["npm:must-not-resolve-in-minimal-web"];
    await fs.writeFile(settingsFile, JSON.stringify(settings));
    const settingsBytes = await fs.readFile(settingsFile, "utf8");
    await fs.writeFile(path.join(f.project, "README.md"), "# 本地验收项目\n\n这是原生 Pi read 工具实际读取的文件：minimal-web-evidence。\n");
    // Import the reduced copy too: optional Host modules cannot accidentally load.
    const { startHost } = await import(pathToFileURL(path.join(f.omp, "packages/host/server.mjs")));
    assetsRoot ??= path.join(root, "assets");
    if (!await fs.stat(assetsRoot).catch(() => null)) { await fs.mkdir(assetsRoot); await fs.writeFile(path.join(assetsRoot, "minimal.html"), "<!doctype html><title>minimal fixture</title>"); }
    if (staleOwner) await leaveDeadHostOwner(f);
    host = await startHost({ minimal: true, allowControlled: true, configRoot: f.config, stack: { root: f.stack, ompPackageRoot: f.omp, nodePath: path.join(f.stack, "node/bin/node"), piCliPath: path.join(f.stack, "pi/dist/bundle/cli.js"), stackId: `sha256:${"a".repeat(64)}` }, assetsRoot, env: f.env });
    let stopping;
    return { root, f, host, received, removed, settingsBytes, stop: () => stopping ??= (async () => {
      try { await host.stop(); }
      finally { await provider.stop(); }
    })(), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
  } catch (error) { await host?.stop(); await provider.stop(); await fs.rm(root, { recursive: true, force: true }); throw error; }
}

export async function leaveDeadHostOwner(f) {
  await promisify(execFile)(process.execPath, ["--input-type=module", "-e", 'const { acquireOwnership } = await import(process.argv[1]); await acquireOwnership(process.argv[2], "host", "singleton");', pathToFileURL(path.join(f.omp, "packages/process-runtime/ownership.mjs")).href, f.config]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = await createMinimalWebFixture({ assetsRoot: fileURLToPath(new URL("../../webui/dist", import.meta.url)), streamDelay: 1800 });
  const { f, host, received, root } = fixture;
  console.log(JSON.stringify({ pairingUrl: host.pairingUrl, origin: host.origin, project: f.project, configRoot: f.config, root, pid: process.pid }));
  const input = createInterface({ input: process.stdin });
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await fixture.stop();
    const evidence = { node: process.version, pi: f.piVersion, removed: fixture.removed, settingsUnchanged: fixture.settingsBytes === await fs.readFile(path.join(f.config, "settings.json"), "utf8"), requests: received, tasks: host.tasks.snapshot(), workerCount: host.tasks.workers.size, stopped: true };
    if (process.env.OMP_MINIMAL_WEB_EVIDENCE) await fs.writeFile(process.env.OMP_MINIMAL_WEB_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ stopped: true, requests: received.length, settingsUnchanged: evidence.settingsUnchanged, workers: evidence.workerCount }));
    await fixture.cleanup(); input.close(); process.stdin.pause();
  };
  input.on("line", line => { if (line === "stop") void stop(); });
  process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop());
}
