import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createContextSnapshotProvider, createOmpRuntime } from "../extensions/omp-control/runtime.mjs";

const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;

function executionPlan({ runId = "run-daily", route = null, web = false, nodes = [], input = { task: "bounded task" } } = {}) {
  return {
    ok: true,
    status: "PLAN",
    runId,
    workflowId: "workflow-daily",
    input,
    authority: { web, webRoles: web ? ["researcher", "source-verifier"] : [] },
    plan: { planDigest: SHA_A, route, nodes, policy: { egress: { web: web ? "allow" : "deny" } } },
    executionEnvelope: { executionEnvelopeDigest: SHA_B, runInputDigest: SHA_C, conditions: ["session-idle"] },
    authorization: { authorizationDigest: SHA_B, inputDigest: SHA_C },
    request: { id: runId, taskDigest: SHA_C },
  };
}

function tui({ selections = [], editors = [], confirms = [] } = {}) {
  const notices = [];
  return {
    notices,
    ctx: {
      cwd: process.cwd(),
      mode: "tui",
      isIdle: () => true,
      isProjectTrusted: () => true,
      model: { provider: "provider", id: "model", cost: { input: 1, output: 2 } },
      modelRegistry: { async find(provider, id) { return { provider, id, cost: { input: 1, output: 2 } }; }, async hasConfiguredAuth() { return true; } },
      pi: { getActiveTools: () => ["read"], getAllTools: () => [{ name: "read" }, { name: "grep" }], getFlag: () => "ask" },
      ui: {
        theme: { name: "dark" },
        notify(text, level) { notices.push({ text, level }); },
        setStatus() {},
        getAllThemes: () => ["dark"],
        setTheme: (name) => ({ success: true, name }),
        async select() { return selections.shift(); },
        async editor() { return editors.shift(); },
        async confirm() { return confirms.length ? confirms.shift() : true; },
      },
    },
  };
}

