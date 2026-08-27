#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "verification", "manifests", "pack-content-v1.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeEntry(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error("pack entry must be a non-empty string");
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`pack entry escapes package root: ${value}`);
  }
  return normalized;
}

export function validatePackEntries(entries, manifest) {
  const errors = [];
  if (manifest?.formatVersion !== 1) errors.push("unsupported pack manifest version");

  const allowedExact = new Set(manifest?.allowedExact ?? []);
  const allowedPrefixes = manifest?.allowedPrefixes ?? [];
  const allowedBundledPrefixes = manifest?.allowedBundledPrefixes ?? [];
  const forbiddenPrefixes = manifest?.forbiddenPrefixes ?? [];
  const forbiddenSegments = manifest?.forbiddenSegments ?? [];
  const forbiddenPatterns = (manifest?.forbiddenBasenamePatterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  const normalized = [];

  for (const entry of entries) {
    let file;
    try {
      file = normalizeEntry(typeof entry === "string" ? entry : entry?.path);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    normalized.push(file);
    const basename = path.posix.basename(file);
    const bundledDependency = allowedBundledPrefixes.some((prefix) => file.startsWith(prefix));
    const nodeModulesOccurrences = (`/${file}`.match(/\/node_modules\//gu) ?? []).length;
    if (forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
      errors.push(`forbidden pack prefix: ${file}`);
    }
    for (const segment of forbiddenSegments) {
      if (!`/${file}`.includes(segment)) continue;
      if (bundledDependency && nodeModulesOccurrences === 1 && ["/node_modules/", "/fixtures/"].includes(segment)) continue;
      errors.push(`forbidden pack segment: ${file}`);
      break;
    }
    if (!bundledDependency && forbiddenPatterns.some((pattern) => pattern.test(basename))) {
      errors.push(`forbidden pack basename: ${file}`);
    }
    if (!allowedExact.has(file) && !allowedPrefixes.some((prefix) => file.startsWith(prefix)) && !bundledDependency) {
      errors.push(`pack entry is outside allowlist: ${file}`);
    }
  }

  if (new Set(normalized).size !== normalized.length) errors.push("duplicate pack entries");
  for (const required of manifest?.required ?? []) {
    if (!normalized.includes(required)) errors.push(`required pack entry missing: ${required}`);
  }

  return { ok: errors.length === 0, errors, files: normalized.sort() };
}

export function inspectPack({ repoRoot = REPO_ROOT, manifestPath = DEFAULT_MANIFEST } = {}) {
  const manifest = readJson(manifestPath);
  const stdout = execFileSync(
    process.env.npm_execpath || "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: repoRoot, encoding: "utf8", env: { ...process.env, npm_config_ignore_scripts: "true" } },
  );
  const payload = JSON.parse(stdout);
  if (!Array.isArray(payload) || payload.length !== 1 || !Array.isArray(payload[0]?.files)) {
    throw new Error("npm pack returned an unexpected JSON payload");
  }
  return validatePackEntries(payload[0].files, manifest);
}

function main() {
  const result = inspectPack();
  process.stdout.write(`${JSON.stringify({ ok: result.ok, files: result.files.length, errors: result.errors }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
