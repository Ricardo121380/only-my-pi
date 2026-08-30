import assert from "node:assert/strict";
import test from "node:test";

import { createControlService } from "../packages/control-service/service.mjs";

function harness({ confirm } = {}) {
  const calls = [];
  const bootstrap = {};
  for (const method of [
    "planBootstrap",
    "applyBootstrap",
    "planUpdate",
    "applyUpdate",
    "planUninstall",
    "applyUninstall",
    "planRollback",
    "rollback",
    "doctor",
    "status",
    "safe",
  ]) {
    bootstrap[method] = async (options) => {
      calls.push({ method, options });
      return { ok: true, status: method, mutation: method.startsWith("apply") || method === "rollback" };
    };
  }
  const doctor = { live: async () => ({ ok: false, status: "UNAVAILABLE" }) };
  return { service: createControlService({ bootstrap, doctor, confirm }), calls };
}

test("bootstrap plan never reaches the mutation method", async () => {
  const { service, calls } = harness();
  const result = await service.dispatch({ command: "bootstrap", options: { apply: false } });
  assert.equal(result.status, "planBootstrap");
  assert.deepEqual(calls.map((entry) => entry.method), ["planBootstrap"]);
});

test("artifact install and artifact update share the plan-confirm-apply boundary", async () => {
  const calls = [];
  const artifactInstaller = {
    async plan(options) {
      calls.push({ method: "plan", options });
      return { ok: true, status: "ARTIFACT_INSTALL_PLAN", mutation: false, planDigest: "sha256:plan" };
    },
    async apply(options) {
      calls.push({ method: "apply", options });
      return { ok: true, status: "ARTIFACT_APPLIED", mutation: true };
    },
  };
  const bootstrap = { planUpdate: async () => assert.fail("artifact update must not use checkout bootstrap") };
  const doctor = { live: async () => ({ status: "UNAVAILABLE" }) };
  const denied = createControlService({ bootstrap, doctor, artifactInstaller });
  const options = { artifact: "/tmp/only-my-pi.tgz", profile: "daily", configRoot: "/tmp/agent", apply: true, yes: false };
  assert.equal((await denied.dispatch({ command: "install", options })).status, "CONFIRMATION_REQUIRED");
  const approved = createControlService({ bootstrap, doctor, artifactInstaller, confirm: async () => true });
  assert.equal((await approved.dispatch({ command: "update", options })).status, "ARTIFACT_APPLIED");
  assert.deepEqual(calls.map((entry) => `${entry.method}:${entry.options.operation}`), ["plan:install", "plan:update", "apply:update"]);
});

test("doctor reports direct Agent components and fails a matching daily target when they are unavailable", async () => {
  const bootstrap = {
    async doctor() {
      return {
        ok: true,
        status: "PASS",
        runtime: { profileId: "daily" },
        generation: { alignment: "MATCH" },
      };
    },
  };
  const doctor = { live: async () => ({ ok: false, status: "UNAVAILABLE" }) };
  const ready = createControlService({
    bootstrap,
    doctor,
    directDoctor: { async inspect() { return { ok: true, status: "DIRECT_AGENT_READY" }; } },
  });
  assert.equal((await ready.dispatch({ command: "doctor", options: { live: false } })).directAgent.status, "DIRECT_AGENT_READY");

  const unavailable = createControlService({
    bootstrap,
    doctor,
    directDoctor: { async inspect() { return { ok: false, status: "DIRECT_AGENT_UPDATE_REQUIRED", code: "WRITER_UPDATE_REQUIRED" }; } },
  });
  const result = await unavailable.dispatch({ command: "doctor", options: { live: false } });
  assert.equal(result.ok, false);
  assert.equal(result.status, "FAIL");
  assert.equal(result.code, "WRITER_UPDATE_REQUIRED");
});

test("apply requires explicit yes or a positive parent confirmation", async () => {
  const request = { command: "bootstrap", options: { apply: true, yes: false } };
  const denied = harness();
  assert.equal((await denied.service.dispatch(request)).status, "CONFIRMATION_REQUIRED");
  assert.deepEqual(denied.calls.map((entry) => entry.method), ["planBootstrap"]);

  const approved = harness({ confirm: async () => true });
  assert.equal((await approved.service.dispatch(request)).status, "applyBootstrap");
  assert.deepEqual(approved.calls.map((entry) => entry.method), ["planBootstrap", "applyBootstrap"]);
});

test("update and uninstall use plan-first mutation flow", async () => {
  for (const command of ["update", "uninstall"]) {
    const { service, calls } = harness();
    await service.dispatch({ command, options: { apply: true, yes: true } });
    const capital = command[0].toUpperCase() + command.slice(1);
    assert.deepEqual(calls.map((entry) => entry.method), [`plan${capital}`, `apply${capital}`]);
  }
});

test("rollback also requires parent confirmation", async () => {
  const { service, calls } = harness();
  const result = await service.dispatch({ command: "rollback", options: { yes: false } });
  assert.equal(result.status, "CONFIRMATION_REQUIRED");
  assert.deepEqual(calls.map((entry) => entry.method), ["planRollback"]);
});