test("daily /omp command matrix exposes every management surface without shell execution", async () => {
  const serviceCalls = [];
  const generic = (name, planner = false) => ({
    async dispatch(options) {
      serviceCalls.push({ name, options });
      if (planner && options.subcommand === "plan") return executionPlan({ runId: `${name}-run` });
      if (name === "agent" && options.subcommand === "list") return { ok: true, status: "AGENT_LIST", agents: [{ id: "reviewer" }] };
      return { ok: true, status: `${name.toUpperCase()}_${String(options.subcommand ?? "DISPATCH").toUpperCase()}`, mutation: false };
    },
  });
  const gateCalls = [];
  const projectGateService = {
    status: () => ({ ok: true, status: "PROJECT_GATE_TRUST_STATUS" }),
    reset: () => ({ ok: true, status: "PROJECT_GATE_TRUST_RESET" }),
    async plan(ids) { gateCalls.push(["plan", ids]); return { ok: true, status: "PROJECT_GATE_PLAN", warning: "process allowlist", binding: { gateIds: ids ?? ["unit"], bindingDigest: SHA_A } }; },
    async grant(plan) { gateCalls.push(["grant", plan.binding.gateIds]); return { ok: true, status: "PROJECT_GATE_TRUSTED" }; },
    async run(id) { gateCalls.push(["run", id]); return { ok: true, status: "PASS", gateId: id }; },
  };
  const runCalls = [];
  const runManagement = {
    async list() { runCalls.push("list"); return { ok: true, status: "RUN_LIST" }; },
    async show(id) { runCalls.push(`show:${id}`); return { ok: true, status: "RUN_SHOW" }; },
    async cancel(id) { runCalls.push(`cancel:${id}`); return { ok: true, status: "RUN_CANCELLED" }; },
    async resume(id) { runCalls.push(`resume:${id}`); return { ok: true, status: "RUN_COMPLETED" }; },
    async gcPlan() { runCalls.push("gc-plan"); return { ok: true, status: "RUN_GC_PLAN", candidates: [{ runId: "old" }], planDigest: SHA_A }; },
    async gcApply() { runCalls.push("gc-apply"); return { ok: true, status: "RUN_GC_APPLIED" }; },
  };
  const global = { formatVersion: 1, models: {}, budgets: {} };
  const dailyConfigService = {
    async resolve() { return { preset: { id: "daily" }, base: "core", overlays: [], hardOverlays: [], softOverlays: [], source: {}, models: { roles: {} }, budget: { maxChildren: 8, maxCostUsd: 0.25 } }; },
    async show(id) { return id === "missing" ? { ok: false, status: "PRESET_NOT_FOUND" } : { ok: true, status: id === "overlay" ? "OVERLAY_SHOW" : "PRESET_SHOW", item: { id, profileId: "daily" } }; },
    async readGlobal() { return global; },
    async save() { return { ok: true, status: "PREFERENCES_SAVED" }; },
    async reset() { return { ok: true, status: "PREFERENCES_RESET" }; },
  };
  const themeService = generic("theme");
  const runtime = createOmpRuntime({
    rootDir: process.cwd(),
    modeService: generic("mode"),
    agentService: generic("agent", true),
    workflowService: generic("workflow"),
    swarmService: generic("swarm"),
    ultraService: generic("ultra"),
    themeService,
    dailyConfigService,
    projectGateService,
    runManagement,
    statusService: { async snapshot() { return { status: "HARNESS_STATUS", provenance: "test" }; } },
  });
  const { ctx } = tui({ editors: ["plan task", "run task", "resume task", undefined, "{bad"], confirms: [true, true, true, true, false] });

  assert.equal((await runtime.execute("help", ctx)).status, "HELP");
  assert.equal((await runtime.execute("run unexpected", ctx)).status, "RUN_WIZARD_INVALID");
  assert.equal((await runtime.execute("mode doctor", ctx)).status, "MODE_DOCTOR");
  assert.equal((await runtime.execute("agent nonsense", ctx)).status, "AGENT_COMMAND_INVALID");
  assert.equal((await runtime.execute("agent list", ctx)).status, "AGENT_LIST");
  assert.equal((await runtime.execute("agent plan reviewer", ctx)).status, "PLAN");
  assert.equal((await runtime.execute("agent run reviewer", ctx)).status, "AGENT_RUN");
  assert.equal((await runtime.execute("agent status agent-run", ctx)).status, "AGENT_STATUS");
  assert.equal((await runtime.execute("agent resume agent-run", ctx)).status, "AGENT_RESUME");
  assert.equal((await runtime.execute("agent plan reviewer", { ui: { notify() {} } })).status, "AGENT_INPUT_UNAVAILABLE");

  assert.equal((await runtime.execute("gate trust status", ctx)).status, "PROJECT_GATE_TRUST_STATUS");
  assert.equal((await runtime.execute("gate trust reset", ctx)).status, "PROJECT_GATE_TRUST_RESET");
  assert.equal((await runtime.execute("gate trust nonsense", ctx)).status, "PROJECT_GATE_COMMAND_INVALID");
  assert.equal((await runtime.execute("gate trust", ctx)).status, "PROJECT_GATE_TRUSTED");
  assert.equal((await runtime.execute("gate plan unit integration", ctx)).status, "PROJECT_GATE_PLAN");
  assert.equal((await runtime.execute("gate run unit", ctx)).status, "PASS");
  assert.equal((await runtime.execute("gate invalid", ctx)).status, "PROJECT_GATE_COMMAND_INVALID");

  assert.equal((await runtime.execute("runs", ctx)).status, "RUN_LIST");
  assert.equal((await runtime.execute("runs show run-one", ctx)).status, "RUN_SHOW");
  assert.equal((await runtime.execute("runs cancel run-one", ctx)).status, "RUN_CANCELLED");
  assert.equal((await runtime.execute("runs resume run-one", ctx)).status, "RUN_COMPLETED");
  assert.equal((await runtime.execute("runs gc", ctx)).status, "RUN_GC_APPLIED");
  assert.equal((await runtime.execute("runs invalid", ctx)).status, "RUN_COMMAND_INVALID");

  assert.equal((await runtime.execute("theme show dark", ctx)).status, "THEME_SHOW");
  assert.equal((await runtime.execute("overlays invalid", ctx)).status, "OVERLAY_COMMAND_INVALID");
  assert.equal((await runtime.execute("overlays apply", ctx)).status, "OVERLAY_COMMAND_INVALID");
  assert.equal((await runtime.execute("overlays apply missing", ctx)).status, "PRESET_NOT_FOUND");
  assert.equal((await runtime.execute("overlays apply overlay", ctx)).status, "PRESET_REQUIRED");
  assert.equal((await runtime.execute("models invalid", ctx)).status, "MODEL_COMMAND_INVALID");
  assert.equal((await runtime.execute("models show", ctx)).status, "MODEL_CONFIGURATION_SHOW");
  assert.equal((await runtime.execute("models edit", ctx)).status, "MODEL_EDIT_CANCELLED");
  assert.equal((await runtime.execute("models edit", { ...ctx, ui: { ...ctx.ui, editor: async () => "{bad" } })).status, "MODEL_CONFIGURATION_INVALID");
  assert.equal((await runtime.execute("models reset", { ui: { notify() {} } })).status, "MODEL_RESET_UNAVAILABLE");
  assert.equal((await runtime.execute("models reset", { ...ctx, ui: { ...ctx.ui, confirm: async () => false } })).status, "MODEL_RESET_CANCELLED");

  assert.ok(gateCalls.length >= 4);
  assert.deepEqual(runCalls, ["list", "show:run-one", "cancel:run-one", "resume:run-one", "gc-plan", "gc-apply"]);
  assert.ok(serviceCalls.some((entry) => entry.name === "agent" && entry.options.subcommand === "run" && entry.options.yes === true));
});

