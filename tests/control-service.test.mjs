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
