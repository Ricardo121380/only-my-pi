import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAgentRegistry } from "../packages/agent-registry/index.mjs";
import { hashResourcePath } from "../packages/bootstrap/graph-plan.mjs";
import {
  SessionBudgetGovernor,
  buildGoalProposal,
  createGovernedBackend,
  createNodeExecutor,
  createSessionRuntimeComposer,
  directAgentRunner,
  resolveBoundPackageRoot,
} from "../packages/subagents/runtime/session-composer.mjs";
import { agentTemplateFromRegistryEntry, createResolvedAgentSpec } from "../packages/subagents/domain/index.mjs";
import { createUltraRunRegistry } from "../packages/subagents/ultra-run/registry.mjs";
import { createUltraRunAuthorization } from "../packages/subagents/ultra-run/index.mjs";
import { createWorkflowRegistry } from "../packages/workflow-core/index.mjs";
import { createSwarmGoalRegistry } from "../packages/subagents/swarm-goal/registry.mjs";

const rootDir = process.cwd();

function configuration(overrides = {}) {
  return {
    budget: {
      maxConcurrency: 1,
      maxChildren: 2,
      maxWallSeconds: 30,
      maxTotalTokens: 100,
      maxCostUsd: 1,
      maxTurnsPerChild: 3,
      maxToolCallsPerChild: 4,
      maxTotalToolCalls: 8,
      maxOutputBytesPerChild: 65536,
      maxTotalOutputBytes: 131072,
      maxGoalRevisions: 2,
      maxDepth: 1,
      ...overrides,
    },
  };
}

function composedConfiguration({ web = false } = {}) {
  return {
    base: "core",
    preset: { id: "daily", profileId: "daily" },
    overlays: [{ id: "orchestration-readonly" }, ...(web ? [{ id: "web" }] : [])],
    hardOverlays: ["orchestration-readonly", ...(web ? ["web"] : [])],
    softOverlays: [],
    models: { default: { model: "inherit", thinking: "inherit", fallbackModels: [] }, roles: {} },
    pricingOverrides: {},
    budget: configuration().budget,
    source: { global: "test", project: "NOT_CONFIGURED", perRun: "none" },
  };
}

function injectedComposerDependencies(config, calls = []) {
  const transport = { dispose() { calls.push("transport-dispose"); } };
  const backend = { capabilityMatrix: {}, async dispose() { calls.push("backend-dispose"); } };
  const coordinator = { async shutdown() { calls.push("coordinator-shutdown"); } };
  return {
    dailyConfig: { async resolve() { return config; } },
    subagentsPackage: { root: "/tmp/pi-subagents-fixture", manifest: { name: "pi-subagents", version: "0.45.2" } },
    transport,
    webPolicy: { status: "PUBLIC_WEB_SSRF_GUARDED" },
    webAuthorizer: { dispose() { calls.push("web-dispose"); } },
    projectGateService: { async dispose() { calls.push("gate-dispose"); } },
    backend,
    governedBackend: backend,
    eventJournal: {},
    planStore: {},
    artifactStore: {},
    boundedArtifactStore: {},
    budgetLedger: {},
    agentRegistry: {},
    batchRuntime: { registry: {} },
    nodeExecutor: {},
    rawCoordinator: coordinator,
    managedCoordinator: coordinator,
    recordStore: {},
    runContextProvider: async () => ({ sessionId: "session", repository: { root: rootDir, head: null }, configurationDigest: `sha256:${"0".repeat(64)}` }),
    runManagement: {},
    runDirectAgent: async () => ({}),
    goalPlanner: async () => ({}),
    executeGoalRevision: async () => ({}),
    rawGoalController: {},
    recordedGoalController: {},
    workflowRegistry: {},
    goalRegistry: {},
    batchControl: {},
    rawUltraRouter: {},
    recordedUltraRouter: {},
    registerCapabilityCeiling() { calls.push("ceiling-register"); return { dispose() { calls.push("ceiling-dispose"); } }; },
  };
}

