#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { defaultReleaseGatesPath, loadReleaseGatesManifest, releaseGatesDigest } from "./lib/release-gates.mjs";
import { defaultReceiptPath, validateReleaseReceipt } from "./verification-receipt.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FULL_SHA = /^[a-f0-9]{40}$/u;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
}

export function parseReceiptCheckArgs(argv) {
  const output = { receipt: defaultReceiptPath(), expectParent: false, sourceCommit: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--receipt") {
      if (seen.has("receipt")) throw new Error("duplicate --receipt");
      seen.add("receipt");
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error("--receipt requires a path");
      output.receipt = path.resolve(ROOT, value);
    } else if (arg === "--expect-parent") {
      if (seen.has("expectParent")) throw new Error("duplicate --expect-parent");
      seen.add("expectParent");
      output.expectParent = true;
    } else if (arg === "--source-commit") {
      if (seen.has("sourceCommit")) throw new Error("duplicate --source-commit");
      seen.add("sourceCommit");
      output.sourceCommit = argv[++index];
      if (!FULL_SHA.test(output.sourceCommit ?? "")) throw new Error("--source-commit requires a full Git SHA");
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (output.expectParent && output.sourceCommit !== null) throw new Error("--expect-parent and --source-commit are mutually exclusive");
  const receipts = path.join(ROOT, "verification", "receipts");
  const relative = path.relative(receipts, output.receipt);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("receipt path must stay inside verification/receipts");
  }
  return Object.freeze(output);
}

export function checkReleaseReceipt(argv = process.argv.slice(2)) {
  const args = parseReceiptCheckArgs(argv);
  const manifest = loadReleaseGatesManifest(defaultReleaseGatesPath);
  const receipt = JSON.parse(fs.readFileSync(args.receipt, "utf8"));
  const expectedSourceCommit = args.expectParent
    ? git(["rev-parse", "HEAD^"])
    : (args.sourceCommit ?? git(["rev-parse", "HEAD"]));
  const result = validateReleaseReceipt(receipt, manifest, { expectedSourceCommit });
  if (args.expectParent) {
    const changed = git(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
      .split("\n")
      .filter(Boolean);
    const relativeReceipt = path.relative(ROOT, args.receipt).replaceAll(path.sep, "/");
    if (changed.length !== 1 || changed[0] !== relativeReceipt) throw new Error("receipt commit must contain exactly the canonical receipt file");
    if (git(["status", "--porcelain=v1", "--untracked-files=all"]) !== "") throw new Error("receipt HEAD worktree is not clean");
  }
  return Object.freeze({
    ok: true,
    status: result.status,
    sourceCommit: result.sourceCommit,
    manifestDigest: releaseGatesDigest(manifest),
    parentVerified: args.expectParent,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(checkReleaseReceipt(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`release-receipt-check: ERROR ${error.message}\n`);
    process.exitCode = 1;
  }
}
