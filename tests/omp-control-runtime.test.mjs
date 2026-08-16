import assert from "node:assert/strict";
import test from "node:test";

import { createModeReceipt } from "../packages/mode-registry/index.mjs";
import { createOmpRuntime, parseOmpCommand, restoreModeReceipt } from "../extensions/omp-control/runtime.mjs";

test("/omp parser is strict, bounded, and shell-free", () => {
  assert.deepEqual(parseOmpCommand(""), { command: "help", args: [] });
  assert.deepEqual(parseOmpCommand("mode show inspect"), { command: "mode", args: ["show", "inspect"] });
  assert.throws(() => parseOmpCommand("status; touch /tmp/pwn"), /unknown|quoted|shell/);
  assert.throws(() => parseOmpCommand("mode\nshow"), /bounded|single-line/);
  assert.throws(() => parseOmpCommand("unknown"), /unknown \/omp command/);
});

test("omp runtime exposes safe status/context and explicit unavailable commands", async () => {
  const notices = [];
  const ctx = { ui: { notify(text, level) { notices.push({ text, level }); } } };
  const runtime = createOmpRuntime({
    rootDir: "/tmp/only-my-pi",
    registry: {
      async list() { return [{ id: "inspect", version: "1.0.0" }]; },
      async doctor() { return { ok: true, status: "MODE_DOCTOR_PASS" }; },
    },
    snapshotProvider: () => ({ messages: { count: 0 }, tools: { active: [] }, systemPrompt: {}, providerEstimate: null }),
  });
  assert.equal((await runtime.execute("status", ctx)).status, "STATUS");
  assert.equal((await runtime.execute("context", ctx)).status, "CONTEXT");
  assert.equal((await runtime.execute("mode list", ctx)).status, "MODE_LIST");
  assert.equal((await runtime.execute("theme list", ctx)).status, "THEME_SERVICE_UNAVAILABLE");
  assert.ok(notices.length >= 4);
});

test("mode activation remains restart-required without a session driver", async () => {
  const runtime = createOmpRuntime({
    rootDir: "/tmp/only-my-pi",
    registry: {
      async resolve() { return { id: "inspect", executionState: "ask" }; },
    },
  });
  const result = await runtime.execute("mode use inspect", { ui: { notify() {} } });
  assert.equal(result.status, "RESTART_REQUIRED");
  assert.equal(result.mutation, false);
});

