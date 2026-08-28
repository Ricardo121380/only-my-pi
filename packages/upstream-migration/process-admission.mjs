import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

const MAX_PS_OUTPUT = 2 * 1024 * 1024;

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function boundedExec(command, argv, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, argv, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" } });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    child.on("error", reject);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_PS_OUTPUT) { child.kill("SIGTERM"); return; }
      chunks.push(chunk);
    });
    child.on("close", (code, signal) => {
      if (bytes > MAX_PS_OUTPUT) return reject(Object.assign(new Error("process listing exceeded output limit"), { code: "PI_PROCESS_LIST_TOO_LARGE" }));
      if (code !== 0) return reject(Object.assign(new Error(`process listing failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 256)}`), { code: "PI_PROCESS_LIST_FAILED", signal }));
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
  });
}

function parsePs(text) {
  const processes = [];
  const pattern = /^\s*(\d+)\s+(\d+)\s+(\w{3})\s+(\w{3})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\s+(.+)$/u;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const match = pattern.exec(line);
    if (!match) fail("PI_PROCESS_LIST_INVALID", "process listing contained an unrecognized record");
    processes.push({
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      startedAt: `${match[3]} ${match[4]} ${match[5].padStart(2, "0")} ${match[6]} ${match[7]}`,
      commandLine: match[8],
    });
  }
  return processes;
}

export function createNodeProcessAdapter({ spawnImpl = spawn, killImpl = process.kill } = {}) {
  return Object.freeze({
    async list() { return parsePs(await boundedExec("ps", ["-axo", "pid=,ppid=,lstart=,command="], { spawnImpl })); },
    async signal(pid, signal) { killImpl(pid, signal); },
    async alive(pid) {
      try { killImpl(pid, 0); return true; } catch (error) { if (error?.code === "ESRCH") return false; throw error; }
    },
    async wait(milliseconds) { await new Promise((resolve) => setTimeout(resolve, milliseconds)); },
  });
}

function executableToken(commandLine) {
  const trimmed = commandLine.trim();
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const end = trimmed.indexOf(quote, 1);
    return end > 1 ? trimmed.slice(1, end) : trimmed;
  }
  return trimmed.split(/\s+/u)[0];
}

function classify(processEntry, { piPackageRoot, piBinPath }) {
  const commandLine = processEntry.commandLine ?? "";
  const executable = executableToken(commandLine);
  const isPi = executable === piBinPath
    || path.basename(executable) === "pi"
    || commandLine.includes(`${piPackageRoot}${path.sep}`)
    || commandLine.includes("@earendil-works/pi-coding-agent/dist/cli.js");
  if (!isPi) return null;
  const executableClass = executable === piBinPath || path.basename(executable) === "pi" ? "PI_PARENT" : "PI_CHILD";
  const commandDigest = digest(commandLine);
  const identityDigest = digest(`${processEntry.pid}\0${processEntry.startedAt}\0${executable}\0${commandDigest}`);
  return Object.freeze({
    pid: processEntry.pid,
    parentPid: processEntry.parentPid,
    startedAt: processEntry.startedAt,
    executableClass,
    commandDigest,
    identityDigest,
  });
}

export class PiProcessAdmission {
  constructor({ piPackageRoot, piBinPath, adapter, timeoutMs = 15_000, pollMs = 100 } = {}) {
    if (typeof piPackageRoot !== "string" || !path.isAbsolute(piPackageRoot) || typeof piBinPath !== "string" || !path.isAbsolute(piBinPath)) throw new TypeError("Pi process admission paths must be absolute");
    this.piPackageRoot = path.resolve(piPackageRoot);
    this.piBinPath = path.resolve(piBinPath);
    this.adapter = adapter ?? createNodeProcessAdapter();
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
  }

  async plan() {
    const processes = (await this.adapter.list())
      .map((entry) => classify(entry, this))
      .filter(Boolean)
      .sort((left, right) => left.pid - right.pid);
    const ids = new Set(processes.map((entry) => entry.pid));
    return Object.freeze(processes.map((entry) => Object.freeze({ ...entry, childOfDetectedPi: ids.has(entry.parentPid) })));
  }

  async terminate(reviewedProcesses, { authorized = false } = {}) {
    if (!Array.isArray(reviewedProcesses)) throw new TypeError("reviewed Pi processes must be an array");
    const current = await this.plan();
    if (current.length === 0) return Object.freeze({ status: "PI_ALREADY_STOPPED", terminated: [] });
    if (!authorized) fail("PI_PROCESSES_REQUIRE_TERMINATION_AUTHORITY", "running Pi processes require explicit --terminate-pi authority", { processes: current });
    const reviewed = new Map(reviewedProcesses.map((entry) => [entry.pid, entry]));
    for (const entry of current) {
      if (reviewed.get(entry.pid)?.identityDigest !== entry.identityDigest) fail("PI_PROCESS_IDENTITY_CHANGED", "Pi process identity changed after plan; PID reuse or a new runtime was detected", { pid: entry.pid });
    }
    if (current.length !== reviewed.size) fail("PI_PROCESS_SET_CHANGED", "Pi process set changed after plan");
    for (const entry of current) await this.adapter.signal(entry.pid, "SIGTERM");
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const alive = [];
      for (const entry of current) if (await this.adapter.alive(entry.pid)) alive.push(entry.pid);
      if (alive.length === 0) return Object.freeze({ status: "PI_PROCESSES_STOPPED", terminated: current.map((entry) => entry.pid), signal: "SIGTERM", forceKill: false });
      await this.adapter.wait(this.pollMs);
    }
    const remaining = [];
    for (const entry of current) if (await this.adapter.alive(entry.pid)) remaining.push(entry.pid);
    fail("PI_TERMINATION_TIMEOUT", "Pi process did not exit after bounded SIGTERM; migration stopped without SIGKILL", { remaining, signal: "SIGTERM", forceKill: false });
  }
}

export function createPiProcessAdmission(options) {
  return new PiProcessAdmission(options);
}
