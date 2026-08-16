#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAgentRegistry } from "../packages/agent-registry/index.mjs";
import { createGateRunner } from "../packages/gate-runner/index.mjs";
import { createModeRegistry } from "../packages/mode-registry/index.mjs";
import { createWorkflowRegistry } from "../packages/workflow-core/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileFor = {
  inspect: "minimal", explore: "minimal", plan: "coding", coding: "coding", debug: "coding", review: "coding", research: "research", verify: "minimal",
};

function readProfile(id) { return JSON.parse(fs.readFileSync(path.join(root, "profiles", `${id}.json`), "utf8")); }

async function main() {
  const agents = createAgentRegistry({ rootDir: root });
  const agentDoctor = await agents.doctor();
  const gates = createGateRunner({ rootDir: root });
  const workflows = createWorkflowRegistry({ rootDir: root, gateRunner: gates });
  const workflowDoctor = await workflows.doctor();
  const modes = [];
  for (const id of Object.keys(profileFor)) {
    const registry = createModeRegistry({ rootDir: root, profile: readProfile(profileFor[id]) });
    try {
      const resolved = await registry.resolve(id);
      modes.push({ id, status: "PASS", hash: resolved.hash });
    } catch (error) {
      modes.push({ id, status: "FAIL", code: error.code ?? "MODE_ERROR", message: error.message });
    }
  }
  const output = { ok: agentDoctor.ok && workflowDoctor.ok && modes.every((mode) => mode.status === "PASS"), agents: agentDoctor, workflows: workflowDoctor, modes };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
}

main().catch((error) => { process.stderr.write(`doctor:modes: ${error.message}\n`); process.exitCode = 1; });