function receiptTarget(hash = "sha256:" + "a".repeat(64), sourceHash = "sha256:" + "b".repeat(64)) {
  return {
    formatVersion: 1,
    modeId: "inspect",
    hash,
    sourceHash,
    snapshot: {
      rawModeId: "inspect",
      resolved: {
        executionState: "ask",
        requires: { profileCapabilities: [], packages: [], enforcementSurfaces: [] },
        tools: { allow: ["read"], deny: ["write"], required: ["read"] },
        policy: { workspace: "read-only", approval: "deny", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" } },
        workflow: { default: "single-agent-safe", fallback: "single-agent-safe" },
        swarm: { allowed: false, defaultRecipe: null },
        completion: { gates: ["review"], requiresStructuredVerdict: true },
        risk: "low",
      },
      lineage: [{ id: "inspect", sourceHash }],
    },
    resolved: {
      executionState: "ask",
      requires: { profileCapabilities: [], packages: [], enforcementSurfaces: [] },
      tools: { allow: ["read"], deny: ["write"], required: ["read"] },
      policy: { workspace: "read-only", approval: "deny", egress: { web: "deny", mcp: "deny", provider: "inherit", extension: "deny" } },
      workflow: { default: "single-agent-safe", fallback: "single-agent-safe" },
      swarm: { allowed: false, defaultRecipe: null },
      completion: { gates: ["review"], requiresStructuredVerdict: true },
      risk: "low",
    },
    promptPayloads: [{ content: "prompt text must be supplied by the current registry", path: "/private/host/prompt.md" }],
  };
}

test("mode receipt restores only after current registry hash/source match", async () => {
  const target = receiptTarget();
  const receipt = createModeReceipt(target);
  const entries = [{ type: "custom", customType: "only-my-pi-mode", data: { receipt } }];
  const restored = await restoreModeReceipt({ registry: { resolve: async () => target }, entries });
  assert.equal(restored.status, "MODE_RESTORED");
  assert.equal(restored.target.promptPayloads[0].content.includes("current registry"), true);

  const stale = await restoreModeReceipt({
    registry: { resolve: async () => receiptTarget("sha256:" + "c".repeat(64), target.sourceHash) },
    entries,
  });
  assert.equal(stale.status, "STALE_MODE_SNAPSHOT");
  assert.equal(stale.target, undefined);

  const malformed = await restoreModeReceipt({
    registry: { resolve: async () => target },
    entries: [{ type: "custom", customType: "only-my-pi-mode", data: { receipt: { formatVersion: 1, modeId: "inspect" } } }],
  });
  assert.equal(malformed.status, "MODE_RECEIPT_IGNORED");
  assert.equal(malformed.code, "INVALID_MODE_RECEIPT");
});

test("runtime restore callback prepares the next-turn prompt but never trusts receipt text", async () => {
  const target = receiptTarget();
  const receipt = createModeReceipt(target);
  let restoredTarget;
  const runtime = createOmpRuntime({
    rootDir: "/tmp/only-my-pi",
    registry: { resolve: async () => target },
    onModeRestored: async (value) => { restoredTarget = value; },
  });
  const result = await runtime.restoreSession([{ type: "custom", customType: "only-my-pi-mode", data: { receipt } }]);
  assert.equal(result.status, "MODE_RESTORED");
  assert.equal(restoredTarget, target);
});

test("/omp swarm routes through the injected control service without starting a child", async () => {
  const calls = [];
  const runtime = createOmpRuntime({
    rootDir: "/tmp/only-my-pi",
    swarmService: { async dispatch(options) { calls.push(options); return { ok: true, status: "SWARM_PLAN", mutation: false }; } },
  });
  const result = await runtime.execute("swarm plan research-synthesis", { ui: { notify() {} } });
  assert.equal(result.status, "SWARM_PLAN");
  assert.deepEqual(calls, [{ subcommand: "plan", recipeId: "research-synthesis", runId: null, inputFile: null, yes: false, input: {} }]);
});

test("/omp theme routes public Pi UI theme methods and keeps apply explicit", async () => {
  const applied = [];
  const runtime = createOmpRuntime({
    rootDir: process.cwd(),
    themeService: {
      async dispatch(options) {
        if (options.apply) {
          applied.push(options.themeDriver.setTheme(options.subcommand === "reset" ? "dark" : options.themeId));
          return { ok: true, status: options.subcommand === "reset" ? "THEME_DISABLED" : "THEME_APPLIED", mutation: true };
        }
        return { ok: true, status: "THEME_PLAN", mutation: false, themeId: options.themeId };
      },
    },
  });
  const ui = { notify() {}, setTheme(name) { return { success: true, name }; }, getAllThemes() { return ["dark", "only-my-pi-dark"]; } };
  assert.equal((await runtime.execute("theme use only-my-pi-dark", { ui })).status, "THEME_PLAN");
  assert.equal((await runtime.execute("theme use only-my-pi-dark --apply --yes", { ui })).status, "THEME_APPLIED");
  assert.deepEqual(applied, [{ success: true, name: "only-my-pi-dark" }]);
});

test("/omp status retains legacy STATUS while adding the redacted harness projection", async () => {
  const runtime = createOmpRuntime({
    rootDir: process.cwd(),
    statusService: { async snapshot(input) { return { status: "HARNESS_STATUS", provenance: "injected-observations-only", theme: input.theme }; } },
  });
  const result = await runtime.execute("status", { mode: "tui", ui: { notify() {}, theme: { name: "only-my-pi-dark" } } });
  assert.equal(result.status, "STATUS");
  assert.equal(result.harnessStatus.status, "HARNESS_STATUS");
  assert.equal(result.harnessStatus.theme.id, "only-my-pi-dark");
});
