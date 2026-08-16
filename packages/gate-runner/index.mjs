import { createHash } from "node:crypto";
import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadReleaseGatesManifest, RELEASE_GATE_COMMANDS, resolveReleaseGate } from "../../scripts/lib/release-gates.mjs";

const SAFE_ENV = Object.freeze({ CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0", npm_config_audit: "false", npm_config_fund: "false", npm_config_offline: "true" });
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export class GateRunnerError extends Error {
  constructor(message, code = "GATE_RUNNER_ERROR", details = {}) {
    super(`gate-runner: ${message}`);
    this.name = "GateRunnerError";
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) { throw new GateRunnerError(message, code, details); }
function digest(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function embeddedManifest() {
  return Object.freeze({
    formatVersion: 1,
    id: "release-gates-v1",
    description: "Embedded fixed gate contract for a packaged only-my-pi generation.",
    policy: { cwd: "repository-root", network: "deny", shell: false, maxGateCount: 32, maxOutputBytes: 2_097_152 },
    gates: Object.entries(RELEASE_GATE_COMMANDS).map(([id, tuple]) => ({
      id,
      description: `Embedded fixed gate ${id}.`,
      command: tuple.command,
      args: [...tuple.args],
      cwd: "repository-root",
      env: { CI: "1", NO_COLOR: "1", PI_TELEMETRY: "0" },
      timeoutMs: id === "diff-check" ? 30_000 : id === "full-tests" ? 300_000 : 120_000,
      maxOutputBytes: id === "diff-check" ? 262_144 : 2_097_152,
      sensitiveOutput: false,
      required: true,
    })),
  });
}

function normalizeManifest(rootDir, manifestPath) {
  const file = path.resolve(manifestPath ?? path.join(rootDir, "verification", "release-gates-v1.json"));
  if (!isInside(path.join(rootDir, "verification"), file)) fail("release gate manifest escapes verification root", "MANIFEST_PATH_ESCAPE");
  if (!fs.existsSync(file)) {
    // A packed generation intentionally excludes verification/fixtures.  The
    // command tuples are compiled from the same versioned source module, so a
    // missing source manifest can still be represented without opening an
    // arbitrary path.  Explicit manifest paths remain fail-closed.
    if (manifestPath) fail("release gate manifest is missing", "MANIFEST_UNAVAILABLE");
    return embeddedManifest();
  }
  return loadReleaseGatesManifest(file, { allowedRoot: path.join(rootDir, "verification") });
}

function normalizeOutput(chunk) {
  if (chunk === undefined || chunk === null) return Buffer.alloc(0);
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
}

function waitForProcess(process, { timeoutMs, maxOutputBytes, signal, clock = globalThis } = {}) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    let total = 0;
    let settled = false;
    let timer = null;
    const finish = (result, error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener?.("abort", abort);
      if (error) reject(error); else resolve(result);
    };
    const append = (target, chunk) => {
      const bytes = normalizeOutput(chunk);
      total += bytes.length;
      if (total > maxOutputBytes) {
        try { process.kill?.("SIGTERM"); } catch {}
        finish(null, new GateRunnerError("gate output exceeded the byte bound", "OUTPUT_LIMIT", { maxOutputBytes }));
        return;
      }
      target.push(bytes);
    };
    const abort = () => {
      try { process.kill?.("SIGTERM"); } catch {}
      finish(null, new GateRunnerError("gate was cancelled", "CANCELLED"));
    };
    process.stdout?.on?.("data", (chunk) => append(stdout, chunk));
    process.stderr?.on?.("data", (chunk) => append(stderr, chunk));
    process.once?.("error", (error) => finish(null, new GateRunnerError(error.message, "SPAWN_ERROR", { cause: error })));
    process.once?.("close", (code, signalName) => {
      const out = Buffer.concat([...stdout, ...stderr]);
      finish({ exitCode: Number.isInteger(code) ? code : null, signal: signalName ?? null, outputBytes: out.length, outputDigest: digest(out), output: out }, null);
    });
    if (signal?.aborted) return abort();
    signal?.addEventListener?.("abort", abort, { once: true });
    timer = (clock.setTimeout ?? setTimeout)(() => {
      try { process.kill?.("SIGTERM"); } catch {}
      finish(null, new GateRunnerError("gate timed out", "TIMED_OUT", { timeoutMs }));
    }, timeoutMs);
  });
}

export class DeterministicGateRunner {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.manifestPath = options.manifestPath ?? null;
    this.manifest = normalizeManifest(this.rootDir, this.manifestPath);
    this.spawnImpl = options.spawnImpl ?? nodeSpawn;
    this.baseEnv = options.env ?? process.env;
    this.clock = options.clock ?? globalThis;
    this.maxOutputBytes = options.maxOutputBytes ?? this.manifest.policy.maxOutputBytes;
  }

  plan(gateId) {
    const gate = resolveReleaseGate(this.manifest, gateId);
    return Object.freeze({
      gateId: gate.id,
      command: gate.command,
      args: [...gate.args],
      cwd: this.rootDir,
      env: { ...SAFE_ENV },
      timeoutMs: gate.timeoutMs,
      maxOutputBytes: gate.maxOutputBytes,
      shell: false,
      network: "deny-by-contract",
    });
  }

  async run(gateId, { signal, dryRun = false } = {}) {
    const plan = this.plan(gateId);
    const started = Date.now();
    if (dryRun) return Object.freeze({ status: "PLANNED", ...plan, receiptDigest: digest(JSON.stringify(plan)) });
    const env = { ...this.baseEnv, ...SAFE_ENV };
    const child = this.spawnImpl(plan.command, [...plan.args], { cwd: plan.cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const result = await waitForProcess(child, { timeoutMs: plan.timeoutMs, maxOutputBytes: Math.min(plan.maxOutputBytes, this.maxOutputBytes), signal, clock: this.clock });
    const status = result.exitCode === 0 ? "PASS" : "FAIL";
    return Object.freeze({ status, gateId: plan.gateId, exitCode: result.exitCode, signal: result.signal, durationMs: Math.max(0, Date.now() - started), outputBytes: result.outputBytes, outputDigest: result.outputDigest, shell: false, network: "deny-by-contract" });
  }

  async runMany(gateIds, options = {}) {
    if (!Array.isArray(gateIds) || new Set(gateIds).size !== gateIds.length) fail("gateIds must be a unique array", "INVALID_GATE_SET");
    const receipts = [];
    for (const gateId of gateIds) {
      const receipt = await this.run(gateId, options);
      receipts.push(receipt);
      if (receipt.status !== "PASS") break;
    }
    return Object.freeze(receipts);
  }
}

export function createGateRunner(options = {}) { return new DeterministicGateRunner(options); }
export { SHA256 };
