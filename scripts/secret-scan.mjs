#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { inspectPack } from "./pack-check.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const FORBIDDEN_BASENAMES = new Set([".env", "auth.json", "credentials.json", "models.json"]);
const PATTERNS = Object.freeze([
  ["openai-style-secret", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/gu],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/gu],
  ["bearer-token", /\bBearer[ \t]+[A-Za-z0-9._~+/-]{20,}={0,2}\b/gu],
  ["private-key", new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----", "gu")],
  ["mac-home-path", /\/Users\/[^/\s]+\//gu],
  ["linux-home-path", /\/home\/[^/\s]+\//gu],
  ["windows-home-path", /[A-Za-z]:\\Users\\[^\\\s]+\\/gu],
  ["mac-temp-path", /\/var\/folders\/[A-Za-z0-9_/-]+/gu],
]);

function trackedFiles(rootDir) {
  return execFileSync("git", ["ls-files", "-z"], { cwd: rootDir })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

function lineNumber(text, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) if (text.charCodeAt(index) === 10) line += 1;
  return line;
}

export function scanText(text, { file = "<memory>", scope = "tracked" } = {}) {
  const findings = [];
  for (const [code, pattern] of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push(Object.freeze({ scope, file, line: lineNumber(text, match.index ?? 0), code }));
    }
  }
  return findings;
}

function scanFile(root, relativePath, scope) {
  if (FORBIDDEN_BASENAMES.has(path.basename(relativePath))) {
    return [Object.freeze({ scope, file: relativePath, line: 0, code: "forbidden-secret-filename" })];
  }
  const absolutePath = path.join(root, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];
  const bytes = fs.readFileSync(absolutePath);
  if (bytes.includes(0)) return [];
  return scanText(bytes.toString("utf8"), { file: relativePath, scope });
}

export function scanRepository({ rootDir = REPOSITORY_ROOT } = {}) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const tracked = trackedFiles(root);
  const packedResult = inspectPack({ repoRoot: root });
  if (!packedResult.ok) throw new Error(`cannot secret-scan an invalid package: ${packedResult.errors.join("; ")}`);
  const packed = new Set(packedResult.files);
  const findings = [];
  for (const file of tracked) findings.push(...scanFile(root, file, "tracked"));
  for (const file of packed) findings.push(...scanFile(root, file, "packed"));
  findings.sort((left, right) => (
    left.file.localeCompare(right.file) || left.line - right.line || left.scope.localeCompare(right.scope) || left.code.localeCompare(right.code)
  ));
  return Object.freeze({
    ok: findings.length === 0,
    trackedFiles: tracked.length,
    packedFiles: packed.size,
    findings: Object.freeze(findings),
  });
}

export function main() {
  const result = scanRepository();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`secret-scan: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