test("workflow, swarm, goal, and Ultra confirmed runs reuse reviewed plans and Web grants", async () => {
  const grants = [];
  const webAuthorizer = {
    async plan(input) { return { ...input, status: "PUBLIC_WEB_APPROVAL_REQUIRED", roles: input.roles }; },
    async grant(plan) { grants.push(plan); return { status: "PUBLIC_WEB_AUTHORIZED" }; },
  };
  const configurationProvider = async () => ({ preset: { id: "daily" }, budget: { maxChildren: 8, maxCostUsd: 0.25 }, models: { roles: { researcher: { model: "provider/model" }, "source-verifier": { model: "provider/model" } } } });
  const calls = [];
  const workflowService = { async dispatch(options) { calls.push(["workflow", options]); return options.apply ? { ok: true, status: "WORKFLOW_COMPLETED" } : executionPlan({ runId: "workflow-run", web: true, nodes: [{ kind: "agent", agentTemplateRef: "researcher" }] }); } };
  const swarmService = { async dispatch(options) {
    calls.push(["swarm", options]);
    const operation = options.batchSubcommand ?? options.goalSubcommand ?? options.subcommand;
    if (operation === "plan") return executionPlan({ runId: options.subcommand === "goal" ? "goal-run" : "swarm-run", web: options.subcommand === "goal", nodes: [{ kind: "agent", agentTemplateRef: "researcher" }] });
    return { ok: true, status: options.subcommand === "goal" ? "SWARM_GOAL_COMPLETED" : options.subcommand === "batch" ? "BATCH_SWARM_COMPLETED" : "SWARM_COMPLETED" };
  } };
  const ultraService = { async dispatch(options) { calls.push(["ultra", options]); return options.subcommand === "plan" ? executionPlan({ runId: "ultra-run", route: "swarm-goal" }) : { ok: true, status: "ULTRA_COMPLETED" }; } };
  const runtime = createOmpRuntime({ rootDir: process.cwd(), workflowService, swarmService, ultraService, webAuthorizer, configurationProvider });
  const { ctx } = tui();
  assert.equal((await runtime.execute("workflow run source-review --apply --yes", ctx)).status, "WORKFLOW_COMPLETED");
  assert.equal((await runtime.execute("swarm run research --yes", ctx)).status, "SWARM_COMPLETED");
  assert.equal((await runtime.execute("swarm batch run review-items --yes", ctx)).status, "BATCH_SWARM_COMPLETED");
  assert.equal((await runtime.execute("swarm goal run research-goal --yes", ctx)).status, "SWARM_GOAL_COMPLETED");
  assert.equal((await runtime.execute("ultra run ultra-deep --yes", ctx)).status, "ULTRA_COMPLETED");
  assert.equal(grants.length, 3);
  assert.ok(calls.some(([kind, options]) => kind === "workflow" && options.inputFile === null && options.expectedPlanDigest === SHA_A));
  assert.ok(calls.some(([kind, options]) => kind === "swarm" && options.expectedAuthorizationDigest === SHA_B));
  assert.ok(calls.some(([kind, options]) => kind === "ultra" && options.expectedPlanDigest === SHA_A));
});

