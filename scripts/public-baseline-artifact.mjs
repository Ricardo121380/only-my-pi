#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildCommitPinnedSourceArtifact } from "./lib/source-artifact.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function parsePublicBaselineArtifactArgs(argv) {
  const result = { sourceCommit: null, output: null, json: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") {
      if (seen.has(token)) fail("PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID", "duplicate --json");
      seen.add(token);
      result.json = true;
      continue;
    }
    if (["--source-commit", "--output"].includes(token)) {
      if (seen.has(token)) fail("PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID", `duplicate ${token}`);
      seen.add(token);
      const value = argv[++index];
      if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) fail("PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID", `${token} requires a bounded value`);
      if (token === "--source-commit") result.sourceCommit = value;
      else result.output = path.resolve(value);
      continue;
    }
    fail("PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID", `unknown argument ${token}`);
  }
  if (!FULL_SHA.test(result.sourceCommit ?? "") || result.output === null || !path.isAbsolute(result.output)) {
    fail("PUBLIC_BASELINE_ARTIFACT_ARGUMENT_INVALID", "--source-commit and an absolute --output are required");
  }
  return Object.freeze(result);
}

async function git(args) {
  return (await execFile("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 })).stdout.trim();
}

export async function executePublicBaselineArtifact(args) {
  const head = await git(["rev-parse", "HEAD"]);
  if (head !== args.sourceCommit) fail("PUBLIC_BASELINE_ARTIFACT_SOURCE_INVALID", "requested sourceCommit differs from HEAD");
  if (await git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") fail("PUBLIC_BASELINE_ARTIFACT_SOURCE_DIRTY", "source artifact requires a clean worktree");
  const artifact = await buildCommitPinnedSourceArtifact({ rootDir: ROOT, sourceCommit: head, output: args.output });
  return { ok: true, status: "PUBLIC_BASELINE_ARTIFACT_BUILT", ...artifact };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parsePublicBaselineArtifactArgs(argv);
  const result = await executePublicBaselineArtifact(args);
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try { process.exitCode = await main(); }
  catch (error) { process.stderr.write(`public-baseline-artifact: ERROR ${error.code ?? "PUBLIC_BASELINE_ARTIFACT_FAILED"} ${error.message}\n`); process.exitCode = 1; }
}
