import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { TerminalProcesses } from "./terminal-processes.mjs";

// Kept alive until cleanup finishes, so its TTY still identifies job-control
// process groups. A lost tracker or killed supervisor produces NO clean receipt.
const [receipt, token, shell] = process.argv.slice(2);
const tracker = new TerminalProcesses(process.pid);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let closing, fault = false, scanning = false, scan = Promise.resolve(), timer;
async function stop() {
  if (closing) return closing;
  closing = (async () => {
    clearInterval(timer); await scan;
    try {
      await tracker.signal("SIGTERM");
      let deadline = Date.now() + 1200;
      while ((await tracker.scan()).length && Date.now() < deadline) await pause(40);
      await tracker.signal("SIGKILL");
      deadline = Date.now() + 1200;
      while ((await tracker.scan()).length && Date.now() < deadline) await pause(40);
      if ((await tracker.scan()).length || tracker.unknown || fault) throw Error("TERMINAL_CLEANUP_UNCONFIRMED");
      await fs.writeFile(receipt, JSON.stringify({ token, clean: true }), { flag: "wx", mode: 0o600 });
      process.exit(0);
    } catch { process.exit(1); }
  })();
  return closing;
}
process.on("SIGTERM", () => void stop());
process.on("SIGHUP", () => void stop());
try {
  await tracker.scan();
  // -f avoids executing startup files implicitly. Inherits the Host's explicit
  // terminal environment; no provider credential or Host control token.
  const child = spawn(shell, ["-f"], { stdio: "inherit", env: process.env });
  child.on("error", () => { fault = true; void stop(); });
  child.on("exit", () => void stop());
  await fs.writeFile(receipt + ".ready", JSON.stringify({ token }), { flag: "wx", mode: 0o600 });
  if (closing) await closing;
  timer = setInterval(() => {
    if (scanning || closing) return;
    scanning = true;
    scan = tracker.scan().catch(() => { fault = true; void stop(); }).finally(() => { scanning = false; });
  }, 200);
} catch { fault = true; await stop(); }
