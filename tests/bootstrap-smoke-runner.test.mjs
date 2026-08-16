import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNoModelSmokeRunner,
  NO_MODEL_SMOKE_COMMANDS_REQUEST_ID,
  NO_MODEL_SMOKE_REQUEST_ID,
} from "../packages/bootstrap/smoke-runner.mjs";

function fakeChild(onRequest) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    write(chunk) {
      onRequest?.(JSON.parse(String(chunk).trim()), child);
      return true;
    },
    end() {
      queueMicrotask(() => child.emit("exit", 0, null));
    },
  };
  child.kill = () => child.emit("exit", null, "SIGTERM");
  return child;
}

test("no-model smoke uses an isolated RPC state request and a scrubbed environment", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-smoke-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  let invocation;
  const requests = [];
  const spawnImpl = (command, argv, options) => {
    invocation = { command, argv, options };
    return fakeChild((request, child) => {
      requests.push(request);
      if (request.type === "get_state") {
        queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({
          id: NO_MODEL_SMOKE_REQUEST_ID,
          type: "response",
          command: "get_state",
          success: true,
          data: { model: null, messageCount: 0 },
        })}\n`));
      } else if (request.type === "get_commands") {
        queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify({
          id: NO_MODEL_SMOKE_COMMANDS_REQUEST_ID,
          type: "response",
          command: "get_commands",
          success: true,
          data: { commands: [{ name: "omp-context", source: "extension" }] },
        })}\n`));
      }
    });
  };
  const run = createNoModelSmokeRunner({ spawnImpl, timeoutMs: 1_000 });
  const settings = {
    onlyMyPi: {
      managedSettings: {
        packages: [{ source: "./only-my-pi/generations/sha256-a/npm/example", extensions: ["x"], skills: [], prompts: [], themes: [] }],
        extensions: ["./only-my-pi/generations/sha256-a/resources/extensions/context-doctor/index.ts"],
        skills: [],
        prompts: [],
        themes: [],
      },
    },
  };
  const result = await run({ configRoot, settings });

  assert.equal(result.status, "NO_MODEL_STARTUP_PASS");
  assert.equal(result.promptSubmitted, false);
  assert.equal(result.configuredCredentialRoot, "ISOLATED_EMPTY");
  assert.equal(result.hostFilesystemIsolation, "NOT_ENFORCED");
  assert.equal(result.extensionNetworkIsolation, "NOT_ENFORCED");
  assert.equal(result.modelConfigured, false);
  assert.equal(result.extensionRegistrationVerified, true);
  assert.equal(result.verifiedCommandCount, 1);
  assert.deepEqual(requests, [
    { id: NO_MODEL_SMOKE_REQUEST_ID, type: "get_state" },
    { id: NO_MODEL_SMOKE_COMMANDS_REQUEST_ID, type: "get_commands" },
  ]);
  assert.equal(invocation.command, "pi");
  assert.equal(invocation.options.cwd, path.join(configRoot, "only-my-pi", "smoke-runtime", "agent"));
  assert.equal(invocation.options.shell, false);
  assert.deepEqual(invocation.options.stdio, ["pipe", "pipe", "pipe"]);
  assert.equal(invocation.options.env.PI_CODING_AGENT_DIR, invocation.options.cwd);
  assert.equal(invocation.options.env.PI_OFFLINE, "1");
  assert.equal(Object.hasOwn(invocation.options.env, "OPENAI_API_KEY"), false);
  assert.equal(Object.hasOwn(invocation.options.env, "ANTHROPIC_API_KEY"), false);
  assert.deepEqual(invocation.argv, [
    "--mode", "rpc",
    "--offline",
    "--no-session",
    "--no-context-files",
    "--no-skills",
    "--no-tools",
    "--no-approve",
  ]);
  const isolatedSettings = JSON.parse(await fs.readFile(path.join(invocation.options.cwd, "settings.json"), "utf8"));
  assert.equal(isolatedSettings.packages[0].source, path.join(configRoot, "only-my-pi/generations/sha256-a/npm/example"));
  assert.equal(isolatedSettings.extensions[0], path.join(configRoot, "only-my-pi/generations/sha256-a/resources/extensions/context-doctor/index.ts"));
  assert.equal(Object.hasOwn(isolatedSettings, "onlyMyPi"), false);
});

