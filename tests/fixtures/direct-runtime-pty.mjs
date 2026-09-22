// Private lifecycle acceptance; --full-stack loads 12 source-stack extensions
// with an isolated permission adapter. Not a daily/candidate installation proof:
// the isolated config carries verified package copies, never user credentials.
// node tests/fixtures/direct-runtime-pty.mjs quit|resume|occupied|cwd|cwd-cancel|import|new|fork|crash
// cwd/cwd-cancel: /resume, Tab to All, select target, confirm/cancel correction, /quit.
// occupied: /resume, select target, observe refusal, then /quit.
// quit: /quit. resume: /fixture-resume, then /quit. crash: automatic owned-child SIGKILL.
// import: /import incoming/target.jsonl, confirm, then /quit.
// new: /new, then /quit. Empty new histories need not be persisted by Pi.
// fork: /fork, select the second user message, clear restored text, /quit.
// shell --full-stack: /fixture-shell, then /quit (sandbox execution/group cleanup).
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireOwnership } from "../../packages/host/ownership.mjs";
import { SessionAdmissions } from "../../packages/direct-agent/session-admission.mjs";
import { createAdmittedSessionRuntime } from "../../packages/direct-agent/session-runtime.mjs";
import { createResumeUiExtension } from "../../packages/direct-agent/session-resume-ui.mjs";
import { resolveControlledStack, resolveDirectExtensionSet } from "../../packages/direct-agent/launcher.mjs";
import { patchPermissionShellIndex, patchPermissionShellSandbox } from "../../packages/distribution/permission-shell-patch.mjs";
import { projectExecutionState } from "../../packages/project-gates/index.mjs";
import { resolveBoundPackageRoot } from "../../packages/bootstrap/runtime-package-binding.mjs";