test("every mutating command recovers an incomplete upstream transaction before planning", async () => {
  const calls = [];
  const upstreamMigration = {
    async recoverPending() { calls.push("recover"); return [{ status: "ROLLED_BACK" }]; },
    async plan() { calls.push("plan"); return { kind: "plan" }; },
    async apply() { calls.push("apply"); return { ok: true, status: "COMMITTED" }; },
  };
  const service = createControlService({ bootstrap: {}, doctor: {}, upstreamMigration });
  const result = await service.dispatch({ command: "upstream", mutation: true, options: { subcommand: "apply", apply: true, yes: true } });
  assert.equal(result.status, "COMMITTED");
  assert.deepEqual(calls, ["recover", "plan", "apply"]);
});

test("M11 release and stack routes keep status read-only and every mutation plan-first", async () => {
  const calls = [];
  const stackService = {
    async releaseCheck(options) { calls.push(["releaseCheck", options]); return { ok: true, status: "CURRENT", mutation: false }; },
    async status() { calls.push(["status"]); return { ok: true, status: "INSTALLED", mutation: false }; },
    async planInstall(options) { calls.push(["planInstall", options]); return { kind: "install-plan", planDigest: "sha256:plan", mutation: false }; },
    async applyInstall(options, plan) { calls.push(["applyInstall", options, plan]); return { ok: true, status: "COMMITTED", mutation: true }; },
    async planLifecycle(options) { calls.push(["planLifecycle", options]); return { kind: "lifecycle-plan", planDigest: "sha256:lifecycle", mutation: false }; },
    async applyLifecycle(options, plan) { calls.push(["applyLifecycle", options, plan]); return { ok: true, status: "REMOVED", mutation: true }; },
  };
  const service = createControlService({ bootstrap: {}, doctor: {}, stackService });
  assert.equal((await service.dispatch({ command: "release", options: { channel: "preview" } })).status, "CURRENT");
  assert.equal((await service.dispatch({ command: "stack", mutation: false, options: { subcommand: "status" } })).status, "INSTALLED");
  assert.equal((await service.dispatch({ command: "stack", mutation: false, options: { subcommand: "install", apply: false } })).kind, "install-plan");
  assert.equal((await service.dispatch({ command: "stack", mutation: true, options: { subcommand: "install", apply: true, yes: true } })).status, "COMMITTED");
  assert.equal((await service.dispatch({ command: "stack", mutation: false, options: { subcommand: "remove", apply: false } })).kind, "lifecycle-plan");
  assert.equal((await service.dispatch({ command: "stack", mutation: true, options: { subcommand: "remove", apply: true, yes: true } })).status, "REMOVED");
  assert.deepEqual(calls.map(([method]) => method), ["releaseCheck", "status", "planInstall", "planInstall", "applyInstall", "planLifecycle", "planLifecycle", "applyLifecycle"]);
});

test("live doctor remains separate from repository static doctor", async () => {
  const { service, calls } = harness();
  assert.equal((await service.dispatch({ command: "doctor", options: { live: false } })).status, "doctor");
  assert.equal((await service.dispatch({ command: "doctor", options: { live: true } })).status, "UNAVAILABLE");
  assert.deepEqual(calls.map((entry) => entry.method), ["doctor"]);
});

test("M3 read-only profile and control surfaces stay bounded", async () => {
  const bootstrap = {
    profiles: {
      list: () => [{ id: "coding", packages: 1, capabilities: 2 }],
      resolve: (id) => ({ profile: { id }, packages: [], capabilities: [] }),
      diff: (from, to) => ({ formatVersion: 1, from, to, packages: { added: [], removed: [], changed: [] } }),
    },
    status: async () => ({ ok: true, status: "NOT_INSTALLED", mutation: false }),
    safe: async () => ({ ok: true, status: "SAFE_START_GUIDANCE", mutation: false }),
  };
  const service = createControlService({ bootstrap, doctor: { live: async () => ({ status: "UNAVAILABLE" }) }, rootDir: process.cwd() });
  assert.equal((await service.dispatch({ command: "profile", options: { subcommand: "list" } })).status, "PROFILE_LIST");
  assert.equal((await service.dispatch({ command: "profile", options: { subcommand: "show", profileId: "coding" } })).status, "PROFILE_SHOW");
  assert.equal((await service.dispatch({ command: "tools", options: {} })).status, "TOOLS");
  assert.equal((await service.dispatch({ command: "context", options: {} })).status, "CONTEXT_UNAVAILABLE");
  assert.equal((await service.dispatch({ command: "verify", options: {} })).executable, false);
});