async function temporary(t, prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("bound package resolution validates external trees and managed generation roots", async (t) => {
  const configRoot = await temporary(t, "omp-bound-package-");
  const externalRoot = path.join(configRoot, "npm", "node_modules", "pi-subagents");
  await fs.mkdir(externalRoot, { recursive: true });
  await fs.writeFile(path.join(externalRoot, "package.json"), JSON.stringify({ name: "pi-subagents", version: "0.45.2" }));
  const physicalRootDigest = `sha256:${await hashResourcePath({ artifactRoot: path.join(configRoot, "npm"), relativePath: "node_modules/pi-subagents", allowContainedSymlinks: true })}`;
  const settings = {
    onlyMyPi: {
      packageBindings: [{ id: "subagents", binding: "external", owner: "user", name: "pi-subagents", resolvedVersion: "0.45.2", physicalRootDigest }],
      managedSettings: { packages: [] },
    },
  };
  await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify(settings));
  assert.equal((await resolveBoundPackageRoot({ configRoot, packageId: "subagents" })).root, externalRoot);

  settings.onlyMyPi.packageBindings[0].physicalRootDigest = `sha256:${"0".repeat(64)}`;
  await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify(settings));
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "subagents" }), { code: "RUNTIME_PACKAGE_DRIFT" });

  const managedRoot = path.join(configRoot, "only-my-pi", "generations", "generation", "packages", "bundle");
  await fs.mkdir(managedRoot, { recursive: true });
  await fs.writeFile(path.join(managedRoot, "package.json"), JSON.stringify({ name: "only-my-pi-agent-bundle", version: "0.0.0" }));
  settings.onlyMyPi.packageBindings = [{ id: "agent-bundle", binding: "managed", name: "only-my-pi-agent-bundle", resolvedVersion: "0.0.0" }];
  settings.onlyMyPi.managedSettings.packages = [{ source: "./only-my-pi/generations/generation/packages/bundle" }];
  await fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify(settings));
  assert.equal((await resolveBoundPackageRoot({ configRoot, packageId: "agent-bundle" })).root, managedRoot);
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "missing" }), { code: "RUNTIME_PACKAGE_BINDING_MISSING" });
  await assert.rejects(resolveBoundPackageRoot({ configRoot: "relative", packageId: "missing" }), TypeError);
});

test("bound package resolution rejects malformed settings, identities, binding kinds, and unsafe roots", async (t) => {
  const configRoot = await temporary(t, "omp-bound-package-negative-");
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "missing" }), { code: "RUNTIME_PACKAGE_BINDING_MISSING" });
  await fs.writeFile(path.join(configRoot, "settings.json"), "{bad");
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "missing" }), { code: "RUNTIME_FILE_INVALID" });

  const writeSettings = (binding, packages = []) => fs.writeFile(path.join(configRoot, "settings.json"), JSON.stringify({ onlyMyPi: { packageBindings: [binding], managedSettings: { packages } } }));
  await writeSettings({ id: "package", binding: "external" });
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "package" }), { code: "RUNTIME_PACKAGE_BINDING_INVALID" });
  await writeSettings({ id: "package", binding: "unknown", name: "package", resolvedVersion: "1.0.0" });
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "package" }), { code: "RUNTIME_PACKAGE_BINDING_INVALID" });

  const packageRoot = path.join(configRoot, "npm", "node_modules", "package");
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ name: "wrong", version: "1.0.0" }));
  await writeSettings({ id: "package", binding: "external", owner: "user", name: "package", resolvedVersion: "1.0.0", physicalRootDigest: `sha256:${"0".repeat(64)}` });
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "package" }), { code: "RUNTIME_PACKAGE_DRIFT" });

  await writeSettings({ id: "package", binding: "managed", name: "package", resolvedVersion: "1.0.0" }, [null, "npm:package@1.0.0", { source: "./elsewhere" }, { source: "./only-my-pi/generations/missing" }]);
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "package" }), { code: "RUNTIME_PACKAGE_BINDING_MISSING" });

  await fs.rm(packageRoot, { recursive: true });
  await fs.symlink(configRoot, packageRoot);
  await writeSettings({ id: "package", binding: "external", owner: "user", name: "package", resolvedVersion: "1.0.0", physicalRootDigest: `sha256:${"0".repeat(64)}` });
  await assert.rejects(resolveBoundPackageRoot({ configRoot, packageId: "package" }), { code: "RUNTIME_PACKAGE_UNSAFE" });
});

