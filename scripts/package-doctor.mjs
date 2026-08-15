#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const inventoryPath = path.join(root, "inventory", "packages.lock.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  const args = { json: false, strict: false, profile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--strict") args.strict = true;
    else if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function exactNpmSpec(spec) {
  if (!spec.startsWith("npm:")) return true;
  const body = spec.slice(4);
  if (body.startsWith("@")) {
    const slash = body.indexOf("/");
    const at = body.indexOf("@", slash + 1);
    return at > slash && at < body.length - 1;
  }
  const at = body.lastIndexOf("@");
  return at > 0 && at < body.length - 1;
}

function add(findings, severity, code, message, data = {}) {
  findings.push({ severity, code, message, ...data });
}

function printHelp() {
  console.log(
    `Usage: node scripts/package-doctor.mjs [options]\n\n` +
      `  --profile <file>  validate a profile against inventory\n` +
      `  --strict          return non-zero on warnings\n` +
      `  --json            print machine-readable findings\n` +
      `  --help            show this help`,
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  const inventory = readJson(inventoryPath);
  const findings = [];
  const entries = [...(inventory.packages ?? []), ...(inventory.candidates ?? [])];
  const byId = new Map();
  const activeOwnerGroups = new Map();

  if (inventory.formatVersion !== 1) {
    add(findings, "error", "inventory-version", "Unsupported inventory format.");
  }

  for (const entry of entries) {
    if (!entry.id || !entry.spec) {
      add(findings, "error", "entry-shape", "Package entry needs id and spec.", { id: entry.id });
      continue;
    }
    if (byId.has(entry.id)) {
      add(findings, "error", "duplicate-id", `Duplicate package id: ${entry.id}.`);
    }
    byId.set(entry.id, entry);

    if (inventory.policy?.requireExactNpmVersion && !exactNpmSpec(entry.spec)) {
      add(findings, "error", "unpinned-spec", `Package is not pinned: ${entry.spec}.`, { id: entry.id });
    }
    if (inventory.policy?.allowOldMarioScope === false && entry.spec.includes("@mariozechner/")) {
      add(findings, "error", "old-scope", `Old @mariozechner scope is blocked: ${entry.spec}.`, { id: entry.id });
    }
    if (entry.installed === true && entry.review === undefined) {
      add(findings, "error", "missing-review", `Installed package has no review state: ${entry.id}.`);
    }
  }

  if (args.profile) {
    const profilePath = path.resolve(process.cwd(), args.profile);
    const profile = readJson(profilePath);
    const selected = profile.packageIds ?? [];

    for (const id of selected) {
      const entry = byId.get(id);
      if (!entry) {
        add(findings, "error", "unknown-package", `Profile selects unknown package: ${id}.`);
        continue;
      }
      if (entry.installed === false || entry.mode === "blocked") {
        add(findings, "error", "blocked-selection", `Profile selects unavailable package: ${id}.`);
      }
      for (const owner of entry.owners ?? []) {
        const group = owner.toLowerCase();
        if (!inventory.policy?.oneOwnerPerGroup?.[group]) continue;
        const previous = activeOwnerGroups.get(group);
        if (previous && previous !== id) {
          add(findings, "error", "owner-conflict", `Profile has multiple ${group} owners: ${previous}, ${id}.`);
        }
        activeOwnerGroups.set(group, id);
      }
    }

    for (const id of profile.candidatePackageIds ?? []) {
      const entry = byId.get(id);
      if (!entry) {
        add(findings, "error", "unknown-candidate", `Profile references unknown candidate: ${id}.`);
      }
      if (entry?.mode === "blocked") {
        add(findings, "warning", "blocked-candidate", `Profile keeps blocked candidate explicit: ${id}.`);
      }
    }

    if (profile.policy?.requiresDisposableWorkspace && profile.policy?.requiresOsSandbox !== true) {
      add(findings, "error", "sandbox-policy", "Disposable profile must require an OS sandbox.");
    }
  }

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const result = {
    ok: errors === 0 && (!args.strict || warnings === 0),
    inventory: path.relative(root, inventoryPath),
    profile: args.profile,
    errors,
    warnings,
    findings,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`package-doctor: ${result.ok ? "PASS" : "FAIL"} (${errors} errors, ${warnings} warnings)`);
    for (const item of findings) {
      console.log(`${item.severity.toUpperCase()} ${item.code}: ${item.message}`);
    }
  }
  return result.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`package-doctor: ERROR ${error.message}`);
  process.exitCode = 1;
}