test("the /omp run wizard covers BatchSwarm, Workflow, SwarmGoal, and all Ultra task shapes", async () => {
  const completed = [];
  const swarmService = { async dispatch(options) {
    const operation = options.batchSubcommand ?? options.goalSubcommand;
    if (operation === "list") return options.subcommand === "batch" ? { batches: [{ id: "review-items" }] } : { goals: [{ id: "research-goal" }] };
    if (operation === "plan") return executionPlan({ runId: options.subcommand === "batch" ? "batch-wizard" : "goal-wizard", input: options.input });
    completed.push(options.subcommand); return { ok: true, status: options.subcommand === "batch" ? "BATCH_SWARM_COMPLETED" : "SWARM_GOAL_COMPLETED" };
  } };
  const workflowService = { async dispatch(options) {
    if (options.subcommand === "list") return { workflows: [{ id: "source-review", manifest: { mutationScope: "none" } }, { id: "writer", manifest: { mutationScope: "guarded" } }] };
    if (!options.apply) return executionPlan({ runId: "workflow-wizard", input: options.input });
    completed.push("workflow"); return { ok: true, status: "WORKFLOW_COMPLETED" };
  } };
  const ultraService = { async dispatch(options) {
    if (options.subcommand === "list") return { strategies: [{ id: "ultra-deep" }] };
    if (options.subcommand === "plan") return { ...executionPlan({ runId: options.input.id, route: options.input.dynamicGoal ? "swarm-goal" : options.input.preferredWorkflow ? "workflow" : "agent" }), request: options.input };
    completed.push("ultra"); return { ok: true, status: "ULTRA_COMPLETED" };
  } };
  const webAuthorizer = { async plan(input) { return { ...input, status: "PUBLIC_WEB_APPROVAL_REQUIRED" }; }, async grant() {} };
  const configurationProvider = async () => ({ preset: { id: "daily" }, budget: { maxChildren: 8 }, models: { roles: {} } });
  const runtime = createOmpRuntime({ rootDir: process.cwd(), swarmService, workflowService, ultraService, webAuthorizer, configurationProvider });
  const cases = [
    { selections: ["BatchSwarm", "Foreground", "review-items"], expected: "BATCH_SWARM_COMPLETED", scope: "package.json\nREADME.md" },
    { selections: ["Workflow", "Foreground", "source-review"], expected: "WORKFLOW_COMPLETED", scope: "." },
    { selections: ["SwarmGoal", "Foreground", "research-goal"], expected: "SWARM_GOAL_COMPLETED", scope: "." },
    { selections: ["Ultra", "Foreground", "ultra-deep", "Focused Agent"], expected: "ULTRA_COMPLETED", scope: "." },
    { selections: ["Ultra", "Foreground", "ultra-deep", "Structured Workflow"], expected: "ULTRA_COMPLETED", scope: "." },
    { selections: ["Ultra", "Foreground", "ultra-deep", "Dynamic SwarmGoal"], expected: "ULTRA_COMPLETED", scope: "." },
  ];
  for (const item of cases) {
    const { ctx } = tui({ selections: [...item.selections], editors: ["bounded objective", item.scope, "return verdict"] });
    assert.equal((await runtime.execute("run", ctx)).status, item.expected);
  }
  assert.equal(completed.filter((entry) => entry === "ultra").length, 3);
});