test("M6 theme mutations use the same plan-confirm-apply boundary", async () => {
  const calls = [];
  const themes = {
    async dispatch(options) {
      calls.push(options);
      return options.apply
        ? { ok: true, status: "THEME_APPLIED", mutation: true }
        : { ok: true, status: "THEME_PLAN", mutation: false, themeId: options.themeId };
    },
  };
  const service = createControlService({
    bootstrap: { status: async () => ({ ok: true, status: "STATUS" }) },
    doctor: { live: async () => ({ ok: false, status: "UNAVAILABLE" }) },
    themes,
  });
  assert.equal((await service.dispatch({ command: "theme", options: { subcommand: "use", themeId: "only-my-pi-dark", apply: false } })).status, "THEME_PLAN");
  const denied = await service.dispatch({ command: "theme", options: { subcommand: "use", themeId: "only-my-pi-dark", apply: true, yes: false } });
  assert.equal(denied.status, "CONFIRMATION_REQUIRED");
  assert.equal(calls.length, 2);
  const approved = createControlService({
    bootstrap: { status: async () => ({ ok: true, status: "STATUS" }) },
    doctor: { live: async () => ({ ok: false, status: "UNAVAILABLE" }) },
    themes,
    confirm: async () => true,
  });
  assert.equal((await approved.dispatch({ command: "theme", options: { subcommand: "use", themeId: "only-my-pi-dark", apply: true } })).status, "THEME_APPLIED");
});

test("Workflow and Swarm mutations use the shared plan-confirm-run boundary", async () => {
  const workflowCalls = [];
  const swarmCalls = [];
  const workflows = { async dispatch(options) { workflowCalls.push(options); return options.apply ? { ok: true, status: "WORKFLOW_COMPLETED", mutation: true } : { ok: true, status: "WORKFLOW_PLAN", mutation: false, input: { reviewed: "workflow" }, plan: { planDigest: "sha256:workflow" } }; } };
  const swarms = { async dispatch(options) { swarmCalls.push(options); return options.subcommand === "run" ? { ok: true, status: "SWARM_COMPLETED", mutation: true } : { ok: true, status: "SWARM_PLAN", mutation: false, input: { reviewed: "swarm" }, plan: { planDigest: "sha256:swarm" } }; } };
  const bootstrap = { status: async () => ({ ok: true, status: "STATUS" }) };

  const denied = createControlService({ bootstrap, doctor: { live: async () => ({ status: "UNAVAILABLE" }) }, workflows, swarms });
  assert.equal((await denied.dispatch({ command: "workflow", options: { subcommand: "run", workflowId: "safe", apply: true, yes: false } })).status, "CONFIRMATION_REQUIRED");
  assert.equal((await denied.dispatch({ command: "swarm", options: { subcommand: "run", recipeId: "research", yes: false } })).status, "CONFIRMATION_REQUIRED");

  const approved = createControlService({ bootstrap, doctor: { live: async () => ({ status: "UNAVAILABLE" }) }, workflows, swarms, confirm: async () => true });
  assert.equal((await approved.dispatch({ command: "workflow", options: { subcommand: "run", workflowId: "safe", inputFile: "/tmp/reviewed-workflow.json", apply: true, yes: false } })).status, "WORKFLOW_COMPLETED");
  assert.equal((await approved.dispatch({ command: "swarm", options: { subcommand: "run", recipeId: "research", inputFile: "/tmp/reviewed-swarm.json", yes: false } })).status, "SWARM_COMPLETED");
  assert.equal(workflowCalls.at(-1).yes, true);
  assert.equal(workflowCalls.at(-1).expectedPlanDigest, "sha256:workflow");
  assert.equal(workflowCalls.at(-1).inputFile, null);
  assert.deepEqual(workflowCalls.at(-1).input, { reviewed: "workflow" });
  assert.equal(swarmCalls.at(-1).yes, true);
  assert.equal(swarmCalls.at(-1).expectedPlanDigest, "sha256:swarm");
  assert.equal(swarmCalls.at(-1).inputFile, null);
  assert.deepEqual(swarmCalls.at(-1).input, { reviewed: "swarm" });
});

test("BatchSwarm mutations use the shared plan-confirm-run boundary without becoming a legacy recipe", async () => {
  const calls = [];
  const swarms = {
    async dispatch(options) {
      calls.push(options);
      return options.batchSubcommand === "run"
        ? { ok: true, status: "BATCH_SWARM_COMPLETED", mutation: true }
        : {
          ok: true,
          status: "BATCH_SWARM_PLAN",
          mutation: false,
          runId: "batch-run-1",
          input: { artifacts: { items: [] } },
          plan: { planDigest: "sha256:batch" },
          executionEnvelope: { executionEnvelopeDigest: "sha256:envelope", conditions: [] },
        };
    },
  };
  const service = createControlService({
    bootstrap: { status: async () => ({ ok: true, status: "STATUS" }) },
    doctor: { live: async () => ({ status: "UNAVAILABLE" }) },
    swarms,
    confirm: async () => true,
  });
  const result = await service.dispatch({
    command: "swarm",
    options: { subcommand: "batch", batchSubcommand: "run", batchId: "review-items", yes: false },
  });
  assert.equal(result.status, "BATCH_SWARM_COMPLETED");
  assert.equal(calls[0].subcommand, "batch");
  assert.equal(calls[0].batchSubcommand, "plan");
  assert.equal(calls[1].subcommand, "batch");
  assert.equal(calls[1].batchSubcommand, "run");
  assert.equal(calls[1].runId, "batch-run-1");
  assert.equal(calls[1].expectedPlanDigest, "sha256:batch");
  assert.equal(calls[1].expectedExecutionDigest, "sha256:envelope");
});
