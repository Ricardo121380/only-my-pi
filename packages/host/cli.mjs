import fs from "node:fs/promises";
import path from "node:path";
import { fork, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readJsonObject } from "../config-runtime/index.mjs";
import { resolveControlledStack, resolveDirectConfigRoot } from "../direct-agent/launcher.mjs";
import { processIdentity } from "./ownership.mjs";
import { HOST_PROTOCOL, HOST_VERSION, hostError } from "./contracts.mjs";

export async function hostEndpoint(configRoot) {
  const file = path.join(configRoot, "only-my-pi/host/endpoint.json");
  const stat = await fs.lstat(file).catch((e) => { if (e.code === "ENOENT") return null; throw e; });
  if (!stat) return null;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192 || (stat.mode & 0o077) !== 0) throw hostError("HOST_ENDPOINT_UNSAFE");
  const endpoint = await readJsonObject(configRoot, file);
  const url = new URL(endpoint.origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.origin !== endpoint.origin || !/^[a-f0-9]{64}$/u.test(endpoint.controlToken ?? "")) throw hostError("HOST_ENDPOINT_UNSAFE");
  if (await processIdentity(endpoint.pid) !== endpoint.identity) return null;
  if (endpoint.protocol !== HOST_PROTOCOL || endpoint.version !== HOST_VERSION) throw hostError("HOST_VERSION_MISMATCH", 409);
  return endpoint;
}
export async function hostControl(endpoint, operation, method = "GET") {
  const r = await fetch(`${endpoint.origin}/internal/${operation}`, { method, headers: { Authorization: `Bearer ${endpoint.controlToken}` }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw hostError("HOST_CONTROL_FAILED"); return r.json();
}
export async function runWebCommand({ argv = [], packageRoot, env = process.env, openBrowser = async (url) => {
  await promisify(execFile)(process.platform === "darwin" ? "/usr/bin/open" : "xdg-open", [url], { timeout: 10000 });
} }) {
  const action = argv.find((v) => v !== "--json") ?? "start";
  if (!["start", "status", "stop"].includes(action) || argv.filter((v) => v !== "--json").length > 1 || argv.filter((v) => v === "--json").length > 1) throw hostError("INVALID_ARGUMENT");
  const configRoot = resolveDirectConfigRoot({ env });
  let endpoint = await hostEndpoint(configRoot);
  if (action === "status") return endpoint ? { ok: true, status: "HOST_RUNNING", ...(await hostControl(endpoint, "status")) } : { ok: true, status: "HOST_NOT_RUNNING" };
  if (action === "stop") {
    if (!endpoint) return { ok: true, status: "HOST_NOT_RUNNING" };
    await hostControl(endpoint, "stop", "POST");
    for (let i = 0; i < 100; i++) { if (await processIdentity(endpoint.pid) !== endpoint.identity) return { ok: true, status: "HOST_STOPPED" }; await new Promise((r) => setTimeout(r, 100)); }
    throw hostError("HOST_STOP_UNCONFIRMED");
  }
  if (!endpoint) {
    const stack = await resolveControlledStack({ packageRoot });
    if (stack.distribution?.runtimeContract !== "phase1-pi0851") throw hostError("HOST_REQUIRES_VERIFIED_CANDIDATE");
    const entry = fileURLToPath(new URL("./entry.mjs", import.meta.url));
    const child = fork(entry, [configRoot], { execPath: stack.nodePath, execArgv: [], detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"], env });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill("SIGTERM"); reject(hostError("HOST_START_TIMEOUT")); }, 30000);
      child.once("error", (e) => { clearTimeout(timeout); reject(e); });
      child.once("exit", () => { clearTimeout(timeout); reject(hostError("HOST_START_FAILED")); });
      child.once("message", (m) => { clearTimeout(timeout); if (m.ready) resolve(); else reject(hostError(m.code ?? "HOST_START_FAILED")); });
    });
    child.disconnect(); child.unref();
    endpoint = await hostEndpoint(configRoot);
    if (!endpoint) throw hostError("HOST_START_FAILED");
  }
  const pairing = await hostControl(endpoint, "pair", "POST");
  try { await openBrowser(pairing.url); }
  catch { return { ok: false, status: "HOST_BROWSER_OPEN_FAILED", next: "Retry omp web to issue a fresh browser pairing link.", origin: endpoint.origin }; }
  return { ok: true, status: "HOST_RUNNING", origin: endpoint.origin };
}
