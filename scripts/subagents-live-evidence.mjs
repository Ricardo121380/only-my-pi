#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  captureProtectedLiveEvidenceSet,
  createExternalDigestSigner,
  createProtectedLiveEvidenceCapturePlan,
  writeProtectedLiveEvidenceStaging,
} from "../packages/subagents/release/live-evidence-capture.mjs";
import {
  loadLiveEvidenceAuthorization,
} from "../packages/subagents/release/live-evidence-authorization.mjs";
import {
  createPiProtectedLiveScenarioRunner,
} from "../packages/subagents/release/live-evidence-pi-runner.mjs";
import {
  loadSubagentsReleaseContracts,
} from "../packages/subagents/release/compatibility.mjs";
import {
  loadProtectedEvidenceTrustPolicy,
} from "../packages/subagents/release/protected-evidence.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;

const HELP = `Usage:
  node scripts/subagents-live-evidence.mjs [--plan] [--authorization-file /absolute/file] [--json]

  node scripts/subagents-live-evidence.mjs --run --yes \\
    --authorization-file /absolute/operator-authorization.json \\
    --config-root /absolute/disposable/root \\
    --package-root /absolute/pi-subagents/package \\
    --pi-command /absolute/pi \\
    --signer-command /absolute/external-signer \\
    --output-dir /absolute/empty/staging/directory \\
    [--repository-root /absolute/only-my-pi] [--json]

Default behavior is an inert plan. Live execution requires a clean exact source
commit, a runtime-ready checked-in trust policy, an active bounded operator
authorization, explicit disposable/config/package/output paths, an external
digest-only signer, and --yes. The command never reads the real ~/.pi and never
writes directly into verification/protected.
`;

function value(argv, index, flag) {
  const result = argv[index + 1];
  if (!result || result.startsWith("-") || /[\0\r\n]/u.test(result)) throw new Error(`${flag} requires a value`);
  return result;
}

export function parseSubagentsLiveEvidenceArgs(argv) {
  const output = {
    operation: "plan",
    yes: false,
    json: false,
    help: false,
    authorizationFile: null,
    configRoot: null,
    packageRoot: null,
    repositoryRoot: ROOT,
    piCommand: null,
    signerCommand: null,
    outputDir: null,
  };
  const seen = new Set();
  const fields = {
    "--authorization-file": "authorizationFile",
    "--config-root": "configRoot",
    "--package-root": "packageRoot",
    "--repository-root": "repositoryRoot",
    "--pi-command": "piCommand",
    "--signer-command": "signerCommand",
    "--output-dir": "outputDir",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan") {
      if (seen.has("operation")) throw new Error("operation may be specified once");
      seen.add("operation");
      output.operation = "plan";
    } else if (argument === "--run") {
      if (seen.has("operation")) throw new Error("operation may be specified once");
      seen.add("operation");
      output.operation = "run";
    } else if (argument === "--yes") {
      if (seen.has("yes")) throw new Error("duplicate --yes");
      seen.add("yes");
      output.yes = true;
    } else if (argument === "--json") {
      if (seen.has("json")) throw new Error("duplicate --json");
      seen.add("json");
      output.json = true;
    } else if (argument === "--help" || argument === "-h") {
      output.help = true;
    } else if (fields[argument]) {
      const field = fields[argument];
      if (seen.has(field)) throw new Error(`duplicate ${argument}`);
      seen.add(field);
      output[field] = value(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (output.help) return Object.freeze(output);
  for (const [field, flag] of [
    ["authorizationFile", "--authorization-file"],
    ["configRoot", "--config-root"],
    ["packageRoot", "--package-root"],
    ["repositoryRoot", "--repository-root"],
    ["piCommand", "--pi-command"],
    ["signerCommand", "--signer-command"],
    ["outputDir", "--output-dir"],
  ]) {
    if (output[field] !== null && !path.isAbsolute(output[field])) throw new Error(`${flag} must be absolute`);
  }
  if (output.operation === "run") {
    if (!output.yes) throw new Error("--run requires --yes");
    for (const [field, flag] of [
      ["authorizationFile", "--authorization-file"],
      ["configRoot", "--config-root"],
      ["packageRoot", "--package-root"],
      ["piCommand", "--pi-command"],
      ["signerCommand", "--signer-command"],
      ["outputDir", "--output-dir"],
    ]) if (output[field] === null) throw new Error(`--run requires ${flag}`);
  }
  return Object.freeze(output);
}

async function defaultSourceInspector(repositoryRoot) {
  const options = { cwd: repositoryRoot, timeout: 10_000, maxBuffer: 64 * 1024, windowsHide: true };
  const head = (await execFile("git", ["rev-parse", "HEAD"], options)).stdout.trim();
  if (!FULL_SHA.test(head)) throw new Error("repository HEAD is not an exact Git commit");
  const status = (await execFile("git", ["status", "--porcelain=v1", "--untracked-files=all"], options)).stdout;
  return Object.freeze({ sourceCommit: head, clean: status.length === 0 });
}

function safeAuthorizationFile(file) {
  if (file === null) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 128 * 1024) {
    throw new Error("authorization file must be a bounded regular non-symlink file");
  }
  return file;
}

function captureError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function realRegularDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.resolve(value) === path.parse(path.resolve(value)).root) {
    throw captureError(`${label} must be an explicit absolute non-root directory`, "LIVE_CAPTURE_ROOT_INVALID");
  }
  let stat;
  try {
    stat = fs.lstatSync(value);
  } catch {
    throw captureError(`${label} is unavailable`, "LIVE_CAPTURE_ROOT_INVALID");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw captureError(`${label} must be a regular non-symlink directory`, "LIVE_CAPTURE_ROOT_INVALID");
  }
  return fs.realpathSync(value);
}

