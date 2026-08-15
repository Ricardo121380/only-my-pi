#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { diffResolved, resolveProfileFile } from "./lib/profile-resolver.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function usage() {
  console.log(
    `Usage: node scripts/profile-resolver.mjs <profile.json> [options]\n\n` +
      `  --pi-settings       print only the generated Pi package settings\n` +
      `  --diff <profile>    show package and policy changes to another profile\n` +
      `  --check-all         resolve every profile without printing secrets\n` +
      `  --help              show this help`,
  );
}

function parseArgs(argv) {
  const args = { profile: null, diff: null, piSettings: false, checkAll: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pi-settings") args.piSettings = true;
    else if (arg === "--diff") args.diff = argv[++i];
    else if (arg === "--check-all") args.checkAll = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (args.profile === null) args.profile = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  return args;
}

function profileFiles() {
  return fs
    .readdirSync(path.join(root, "profiles"))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join("profiles", file));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return 0;
  }
  if (args.checkAll) {
    const results = profileFiles().map((file) => {
      const resolved = resolveProfileFile(root, file);
      return { file, id: resolved.profile.id, packages: resolved.packages.length, candidates: resolved.candidates.length };
    });
    console.log(JSON.stringify({ ok: true, profiles: results }, null, 2));
    return 0;
  }
  if (!args.profile) throw new Error("A profile path is required.");

  const resolved = resolveProfileFile(root, args.profile);
  if (args.diff) {
    const target = resolveProfileFile(root, args.diff);
    console.log(JSON.stringify(diffResolved(resolved, target), null, 2));
  } else if (args.piSettings) {
    console.log(JSON.stringify(resolved.piSettings, null, 2));
  } else {
    console.log(JSON.stringify(resolved, null, 2));
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`profile-resolver: ERROR ${error.message}`);
  process.exitCode = 1;
}