test("session budget governor queues fairly, aborts waiters, charges usage once, and fails closed on overruns", async () => {
  const governor = new SessionBudgetGovernor(async () => configuration());
  const first = await governor.acquire("run-one");
  const waiting = governor.acquire("run-two");
  await new Promise((resolve) => setImmediate(resolve));
  governor.releaseSlot();
  const second = await waiting;
  assert.equal(first.budgetRunId, "run-one");
  assert.equal(second.budgetRunId, "run-two");
  governor.releaseSlot();

  const abortGovernor = new SessionBudgetGovernor(async () => configuration());
  await abortGovernor.acquire("run-a");
  const controller = new AbortController();
  const aborted = abortGovernor.acquire("run-b", controller.signal);
  controller.abort();
  await assert.rejects(aborted, { code: "CANCEL_REQUESTED" });
  abortGovernor.releaseSlot();

  const handle = { handleId: "handle-one", local: { runId: "budget-run" } };
  const terminal = { authoritative: true, outcome: "completed", receiptId: "receipt", completion: { usage: { total: 60, costUsd: 0.6 } } };
  const charged = governor.finalize(handle, terminal, configuration().budget, "budget-run");
  assert.equal(governor.finalize(handle, terminal, configuration().budget, "budget-run"), charged);
  const overrun = governor.finalize({ handleId: "handle-two", local: { runId: "budget-run" } }, terminal, configuration().budget, "budget-run");
  assert.equal(overrun.outcome, "budget-exhausted");
  assert.equal(overrun.error.code, "RUN_BUDGET_OVERRUN");
  assert.deepEqual(overrun.error.overruns, [
    { resource: "tokens", limit: 100, observed: 120 },
    { resource: "cost", limit: 1, observed: 1.2 },
  ]);

  const children = new SessionBudgetGovernor(async () => configuration({ maxChildren: 1 }));
  await children.acquire("child-limit");
  await assert.rejects(children.acquire("child-limit"), { code: "BUDGET_EXHAUSTED" });
  children.releaseSlot();
  children.dispose();
  await assert.rejects(children.acquire("disposed"), { code: "SESSION_RUNTIME_DISPOSED" });
  abortGovernor.dispose();
  governor.dispose();
});

test("session budget governor handles immediate parallel slots, missing usage, alternate usage names, and disposal waiters", async () => {
  const parallel = new SessionBudgetGovernor(async () => configuration({ maxConcurrency: 2, maxChildren: 4 }));
  await parallel.acquire("parallel");
  await parallel.acquire("parallel");
  const missingUsage = parallel.finalize({ handleId: "missing-usage", local: { runId: "parallel" } }, { receiptId: "one" }, configuration({ maxConcurrency: 2, maxChildren: 4 }).budget, "parallel");
  assert.equal(missingUsage.receiptId, "one");
  const alternateUsage = parallel.finalize({ handleId: "alternate-usage", local: { runId: "alternate" } }, { receiptId: "two", completion: { usage: { tokens: 1, cost: 0.01 } } }, configuration({ maxConcurrency: 2, maxChildren: 4 }).budget, "alternate");
  assert.equal(alternateUsage.receiptId, "two");

  const disposal = new SessionBudgetGovernor(async () => configuration());
  await disposal.acquire("active");
  const waiting = disposal.acquire("waiting");
  await new Promise((resolve) => setImmediate(resolve));
  disposal.dispose();
  await assert.rejects(waiting, { code: "SESSION_RUNTIME_DISPOSED" });
  parallel.dispose();
});

test("governed backend injects per-child limits and closes every terminal/control path exactly once", async () => {
  const calls = [];
  const terminal = { authoritative: true, outcome: "completed", receiptId: "receipt", completion: { usage: { total: 10, costUsd: 0.1 } } };
  const base = {
    capabilityMatrix: { version: 1 },
    ensureReady(options) { calls.push(["ready", options]); return "ready"; },
    async launch(options) { calls.push(["launch", options]); return { handle: options.handle, binding: { bindingId: "binding" } }; },
    async awaitTerminal(handle) { calls.push(["terminal", handle]); return terminal; },
    status(handle) { calls.push(["status", handle]); return { status: "running" }; },
    steer(handle, message) { calls.push(["steer", handle, message]); return { status: "steered" }; },
    async interrupt(handle) { calls.push(["interrupt", handle]); return { terminal }; },
    async stop(handle) { calls.push(["stop", handle]); return { status: "stopping" }; },
    resume(handle) { calls.push(["resume", handle]); return { handle }; },
    async dispose() { calls.push(["dispose"]); return { status: "disposed" }; },
  };
  const backend = createGovernedBackend(base, async () => configuration());
  const handle = { handleId: "governed-handle", local: { runId: "governed-run" } };
  assert.equal(backend.ensureReady({ ping: true }), "ready");
  const launched = await backend.launch({ handle });
  assert.equal(calls.find(([name]) => name === "launch")[1].maximumTurns, 3);
  assert.equal(calls.find(([name]) => name === "launch")[1].maximumToolCalls, 4);
  assert.equal((await backend.awaitTerminal(launched.handle)).outcome, "completed");
  assert.equal(backend.status(handle).status, "running");
  assert.equal(backend.steer(handle, "bounded").status, "steered");
  assert.equal((await backend.interrupt(handle)).terminal.outcome, "completed");
  assert.equal((await backend.stop(handle)).status, "stopping");
  assert.equal(backend.resume(handle).handle, handle);
  assert.equal((await backend.dispose()).status, "disposed");

  const failing = createGovernedBackend({ ...base, async launch() { throw Object.assign(new Error("launch failed"), { code: "LAUNCH_FAILED" }); } }, async () => configuration());
  await assert.rejects(failing.launch({ handle: { handleId: "failure", local: { runId: "failure" } } }), { code: "LAUNCH_FAILED" });
  await failing.dispose();
});

