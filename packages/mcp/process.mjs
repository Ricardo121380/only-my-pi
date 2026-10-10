import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";
import { processIdentity, groupAlive } from "../host/ownership.mjs";
import { digest, mcpError, MCP_LIMITS } from "./catalog.mjs";

export async function launchIdentity(server) {
  const files = await Promise.all([server.command, ...server.codePaths].map(async (file) => {
    const canonical = await fs.realpath(file), stat = await fs.lstat(canonical);
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw mcpError("MCP_CODE_NOT_ADMITTED");
    return { path: canonical, digest: digest(await fs.readFile(canonical)) };
  }));
  await fs.access(files[0].path, fs.constants.X_OK);
  return files;
}
const quote = (value) => JSON.stringify(value);
const containsSecret = (value, secrets) => typeof value === "string" ? secrets.some((secret) => value.includes(secret))
  : value && typeof value === "object" && Object.entries(value).some(([key, entry]) => containsSecret(key, secrets) || containsSecret(entry, secrets));
export function sandboxProfile({ files, readPaths, runtimeDir, configRoot, cwd }) {
  return `(version 1)
(deny default)
(deny process-fork)
(allow process-exec (literal ${quote(files[0].path)}))
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup (global-name "com.apple.system.logger"))
(allow file-read-metadata)
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr/lib") (subpath "/usr/share") (subpath "/Library/Apple") (subpath "/dev/fd") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random")
 (literal ${quote(cwd)})
 ${files.map((file) => `(literal ${quote(file.path)})`).join("\n ")}
 ${readPaths.map((file) => `(subpath ${quote(file)})`).join("\n ")}
 (subpath ${quote(runtimeDir)}))
(allow file-write* (literal ${quote(path.join(runtimeDir, "received.jsonl"))}) (literal ${quote(path.join(runtimeDir, "scratch"))}) (literal "/dev/null"))
(deny file-read* file-write* (subpath ${quote(configRoot)}) (regex #"(^|/)(\\.git|\\.pi|\\.env)(/|$|\\.)"))`;
}

// This is the public Pi McpTransport interface. Framing, startup and group
// cleanup are OMP-owned so an exited leader cannot hide a surviving descendant.
export class ControlledStdioTransport {
  constructor({ server, files, readPaths, configRoot, env, secrets, record, save }) {
    Object.assign(this, { server, files, readPaths, configRoot, env, secrets, record, save });
    this.listeners = { message: new Set(), error: new Set(), close: new Set() };
  }
  onMessage(fn) { this.listeners.message.add(fn); return () => this.listeners.message.delete(fn); }
  onError(fn) { this.listeners.error.add(fn); return () => this.listeners.error.delete(fn); }
  onClose(fn) { this.listeners.close.add(fn); return () => this.listeners.close.delete(fn); }
  emit(kind, value) { for (const fn of this.listeners[kind]) fn(value); }
  async start() {
    if (process.platform !== "darwin") throw mcpError("MCP_PROCESS_ISOLATION_UNAVAILABLE", 409);
    if (this.child || this.closed) throw mcpError("MCP_PROCESS_STATE_INVALID");
    const runtimeDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-runtime-")));
    this.record.runtimeDir = runtimeDir; this.record.status = "starting"; await this.save();
    const profile = sandboxProfile({ ...this, runtimeDir });
    await fs.writeFile(path.join(runtimeDir, "sandbox.sb"), profile, { mode: 0o600 });
    if (this.closed) throw mcpError("MCP_AUTHORIZATION_REVOKED");
    // The trusted launcher sets a hard kernel limit before executing the service.
    // Only two fixed writable slots exist; the service cannot create more files.
    const child = spawn("/bin/sh", ["-c", `ulimit -f ${MCP_LIMITS.serverFileBytes / 1024} || exit; exec "$@"`, "omp-mcp", "/usr/bin/sandbox-exec", "-f", path.join(runtimeDir, "sandbox.sb"), this.files[0].path, ...this.server.args], {
      cwd: this.cwd, detached: true, stdio: ["pipe", "pipe", "pipe"],
      env: { HOME: runtimeDir, TMPDIR: runtimeDir, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", ...this.server.env, ...this.env, OMP_MCP_RUNTIME_DIR: runtimeDir },
    });
    this.child = child; child.stdin.on("error", () => {});
    let buffer = "", stderrBytes = 0; const decoder = new StringDecoder("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      if (Buffer.byteLength(buffer) > MCP_LIMITS.outputBytes) { this.emit("error", mcpError("MCP_OUTPUT_LIMIT")); void this.close().catch(() => {}); return; }
      let index;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        try {
          if (this.secrets.some((secret) => line.includes(secret))) throw mcpError("MCP_SECRET_OUTPUT_REJECTED");
          const message = JSON.parse(line);
          if (containsSecret(message, this.secrets)) throw mcpError("MCP_SECRET_OUTPUT_REJECTED");
          if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") throw mcpError("MCP_FRAME_INVALID");
          if (message.result?.tools && (message.result.tools.length > MCP_LIMITS.tools || message.result.nextCursor !== undefined)) throw mcpError("MCP_TOOL_LIMIT");
          this.emit("message", message);
        } catch (error) { this.emit("error", mcpError(error.code ?? "MCP_FRAME_INVALID")); void this.close().catch(() => {}); return; }
      }
    });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; if (stderrBytes > MCP_LIMITS.outputBytes) { this.emit("error", mcpError("MCP_OUTPUT_LIMIT")); void this.close().catch(() => {}); } });
    this.exited = new Promise((resolve) => child.once("close", (code, signal) => { this.record.exitCode = code; this.record.signal = signal; this.emit("close"); resolve(); }));
    child.on("error", () => this.emit("error", mcpError("MCP_START_FAILED")));
    await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    this.record.pid = child.pid; this.identityPending = processIdentity(child.pid); this.record.identity = await this.identityPending;
    if (!this.record.identity) throw mcpError("MCP_START_FAILED");
    this.record.status = "running"; await this.save();
  }
  async send(message) {
    if (message.method === "tools/call") await this.beforeToolCall?.(message);
    if (this.closed || !this.child || this.child.stdin.destroyed) throw mcpError("MCP_CONNECTION_CLOSED");
    const frame = JSON.stringify(message) + "\n";
    if (Buffer.byteLength(frame) > MCP_LIMITS.inputBytes) throw mcpError("MCP_INPUT_LIMIT");
    await new Promise((resolve, reject) => this.child.stdin.write(frame, (error) => error ? reject(mcpError("MCP_SEND_UNKNOWN")) : resolve()));
  }
  close() {
    this.closed = true;
    this.closing ??= (async () => {
      if (!this.child) { this.record.status = "stopped"; await this.save(); return; }
      await this.identityPending;
      this.record.status = "stopping"; await this.save(); this.child.stdin.end();
      await Promise.race([this.exited, delay(100)]);
      for (const signal of ["SIGTERM", "SIGKILL"]) {
        const pid = this.record.pid;
        if (!Number.isSafeInteger(pid) || pid < 1 || !groupAlive(pid)) break;
        if (!this.record.identity || await processIdentity(pid) !== this.record.identity) {
          this.record.status = "reconciliation"; await this.save(); throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
        }
        try { process.kill(-pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
        await Promise.race([this.exited, delay(signal === "SIGTERM" ? 200 : 1000)]);
      }
      if (this.record.pid && groupAlive(this.record.pid)) { this.record.status = "reconciliation"; await this.save(); throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409); }
      this.record.status = "stopped"; await this.save(); this.emit("close");
    })();
    return this.closing;
  }
}