function pathContains(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateLiveCaptureRoots({ repositoryRoot, configRoot, outputDir }) {
  const roots = {
    repositoryRoot: realRegularDirectory(repositoryRoot, "repositoryRoot"),
    configRoot: realRegularDirectory(configRoot, "configRoot"),
    outputDir: realRegularDirectory(outputDir, "outputDir"),
  };
  for (const [leftName, rightName] of [
    ["repositoryRoot", "configRoot"],
    ["repositoryRoot", "outputDir"],
    ["configRoot", "outputDir"],
  ]) {
    if (pathContains(roots[leftName], roots[rightName]) || pathContains(roots[rightName], roots[leftName])) {
      throw captureError(`${leftName} and ${rightName} must be disjoint`, "LIVE_CAPTURE_ROOT_OVERLAP");
    }
  }
  return Object.freeze(roots);
}

export async function executeSubagentsLiveEvidence(argv, {
  rootDir,
  sourceInspector = defaultSourceInspector,
  scenarioRunnerFactory = createPiProtectedLiveScenarioRunner,
  signerFactory = createExternalDigestSigner,
  writer = writeProtectedLiveEvidenceStaging,
  releaseContractsLoader = loadSubagentsReleaseContracts,
  trustPolicyLoader = loadProtectedEvidenceTrustPolicy,
  authorizationLoader = loadLiveEvidenceAuthorization,
  now = () => Date.now(),
  hostEnvironment = process.env,
} = {}) {
  const args = parseSubagentsLiveEvidenceArgs(argv);
  if (args.help) return Object.freeze({ status: "HELP", help: HELP, exitCode: 0 });
  const repositoryRoot = path.resolve(rootDir ?? args.repositoryRoot);
  const source = await sourceInspector(repositoryRoot);
  const { matrix, policy } = releaseContractsLoader({ rootDir: repositoryRoot });
  const trustPolicy = trustPolicyLoader({ rootDir: repositoryRoot });
  let authorization = null;
  let authorizationLoadStatus = "AUTHORIZATION_REQUIRED";
  if (args.authorizationFile !== null) {
    try {
      authorization = authorizationLoader(safeAuthorizationFile(args.authorizationFile), {
        allowTemplate: args.operation === "plan",
        matrix,
        policy,
        trustPolicy,
        expectedSourceCommit: source.sourceCommit,
        now: now(),
      });
      authorizationLoadStatus = authorization.contractStatus === "operator-template"
        ? "AUTHORIZATION_TEMPLATE_ONLY"
        : "AUTHORIZATION_VALID";
    } catch (cause) {
      authorizationLoadStatus = cause?.code ?? "AUTHORIZATION_INVALID";
    }
  }
  const capturePlan = createProtectedLiveEvidenceCapturePlan({
    authorization,
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit: source.sourceCommit,
    now: now(),
  });
  const blockers = [];
  if (!source.clean) blockers.push("SOURCE_TREE_DIRTY");
  if (trustPolicy.contractStatus !== "runtime-ready") blockers.push("TRUST_POLICY_UNAVAILABLE");
  if (authorizationLoadStatus !== "AUTHORIZATION_VALID") blockers.push(authorizationLoadStatus);
  if (!capturePlan.runnable && !blockers.includes(capturePlan.status)) blockers.push(capturePlan.status);
  const plan = Object.freeze({
    ...capturePlan,
    status: blockers.length === 0 ? capturePlan.status : "CONFIGURED_UNAVAILABLE",
    runnable: blockers.length === 0 && capturePlan.runnable,
    sourceCommit: source.sourceCommit,
    sourceClean: source.clean,
    trustPolicyStatus: trustPolicy.contractStatus,
    blockers: Object.freeze([...new Set(blockers)]),
  });
  if (args.operation === "plan") return Object.freeze({ status: "PLAN", plan, exitCode: 0 });
  if (!plan.runnable || authorization === null) {
    const error = new Error(`protected live capture is unavailable: ${plan.blockers.join(", ")}`);
    error.code = "PROTECTED_LIVE_CAPTURE_UNAVAILABLE";
    throw error;
  }
  const liveRoots = validateLiveCaptureRoots({
    repositoryRoot,
    configRoot: args.configRoot,
    outputDir: args.outputDir,
  });
  const scenarioRunner = scenarioRunnerFactory({
    configRoot: liveRoots.configRoot,
    packageRoot: args.packageRoot,
    repositoryRoot: liveRoots.repositoryRoot,
    piCommand: args.piCommand,
    hostEnvironment,
  });
  const signer = signerFactory({ command: args.signerCommand });
  const capture = await captureProtectedLiveEvidenceSet({
    authorization,
    matrix,
    policy,
    trustPolicy,
    expectedSourceCommit: source.sourceCommit,
    scenarioRunner,
    signer,
    now: now(),
  });
  const sourceAfterCapture = await sourceInspector(liveRoots.repositoryRoot);
  if (!sourceAfterCapture.clean || sourceAfterCapture.sourceCommit !== source.sourceCommit) {
    throw captureError("source changed during protected live capture", "LIVE_CAPTURE_SOURCE_CHANGED");
  }
  const staged = await writer(capture, { outputDir: liveRoots.outputDir });
  return Object.freeze({
    status: "RUN_COMPLETE",
    plan,
    capture: {
      status: capture.status,
      authorizationId: capture.authorizationId,
      authorizationDigest: capture.authorizationDigest,
      sourceCommit: capture.sourceCommit,
      usage: capture.usage,
      evidence: Object.fromEntries(Object.entries(capture.evidence).map(([id, document]) => [id, document.evidenceDigest])),
    },
    staged,
    exitCode: 0,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseSubagentsLiveEvidenceArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const result = await executeSubagentsLiveEvidence(argv);
  if (args.json || result.status !== "PLAN") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.plan.status}: ${result.plan.blockers.join(", ") || "ready"}\n`);
  return result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`subagents-live-evidence: ERROR ${error.code ?? "UNEXPECTED"}: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

export { HELP as SUBAGENTS_LIVE_EVIDENCE_HELP, ROOT as REPOSITORY_ROOT };