test("governed backend accepts only resolver ceilings that monotonically narrow the configured budget", async () => {
  const launches = [];
  const base = {
    capabilityMatrix: {},
    async launch(options) { launches.push(options); return { handle: options.handle, binding: { bindingId: "binding" } }; },
    async awaitTerminal() { return { authoritative: true, outcome: "completed", receiptId: "receipt", completion: { usage: { total: 1, costUsd: 0.01 } } }; },
    async dispose() {},
  };
  const handle = { handleId: "resolver-handle", local: { runId: "resolver-run" } };
  const narrowed = createGovernedBackend(base, async () => configuration(), { toolCallLimitResolver: () => 0, turnLimitResolver: () => 2 });
  const started = await narrowed.launch({ handle, agentSpec: { templateId: "reviewer" } });
  assert.equal(launches[0].maximumToolCalls, 0);
  assert.equal(launches[0].maximumTurns, 2);
  await narrowed.awaitTerminal(started.handle);
  await narrowed.dispose();

  const toolsWidened = createGovernedBackend(base, async () => configuration(), { toolCallLimitResolver: ({ budget }) => budget.maxToolCallsPerChild + 1 });
  await assert.rejects(toolsWidened.launch({ handle: { handleId: "bad-tools", local: { runId: "bad-tools" } } }), { code: "TOOL_BUDGET_RESOLVER_INVALID" });
  await toolsWidened.dispose();
  const turnsWidened = createGovernedBackend(base, async () => configuration(), { turnLimitResolver: ({ budget }) => budget.maxTurnsPerChild + 1 });
  await assert.rejects(turnsWidened.launch({ handle: { handleId: "bad-turns", local: { runId: "bad-turns" } } }), { code: "TURN_BUDGET_RESOLVER_INVALID" });
  await turnsWidened.dispose();
});

test("node executor enforces read-only agents, Web grants, artifact context, and BatchSwarm child ceilings", async () => {
  const agentRegistry = createAgentRegistry({ rootDir });
  const launches = [];
  const terminal = { authoritative: true, outcome: "completed", receiptId: "receipt", result: { verdict: "pass" }, completion: { usage: { total: 1, costUsd: 0.01 } } };
  const backend = {
    async launch(options) { launches.push(options); return { handle: options.handle, binding: { bindingId: "binding" } }; },
    async awaitTerminal() { return terminal; },
    async stop() { return { terminal }; },
  };
  const batchCalls = [];
  const batchRuntime = { nodeExecutor: {
    async prepareBatch() { batchCalls.push("prepare"); return { itemCount: 2 }; },
    async runBatch(node) { batchCalls.push(node.budget); return { outcome: "completed" }; },
  } };
  const webCalls = [];
  const webAuthorizer = { require(runId, role) { webCalls.push({ runId, role }); } };
  const artifactStore = { async read() { return Buffer.from("upstream evidence"); } };
  const dynamicSpecs = new Map();
  const executor = await createNodeExecutor({ agentRegistry, backend, batchRuntime, artifactStore, configurationProvider: async () => configuration(), dynamicSpecs, webAuthorizer });
  const node = { id: "review", agentTemplateRef: "reviewer", budget: { timeoutMs: 5000, maxOutputBytes: 65536, maxTokens: 10, maxCostUsd: 0.1 } };
  const context = { runId: "node-run", attemptId: "attempt-one", input: { task: "Review", scope: ["package.json"], acceptance: "verdict" }, artifactRefs: [{ id: "art-one", digest: `sha256:${"1".repeat(64)}`, byteLength: 17 }] };
  const started = await executor.startAgent(node, context);
  assert.equal((await started.terminal).outcome, "completed");
  assert.match(launches[0].assignment.task.text, /Upstream artifacts/u);
  assert.deepEqual(launches[0].assignment.context.artifactRefs, ["art-one"]);
  assert.equal(launches[0].assignment.budget.maxTokens, node.budget.maxTokens);
  assert.equal(launches[0].assignment.budget.maxCostUsd, node.budget.maxCostUsd);

  await executor.startAgent({ ...node, id: "research", agentTemplateRef: "researcher" }, { ...context, runId: "web-run", artifactRefs: [] });
  assert.deepEqual(webCalls, [{ runId: "web-run", role: "researcher" }]);
  assert.equal((await executor.prepareBatch({ id: "batch" }, context)).itemCount, 2);
  assert.equal((await executor.runBatch({ id: "batch", budget: {} }, { ...context, prepared: { itemCount: 2 } })).outcome, "completed");
  assert.equal(batchCalls.length, 2);
  assert.equal((await executor.stop({ handleId: "node" }, {})).terminal, terminal);
  assert.equal(executor.proveWriterDead(), false);

  const strictExecutor = await createNodeExecutor({ agentRegistry, backend, batchRuntime: { nodeExecutor: { async prepareBatch() { return { itemCount: 3 }; }, async runBatch() {} } }, artifactStore, configurationProvider: async () => configuration({ maxChildren: 2 }), dynamicSpecs, webAuthorizer });
  await assert.rejects(strictExecutor.prepareBatch({ id: "batch" }, context), { code: "BUDGET_EXHAUSTED" });
  await assert.rejects(strictExecutor.runBatch({ id: "batch", budget: {} }, { ...context, prepared: { itemCount: 3 } }), { code: "BUDGET_EXHAUSTED" });
});

