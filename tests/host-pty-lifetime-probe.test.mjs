// A negative design probe, NOT terminal acceptance: root exit does not prove
// descendant cleanup. Only creates a bounded sleep; all owned PIDs are reaped.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import pty from "node-pty";
import { processIdentity } from "../packages/host/ownership.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { const value = await probe(); if (value) return value; await delay(20); }
  throw Error("PTY_PROBE_TIMEOUT");
}

test("darwin PTY root exit leaves a disowned background job alive", { skip: process.platform !== "darwin", timeout: 15000 }, async (t) => {
  const shell = pty.spawn("/bin/zsh", ["-f"], {
    name: "xterm-256color", cols: 100, rows: 24, cwd: process.cwd(),
    env: { PATH: "/usr/bin:/bin", HOME: process.cwd(), LC_ALL: "C" },
  });
  let output = "", exited = false, child, identity;
  shell.onData((data) => { output = (output + data).slice(-8192); });
  shell.onExit(() => { exited = true; });
  t.after(async () => {
    if (!exited) shell.kill("SIGKILL");
    if (child && identity && await processIdentity(child) === identity) process.kill(child, "SIGKILL");
    await until(() => exited);
    if (child && identity) await until(async () => await processIdentity(child) !== identity);
  });
  shell.write('/bin/sleep 30 & child=$!; disown; print -r -- "OMP_CHILD:$child"\r');
  child = Number(await until(() => /OMP_CHILD:(\d+)/.exec(output)?.[1]));
  identity = await processIdentity(child);
  assert.ok(identity);
  const { stdout } = await promisify(execFile)("/bin/ps", ["-p", String(child), "-o", "pgid="], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
  assert.notEqual(Number(stdout.trim()), shell.pid, "job control uses a different process group");
  shell.kill("SIGKILL");
  await until(() => exited);
  assert.equal(await processIdentity(child), identity, "PTY onExit must not release the writer lease");
  t.diagnostic("Counterexample reproduced; cleanup kills only the identity-checked test sleep.");
});
