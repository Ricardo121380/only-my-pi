import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSubagentsTopology,
  inspectSubagentsTopology,
  loadSubagentsTopologyDocuments,
} from "../packages/subagents/topology.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function documents() {
  return loadSubagentsTopologyDocuments(root);
}

test("static subagents topology proves one physical owner and one logical owner", () => {
  const report = assertSubagentsTopology(documents());
  assert.equal(report.status, "STATIC_TOPOLOGY_PASS");
  assert.equal(report.liveRuntime, "LIVE_NO_MODEL_CAPABILITY_PASS");
  assert.match(report.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.findings.length, 0);
  assert.ok(report.checks.every((entry) => entry.status === "PASS"));
});

test("topology rejects a second physical owner", () => {
  const input = documents();
  input.owners.owners.push({
    id: "rogue-runtime",
    capabilities: ["subagent-runtime"],
    resourceIds: [],
  });
  const report = inspectSubagentsTopology(input);
  assert.equal(report.status, "STATIC_TOPOLOGY_FAIL");
  assert.ok(report.findings.some((entry) => entry.code === "single-physical-runtime-owner"));
});

test("topology rejects a competing implemented subagent command", () => {
  const input = documents();
  input.commandOwners.commands.push({
    id: "subagents-run",
    surface: "pi-command",
    owner: "only-my-pi-subagent-orchestration",
    aliases: [],
    status: "implemented",
  });
  const report = inspectSubagentsTopology(input);
  assert.equal(report.status, "STATIC_TOPOLOGY_FAIL");
  assert.ok(report.findings.some((entry) => entry.code === "no-first-party-subagent-command-owner"));
});

test("topology rejects a wire contract that enables a second scheduler", () => {
  const input = documents();
  input.wire.topology.secondScheduler = true;
  const report = inspectSubagentsTopology(input);
  assert.equal(report.status, "STATIC_TOPOLOGY_FAIL");
  assert.ok(report.findings.some((entry) => entry.code === "wire-single-lane"));
});

test("topology rejects a tampered checked-in live evidence receipt", () => {
  const input = documents();
  input.liveEvidence.durationMs += 1;
  const report = inspectSubagentsTopology(input);
  assert.equal(report.status, "STATIC_TOPOLOGY_FAIL");
  assert.ok(report.findings.some((entry) => entry.code === "live-no-model-evidence"));
});

test("topology doctor reads repository declarations only and emits no runtime data", () => {
  const input = documents();
  const report = inspectSubagentsTopology(input);
  const text = JSON.stringify(report);
  assert.equal(text.includes("credential"), false);
  assert.equal(text.includes("session"), false);
  assert.equal(fs.existsSync(path.join(root, ".pi")), false);
});
