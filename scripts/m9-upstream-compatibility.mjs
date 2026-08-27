#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  inspectM9CandidateInstallation,
  loadUpstreamCompatibility,
  M9_REQUIRED_SCOPES,
  validateUpstreamCompatibility,
} from "../packages/upstream-compatibility/index.mjs";
import {
  createPiSubagentsNoModelLiveProbe,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ACTIVE_TOOLS,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ARTIFACT,
  PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_PI_VERSION,
} from "../packages/subagents/live-probe.mjs";
import { runM9WebSafetyProbe } from "../packages/upstream-compatibility/web-safety.mjs";
import { runM9StackProbe } from "../packages/upstream-compatibility/stack-probe.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `Usage:
  node scripts/m9-upstream-compatibility.mjs --plan [--json]
  node scripts/m9-upstream-compatibility.mjs \\
    --installation-root /absolute/disposable/npm-root [--json]
  node scripts/m9-upstream-compatibility.mjs --probe \\
    --installation-root /absolute/disposable/npm-root \\
    --config-root /absolute/disposable/pi-root \\
    [--pi-command /absolute/pi] \\
    [--only-my-pi-root /absolute/only-my-pi] [--json]

The M9 probe audits exact package-lock integrity and disk entrypoints, then runs
Pi offline with an isolated empty home. It submits no prompt, dispatches no
child, reads no model credential, and never mutates ~/.pi/agent.
`;

function absoluteNonRoot(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) === path.parse(path.resolve(value)).root || /[\0\r\n]/u.test(value)) {
    throw new Error(`${label} must be an explicit absolute non-root path`);
  }
  return path.resolve(value);
}

export function parseM9CompatibilityArgs(argv) {
  const output = {
    plan: false,
    probe: false,
    json: false,
    help: false,
    installationRoot: null,
    configRoot: null,
    piCommand: null,
    onlyMyPiRoot: null,
  };
  const seen = new Set();
  const flags = { "--plan": "plan", "--probe": "probe", "--json": "json", "--help": "help", "-h": "help" };
  const values = {
    "--installation-root": "installationRoot",
    "--config-root": "configRoot",
    "--pi-command": "piCommand",
    "--only-my-pi-root": "onlyMyPiRoot",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flags[argument]) {
      const field = flags[argument];
      if (seen.has(field)) throw new Error(`duplicate argument: ${argument}`);
      seen.add(field);
      output[field] = true;
      continue;
    }
    const field = values[argument];
    if (!field) throw new Error(`unknown argument: ${argument}`);
    if (seen.has(field)) throw new Error(`duplicate argument: ${argument}`);
    seen.add(field);
    const value = argv[++index];
    if (!value || value.startsWith("-") || /[\0\r\n]/u.test(value)) throw new Error(`${argument} requires a value`);
    output[field] = value;
  }
  if (output.help) return Object.freeze(output);
  if (output.plan && output.probe) throw new Error("--plan and --probe are mutually exclusive");
  if (output.installationRoot !== null) output.installationRoot = absoluteNonRoot(output.installationRoot, "--installation-root");
  if (output.configRoot !== null) output.configRoot = absoluteNonRoot(output.configRoot, "--config-root");
  if (output.onlyMyPiRoot !== null) output.onlyMyPiRoot = absoluteNonRoot(output.onlyMyPiRoot, "--only-my-pi-root");
  if (output.piCommand !== null && (!path.isAbsolute(output.piCommand) || /[\0\r\n]/u.test(output.piCommand))) {
    throw new Error("--pi-command must be an absolute executable path");
  }
  if (output.probe && output.installationRoot === null) throw new Error("--probe requires --installation-root");
  if (output.probe && output.configRoot === null) throw new Error("--probe requires --config-root");
  if (!output.probe && output.configRoot !== null) throw new Error("--config-root is only valid with --probe");
  return Object.freeze(output);
}

export function createM9CompatibilityPlan(args, contract = loadUpstreamCompatibility({ rootDir: ROOT })) {
  return Object.freeze({
    formatVersion: 1,
    action: args.probe ? "AUDIT_AND_NO_MODEL_PROBE" : args.installationRoot ? "AUDIT_CANDIDATE_INSTALLATION" : "VALIDATE_CONTRACT",
    baseline: contract.baseline,
    candidate: {
      piVersion: contract.candidate.piVersion,
      subagentsVersion: contract.candidate.subagentsVersion,
      packageCount: contract.candidate.packages.length,
    },
    requiredScopes: [...M9_REQUIRED_SCOPES],
    installationRoot: args.installationRoot,
    configRoot: args.configRoot,
    realPiHome: "NOT_TOUCHED",
    promptSubmitted: false,
    providerRequest: "NOT_RUN_BY_POLICY",
    childDispatch: "NOT_REQUESTED",
    decision: contract.decision,
  });
}

export async function runM9Compatibility(args, {
  rootDir = ROOT,
  probeFactory = createPiSubagentsNoModelLiveProbe,
} = {}) {
  const contract = loadUpstreamCompatibility({ rootDir });
  validateUpstreamCompatibility(contract, { rootDir, verifyEvidencePaths: true });
  const plan = createM9CompatibilityPlan(args, contract);
  if (args.plan) return Object.freeze({ ...plan, status: "PLAN_ONLY" });
  const audit = args.installationRoot === null ? null : inspectM9CandidateInstallation({
    installationRoot: args.installationRoot,
    contract,
  });
  let probe = null;
  let webSafety = null;
  let stackProbe = null;
  if (args.probe) {
    const onlyMyPiRoot = args.onlyMyPiRoot ?? rootDir;
    const piCommand = args.piCommand ?? path.join(args.installationRoot, "node_modules", ".bin", "pi");
    const packageRoot = path.join(args.installationRoot, "node_modules", "pi-subagents");
    probe = await probeFactory({
      piCommand,
      expectedPiVersion: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_PI_VERSION,
      expectedArtifact: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ARTIFACT,
      expectedActiveTools: PI_SUBAGENTS_LIVE_PROBE_CANDIDATE_ACTIVE_TOOLS,
    })({
      configRoot: args.configRoot,
      packageRoot,
      firstPartyRoot: onlyMyPiRoot,
      firstPartyExtensions: [
        path.join(onlyMyPiRoot, "extensions", "session-ledger", "index.ts"),
        path.join(onlyMyPiRoot, "extensions", "context-doctor", "index.ts"),
        path.join(onlyMyPiRoot, "extensions", "omp-control", "index.ts"),
      ],
      expectedFirstPartyCommands: ["omp", "omp-context"],
    });
    webSafety = await runM9WebSafetyProbe({ installationRoot: args.installationRoot, contract });
    stackProbe = await runM9StackProbe({
      installationRoot: args.installationRoot,
      configRoot: args.configRoot,
      piCommand,
      onlyMyPiRoot,
      contract,
    });
  }
  return Object.freeze({
    ...plan,
    status: probe?.status ?? audit?.status ?? "PASS",
    contractDigest: contract.contractDigest,
    ...(audit ? { audit } : {}),
    ...(probe ? { probe } : {}),
    ...(webSafety ? { webSafety } : {}),
    ...(stackProbe ? { stackProbe } : {}),
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseM9CompatibilityArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const result = await runM9Compatibility(args);
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${result.status}: ${result.action}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`m9-upstream-compatibility: ERROR ${error.code ?? "UNEXPECTED"}: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

export { HELP as M9_COMPATIBILITY_HELP, ROOT as REPOSITORY_ROOT };
