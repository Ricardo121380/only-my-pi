import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentRegistryError, createAgentReceipt, createAgentRegistry, validateAgentManifest } from "../packages/agent-registry/index.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);

test("agent registry discovers all runtime-ready roles and produces redacted receipts", async () => {
  const registry = createAgentRegistry({ rootDir: root });
  const agents = await registry.list();
  assert.deepEqual(agents.map((entry) => entry.rawId), [
    "debugger",
    "explorer",
    "implementer",
    "planner",
    "researcher",
    "reviewer",
    "scout",
    "security-reviewer",
    "source-verifier",
    "synthesizer",
    "test-analyst",
    "tester",
    "verifier",
  ]);
  const reviewer = await registry.resolve("reviewer");
  assert.equal(reviewer.manifest.writer, false);
  assert.equal(reviewer.receipt.agentId, "reviewer");
  assert.equal("content" in reviewer.receipt, false);
  assert.match(reviewer.receipt.sourceHash, /^sha256:/);
});

test("agent registry enforces profile capability and network ceilings", async () => {
  const registry = createAgentRegistry({
    rootDir: root,
    profile: { capabilityIds: ["workspace-read"], policy: { network: "deny-unless-explicit", workspace: "read-only" } },
  });
  await assert.rejects(() => registry.resolve("researcher"), (error) => error instanceof AgentRegistryError && error.code === "PROFILE_CAPABILITY_MISSING");
  await assert.rejects(() => registry.resolve("implementer"), (error) => error instanceof AgentRegistryError && error.code === "PROFILE_CAPABILITY_MISSING");
});

test("agent manifest validation rejects read-only mutation and prompt traversal", () => {
  const base = {
    formatVersion: 1,
    contractStatus: "runtime-ready",
    id: "bad",
    upstreamAgentId: "omp-bad",
    version: "1.0.0",
    description: "bad",
    prompt: { file: "../secret.md" },
    tools: { allow: ["bash"], deny: [] },
    allowedExecutionStates: ["review"],
    requiredCapabilities: [],
    policyCeiling: { workspace: "read-only", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" }, approval: "deny", mutation: "none" },
    modelRole: "fast",
    inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
    outputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] },
    writer: false,
    timeoutSeconds: 1,
    continuable: false,
    resumable: false,
    redaction: { rawPrompts: "omit", reasoning: "omit", credentials: "deny", maxOutputBytes: 1024 },
    gateIds: [],
  };
  const errors = validateAgentManifest({ $schema: "../schemas/agent-v1.schema.json", ...base });
  assert.ok(errors.some((error) => error.path === "/prompt/file"));
  assert.ok(errors.some((error) => error.path === "/writer"));
  assert.ok(errors.some((error) => error.path === "/policyCeiling/mutation"));
});

test("agent registry rejects symlinked prompt resources", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-registry-"));
  try {
    await fs.mkdir(path.join(temp, "agents"), { recursive: true });
    await fs.writeFile(path.join(temp, "secret.md"), "secret\n");
    await fs.symlink(path.join(temp, "secret.md"), path.join(temp, "agents", "prompt.md"));
    const manifest = {
      $schema: "../schemas/agent-v1.schema.json", formatVersion: 1, contractStatus: "runtime-ready", id: "x", upstreamAgentId: "omp-x", version: "1.0.0", description: "x",
      prompt: { file: "agents/prompt.md" }, tools: { allow: ["read"], deny: [] }, allowedExecutionStates: ["ask"], requiredCapabilities: [],
      policyCeiling: { workspace: "read-only", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" }, approval: "deny", mutation: "none" }, modelRole: "fast",
      inputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] }, outputSchema: { type: "object", additionalProperties: false, properties: {}, required: [] }, writer: false,
      timeoutSeconds: 1, continuable: false, resumable: false, redaction: { rawPrompts: "omit", reasoning: "omit", credentials: "deny", maxOutputBytes: 1024 }, gateIds: [],
    };
    await fs.writeFile(path.join(temp, "agents", "x.json"), JSON.stringify(manifest));
    const registry = createAgentRegistry({ rootDir: temp });
    await assert.rejects(() => registry.list(), (error) => error instanceof AgentRegistryError && error.code === "SYMLINK_ESCAPE");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("receipt creation refuses unresolved source hashes", () => {
  assert.throws(() => createAgentReceipt({ manifest: { id: "x" }, sourceHash: "nope" }), /unresolved agent/);
});
