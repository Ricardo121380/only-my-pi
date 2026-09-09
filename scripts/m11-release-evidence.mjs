#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import { sha256 } from "../packages/release-stack/index.mjs";
import { DIRECT_AGENT_VERSION } from "../packages/direct-agent/product-contract.mjs";
import { validateM12ProtectedEvidence } from "./m12-direct-coding-gates.mjs";

const execFile = promisify(execFileCallback);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[a-f0-9]{40}$/u;
const EVIDENCE_PATH = /^verification\/protected\/[a-z0-9][a-z0-9._-]*\.json$/u;

function fail(code, message) { const error = new Error(message); error.code = code; throw error; }

async function git(rootDir, args) {
  const { stdout } = await execFile("git", args, { cwd: rootDir, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

export async function extractM11ReleaseEvidence({ rootDir = ROOT, sourceCommit, evidenceCommit, evidencePath, outputPath } = {}) {
  if (![sourceCommit, evidenceCommit].every((value) => COMMIT.test(value ?? "")) || !EVIDENCE_PATH.test(evidencePath ?? "") || typeof outputPath !== "string" || !path.isAbsolute(outputPath)) fail("M11_RELEASE_EVIDENCE_ARGUMENT_INVALID", "release evidence requires exact commits, protected path and absolute output");
  const root = await fs.realpath(rootDir);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const status = await git(root, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (head !== sourceCommit || status !== "") fail("M11_RELEASE_EVIDENCE_SOURCE_INVALID", "release evidence extraction requires a clean checkout at source S");
  const sourcePackage = JSON.parse(await git(root, ["show", `${sourceCommit}:package.json`]));
  if (sourcePackage.version !== DIRECT_AGENT_VERSION) fail("M11_RELEASE_EVIDENCE_VERSION_INVALID", "release source must match the current direct Agent version");
  const parents = (await git(root, ["show", "-s", "--format=%P", evidenceCommit])).split(" ").filter(Boolean);
  const changed = (await git(root, ["diff", "--name-only", "--no-renames", `${sourceCommit}..${evidenceCommit}`])).split("\n").filter(Boolean);
  const deleted = (await git(root, ["diff", "--name-only", "--diff-filter=D", "--no-renames", `${sourceCommit}..${evidenceCommit}`])).split("\n").filter(Boolean);
  if (parents.length !== 1 || parents[0] !== sourceCommit || changed.length !== 1 || changed[0] !== evidencePath || deleted.length !== 0) fail("M11_RELEASE_EVIDENCE_COMMIT_INVALID", "E must be the direct evidence-only child of S");
  const raw = await git(root, ["show", `${evidenceCommit}:${evidencePath}`]);
  const document = validateM12ProtectedEvidence(JSON.parse(raw), sourceCommit);
  const parent = await fs.realpath(path.dirname(outputPath));
  if (parent !== path.dirname(path.resolve(outputPath)) || await fs.lstat(outputPath).then(() => true, (error) => error?.code === "ENOENT" ? false : Promise.reject(error))) fail("M11_RELEASE_EVIDENCE_OUTPUT_INVALID", "evidence output must be a new file under a real directory");
  await fs.writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return Object.freeze({ ok: true, status: "M11_RELEASE_EVIDENCE_EXTRACTED", sourceCommit, evidenceCommit, productVersion: document.productVersion, evidenceDigest: document.evidenceDigest, assertionCount: document.assertions.length, outputClass: "EXPLICIT_NON_REPOSITORY_FILE" });
}

export function parseM11ReleaseEvidenceArgs(argv) {
  const result = { json: false };
  const keys = new Map([["--source-commit", "sourceCommit"], ["--evidence-commit", "evidenceCommit"], ["--evidence-path", "evidencePath"], ["--output", "outputPath"]]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json" && result.json === false) { result.json = true; continue; }
    if (!keys.has(token) || result[keys.get(token)] !== undefined) fail("M11_RELEASE_EVIDENCE_ARGUMENT_INVALID", `unsupported or duplicate argument: ${token}`);
    const value = argv[++index]; if (!value || value.startsWith("--")) fail("M11_RELEASE_EVIDENCE_ARGUMENT_INVALID", `${token} requires a value`); result[keys.get(token)] = value;
  }
  return result;
}

export async function main(argv = process.argv.slice(2)) { const options = parseM11ReleaseEvidenceArgs(argv); const result = await extractM11ReleaseEvidence(options); process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`); return 0; }
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${JSON.stringify({ ok: false, status: "M11_RELEASE_EVIDENCE_FAILED", code: error?.code ?? "M11_RELEASE_EVIDENCE_FAILED", message: error?.message, errorDigest: sha256(String(error?.stack ?? error)) }, null, 2)}\n`); process.exitCode = 1; });
