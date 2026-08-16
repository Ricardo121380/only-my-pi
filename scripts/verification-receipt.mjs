#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  releaseGatesDigest,
  validateReleaseGateIdSet,
  validateReleaseGatesManifest,
} from "./lib/release-gates.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(HERE, "..");
export const receiptsRoot = path.join(repositoryRoot, "verification", "receipts");
export const FRESH_EVIDENCE_PREFIX = "OMP_FRESH_TARBALL_EVIDENCE=";
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SHA512_SRI = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const RECEIPT_TOP_LEVEL_KEYS = new Set([
  "schemaVersion", "kind", "status", "sourceCommit", "manifest", "startedAt", "completedAt",
  "passed", "gates", "evidence", "privacy", "authorization",
]);
const GATE_KEYS = new Set([
  "id", "status", "exitCode", "signal", "timedOut", "outputLimitExceeded", "expectationPassed",
  "durationMs", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "evidence",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, allowed, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function safeOutputPath(requested, rootDir = repositoryRoot) {
  const base = path.join(rootDir, "verification", "receipts");
  const target = requested
    ? path.resolve(rootDir, requested)
    : path.join(base, `${new Date().toISOString().replace(/[:.]/gu, "-")}-harness-mvp.json`);
  const relative = path.relative(base, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !target.endsWith(".json")) {
    throw new Error("receipt output must be a JSON file inside verification/receipts");
  }
  return target;
}

function gateEnvironment(gate, inherited = process.env) {
  const output = {};
  for (const key of [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SYSTEMROOT", "COMSPEC", "PATHEXT",
    "APPDATA", "LOCALAPPDATA",
  ]) {
    if (typeof inherited[key] === "string") output[key] = inherited[key];
  }
  Object.assign(output, gate.env, {
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  });
  return output;
}

function killChild(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to the direct child when the process group is gone.
    }
  }
  child.kill?.(signal);
}

function extractFreshEvidence(stdout) {
  const lines = stdout.split(/\r?\n/u).filter((line) => line.startsWith(FRESH_EVIDENCE_PREFIX));
  if (lines.length !== 1) return null;
  let value;
  try {
    value = JSON.parse(lines[0].slice(FRESH_EVIDENCE_PREFIX.length));
  } catch {
    return null;
  }
  const safe = value
    && value.formatVersion === 1
    && value.status === "PASS"
    && FULL_SHA.test(value.sourceCommit ?? "")
    && typeof value.nodeVersion === "string"
    && value.piVersion === "0.84.1"
    && SHA256.test(`sha256:${value.tarball?.sha256 ?? ""}`)
    && SHA512_SRI.test(value.tarball?.integrity ?? "")
    && value.install?.scripts === "disabled"
    && value.install?.offline === true
    && value.install?.global === false
    && value.install?.checkoutRuntime === false
    && value.bootstrap?.dryRun === "PLAN_READY_ZERO_WRITE"
    && value.bootstrap?.firstApply === "COMMITTED"
    && ["NO_CHANGES", "REPAIRED_NO_CHANGES"].includes(value.bootstrap?.secondApply)
    && value.bootstrap?.doctor === "PASS"
    && value.bootstrap?.safe === "PASS"
    && value.bootstrap?.rollback === "COMMITTED"
    && value.bootstrap?.finalStatus === "NOT_INSTALLED"
    && value.bootstrap?.piNoModelStartup === "NO_MODEL_STARTUP_PASS"
    && value.provider === "NOT_RUN_BY_POLICY"
    && value.credentials === "NOT_READ"
    && value.realPiHome === "NOT_TOUCHED";
  return safe ? value : null;
}

export function runCheck(check, {
  cwd = repositoryRoot,
  maxOutputBytes = check?.maxOutputBytes ?? 2 * 1024 * 1024,
  env = process.env,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputLimitExceeded = false;
    let settled = false;
    let child;
    let timer = null;

    const finish = ({ code = null, signal = null, spawnError = false } = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      const freshEvidence = check.id === "test-e2e" ? extractFreshEvidence(out.toString("utf8")) : undefined;
      const emptyOutputPassed = check.expectStdout === "empty" ? out.toString("utf8").trim().length === 0 : true;
      const expectationPassed = emptyOutputPassed && (check.id !== "test-e2e" || freshEvidence !== null);
      const passed = code === 0 && !spawnError && !timedOut && !outputLimitExceeded && expectationPassed;
      resolve(Object.freeze({
        id: check.id,
        status: passed ? "PASS" : "FAIL",
        passed,
        exitCode: code,
        signal,
        timedOut,
        outputLimitExceeded,
        expectationPassed,
        durationMs: Math.max(0, Date.now() - started),
        stdoutBytes,
        stderrBytes,
        stdoutSha256: sha256(out),
        stderrSha256: sha256(err),
        ...(freshEvidence === undefined ? {} : { evidence: freshEvidence }),
      }));
    };

    const capture = (target, chunk, type) => {
      const bytes = Buffer.from(chunk);
      if (type === "stdout") stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes + stderrBytes <= maxOutputBytes) target.push(bytes);
      else if (!outputLimitExceeded) {
        outputLimitExceeded = true;
        killChild(child, "SIGTERM");
      }
    };

    try {
      child = spawnImpl(check.command, check.args, {
        cwd,
        env: gateEnvironment(check, env),
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: process.platform !== "win32" && spawnImpl === spawn,
      });
    } catch {
      finish({ spawnError: true });
      return;
    }
    child.stdout?.on("data", (chunk) => capture(stdout, chunk, "stdout"));
    child.stderr?.on("data", (chunk) => capture(stderr, chunk, "stderr"));
    child.once?.("error", () => finish({ spawnError: true }));
    child.once?.("close", (code, signal) => finish({ code, signal }));

    timer = setTimeout(() => {
      timedOut = true;
      killChild(child, "SIGTERM");
      setTimeout(() => {
        if (!settled) killChild(child, "SIGKILL");
      }, 2000).unref?.();
    }, check.timeoutMs);
    timer.unref?.();
  });
}

