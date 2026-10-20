import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pty from "node-pty";
import { acquireOwnership, processIdentity } from "./ownership.mjs";
import { projectPath } from "./inspector.mjs";
import { hostError } from "./contracts.mjs";
import { atomicWriteJson, ensureConfigDirectory, readJsonObject } from "../config-runtime/index.mjs";

const LIMIT = 1024 * 1024;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export class HostTerminals {
  constructor({ configRoot, catalog, env = process.env }) {
    Object.assign(this, { configRoot, catalog, env });
    this.entries = new Map(); this.pending = new Map(); this.writes = Promise.resolve(); this.stopping = false;
    this.file = path.join(configRoot, "only-my-pi/host/terminals.json");
  }
  public(entry) {
    const { terminalId, projectId, status, cols, rows, inputSeq, exitCode, error } = entry;
    return { terminalId, projectId, status, cols, rows, inputSeq, exitCode, error };
  }
  snapshot() { return [...this.entries.values()].map((entry) => this.public(entry)); }
  async load() {
    const data = await readJsonObject(this.configRoot, this.file).catch((error) => { if (error.code === "ENOENT") return { terminals: [] }; throw error; });
    if (!Array.isArray(data.terminals)) throw hostError("TERMINAL_STATE_INVALID");
    for (const entry of data.terminals) if (entry.status !== "closed") {
      this.entries.set(entry.terminalId, { ...entry, status: "reconciliation", error: "TERMINAL_RECONCILIATION_REQUIRED", output: "", end: 0 });
    }
  }
  persist() {
    const data = { terminals: [...this.entries.values()].map((entry) => ({ ...this.public(entry), recovery: entry.recovery })) };
    const operation = this.writes.then(() => atomicWriteJson(this.configRoot, this.file, data));
    this.writes = operation.catch(() => {});
    return operation;
  }
  get(id) { const entry = this.entries.get(id); if (!entry) throw hostError("TERMINAL_NOT_FOUND", 404); return entry; }
  read(id, offset = 0) {
    const entry = this.get(id), base = entry.end - entry.output.length;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.end) throw hostError("TERMINAL_OFFSET_INVALID");
    return { ...this.public(entry), base, end: entry.end, truncated: offset < base, output: entry.output.slice(Math.max(0, offset - base)) };
  }
  async open(projectId, cols, rows) {
    if (this.stopping) throw hostError("HOST_STOPPING", 409);
    if (this.pending.has(projectId)) return this.pending.get(projectId);
    const previous = [...this.entries.values()].find((e) => e.projectId === projectId && e.status !== "closed");
    if (previous) return this.public(previous);
    if (this.pending.size + [...this.entries.values()].filter((e) => e.status !== "closed").length >= 4) throw hostError("TERMINAL_LIMIT", 409);
    const operation = this.create(projectId, cols, rows);
    this.pending.set(projectId, operation);
    try { return await operation; } finally { this.pending.delete(projectId); }
  }
  async create(projectId, cols, rows) {
    const cwd = await projectPath(this.catalog.project(projectId));
    const directory = await ensureConfigDirectory(this.configRoot, "only-my-pi/host/terminal-receipts");
    const lease = await acquireOwnership(this.configRoot, "project", cwd);
    const terminalId = randomUUID(), token = randomUUID();
    const receipt = path.join(directory, `${terminalId}.json`);
    const entry = { terminalId, projectId, cols, rows, status: "starting", inputSeq: 0, exitCode: null, error: null, output: "", end: 0, lease, receipt, token };
    entry.recovery = { token, root: cwd, owner: lease.owner };
    // Bound retained closed output too, not just the number of live PTYs.
    for (const [id, old] of this.entries) if (old.projectId === projectId && old.status === "closed") this.entries.delete(id);
    const closed = [...this.entries.values()].filter((e) => e.status === "closed");
    for (const old of closed.slice(0, Math.max(0, closed.length - 7))) this.entries.delete(old.terminalId);
    this.entries.set(terminalId, entry);
    try {
      await this.persist();
      const env = { PATH: this.env.PATH || "/usr/bin:/bin", HOME: this.env.HOME || os.homedir(), TERM: "xterm-256color", LANG: this.env.LANG || "en_US.UTF-8", COLORTERM: "truecolor" };
      for (const key of ["USER", "LOGNAME", "TMPDIR"]) if (this.env[key]) env[key] = this.env[key];
      entry.pty = pty.spawn(process.execPath, [fileURLToPath(new URL("./terminal-supervisor.mjs", import.meta.url)), receipt, token, "/bin/zsh"], { name: "xterm-256color", cwd, cols, rows, env });
    } catch (error) {
      this.entries.delete(terminalId); await lease.release(); await this.persist(); throw error;
    }
    entry.done = new Promise((resolve) => { entry.finish = resolve; });
    entry.pty.onData((data) => { entry.end += data.length; entry.output = (entry.output + data).slice(-LIMIT); });
    entry.pty.onExit(({ exitCode, signal }) => { void this.exited(entry, exitCode, signal); });
    entry.recovery.pid = entry.pty.pid;
    try {
      entry.recovery.identity = await processIdentity(entry.pty.pid);
      const deadline = Date.now() + 3000;
      let ready = false;
      while (entry.status === "starting" && Date.now() < deadline) {
        const state = await readJsonObject(this.configRoot, receipt + ".ready").catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        if (state?.token === token) { ready = true; await fs.unlink(receipt + ".ready"); break; }
        await pause(20);
      }
      if (!ready) throw hostError("TERMINAL_START_FAILED", 503);
      if (entry.status === "starting") entry.status = "running";
      await this.persist();
    } catch (error) { await this.close(terminalId); throw error; }
    return this.public(entry);
  }
  async exited(entry, exitCode, signal) {
    entry.exitCode = exitCode;
    try {
      const proof = await readJsonObject(this.configRoot, entry.receipt);
      if (signal || exitCode !== 0 || proof.token !== entry.token || proof.clean !== true) throw Error("uncertain");
      await entry.lease.release(); entry.status = "closed"; entry.error = null;
      // Output remains in memory for inspection, never written to disk.
      await this.persist();
      await fs.unlink(entry.receipt);
    } catch {
      if (entry.status !== "closed") { entry.status = "reconciliation"; entry.error = "TERMINAL_RECONCILIATION_REQUIRED"; }
      else entry.error = "TERMINAL_RECEIPT_CLEANUP_FAILED";
      await this.persist().catch(() => {});
    } finally { entry.finish(); }
  }
  write(id, seq, data) {
    const entry = this.get(id);
    if (entry.status !== "running") throw hostError("TERMINAL_NOT_RUNNING", 409);
    const digest = createHash("sha256").update(data).digest("hex");
    if (seq === entry.inputSeq && digest === entry.lastInput) return this.public(entry);
    if (seq !== entry.inputSeq + 1 || Buffer.byteLength(data) > 16384) throw hostError("TERMINAL_INPUT_CONFLICT", 409);
    entry.pty.write(data); entry.inputSeq = seq; entry.lastInput = digest;
    return this.public(entry);
  }
  resize(id, cols, rows) {
    const entry = this.get(id);
    if (entry.status !== "running") throw hostError("TERMINAL_NOT_RUNNING", 409);
    entry.pty.resize(cols, rows); entry.cols = cols; entry.rows = rows;
    return this.public(entry);
  }
  async close(id) {
    const entry = this.get(id);
    if (entry.status === "closed") return this.public(entry);
    if (entry.status === "reconciliation") {
      await this.reconcile(entry);
      return this.public(entry);
    }
    if (!entry.closing) entry.closing = (async () => {
      entry.status = "closing";
      try {
        await this.persist(); entry.pty.kill("SIGTERM");
        await Promise.race([entry.done, pause(7000)]);
        if (entry.status === "closing") {
          entry.status = "reconciliation"; entry.error = "TERMINAL_RECONCILIATION_REQUIRED";
          entry.pty.kill("SIGKILL"); await this.persist();
        }
      } catch { entry.status = "reconciliation"; entry.error = "TERMINAL_RECONCILIATION_REQUIRED"; await this.persist().catch(() => {}); }
    })();
    await entry.closing; return this.public(entry);
  }
  async reconcile(entry) {
    // Never reclaim on timeout or mere PID death. Only the matching supervisor
    // receipt plus a dead old Host proves the cooperative cleanup contract.
    const recovery = entry.recovery;
    if (!recovery?.identity || !recovery.owner || await processIdentity(recovery.pid) === recovery.identity) return;
    const receipt = path.join(this.configRoot, "only-my-pi/host/terminal-receipts", `${entry.terminalId}.json`);
    const proof = await readJsonObject(this.configRoot, receipt).catch(() => null);
    if (proof?.token !== recovery.token || proof?.clean !== true) return;
    const root = await projectPath(this.catalog.project(entry.projectId));
    if (root !== recovery.root || await processIdentity(recovery.owner.pid) === recovery.owner.identity) return;
    let lease;
    try {
      lease = await acquireOwnership(this.configRoot, "project", root, { recover: async (previous) => {
        if (previous.token !== recovery.owner.token || previous.identity !== recovery.owner.identity || previous.pid !== recovery.owner.pid) throw hostError("TERMINAL_RECONCILIATION_REQUIRED", 409);
      } });
    } catch { return; }
    await lease.release(); entry.status = "closed"; entry.error = null;
    await this.persist(); await fs.unlink(receipt);
  }
  async stop() {
    this.stopping = true;
    await Promise.allSettled([...this.pending.values()]);
    await Promise.all([...this.entries.keys()].map((id) => this.close(id)));
    if ([...this.entries.values()].some((e) => e.status !== "closed")) throw hostError("TERMINAL_RECONCILIATION_REQUIRED", 409);
  }
}
