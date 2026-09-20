#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createStackLayout, createStackTransactionEngine, createStackHarnessAdapter, planStackEnvironment, createStackService } from "../packages/release-stack/index.mjs";
import { validateStackManifest } from "../packages/release-stack/contracts.mjs";

const [payload, outputParent] = process.argv.slice(2);
if (![payload, outputParent].every((p) => typeof p === "string" && path.isAbsolute(p))) throw new Error("provide absolute Full payload and evidence parent paths");
const home = await fs.mkdtemp(path.join(outputParent, "isolated-install-"));
const layout = createStackLayout({ homeDir: home });
const stack = validateStackManifest(JSON.parse(await fs.readFile(path.join(payload, "stack-manifest.json"), "utf8")));
const env = { HOME: home, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: layout.configRoot };
const platform = { os: process.platform, arch: process.arch, minimumMacOSSatisfied: process.platform === "darwin", rosetta: false };
const evidence = { sourceCommit: stack.sourceCommit, stackId: stack.stackId, home, status: "NOT_RUN", modelRequests: 0, steps: [] };
console.log(JSON.stringify({ home, stackId: stack.stackId }));
async function version() {
  const { stdout } = await promisify(execFile)(layout.ompShim, ["admin", "version", "--json"], { env, cwd: home, timeout: 30_000, maxBuffer: 128 * 1024 });
  const result = JSON.parse(stdout);
  assert.equal(result.piVersion, "0.85.1");
  assert.equal(result.nodeVersion, "24.19.0");
  assert.equal(result.distributionId, stack.stackId);
  return result;
}
async function rpc() {
  return new Promise((resolve, reject) => {
    const child = spawn(layout.ompShim, ["--mode", "rpc", "--model", "openai/gpt-4o", "--no-session"], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
    const seen = new Set();
    let buffer = "", stderr = "", failure = null;
    const timeout = setTimeout(() => { failure = new Error("controlled RPC timed out"); child.kill("SIGKILL"); }, 30_000);
    child.stderr.on("data", (b) => { stderr = (stderr + b).slice(-8192); });
    child.stdout.on("data", (b) => {
      buffer += b;
      if (buffer.length > 1024 * 1024) { failure = new Error("RPC output exceeded bound"); child.kill("SIGKILL"); return; }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let message; try { message = JSON.parse(line); } catch { failure = new Error("non JSONL stdout"); continue; }
        if (message.type === "extension_error") failure = new Error("controlled extension failed");
        if (message.type === "response" && ["get_state", "abort"].includes(message.command)) {
          if (message.success !== true) failure = new Error(`RPC ${message.command} rejected`);
          else seen.add(message.command);
          if (seen.size === 2) child.stdin.end();
        }
      }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (failure || seen.size !== 2 || code !== 0 || /failed to load extension|error loading extension/iu.test(stderr)) reject(Object.assign(failure ?? new Error("controlled RPC failed"), { stderr, code }));
      else resolve({ commands: [...seen], code });
    });
    child.stdin.on("error", () => {});
    for (const type of ["get_state", "abort"]) child.stdin.write(JSON.stringify({ id: type, type }) + "\n");
  });
}
const harness = createStackHarnessAdapter({ rootDir: process.cwd(), configRoot: layout.configRoot });
const engine = createStackTransactionEngine({ layout, harness, processAdmission: { async plan() { return []; } },
  doctor: async () => ({ ok: (await version()).ok }), smoke: async () => { await rpc(); return { ok: true }; } });
try {
  const plan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "full", platform, pathValue: layout.binRoot });
  const first = await engine.apply({ plan, stackManifest: stack, resolvedRoot: payload });
  evidence.steps.push({ operation: "install", status: first.status, version: await version(), rpc: await rpc() });
  const service = createStackService({ layout, localSource: {}, releaseSource: {}, engine });
  assert.equal((await service.status()).status, "INSTALLED");
  await engine.rollbackCommitted([first.transactionId]);
  assert.equal(await fs.lstat(layout.currentStack).then(() => true, () => false), false);
  assert.equal(await fs.lstat(layout.npmRoot).then(() => true, () => false), false);
  evidence.steps.push({ operation: "rollback", status: "PASS" });
  const secondPlan = await planStackEnvironment({ layout, stackManifest: stack, payloadMode: "full", platform, pathValue: layout.binRoot });
  const second = await engine.apply({ plan: secondPlan, stackManifest: stack, resolvedRoot: payload });
  evidence.steps.push({ operation: "reapply", status: second.status, version: await version() });
  evidence.status = "PASS";
} catch (error) {
  evidence.status = "FAIL";
  evidence.error = { code: error.code, message: error.message, stderr: error.stderr };
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(home, "rehearsal.json"), JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence));
}