test("node executor uses dynamic specs, default task bounds, explicit batch budgets, and rejects writer or oversized tasks", async () => {
  const realRegistry = createAgentRegistry({ rootDir });
  const reviewer = await realRegistry.resolve("reviewer");
  const dynamicSpec = createResolvedAgentSpec({ template: agentTemplateFromRegistryEntry(reviewer), runtimeMode: "REGISTERED_ROLES_ONLY" });
  const launches = [];
  const backend = {
    async launch(options) { launches.push(options); return { handle: options.handle, binding: { bindingId: "binding" } }; },
    async awaitTerminal() { return { authoritative: true, outcome: "completed", receiptId: "receipt" }; },
    async stop() { return {}; },
  };
  const batchBudgets = [];
  const batchRuntime = { nodeExecutor: { async prepareBatch() { return { itemCount: 1 }; }, async runBatch(node) { batchBudgets.push(node.budget); return { outcome: "completed" }; } } };
  const dynamicSpecs = new Map([["dynamic-run", new Map([["dynamic-reviewer", dynamicSpec]])]]);
  const executor = await createNodeExecutor({ agentRegistry: realRegistry, backend, batchRuntime, artifactStore: { async read() { return Buffer.alloc(0); } }, configurationProvider: async () => configuration(), dynamicSpecs, webAuthorizer: { require() {} } });
  const node = { id: "dynamic", agentTemplateRef: "dynamic-reviewer", budget: { timeoutMs: 5000, maxOutputBytes: 1024, maxTokens: 7, maxCostUsd: 0.07 } };
  await executor.startAgent(node, { runId: "dynamic-run", attemptId: "attempt", input: {}, artifactRefs: [] });
  assert.match(launches[0].assignment.task.text, /Perform the declared read-only/u);
  await executor.runBatch({ id: "batch", budget: { maxTokens: 9, maxCostUsd: 0.09 } }, { runId: "dynamic-run" });
  assert.equal(batchBudgets[0].maxTokens, 9);
  assert.equal(batchBudgets[0].maxCostUsd, 0.09);

  const oversized = { ...node, agentTemplateRef: "reviewer" };
  await assert.rejects(executor.startAgent(oversized, { runId: "too-large", attemptId: "attempt", input: { task: "x".repeat(129 * 1024) }, artifactRefs: [] }), { code: "AGENT_TASK_TOO_LARGE" });
  const writerRegistry = { async resolve() { return { manifest: { writer: true, tools: { allow: ["write"] } } }; } };
  const writerExecutor = await createNodeExecutor({ agentRegistry: writerRegistry, backend, batchRuntime, artifactStore: { async read() {} }, configurationProvider: async () => configuration(), dynamicSpecs: new Map(), webAuthorizer: { require() {} } });
  await assert.rejects(writerExecutor.startAgent({ ...node, agentTemplateRef: "writer" }, { runId: "writer", attemptId: "attempt", input: {}, artifactRefs: [] }), { code: "WRITER_UNAVAILABLE_IN_READONLY_MILESTONE" });
});

