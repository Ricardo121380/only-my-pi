#!/usr/bin/env node

import process from "node:process";

import {
  inspectSubagentsTopology,
  loadSubagentsTopologyDocuments,
} from "../packages/subagents/topology.mjs";

const rootArgIndex = process.argv.indexOf("--root");
const rootDir = rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : undefined;
if (rootArgIndex >= 0 && (!rootDir || rootDir.startsWith("-"))) {
  process.stderr.write("subagents-topology-doctor: --root requires a path\n");
  process.exit(2);
}

try {
  const documents = loadSubagentsTopologyDocuments(rootDir);
  const report = inspectSubagentsTopology(documents);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "STATIC_TOPOLOGY_PASS") process.exitCode = 1;
} catch (error) {
  process.stderr.write(`subagents-topology-doctor: ${error.message}\n`);
  process.exitCode = 1;
}
