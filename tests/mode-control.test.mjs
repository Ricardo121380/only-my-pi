import assert from "node:assert/strict";
import test from "node:test";

import { parseOmpArgs } from "../packages/control-service/cli-parser.mjs";
import { ModeControlService } from "../packages/control-service/mode-service.mjs";

const context = { env: {}, homedir: () => "/tmp/omp-mode-home" };

test("mode CLI grammar is explicit and rejects ambiguous mutation flags", () => {
  assert.deepEqual(parseOmpArgs(["mode"], context).options, {
    configRoot: "/tmp/omp-mode-home/.pi/agent",
    profile: null,
    subcommand: "list",
    modeId: null,
    resolved: false,
    json: false,
  });
  assert.equal(parseOmpArgs(["mode", "show", "user:review", "--resolved"], context).options.modeId, "user:review");
  assert.throws(() => parseOmpArgs(["mode", "use", "coding", "--apply"], context), /not valid/);
  assert.throws(() => parseOmpArgs(["mode", "list", "coding"], context), /accepts no mode id/);
  assert.throws(() => parseOmpArgs(["mode", "show", "../escape"], context), /canonical mode/);
});

function registry() {
  return {
    version: "1",
    async list() {
      return [{ id: "inspect", version: "1.0.0", executionState: "ask" }];
    },
    async resolve(id) {
      if (id !== "inspect") throw Object.assign(new Error("missing"), { code: "MODE_NOT_FOUND" });
      return { id, version: "1.0.0", executionState: "ask", policy: { workspace: "read-only" } };
    },
    async explain(id) {
      return { id, sources: [{ path: "executionState", source: "mode:inspect" }] };
    },
    async diff() {
      return [{ path: "tools.allow", from: ["read"], to: ["read", "grep"] }];
    },
    async scaffold(id) {
      return { template: { id, version: "1.0.0", contractStatus: "contract-only" } };
    },
    async doctor() {
      return { ok: true, status: "MODE_DOCTOR_PASS", errors: [] };
    },
  };
}

test("mode service exposes offline list/show/diff/scaffold/doctor", async () => {
  const service = new ModeControlService({ rootDir: "/tmp/only-my-pi", registry: registry() });
  assert.equal((await service.dispatch({ subcommand: "list" })).status, "MODE_LIST");
  assert.equal((await service.dispatch({ subcommand: "show", modeId: "inspect" })).status, "MODE_SHOW");
  assert.equal((await service.dispatch({ subcommand: "diff", modeId: "inspect" })).diff.changes.length, 0);
  assert.equal((await service.dispatch({ subcommand: "scaffold", modeId: "user:new" })).readOnly, true);
  assert.equal((await service.dispatch({ subcommand: "doctor" })).status, "MODE_DOCTOR_PASS");
});

test("mode activation fails closed when no public session driver exists", async () => {
  const service = new ModeControlService({ rootDir: "/tmp/only-my-pi", registry: registry() });
  const result = await service.dispatch({ subcommand: "use", modeId: "inspect" });
  assert.equal(result.status, "RESTART_REQUIRED");
  assert.equal(result.mutation, false);
  assert.match(result.next, /restart Pi/);
});

test("mode service preserves explicit registry errors", async () => {
  const service = new ModeControlService({ rootDir: "/tmp/only-my-pi", registry: registry() });
  const result = await service.dispatch({ subcommand: "show", modeId: "missing" });
  assert.equal(result.status, "MODE_NOT_FOUND");
  assert.equal(result.code, "MODE_NOT_FOUND");
});