test("direct Agent runner preserves a safe backend terminal error code", async () => {
  const agentRegistry = createAgentRegistry({ rootDir });
  const runner = directAgentRunner({
    agentRegistry,
    backend: {
      async launch({ handle }) { return { handle, binding: { bindingId: "binding" } }; },
      async awaitTerminal() { return { authoritative: true, outcome: "failed", error: { code: "DELEGATION_CHILD_FAILED_TOOL" } }; },
    },
    configurationProvider: async () => configuration(),
    webAuthorizer: { require() {} },
  });
  await assert.rejects(runner({ role: "reviewer", task: "bounded", runId: "direct-error", nodeId: "node" }), { code: "DELEGATION_CHILD_FAILED_TOOL" });
});

test("composer disables orchestration before package resolution when the hard overlay is absent", async (t) => {
  const configRoot = await temporary(t, "omp-disabled-composer-");
  const dailyConfig = { async resolve() { return { hardOverlays: [], budget: configuration().budget }; } };
  const composer = await createSessionRuntimeComposer({
    pi: {},
    rootDir,
    configRoot,
    getContext: () => ({ cwd: rootDir, isProjectTrusted: () => false }),
    dependencies: { dailyConfig },
  });
  assert.equal(composer.enabled, false);
  assert.equal(composer.status, "ORCHESTRATION_OVERLAY_DISABLED");
  assert.equal(await composer.dispose(), undefined);
  await assert.rejects(fs.lstat(path.join(configRoot, "only-my-pi")), { code: "ENOENT" });
});

test("composer validates construction arguments before touching disk", async () => {
  await assert.rejects(createSessionRuntimeComposer({ rootDir: "relative", configRoot: "/tmp/config", getContext() {} }), TypeError);
  await assert.rejects(createSessionRuntimeComposer({ rootDir, configRoot: "relative", getContext() {} }), TypeError);
  await assert.rejects(createSessionRuntimeComposer({ rootDir, configRoot: "/tmp/config", getContext: null }), TypeError);
});

test("Goal maker selection is restricted to the two registered research roles", () => {
  const plannerResult = { questions: ["one", "two"], coverage: 0.5, progress: 0.5, coveredDimensions: ["one"], remainingDimensions: ["two"], decision: "replan", reason: "bounded" };
  const context = { revision: 0, settledNodes: [] };
  const proposal = buildGoalProposal(plannerResult, context, configuration().budget, { makerTemplateSelector: () => "source-verifier" });
  assert.equal(proposal.agentIntents[0].templateId, "source-verifier");
  const offline = buildGoalProposal(plannerResult, context, configuration().budget, { makerTemplateSelector: () => "reviewer", webEnabled: false });
  assert.equal(offline.agentIntents[0].templateId, "reviewer");
  assert.equal(offline.workflowDefinition.policy.egress.web, "deny");
  assert.deepEqual(offline.workflowDefinition.flow.steps[0].policy.tools.deny, ["bash", "edit", "write", "web"]);
  const revisionTokens = configuration().budget.maxTotalTokens / configuration().budget.maxGoalRevisions;
  assert.equal(offline.workflowDefinition.flow.steps[0].budget.maxTokens, Math.floor(revisionTokens * 0.34));
  assert.equal(offline.workflowDefinition.flow.steps[1].budget.maxTokens, Math.floor(revisionTokens * 0.33));
  assert.equal(offline.workflowDefinition.flow.steps[2].budget.maxTokens, Math.floor(revisionTokens * 0.33));
  assert.ok(offline.workflowDefinition.flow.steps.reduce((sum, step) => sum + step.budget.maxTokens, 0) <= revisionTokens);
  const verifiedReuse = buildGoalProposal(plannerResult, context, configuration().budget, { makerTemplateSelector: () => "reviewer", webEnabled: false, executionBudgetDivisor: 1 });
  assert.equal(verifiedReuse.workflowDefinition.budget.maxTokens, configuration().budget.maxTotalTokens);
  assert.equal(verifiedReuse.workflowDefinition.flow.steps.reduce((sum, step) => sum + step.budget.maxTokens, 0), configuration().budget.maxTotalTokens);
  assert.throws(() => buildGoalProposal(plannerResult, context, configuration().budget, { makerTemplateSelector: () => "reviewer" }), { code: "GOAL_MAKER_SELECTOR_INVALID" });
  assert.throws(() => buildGoalProposal(plannerResult, context, configuration().budget, { webEnabled: "no" }), { code: "GOAL_WEB_SELECTOR_INVALID" });
  assert.throws(() => buildGoalProposal(plannerResult, context, configuration().budget, { executionBudgetDivisor: 3 }), { code: "GOAL_EXECUTION_BUDGET_DIVISOR_INVALID" });
});

