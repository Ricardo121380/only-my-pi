import path from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, readJsonObject, withConfigLock } from "../config-runtime/index.mjs";
import { processIdentity, groupAlive } from "../host/ownership.mjs";
import { mcpError, MCP_LIMITS } from "./catalog.mjs";

export class McpRuns {
  constructor(configRoot) { this.root = configRoot; this.file = path.join(configRoot, "only-my-pi/mcp/runs.json"); }
  lockOptions() { return { lockDirectory: path.join(this.root, "only-my-pi/locks/mcp-runs.lock") }; }
  async write(state) {
    if (Buffer.byteLength(JSON.stringify(state)) > MCP_LIMITS.storageBytes) throw mcpError("MCP_STORAGE_LIMIT", 409);
    await atomicWriteJson(this.root, this.file, state);
  }
  async read() {
    const state = await readJsonObject(this.root, this.file).catch((error) => { if (error.code === "ENOENT") return { version: 1, runs: [] }; throw error; });
    if (state.version !== 1 || !Array.isArray(state.runs) || state.runs.length > 100) throw mcpError("MCP_RUN_STATE_INVALID", 409);
    return state;
  }
  async status(projectPath) {
    const { runs } = await this.read();
    return { protocol: 1, runs: await Promise.all(runs.filter((run) => !projectPath || run.projectPath === projectPath).map(async (run) => {
      const orphan = run.status !== "stopped" && run.ownerIdentity !== await processIdentity(run.ownerPid);
      return { ...run, status: orphan ? "reconciliation" : run.status,
        discoveries: run.discoveries?.map((entry) => ({ ...entry, live: !orphan && run.status === "running", status: orphan && entry.status === "ready" ? "stale" : entry.status })),
        calls: run.calls.map((call) => orphan && call.status === "dispatched" ? { ...call, status: "unknown", ...(call.effect === "write" ? { application: "unknown" } : {}) } : call),
        processes: run.processes.map((entry) => ({ ...entry, status: orphan && entry.status !== "stopped" ? "reconciliation" : entry.status, alive: Boolean(entry.pid && groupAlive(entry.pid)) })) };
    })) };
  }
  async begin({ taskId, projectPath, revision }) {
    const run = { runId: randomUUID(), taskId, projectPath, revision, ownerPid: process.pid, ownerIdentity: await processIdentity(), processes: [], calls: [], startedAt: new Date().toISOString(), status: "running" };
    await withConfigLock(this.root, this.lockOptions(), async () => {
      const state = await this.read();
      if (state.runs.length >= 100) throw mcpError("MCP_RUN_CAPACITY", 409);
      for (const prior of state.runs) {
        if (prior.projectPath !== projectPath || prior.status === "stopped") continue;
        if (prior.ownerIdentity !== await processIdentity(prior.ownerPid) || prior.processes.some((entry) => entry.status === "reconciliation")) throw mcpError("MCP_PROCESS_RECONCILIATION_REQUIRED", 409);
      }
      state.runs.push(run); await this.write(state);
    });
    return run;
  }
  async save(run) {
    await withConfigLock(this.root, this.lockOptions(), async () => {
      const state = await this.read(), index = state.runs.findIndex((entry) => entry.runId === run.runId);
      if (index === -1) throw mcpError("MCP_RUN_NOT_FOUND", 409);
      state.runs[index] = structuredClone(run); await this.write(state);
    });
  }
}
