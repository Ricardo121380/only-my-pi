#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { guardedWriterAuthorizationDigest } from "../packages/subagents/release/guarded-writer-authorization.mjs";
import { createGuardedWriterReconciliationPlan } from "../packages/subagents/release/guarded-writer-reconciliation.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const HELP = `Usage:
  npm run plan:subagents-guarded-writer-cleanup

  node scripts/subagents-guarded-writer-reconcile.mjs --plan \\
    --authorization-file /absolute/operator-authorization.json \\
    --config-root /absolute/disposable/root \\
    [--repository-root /absolute/only-my-pi] [--json]

This command is read-only. It never deletes a worktree, session, artifact,
fixture repository, staging directory, or config root. The result is a
digest-bound review plan whose cleanup disposition is RETAIN_FOR_REVIEW.
`;

function valueAfter(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseGuardedWriterReconcileArgs(argv) {
  const output = { operation: "plan", authorizationFile: null, configRoot: null, repositoryRoot: ROOT, json: false, help: false };
  const seen = new Set();
  const fields = { "--authorization-file": "authorizationFile", "--config-root": "configRoot", "--repository-root": "repositoryRoot" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--plan") {
      if (seen.has("operation")) throw new Error("operation may be specified once");
      seen.add("operation");
    } else if (argument === "--run" || argument === "--apply" || argument === "--yes") {
      throw new Error(`${argument} is unavailable: reconciliation is review-only`);
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
      output[field] = valueAfter(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  for (const [field, flag] of Object.entries({ authorizationFile: "--authorization-file", configRoot: "--config-root", repositoryRoot: "--repository-root" })) {
    if (output[field] !== null && !path.isAbsolute(output[field])) throw new Error(`${flag} must be absolute`);
  }
  return Object.freeze(output);
}

function readAuthorization(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > 128 * 1024) {
    throw Object.assign(new Error("authorization must be a bounded non-symlink file"), { code: "RECONCILIATION_AUTHORIZATION_INVALID" });
  }
  const document = JSON.parse(fs.readFileSync(file, "utf8"));
  if (document?.contractStatus !== "operator-authorized-live"
    || document.authorizationDigest !== guardedWriterAuthorizationDigest(document)) {
    throw Object.assign(new Error("authorization digest or status is invalid"), { code: "RECONCILIATION_AUTHORIZATION_INVALID" });
  }
  return document;
}

async function inspectSource(repositoryRoot) {
  const options = {
    cwd: repositoryRoot,
    timeout: 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      LC_ALL: "C",
    },
  };
  const sourceCommit = (await execFile("git", ["-c", "core.fsmonitor=false", "rev-parse", "--verify", "HEAD"], options)).stdout.trim();
  const dirty = (await execFile("git", ["-c", "core.fsmonitor=false", "status", "--porcelain=v1", "--untracked-files=all"], options)).stdout.length > 0;
  return Object.freeze({ sourceCommit, dirty });
}

export async function executeGuardedWriterReconciliation(argv, {
  rootDir,
  sourceInspector = inspectSource,
  authorizationReader = readAuthorization,
  planner = createGuardedWriterReconciliationPlan,
  now = () => Date.now(),
} = {}) {
  const args = parseGuardedWriterReconcileArgs(argv);
  if (args.help) return Object.freeze({ status: "HELP", help: HELP, exitCode: 0 });
  if (args.authorizationFile === null || args.configRoot === null) {
    return Object.freeze({
      status: "INPUT_REQUIRED",
      operation: "guarded-writer-reconciliation-plan",
      mutation: "NOT_AVAILABLE",
      blockers: Object.freeze([
        ...(args.authorizationFile === null ? ["AUTHORIZATION_FILE_REQUIRED"] : []),
        ...(args.configRoot === null ? ["CONFIG_ROOT_REQUIRED"] : []),
      ]),
      exitCode: 0,
    });
  }
  const repositoryRoot = path.resolve(rootDir ?? args.repositoryRoot);
  const authorization = authorizationReader(args.authorizationFile);
  const source = await sourceInspector(repositoryRoot);
  const plan = await planner({
    configRoot: args.configRoot,
    repositoryRoot,
    authorizationId: authorization.authorizationId,
    authorizationDigest: authorization.authorizationDigest,
    sourceCommit: authorization.sourceCommit,
    now,
  });
  const currentSourceFindings = [];
  if (source.sourceCommit !== authorization.sourceCommit) currentSourceFindings.push("CURRENT_SOURCE_COMMIT_DRIFT");
  if (source.dirty) currentSourceFindings.push("CURRENT_SOURCE_TREE_DIRTY");
  return Object.freeze({
    status: plan.runtimeState === "NOT_FOUND" ? "NO_TARGET" : "REVIEW_REQUIRED",
    currentSourceMatches: source.sourceCommit === authorization.sourceCommit && !source.dirty,
    currentSourceFindings: Object.freeze(currentSourceFindings),
    plan,
    mutation: "NOT_AVAILABLE",
    exitCode: 0,
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseGuardedWriterReconcileArgs(argv);
  if (args.help) { process.stdout.write(HELP); return 0; }
  const result = await executeGuardedWriterReconciliation(argv);
  if (args.json || result.status !== "INPUT_REQUIRED") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.status}: ${result.blockers.join(", ")}\n`);
  return result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`subagents-guarded-writer-reconcile: ERROR ${error.code ?? "UNEXPECTED"}: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

export { HELP as SUBAGENTS_GUARDED_WRITER_RECONCILE_HELP, ROOT as REPOSITORY_ROOT };