test("profile, package, context, verify, tools, safe, status, and snapshot helpers expose bounded local state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-runtime-daily-root-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "profiles"));
  await fs.mkdir(path.join(root, "inventory"));
  await fs.mkdir(path.join(root, "verification"));
  const profile = (id, packages, capabilities) => ({ id, description: id, packageIds: packages, capabilityIds: capabilities, policy: { id } });
  await fs.writeFile(path.join(root, "profiles", "one.json"), JSON.stringify(profile("one", ["a"], ["read"])));
  await fs.writeFile(path.join(root, "profiles", "two.json"), JSON.stringify(profile("two", ["b"], ["read", "web"])));
  await fs.writeFile(path.join(root, "inventory", "packages.lock.json"), JSON.stringify({ packages: [{ id: "a", spec: "npm:a@1.0.0", installed: true }], candidates: [{ id: "b", spec: "npm:b@1.0.0" }] }));
  await fs.writeFile(path.join(root, "verification", "release-gates-v1.json"), JSON.stringify({ id: "release-gates-v1", gates: [{ id: "lint" }] }));
  const snapshot = { messages: { count: 0 }, tools: { active: [] }, systemPrompt: {}, providerEstimate: null };
  const sessionDriver = { async readMode() { return { modeId: "inspect", hash: SHA_A, sourceHash: SHA_B }; } };
  const runtime = createOmpRuntime({ rootDir: root, snapshotProvider: () => snapshot, sessionDriver, getModeRestoreStatus: () => ({ status: "MODE_RESTORED" }), statusService: { async snapshot() { return { status: "HARNESS_STATUS" }; } }, modeService: { async dispatch() { return { ok: true, status: "MODE_DOCTOR_PASS" }; } } });
  const { ctx } = tui();
  assert.equal((await runtime.execute("profile list", ctx)).profiles.length, 2);
  assert.equal((await runtime.execute("profile show one", ctx)).status, "PROFILE_SHOW");
  assert.equal((await runtime.execute("profile diff one two", ctx)).changes.length, 3);
  assert.equal((await runtime.execute("profile show bad/id", ctx)).status, "PROFILE_UNAVAILABLE");
  assert.equal((await runtime.execute("profile show missing", ctx)).status, "PROFILE_NOT_FOUND");
  assert.equal((await runtime.execute("profile nope one", ctx)).status, "PROFILE_UNAVAILABLE");
  assert.equal((await runtime.execute("context", ctx)).status, "CONTEXT");
  assert.equal((await runtime.execute("packages", ctx)).packages.length, 2);
  assert.deepEqual((await runtime.execute("tools", ctx)).active, ["read"]);
  assert.equal((await runtime.execute("safe", ctx)).status, "SAFE_START_GUIDANCE");
  assert.equal((await runtime.execute("verify", ctx)).gateCount, 1);
  assert.equal((await runtime.execute("status", ctx)).harnessStatus.status, "HARNESS_STATUS");
  assert.equal((await runtime.execute("doctor", ctx)).status, "MODE_DOCTOR_PASS");

  const provider = createContextSnapshotProvider({ getState: () => ({ messages: [], ctx: { getContextUsage: () => ({ tokens: 1 }) }, systemPromptCharacters: 12, turnIndex: 3 }), pi: { getAllTools: () => [{ name: "read" }], getActiveTools: () => ["read"] } });
  assert.equal(provider().messages.count, 0);
  const unavailable = createOmpRuntime({ rootDir: path.join(root, "missing") });
  assert.equal((await unavailable.execute("context", ctx)).status, "CONTEXT_UNAVAILABLE");
  assert.equal((await unavailable.execute("packages", ctx)).status, "PACKAGES_UNAVAILABLE");
  assert.equal((await unavailable.execute("verify", ctx)).status, "VERIFY_UNAVAILABLE");
});
