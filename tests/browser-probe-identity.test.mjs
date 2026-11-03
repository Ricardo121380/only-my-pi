import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const kind of ["classification", "images"]) test(`${kind} browser probe reports the actual Pi identity and closes its owned fixture`, { timeout: 45000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-probe-identity-")), output = path.join(root, "evidence"), control = path.join(root, "private-control.json");
  const script = fileURLToPath(new URL(`../scripts/probes/pi110-${kind}-browser.mjs`, import.meta.url));
  const child = spawn(process.execPath, [script, output, control], { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "", closed;
  child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
  const exit = new Promise(resolve => child.once("exit", (code, signal) => { closed = { code, signal }; resolve(closed); }));
  t.after(async () => { try { if (!closed) { child.kill("SIGTERM"); await exit; } } finally { await fs.rm(root, { recursive: true, force: true }); } });
  let ready;
  for (let i = 0; i < 1500 && !ready && !closed; i++) {
    ready = stdout.split("\n").filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).find(value => value?.ready);
    if (!ready) await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(ready, stderr); assert.equal(ready.pi, "1.3.0");
  child.kill("SIGTERM"); await exit; assert.equal(closed.code, 0, stderr);
  const name = kind === "images" ? "browser-image-final-receipt.json" : "browser-final-receipt.json";
  const receipt = JSON.parse(await fs.readFile(path.join(output, name), "utf8"));
  assert.equal(receipt.pi, ready.pi); assert.equal(receipt.receivedCount, 0);
  await assert.rejects(fs.access(control), { code: "ENOENT" });
  await assert.rejects(fs.access(path.dirname(ready.project)), { code: "ENOENT" });
});