function git(rootDir, args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
}

function assertCleanSource(rootDir) {
  const status = git(rootDir, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status !== "") throw new Error("release verification requires a completely clean source commit");
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  if (!FULL_SHA.test(head)) throw new Error("cannot resolve a full source commit SHA");
  return head;
}

function publicGateResult(result) {
  return {
    id: result.id,
    status: result.status,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputLimitExceeded: result.outputLimitExceeded,
    expectationPassed: result.expectationPassed,
    durationMs: result.durationMs,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutSha256: `sha256:${result.stdoutSha256}`,
    stderrSha256: `sha256:${result.stderrSha256}`,
    ...(result.evidence === undefined ? {} : { evidence: result.evidence }),
  };
}

export async function runReleaseVerification({
  manifest,
  rootDir = repositoryRoot,
  output,
  env = process.env,
  spawnImpl = spawn,
  onGate = () => {},
} = {}) {
  const validated = validateReleaseGatesManifest(manifest);
  const resolvedRoot = fs.realpathSync(path.resolve(rootDir));
  const target = safeOutputPath(output, resolvedRoot);
  if (fs.existsSync(target)) throw new Error("receipt output already exists");
  const sourceCommit = assertCleanSource(resolvedRoot);
  const manifestDigest = releaseGatesDigest(validated);
  const startedAt = new Date().toISOString();
  const gates = [];
  for (const gate of validated.gates) {
    let result = await runCheck(gate, {
      cwd: resolvedRoot,
      maxOutputBytes: Math.min(gate.maxOutputBytes, validated.policy.maxOutputBytes),
      env,
      spawnImpl,
    });
    if (gate.id === "test-e2e" && result.evidence?.sourceCommit !== sourceCommit) {
      result = Object.freeze({ ...result, status: "FAIL", expectationPassed: false });
    }
    gates.push(publicGateResult(result));
    onGate(result);
  }
  const postGateCommit = assertCleanSource(resolvedRoot);
  if (postGateCommit !== sourceCommit) throw new Error("source commit changed while release gates were running");
  const passed = gates.every((gate) => gate.status === "PASS");
  const receipt = {
    schemaVersion: 2,
    kind: "only-my-pi-release-receipt",
    status: passed ? "COMPLETE" : "FAILED",
    sourceCommit,
    manifest: {
      id: validated.id,
      digest: manifestDigest,
      gateIds: validated.gates.map((gate) => gate.id),
    },
    startedAt,
    completedAt: new Date().toISOString(),
    passed,
    gates,
    evidence: {
      freshTarball: gates.find((gate) => gate.id === "test-e2e")?.evidence ?? null,
      compatibility: {
        node: process.version,
        pi: "0.84.1",
        platform: process.platform,
        arch: process.arch,
      },
    },
    privacy: {
      rawOutputStored: false,
      hostPathsStored: false,
      credentialsRead: false,
      outputFingerprintsMayLeakShortPredictableValues: true,
      intendedForSensitiveOutput: false,
    },
    authorization: {
      providerRequests: "NOT_RUN_BY_POLICY",
      liveChildDispatch: "NOT_RUN_BY_POLICY",
      realPiHome: "NOT_TOUCHED",
      publish: "NOT_AUTHORIZED",
      tag: "NOT_AUTHORIZED",
      release: "NOT_AUTHORIZED",
      pullRequest: "NOT_AUTHORIZED",
    },
  };
  validateReleaseReceipt(receipt, validated, { expectedSourceCommit: sourceCommit });
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  return Object.freeze({ receipt: Object.freeze(receipt), target });
}