test("composer accepts every injected session service and disposes their public handles once", async (t) => {
  const configRoot = await temporary(t, "omp-injected-composer-");
  const calls = [];
  const dependencies = injectedComposerDependencies(composedConfiguration(), calls);
  const composer = await createSessionRuntimeComposer({
    pi: {},
    rootDir,
    configRoot,
    getContext: () => ({ cwd: rootDir, isProjectTrusted: () => false, sessionManager: { getSessionId: () => "injected-session" } }),
    dependencies,
  });
  assert.equal(composer.transport, dependencies.transport);
  assert.equal(composer.backend, dependencies.governedBackend);
  assert.equal(composer.coordinator, dependencies.managedCoordinator);
  assert.equal(composer.goalController, dependencies.recordedGoalController);
  assert.equal(composer.ultraRouter, dependencies.recordedUltraRouter);
  assert.equal((await composer.dispose()).status, "DISPOSED");
  assert.equal((await composer.dispose()).status, "DISPOSED");
  assert.deepEqual(calls, ["ceiling-register", "coordinator-shutdown", "ceiling-dispose", "backend-dispose", "transport-dispose", "web-dispose", "gate-dispose"]);
});

test("composer fails closed on missing session identity, missing Web entry, and unavailable ceiling loader", async (t) => {
  const missingSessionRoot = await temporary(t, "omp-missing-session-");
  const missingSession = injectedComposerDependencies(composedConfiguration());
  await assert.rejects(createSessionRuntimeComposer({ pi: {}, rootDir, configRoot: missingSessionRoot, getContext: () => ({ cwd: rootDir }), dependencies: missingSession }), { code: "PI_SESSION_ID_UNAVAILABLE" });

  const webRoot = await temporary(t, "omp-missing-web-entry-");
  const webDependencies = injectedComposerDependencies(composedConfiguration({ web: true }));
  webDependencies.webPackage = { root: webRoot, manifest: { name: "pi-web-access", version: "0.20.0", pi: { extensions: [] } } };
  await assert.rejects(createSessionRuntimeComposer({ pi: {}, rootDir, configRoot: webRoot, getContext: () => ({ cwd: rootDir, sessionManager: { getSessionId: () => "web-session" } }), dependencies: webDependencies }), { code: "WEB_EXTENSION_ENTRY_UNAVAILABLE" });

  const loaderRoot = await temporary(t, "omp-missing-ceiling-loader-");
  await fs.writeFile(path.join(loaderRoot, "package.json"), JSON.stringify({ name: "pi-subagents", version: "0.45.2" }));
  const loaderDependencies = injectedComposerDependencies(composedConfiguration());
  loaderDependencies.subagentsPackage = { root: loaderRoot, manifest: { name: "pi-subagents", version: "0.45.2" } };
  delete loaderDependencies.registerCapabilityCeiling;
  await assert.rejects(createSessionRuntimeComposer({ pi: {}, rootDir, configRoot: loaderRoot, getContext: () => ({ cwd: rootDir, sessionManager: { getSessionId: () => "loader-session" } }), dependencies: loaderDependencies }), { code: "CAPABILITY_CEILING_LOADER_UNAVAILABLE" });

  const divisorRoot = await temporary(t, "omp-invalid-goal-divisor-");
  const divisorDependencies = injectedComposerDependencies(composedConfiguration());
  divisorDependencies.goalExecutionBudgetDivisor = 1;
  await assert.rejects(createSessionRuntimeComposer({ pi: {}, rootDir, configRoot: divisorRoot, getContext: () => ({ cwd: rootDir, sessionManager: { getSessionId: () => "divisor-session" } }), dependencies: divisorDependencies }), { code: "GOAL_EXECUTION_BUDGET_DIVISOR_INVALID" });
});

