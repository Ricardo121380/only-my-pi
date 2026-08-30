import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runOmpEntrypoint, OMP_EXIT_CODES } from "../bin/omp.mjs";
import {
  buildDirectPiInvocation,
  classifyOmpInvocation,
  inspectDirectAgentArguments,
  OMP_AGENT_USAGE,
  resolveControlledStack,
} from "../packages/direct-agent/launcher.mjs";

const STACK_DIGEST = "a".repeat(64);
const UUID = "00000000-0000-4000-8000-000000000000";

function outputStream() {
  let value = "";
  return {
    write(chunk) {
      value += String(chunk);
      return true;
    },
    text() {
      return value;
    },
  };
}

async function fakeStack(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, ".local", "share", "only-my-pi", "stacks", STACK_DIGEST);
  await fs.mkdir(path.join(root, "node", "bin"), { recursive: true });
  await fs.mkdir(path.join(root, "pi", "dist", "bundle"), { recursive: true });
  await fs.mkdir(path.join(root, "only-my-pi", "package", "bin"), { recursive: true });
  await fs.writeFile(path.join(root, "node", "bin", "node"), "node", { mode: 0o755 });
  await fs.writeFile(path.join(root, "pi", "dist", "bundle", "cli.js"), "pi\n", { mode: 0o644 });
  await fs.writeFile(path.join(root, "only-my-pi", "package", "bin", "omp.mjs"), "omp\n", { mode: 0o644 });
  const current = path.join(home, ".local", "share", "only-my-pi", "current-stack");
  await fs.symlink(path.relative(path.dirname(current), root), current);
  return { home, root };
}

test("public invocation routing makes the Agent default and preserves management aliases", () => {
  assert.deepEqual(classifyOmpInvocation([]), { kind: "agent", argv: [], compatibilityAlias: false });
  assert.deepEqual(classifyOmpInvocation(["fix the test"]), { kind: "agent", argv: ["fix the test"], compatibilityAlias: false });
  assert.deepEqual(classifyOmpInvocation(["--", "status"]), { kind: "agent", argv: ["status"], compatibilityAlias: false });
  assert.deepEqual(classifyOmpInvocation(["status", "--json"]), { kind: "admin", argv: ["status", "--json"], compatibilityAlias: true });
  assert.deepEqual(classifyOmpInvocation(["admin", "doctor"]), { kind: "admin", argv: ["doctor"], compatibilityAlias: false });
  assert.deepEqual(classifyOmpInvocation(["admin"]), { kind: "admin", argv: ["help"], compatibilityAlias: false });
  assert.equal(classifyOmpInvocation(["--help"]).kind, "agent-help");
});

test("direct Agent accepts session/model options and rejects authority overrides", () => {
  assert.deepEqual(inspectDirectAgentArguments(["-c", "--model", "provider/model", "continue"]), {
    headless: false,
    explicitModel: true,
  });
  assert.deepEqual(inspectDirectAgentArguments(["-p", "review"]), {
    headless: true,
    explicitModel: false,
  });
  assert.deepEqual(inspectDirectAgentArguments(["--mode", "rpc"]), {
    headless: true,
    explicitModel: false,
  });
  for (const argv of [
    ["--tools", "read,write"],
    ["--perm", "yolo"],
    ["--no-sandbox"],
    ["--extension", "/tmp/unsafe.ts"],
    ["--api-key", "secret"],
    ["--approve"],
  ]) assert.throws(() => inspectDirectAgentArguments(argv), { code: "OMP_AGENT_OPTION_UNSUPPORTED" });
  assert.doesNotThrow(() => inspectDirectAgentArguments(["--", "--perm yolo is task text"]));
});

