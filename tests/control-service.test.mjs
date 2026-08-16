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
