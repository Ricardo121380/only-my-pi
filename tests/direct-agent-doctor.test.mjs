import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DirectAgentDoctor } from "../packages/direct-agent/doctor.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-doctor-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stack = path.join(root, "stack");
  const omp = path.join(stack, "only-my-pi", "package");
  const configRoot = path.join(root, "agent");
  await fs.mkdir(path.join(omp, "bin"), { recursive: true });
  await fs.mkdir(path.join(omp, "overlays"), { recursive: true });
  await fs.mkdir(path.join(omp, "packages", "direct-agent"), { recursive: true });
  await fs.mkdir(path.join(stack, "pi"), { recursive: true });
  await fs.mkdir(configRoot, { recursive: true });
  await fs.writeFile(path.join(omp, "package.json"), JSON.stringify({ name: "only-my-pi", version: "0.3.0-preview.1" }));
  await fs.writeFile(path.join(omp, "bin", "omp.mjs"), "#!/usr/bin/env node\n");
  await fs.writeFile(path.join(omp, "overlays", "writer.json"), JSON.stringify({ available: true, kind: "soft", capabilityIds: ["guarded-project-coding"] }));
  await fs.writeFile(path.join(omp, "packages", "direct-agent", "managed-clone.mjs"), "export {};\n");
  await fs.writeFile(path.join(omp, "packages", "direct-agent", "orchestration.mjs"), "export {};\n");
  await fs.writeFile(path.join(stack, "pi", "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.84.3" }));
  return { root, stack, omp, configRoot };
}

test("direct doctor reports launcher, Pi, permission, writer, extension and model readiness", async (t) => {
  const value = await fixture(t);
  const doctor = new DirectAgentDoctor({
    rootDir: value.omp,
    configRoot: value.configRoot,
    stackRoot: value.stack,
    resolveStack: async () => ({ root: value.stack, ompPackageRoot: value.omp }),
    resolveExtensions: async () => ({
      extensions: ["/verified/permission.ts", "/verified/omp-direct.ts"],
      identities: ["permission-modes:src/index.ts", "only-my-pi:extensions/omp-direct/index.ts"],
      planModeOwner: "only-my-pi",
    }),
    readRecentModel: async () => ({ model: "provider/model", selectedAt: "2026-08-30T00:00:00.000Z" }),
  });
  const result = await doctor.inspect();
  assert.equal(result.ok, true);
  assert.equal(result.status, "DIRECT_AGENT_READY");
  assert.equal(result.launcher.processModel, "execve");
  assert.equal(result.pi.version, "0.84.3");
  assert.equal(result.extensions.ambientDiscovery, false);
  assert.equal(result.extensions.planModeOwner, "only-my-pi");
  assert.equal(result.permission.initialMode, "build");
  assert.equal(result.permission.yoloPolicy, "revoke-coding-grant");
  assert.equal(result.writer.isolation, "managed-clone");
  assert.equal(result.writer.maximumWriters, 1);
  assert.equal(result.model.recentModel, "provider/model");
  assert.equal(result.model.authenticationInspected, false);
});

test("direct doctor returns a bounded update code when the controlled stack is unavailable", async (t) => {
  const value = await fixture(t);
  const doctor = new DirectAgentDoctor({
    rootDir: value.omp,
    configRoot: value.configRoot,
    stackRoot: value.stack,
    resolveStack: async () => { throw Object.assign(new Error("host path omitted"), { code: "OMP_CONTROLLED_STACK_UNAVAILABLE" }); },
  });
  const result = await doctor.inspect();
  assert.equal(result.ok, false);
  assert.equal(result.status, "DIRECT_AGENT_UPDATE_REQUIRED");
  assert.equal(result.code, "OMP_CONTROLLED_STACK_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes(value.root), false);
});
