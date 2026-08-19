#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createPiSubagentsNoModelLiveProbe } from "../packages/subagents/live-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage:
  node scripts/subagents-live-probe.mjs \\
    --config-root /absolute/disposable/root \\
    --package-root /absolute/pi-subagents/package \\
    [--only-my-pi-root /absolute/only-my-pi] \\
    [--pi-command /absolute/pi]

The command loads only the audited local pi-subagents source, the three
first-party only-my-pi extensions when --only-my-pi-root is supplied, and a
non-tool observer extension. It submits no prompt, contacts no model, dispatches
no child, never infers ~/.pi, and writes only under --config-root.
`;

export function parseSubagentsLiveProbeArgs(argv) {
  const output = { configRoot: null, packageRoot: null, onlyMyPiRoot: null, piCommand: "pi", help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      output.help = true;
      continue;
    }
    const fields = {
      "--config-root": "configRoot",
      "--package-root": "packageRoot",
      "--only-my-pi-root": "onlyMyPiRoot",
      "--pi-command": "piCommand",
    };
    const field = fields[argument];
    if (!field) throw new Error(`unknown argument: ${argument}`);
    if (seen.has(field)) throw new Error(`duplicate argument: ${argument}`);
    seen.add(field);
    const value = argv[++index];
    if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) throw new Error(`${argument} requires a value`);
    output[field] = value;
  }
  if (!output.help) {
    for (const field of ["configRoot", "packageRoot"]) {
      if (!output[field] || !path.isAbsolute(output[field])) throw new Error(`--${field === "configRoot" ? "config-root" : "package-root"} must be absolute`);
    }
    if (output.onlyMyPiRoot !== null && !path.isAbsolute(output.onlyMyPiRoot)) throw new Error("--only-my-pi-root must be absolute");
  }
  return Object.freeze(output);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseSubagentsLiveProbeArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const onlyMyPiRoot = args.onlyMyPiRoot ? path.resolve(args.onlyMyPiRoot) : null;
  const result = await createPiSubagentsNoModelLiveProbe({ piCommand: args.piCommand })({
    configRoot: path.resolve(args.configRoot),
    packageRoot: path.resolve(args.packageRoot),
    ...(onlyMyPiRoot ? {
      firstPartyRoot: onlyMyPiRoot,
      firstPartyExtensions: [
        path.join(onlyMyPiRoot, "extensions", "session-ledger", "index.ts"),
        path.join(onlyMyPiRoot, "extensions", "context-doctor", "index.ts"),
        path.join(onlyMyPiRoot, "extensions", "omp-control", "index.ts"),
      ],
      expectedFirstPartyCommands: ["omp", "omp-context"],
    } : {}),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`subagents-live-probe: ERROR ${error.code ?? "UNEXPECTED"}: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

export { HELP as SUBAGENTS_LIVE_PROBE_HELP, ROOT as REPOSITORY_ROOT };
