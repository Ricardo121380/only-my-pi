// Acceptance helper for macOS/Linux ps. Records executable names, never argv or env.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function sampleProcessResources({ hostPid, browserExecutableRoot }) {
  if (!Number.isSafeInteger(hostPid) || hostPid < 1 || !browserExecutableRoot?.startsWith("/")) {
    throw new TypeError("positive Host PID and absolute browser executable root required");
  }
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="], { maxBuffer: 4 * 1024 * 1024 });
  const rows = stdout.trim().split("\n").map((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u);
    if (!match) throw new Error("unrecognized process sample");
    return { pid: Number(match[1]), ppid: Number(match[2]), rssBytes: Number(match[3]) * 1024, executable: match[4] };
  });
  if (!rows.some((row) => row.pid === hostPid)) throw new Error("Host exited before resource sample");
  const ids = new Set([hostPid]);
  let changed;
  do {
    changed = false;
    for (const row of rows) if (ids.has(row.ppid) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; }
  } while (changed);
  const summarize = (processes) => ({ rssBytes: processes.reduce((sum, row) => sum + row.rssBytes, 0), processes });
  return {
    measuredAt: new Date().toISOString(),
    hostTree: summarize(rows.filter((row) => ids.has(row.pid) && row.executable !== "/bin/ps")),
    sharedBrowser: summarize(rows.filter((row) => row.executable.startsWith(browserExecutableRoot.replace(/\/$/u, "") + "/"))),
    scope: "RSS sums may double-count shared pages; browser includes other spaces/tabs, not OMP-exclusive; sampling is not a peak guarantee",
  };
}