test("raw Ultra executors preserve failed planning, awaiting approval, blocked verification, and legacy workflow routes", async (t) => {
  const configRoot = await temporary(t, "omp-ultra-branches-");
  const dependencies = injectedComposerDependencies(composedConfiguration());
  delete dependencies.rawUltraRouter;
  delete dependencies.recordedUltraRouter;
  let batchMode = "plan-failed";
  dependencies.batchControl = {
    async dispatch() {
      if (batchMode === "plan-failed") return { ok: false, code: "BATCH_PLAN_FAILED" };
      return { ok: true, runId: `batch-${batchMode}`, input: {}, plan: { planDigest: `sha256:${"1".repeat(64)}` }, executionEnvelope: {}, expansion: { itemCount: 7 } };
    },
  };
  let projectionStatus = "awaiting-approval";
  dependencies.managedCoordinator = {
    async execute(_plan, options) { return { runId: options.runId, status: projectionStatus, terminal: { status: projectionStatus }, nodes: {} }; },
    async shutdown() {},
  };
  dependencies.rawCoordinator = dependencies.managedCoordinator;
  dependencies.workflowRegistry = createWorkflowRegistry({ rootDir });
  dependencies.goalRegistry = createSwarmGoalRegistry({ rootDir });
  dependencies.recordedGoalController = { async run() { return { runId: "goal-child", status: projectionStatus, terminal: null, revisions: [] }; } };
  dependencies.runDirectAgent = async ({ role }) => ({ receiptId: `receipt-${role}`, result: role === "verifier" ? { verdict: "unknown" } : { summary: "maker" } });
  const composer = await createSessionRuntimeComposer({ pi: {}, rootDir, configRoot, getContext: () => ({ cwd: rootDir, sessionManager: { getSessionId: () => "ultra-branch-session" } }), dependencies });
  const strategy = (await createUltraRunRegistry({ rootDir }).resolve("ultra-deep")).definition;
  const base = { complexity: 50, itemCount: 7, homogeneous: true, dynamicGoal: false, mutation: "none", risk: "low", origin: { kind: "human", requestDigest: `sha256:${"2".repeat(64)}` }, taskDigest: `sha256:${"3".repeat(64)}`, preferredBatch: "review-items" };

  const failedPlan = await composer.rawUltraRouter.run(strategy, { ...base, id: "ultra-plan-failed" }, { input: {} });
  assert.equal(failedPlan.result.status, "failed");
  assert.equal(failedPlan.result.code, "BATCH_PLAN_FAILED");

  batchMode = "awaiting";
  const awaiting = await composer.rawUltraRouter.run(strategy, { ...base, id: "ultra-awaiting" }, { input: {} });
  assert.equal(awaiting.result.status, "awaiting-approval");

  projectionStatus = "failed";
  const failedProjection = await composer.rawUltraRouter.run(strategy, { ...base, id: "ultra-failed-projection" }, { input: {} });
  assert.equal(failedProjection.result.status, "failed");

  batchMode = "blocked-verifier";
  projectionStatus = "completed";
  const blocked = await composer.rawUltraRouter.run(strategy, { ...base, id: "ultra-blocked-verifier" }, { input: {} });
  assert.equal(blocked.result.status, "failed");
  assert.equal(blocked.result.verification.verdict, "blocked");

  const agent = await composer.rawUltraRouter.run(strategy, {
    ...base,
    id: "ultra-agent-fallback",
    complexity: 10,
    itemCount: 1,
    homogeneous: false,
  }, { input: null });
  assert.equal(agent.plan.route, "agent");
  assert.equal(agent.result.status, "failed");

  const legacyStrategy = structuredClone(strategy);
  legacyStrategy.workflowLibrary = ["single-agent-safe"];
  projectionStatus = "failed";
  const workflow = await composer.rawUltraRouter.run(legacyStrategy, {
    ...base,
    id: "ultra-legacy-workflow",
    homogeneous: false,
    itemCount: 3,
    preferredWorkflow: "single-agent-safe",
  }, { input: null });
  assert.equal(workflow.plan.route, "workflow");
  assert.equal(workflow.result.status, "failed");

  projectionStatus = "awaiting-approval";
  const goalRequest = {
    ...base,
    id: "ultra-goal-awaiting",
    complexity: 90,
    homogeneous: false,
    dynamicGoal: true,
    preferredGoal: "research-release-goal",
    risk: "high",
  };
  const goalPlan = composer.rawUltraRouter.plan(strategy, goalRequest);
  const goal = await composer.rawUltraRouter.run(strategy, goalRequest, { input: null, authorization: createUltraRunAuthorization(goalPlan, "ultra-branch-authorization") });
  assert.equal(goal.result.status, "awaiting-approval");

  projectionStatus = "completed";
  const completedGoalRequest = { ...goalRequest, id: "ultra-goal-fallback-receipt" };
  const completedGoalPlan = composer.rawUltraRouter.plan(strategy, completedGoalRequest);
  const completedGoal = await composer.rawUltraRouter.run(strategy, completedGoalRequest, { input: {}, authorization: createUltraRunAuthorization(completedGoalPlan, "ultra-branch-authorization-two") });
  assert.equal(completedGoal.result.status, "completed");
  assert.match(completedGoal.result.verification.receiptDigest, /^sha256:/u);
  await composer.dispose();
});