test("controlled stack resolution follows only the active digest root", async (t) => {
  const value = await fakeStack(t);
  const stack = await resolveControlledStack({ packageRoot: "/tmp/source-checkout", homeDir: value.home });
  const realRoot = await fs.realpath(value.root);
  assert.equal(stack.root, realRoot);
  assert.equal(stack.stackId, `sha256:${STACK_DIGEST}`);
  assert.equal(stack.nodePath, path.join(realRoot, "node", "bin", "node"));
  assert.equal(stack.piCliPath, path.join(realRoot, "pi", "dist", "bundle", "cli.js"));

  const badHome = await fs.mkdtemp(path.join(os.tmpdir(), "omp-direct-bad-"));
  t.after(() => fs.rm(badHome, { recursive: true, force: true }));
  await assert.rejects(resolveControlledStack({ packageRoot: "/tmp/source-checkout", homeDir: badHome }), {
    code: "OMP_CONTROLLED_STACK_UNAVAILABLE",
  });
});

test("Pi invocation is read-only before admission and carries no prompt in marker environment", async (t) => {
  const value = await fakeStack(t);
  const stack = await resolveControlledStack({ stackRoot: value.root, homeDir: value.home });
  const prompt = "fix private token refresh";
  const interactive = buildDirectPiInvocation({
    argv: ["--model", "opencode-go/deepseek-v4-flash", prompt],
    stack,
    env: { PATH: "/usr/bin", UNDEFINED: undefined },
    randomUUIDImpl: () => UUID,
  });
  assert.deepEqual(interactive.argv.slice(0, 7), [
    stack.nodePath,
    stack.piCliPath,
    "--tools",
    "read,grep,find,ls",
    "--perm",
    "build",
    "--model",
  ]);
  assert.equal(interactive.env.ONLY_MY_PI_MODEL_EXPLICIT, "1");
  assert.equal(interactive.env.ONLY_MY_PI_HEADLESS, "0");
  assert.equal(interactive.env.ONLY_MY_PI_STACK_ID, `sha256:${STACK_DIGEST}`);
  assert.equal(Object.values(interactive.env).includes(prompt), false);
  assert.equal(Object.hasOwn(interactive.env, "UNDEFINED"), false);

  const headless = buildDirectPiInvocation({ argv: ["-p", "review"], stack, randomUUIDImpl: () => UUID });
  assert.equal(headless.headless, true);
  assert.deepEqual(headless.argv.slice(2, 6), ["--tools", "read,grep,find,ls", "--perm", "plan"]);
});

test("entrypoint renders Agent help and invokes the direct launcher without constructing admin services", async () => {
  const stdout = outputStream();
  const stderr = outputStream();
  const helpCode = await runOmpEntrypoint({ argv: ["--help"], stdout, stderr });
  assert.equal(helpCode, OMP_EXIT_CODES.SUCCESS);
  assert.equal(stdout.text(), `${OMP_AGENT_USAGE}\n`);
  assert.equal(stderr.text(), "");

  const calls = [];
  const code = await runOmpEntrypoint({
    argv: ["fix it"],
    stdout: outputStream(),
    stderr: outputStream(),
    env: { PATH: "/usr/bin" },
    homedir: () => "/tmp/home",
    rootDir: "/tmp/package",
    agentLauncher: async (options) => calls.push(options),
  });
  assert.equal(code, OMP_EXIT_CODES.SUCCESS);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv, ["fix it"]);
  assert.equal(calls[0].env.PATH, "/usr/bin");
});

test("entrypoint keeps explicit and compatibility management commands on the existing control plane", async () => {
  for (const argv of [["admin", "status"], ["status"]]) {
    const stdout = outputStream();
    const stderr = outputStream();
    const dispatched = [];
    const code = await runOmpEntrypoint({
      argv,
      env: {},
      homedir: () => "/tmp/home",
      stdout,
      stderr,
      service: {
        async dispatch(request) {
          dispatched.push(request);
          return { ok: true, status: "INSTALLED", mutation: false };
        },
      },
    });
    assert.equal(code, OMP_EXIT_CODES.SUCCESS);
    assert.equal(dispatched[0].command, "status");
    assert.match(stdout.text(), /status: INSTALLED/u);
    assert.equal(stderr.text(), "");
  }
});
