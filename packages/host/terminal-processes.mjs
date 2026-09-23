import { execFile } from "node:child_process";
import { promisify } from "node:util";

// A cooperative local-terminal tracker, not a sandbox. Snapshot while the
// supervisor still owns the TTY: disowned jobs lose that association on exit.
export async function processTable() {
  const sampling = promisify(execFile)("/bin/ps", ["-A", "-o", "pid=,ppid=,tty=,lstart="], {
    env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2000, maxBuffer: 4 * 1024 * 1024,
  });
  const { stdout } = await sampling;
  const entries = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (match) entries.set(Number(match[1]), { pid: Number(match[1]), parent: Number(match[2]), tty: match[3], start: match[4] });
  }
  entries.delete(sampling.child.pid);
  return entries;
}

export class TerminalProcesses {
  constructor(pid) { this.pid = pid; this.known = new Map(); }
  async scan() {
    return this.observe(await processTable());
  }
  observe(table) {
    const anchor = table.get(this.pid);
    if (!anchor || anchor.tty === "??" || (this.start && this.start !== anchor.start)) throw Error("TERMINAL_TRACKING_LOST");
    this.start ??= anchor.start;
    for (const [pid, start] of this.known) if (table.get(pid)?.start !== start) this.known.delete(pid);
    const descendants = new Set([this.pid]);
    for (const [pid, start] of this.known) if (table.get(pid)?.start === start) descendants.add(pid);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of table.values()) if (!descendants.has(entry.pid) && descendants.has(entry.parent)) {
        descendants.add(entry.pid); changed = true;
      }
    }
    for (const pid of descendants) if (pid !== this.pid && table.has(pid)) this.known.set(pid, table.get(pid).start);
    // Sharing the TTY alone is not proof of ownership. Unknown attachments
    // block a clean receipt; they must never be killed as if they were children.
    this.unknown = [...table.values()].some((entry) => entry.tty === anchor.tty && !descendants.has(entry.pid));
    return [...this.known].filter(([pid, start]) => table.get(pid)?.start === start).map(([pid]) => pid);
  }
  async signal(signal) {
    const alive = await this.scan();
    // Recheck before signalling. Start time survives exec(), unlike comm.
    const current = await processTable();
    for (const pid of alive.reverse()) if (current.get(pid)?.start === this.known.get(pid)) {
      try { process.kill(pid, signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
}
