#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  captureProtectedGuardedWriterEvidence,
  createGuardedWriterCapturePlan,
} from "../packages/subagents/release/guarded-writer-capture.mjs";
import { loadGuardedWriterAuthorization } from "../packages/subagents/release/guarded-writer-authorization.mjs";
import { createPiGuardedWriterScenarioRunner } from "../packages/subagents/release/guarded-writer-pi-runner.mjs";
import {
  createExternalDigestSigner,
  writeProtectedLiveEvidenceStaging,
} from "../packages/subagents/release/live-evidence-capture.mjs";
import { loadSubagentsReleaseContracts } from "../packages/subagents/release/compatibility.mjs";
import { loadProtectedEvidenceTrustPolicy } from "../packages/subagents/release/protected-evidence.mjs";
import { validateLiveCaptureRoots } from "./subagents-live-evidence.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;

const HELP = `Usage:
  node scripts/subagents-guarded-writer-evidence.mjs [--plan] [--authorization-file /absolute/file] [--json]

  node scripts/subagents-guarded-writer-evidence.mjs --run --yes \\
    --authorization-file /absolute/operator-authorization.json \\
    --config-root /absolute/empty/disposable/root \\
    --package-root /absolute/pi-subagents/package \\
    --pi-command /absolute/pi \\
    --signer-command /absolute/external-signer \\
    --output-dir /absolute/empty/staging/directory \\
    [--repository-root /absolute/only-my-pi] [--json]

Default behavior is inert. A live run needs a clean exact source, a runtime-ready
trust policy, an active one-time guarded-writer authorization, --yes, an
external digest-only signer, and disjoint source/config/output roots. The child
runs only in a synthetic managed Git worktree. The parent recomputes the staged
diff and fixed gates and emits a handoff; it never auto-integrates or writes the
source repository, real ~/.pi, or verification/protected.
`;

function nextValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseGuardedWriterEvidenceArgs(argv) {
  const output = {
    operation: "plan", yes: false, json: false, help: false,
    authorizationFile: null, configRoot: null, packageRoot: null,
    repositoryRoot: ROOT, piCommand: null, signerCommand: null, outputDir: null,
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
    if (argument === "--plan" || argument === "--run") {
      if (seen.has("operation")) throw new Error("operation may be specified once");
      seen.add("operation");
      output.operation = argument.slice(2);
    } else if (argument === "--yes" || argument === "--json") {
      const field = argument.slice(2);
      if (seen.has(field)) throw new Error(`duplicate ${argument}`);
      seen.add(field);
      output[field] = true;
    } else if (argument === "--help" || argument === "-h") {
      output.help = true;
    } else if (fields[argument]) {
      const field = fields[argument];
      if (seen.has(field)) throw new Error(`duplicate ${argument}`);
      seen.add(field);
      output[field] = nextValue(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (output.help) return Object.freeze(output);
  for (const [field, flag] of Object.entries({
    authorizationFile: "--authorization-file", configRoot: "--config-root",
    packageRoot: "--package-root", repositoryRoot: "--repository-root",
    piCommand: "--pi-command", signerCommand: "--signer-command", outputDir: "--output-dir",
  })) {
    if (output[field] !== null && !path.isAbsolute(output[field])) throw new Error(`${flag} must be absolute`);
  }
  if (output.operation === "run") {
    if (!output.yes) throw new Error("--run requires --yes");
    for (const [field, flag] of Object.entries({
      authorizationFile: "--authorization-file", configRoot: "--config-root",
      packageRoot: "--package-root", piCommand: "--pi-command",
      signerCommand: "--signer-command", outputDir: "--output-dir",
    })) if (output[field] === null) throw new Error(`--run requires ${flag}`);
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
    throw Object.assign(new Error("authorization file must be a bounded regular non-symlink file"), { code: "AUTHORIZATION_PATH_INVALID" });
  }
  return file;
}

export async function executeGuardedWriterEvidence(argv, {
  rootDir,
  sourceInspector = defaultSourceInspector,
  scenarioRunnerFactory = createPiGuardedWriterScenarioRunner,
  signerFactory = createExternalDigestSigner,
  writer = writeProtectedLiveEvidenceStaging,
  releaseContractsLoader = loadSubagentsReleaseContracts,
  trustPolicyLoader = loadProtectedEvidenceTrustPolicy,
  authorizationLoader = loadGuardedWriterAuthorization,
  now = () => Date.now(),
  hostEnvironment = process.env,
} = {}) {
  const args = parseGuardedWriterEvidenceArgs(argv);
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
        allowTemplate: args.operation === "plan", matrix, policy, trustPolicy,
        expectedSourceCommit: source.sourceCommit, now: now(),
      });
      authorizationLoadStatus = authorization.contractStatus === "operator-template"
        ? "AUTHORIZATION_TEMPLATE_ONLY"
        : "AUTHORIZATION_VALID";
    } catch (cause) {
      authorizationLoadStatus = cause?.code ?? "AUTHORIZATION_INVALID";
    }
  }
  const capturePlan = createGuardedWriterCapturePlan({
    authorization, matrix, policy, trustPolicy, expectedSourceCommit: source.sourceCommit, now: now(),
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
    throw Object.assign(new Error(`protected guarded writer is unavailable: ${plan.blockers.join(", ")}`), {
      code: "PROTECTED_GUARDED_WRITER_UNAVAILABLE",
    });
  }
  const roots = validateLiveCaptureRoots({ repositoryRoot, configRoot: args.configRoot, outputDir: args.outputDir });
  const scenarioRunner = scenarioRunnerFactory({
    configRoot: roots.configRoot,
    packageRoot: args.packageRoot,
    repositoryRoot: roots.repositoryRoot,
    piCommand: args.piCommand,
    hostEnvironment,
  });
  const capture = await captureProtectedGuardedWriterEvidence({
    authorization, matrix, policy, trustPolicy, expectedSourceCommit: source.sourceCommit,
    scenarioRunner, signer: signerFactory({ command: args.signerCommand }), now: now(),
  });
  const sourceAfter = await sourceInspector(roots.repositoryRoot);
  if (!sourceAfter.clean || sourceAfter.sourceCommit !== source.sourceCommit) {
    throw Object.assign(new Error("source changed during protected guarded writer capture"), { code: "GUARDED_WRITER_SOURCE_CHANGED" });
  }
  const staged = await writer(capture, { outputDir: roots.outputDir });
  return Object.freeze({
    status: "RUN_COMPLETE",
    plan,
    capture: {
      status: capture.status,
      authorizationId: capture.authorizationId,
      authorizationDigest: capture.authorizationDigest,
      sourceCommit: capture.sourceCommit,
      usage: capture.usage,
      evidence: { "guarded-writer-integration": capture.evidence["guarded-writer-integration"].evidenceDigest },
    },
    staged,
    exitCode: 0,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseGuardedWriterEvidenceArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  const result = await executeGuardedWriterEvidence(argv);
  if (args.json || result.status !== "PLAN") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.plan.status}: ${result.plan.blockers.join(", ") || "ready"}\n`);
  return result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`subagents-guarded-writer-evidence: ERROR ${error.code ?? "UNEXPECTED"}: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

export { HELP as SUBAGENTS_GUARDED_WRITER_HELP, ROOT as REPOSITORY_ROOT };