test("smoke fails when a managed first-party extension does not register its expected command", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-smoke-command-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const spawnImpl = () => fakeChild((request, child) => {
    const response = request.type === "get_state"
      ? {
          id: NO_MODEL_SMOKE_REQUEST_ID,
          type: "response",
          command: "get_state",
          success: true,
          data: { model: null, messageCount: 0 },
        }
      : {
          id: NO_MODEL_SMOKE_COMMANDS_REQUEST_ID,
          type: "response",
          command: "get_commands",
          success: true,
          data: { commands: [] },
        };
    queueMicrotask(() => child.stdout.emit("data", `${JSON.stringify(response)}\n`));
  });
  const settings = {
    onlyMyPi: {
      managedSettings: {
        packages: [],
        extensions: ["./only-my-pi/generations/sha256-a/resources/extensions/context-doctor/index.ts"],
        skills: [],
        prompts: [],
        themes: [],
      },
    },
  };

  await assert.rejects(
    createNoModelSmokeRunner({ spawnImpl, timeoutMs: 1_000 })({ configRoot, settings }),
    (error) => error.code === "PI_EXTENSION_REGISTRATION_UNVERIFIED"
      && error.missingCommands?.[0] === "omp-context",
  );
});

test("smoke fails closed on RPC failure and does not expose raw output", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-smoke-fail-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  const secret = "secret-shaped-diagnostic";
  const spawnImpl = () => fakeChild((_request, child) => {
    queueMicrotask(() => {
      child.stderr.emit("data", secret);
      child.stdout.emit("data", `${JSON.stringify({
        id: NO_MODEL_SMOKE_REQUEST_ID,
        type: "response",
        command: "get_state",
        success: false,
      })}\n`);
      child.emit("exit", 2, null);
    });
  });
  await assert.rejects(
    createNoModelSmokeRunner({ spawnImpl, timeoutMs: 1_000 })({ configRoot }),
    (error) => {
      assert.equal(error.code, "PI_NO_MODEL_SMOKE_FAILED");
      assert.match(error.stderrDigest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(error).includes(secret), false);
      return true;
    },
  );
});

test("smoke requires an explicit absolute root and never spawns on invalid input", async () => {
  let spawned = false;
  const run = createNoModelSmokeRunner({
    spawnImpl: () => {
      spawned = true;
      return fakeChild();
    },
  });
  await assert.rejects(run({ configRoot: "relative" }), { code: "INVALID_CONFIG_ROOT" });
  await assert.rejects(run({ configRoot: path.parse(path.resolve("/")).root }), { code: "INVALID_CONFIG_ROOT" });
  assert.equal(spawned, false);
});

test("smoke rejects non-local and escaping managed resources before spawning", async (t) => {
  const configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-smoke-path-"));
  t.after(() => fs.rm(configRoot, { recursive: true, force: true }));
  let spawned = false;
  const run = createNoModelSmokeRunner({
    spawnImpl: () => {
      spawned = true;
      return fakeChild();
    },
  });
  for (const source of ["npm:unreviewed@1.0.0", "./../escape.ts", "/absolute/escape.ts"]) {
    await assert.rejects(run({
      configRoot,
      settings: {
        onlyMyPi: {
          managedSettings: { packages: [], extensions: [source], skills: [], prompts: [], themes: [] },
        },
      },
    }), (error) => ["SMOKE_SETTINGS_INVALID", "SMOKE_SETTINGS_PATH_ESCAPE"].includes(error.code));
  }
  assert.equal(spawned, false);
});

test("smoke rejects symlinked runtime directories without writing outside configRoot", async (t) => {
  for (const relative of [
    "only-my-pi/smoke-runtime",
    "only-my-pi/smoke-runtime/agent",
    "only-my-pi/smoke-runtime/home",
    "only-my-pi/smoke-runtime/tmp",
    "only-my-pi/smoke-runtime/xdg-cache",
    "only-my-pi/smoke-runtime/xdg-config",
    "only-my-pi/smoke-runtime/xdg-data",
  ]) {
    await t.test(relative, async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-smoke-symlink-"));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const configRoot = path.join(root, "config");
      const outside = path.join(root, "outside");
      const target = path.join(configRoot, ...relative.split("/"));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.mkdir(outside);
      await fs.symlink(outside, target);
      let spawned = false;
      const run = createNoModelSmokeRunner({
        spawnImpl: () => {
          spawned = true;
          return fakeChild();
        },
      });

      await assert.rejects(
        run({ configRoot, settings: {} }),
        (error) => ["SYMLINK_ESCAPE", "UNSAFE_CONFIG_PATH"].includes(error?.code),
      );
      assert.equal(spawned, false);
      assert.deepEqual(await fs.readdir(outside), []);
    });
  }
});