function validateFreshEvidence(value, sourceCommit) {
  if (extractFreshEvidence(`${FRESH_EVIDENCE_PREFIX}${JSON.stringify(value)}\n`) === null) {
    throw new Error("release receipt fresh-tarball evidence is invalid");
  }
  if (value.sourceCommit !== sourceCommit) throw new Error("fresh-tarball evidence source commit mismatch");
}

function forbiddenReceiptShape(value, pointer = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => forbiddenReceiptShape(entry, `${pointer}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(?:stdout|stderr|rawOutput|cwd|home|hostPath|stateHash|receiptHash)$/iu.test(key)) {
      throw new Error(`release receipt contains forbidden field ${pointer}.${key}`);
    }
    forbiddenReceiptShape(entry, `${pointer}.${key}`);
  }
}

export function validateReleaseReceipt(receipt, manifest, { expectedSourceCommit } = {}) {
  const validated = validateReleaseGatesManifest(manifest);
  exactKeys(receipt, RECEIPT_TOP_LEVEL_KEYS, "release receipt");
  if (receipt.schemaVersion !== 2 || receipt.kind !== "only-my-pi-release-receipt") throw new Error("unsupported release receipt format");
  if (!FULL_SHA.test(receipt.sourceCommit ?? "")) throw new Error("release receipt sourceCommit is invalid");
  if (expectedSourceCommit !== undefined && receipt.sourceCommit !== expectedSourceCommit) throw new Error("release receipt sourceCommit mismatch");
  if (!receipt.manifest || receipt.manifest.id !== validated.id || receipt.manifest.digest !== releaseGatesDigest(validated)) {
    throw new Error("release receipt manifest identity/digest mismatch");
  }
  validateReleaseGateIdSet(receipt.manifest.gateIds);
  const expectedIds = validated.gates.map((gate) => gate.id);
  if (JSON.stringify(receipt.manifest.gateIds) !== JSON.stringify(expectedIds)) throw new Error("release receipt gate order mismatch");
  if (!Array.isArray(receipt.gates) || receipt.gates.length !== expectedIds.length) throw new Error("release receipt gate results are incomplete");
  receipt.gates.forEach((gate, index) => {
    exactKeys(gate, GATE_KEYS, `release receipt gate ${index}`);
    if (gate.id !== expectedIds[index]) throw new Error("release receipt gate result order mismatch");
    if (!new Set(["PASS", "FAIL"]).has(gate.status)) throw new Error(`release receipt gate ${gate.id} has an invalid status`);
    if (!SHA256.test(gate.stdoutSha256 ?? "") || !SHA256.test(gate.stderrSha256 ?? "")) throw new Error(`release receipt gate ${gate.id} output digest is invalid`);
    for (const field of ["durationMs", "stdoutBytes", "stderrBytes"]) {
      if (!Number.isSafeInteger(gate[field]) || gate[field] < 0) throw new Error(`release receipt gate ${gate.id} ${field} is invalid`);
    }
  });
  const allPassed = receipt.gates.every((gate) => gate.status === "PASS");
  if (receipt.passed !== allPassed || receipt.status !== (allPassed ? "COMPLETE" : "FAILED")) {
    throw new Error("release receipt aggregate status is inconsistent");
  }
  if (!Number.isFinite(Date.parse(receipt.startedAt)) || !Number.isFinite(Date.parse(receipt.completedAt))) throw new Error("release receipt timestamps are invalid");
  if (Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt)) throw new Error("release receipt completedAt precedes startedAt");
  validateFreshEvidence(receipt.evidence?.freshTarball, receipt.sourceCommit);
  if (receipt.evidence?.compatibility?.pi !== "0.84.1") throw new Error("release receipt Pi compatibility evidence is invalid");
  if (receipt.privacy?.rawOutputStored !== false || receipt.privacy?.hostPathsStored !== false || receipt.privacy?.credentialsRead !== false) {
    throw new Error("release receipt privacy boundary is invalid");
  }
  if (receipt.authorization?.providerRequests !== "NOT_RUN_BY_POLICY" || receipt.authorization?.publish !== "NOT_AUTHORIZED") {
    throw new Error("release receipt authorization boundary is invalid");
  }
  forbiddenReceiptShape(receipt);
  const serialized = JSON.stringify(receipt);
  if (/\/Users\/[^/\s]+\//u.test(serialized) || /\/home\/[^/\s]+\//u.test(serialized) || /[A-Za-z]:\\Users\\/u.test(serialized)) {
    throw new Error("release receipt contains a host home path");
  }
  return Object.freeze({ ok: true, status: receipt.status, sourceCommit: receipt.sourceCommit, manifestDigest: receipt.manifest.digest });
}

export function defaultReceiptPath() {
  return path.join(receiptsRoot, "2026-08-16-harness-mvp.json");
}

// Library-only: scripts/release-gates.mjs is the sole public runner, so callers
// cannot replace the versioned release gate set with an alternate suite.
