#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTENSIONS = new Set([".cjs", ".js", ".json", ".md", ".mjs", ".ts", ".txt", ".yaml", ".yml"]);
const JAVASCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);
const CONFLICT_MARKER = /^(?:<<<<<<< .+|=======|>>>>>>> .+)$/mu;

function trackedFiles(rootDir) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: rootDir });
  return output.toString("utf8").split("\0").filter(Boolean).sort();
}

function finding(file, code, message) {
  return Object.freeze({ file, code, message });
}

export function lintRepository({ rootDir = REPOSITORY_ROOT } = {}) {
  const root = fs.realpathSync(path.resolve(rootDir));
  const files = trackedFiles(root);
  const findings = [];
  let jsonFiles = 0;
  let javascriptFiles = 0;

  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      findings.push(finding(relativePath, "tracked-symlink", "tracked source symlinks are not allowed"));
      continue;
    }
    if (!stat.isFile()) continue;
    const extension = path.extname(relativePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && path.basename(relativePath) !== "LICENSE") continue;
    const content = fs.readFileSync(absolutePath, "utf8");
    if (content.includes("\0")) findings.push(finding(relativePath, "nul-byte", "text source contains a NUL byte"));
    if (CONFLICT_MARKER.test(content)) findings.push(finding(relativePath, "conflict-marker", "source contains an unresolved merge marker"));
    if (extension === ".json") {
      jsonFiles += 1;
      try {
        JSON.parse(content);
      } catch (error) {
        findings.push(finding(relativePath, "invalid-json", error.message));
      }
    }
    if (JAVASCRIPT_EXTENSIONS.has(extension)) {
      javascriptFiles += 1;
      const result = spawnSync(process.execPath, ["--check", absolutePath], {
        cwd: root,
        encoding: "utf8",
        shell: false,
        maxBuffer: 1024 * 1024,
      });
      if (result.status !== 0) findings.push(finding(relativePath, "syntax-error", "node --check rejected this source file"));
    }
  }

  const binPath = path.join(root, "bin", "omp.mjs");
  if ((fs.statSync(binPath).mode & 0o111) === 0) {
    findings.push(finding("bin/omp.mjs", "not-executable", "the packaged omp entrypoint must be executable"));
  }

  return Object.freeze({
    ok: findings.length === 0,
    files: files.length,
    jsonFiles,
    javascriptFiles,
    findings: Object.freeze(findings),
  });
}

export function main() {
  const result = lintRepository();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`lint: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