if (process.argv[2] === "--child") {
  const root = process.argv[3], config = path.join(root, "config");
  const extensions = process.argv.slice(4);
  const sdk = await import("@earendil-works/pi-coding-agent");
  sdk.initTheme("dark", false);
  const admissions = new SessionAdmissions(config);
  const modelRuntime = await sdk.ModelRuntime.create({ authPath: path.join(config, "auth.json"),
    modelsPath: path.join(config, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  let runtime;
  const createRuntime = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    await assert.rejects(acquireOwnership(config, "session", sessionManager.getSessionId()), { code: "OWNERSHIP_HELD" });
    const services = await sdk.createAgentSessionServices({ cwd, agentDir, modelRuntime,
      settingsManager: sdk.SettingsManager.inMemory({ quietStartup: true, enableAnalytics: false }),
      extensionFlagValues: extensions.length ? new Map([["perm", "build"]]) : undefined,
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
        additionalExtensionPaths: extensions,
        extensionFactories: [(pi) => pi.events.emit("only-my-pi:direct-session-owner:v1", {
          ownsSession: (ctx) => !admissions.closing && ctx.mode === "tui"
            && ctx.sessionManager === sessionManager,
        }), createResumeUiExtension({ sdk, getRuntime: () => runtime }), (pi) => {
          pi.events.on("only-my-pi:direct-runtime:v1", (payload) => {
            process.send?.({ orchestratorStatus: payload.status });
          });
          pi.registerCommand("fixture-shell", { description: "Exercise isolated permission-shell execution", handler: async () => {
            const registered = services.resourceLoader.getExtensions().extensions.flatMap((entry) => [...entry.tools.values()])
              .filter((entry) => entry.definition.name === "bash");
            assert.equal(registered.length, 1);
            const execute = (command) => registered[0].definition.execute("fixture-shell", { command, timeout: 3 }, new AbortController().signal, () => {}, {});
            const result = await execute("printf 'owned sandbox shell'");
            assert.match(JSON.stringify(result), /owned sandbox shell/);
            await assert.rejects(execute("sleep 30 &"), /SHELL_DESCENDANT_ACTIVE/);
            assert.deepEqual(projectExecutionState(), { active: 0, unconfirmed: false });
            process.send?.({ shellPassed: true });
          } });
          pi.registerCommand("fixture-resume", { description: "Resume only the test fixture", handler: async () => {
            await runtime.switchSession(path.join(root, "target.jsonl"));
          } });
          pi.on("session_start", (event) => {
            process.send?.({ ready: true, id: sessionManager.getSessionId(), reason: event.reason, cwd: sessionManager.getCwd() });
          });
          pi.on("session_shutdown", async (event) => {
            await assert.rejects(acquireOwnership(config, "session", sessionManager.getSessionId()), { code: "OWNERSHIP_HELD" });
            sessionManager.appendCustomEntry("shutdown-proof", { reason: event.reason });
            await new Promise((resolve, reject) => process.send({ shutdown: true,
              id: sessionManager.getSessionId(), reason: event.reason }, (error) => error ? reject(error) : resolve()));
          });
          pi.on("tool_call", () => ({ block: true, reason: "PRIVATE_LIFECYCLE_FIXTURE" }));
        }] } });
    assert.deepEqual(services.resourceLoader.getExtensions().errors, [], "full extension set must load");
    assert.ok(!services.diagnostics.some((entry) => entry.type === "error"));
    const model = { id: "fixture", name: "fixture", api: "openai-completions", provider: "fixture",
      baseUrl: "http://127.0.0.1:1", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 128 };
    const created = await sdk.createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, noTools: true });
    return { ...created, services, diagnostics: services.diagnostics };
  };
  runtime = await createAdmittedSessionRuntime({ sdk, admissions, sessionFile: path.join(root, "source.jsonl"), createRuntime });
  const ui = new sdk.InteractiveMode(runtime);
  await ui.run();
} else {
  const mode = process.argv[2];
  const fullStack = process.argv.includes("--full-stack");
  let extensions = [];
  const runtimePackages = [];
  if (fullStack) {
    const stack = await resolveControlledStack();
    // Verify installed third-party bindings, but exercise current source OMP
    // adapters. This is a source-stack fixture, not candidate-install proof.
    const resolved = await resolveDirectExtensionSet({ stack, configRoot: path.join(os.homedir(), ".pi/agent") });
    const repo = fileURLToPath(new URL("../../", import.meta.url));
    extensions = resolved.extensions.map((entry) => entry.startsWith(stack.ompPackageRoot + path.sep)
      ? path.join(repo, path.relative(stack.ompPackageRoot, entry)) : entry);
    assert.equal(extensions.length, 12);
    for (const packageId of ["subagents", "web-access"])
      runtimePackages.push(await resolveBoundPackageRoot({ configRoot: path.join(os.homedir(), ".pi/agent"), packageId }));
  }
  assert.ok(["quit", "shell", "resume", "occupied", "cwd", "cwd-cancel", "import", "new", "fork", "crash"].includes(mode));
  assert.ok(process.stdin.isTTY && process.stdout.isTTY);
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "omp-runtime-pty-")));
  const config = path.join(root, "config");
  await fs.mkdir(config);
  let targetOwner;
  try {
    if (fullStack) {
      for (const pkg of runtimePackages) {
        const destination = path.join(config, "npm/node_modules", pkg.manifest.name);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.cp(pkg.root, destination, { recursive: true });
      }
      await fs.writeFile(path.join(config, "settings.json"), JSON.stringify({
        onlyMyPi: { packageBindings: runtimePackages.map((pkg) => pkg.binding) },
      }));
      // Re-hash copied trees through the production resolver before child start.
      for (const pkg of runtimePackages) await resolveBoundPackageRoot({ configRoot: config, packageId: pkg.binding.id });
      const original = extensions[0], packageRoot = path.dirname(path.dirname(original));
      const copy = path.join(root, "permission");
      await fs.cp(packageRoot, copy, { recursive: true });
      await fs.symlink(path.dirname(packageRoot), path.join(root, "node_modules"), "dir");
      // Isolated build inputs only; never patch the user's external binding.
      for (const [name, transform] of [["index.ts", patchPermissionShellIndex], ["sandbox.ts", patchPermissionShellSandbox]]) {
        const file = path.join(copy, "src", name);
        await fs.writeFile(file, transform(await fs.readFile(file, "utf8")));
      }
      extensions[0] = path.join(copy, "src/index.ts");
    }
    for (const id of ["source", "target"]) await fs.writeFile(path.join(root, `${id}.jsonl`),
      JSON.stringify({ type: "session", version: 1, id, cwd: root, timestamp: new Date().toISOString() }) + "\n");
    const importedContents = JSON.stringify({ type: "session", version: 1, id: "imported", cwd: root, timestamp: new Date().toISOString() }) + "\n";
    if (mode === "cwd" || mode === "cwd-cancel") await fs.writeFile(path.join(root, "target.jsonl"),
      JSON.stringify({ type: "session", version: 1, id: "target", cwd: path.join(root, "removed-project"), timestamp: new Date().toISOString() }) + "\n");
    const targetBefore = await fs.readFile(path.join(root, "target.jsonl"));
    if (mode === "occupied") targetOwner = await acquireOwnership(config, "session", "target");
    if (mode === "import") {
      await fs.mkdir(path.join(root, "incoming"));
      await fs.writeFile(path.join(root, "incoming/target.jsonl"), importedContents);
    }
    if (mode === "fork") {
      const timestamp = new Date().toISOString();
      const entries = [{ type: "session", version: 3, id: "source", cwd: root, timestamp },
        { type: "message", id: "first", parentId: null, timestamp, message: { role: "user", content: "first fixture message", timestamp: Date.now() } },
        { type: "message", id: "second", parentId: "first", timestamp, message: { role: "user", content: "second fixture message", timestamp: Date.now() } }];
      await fs.writeFile(path.join(root, "source.jsonl"), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    }
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--child", root, ...extensions], {
      cwd: root, stdio: ["inherit", "inherit", "inherit", "ipc"], env: { PATH: process.env.PATH,
        HOME: root, TERM: process.env.TERM ?? "xterm-256color", PI_CODING_AGENT_DIR: config,
        PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", ONLY_MY_PI_DIRECT: fullStack ? "1" : "0",
        ONLY_MY_PI_MODEL_EXPLICIT: "1", ONLY_MY_PI_HEADLESS: "0" } });
    const messages = [];
    child.on("message", (message) => messages.push(message));
    if (mode === "crash") child.once("message", () => child.kill("SIGKILL"));
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (mode === "crash") {
      assert.equal(result.signal, "SIGKILL");
      await assert.rejects(acquireOwnership(config, "session", "source"), { code: "OWNER_RECONCILIATION_REQUIRED" });
    } else {
      assert.equal(result.code, 0);
      if (fullStack) {
        const statuses = messages.filter((message) => message.orchestratorStatus).map((message) => message.orchestratorStatus);
        // Shutdown deliberately publishes UNAVAILABLE to revoke the capability.
        // Require READY for each start, and revocation for each shutdown.
        const expected = messages.filter((message) => message.ready || message.shutdown)
          .map((message) => message.ready ? "READY" : "UNAVAILABLE");
        assert.ok(expected.includes("READY"));
        assert.deepEqual(statuses, expected);
      }
      if (mode === "shell") assert.ok(messages.some((message) => message.shellPassed));
      if (mode === "occupied") {
        assert.deepEqual(await fs.readFile(path.join(root, "target.jsonl")), targetBefore);
        assert.deepEqual(messages.filter((message) => message.ready).map((message) => message.id), ["source"]);
        await assert.rejects(acquireOwnership(config, "session", "target"), { code: "OWNERSHIP_HELD" });
      }
      if (mode === "cwd-cancel") {
        assert.deepEqual(await fs.readFile(path.join(root, "target.jsonl")), targetBefore);
        assert.deepEqual(messages.filter((message) => message.ready).map((message) => message.id), ["source"]);
        const lease = await acquireOwnership(config, "session", "target"); await lease.release();
      }
      if (mode === "cwd") {
        const header = JSON.parse((await fs.readFile(path.join(root, "target.jsonl"), "utf8")).split("\n")[0]);
        assert.equal(header.cwd, path.join(root, "removed-project")); assert.equal(header.id, "target");
        assert.ok(messages.some((message) => message.ready && message.id === "target" && message.cwd === root));
      }
      for (const id of ["resume", "cwd"].includes(mode) ? ["source", "target"] : ["source"]) {
        if (mode !== "fork") assert.match(await fs.readFile(path.join(root, `${id}.jsonl`), "utf8"), /shutdown-proof/);
        const lease = await acquireOwnership(config, "session", id); await lease.release();
      }
      if (mode === "import") {
        const copy = await fs.readFile(path.join(root, "target-1.jsonl"), "utf8");
        assert.equal(JSON.parse(copy.split("\n")[0]).id, "imported");
        assert.match(copy, /shutdown-proof/);
        assert.equal(await fs.readFile(path.join(root, "incoming/target.jsonl"), "utf8"), importedContents);
        assert.deepEqual(await fs.readFile(path.join(root, "target.jsonl")), targetBefore);
        const lease = await acquireOwnership(config, "session", "imported"); await lease.release();
      }
      if (mode === "new" || mode === "fork") {
        const started = messages.filter((message) => message.ready && message.reason === mode);
        assert.equal(started.length, 1);
        const id = started[0].id; assert.notEqual(id, "source");
        assert.deepEqual(messages.filter((message) => message.shutdown).map(({ id, reason }) => ({ id, reason })),
          [{ id: "source", reason: mode }, { id, reason: "quit" }]);
        const lease = await acquireOwnership(config, "session", id); await lease.release();
        if (mode === "fork") {
          const files = (await fs.readdir(root)).filter((file) => file.endsWith(`_${id}.jsonl`));
          assert.equal(files.length, 1);
          const entries = (await fs.readFile(path.join(root, files[0]), "utf8")).trim().split("\n").map(JSON.parse);
          assert.equal(entries[0].parentSession, path.join(root, "source.jsonl"));
          assert.ok(entries.some((entry) => entry.id === "first"));
          assert.ok(!entries.some((entry) => entry.id === "second"));
        }
      }
    }
    process.stdout.write(`\nRUNTIME_PTY_${fullStack ? "SOURCE_STACK_" : ""}${mode.toUpperCase()}_PASS\n`);
  } finally { await targetOwner?.release(); await fs.rm(root, { recursive: true, force: true }); }
}
